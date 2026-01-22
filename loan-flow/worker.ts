import dotenv from 'dotenv';
import { Contract, ethers, InterfaceAbi } from 'ethers';

import loanManagerAbi from '../contracts/abi/USCLoanManager.json';
import loanHelperAbi from '../contracts/abi/AuxiliaryLoanContract.json';
import blockProverAbi from '../contracts/abi/BlockProver.json';
import {
  computeGasLimitForProver,
  generateProofFor,
  isValidContractAddress,
  isValidPrivateKey,
  MAX_PROCESSED_TXS,
  pollEvents,
  POLLING_INTERVAL_MS,
  submitProofToBlockProver,
} from '../utils';

dotenv.config({ override: true });

// Graceful shutdown flag
let isShuttingDown = false;

process.on('SIGINT', () => {
  console.log('\nReceived SIGINT, shutting down gracefully...');
  isShuttingDown = true;
});

process.on('SIGTERM', () => {
  console.log('\nReceived SIGTERM, shutting down gracefully...');
  isShuttingDown = true;
});

interface LoanInfo {
  lender: string;
  borrower: string;
  loanAmount: number;
  repayAmount: number;
  repayLeft: number;
  expiresAt: number;
  funded: boolean;
  repaid: boolean;
  expired: boolean;
}

const proverContractAddress = '0x0000000000000000000000000000000000000FD2';

const main = async () => {
  console.log('Starting loan worker...');

  // Environment Variables
  const proverApiUrl = process.env.PROVER_API_URL;
  const sourceChainRpcUrl = process.env.SOURCE_CHAIN_RPC_URL;
  const ccNextRpcUrl = process.env.CREDITCOIN_RPC_URL;
  const ccNextWalletPrivateKey = process.env.CREDITCOIN_WALLET_PRIVATE_KEY;
  // Contract Addresses
  const loanManagerContractAddress = process.env.USC_LOAN_MANAGER_CONTRACT_ADDRESS;
  const sourceChainLoanContractAddress = process.env.SOURCE_CHAIN_LOAN_CONTRACT_ADDRESS;

  if (!proverApiUrl) {
    throw new Error('PROVER_API_URL environment variable is not configured or invalid');
  }

  if (!sourceChainRpcUrl) {
    throw new Error('SOURCE_CHAIN_RPC_URL environment variable is not configured or invalid');
  }

  if (!ccNextRpcUrl) {
    throw new Error('CREDITCOIN_RPC_URL environment variable is not configured or invalid');
  }

  if (!isValidPrivateKey(ccNextWalletPrivateKey)) {
    throw new Error('CREDITCOIN_WALLET_PRIVATE_KEY environment variable is not configured or invalid');
  }

  if (!isValidContractAddress(loanManagerContractAddress)) {
    throw new Error('USC_LOAN_MANAGER_CONTRACT_ADDRESS environment variable is not configured or invalid');
  }
  if (!isValidContractAddress(sourceChainLoanContractAddress)) {
    throw new Error('SOURCE_CHAIN_LOAN_CONTRACT_ADDRESS environment variable is not configured or invalid');
  }

  const sourceChainKey = Number(process.env.SOURCE_CHAIN_KEY);
  if (isNaN(sourceChainKey)) {
    throw new Error('SOURCE_CHAIN_KEY environment variable is not configured or invalid');
  }

  // ERC20 Contract Address
  const sourceChainERC20ContractAddress = process.env.SOURCE_CHAIN_ERC20_CONTRACT_ADDRESS;

  if (!isValidContractAddress(sourceChainERC20ContractAddress)) {
    throw new Error('SOURCE_CHAIN_ERC20_CONTRACT_ADDRESS environment variable is not configured or invalid');
  }

  // 1. Connect to the loan manager and prover contracts on creditcoin chain
  const ccProvider = new ethers.JsonRpcProvider(ccNextRpcUrl);
  const ccWallet = new ethers.Wallet(ccNextWalletPrivateKey!, ccProvider);

  const managerContract = new Contract(
    loanManagerContractAddress!,
    loanManagerAbi as unknown as InterfaceAbi,
    ccWallet
  );
  const proverContract = new Contract(proverContractAddress, blockProverAbi as unknown as InterfaceAbi, ccWallet);

  // 2. Connect to source chain loan contract
  const sourceChainProvider = new ethers.JsonRpcProvider(sourceChainRpcUrl);
  const sourceChainWallet = new ethers.Wallet(ccNextWalletPrivateKey!, sourceChainProvider);
  const sourceChainLoanContract = new Contract(
    sourceChainLoanContractAddress!,
    loanHelperAbi as unknown as InterfaceAbi,
    sourceChainWallet
  );

  // 3. Initialize loan tracker, expiry tracker and other state
  const loanTracker: Record<string, LoanInfo> = {};
  const loanExpiriesAt: Record<number, number[]> = {};

  // Get starting block numbers
  let sourceFromBlock = await sourceChainProvider.getBlockNumber();
  let ccFromBlock = await ccProvider.getBlockNumber();

  // Track processed transaction hashes to avoid duplicates
  const processedTxs = new Set<string>();

  console.log('Worker started! Listening for events...');
  console.log(`Polling source chain from block ${sourceFromBlock}`);
  console.log(`Polling USC chain from block ${ccFromBlock}`);

  // 4. List on block production on USC chain to track loan expiries
  const _ = ccProvider.on('block', (blockNumber: number) => {
    const expiringLoans = loanExpiriesAt[blockNumber];

    // 4.1 Go through expiring loans in the current block and mark them as expired if not repaid
    if (expiringLoans && expiringLoans.length > 0) {
      void (async () => {
        for (const loanId of expiringLoans) {
          const loanInfo = loanTracker[loanId];
          if (loanInfo && !loanInfo.repaid && !loanInfo.expired) {
            console.log(`Loan ${loanId} has expired on USC chain at block ${blockNumber}`);
            loanInfo.expired = true;

            try {
              const tx1 = await sourceChainLoanContract.markLoanAsExpired(loanId);
              console.log(`Marked loan ${loanId} as expired on source chain, tx hash: ${tx1.hash}`);

              const tx2 = await managerContract.markLoanAsExpired(loanId);
              console.log(`Marked loan ${loanId} as expired on Creditcoin, tx hash: ${tx2.hash}`);

              loanInfo.expired = true;
            } catch (error: any) {
              console.error(`Error marking loan ${loanId} as expired: `, error.shortMessage);
            }
          }
        }
      })();
    }
  });

  // Main polling loop
  while (!isShuttingDown) {
    // Poll both chains in parallel for better performance
    const [newCcBlock, newSourceBlock] = await Promise.all([
      // 5. Poll LoanRegistered events on manager contract
      pollEvents(managerContract, 'LoanRegistered', ccFromBlock, async (event) => {
        const [loanId, lender, borrower, loanAmount, repayAmount, expiresAt] = event.args;
        const txHash = event.transactionHash;

        if (processedTxs.has(txHash)) {
          return;
        }

        console.log(`Detected LoanRegistered event for loanId: ${loanId} - tx hash: ${txHash}`);

        try {
          // If this is a new transaction, add to loan tracker
          loanTracker[loanId] = {
            lender,
            borrower,
            loanAmount,
            repayAmount,
            repayLeft: repayAmount,
            expiresAt,
            funded: false,
            repaid: false,
            expired: false,
          };

          // Add loan to expiry tracker
          if (!loanExpiriesAt[expiresAt]) {
            loanExpiriesAt[expiresAt] = [];
          }
          loanExpiriesAt[expiresAt].push(loanId);

          // 5.3 Register in source chain loan contract the funding of the loan
          const fundFlow = {
            from: lender,
            to: borrower,
            withToken: sourceChainERC20ContractAddress,
          };

          const tx = await sourceChainLoanContract.registerLoanFund(loanId, fundFlow, loanAmount);
          console.log(`Registered loan ${loanId} for funding on source chain, tx hash: ${tx.hash}`);

          processedTxs.add(txHash);
        } catch (error: any) {
          console.error(`Error on LoanRegistered handle for ${loanId}: `, error.shortMessage);
        }
      }),
      // 6. Poll LoanFunded events on source chain loan contract
      pollEvents(sourceChainLoanContract, 'LoanFunded', sourceFromBlock, async (event) => {
        const [loanId] = event.args;
        const txHash = event.transactionHash;

        if (processedTxs.has(txHash)) {
          return;
        }

        console.log(`Detected LoanFunded event for loanId: ${loanId} - tx hash: ${txHash}`);

        const loanInfo = loanTracker[loanId];

        if (!loanInfo) {
          console.warn(`Loan ${loanId} not found in tracker.`);
          return;
        }

        if (loanInfo.expired || loanInfo.repaid || loanInfo.funded) {
          console.warn(`Loan ${loanId} is not in a valid state for funding. Skipping.`);
          return;
        }

        // 6.1 Validate transaction and generate proof once the block is attested
        const proofResult = await generateProofFor(
          txHash,
          sourceChainKey,
          proverApiUrl,
          ccProvider,
          sourceChainProvider
        );

        // 6.2 Using previously generated proof, submit to USC prover contract
        if (proofResult.success) {
          try {
            const gasLimit = await computeGasLimitForProver(
              ccProvider,
              proverContract,
              proofResult.data!,
              ccWallet.address
            );
            await submitProofToBlockProver(proverContract, proofResult.data!, gasLimit);

            loanInfo.funded = true;

            // 6.3 Register in source chain loan contract the repayment of the loan
            const repaymentFlow = {
              from: loanInfo.borrower,
              to: loanInfo.lender,
              withToken: sourceChainERC20ContractAddress,
            };

            const tx1 = await sourceChainLoanContract.registerLoanRepayment(
              loanId,
              repaymentFlow,
              loanInfo.repayAmount
            );
            console.log(`Registered loan ${loanId} for repayment on source chain, tx hash: ${tx1.hash}`);

            await new Promise((resolve) => setTimeout(resolve, 2000));

            // 6.4 Mark loan as funded on Creditcoin
            const tx2 = await managerContract.markLoanAsFunded(loanId);
            console.log(`Marked loan ${loanId} as funded on Creditcoin, tx hash: ${tx2.hash}`);

            processedTxs.add(txHash);
          } catch (error: any) {
            console.error(`Error on LoanFunded handle for ${loanId}: `, error.shortMessage);
          }
        } else {
          throw new Error(`Failed to generate proof: ${proofResult.error}`);
        }
      }),
      // 7. Poll LoanRepaid events on source chain loan contract
      pollEvents(sourceChainLoanContract, 'LoanRepaid', sourceFromBlock, async (event) => {
        const [loanId, amount] = event.args;
        const txHash = event.transactionHash;

        if (processedTxs.has(txHash)) {
          return;
        }

        console.log(`Detected LoanRepaid event for loanId: ${loanId} - tx hash: ${txHash}`);

        const loanInfo = loanTracker[loanId];

        if (!loanInfo) {
          console.warn(`Loan ${loanId} not found in tracker.`);
          return;
        }

        if (loanInfo.expired || loanInfo.repaid || !loanInfo.funded) {
          console.warn(`Loan ${loanId} is not in a valid state for repayment. Skipping.`);
          return;
        }

        // 7.1 Validate transaction and generate proof once the block is attested
        const proofResult = await generateProofFor(
          txHash,
          sourceChainKey,
          proverApiUrl,
          ccProvider,
          sourceChainProvider
        );

        // 7.2 Using previously generated proof, submit to USC prover contract
        if (proofResult.success) {
          try {
            const gasLimit = await computeGasLimitForProver(
              ccProvider,
              proverContract,
              proofResult.data!,
              ccWallet.address
            );
            await submitProofToBlockProver(proverContract, proofResult.data!, gasLimit);

            loanInfo.repayLeft -= amount;

            await new Promise((resolve) => setTimeout(resolve, 2000));

            // 7.3 Note loan repayment on Creditcoin, depending on whether the loan is fully repaid or not
            // will trigger either partial or full repayment events
            const tx1 = await managerContract.noteLoanRepayment(loanId, amount);
            console.log(`Note loan ${loanId} repayment, tx hash: ${tx1.hash}`);

            if (loanInfo.repayLeft <= 0) {
              loanInfo.repaid = true;
            }

            processedTxs.add(txHash);
          } catch (error: any) {
            console.error(`Error on LoanRepaid handle for ${loanId}: `, error.shortMessage);
          }
        } else {
          throw new Error(`Failed to generate proof: ${proofResult.error}`);
        }
      }),
      // 8. Polling LoanFunded, LoanExpired, LoanPartiallyRepaid and LoanRepaid events on manager contract
      pollEvents(managerContract, 'LoanFunded', ccFromBlock, (event) => {
        const [loanId] = event.args;
        const txHash = event.transactionHash;

        if (processedTxs.has(txHash)) {
          return;
        }
        processedTxs.add(txHash);

        console.log(`Loan ${loanId} has been marked as funded on Creditcoin.`);
      }),
      pollEvents(managerContract, 'LoanExpired', ccFromBlock, (event) => {
        const [loanId] = event.args;
        const txHash = event.transactionHash;

        if (processedTxs.has(txHash)) {
          return;
        }
        processedTxs.add(txHash);

        console.log(`Loan ${loanId} has been marked as expired on Creditcoin.`);
      }),
      pollEvents(managerContract, 'LoanPartiallyRepaid', ccFromBlock, (event) => {
        const [loanId, amountRepaid] = event.args;
        const txHash = event.transactionHash;

        if (processedTxs.has(txHash)) {
          return;
        }
        processedTxs.add(txHash);

        console.log(`Loan ${loanId} has been partially repaid on Creditcoin. Amount repaid: ${amountRepaid}`);
      }),
      pollEvents(managerContract, 'LoanRepaid', ccFromBlock, (event) => {
        const [loanId] = event.args;
        const txHash = event.transactionHash;

        if (processedTxs.has(txHash)) {
          return;
        }
        processedTxs.add(txHash);

        console.log(`Loan ${loanId} has been marked as fully repaid on Creditcoin.`);
      }),
    ]);

    ccFromBlock = newCcBlock;
    sourceFromBlock = newSourceBlock;

    // Prevent memory leak by clearing old entries when set grows too large
    if (processedTxs.size > MAX_PROCESSED_TXS) {
      console.log(`Clearing processed transactions cache (had ${processedTxs.size} entries)`);
      processedTxs.clear();
    }

    // Wait before next poll
    await new Promise((resolve) => setTimeout(resolve, POLLING_INTERVAL_MS));
  }

  // Shutdown providers
  sourceChainProvider.destroy();
  ccProvider.destroy();

  console.log('Worker stopped.');
};

main().catch(console.error);

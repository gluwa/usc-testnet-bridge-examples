import dotenv from 'dotenv';
import { Contract, ethers, InterfaceAbi } from 'ethers';

import loanManagerAbi from '../contracts/abi/USCLoanManager.json';
import loanHelperAbi from '../contracts/abi/AuxiliaryLoanContract.json';
import blockProverAbi from '../contracts/abi/BlockProver.json';
import { generateProofFor, submitProofToBlockProver } from '../utils';

dotenv.config({ override: true });

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

  if (!ccNextWalletPrivateKey || !ccNextWalletPrivateKey.startsWith('0x') || ccNextWalletPrivateKey.length !== 66) {
    throw new Error('CREDITCOIN_WALLET_PRIVATE_KEY environment variable is not configured or invalid');
  }

  if (
    !loanManagerContractAddress ||
    !loanManagerContractAddress.startsWith('0x') ||
    loanManagerContractAddress.length !== 42
  ) {
    throw new Error('USC_LOAN_MANAGER_CONTRACT_ADDRESS environment variable is not configured or invalid');
  }

  if (
    !sourceChainLoanContractAddress ||
    !sourceChainLoanContractAddress.startsWith('0x') ||
    sourceChainLoanContractAddress.length !== 42
  ) {
    throw new Error('SOURCE_CHAIN_LOAN_CONTRACT_ADDRESS environment variable is not configured or invalid');
  }

  const sourceChainKey = Number(process.env.SOURCE_CHAIN_KEY);
  if (isNaN(sourceChainKey)) {
    throw new Error('SOURCE_CHAIN_KEY environment variable is not configured or invalid');
  }

  // ERC20 Contract Address
  const sourceChainERC20ContractAddress = process.env.SOURCE_CHAIN_ERC20_CONTRACT_ADDRESS;

  if (
    !sourceChainERC20ContractAddress ||
    !sourceChainERC20ContractAddress.startsWith('0x') ||
    sourceChainERC20ContractAddress.length !== 42
  ) {
    throw new Error('SOURCE_CHAIN_ERC20_CONTRACT_ADDRESS environment variable is not configured or invalid');
  }

  // 1. Connect to the loan manager and prover contracts on creditcoin chain
  const ccProvider = new ethers.JsonRpcProvider(ccNextRpcUrl);
  const wallet = new ethers.Wallet(ccNextWalletPrivateKey, ccProvider);

  const managerContract = new Contract(loanManagerContractAddress, loanManagerAbi as unknown as InterfaceAbi, wallet);
  const proverContract = new Contract(proverContractAddress, blockProverAbi as unknown as InterfaceAbi, wallet);

  // 2. Connect to source chain loan contract
  const sourceChainProvider = new ethers.JsonRpcProvider(sourceChainRpcUrl, undefined, { polling: true });
  const sourceChainLoanContract = new Contract(
    sourceChainLoanContractAddress,
    loanHelperAbi as unknown as InterfaceAbi,
    sourceChainProvider
  );

  // 3. Initialize loan tracker and expiry tracker maps
  let loanTracker: Record<string, LoanInfo> = {};
  let loanExpiriesAt: Record<number, number[]> = {};

  // 4. List on block production on source chain to track loan expiries
  const blockHandle = sourceChainProvider.on('block', async (blockNumber: number) => {
    const expiringLoans = loanExpiriesAt[blockNumber];

    // 4.1 Go through expiring loans in the current block and mark them as expired if not repaid
    if (expiringLoans && expiringLoans.length > 0) {
      for (const loanId of expiringLoans) {
        const loanInfo = loanTracker[loanId];
        if (loanInfo && !loanInfo.repaid && !loanInfo.expired) {
          console.log(`Loan ${loanId} has expired on source chain at block ${blockNumber}`);
          loanInfo.expired = true;

          try {
            const tx1 = await sourceChainLoanContract.markLoanAsExpired(loanId);
            console.log(`Marked loan ${loanId} as expired on source chain, tx hash: ${tx1.hash}`);

            const tx2 = await managerContract.markLoanAsExpired(loanId);
            console.log(`Marked loan ${loanId} as expired on Creditcoin, tx hash: ${tx2.hash}`);

            loanInfo.expired = true;
          } catch (error) {
            console.error(`Error marking loan ${loanId} as expired on Creditcoin: `, error);
          }
        }
      }
    }
  });

  // 5. Listen to LoanRegistered events on manager contract
  const loanRegisteredHandle = managerContract.on(
    'LoanRegistered',
    async (
      loanId: number,
      lender: string,
      borrower: string,
      loanAmount: number,
      repayAmount: number,
      expiresAt: number,
      ...params: any[]
    ) => {
      // Last param is always the transaction hash
      const txHash = params[params.length - 1];
      console.log(`Detected LoanRegistered event for loanId: ${loanId} - tx hash: ${txHash}`);

      // 5.1. Validate transaction and generate proof once the block is attested
      const proofResult = await generateProofFor(txHash, sourceChainKey, proverApiUrl, ccProvider, sourceChainProvider);

      // 5.2. Using previously generated proof, submit to USC prover contract
      if (proofResult.success) {
        try {
          await submitProofToBlockProver(proverContract, proofResult.data!);

          // If the proof submission is successful, update the loan tracker
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

          const tx = await sourceChainLoanContract.registerLoanFund(fundFlow, loanAmount);
          console.log(`Registered loan ${loanId} for funding on source chain, tx hash: ${tx.hash}`);
        } catch (error) {
          console.error(`Error on LoanRegistered handle for ${loanId}: `, error);
        }
      } else {
        throw new Error(`Failed to generate proof: ${proofResult.error}`);
      }
    }
  );

  // 6. Listen to LoanFunded events on source chain loan contract
  const loanFundedOnSourceHandle = sourceChainLoanContract.on(
    'LoanFunded',
    async (loanId: number, ...params: any[]) => {
      // Last param is always the transaction hash
      const txHash = params[params.length - 1];
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
      const proofResult = await generateProofFor(txHash, sourceChainKey, proverApiUrl, ccProvider, sourceChainProvider);

      // 6.2 Using previously generated proof, submit to USC prover contract
      if (proofResult.success) {
        try {
          await submitProofToBlockProver(proverContract, proofResult.data!);

          const loanInfo = loanTracker[loanId];
          loanInfo.funded = true;

          // 6.3 Register in source chain loan contract the repayment of the loan
          const repaymentFlow = {
            from: loanInfo.borrower,
            to: loanInfo.lender,
            withToken: sourceChainERC20ContractAddress,
          };

          const tx1 = await sourceChainLoanContract.registerLoanRepayment(repaymentFlow, loanInfo.repayAmount);
          console.log(`Registered loan ${loanId} for repayment on source chain, tx hash: ${tx1.hash}`);

          // 6.4 Mark loan as funded on Creditcoin
          const tx2 = await managerContract.markLoanAsFunded(loanId);
          console.log(`Marked loan ${loanId} as funded on Creditcoin, tx hash: ${tx2.hash}`);
        } catch (error) {
          console.error(`Error on LoanFunded handle for ${loanId}: `, error);
        }
      } else {
        throw new Error(`Failed to generate proof: ${proofResult.error}`);
      }
    }
  );

  // 7. Listen to LoanRepaid events on source chain loan contract
  const loanRepaidOnSourceHandle = sourceChainLoanContract.on(
    'LoanRepaid',
    async (loanId: number, amount: number, ...params: any[]) => {
      // Last param is always the transaction hash
      const txHash = params[params.length - 1];
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
      const proofResult = await generateProofFor(txHash, sourceChainKey, proverApiUrl, ccProvider, sourceChainProvider);

      // 7.2 Using previously generated proof, submit to USC prover contract
      if (proofResult.success) {
        try {
          await submitProofToBlockProver(proverContract, proofResult.data!);

          const loanInfo = loanTracker[loanId];
          loanInfo.repayLeft -= amount;

          // 7.3 Note loan repayment on Creditcoin, depending on whether the loan is fully repaid or not
          // will trigger either partial or full repayment events
          const tx1 = await managerContract.noteLoanRepayment(loanId, amount);
          console.log(`Note loan ${loanId} repayment, tx hash: ${tx1.hash}`);

          if (loanInfo.repayLeft <= 0) {
            loanInfo.repaid = true;
          }
        } catch (error) {
          console.error(`Error on LoanRepaid handle for ${loanId}: `, error);
        }
      } else {
        throw new Error(`Failed to generate proof: ${proofResult.error}`);
      }
    }
  );

  // 8. Listening to LoanFunded, LoanExpired, LoanPartiallyRepaid and LoanFullyRepaid events on manager contract
  const loanFundedHandle = managerContract.on('LoanFunded', (loanId: number) => {
    console.log(`Loan ${loanId} has been marked as funded on Creditcoin.`);
  });

  const loanExpiredHandle = managerContract.on('LoanExpired', (loanId: number) => {
    console.log(`Loan ${loanId} has been marked as expired on Creditcoin.`);
  });

  const loanPartiallyRepaidHandle = managerContract.on(
    'LoanPartiallyRepaid',
    (loanId: number, amountRepaid: number) => {
      console.log(`Loan ${loanId} has been partially repaid on Creditcoin. Amount repaid: ${amountRepaid}`);
    }
  );

  const loanFullyRepaidHandle = managerContract.on('LoanFullyRepaid', (loanId: number) => {
    console.log(`Loan ${loanId} has been marked as fully repaid on Creditcoin.`);
  });

  await Promise.all([
    blockHandle,
    loanRegisteredHandle,
    loanFundedOnSourceHandle,
    loanRepaidOnSourceHandle,
    loanFundedHandle,
    loanExpiredHandle,
    loanPartiallyRepaidHandle,
    loanFullyRepaidHandle,
  ]);
};

main().catch(console.error);

import dotenv from 'dotenv';
import { Contract, ethers, InterfaceAbi } from 'ethers';

import burnerAbi from '../contracts/abi/TestERC20Abi.json';
import simpleMinterAbi from '../contracts/abi/SimpleMinterUSC.json';
import {
  generateProofFor,
  computeGasLimitForMinter,
  submitProofToMinter,
  pollEvents,
  MAX_PROCESSED_TXS,
  POLLING_INTERVAL_MS,
  isValidContractAddress,
  isValidPrivateKey,
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

const main = async () => {
  console.log('Starting...');

  // Prover API URL
  const proverApiUrl = process.env.PROVER_API_URL;

  if (!proverApiUrl) {
    throw new Error('PROVER_API_URL environment variable is not configured or invalid');
  }

  // Source chain contract address (ERC20 contract on source chain) where tokens are burned
  const sourceChainContractAddress = process.env.SOURCE_CHAIN_CUSTOM_CONTRACT_ADDRESS;
  const sourceChainKey = Number(process.env.SOURCE_CHAIN_KEY);
  const sourceChainRpcUrl = process.env.SOURCE_CHAIN_RPC_URL;

  // Minter USC contract address on Creditcoin
  const uscMinterContractAddress = process.env.USC_CUSTOM_MINTER_CONTRACT_ADDRESS;
  const ccNextRpcUrl = process.env.CREDITCOIN_RPC_URL;
  const ccNextWalletPrivateKey = process.env.CREDITCOIN_WALLET_PRIVATE_KEY;

  if (!isValidContractAddress(sourceChainContractAddress)) {
    throw new Error('SOURCE_CHAIN_CUSTOM_CONTRACT_ADDRESS environment variable is not configured or invalid');
  }

  if (!isValidContractAddress(uscMinterContractAddress)) {
    throw new Error('USC_CUSTOM_MINTER_CONTRACT_ADDRESS environment variable is not configured or invalid');
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

  // 1. Create connection to source chain burner contract
  const ethProvider = new ethers.JsonRpcProvider(sourceChainRpcUrl);
  const burnerContract = new Contract(sourceChainContractAddress!, burnerAbi as unknown as InterfaceAbi, ethProvider);

  // 2. Create connection to minter contract on Creditcoin USC chain
  const ccProvider = new ethers.JsonRpcProvider(ccNextRpcUrl);
  const wallet = new ethers.Wallet(ccNextWalletPrivateKey!, ccProvider);
  const minterContract = new Contract(uscMinterContractAddress!, simpleMinterAbi as unknown as InterfaceAbi, wallet);

  // Get starting block numbers
  let burnerFromBlock = await ethProvider.getBlockNumber();
  let minterFromBlock = await ccProvider.getBlockNumber();

  // Track processed transaction hashes to avoid duplicates
  const processedBurnTxs = new Set<string>();

  console.log('Worker started! Listening for burn events...');
  console.log(`Polling source chain from block ${burnerFromBlock}`);
  console.log(`Polling USC chain from block ${minterFromBlock}`);

  // Main polling loop
  while (!isShuttingDown) {
    // Poll both chains in parallel for better performance
    const [newMinterBlock, newBurnerBlock] = await Promise.all([
      pollEvents(minterContract, 'TokensMinted', minterFromBlock, (event) => {
        const [contract, to, amount, queryId] = event.args;
        console.log(
          `Tokens minted! Contract: ${contract}, To: ${to}, Amount: ${amount.toString()}, QueryId: ${queryId}`
        );
      }),
      pollEvents(burnerContract, 'TokensBurned', burnerFromBlock, async (event) => {
        const [from, amount] = event.args;
        const txHash = event.transactionHash;
        const contractAddress = event.address;

        // Skip if already processed
        if (processedBurnTxs.has(txHash)) {
          return;
        }

        // Validate that the event is from the wallet address we're monitoring and the contract we deployed
        if (from !== wallet.address || contractAddress !== sourceChainContractAddress) {
          return;
        }

        processedBurnTxs.add(txHash);
        console.log(`Detected burn of ${amount.toString()} tokens from ${from} at ${txHash}`);

        // Generate proof for the burn transaction
        const proofResult = await generateProofFor(txHash, sourceChainKey, proverApiUrl, ccProvider, ethProvider);

        if (proofResult.success) {
          const proofData = proofResult.data!;
          try {
            const gasLimit = await computeGasLimitForMinter(ccProvider, minterContract, proofData, wallet.address);
            const response = await submitProofToMinter(minterContract, proofData, gasLimit);
            console.log('Proof submitted: ', response.hash);
          } catch (error) {
            console.error('Error submitting proof: ', error);
          }
        } else {
          console.error(`Failed to generate proof: ${proofResult.error}`);
        }
      }),
    ]);

    minterFromBlock = newMinterBlock;
    burnerFromBlock = newBurnerBlock;

    // Prevent memory leak by clearing old entries when set grows too large
    if (processedBurnTxs.size > MAX_PROCESSED_TXS) {
      console.log(`Clearing processed transactions cache (had ${processedBurnTxs.size} entries)`);
      processedBurnTxs.clear();
    }

    // Wait before next poll
    await new Promise((resolve) => setTimeout(resolve, POLLING_INTERVAL_MS));
  }

  console.log('Worker stopped.');
};

main().catch(console.error);

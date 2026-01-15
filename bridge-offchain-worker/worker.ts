import dotenv from 'dotenv';
import { Contract, ContractEventPayload, ethers, InterfaceAbi } from 'ethers';

import burnerAbi from '../contracts/abi/TestERC20Abi.json';
import simpleMinterAbi from '../contracts/abi/SimpleMinterUSC.json';
import { generateProofFor, submitProof } from '../utils';

const PROVER_API_URL = 'https://proof-gen-api.usc-devnet.creditcoin.network';

dotenv.config();

const main = async () => {
  console.log('Starting...');
  // Source chain contract address (ERC20 contract on source chain) where tokens are burned
  const sourceChainContractAddress = process.env.SOURCE_CHAIN_CONTRACT_ADDRESS;
  const sourceChainKey = Number(process.env.SOURCE_CHAIN_KEY || 1);
  const sourceChainRpcUrl = process.env.SOURCE_CHAIN_RPC_URL;

  // Minter USC contract address on Creditcoin
  const uscMinterContractAddress = process.env.USC_MINTER_CONTRACT_ADDRESS;
  const ccNextRpcUrl = process.env.USC_TESTNET_RPC_URL;
  const ccNextWalletPrivateKey = process.env.USC_TESTNET_WALLET_PRIVATE_KEY;

  if (!sourceChainContractAddress) {
    throw new Error('SOURCE_CHAIN_CONTRACT_ADDRESS environment variable is not configured or invalid');
  }

  if (!uscMinterContractAddress) {
    throw new Error('USC_BRIDGE_CONTRACT_ADDRESS environment variable is not configured or invalid');
  }

  if (!sourceChainRpcUrl) {
    throw new Error('SOURCE_CHAIN_RPC_URL environment variable is not configured or invalid');
  }

  if (!ccNextRpcUrl) {
    throw new Error('USC_TESTNET_RPC_URL environment variable is not configured or invalid');
  }

  if (!ccNextWalletPrivateKey) {
    throw new Error('USC_TESTNET_WALLET_PRIVATE_KEY environment variable is not configured or invalid');
  }

  // 1. Instantiate source chain burner contract
  const ethProvider = new ethers.JsonRpcProvider(sourceChainRpcUrl);
  const burnerContract = new Contract(sourceChainContractAddress, burnerAbi as unknown as InterfaceAbi, ethProvider);

  // 2. Instantiate minter contract on Creditcoin USC chain
  const ccProvider = new ethers.JsonRpcProvider(ccNextRpcUrl);
  const wallet = new ethers.Wallet(ccNextWalletPrivateKey, ccProvider);
  const minterContract = new Contract(uscMinterContractAddress, simpleMinterAbi as unknown as InterfaceAbi, wallet);

  // 3. Listen to Minter events on USC chain
  const minterHandle = minterContract.on('TokensMinted', (contract, to, amount, queryId) => {
    console.log(`Tokens minted! Contract: ${contract}, To: ${to}, Amount: ${amount.toString()}, QueryId: ${queryId}`);
  });

  // 4. Listen to Burn events on source chain
  const burnerHandle = burnerContract.on('TokensBurned', async (from, amount, payload: ContractEventPayload) => {
    // We validate that the event is from the wallet address we're monitoring and the contract we deployed
    const contractAddress = payload.log.address;
    if (from !== wallet.address || contractAddress !== sourceChainContractAddress) {
      return;
    }

    const txHash = payload.log.transactionHash;
    console.log(`Detected burn of ${amount.toString()} tokens from ${from} at ${txHash}`);
    // Here you would generate the proof and submit the query to Creditcoin USC chain
    // using the proofGenerator and minterContract instances created above

    // Generate proof for the burn transaction
    const proofResult = await generateProofFor(txHash, sourceChainKey, PROVER_API_URL, ccProvider, ethProvider);

    if (proofResult.success) {
      const proofData = proofResult.data!;
      try {
        const response = await submitProof(minterContract, proofData);
        console.log('Proof submitted: ', response.hash);
      } catch (error) {
        console.error('Error submitting proof: ', error);
      }
    } else {
      console.error(`Failed to generate proof: ${proofResult.error}`);
    }

    return;
  });

  console.log('Worker started! Listening for burn events...');

  await Promise.all([burnerHandle, minterHandle]);
};

main().catch(console.error);

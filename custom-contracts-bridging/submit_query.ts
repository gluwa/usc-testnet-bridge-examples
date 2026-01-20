import dotenv from 'dotenv';
import { Contract, ethers, InterfaceAbi } from 'ethers';

import simpleMinterAbi from '../contracts/abi/SimpleMinterUSC.json';
import { generateProofFor, computeGasLimitForMinter, submitProofToMinterAndAwait } from '../utils';

dotenv.config({ override: true });

async function main() {
  // Setup
  const args = process.argv.slice(2);

  if (args.length !== 1) {
    console.error(`
  Usage:
    yarn custom_bridge:submit_query <Transaction_Hash>

  Example:
    yarn custom_bridge:submit_query 0x87c97c776a678941b5941ec0cb602a4467ff4a35f77264208575f137cb05b2a7
  `);
    process.exit(1);
  }

  const [transactionHash] = args;

  // Validate Transaction Hash
  if (!transactionHash.startsWith('0x') || transactionHash.length !== 66) {
    throw new Error('Invalid transaction hash provided');
  }

  // Validate Private Key
  const ccNextPrivateKey = process.env.CREDITCOIN_WALLET_PRIVATE_KEY;
  if (!ccNextPrivateKey || !ccNextPrivateKey.startsWith('0x') || ccNextPrivateKey.length !== 66) {
    throw new Error('CREDITCOIN_WALLET_PRIVATE_KEY environment variable is not configured or invalid');
  }

  const sourceChainKey = Number(process.env.SOURCE_CHAIN_KEY);
  if (!sourceChainKey) {
    throw new Error('SOURCE_CHAIN_KEY environment variable is not configured or invalid');
  }

  const proverApiUrl = process.env.PROVER_API_URL;
  if (!proverApiUrl) {
    throw new Error('PROVER_API_URL is not configured or invalid');
  }

  const creditcoinRpcUrl = process.env.CREDITCOIN_RPC_URL;
  if (!creditcoinRpcUrl) {
    throw new Error('CREDITCOIN_RPC_URL environment variable is not configured or invalid');
  }

  const minterContractAddress = process.env.USC_CUSTOM_MINTER_CONTRACT_ADDRESS;
  if (!minterContractAddress || !minterContractAddress.startsWith('0x') || minterContractAddress.length !== 42) {
    throw new Error('USC_CUSTOM_MINTER_CONTRACT_ADDRESS is not configured or invalid');
  }

  const sourceChainRpcUrl = process.env.SOURCE_CHAIN_RPC_URL;
  if (!sourceChainRpcUrl) {
    throw new Error('SOURCE_CHAIN_RPC_URL environment variable is not configured or invalid');
  }

  // 1. Initialize RPC providers
  const ccProvider = new ethers.JsonRpcProvider(creditcoinRpcUrl);
  const sourceChainProvider = new ethers.JsonRpcProvider(sourceChainRpcUrl);

  // 2. Validate transaction and generate proof once the block is attested
  const proofResult = await generateProofFor(
    transactionHash,
    sourceChainKey,
    proverApiUrl,
    ccProvider,
    sourceChainProvider
  );

  // 3. Using previously generated proof, submit to USC minter and await for the minted event
  if (proofResult.success) {
    // Establish link with the USC contract
    const wallet = new ethers.Wallet(ccNextPrivateKey, ccProvider);
    const contractABI = simpleMinterAbi as unknown as InterfaceAbi;
    const minterContract = new Contract(minterContractAddress, contractABI, wallet);

    const proofData = proofResult.data!;
    const gasLimit = await computeGasLimitForMinter(ccProvider, minterContract, proofData, wallet.address);
    await submitProofToMinterAndAwait(minterContract, proofData, gasLimit);
  } else {
    throw new Error(`Failed to generate proof: ${proofResult.error}`);
  }

  process.exit(0);
}

main().catch(console.error);

import { Contract, ethers, InterfaceAbi } from 'ethers';

import simpleMinterAbi from '../contracts/abi/SimpleMinterUSC.json';
import { generateProofFor, submitProofAndAwait } from '../utils';

// TODO: Update with deployed address on testnet
const USC_MINTER_CONTRACT_ADDRESS =
  '0x1d9b6d2E68555971138C1aE5b259BEF72E47a6D7';

const PROVER_API_URL = 'https://proof-gen-api.usc-devnet.creditcoin.network';
const CREDITCOIN_RPC_URL = 'https://rpc.usc-devnet.creditcoin.network';

async function main() {
  // Setup
  const args = process.argv.slice(2);

  if (args.length !== 3) {
    console.error(`
  Usage:
    yarn submit_query <Source_Chain_Rpc_Url> <Transaction_Hash> <Creditcoin_Private_Key>

  Example:
    yarn submit_query "https://sepolia.example.rpc" 0xabc123... 0xYOURPRIVATEKEY
  `);
    process.exit(1);
  }

  const [sourceChainRpcUrl, transactionHash, ccNextPrivateKey] = args;
  // TODO: Change this to 1 once this script is targeting testnet
  const chainKey = 3;

  // Validate Source Chain RPC URL
  if (!sourceChainRpcUrl.startsWith('http')) {
    throw new Error('Invalid source chain RPC URL provided');
  }

  // Validate Transaction Hash
  if (!transactionHash.startsWith('0x') || transactionHash.length !== 66) {
    throw new Error('Invalid transaction hash provided');
  }

  // Validate Private Key
  if (!ccNextPrivateKey.startsWith('0x') || ccNextPrivateKey.length !== 66) {
    throw new Error('Invalid private key provided');
  }

  // 1. Initialize RPC providers
  const ccProvider = new ethers.JsonRpcProvider(CREDITCOIN_RPC_URL);
  const sourceChainProvider = new ethers.JsonRpcProvider(sourceChainRpcUrl);

  // 2. Validate transaction and generate proof once the block is attested
  const proofResult = await generateProofFor(
    transactionHash,
    chainKey,
    PROVER_API_URL,
    ccProvider,
    sourceChainProvider
  );

  // 3. Using previously generated proof, submit to USC minter and await for the minted event
  if (proofResult.success) {
    // Establish link with the USC contract
    const wallet = new ethers.Wallet(ccNextPrivateKey, ccProvider);
    const contractABI = simpleMinterAbi as unknown as InterfaceAbi;
    const minterContract = new Contract(
      USC_MINTER_CONTRACT_ADDRESS,
      contractABI,
      wallet
    );

    const proofData = proofResult.data!;
    await submitProofAndAwait(minterContract, proofData);
  } else {
    throw new Error(`Failed to generate proof: ${proofResult.error}`);
  }

  process.exit(0);
}

main().catch(console.error);

import dotenv from 'dotenv';
import { Contract, ethers, InterfaceAbi } from 'ethers';
import {JsonRpcApiProvider, TransactionReceipt, Log, LogDescription, EventLog } from 'ethers';

import { proofGenerator, chainInfo } from '@gluwa/usc-sdk';

import USCDecodeOnlyABI from '../contracts/abi/USCDecodeOnly.json';
import {
  generateProofFor,
  isValidPrivateKey,
  isValidContractAddress,
} from '../utils';

dotenv.config({ override: true });

async function main() {
  const args = process.argv.slice(2);

  if (args.length !== 1) {
    console.error(`
  Usage:
    yarn submit_decode <Transaction_Hash>

  Example:
    yarn submit_decode 0x343b91c47944693ed1cdf3c979bd7722ed9284320ff6069bcfd46c109d9c4199
  `);
    process.exit(1);
  }

  const [transactionHash] = args;

  if (!transactionHash.startsWith('0x') || transactionHash.length !== 66) {
    throw new Error('Invalid transaction hash provided');
  }

  const ccNextPrivateKey = process.env.CREDITCOIN_WALLET_PRIVATE_KEY;
  if (!isValidPrivateKey(ccNextPrivateKey)) {
    throw new Error('CREDITCOIN_WALLET_PRIVATE_KEY environment variable is not configured or invalid');
  }

  const sourceChainKey = Number(process.env.MAINNET_CHAIN_KEY);
  if (!sourceChainKey) {
    throw new Error('MAINNET_CHAIN_KEY environment variable is not configured or invalid');
  }

  const proverApiUrl = process.env.PROVER_API_URL;
  if (!proverApiUrl) {
    throw new Error('PROVER_API_URL is not configured or invalid');
  }

  const creditcoinRpcUrl = process.env.CREDITCOIN_RPC_URL;
  if (!creditcoinRpcUrl) {
    throw new Error('CREDITCOIN_RPC_URL environment variable is not configured or invalid');
  }

  const decodeOnlyContractAddress = process.env.USC_DECODE_ONLY_CONTRACT_ADDRESS;
  if (!isValidContractAddress(decodeOnlyContractAddress)) {
    throw new Error('USC_DECODE_ONLY_CONTRACT_ADDRESS is not configured or invalid');
  }

  const sourceChainRpcUrl = process.env.HTTPS_URL;
  if (!sourceChainRpcUrl) {
    throw new Error('HTTPS_URL environment variable is not configured or invalid');
  }

  const ccProvider = new ethers.JsonRpcProvider(creditcoinRpcUrl);
  const sourceChainProvider = new ethers.JsonRpcProvider(sourceChainRpcUrl);

  const proofResult = await generateProofFor(
    transactionHash,
    sourceChainKey,
    proverApiUrl,
    ccProvider,
    sourceChainProvider,
  );

  if (!proofResult.success) {
    throw new Error(`Failed to generate proof: ${proofResult.error}`);
  }

  const wallet = new ethers.Wallet(ccNextPrivateKey!, ccProvider);
  const contractABI = USCDecodeOnlyABI as unknown as InterfaceAbi;
  const decodeOnlyContract = new Contract(decodeOnlyContractAddress!, contractABI, wallet);

  const proofData = proofResult.data!;
  const gasLimit = await computeGasLimitForDecoder(
    ccProvider,
    decodeOnlyContract,
    proofData,
    wallet.address,
  );

  await submitProofToUSCAndAwait(decodeOnlyContract, proofData, gasLimit);

  process.exit(0);
}

main().catch(console.error);

export async function computeGasLimitForDecoder(
  provider: JsonRpcApiProvider,
  contract: Contract,
  proofData: proofGenerator.ContinuityResponse,
  signerAddress: string
): Promise<bigint> {
  const action = 0; // Mint action (see MinterActions in USCMinter)
  const chainKey = proofData.chainKey;
  const height = proofData.headerNumber;
  const encodedTransaction = proofData.txBytes;
  const merkleRoot = proofData.merkleProof.root;
  const siblings = proofData.merkleProof.siblings;
  const lowerEndpointDigest = proofData.continuityProof.lowerEndpointDigest;
  const continuityRoots = proofData.continuityProof.roots;

  const iface = contract.interface;
  const funcFragment = iface.getFunction(
    'execute(uint8,uint64,uint64,bytes,bytes32,tuple(bytes32,bool)[],bytes32,bytes32[])'
  );
  const params = [
    action,
    chainKey,
    height,
    encodedTransaction,
    merkleRoot,
    siblings,
    lowerEndpointDigest,
    continuityRoots,
  ];
  const data = iface.encodeFunctionData(funcFragment!, params);

  const continuityBlocks = proofData.continuityProof.roots?.length || 1;

  return computeGasLimit(provider, contract, data, signerAddress, continuityBlocks);
}

async function computeGasLimit(
  provider: JsonRpcApiProvider,
  contract: Contract,
  data: string,
  from: string,
  continuityLength: number
): Promise<bigint> {
  const GAS_BUFFER_MULTIPLIER = 135; // 100% + 35% buffer
  // Estimate gas and add buffer
  console.log('⏳ Estimating gas...');

  let gasLimit;
  try {
    const estimatedGas = await provider.estimateGas({
      to: contract.getAddress(),
      data,
      from,
    });
    gasLimit = (estimatedGas * BigInt(GAS_BUFFER_MULTIPLIER)) / BigInt(100);
    console.log(`   Estimated gas: ${estimatedGas.toString()}, Gas limit with buffer: ${gasLimit.toString()}`);
  } catch (error: any) {
    // Gas estimation can fail even when the call would succeed
    // This is a known issue with precompiles - pallet-evm doesn't always
    // properly propagate revert reasons during estimation mode
    // Calculate a reasonable estimate based on continuity proof size (matching Rust logic)
    // Base: 21000 (tx) + ~5000 per continuity block + ~10000 for merkle + overhead
    const calculatedGas = 21000 + continuityLength * 5000 + 20000;
    console.warn(`   Gas estimation failed: ${error.shortMessage}`);
    console.log(
      `   Using calculated gas limit based on proof size: ${calculatedGas} (${continuityLength} continuity blocks)`
    );
    gasLimit = BigInt(calculatedGas);
  }

  return gasLimit;
}

/**
 * Submits the proof to the USC minter contract.
 * @param contract A minter contract instance, must have the mintFromQuery method with the correct signature.
 * @param proofData A proof data object obtained from the proof generation process.
 * @returns A promise that resolves to the transaction response of the mintFromQuery call.
 */
export async function submitProofToUSC(
  contract: Contract,
  proofData: proofGenerator.ContinuityResponse,
  gasLimit: bigint
): Promise<any> {
  const action = 0; // Mint action (see MinterActions in USCMinter)
  const chainKey = proofData.chainKey;
  const height = proofData.headerNumber;
  const encodedTransaction = proofData.txBytes;
  const merkleRoot = proofData.merkleProof.root;
  const siblings = proofData.merkleProof.siblings;
  const lowerEndpointDigest = proofData.continuityProof.lowerEndpointDigest;
  const continuityRoots = proofData.continuityProof.roots;

  return await contract.execute(
    action,
    chainKey,
    height,
    encodedTransaction,
    merkleRoot,
    siblings,
    lowerEndpointDigest,
    continuityRoots,
    { gasLimit }
  );
}

/**
 * Submits the proof to the USC minter contract and awaits the TokensMinted event.
 * Uses transaction receipt to check for events instead of filter-based polling to avoid
 * "Filter id does not exist" errors from RPC nodes with filter expiration.
 * @param contract A minter contract instance, must have the mintFromQuery method with the correct signature.
 * @param proofData A proof data object obtained from the proof generation process.
 * @returns Promise resolving to MintResult with transaction details and parsed event.
 */
export async function submitProofToUSCAndAwait(
  contract: Contract,
  proofData: proofGenerator.ContinuityResponse,
  gasLimit: bigint
): Promise<DecodeOnlyResult> {
  const response = await submitProofToUSC(contract, proofData, gasLimit);
  const txHash = response.hash;

  console.log('Proof submitted: ', txHash);
  console.log('Waiting for transaction to be mined...');

  const receipt: TransactionReceipt = await response.wait();
  console.log(`Gas used: ${receipt.gasUsed.toString()}`);

  if (receipt.gasPrice != null) {
    const feeWei = receipt.gasUsed * receipt.gasPrice;

    console.log(`Gas price: ${receipt.gasPrice.toString()} wei`);
    console.log(`Transaction fee: ${ethers.formatEther(feeWei)} CTC`);
  }

  const decodedEvent = receipt.logs
    .map((log: Log): LogDescription | null => {
      try {
        return contract.interface.parseLog({ topics: [...log.topics], data: log.data });
      } catch {
        return null;
      }
    })
    .find((parsed): parsed is LogDescription => parsed?.name === 'TransactionDecoded');

  let decodeEvent: DecodeOnlyResult['decodeEvent'] = null;

  if (decodedEvent) {
    const [
      queryId,
      txType,
      nonce,
      gasLimit,
      from,
      value,
      receiptStatus,
      receiptGasUsed,
      logCount,
      encodedLength,
    ] = decodedEvent.args;

    console.log(
      `Transaction decoded! QueryId: ${queryId}, Type: ${txType}, From: ${from}, ` +
      `ReceiptStatus: ${receiptStatus}, Logs: ${logCount}, EncodedLength: ${encodedLength}`
    );

    decodeEvent = {
      queryId,
      txType,
      nonce,
      gasLimit,
      from,
      value,
      receiptStatus,
      receiptGasUsed,
      logCount,
      encodedLength,
    };
  } else {
    console.log('Transaction mined but TransactionDecoded event not found in logs');
  }

  return { txHash, receipt, decodeEvent };
}

export interface DecodeOnlyResult {
  txHash: string;
  receipt: TransactionReceipt;
  decodeEvent: {
    queryId: string;
    txType: bigint;
    nonce: bigint;
    gasLimit: bigint;
    from: string;
    value: bigint;
    receiptStatus: bigint;
    receiptGasUsed: bigint;
    logCount: bigint;
    encodedLength: bigint;
  } | null;
}
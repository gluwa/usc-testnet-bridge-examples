import { Contract, JsonRpcApiProvider, TransactionReceipt, Log, LogDescription, EventLog } from 'ethers';

import { proofGenerator, chainInfo } from '@gluwa/cc-next-query-builder';

/**
 * Tries to generate a proof for the given transaction hash on the specified chain. Will fail if the
 * transaction does not exist or if the block containing the transaction has not been mined yet. Will
 * also wait for the block to be attested on Creditcoin before generating the proof. May take several
 * minutes depending on how fast the attestation happens.
 * @param txHash Transaction hash on the source chain to generate the proof for.
 * @param chainKey Chain key identifying the source chain on the Creditcoin network.
 * @param proofServerUrl Url of the prover API server.
 * @param creditcoinRpc A JsonRpcApiProvider connected to the Creditcoin network.
 * @param sourceChainRpc A JsonRpcApiProvider connected to the source chain.
 * @returns Promise that resolves to a ProofGenerationResult containing the proof data if successful.
 */
export async function generateProofFor(
  txHash: string,
  chainKey: number,
  proofServerUrl: string,
  creditcoinRpc: JsonRpcApiProvider,
  sourceChainRpc: JsonRpcApiProvider
): Promise<proofGenerator.ProofGenerationResult> {
  // First, we need to ensure that the transaction exists on the source chain
  const transaction = await sourceChainRpc.getTransaction(txHash);
  if (!transaction) {
    throw new Error(`Transaction ${txHash} does not exist on source chain`);
  }

  // Next, we need to ensure that the block is mined
  const blockNumber = transaction.blockNumber;
  if (!blockNumber) {
    throw new Error(`Transaction ${txHash} is not yet mined on source chain`);
  }

  console.log(`Transaction ${txHash} found in block ${blockNumber}`);

  // Now that we have the block number, we can setup the chain info provider to await
  // for its attestation
  const info = new chainInfo.PrecompileChainInfoProvider(creditcoinRpc);

  console.log(`Waiting for block ${blockNumber} attestation on Creditcoin...`);

  const latestAttested = await info.getLatestAttestedHeightAndHash(chainKey);
  console.log(`Latest attested height for chain key ${chainKey}: ${latestAttested.height}`);

  // We wait for at most 5 minutes for the attestation to be available
  await info.waitUntilHeightAttested(chainKey, blockNumber, 5_000, 300_000);

  console.log(`Block ${blockNumber} attested! Generating proof...`);

  // We can now proceed to generate the proof using the prover API
  const proofGenApi = new proofGenerator.api.ProverAPIProofGenerator(chainKey, proofServerUrl);

  try {
    const proof = await proofGenApi.generateProof(txHash);
    console.log('Proof generation successful!');
    return proof;
  } catch (error) {
    console.error('Error during proof generation: ', error);
    throw error;
  }
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

export async function computeGasLimitForLoanManager(
  provider: JsonRpcApiProvider,
  contract: Contract,
  proofData: proofGenerator.ContinuityResponse,
  signerAddress: string,
  is_repayment: boolean
): Promise<bigint> {
  const action = is_repayment ? 1 : 0; // See LoanManagerActions in USCLoanManager.sol
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

export async function computeGasLimitForMinter(
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

/**
 * Submits the proof of a LoanFunded event to the USCLoanManager contract
 * @param contract The loan manager contract. Must have the function markLoanAsFunded.
 * @param proofData A proof data object obtained from the proof generation process.
 * * @returns A promise that resolves to the transaction response of the markLoanAsFunded call.
 */
export async function submitFundProofToLoanManager(
  contract: Contract,
  proofData: proofGenerator.ContinuityResponse,
  gasLimit: bigint
): Promise<any> {
  const action = 0; // `LoanFunded` in LoanManagerActions
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
 * Submits the proof of a LoanRepaid event to the USCLoanManager contract
 * @param contract The loan manager contract. Must have the function noteLoanRepayment.
 * @param proofData A proof data object obtained from the proof generation process.
 * * @returns A promise that resolves to the transaction response of the noteLoanRepayment call.
 */
export async function submitRepayProofToLoanManager(
  contract: Contract,
  proofData: proofGenerator.ContinuityResponse,
  gasLimit: bigint
): Promise<any> {
  const action = 1; // `LoanRepaid` in LoanManagerActions
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
 * Submits the proof to the USC minter contract.
 * @param contract A minter contract instance, must have the mintFromQuery method with the correct signature.
 * @param proofData A proof data object obtained from the proof generation process.
 * @returns A promise that resolves to the transaction response of the mintFromQuery call.
 */
export async function submitProofToMinter(
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

export interface MintResult {
  txHash: string;
  receipt: TransactionReceipt;
  mintEvent: {
    contract: string;
    to: string;
    amount: bigint;
    queryId: string;
  } | null;
}

/**
 * Submits the proof to the USC minter contract and awaits the TokensMinted event.
 * Uses transaction receipt to check for events instead of filter-based polling to avoid
 * "Filter id does not exist" errors from RPC nodes with filter expiration.
 * @param contract A minter contract instance, must have the mintFromQuery method with the correct signature.
 * @param proofData A proof data object obtained from the proof generation process.
 * @returns Promise resolving to MintResult with transaction details and parsed event.
 */
export async function submitProofToMinterAndAwait(
  contract: Contract,
  proofData: proofGenerator.ContinuityResponse,
  gasLimit: bigint
): Promise<MintResult> {
  const response = await submitProofToMinter(contract, proofData, gasLimit);
  const txHash = response.hash;
  console.log('Proof submitted: ', txHash);

  // Wait for transaction to be mined and get the receipt
  console.log('Waiting for transaction to be mined...');
  const receipt: TransactionReceipt = await response.wait();

  // Parse the TokensMinted event from the transaction logs
  const tokensMintedEvent = receipt.logs
    .map((log: Log): LogDescription | null => {
      try {
        return contract.interface.parseLog({ topics: [...log.topics], data: log.data });
      } catch {
        return null;
      }
    })
    .find((parsed): parsed is LogDescription => parsed?.name === 'TokensMinted');

  let mintEvent: MintResult['mintEvent'] = null;

  if (tokensMintedEvent) {
    const [contractAddr, to, amount, queryId] = tokensMintedEvent.args;
    console.log(
      `Tokens minted! Contract: ${contractAddr}, To: ${to}, Amount: ${amount.toString()}, QueryId: ${queryId}`
    );
    mintEvent = { contract: contractAddr, to, amount, queryId };
  } else {
    console.log('Transaction mined but TokensMinted event not found in logs');
  }

  console.log('Minting completed!');

  return { txHash, receipt, mintEvent };
}

// Polling interval in milliseconds (adjust as needed)
export const POLLING_INTERVAL_MS = 5000;
// Backoff delay when polling encounters an error
export const ERROR_BACKOFF_MS = 10000;
// Maximum number of processed transactions to track before clearing
export const MAX_PROCESSED_TXS = 1000;

// Helper function to poll for events using queryFilter (avoids filter expiration issues)
export async function pollEvents(
  contract: Contract,
  eventName: string,
  fromBlock: number,
  handler: (event: EventLog) => Promise<void> | void
): Promise<number> {
  try {
    const currentBlock = await contract.runner?.provider?.getBlockNumber();
    if (!currentBlock || currentBlock < fromBlock) {
      return fromBlock;
    }

    const events = await contract.queryFilter(eventName, fromBlock, currentBlock);
    for (const event of events) {
      if (event instanceof EventLog) {
        await handler(event);
      }
    }

    // Return next block to query from
    return currentBlock + 1;
  } catch (error: any) {
    console.error(`Error polling ${eventName} events:`, error.shortMessage);
    // Add backoff delay on error to avoid hammering the RPC
    await new Promise((resolve) => setTimeout(resolve, ERROR_BACKOFF_MS));
    return fromBlock; // Retry from same block on error
  }
}

export function isValidPrivateKey(key: string | undefined): boolean {
  return !!key && key.startsWith('0x') && key.length === 66;
}

export function isValidContractAddress(address: string | undefined): boolean {
  return !!address && address.startsWith('0x') && address.length === 42;
}

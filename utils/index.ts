import { Contract, JsonRpcApiProvider } from 'ethers';

import {
  api,
  chainInfo,
  ContinuityResponse,
  ProofGenerationResult,
} from '@gluwa/cc-next-query-builder';

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
): Promise<ProofGenerationResult> {
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
  console.log(
    `Latest attested height for chain key ${chainKey}: ${latestAttested.height}`
  );

  // We wait for at most 5 minutes for the attestation to be available
  await info.waitUntilHeightAttested(chainKey, blockNumber, 5_000, 300_000);

  console.log(`Block ${blockNumber} attested! Generating proof...`);

  // We can now proceed to generate the proof using the prover API
  const proofGenerator = new api.ProverAPIProofGenerator(
    chainKey,
    proofServerUrl
  );

  try {
    const proof = await proofGenerator.generateProof(txHash);
    console.log('Proof generation successful!');
    return proof;
  } catch (error) {
    console.error('Error during proof generation: ', error);
    throw error;
  }
}

/**
 * Submits the proof to the USC minter contract.
 * @param contract A minter contract instance, must have the mintFromQuery method with the correct signature.
 * @param proofData A proof data object obtained from the proof generation process.
 * @returns A promise that resolves to the transaction response of the mintFromQuery call.
 */
export async function submitProof(
  contract: Contract,
  proofData: ContinuityResponse
): Promise<any> {
  const chainKey = proofData.chainKey;
  const height = proofData.headerNumber;
  const encodedTransaction = proofData.txBytes;
  const merkleRoot = proofData.merkleProof.root;
  const siblings = proofData.merkleProof.siblings;
  const lowerEndpointDigest = proofData.continuityProof.lowerEndpointDigest;
  const continuityRoots = proofData.continuityProof.roots;

  return await contract.mintFromQuery(
    chainKey,
    height,
    encodedTransaction,
    merkleRoot,
    siblings,
    lowerEndpointDigest,
    continuityRoots
  );
}

/**
 * Submits the proof to the USC minter contract and awaits the TokensMinted event.
 * @param contract A minter contract instance, must have the mintFromQuery method with the correct signature.
 * @param proofData A proof data object obtained from the proof generation process.
 */
export async function submitProofAndAwait(
  contract: Contract,
  proofData: ContinuityResponse
) {
  let eventTriggered = false;

  // Prepare to listen to the TokensMinted event
  contract.on('TokensMinted', (contract, to, amount, queryId) => {
    console.log(
      `Tokens minted! Contract: ${contract}, To: ${to}, Amount: ${amount.toString()}, QueryId: ${queryId}`
    );

    eventTriggered = true;
  });

  // Submit proof to the minter contract
  try {
    const response = await submitProof(contract, proofData);
    console.log('Proof submitted: ', response.hash);
  } catch (error) {
    console.error('Error submitting proof: ', error);

    process.exit(1);
  }

  // Wait for the TokensMinted event
  while (!eventTriggered) {
    console.log('Waiting for TokensMinted event...');
    await new Promise((resolve) => setTimeout(resolve, 5000)); // Wait for 5 seconds
  }

  console.log('Minting completed!');

  return;
}

import dotenv from 'dotenv';
import { ethers, WebSocketProvider, JsonRpcApiProvider } from "ethers";
import type { TransactionReceipt, TransactionResponse } from "ethers";
import fs from "fs";
import { abiEncode } from "@gluwa/usc-sdk/dist/encoding/abi";

dotenv.config({ override: true });

const WSS_URL = process.env.WSS_URL!;
const TARGET_TXS = Number(process.env.TARGET_TXS ?? 500_000);
const TOP_PERCENT = Number(process.env.TOP_PERCENT ?? 0.01);
const TX_REQUESTS_PER_SECOND = Number(process.env.TX_REQUESTS_PER_SECOND ?? 20);

const OUT_JSON = process.env.OUT_JSON ?? "decode-testing/top_abi_size_transactions.json";
const OUT_CSV = process.env.OUT_CSV ?? "decode-testing/top_abi_size_transactions.csv";
const MARKER_FILE = process.env.MARKER_FILE ?? "decode-testing/scan_restart_marker.json";

if (!WSS_URL) throw new Error("Set WSS_URL");

const provider = new ethers.WebSocketProvider(WSS_URL);

type Result = {
  hash: string;
  blockNumber: number;
  txIndex: number;
  txType: number;
  combinedAbiBytes: number;
  calldataBytes: number;
  logCount: number;
  totalLogDataBytes: number;
  totalTopics: number;
  gasUsed: string;
};

type Marker = {
  latestBlockAtStart: number;
  nextBlockNumber: number;
  scannedTxs: number;
  targetTxs: number;
  topPercent: number;
  updatedAt: string;
};

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function hexBytes(hex?: string | null): number {
  if (!hex || hex === "0x") return 0;
  return (hex.length - 2) / 2;
}

function toCsv(rows: Result[]): string {
  const header = [
    "rank",
    "hash",
    "blockNumber",
    "txIndex",
    "txType",
    "combinedAbiBytes",
    "calldataBytes",
    "logCount",
    "totalLogDataBytes",
    "totalTopics",
    "gasUsed",
  ];

  const lines = rows.map((r, i) =>
    [
      i + 1,
      r.hash,
      r.blockNumber,
      r.txIndex,
      r.txType,
      r.combinedAbiBytes,
      r.calldataBytes,
      r.logCount,
      r.totalLogDataBytes,
      r.totalTopics,
      r.gasUsed,
    ].join(","),
  );

  return [header.join(","), ...lines].join("\n");
}

function saveResults(top: Result[]) {
  fs.writeFileSync(OUT_JSON, JSON.stringify(top, null, 2));
  fs.writeFileSync(OUT_CSV, toCsv(top));
}

function saveMarker(marker: Marker) {
  fs.writeFileSync(MARKER_FILE, JSON.stringify(marker, null, 2));
}

function loadMarker(): Marker | null {
  if (!fs.existsSync(MARKER_FILE)) return null;
  return JSON.parse(fs.readFileSync(MARKER_FILE, "utf8"));
}

function loadExistingTop(): Result[] {
  if (!fs.existsSync(OUT_JSON)) return [];
  return JSON.parse(fs.readFileSync(OUT_JSON, "utf8"));
}

async function fetchReceiptsRateLimited(
  txs: ethers.TransactionResponse[],
): Promise<Array<ethers.TransactionReceipt | null>> {
  const receipts: Array<ethers.TransactionReceipt | null> = [];

  for (let i = 0; i < txs.length; i += TX_REQUESTS_PER_SECOND) {
    const batch = txs.slice(i, i + TX_REQUESTS_PER_SECOND);

    const batchReceipts = await Promise.all(
      batch.map(async (tx) => {
        try {
          return await provider.getTransactionReceipt(tx.hash);
        } catch (e) {
          console.warn(`Failed receipt ${tx.hash}:`, e);
          return null;
        }
      }),
    );

    receipts.push(...batchReceipts);

    if (i + TX_REQUESTS_PER_SECOND < txs.length) {
      await sleep(1000);
    }
  }

  return receipts;
}

async function processBlock(blockNumber: number): Promise<Result[]> {
  const block = await provider.getBlock(blockNumber, true);
  if (!block) return [];

  const txs = block.prefetchedTransactions;
  const receipts = await fetchReceiptsRateLimited(txs);

  const out: Result[] = [];

  for (let i = 0; i < txs.length; i++) {
    const tx = txs[i];
    const receipt = receipts[i];
    if (!receipt) continue;

    const encodedAbi = await encodeTransaction(provider, tx.hash, receipt);
    const combinedAbiBytes = hexBytes(encodedAbi);

    out.push({
      hash: tx.hash,
      blockNumber,
      txIndex: tx.index,
      txType: tx.type ?? 0,
      combinedAbiBytes: combinedAbiBytes,
      calldataBytes: hexBytes(tx.data),
      logCount: receipt.logs.length,
      totalLogDataBytes: receipt.logs.reduce((sum, l) => sum + hexBytes(l.data), 0),
      totalTopics: receipt.logs.reduce((sum, l) => sum + l.topics.length, 0),
      gasUsed: receipt.gasUsed.toString(),
    });
  }

  return out;
}

async function main() {
  const latest = await provider.getBlockNumber();
  const keepCount = Math.ceil(TARGET_TXS * (TOP_PERCENT / 100));

  const marker = loadMarker();

  let scannedTxs = marker?.scannedTxs ?? 0;
  let blockNumber = marker?.nextBlockNumber ?? latest;
  let top: Result[] = loadExistingTop();

  top.sort((a, b) => b.combinedAbiBytes - a.combinedAbiBytes);
  if (top.length > keepCount) top.length = keepCount;

  console.log(`Latest block now: ${latest}`);
  console.log(`Starting from block: ${blockNumber}`);
  console.log(`Already scanned: ${scannedTxs.toLocaleString()} txs`);
  console.log(`Target: ${TARGET_TXS.toLocaleString()} txs`);
  console.log(`Keeping top ${keepCount.toLocaleString()} rows`);
  console.log(`Receipt request rate: ${TX_REQUESTS_PER_SECOND}/sec`);

  process.on("SIGINT", () => {
    console.log("\nCaught SIGINT. Saving progress...");
    saveResults(top);
    saveMarker({
      latestBlockAtStart: marker?.latestBlockAtStart ?? latest,
      nextBlockNumber: blockNumber,
      scannedTxs,
      targetTxs: TARGET_TXS,
      topPercent: TOP_PERCENT,
      updatedAt: new Date().toISOString(),
    });
    process.exit(0);
  });

  while (scannedTxs < TARGET_TXS && blockNumber >= 0) {
    try {
      const rows = await processBlock(blockNumber);

      scannedTxs += rows.length;
      top.push(...rows);

      top.sort((a, b) => b.combinedAbiBytes - a.combinedAbiBytes);
      if (top.length > keepCount) top.length = keepCount;

      blockNumber -= 1;

      saveResults(top);
      saveMarker({
        latestBlockAtStart: marker?.latestBlockAtStart ?? latest,
        nextBlockNumber: blockNumber,
        scannedTxs,
        targetTxs: TARGET_TXS,
        topPercent: TOP_PERCENT,
        updatedAt: new Date().toISOString(),
      });

      const cutoff = top.length > 0 ? top[top.length - 1].combinedAbiBytes : 0;

      console.log(
        `block=${blockNumber + 1}, scanned=${scannedTxs.toLocaleString()}, top_cutoff=${cutoff} bytes`,
      );
    } catch (e) {
      console.error(`Error at block ${blockNumber}. Saving progress...`, e);

      saveResults(top);
      saveMarker({
        latestBlockAtStart: marker?.latestBlockAtStart ?? latest,
        nextBlockNumber: blockNumber,
        scannedTxs,
        targetTxs: TARGET_TXS,
        topPercent: TOP_PERCENT,
        updatedAt: new Date().toISOString(),
      });

      process.exit(1);
    }
  }

  saveResults(top);
  saveMarker({
    latestBlockAtStart: marker?.latestBlockAtStart ?? latest,
    nextBlockNumber: blockNumber,
    scannedTxs,
    targetTxs: TARGET_TXS,
    topPercent: TOP_PERCENT,
    updatedAt: new Date().toISOString(),
  });

  console.log(`Done. Scanned ${scannedTxs.toLocaleString()} transactions.`);
  console.log(`Wrote ${OUT_JSON}`);
  console.log(`Wrote ${OUT_CSV}`);
  console.log(`Wrote ${MARKER_FILE}`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});


///// FROM USC-SDK

// cost 80 or 160 credits depnding on arguments
async function encodeTransaction(
  provider: WebSocketProvider,
  txHash: string,
  receipt: TransactionReceipt | null,
): Promise<string> {
  // 80 credits
  const transaction = await getTransactionWithRaw(provider, txHash);

  if (receipt === null) {
    // 80 credits
    receipt = await provider.getTransactionReceipt(txHash);
  }
  const encodedData = abiEncode(transaction!, receipt!);
  return encodedData.abi;
}

export interface EncodedFields {
  types: string[];
  values: any[] | any[][];
}

// THE CODE BELOW IS USED AS A TEMPORARY FIX FOR RAW YPARITY IN TRANSACTIONS
// IT SHOULD BE REMOVED ONCE ETHERS HAS NATIVE SUPPORT FOR FETCHING RAW YPARITY ON
// TRANSACTION RESPONSES
export interface RawAuthorization {
  yParity: number;
}

export class RawTransactionResponse {
  readonly authorizationList!: null | Array<RawAuthorization>;

  constructor(authorizationList: null | Array<RawAuthorization>) {
    this.authorizationList = authorizationList;
  }
}

export class TransactionWithRaw {
  readonly formatted!: TransactionResponse;
  readonly raw!: RawTransactionResponse;

  constructor(formatted: TransactionResponse, raw: RawTransactionResponse) {
    this.formatted = formatted;
    this.raw = raw;
  }
}

/**
 * Used to extract from the raw transaction JSON the raw yparity values
 * for the authorization list. In case they exists.
 *
 * Wraps the formatted TransactionResponse along with the raw data.
 *
 * @param provider - JsonRpcApiProvider instance
 * @param txHash - Transaction hash
 * @returns TransactionWithRaw or null if not found
 */
export async function getTransactionWithRaw(
  provider: JsonRpcApiProvider,
  txHash: string,
): Promise<TransactionWithRaw | null> {
  let json: any;
  try {
    json = await provider.send('eth_getTransactionByHash', [txHash]);
  } catch (e) {
    console.error(`Error fetching transaction ${txHash}: ${(e as Error).message}`);
    return null;
  }

  if (!json) {
    return null;
  }

  const formattedTx = provider._wrapTransactionResponse(json, await provider.getNetwork());
  // We map the raw yParity values from the JSON response
  // to a numeric value in RawAuthorization array
  const rawAuthorizationList =
    json.authorizationList?.map((auth: any) => ({
      yParity: Number(auth.yParity),
    })) || null;
  const rawTx = new RawTransactionResponse(rawAuthorizationList);

  return new TransactionWithRaw(formattedTx, rawTx);
}

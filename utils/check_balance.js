const { ethers } = require('ethers');

require('dotenv').config({ override: true });

// === Check for arguments ===
if (process.argv.length < 4 || process.argv.length > 5) {
  console.error(`
Usage:
  yarn utils:check_balance <contract_address> <target_address> [RPC_URL]

Example:
  yarn utils:check_balance 0x123...abc 0x456...def http://localhost:8545
`);
  process.exit(1);
}

const CONTRACT_ADDRESS = process.argv[2];
const TARGET_ADDRESS = process.argv[3];

// === RPC URL Setup ===
let RPC_URL;
if (process.argv.length === 5) {
  RPC_URL = process.argv[4];
} else {
  RPC_URL = process.env.CREDITCOIN_RPC_URL;
}

// === ERC20 ABI ===
const ERC20_ABI = [
  'function balanceOf(address account) view returns (uint256)',
  'function decimals() view returns (uint8)',
  'function name() view returns (string)',
  'function symbol() view returns (string)',
];

async function checkBalance() {
  const provider = new ethers.JsonRpcProvider(RPC_URL);
  const contract = new ethers.Contract(CONTRACT_ADDRESS, ERC20_ABI, provider);

  try {
    const [rawBalance, decimals, name, symbol] = await Promise.all([
      contract.balanceOf(TARGET_ADDRESS),
      contract.decimals(),
      contract.name().catch(() => 'Unknown'),
      contract.symbol().catch(() => 'UNKNOWN'),
    ]);

    const humanReadable = ethers.formatUnits(rawBalance, decimals);

    console.log(`📦 Token: ${name} (${symbol})`);
    console.log(`🧾 Raw Balance: ${rawBalance.toString()}`);
    console.log(`💰 Formatted Balance: ${humanReadable} ${symbol}`);
    console.log(`Decimals for token micro unit: ${decimals}`);
  } catch (err) {
    console.error('❌ Failed to fetch balance:', err);
  }
}

checkBalance();

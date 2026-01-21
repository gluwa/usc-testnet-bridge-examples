import dotenv from 'dotenv';
import { Contract, ethers, EthersError, InterfaceAbi } from 'ethers';

import loanHelperAbi from '../contracts/abi/AuxiliaryLoanContract.json';
import { isValidContractAddress, isValidPrivateKey } from '../utils';

dotenv.config({ override: true });

const main = async () => {
  const args = process.argv.slice(2);

  if (args.length !== 1) {
    console.error(`
  Usage:
    yarn loan_flow:authorize_token <TokenAddress>

  Example:
    yarn loan_flow:authorize_token 0x5FbDB2315678afecb367f032d93F642f64180aa3
  `);
    process.exit(1);
  }

  const [tokenAddress] = args;

  if (!isValidContractAddress(tokenAddress)) {
    throw new Error('Invalid Token Address provided');
  }

  // Environment Variables
  const sourceChainRpcUrl = process.env.SOURCE_CHAIN_RPC_URL;
  const ccNextWalletPrivateKey = process.env.CREDITCOIN_WALLET_PRIVATE_KEY;
  const sourceChainLoanContractAddress = process.env.SOURCE_CHAIN_LOAN_CONTRACT_ADDRESS;

  if (!sourceChainRpcUrl) {
    throw new Error('SOURCE_CHAIN_RPC_URL environment variable is not configured or invalid');
  }

  if (!isValidPrivateKey(ccNextWalletPrivateKey)) {
    throw new Error('CREDITCOIN_WALLET_PRIVATE_KEY environment variable is not configured or invalid');
  }

  if (!isValidContractAddress(sourceChainLoanContractAddress)) {
    throw new Error('SOURCE_CHAIN_LOAN_CONTRACT_ADDRESS environment variable is not configured or invalid');
  }

  // 1. Connect to source chain loan contract
  const sourceChainProvider = new ethers.JsonRpcProvider(sourceChainRpcUrl);
  const sourceChainWallet = new ethers.Wallet(ccNextWalletPrivateKey!, sourceChainProvider);
  const sourceChainLoanContract = new Contract(
    sourceChainLoanContractAddress!,
    loanHelperAbi as unknown as InterfaceAbi,
    sourceChainWallet
  );

  // 2. Authorize the token to be used in loans
  try {
    const tx = await sourceChainLoanContract.addAuthorizedToken(tokenAddress);
    console.log('Token authorized with transaction hash: ', tx.hash);
  } catch (error: EthersError | any) {
    console.error('Error authorizing token: ', error.shortMessage);
    process.exit(1);
  }

  process.exit(0);
};

main().catch(console.error);

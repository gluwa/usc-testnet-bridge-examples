import dotenv from 'dotenv';
import { Contract, ethers, EthersError, InterfaceAbi } from 'ethers';

import loanHelperAbi from '../contracts/abi/AuxiliaryLoanContract.json';
import ERC20Abi from '../contracts/abi/TestERC20Abi.json';
import { isValidContractAddress, isValidPrivateKey } from '../utils';

dotenv.config({ override: true });

const main = async () => {
  const args = process.argv.slice(2);

  if (args.length !== 2) {
    console.error(`
  Usage:
    yarn loan_flow:fund_loan <LoanId> <Amount>

  Example:
    yarn loan_flow:fund_loan 7 200
  `);
    process.exit(1);
  }

  const [loanIdArg, amountArg] = args;

  const loanId = Number(loanIdArg);
  const loanAmount = Number(amountArg);

  if (isNaN(loanId) || loanId < 0) {
    throw new Error('Invalid Loan ID provided');
  }

  if (isNaN(loanAmount) || loanAmount <= 0) {
    throw new Error('Invalid Loan Amount provided');
  }

  // Environment Variables
  const sourceChainRpcUrl = process.env.SOURCE_CHAIN_RPC_URL;

  const ccNextWalletPrivateKey = process.env.CREDITCOIN_WALLET_PRIVATE_KEY;

  const lenderPrivateKey = process.env.LENDER_WALLET_PRIVATE_KEY;
  const borrowerPrivateKey = process.env.BORROWER_WALLET_PRIVATE_KEY;

  const sourceChainLoanContractAddress = process.env.SOURCE_CHAIN_LOAN_CONTRACT_ADDRESS;
  const sourceChainERC20ContractAddress = process.env.SOURCE_CHAIN_ERC20_CONTRACT_ADDRESS;

  if (!sourceChainRpcUrl) {
    throw new Error('SOURCE_CHAIN_RPC_URL environment variable is not configured or invalid');
  }

  if (!isValidPrivateKey(ccNextWalletPrivateKey)) {
    throw new Error('CREDITCOIN_WALLET_PRIVATE_KEY environment variable is not configured or invalid');
  }
  if (!isValidPrivateKey(lenderPrivateKey)) {
    throw new Error('LENDER_WALLET_PRIVATE_KEY environment variable is not configured or invalid');
  }
  if (!isValidPrivateKey(borrowerPrivateKey)) {
    throw new Error('BORROWER_WALLET_PRIVATE_KEY environment variable is not configured or invalid');
  }

  if (!isValidContractAddress(sourceChainLoanContractAddress)) {
    throw new Error('SOURCE_CHAIN_LOAN_CONTRACT_ADDRESS environment variable is not configured or invalid');
  }
  if (!isValidContractAddress(sourceChainERC20ContractAddress)) {
    throw new Error('SOURCE_CHAIN_ERC20_CONTRACT_ADDRESS environment variable is not configured or invalid');
  }

  // 1. Connect to source chain loan contract and ERC20 contract
  const sourceChainProvider = new ethers.JsonRpcProvider(sourceChainRpcUrl);
  const sourceChainWallet = new ethers.Wallet(ccNextWalletPrivateKey!, sourceChainProvider);
  const sourceChainLoanContract = new Contract(
    sourceChainLoanContractAddress!,
    loanHelperAbi as unknown as InterfaceAbi,
    sourceChainWallet
  );
  const lenderWallet = new ethers.Wallet(lenderPrivateKey!, sourceChainProvider);
  const borrowerWallet = new ethers.Wallet(borrowerPrivateKey!, sourceChainProvider);
  const sourceChainERC20Contract = new Contract(
    sourceChainERC20ContractAddress!,
    ERC20Abi as unknown as InterfaceAbi,
    lenderWallet
  );

  // 2. Approve the loan contract to transfer lender's tokens
  try {
    const approved: bigint = await sourceChainERC20Contract.allowance(
      lenderWallet.address,
      sourceChainLoanContractAddress
    );

    if (approved < BigInt(loanAmount)) {
      console.log(
        `Source chain loan contract allowance (${approved}) is less than loan amount ${loanAmount}, requesting extra allowance from lender...`
      );

      const approveTx = await sourceChainERC20Contract.approve(sourceChainLoanContractAddress, loanAmount);
      console.log('Allowance granted: ', approveTx.hash);

      // wait for 15 seconds to ensure approval is mined
      await new Promise((resolve) => setTimeout(resolve, 15000));
    }
  } catch (error: EthersError | any) {
    console.error('Error requesting allowance: ', error.shortMessage);
    process.exit(1);
  }

  // 3. Fund the loan
  try {
    const tx = await sourceChainLoanContract.fundLoan(
      loanId,
      loanAmount,
      lenderWallet.address,
      borrowerWallet.address,
      sourceChainERC20ContractAddress
    );
    console.log('Loan funded: ', tx.hash);
  } catch (error: EthersError | any) {
    console.error('Error funding loan: ', error.shortMessage);
    process.exit(1);
  }

  process.exit(0);
};

main().catch(console.error);

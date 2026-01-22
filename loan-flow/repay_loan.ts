import dotenv from 'dotenv';
import { Contract, ethers, InterfaceAbi, EthersError } from 'ethers';

import loanHelperAbi from '../contracts/abi/AuxiliaryLoanContract.json';
import ERC20Abi from '../contracts/abi/TestERC20Abi.json';
import { isValidContractAddress, isValidPrivateKey } from '../utils';

dotenv.config({ override: true });

const main = async () => {
  const args = process.argv.slice(2);

  if (args.length !== 2) {
    console.error(`
  Usage:
    yarn loan_flow:repay_loan <LoanId> <Amount>

  Example:
    yarn loan_flow:repay_loan 7 200
  `);
    process.exit(1);
  }

  const [loanIdArg, amountArg] = args;

  const loanId = Number(loanIdArg);
  const repayAmount = Number(amountArg);

  if (isNaN(loanId) || loanId < 0) {
    throw new Error('Invalid Loan ID provided');
  }

  if (isNaN(repayAmount) || repayAmount <= 0) {
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
  const borrowerWallet = new ethers.Wallet(borrowerPrivateKey!, sourceChainProvider);
  const sourceChainLoanContract = new Contract(
    sourceChainLoanContractAddress!,
    loanHelperAbi as unknown as InterfaceAbi,
    borrowerWallet
  );
  const lenderWallet = new ethers.Wallet(lenderPrivateKey!, sourceChainProvider);
  const sourceChainERC20Contract = new Contract(
    sourceChainERC20ContractAddress!,
    ERC20Abi as unknown as InterfaceAbi,
    borrowerWallet
  );

  // 2. Approve the loan contract to transfer borrower's tokens
  try {
    const approved: bigint = await sourceChainERC20Contract.allowance(
      borrowerWallet.address,
      sourceChainLoanContractAddress
    );

    if (approved < BigInt(repayAmount)) {
      const allowanceAmount = BigInt(repayAmount) - approved;
      console.log(
        `Source chain loan contract allowance (${approved}) is less than repayment amount ${repayAmount}, requesting extra allowance from borrower...`
      );
      const approveTx = await sourceChainERC20Contract.approve(sourceChainLoanContractAddress, allowanceAmount);
      console.log('Allowance granted: ', approveTx.hash);

      // wait for 15 seconds to ensure approval is mined
      console.log('Waiting 15 seconds for approval to be mined...');
      await new Promise((resolve) => setTimeout(resolve, 15000));
    }
  } catch (error: EthersError | any) {
    console.error('Error requesting allowance: ', error.shortMessage);
    process.exit(1);
  }

  // 3. Repay the loan
  try {
    const tx = await sourceChainLoanContract.repayLoan(
      loanId,
      repayAmount,
      borrowerWallet.address,
      lenderWallet.address,
      sourceChainERC20ContractAddress
    );
    console.log('Loan repaid: ', tx.hash);
  } catch (error: EthersError | any) {
    console.error('Error repaying loan: ', error.shortMessage);
    process.exit(1);
  }

  process.exit(0);
};

main().catch(console.error);

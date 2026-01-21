import dotenv from 'dotenv';
import { Contract, ethers, EthersError, InterfaceAbi } from 'ethers';

import loanManagerAbi from '../contracts/abi/USCLoanManager.json';
import { isValidContractAddress, isValidPrivateKey } from '../utils';

dotenv.config({ override: true });

const main = async () => {
  const args = process.argv.slice(2);

  if (args.length !== 3) {
    console.error(`
  Usage:
    yarn loan_flow:register_loan <LoanAmount> <IntereseBasisPoints> <DurationInBlocks>

  Example:
    yarn loan_flow:register_loan 1000 500 5000
  `);
    process.exit(1);
  }

  const [loanAmountArg, interestBasisPointsArg, durationInBlocksArg] = args;

  const loanAmount = Number(loanAmountArg);
  const interestBasisPoints = Number(interestBasisPointsArg);
  const durationInBlocks = Number(durationInBlocksArg);

  if (isNaN(loanAmount) || loanAmount <= 0) {
    throw new Error('Invalid Loan Amount provided');
  }

  if (isNaN(interestBasisPoints) || interestBasisPoints <= 0) {
    throw new Error('Invalid Interest Basis Points provided');
  }

  if (isNaN(durationInBlocks) || durationInBlocks < 100) {
    throw new Error('Invalid Deadline Block Number provided, minimum duration is 100 blocks!');
  }

  // Environment Variables
  const loanManagerContractAddress = process.env.USC_LOAN_MANAGER_CONTRACT_ADDRESS;
  const sourceChainERC20ContractAddress = process.env.SOURCE_CHAIN_ERC20_CONTRACT_ADDRESS;
  const lenderKey = process.env.LENDER_WALLET_PRIVATE_KEY;
  const borrowerKey = process.env.BORROWER_WALLET_PRIVATE_KEY;
  const ccNextRpcUrl = process.env.CREDITCOIN_RPC_URL;
  const ccNextWalletPrivateKey = process.env.CREDITCOIN_WALLET_PRIVATE_KEY;

  if (!ccNextRpcUrl) {
    throw new Error('CREDITCOIN_RPC_URL environment variable is not configured or invalid');
  }

  if (!isValidContractAddress(loanManagerContractAddress)) {
    throw new Error('USC_LOAN_MANAGER_CONTRACT_ADDRESS environment variable is not configured or invalid');
  }
  if (!isValidContractAddress(sourceChainERC20ContractAddress)) {
    throw new Error('SOURCE_CHAIN_ERC20_CONTRACT_ADDRESS environment variable is not configured or invalid');
  }

  if (!isValidPrivateKey(ccNextWalletPrivateKey)) {
    throw new Error('CREDITCOIN_WALLET_PRIVATE_KEY environment variable is not configured or invalid');
  }
  if (!isValidPrivateKey(lenderKey)) {
    throw new Error('LENDER_WALLET_PRIVATE_KEY environment variable is not configured or invalid');
  }
  if (!isValidPrivateKey(borrowerKey)) {
    throw new Error('BORROWER_WALLET_PRIVATE_KEY environment variable is not configured or invalid');
  }

  // 1. Connect to loan manager contract on creditcoin chain
  const ccProvider = new ethers.JsonRpcProvider(ccNextRpcUrl);
  const wallet = new ethers.Wallet(ccNextWalletPrivateKey!, ccProvider);
  const managerContract = new Contract(loanManagerContractAddress!, loanManagerAbi as unknown as InterfaceAbi, wallet);

  // 2. Build loan registration payload
  const lenderWallet = new ethers.Wallet(lenderKey!, ccProvider);
  const borrowerWallet = new ethers.Wallet(borrowerKey!, ccProvider);
  const fundFlow = {
    from: lenderWallet.address,
    to: borrowerWallet.address,
    withToken: sourceChainERC20ContractAddress,
  };

  const repayFlow = {
    from: borrowerWallet.address,
    to: lenderWallet.address,
    withToken: sourceChainERC20ContractAddress,
  };

  const loanTerm = {
    loanAmount: loanAmount,
    interestRate: interestBasisPoints,
    expectedRepaymentAmount: Math.floor(loanAmount + (loanAmount * interestBasisPoints) / 10000),
    deadlineBlockNumber: (await ccProvider.getBlockNumber()) + durationInBlocks,
  };

  console.log('Registering loan with the following terms:');
  console.log(`  Fund Flow: ${JSON.stringify(fundFlow, null, 2)}`);
  console.log(`  Repay Flow: ${JSON.stringify(repayFlow, null, 2)}`);
  console.log(`  Loan Terms: ${JSON.stringify(loanTerm, null, 2)}`);

  const payloadTypes = [
    'address', // fundFlow.from
    'address', // fundFlow.to
    'address', // fundFlow.withToken
    'address', // repayFlow.from
    'address', // repayFlow.to
    'address', // repayFlow.withToken
    'uint256', // loanTerms.loanAmount
    'uint256', // loanTerms.interestRate
    'uint256', // loanTerms.expectedRepaymentAmount
    'uint256', // loanTerms.deadlineBlockNumber
  ];

  const payload = [
    fundFlow.from,
    fundFlow.to,
    fundFlow.withToken,
    repayFlow.from,
    repayFlow.to,
    repayFlow.withToken,
    loanTerm.loanAmount,
    loanTerm.interestRate,
    loanTerm.expectedRepaymentAmount,
    loanTerm.deadlineBlockNumber,
  ];

  // 3. Sign payload by both lender and borrower
  const payloadToSign = ethers.solidityPackedKeccak256(payloadTypes, payload);

  const lenderSignature = await lenderWallet.signMessage(ethers.toBeArray(payloadToSign));
  const borrowerSignature = await borrowerWallet.signMessage(ethers.toBeArray(payloadToSign));

  let loanRegistered = false;

  // 4. Listed to LoanRegistered events
  managerContract.on('LoanRegistered', (loanId: number) => {
    console.log(`Loan successfully registered with ID: ${loanId.toString()}`);
    loanRegistered = true;
  });

  // 5. Register the loan
  try {
    const tx = await managerContract.registerLoan(fundFlow, repayFlow, loanTerm, lenderSignature, borrowerSignature);
    console.log('Loan registered with transaction hash: ', tx.hash);
  } catch (error: EthersError | any) {
    console.error('Error registering loan: ', error.shortMessage);
    process.exit(1);
  }

  // 6. Wait for the LoanRegistered event
  while (!loanRegistered) {
    await new Promise((resolve) => setTimeout(resolve, 1000));
  }

  process.exit(0);
};

main().catch(console.error);

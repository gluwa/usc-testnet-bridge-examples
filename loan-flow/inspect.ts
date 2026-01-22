import dotenv from 'dotenv';
import { Contract, ethers, InterfaceAbi } from 'ethers';

import loanManagerAbi from '../contracts/abi/USCLoanManager.json';
import { isValidContractAddress } from '../utils';

dotenv.config({ override: true });

interface LoanFlow {
  from: string;
  to: string;
  withToken: string;
}

enum LoanStatus {
  Created,
  Funded,
  PartlyRepaid,
  Repaid,
  Expired,
}

interface LoanTerms {
  loanAmount: bigint;
  interestRate: bigint; // in basis points (e.g., 500 = 5%)
  expectedRepaymentAmount: bigint;
  deadlineBlockNumber: bigint;
}

interface LoanOrder {
  fundFlow: LoanFlow;
  repayFlow: LoanFlow;
  terms: LoanTerms;
  signatureOfLender: string;
  signatureOfBorrower: string;
  createdAtBlock: bigint;
  status: LoanStatus;
  repaidAmount: bigint;
}

function parseLoanOrder(loanOrderRaw: any): LoanOrder {
  return {
    fundFlow: {
      from: loanOrderRaw[0][0],
      to: loanOrderRaw[0][1],
      withToken: loanOrderRaw[0][2],
    },
    repayFlow: {
      from: loanOrderRaw[1][0],
      to: loanOrderRaw[1][1],
      withToken: loanOrderRaw[1][2],
    },
    terms: {
      loanAmount: BigInt(loanOrderRaw[2][0]),
      interestRate: BigInt(loanOrderRaw[2][1]),
      expectedRepaymentAmount: BigInt(loanOrderRaw[2][2]),
      deadlineBlockNumber: BigInt(loanOrderRaw[2][3]),
    },
    signatureOfLender: loanOrderRaw[3],
    signatureOfBorrower: loanOrderRaw[4],
    createdAtBlock: BigInt(loanOrderRaw[5]),
    status: loanOrderRaw[6],
    repaidAmount: BigInt(loanOrderRaw[7]),
  };
}

const main = async () => {
  const args = process.argv.slice(2);

  if (args.length !== 1) {
    console.error(`
  Usage:
    yarn loan_flow:inspect_loan <LoanId>

  Example:
    yarn loan_flow:inspect_loan 7
  `);
    process.exit(1);
  }

  const [loanIdArg] = args;

  const loanId = Number(loanIdArg);

  if (isNaN(loanId) || loanId < 0) {
    throw new Error('Invalid Loan ID provided');
  }

  // Environment Variables
  const ccNextRpcUrl = process.env.CREDITCOIN_RPC_URL;
  const loanManagerContractAddress = process.env.USC_LOAN_MANAGER_CONTRACT_ADDRESS;

  if (!ccNextRpcUrl) {
    throw new Error('CREDITCOIN_RPC_URL environment variable is not configured or invalid');
  }

  if (!isValidContractAddress(loanManagerContractAddress)) {
    throw new Error('USC_LOAN_MANAGER_CONTRACT_ADDRESS environment variable is not configured or invalid');
  }

  // 1. Connect to Creditcoin chain loan manager contract
  const ccNextProvider = new ethers.JsonRpcProvider(ccNextRpcUrl);
  const loanManagerContract = new Contract(
    loanManagerContractAddress!,
    loanManagerAbi as unknown as InterfaceAbi,
    ccNextProvider
  );

  // 2. Check loan details for the given loan ID
  try {
    const currentBlockNumber = BigInt(await ccNextProvider.getBlockNumber());

    const loanDetails = await loanManagerContract.getLoanOrder(loanId);
    const parsedDetails = parseLoanOrder(loanDetails);
    const blockDeadline = parsedDetails.terms.deadlineBlockNumber;
    const blocksUntilDeadline = blockDeadline > currentBlockNumber ? blockDeadline - currentBlockNumber : BigInt(0);

    console.log('Loan Details: ');

    console.log(` Loan ID: ${loanId}`);
    console.log(` From: ${parsedDetails.fundFlow.from}`);
    console.log(` To: ${parsedDetails.fundFlow.to}`);
    console.log(` With Token: ${parsedDetails.fundFlow.withToken}`);
    console.log(` Loan Amount: ${parsedDetails.terms.loanAmount}`);
    console.log(` Interest Rate (basis points): ${parsedDetails.terms.interestRate}`);
    console.log(` Expected Repayment Amount: ${parsedDetails.terms.expectedRepaymentAmount}`);
    console.log(` Deadline Block Number: ${blockDeadline}`);
    console.log(` Status: ${LoanStatus[parsedDetails.status]}`);
    console.log(` Repaid Amount: ${parsedDetails.repaidAmount}`);
    console.log(` Blocks until deadline: ${blocksUntilDeadline}`);
  } catch (error: any) {
    console.error('Error fetching loan details: ', error.shortMessage);
    process.exit(1);
  }

  process.exit(0);
};

main().catch(console.error);

# Loan Flow

> [!TIP]
> This tutorial builds on the previous [Bridge Offchain Worker] example -make sure to check it out
> before moving on!

Now that we know how to build an offchain worker to coordinate between two separate chains, we need
a more advanced example that includes not only communication but also state tracking.

## Loan Flow user story

So, imagine we have two individuals, Alice and Bob who are doing business. Bob needs money for one of his projects
but alas, he doesn't have enough! That's where Alice comes in and says: maybe I can lend you some of mine?

Oh! But is there any way to create such a loan? And not only that, but both Alice and Bob need a way to prove
that the loan progresses correctly from creation to funding to repayment.

Well, they are in luck! Because that's what we are going to do in this example!

## 1. Setup

The setup of this example is a bit more complex than previous ones. So let's go slowly:

## 1.1 Smart contracts

Our system will have three contracts:

- An ERC20 contract deployed on Sepolia, which will be the contract where the lending and borrowing will happen
- A loan manager USC contract deployed on Creditcoin, this will be where loan will be registered and their state updated from the worker
- An auxiliary loan contract deployed on Sepolia, this is where both funding and repayment events are emitted

Make sure to first load your `.env` file with:

```sh
source .env
```

So, first of all we start with deploying our ERC20 contract:

```sh
forge create                \
    --broadcast              \
    --rpc-url $SOURCE_CHAIN_RPC_URL \
    --private-key $CREDITCOIN_WALLET_PRIVATE_KEY \
    contracts/sol/TestERC20.sol:TestERC20
```

This should display some output containing the address of your test `ERC20` contract:

```bash
Deployed to: 0xCf7Ed3AccA5a467e9e704C703E8D87F634fB0Fc9
```

Grab this address and add it to the `.env` file at the root of the repository with the address, like so:

```env
SOURCE_CHAIN_ERC20_CONTRACT_ADDRESS=<erc20_contract_address>
```

Now we need to deploy a `EvmV1Decoder` library so that we can reference it in our
`USCLoanManager`. We do so like this:

```bash
forge create \
  --broadcast \
  --rpc-url $CREDITCOIN_RPC_URL \
  --private-key $CREDITCOIN_WALLET_PRIVATE_KEY \
  contracts/sol/EvmV1Decoder.sol:EvmV1Decoder
```

You should get some output with the address of the library you just deployed:

```bash
Deployed to: 0x73684e10cE6d6E344BfdD4F92a79e0D6Cd931b52
```

Save the address of the contract. You will be needing it for the second half of this step.

Then, we deploy the USC manager contract:

```sh
forge create                \
    --broadcast              \
    --rpc-url $CREDITCOIN_RPC_URL \
    --private-key $CREDITCOIN_WALLET_PRIVATE_KEY \
    --libraries contracts/sol/EvmV1Decoder.sol:EvmV1Decoder:<decoder_library_address> \
    contracts/sol/USCLoanManager.sol:USCLoanManager
```

As before, grab the address and add it to the `.env` file, like so:

```env
USC_LOAN_MANAGER_CONTRACT_ADDRESS=<usc_loan_manager_contract_address>
```

Finally, we deploy the loan helper contract:

```sh
forge create                \
    --broadcast              \
    --rpc-url $SOURCE_CHAIN_RPC_URL \
    --private-key $CREDITCOIN_WALLET_PRIVATE_KEY \
    contracts/sol/AuxiliaryLoanContract.sol:AuxiliaryLoanContract
```

Grab the address again (it gets repetitive huh?) and add it to the `.env` file, like so:

```env
SOURCE_CHAIN_LOAN_CONTRACT_ADDRESS=<loan_helper_contract_address>
```

Now that we have all three contracts we can move on to the actual participants.

## 1.2 Lender and borrower

Our system has both the lender account and the borrower fixed, much like before they are set in the `.env` file.

But of course, you only have one account at this point, you can reuse the account in `CREDITCOIN_WALLET_PRIVATE_KEY` for the
lender, for the borrower you can just create a new one like we did in [Hello Bridge], like so:

```bash
cast wallet new
```

Save the resulting wallet address and private key for future use.

```bash
Address:     0xBE7959cA1b19e159D8C0649860793dDcd125a2D5
Private key: 0xb9c179ed56514accb60c23a862194fa2a6db8bdeb815d16e2c21aa4d7dc2845d
```

Whether you decided to create two new accounts or just one, we can now update the `.env` with the final variables:

```env
# Private key of the account to use as lender in the loan flow
LENDER_WALLET_PRIVATE_KEY="<your_lender_private_key>"
# Private key of the account to use as borrower in the loan flow
BORROWER_WALLET_PRIVATE_KEY="<your_borrower_private_key>"
```

> [!CAUTION]
> Make sure both accounts have enough ETH on Sepolia otherwise they won't
> be able to execute the funding/repaying calls. You can request some
> Sepolia ETH tokens using a [🚰 testnet faucet]. We link to the Google
> sepolia faucet here.

Now that we've populated our .env file with all necessary variables, let's
load those variables into our terminal.

```sh
source .env
```

## 1.3 Funding accounts

To make sure both accounts have enough ERC20 tokens to actually be able to lend/borrow from each other, the `TestERC20` contract
that you deployed has a handy method for this:

```sh
cast send --rpc-url $SOURCE_CHAIN_RPC_URL \
    $SOURCE_CHAIN_ERC20_CONTRACT_ADDRESS  \
    "mint(uint256)" 5000000000   \
    --private-key $LENDER_WALLET_PRIVATE_KEY
```

And for our borrower:

```sh
cast send --rpc-url $SOURCE_CHAIN_RPC_URL \
    $SOURCE_CHAIN_ERC20_CONTRACT_ADDRESS  \
    "mint(uint256)" 300000000   \
    --private-key $BORROWER_WALLET_PRIVATE_KEY
```

If only it was that easy in the real world huh? Anyways you can check both accounts balance like so:

```bash
WALLET_ADDRESS=$(cast wallet address --private-key $LENDER_WALLET_PRIVATE_KEY)
yarn utils:check_balance $SOURCE_CHAIN_ERC20_CONTRACT_ADDRESS $WALLET_ADDRESS $SOURCE_CHAIN_RPC_URL
```

```bash
📦 Token: Mintable (TEST)
🧾 Raw Balance: 300000000
💰 Formatted Balance: 0.0000000003 TEST
Decimals for token micro unit: 18
```

## 1.4 Authorizing your token

Now we have the contracts and the funds for lending/borrowing, one final thing we have to do before attempting to register
any loan is to "authorize" the ERC20 contract as a valid token for loans. That is of course to avoid any malicious third party
using a fraudulent ERC20 contract for "loaning" tokens to an unsuspecting borrower.

To register your previously deployed ERC20 contract, we have this nifty command:

```sh
yarn loan_flow:authorize_token $SOURCE_CHAIN_ERC20_CONTRACT_ADDRESS
```

This will show you the following:

```sh
Token authorized with transaction hash:  0x119dbd81c2ee8db6d5e86815429e2aaa059c6d6f6104f1ea931a9bbca93de43d
```

Now we are ready, let the usury begin! 💰💰💰

## 2. Start the Offchain Worker

To start the worker simply call:

```sh
yarn loan_flow:start_worker
```

Once it's up and running, you start to see the following logs:

```bash
Starting loan worker...
Worker started! Listening for events...
Polling source chain from block 3093
Polling USC chain from block 3712
```

## 3. Registering a loan

Now that our worker is up and running, let's register a loan!

Open a new terminal window and source the `.env` file once again

```sh
source .env
```

Then run the following command to register a loan:

```sh
yarn loan_flow:register_loan 1000 500 1000
```

These are the loan parameters, the first is the loan amount, the second the interest rate in base points and the last
how many blocks in the Creditcoin chain will the loan last until it is considered expired.

After running the command you should see the following:

```sh
Registering loan with the following terms:
  Fund Flow: {
  "from": "0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266",
  "to": "0x70997970C51812dc3A010C7d01b50e0d17dc79C8",
  "withToken": "0xc351628EB244ec633d5f21fBD6621e1a683B1181"
}
  Repay Flow: {
  "from": "0x70997970C51812dc3A010C7d01b50e0d17dc79C8",
  "to": "0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266",
  "withToken": "0xc351628EB244ec633d5f21fBD6621e1a683B1181"
}
  Loan Terms: {
  "loanAmount": 1000,
  "interestRate": 500,
  "expectedRepaymentAmount": 1050,
  "deadlineBlockNumber": 4772
}
Loan registered with transaction hash:  0xe7ae256f9786a4538703d19e7e9e3cf7bd30010c76bc865499ff812292d44a11
Loan successfully registered with ID: 5
```

And in the worker now something like this should have appeared:

```sh
Detected LoanRegistered event for loanId: 5 - tx hash: 0xe7ae256f9786a4538703d19e7e9e3cf7bd30010c76bc865499ff812292d44a11
Registered loan 5 for funding on source chain, tx hash: 0xcc494f252ebe513499485344453d160e8445766d6a0e3c932f901359918615d4
```

Keep track of the loan id, you will need it for the next steps. Additionally you can inspect the loan status at any moment
with the following command:

```sh
yarn loan_flow:inspect_loan <your_loan_id>
```

Which will output something like this:

```sh
Loan Details:
 Loan ID: 1
 From: 0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266
 To: 0x70997970C51812dc3A010C7d01b50e0d17dc79C8
 With Token: 0x5FbDB2315678afecb367f032d93F642f64180aa3
 Loan Amount: 1000
 Interest Rate (basis points): 500
 Expected Repayment Amount: 1050
 Deadline Block Number: 1167
 Status: Created
 Repaid Amount: 0
 Blocks until deadline: 912
```

## 4. Funding the loan

Now the loan is registered in both Creditcoin and the source chain, but the amount pledged by both parties is still in the hands of the lender, so we need to send the tokens to the borrower before they can begin repaying it.

To do it, use the following command:

```sh
yarn loan_flow:fund_loan <your_loan_id> <paymentamount>
```

In our example, this will be:

```sh
yarn loan_flow:fund_loan <your_loan_id> 500
```

You should see something like that:

```sh
Source chain loan contract allowance (0) is less than loan amount 500, requesting extra allowance from lender...
Allowance granted:  0xcab346ef954cf20026a7b2d2a3e9476dd6d2c639dfed7df834dbd5fe25480a4c
Loan funded:  0x09a09d8ff1fb6a279d300cef7d966f21f0489a62666ffc138672843850de023a
```

You may have noticed that we haven't actually fully funded the loan, as evidence of that the worker will not show any message regarding the funding. That is on purpose, much like the borrower can repay the loan bit by bit, so can the lender fund it bit by bit.

Let's try finish the funding:

```sh
yarn loan_flow:fund_loan <your_loan_id> 500
```

Now the worker seems to have noticed something:

```sh
Detected LoanFunded event for loanId: 5 - tx hash: 0x2dd44ac7c92786dcc555aafdbf0ce0040c5844eeb4a8a0d45451c5972bf124bf
Transaction 0x2dd44ac7c92786dcc555aafdbf0ce0040c5844eeb4a8a0d45451c5972bf124bf found in block 3193
Waiting for block 3193 attestation on Creditcoin...
Latest attested height for chain key 2: 3170
```

Once the worker detects a `LoanFunded` event from the source chain contract it will try to prove it using the Oracle! Once proven
you will see something like that in the worker logs:

```sh
Proof generation successful!
⏳ Estimating gas...
   Gas estimation failed: missing revert data
   Using calculated gas limit based on proof size: 81000 (8 continuity blocks)
Registered loan 5 for repayment on source chain, tx hash: 0x9ea075d13b1ef07d374b44eec68f2852d664220d2166f9f7cfe6e675c4aa7cc1
Marked loan 5 as funded on Creditcoin, tx hash: 0x30bbaf08809e8c2b80626a971fd63c2070781cbe80c5e46d69561dfbe0a0f7c7
Loan 5 has been marked as funded on Creditcoin.
```

Now the borrower can begin repaying its due!

## 5. Repaying the loan

Much like funding, repaying is as easy as calling:

```sh
yarn loan_flow:repay_loan <your_loan_id> 1000
```

Which shows the following:

```sh
Loan repaid:  0x33b6bb60b928407a6599c1803567ac24cb5bbd5c116351efd52ed434ff97516e
```

And this time the worker does notice that the loan is being repaid:

```sh
Detected LoanRepaid event for loanId: 5 - tx hash: 0x33b6bb60b928407a6599c1803567ac24cb5bbd5c116351efd52ed434ff97516e
Transaction 0x33b6bb60b928407a6599c1803567ac24cb5bbd5c116351efd52ed434ff97516e found in block 3236
Waiting for block 3236 attestation on Creditcoin...
Latest attested height for chain key 2: 3210
```

Before discounting the amount repaid in the manager contract, the worker once more first uses the Oracle to prove that such
repayment really happened. Once proven the following appears in the logs:

```sh
Block 3236 attested! Generating proof...
Proof generation successful!
⏳ Estimating gas...
   Gas estimation failed: missing revert data
   Using calculated gas limit based on proof size: 66000 (5 continuity blocks)
Note loan 5 repayment, tx hash: 0xa1c22b43c37e51734d3d388fcd583afcb46fbe5bb682bc7622d4321722266df4
Loan 5 has been partially repaid on Creditcoin. Amount repaid: 1000
```

Wait a minute... what do you mean partially repaid!? The loan was for 1000 tokens, this is not fair!
Hmm... oh! The interest! I forgot about that!

```sh
yarn loan_flow:repay_loan <your_loan_id> 50
```

Now let's see...

```sh
Detected LoanRepaid event for loanId: 5 - tx hash: 0xec0eeac975afad8fb3cd9cc453c3818006c7c063adb3d23bef1292d6266d476b
Transaction 0xec0eeac975afad8fb3cd9cc453c3818006c7c063adb3d23bef1292d6266d476b found in block 3291
Waiting for block 3291 attestation on Creditcoin...
Latest attested height for chain key 2: 3270
```

Aaand voila! Loan repaid!

```sh
Block 3291 attested! Generating proof...
Proof generation successful!
⏳ Estimating gas...
   Gas estimation failed: missing revert data
   Using calculated gas limit based on proof size: 91000 (10 continuity blocks)
Note loan 5 repayment, tx hash: 0xb51ddfee000f3ccbd81b75f99fe39560afb425b0c75567b321f26a4cbbd70698
Loan 5 has been marked as fully repaid on Creditcoin.
```

## 6. Check balances in source chain contract

As a final check, we can take a look at the balance of both the lender and borrower accounts on source chain to confirm
that the repayment has been successful:

```sh
WALLET_ADDRESS=$(cast wallet address --private-key $BORROWER_WALLET_PRIVATE_KEY)
yarn utils:check_balance $SOURCE_CHAIN_ERC20_CONTRACT_ADDRESS $WALLET_ADDRESS $SOURCE_CHAIN_RPC_URL
```

It should show something like this:

```sh
📦 Token: Mintable (TEST)
🧾 Raw Balance: 299999950
💰 Formatted Balance: 0.00000000029999995 TEST
Decimals for token micro unit: 18
```

And for the lender:

```sh
WALLET_ADDRESS=$(cast wallet address --private-key $LENDER_WALLET_PRIVATE_KEY)
yarn utils:check_balance $SOURCE_CHAIN_ERC20_CONTRACT_ADDRESS $WALLET_ADDRESS $SOURCE_CHAIN_RPC_URL
```

It should show something like this:

```sh
📦 Token: Mintable (TEST)
🧾 Raw Balance: 5000000050
💰 Formatted Balance: 0.00000000500000005 TEST
Decimals for token micro unit: 18
```

So the borrower ended up losing the 50 extra micro units of the interest and the lender got them instead. Sounds correct!

## Conclusion

Congratulations! You've completed the Creditcoin Universal Smart Contracts tutorial series!
You've learned:

1. How to interact with the Creditcoin Oracle
2. How to deploy your own custom Universal Smart Contracts
3. How to run an offchain worker to support smooth cross-chain user experience
4. How to run a more complex loan flow example which uses the Oracle to inform successive cross-chain state transitions

If you haven't already, take a look at the [USC Gitbook] for more information.

[Bridge Offchain Worker]: ../bridge-offchain-worker/README.md
[Hello Bridge]: ../hello-bridge/README.md#11-generate-a-new-wallet-address
[USC Gitbook]: https://docs.creditcoin.org/usc
[🚰 testnet faucet]: https://cloud.google.com/application/web3/faucet/ethereum/sepolia

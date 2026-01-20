# Bridge Offchain Worker

> [!TIP]
> This tutorial builds on the previous [Custom Contract Bridging] example -make sure to check it out
> before moving on!

So far we have seen [how to initiate a trustless bridge transaction] and
[how to customize our trustless bridging logic]. In this tutorial, we will be seeing how to automate
our interaction with the Creditcoin oracle so that end users only have to submit _a single transaction_
on the Sepolia _source chain_.

## What is an Offchain Worker

An Offchain Worker is a script responsible for watching the state of a _source chain_: in this
case, Sepolia. In more complex cases this would also listen to state changes on the Creditcoin execution chain. The worker queries to our
_Universal Smart Contract_ on Creditcoin in response to specific events on
each chain. With an offchain worker, all the end user needs to do is sign a single transaction
on the source chain kicking off cross-chain interaction.

## 1. Setup

This is the same as in [Hello Bridge]. If you have not already done so, follow the installation
steps in the [setup] section there.

Additionally you need to have the `USC_CUSTOM_MINTER_CONTRACT_ADDRESS` environment variable set as seen in the [Custom Contract Bridging] tutorial.

Once that is done, you will need to set up some additional configuration for the offchain worker.
Check the `.env` file in the root of the repository and make sure it contains the following:

```env
# ============================================================================ #
#                          Source Chain Configuration                          #
# ============================================================================ #

# RPC endpoint for Sepolia
SOURCE_CHAIN_RPC_URL="https://sepolia.infura.io/v3/<your_infura_api_key>"

# Address of the ERC20 token contract on source chain
SOURCE_CHAIN_CUSTOM_CONTRACT_ADDRESS=<test_erc20_contract_address_from_custom_contracts_bridging>

# ============================================================================ #
#                      Creditcoin USC Chain Configuration                      #
# ============================================================================ #

# Address of your custom minter contract on Creditcoin
USC_CUSTOM_MINTER_CONTRACT_ADDRESS=<erc20_minter_address_from_custom_contracts_bridging>

# Private key of the wallet that will submit mint requests
CREDITCOIN_WALLET_PRIVATE_KEY=<your_private_key>
```

Once everyting is fine reload your `.env` file with:

```sh
source .env
```

## 2. Start the Offchain Worker

Once you have your worker configured, it's time to start automating some queries!

Run the following command to start the worker:

<!-- ignore -->

```sh
yarn start_worker
```

Once it's up and running, you start to see the following logs:

<!-- ignore -->

```bash
Starting...
Worker started! Listening for burn events...
```

## 3. Burning the tokens you want to bridge

Like we did in the previous tutorials, we start the bridging process by burning the funds we want to
bridge on Sepolia. This time however this will be the only transaction we need to submit! The rest
will be handled automatically by the worker 🤖

Open a new terminal window and source the `.env` file once again

```sh
source .env
```

Then run the following command to initiate the burn:

```sh
cast send --rpc-url $SOURCE_CHAIN_RPC_URL \
    $SOURCE_CHAIN_CUSTOM_CONTRACT_ADDRESS       \
    "burn(uint256)" 2000        \
    --private-key $CREDITCOIN_WALLET_PRIVATE_KEY
```

> [!TIP]
> If your worker is not running when the transaction is being processed on the source chain it will not pick up
> the event! This example is made for simplicity, a more robust worker would be able to read events from
> previous blocks and have more complex event filters.

## 4. Monitor the Offchain Worker

At this point, you should see the worker picking up the event.

<!-- ignore -->

```bash
Detected burn of 2000 tokens from 0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266 at 0xb5f8f1000432f92521021642a915999407c61ed1a9f13c2e6c37f6ac9b6eb6f0
Transaction 0xb5f8f1000432f92521021642a915999407c61ed1a9f13c2e6c37f6ac9b6eb6f0 found in block 418
Waiting for block attestation on Creditcoin...
```

Eventually, you should see a message like this one:

<!-- ignore -->

```bash
Tokens minted! Contract: 0xe7f1725E7734CE288F8367e1Bb143E90bb3F0512, To: 0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266, Amount: 1000, QueryId: 0x3bfcf46c80011ef4280b7212e4fa11e5be314b12c9ddd56a74e83c2964b3e9be
```

That's it! All it took was a single transaction on your end to initiate the bridging process,
providing for a _truly native UX_.

## 6. Check Balance in USC Testnet ERC20 Contract

As a final check, we can take a look at the balance of your account on Creditcoin to confirm that
the bridging process was successful.

Run the following command to check your funds:

```sh
WALLET_ADDRESS=$(cast wallet address --private-key $CREDITCOIN_WALLET_PRIVATE_KEY)
yarn check_balance $USC_CUSTOM_MINTER_CONTRACT_ADDRESS $WALLET_ADDRESS
```

It should show something like this:

<!-- ignore -->

```bash
📦 Token: Mintable (TEST)
🧾 Raw Balance: 2000
💰 Formatted Balance: 0.000000000000002 TEST
Decimals for token micro unit: 18
```

## Conclusion

Congratulations! You've completed the Creditcoin Universal Smart Contracts tutorial series!
You've learned:

1. How to interact with the Creditcoin Oracle
2. How to deploy your own custom Universal Smart Contracts
3. How to run an offchain worker to support smooth cross-chain user experience

If you haven't already, take a look at the [USC Gitbook] for more information.

[Custom Contract Bridging]: ../custom-contracts-bridging/README.md
[how to initiate a trustless bridge transaction]: ../hello-bridge/README.md
[how to customize our trustless bridging logic]: ../custom-contracts-bridging/README.md
[Hello Bridge]: ../hello-bridge/README.md
[setup]: ../hello-bridge/README.md#1-setup
[Custom Contracts Bridging]: ../custom-contracts-bridging/README.md#33-update-environment-with-yout-usc-contract-address
[USC Gitbook]: https://docs.creditcoin.org/usc

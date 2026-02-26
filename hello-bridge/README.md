# Hello Bridge

This tutorial introduces you to one of the most common uses for a cross chain oracle, **cross chain
bridging!** Cross-chain bridging on Creditcoin can be broken down into three broad steps:

1. To begin, the `ERC20` tokens to bridge are burned using a smart contract on our _source chain_
   (in this case, Sepolia).
2. Then, we generate merkle and continuity proofs corresponding to our source chain token burn
3. Using the proofs we generated, we call our minter universal smart contract (USC) which will internally call the Creditcoin oracle's native proof verifier
4. After that the same contract will mint the tokens on Creditcoin

## 1. Setup

This tutorial involves the use of two different blockchains.

- Sepolia, which serves as our _source chain_ for the tutorial. This is where tokens are burned.
- Creditcoin USC Testnet, which serves as our _execution chain_ for the tutorial. This is where our minter universal smart contract lives. Tokens are minted by that contract.

In order to use both blockchains we need to create a wallet and fund it with the native tokens of
both networks.

### 1.1 Generate a New Wallet Address

In order to safely sign transactions for this tutorial, we want to generate a fresh EVM wallet address.
Since all EVM networks use the same address and transaction signature scheme we can use the address we
create on both Sepolia and Creditcoin USC Testnet.

> [!CAUTION]
> In this tutorial, we will be using your wallet's private key to allow some test scripts to act on
> your wallet's behalf. Make sure the wallet you use contains nothing of value. Ideally it should be
> a newly created address.

Generating our new wallet is simple! Just run the following command:

```bash
cast wallet new
```

Save the resulting wallet address and private key for future use. They should look like:

```bash
Address:     0xBE7959cA1b19e159D8C0649860793dDcd125a2D5
Private key: 0xb9c179ed56514accb60c23a862194fa2a6db8bdeb815d16e2c21aa4d7dc2845d
```

Save this private key on the `.env` file in the root of the repository:

```env
CREDITCOIN_WALLET_PRIVATE_KEY=<your_private_key>
```

And load into your terminal session with:

```sh
source .env
```

### 1.2 Get some test funds (`Sepolia`)

Now that you have your new test address ready, you will be needing some funds to make transactions.
You can request some Sepolia ETH tokens using a [🚰 testnet faucet]. We link to the Google sepolia
faucet here.

### 1.3 Get some test funds (`Creditcoin`)

You will also need to fund your account on the Creditcoin Testnet v2, otherwise our oracle query
submission will fail due to lack of funds. Head to the [🚰 creditcoin discord faucet] to request
some test tokens there.

Your request for tokens in the Discord faucet should look like this. Substitute in your testnet
account address from [step 1.1]:

```bash
/faucet address: 0xBE7959cA1b19e159D8C0649860793dDcd125a2D5
```

Note, that currently the faucet yields 100 test CTC every 24 hours. This balance is sufficient
to submit 9 oracle queries, since testnet oracle fees are artificially high to prevent DOS.

Now that your wallet is ready to make transactions on both networks, you will be needing a way
to interact with it from the command line.

### 1.4 Obtaining an Infura API key

Finally, you will need a way to send requests to the Sepolia test chain. The easiest way to do this
is to sign up with an _RPC provider_. [Infura] will work for testing purposes.

Follow the onscreen instructions to create your account and generate your first api key. Make sure
you are requesting a Sepolia API key. Copy it: you will be needing it in the following steps. You
are now ready to go with the rest of the tutorial!

Once you have your key edit the following variable in the `.env` file located at the root of this repository.

```env
SOURCE_CHAIN_RPC_URL="https://sepolia.infura.io/v3/<your_infura_api_key>"
```

And load into your terminal session with:

```sh
source .env
```

## 2. Minting some tokens on Sepolia

More tokens? But I thought I had all the tokens I needed! Well, kind of. For our example we
demonstrate burning ERC20 tokens rather than sepolia native tokens. Making an ERC20 contract call
to burn tokens and emitting a token burn event better demonstrates the best practice way of using
the Creditcoin Oracle described in our [DApp Design Patterns] Gitbook page.

But your new Sepolia account doesn't have these tokens yet!

For your convenience, we have [already deployed] a test `ERC20` contract to Sepolia which you can
use to mint some dummy ERC20 tokens. Run the following command:

```bash
cast send --rpc-url $SOURCE_CHAIN_RPC_URL \
    $SOURCE_CHAIN_CONTRACT_ADDRESS  \
    "mint(uint256)" 50000000000000000000        \
    --private-key $CREDITCOIN_WALLET_PRIVATE_KEY
```

## 3. Burning the tokens you want to bridge

The first step in bridging tokens is to burn them on the _source chain_ (Sepolia in this case). We
burn tokens by transferring them to an address for which the private key is unknown, making them
inaccessible. This way, when creating the same amount of tokens on Creditcoin at the end of the
bridging process, we won't be creating any artificial value. Run the following command:

```sh
cast send --rpc-url $SOURCE_CHAIN_RPC_URL \
    $SOURCE_CHAIN_CONTRACT_ADDRESS  \
    "burn(uint256)" 50000000000000000000        \
    --private-key $CREDITCOIN_WALLET_PRIVATE_KEY
```

This should display some output stating that your transaction was a success, along with a
transaction hash:

```bash
transactionHash         0xbc1aefc42f7bc5897e7693e815831729dc401877df182b137ab3bf06edeaf0e1
```

Save the transaction hash. You will be needing it in the next step.

## 4. Submit a mint query to the USC contract

Great, we've burned some tokens! But how can we prove it? Most cross-chain bridges rely on a
_centralized_, _trusted_ approach: one service or company handles all the token burns on the _source
chain_ and is responsible for distributing the same amount of tokens on the target chain. This can
be an issue, since nothing is preventing that company from censoring certain transactions or even
stealing funds! Web3 was made to be _trustless_ and _decentralized_, let's make it that way 😎.

Now that we've burnt funds on Sepolia, we can use that transaction to request a mint in our USC contract.
But before we can submit our USC call, we need to generate proofs which will be submitted to the Creditcoin
Oracle to verify our cross-chain data.

All these steps are condensed in the `hello_bridge:submit_query` script, which is run as follows:

```sh
yarn hello_bridge:submit_query <transaction_hash_from_step_3>
```

On a succesfull query, you should see some messages like the following from the script:

```sh
Transaction 0x87c97c776a678941b5941ec0cb602a4467ff4a35f77264208575f137cb05b2a7 found in block 254
Waiting for block 254 attestation on Creditcoin...
Latest attested height for chain key 2: 240
Block 254 attested! Generating proof...
Proof generation successful!
⏳ Estimating gas...
   Estimated gas: 357667, Gas limit with buffer: 482850
Proof submitted:  0xd96bc0545714fcce088d5484f9daa009eaa10c7426ffda54366bcb982a3d3381
Waiting for TokensMinted event...
Waiting for TokensMinted event...
Waiting for TokensMinted event...
Tokens minted! Contract: 0xe7f1725E7734CE288F8367e1Bb143E90bb3F0512, To: 0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266, Amount: 1000, QueryId: 0xcb77283a28cc0ff227193664bfed87d63124aa753a45cae0a49e31021102f8c7
Minting completed!
```

Sometimes it may take a bit longer for the `TokensMinted` event to trigger, but should be no more than a couple of minutes.

Once that's done we only need to check our newly minted tokens!

## 5. Verify Your Bridged Tokens

As a final check, verify that your tokens were successfully minted on Creditcoin Testnet. You can check your balance using:

```bash
WALLET_ADDRESS=$(cast wallet address --private-key $CREDITCOIN_WALLET_PRIVATE_KEY)
yarn utils:check_balance $USC_MINTABLE_TOKEN $WALLET_ADDRESS
```

This will return your balance in whole (BTKT) token units.

The contract address and your wallet address should show your minted BTKT tokens from the bridging process.

It should show something like this:

```bash
📦 Token: Bridge Test Token (BTKT)
🧾 Raw Balance: 50000000000000000000
💰 Formatted Balance: 50.0 BTKT
Decimals for token micro unit: 18
```

## Conclusion

Congratulations, you've bridged your first funds using the **Creditcoin Decentralized oracle!** This
is only a simple example of the cross chain functionality made possible by Creditcoin, keep on
reading to find more ways in which you can leverage decentralized cross-chain proofs of state!

In the next tutorial we will be looking at the next piece in the puzzle of decentralized bridging:
self-hosted smart contracts! In a production environment, the Creditcoin oracle will almost always
be used by teams of DApp builders who will handle data provisioning on behalf of their end users.
Such teams will want to define and deploy their own contracts as shown in the [custom contract
bridging] tutorial.

[🚰 testnet faucet]: https://cloud.google.com/application/web3/faucet/ethereum/sepolia
[🚰 creditcoin discord faucet]: https://discord.com/channels/762302877518528522/1463257679827828962

<!-- markdown-link-check-disable -->

[Infura]: https://developer.metamask.io/register
[already deployed]: https://sepolia.etherscan.io/address/0x15166Ba9d24aBfa477C0c88dD1E6321297214eC8
[custom contract bridging]: ../custom-contracts-bridging/README.md
[step 1.1]: #11-generate-a-new-wallet-address
[step 2]: #2-minting-some-tokens-on-sepolia
[step 4]: #4-submit-a-mint-query-to-the-usc-contract
[DApp Design Patterns]: https://docs.creditcoin.org/usc/dapp-builder-infrastructure/dapp-design-patterns

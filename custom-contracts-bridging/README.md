# Custom Contract Bridging

> [!TIP]
> This tutorial builds on the previous [Hello Bridge] example -make sure to check it out before
> moving on!

Now that you have performed your first _trustless bridge transaction_, let's keep going with the next
step: this tutorial teaches you how to set up your own custom bridging logic by deploying your own
smart contracts!

## 0. Install

For our tutorial scripts to function properly, we need to install dependencies first.

```bash
yarn install
```

## 1. Setup

This is the same as in [Hello Bridge]. If you have not already done so, follow the installation
steps in the [setup] section there before continuing.

## 2. Deploy A Test `ERC20` Contract on Sepolia

Let's start by deploying our own `ERC20` contract on Sepolia. The contract contains logic for
tracking the balances of a coin called `TEST`. The contract also automatically funds its creator's
address with 1000 `TEST` coins, so we won't have to mint `TEST` tokens manually.

Make sure to first load your `.env` file with:

```sh
source .env
```

After, run the following command to deploy the contract:

```sh
forge create \
    --broadcast \
    --rpc-url $SOURCE_CHAIN_RPC_URL \
    --private-key $CREDITCOIN_WALLET_PRIVATE_KEY \
    contracts/sol/TestERC20.sol:TestERC20
```

This should display some output containing the address of your test `ERC20` contract:

```bash
Deployer: 0x20dB67795C2AEb4De075986b0D4217A109FEF2B5
Deployed to: 0xCDf3e9eC93015a1B3047d087296C1cE096f33f74
Transaction hash: 0xfb0aaf396684bf0727019e5271d7e0dedee1dea9e5a4a1ef7456662d0ac07b12
```

Save the contract address shown in `Deployed to:`. You will be needing it in the next step.

Additionally update the `.env` file at the root of the repository with the address, like so:

```env
SOURCE_CHAIN_CUSTOM_CONTRACT_ADDRESS=<test_erc20_contract_address_from_step_2>
```

Once again, reload your `.env` file with:

```sh
source .env
```

## 3. Deploy Your Own Custom Bridging Contract

In the next two steps we will be deploying our own bridging contract called `USCMinter.sol`

Universal smart contracts (USCs) such as `USCMinter` are intended to be deployed by DApp
builders. Here, our USC is used only for bridging tokens. A USC exposes functions which
internally make use of the Creditcoin Oracle to verify cross-chain data. It then interprets
those data and uses them to trigger DApp business logic.

For instance, our `USCMinter` looks for fields like `from`, `to`, and `amount` in the
cross-chain data we submit to it. With those fields, the contract can verify whether or not a
token burn took place, how many tokens it needs to mint on Creditcoin, and which address it
should mint them to.

### 3.1 Modify The Bridge Smart Contract

As an exercise, we will be modifying our `USCMinter` so that it mints _twice_ the amount
of tokens which were burned on our _source chain_.

> [!NOTE]
> This is for demonstration purposes only, as bridging this way dilutes the value of our `TEST`
> token each time we bridge it.

Start by opening the file `contracts/sol/USCMinter.sol`. Next, navigate to the following line
inside of the `_processMint` function:

```sol
USCMintableToken(wrappedTokenAddress).mint(burntFrom, burntValue);
```

Update it so that your `USCMinter` contract mints twice the `burntValue`
of tokens it should on Creditcoin. The resulting line should look something like:

```sol
USCMintableToken(wrappedTokenAddress).mint(burntFrom, burntValue * 2);
```

### 3.2 Deploy Your Decoder Library and Modified Contract

First we need to deploy our `EvmV1Decoder` library so that we can reference it in our
`USCMinter`. We do so like this:

```bash
forge create \
  --broadcast \
  --rpc-url $CREDITCOIN_RPC_URL \
  --private-key $CREDITCOIN_WALLET_PRIVATE_KEY \
  node_modules/@gluwa/usc-contracts/contracts/decoding/EvmV1Decoder.sol:EvmV1Decoder
```

You should get some output with the address of the library you just deployed:

```bash
Deployer: 0x20dB67795C2AEb4De075986b0D4217A109FEF2B5
Deployed to: 0x128A6492F875Bd92C07D7F0050fc5c265dbc849B
Transaction hash: 0x04e524d4578851b06bd2196710b0c9890fff6bf29d40999c5fb02dab0c428fca
```

Use the contract address shown in `Deployed to:` to deploy your `USCMinter` using the following command:

```bash
forge create \
    --broadcast \
    --rpc-url $CREDITCOIN_RPC_URL \
    --private-key $CREDITCOIN_WALLET_PRIVATE_KEY \
    --libraries node_modules/@gluwa/usc-contracts/contracts/decoding/EvmV1Decoder.sol:EvmV1Decoder:<decoder_library_address> \
    contracts/sol/USCMinter.sol:USCMinter
```

> [!IMPORTANT]
> Don't forget to replace `<decoder_library_address>` with the address of your deployed decoder contract!

You should get some output with the address of the contract you just deployed:

```bash
Deployer: 0x20dB67795C2AEb4De075986b0D4217A109FEF2B5
Deployed to: 0xCDf3e9eC93015a1B3047d087296C1cE096f33f74
Transaction hash: 0xe86e3c2f77fd050a4120dbd195668af2f3d94f3a41b5db21643c53c1ac3cc212
```

If you have issues with deployment during this step, see the [Deployment Troubleshooting Guide]

### 3.3 Update environment with your USC contract address

Save the address of the contract. And modify the following entry in the `.env` file found at the root of the
repository:

```env
USC_CUSTOM_MINTER_CONTRACT_ADDRESS=<usc_address_from_step_3_2>
```

Once again, reload your `.env` file with:

```sh
source .env
```

### 3.4 Deploy Minter ERC20 Contract and register with USC Minter

Now that we've deployed our USC which triggers the minting action, we need to connect the ERC20 contract in
which we will mint wrapped tokens!

```bash
forge create \
    --broadcast \
    --rpc-url $CREDITCOIN_RPC_URL \
    --private-key $CREDITCOIN_WALLET_PRIVATE_KEY \
    contracts/sol/BridgeTestToken.sol:BridgeTestToken \
    --constructor-args "$USC_CUSTOM_MINTER_CONTRACT_ADDRESS"
```

You should get some output with the address of the ERC20 token you just deployed:

```bash
Deployer: 0x20dB67795C2AEb4De075986b0D4217A109FEF2B5
Deployed to: 0xD1A5c57654636146417B589aED99C56b9c73C510
Transaction hash: 0x07f87a00b117f9d16c5a20a461d00cbce87aa76994af727a02d73da3aca622f1
```

Modify the following entry in the `.env` file found at the root of the
repository:

```env
USC_CUSTOM_MINTABLE_TOKEN=<ERC20_address_from_step_3_4>
```

Once again, reload your `.env` file with:

```sh
source .env
```

Our last step is to register the ERC20 token as the wrapped version of the source chain token we intend
to bridge.

```bash
cast send \
    --rpc-url $CREDITCOIN_RPC_URL \
    $USC_CUSTOM_MINTER_CONTRACT_ADDRESS \
    "wrapOriginToken(address, address)" $SOURCE_CHAIN_CUSTOM_CONTRACT_ADDRESS $USC_CUSTOM_MINTABLE_TOKEN \
    --private-key $CREDITCOIN_WALLET_PRIVATE_KEY
```

## 4. Burning the tokens you want to bridge

The following few steps are similar to what we did in the [Hello Bridge] example. Start by burning
the tokens you want to bridge on the _source chain_ (Sepolia in this case). We will be burning the
`TEST` tokens from the test `ERC20` contract which we deployed in [step 2]. We do this by
transferring them to an address for which the private key is unknown, making them inaccessible.

Run the following command to initiate the burn:

```bash
cast send \
    --rpc-url $SOURCE_CHAIN_RPC_URL \
    $SOURCE_CHAIN_CUSTOM_CONTRACT_ADDRESS \
    "burn(uint256)" 50000000000000000000 \
    --private-key $CREDITCOIN_WALLET_PRIVATE_KEY
```

This should display some output stating that your transaction was a success, along with a
transaction hash:

```bash
transactionHash         0xbc1aefc42f7bc5897e7693e815831729dc401877df182b137ab3bf06edeaf0e1
```

Save the transaction hash. You will be needing it in the next step.

## 5. Submit a mint query to the USC contract

Now that we've burnt funds on Sepolia, we can use that transaction to request a mint in our custom USC contract,
this also includes generating the proof for the Oracle using the Creditcoin proof generator library.

```sh
yarn custom_bridge:submit_query <transaction_hash_from_step_4>
```

On a succesfull query, you should see some messages like the following from the script:

```sh
Transaction 0xfd432f2c8ff1930ba5527e85c15fdaf68894f52ee6c975d61a745a6d55577341 found in block 11073177
Waiting for block 11073177 attestation on Creditcoin...
Latest attested height for chain key 1: 11073130
Height 11073177 not yet attested and in proof builder service cache for chain key 1. Latest height: 11073130. Retrying in 15000ms...
Height 11073177 not yet attested and in proof builder service cache for chain key 1. Latest height: 11073130. Retrying in 15000ms...
...
Height 11073177 not yet attested and in proof builder service cache for chain key 1. Latest height: 11073170. Retrying in 15000ms...
Block 11073177 attested! Generating proof...
Proof generation successful!
⏳ Estimating gas...
   Estimated gas: 419719, Gas limit with buffer: 566620
Proof submitted:  0xe9960fab9592311b7abc2097216828b64c6f6791ba47151714cd619705415ec3
Waiting for transaction to be mined...
Tokens minted! Contract: 0xD1A5c57654636146417B589aED99C56b9c73C510, To: 0x20dB67795C2AEb4De075986b0D4217A109FEF2B5, Amount: 50000000000000000000, QueryId: 0x3a18d51bb0433b512a770dd1e6bfbbec534f5ad76acdd657d1764141c5fba494
```

Sometimes it may take a bit more for the `TokensMinted` event to trigger, but should be no more than 30 seconds.

Once that's done we only need to check our newly minted tokens!

## 6. Verify Your Bridged Tokens

As a final check, verify that your tokens were successfully minted on Creditcoin Testnet. You can check your balance using:

```bash
WALLET_ADDRESS=$(cast wallet address --private-key $CREDITCOIN_WALLET_PRIVATE_KEY)
yarn utils:check_balance $USC_CUSTOM_MINTABLE_TOKEN $WALLET_ADDRESS
```

This will return your balance in whole (BTKT) token units.

Notice how you now have _twice_ the amount of tokens you originally burned on Sepolia!

It should show something like this:

```bash
🔗 Using RPC URL: https://rpc.cc3-testnet.creditcoin.network
📦 Token: Bridge Test Token (BTKT)
🧾 Raw Balance: 100000000000000000000
💰 Formatted Balance: 100.0 BTKT
Decimals for token micro unit: 18
```

## Conclusion

Congratulations! You've set up your first custom smart contracts which make use of the Creditcoin
Decentralized Oracle!

The next tutorial: [Bridge Offchain Worker], will take another important step towards developing a mature, production ready
cross-chain DApp. That step is automation! We automate using an **offchain worker** which submits
queries automatically. This _vastly_ improves UX by making it so the
end user only has to sign a _single_ transaction to initiate the bridging procedure.

In practice, DApp builders will want to conduct all cross-chain queries via an offchain worker in
order to ensure robustness and streamline UX.

[Hello Bridge]: ../hello-bridge/README.md
[setup]: ../hello-bridge/README.md#1-setup
[step 2]: #2-deploy-a-test-erc20-contract-on-sepolia
[step 3.2]: #32-deploy-your-modified-contract
[step 5]: #5-submit-a-mint-query-to-the-usc-contract
[Deployment Troubleshooting Guide]: ../contracts/DEPLOY.md
[Bridge Offchain Worker]: ../bridge-offchain-worker/README.md

# Custom Contract Bridging

> [!TIP]
> This tutorial builds on the previous [Hello Bridge] example -make sure to check it out before
> moving on!

Now that you have performed your first _trustless bridge transaction_, let's keep going with the next
step: this tutorial teaches you how to set up your own custom bridging logic by deploying your own
smart contracts!

## 1. Setup

This is the same as in [Hello Bridge]. If you have not already done so, follow the installation
steps in the [setup] section there.

## 2. Deploy A Test `ERC20` Contract on Sepolia

Let's start by deploying our own `ERC20` contract on Sepolia. The contract contains logic for
tracking the balances of a coin called `TEST`. The contract also automatically funds its creator's
address with 1000 `TEST` coins, so we won't have to mint `TEST` tokens manually.

Run the following command to deploy the contract:

<!-- env your_infura_api_key USC_DOCS_INFURA_KEY -->
<!-- env your_private_key USC_DOCS_TESTING_PK -->
<!-- extract test_erc20_contract_address_from_step_2 "Deployed to: (0[xX][a-fA-F0-9]{40})" -->

```sh
forge create                                                     \
    --broadcast                                                  \
    --rpc-url https://sepolia.infura.io/v3/<your_infura_api_key> \
    --private-key <your_private_key> \
    src/contracts/TestERC20.sol:TestERC20
```

This should display some output containing the address of your test `ERC20` contract:

<!-- ignore -->

```bash
Deployed to: 0xCf7Ed3AccA5a467e9e704C703E8D87F634fB0Fc9
```

Save the contract address. You will be needing it in the next step.

## 3. Deploy Your Own Custom Bridging Contract

In the next two steps we will be deploying our own bridging contract called `SimpleMinterUSC.sol`

Universal smart contracts (USCs) such as `SimpleMinterUSC` are intended to be deployed by DApp
builders. Here, our USC is used only for bridging tokens. A USC exposes functions which
internally make use of the Creditcoin Oracle to verify cross-chain data. It then interprets
those data and uses them to trigger DApp business logic.

For instance, our `SimpleMinterUSC` looks for fields like `from`, `to`, and `amount` in the
cross-chain data we submit to it. With those fields, the contract can verify whether or not a
token burn took place, how many tokens it needs to mint on Creditcoin, and which address it
should mint them to.

### 3.1 Modify The Bridge Smart Contract

As an exercise, we will be modifying our `SimpleMinterUSC` so that it mints _twice_ the amount
of tokens which were burned on our _source chain_.

> [!NOTE]
> This is for demonstration purposes only, as bridging this way dilutes the value of our `TEST`
> token each time we bridge it.

Start by opening the file `contracts/sol/SimpleMinterUSC.sol`. Next, navigate to the following line
inside of the `mintFromQuery` function:

```sol
_mint(msg.sender, MINT_AMOUNT);
```

Update it so that your `SimpleMinterUSC` contract mints twice
the `MINT_AMOUNT` of tokens it should on Creditcoin. The resulting line should look something like:

```sol
_mint(msg.sender, MINT_AMOUNT * 2);
```

### 3.2 Deploy Your Decoder Library and Modified Contract

//TODO: Change this instruction after testnet release
Since the latest USC testnet is not yet released, we will be deploying to USC Devnet.

First we need to deploy our EvmV1Decoder library so that we can reference it in our
`SimpleMinterUSC`. We do so like this:

```bash
forge build
```

<!--extract decoder_library_address "Deployed to: (0[xX][a-fA-F0-9]{40})" -->
<!-- ignore -->

```bash
forge create \
  --broadcast \
  --rpc-url https://rpc.usc-devnet.creditcoin.network \
  --private-key <your_private_key> \
  src/contracts/EvmV1Decoder.sol:EvmV1Decoder
```

You should get some output with the address of the library you just deployed:

<!-- ignore -->

```bash
Deployed to: 0x7d8726B05e4A48850E819639549B50beCB893506
```

Save the address of the contract. You will be needing it for the second half of this step.

Now you can deploy your `SimpleMinterUSC` using the following command:

<!-- extract usc_address_from_step_3_2 "Deployed to: (0[xX][a-fA-F0-9]{40})" -->
<!-- ignore -->

```bash
forge create \
    --broadcast \
    --rpc-url https://rpc.usc-devnet.creditcoin.network \
    --private-key <your_private_key> \
    --libraries src/contracts/EvmV1Decoder.sol:EvmV1Decoder:<decoder_library_address> \
    src/contracts/SimpleMinterUSC.sol:SimpleMinterUSC
```

You should get some output with the address of the contract you just deployed:

<!-- ignore -->

```bash
Deployed to: 0x7d8726B05e4A48850E819639549B50beCB893506
```

Save the address of the contract. You will be needing it in [step 5].

> [!WARNING]
> If you run into any trouble with deployment using these steps, try using
> the [Deployment Guide] instead. Make sure you use step 3a and ignore
> 3b, which targets testnet.

## 4. Burning the tokens you want to bridge

The following few steps are similar to what we did in the [Hello Bridge] example. Start by burning
the tokens you want to bridge on the _source chain_ (Sepolia in this case). We will be burning the
`TEST` tokens from the test `ERC20` contract which we deployed in [step 2]. We do this by
transferring them to an address for which the private key is unknown, making them inaccessible.

Run the following command to initiate the burn:

<!-- extract transaction_hash_from_step_4 "transactionHash\s*(0[xX][a-fA-F0-9]{64})" -->

```bash
cast send                                                        \
    --rpc-url https://sepolia.infura.io/v3/<your_infura_api_key> \
    <test_erc20_contract_address_from_step_2>                    \
    "burn(uint256)" 50000000000000000000                         \
    --private-key <your_private_key>
```

This should display some output stating that your transaction was a success, along with a
transaction hash:

<!-- ignore -->

```bash
transactionHash         0xbc1aefc42f7bc5897e7693e815831729dc401877df182b137ab3bf06edeaf0e1
```

Save the transaction hash. You will be needing it in the next step.

## 5. Submit a mint query to the USC contract

Now that we've burnt funds on Sepolia, we can use that transaction to request a mint in our custom USC contract,
this also includes generating the proof for the Oracle using the Creditcoin proof generator library.

```sh
yarn submit_custom_contracts_bridging_query        \
    https://sepolia.infura.io/v3/<your_infura_api_key>  \
    <transaction_hash_from_step_4> \
    <your_private_key>             \
    <usc_address_from_step_3_2>
```

On a succesfull query, you should see some messages like the following from the script:

<!-- ignore -->

```sh
Transaction 0x87c97c776a678941b5941ec0cb602a4467ff4a35f77264208575f137cb05b2a7 found in block 254
Waiting for block 254 attestation on Creditcoin...
Latest attested height for chain key 2: 240
Block 254 attested! Generating proof...
Proof generation successful!
Proof submitted:  0xd96bc0545714fcce088d5484f9daa009eaa10c7426ffda54366bcb982a3d3381
Waiting for TokensMinted event...
Waiting for TokensMinted event...
Waiting for TokensMinted event...
Tokens minted! Contract: 0xe7f1725E7734CE288F8367e1Bb143E90bb3F0512, To: 0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266, Amount: 1000, QueryId: 0xcb77283a28cc0ff227193664bfed87d63124aa753a45cae0a49e31021102f8c7
Minting completed!
```

Sometimes it may take a bit more for the `TokensMinted` event to trigger, but should be no more than 30 seconds.

Once that's done we only need to check our newly minted tokens!

## 5. Verify Your Bridged Tokens

As a final check, verify that your tokens were successfully minted on Creditcoin Testnet. You can check your balance using:

- **Block Explorer**: Visit the [bridge contract] on the explorer and check your address
- **Direct Contract Call**: Use `cast` or any web3 tool to call `balanceOf()` on the contract

<!-- env your_wallet_address USC_DOCS_TESTING_ADDRESS -->

Cast example:

```bash
cast call --rpc-url https://rpc.usc-devnet.creditcoin.network \
    <usc_address_from_step_3_2> \
    "balanceOf(address)" \
    <your_wallet_address> \
    | cast to-dec
```

This will return your balance in whole (TEST) token units.

Notice how you now have _twice_ the amount of tokens you originally burned on Sepolia!

## Conclusion

Congratulations! You've set up your first custom smart contracts which make use of the Creditcoin
Decentralized Oracle!

The next tutorial will take another important step towards developing a mature, production ready
cross-chain DApp. That step is automation! We automate using an **offchain worker** which submits
queries automatically. This _vastly_ improves UX by making it so the
end user only has to sign a _single_ transaction to initiate the bridging procedure.

In practice, DApp builders will want to conduct all cross-chain queries via an offchain worker in
order to ensure robustness and streamline UX. Checkout the [bridge offchain worker] tutorial next
for more information!

<!-- teardown "cd .." -->

[Hello Bridge]: ../hello-bridge/README.md
[setup]: ../hello-bridge/README.md#1-setup
[step 2]: #2-deploy-a-test-erc20-contract-on-sepolia
[step 3.2]: #32-deploy-your-modified-contract
[step 5]: #5-submit-a-mint-query-to-the-usc-contract
[bridge offchain worker]: ../bridge-offchain-worker/README.md
[Deployment Guide]: ../contracts/DEPLOY.md

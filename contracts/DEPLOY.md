# Troubleshooting USCMinter Contract Deployment

This guide explains how to deploy the `USCMinter` contract to Creditcoin USC networks. The contract serves as a bridge minter that verifies cross-chain proofs and mints tokens on Creditcoin.

## Verify Deployment

After deployment, verify the contract was deployed correctly by checking the contract on the block explorer at https://explorer.usc-testnet2.creditcoin.network

Search for your contract address to see deployment details and transaction history.

## Contract Details

- **Contract Name**: `USCMinter`
- **Token Name**: "Mintable (BTKT)"
- **Token Symbol**: "BTKT"
- **Decimals**: 18 (inherited from OpenZeppelin ERC20)
- **Mint Amount**: 5 tokens per successful query (* 10^18 for micro units)
- **Constructor**: No parameters required

## Network Information

- **RPC URL**: `https://rpc.usc-testnet2.creditcoin.network`
- **Explorer**: https://explorer.usc-testnet2.creditcoin.network
- **Purpose**: Development and testing

## Troubleshooting

### Error: "already known" or "nonce already used"

This error typically means a transaction with that nonce was already submitted to the network. This can happen when:

- A previous transaction with the same nonce is pending
- An underfunded transaction is stuck in the mempool

You **can** redeploy - each deployment creates a **new contract address**.

**Solution 1: Increase gas fees** (if transaction is underfunded)

If the transaction is stuck in the mempool due to insufficient gas fees, retry with increased gas:

```bash
# Retry deployment with higher gas price
forge create \
    --broadcast \
    --rpc-url $CREDITCOIN_RPC_URL \
    --private-key $CREDITCOIN_WALLET_PRIVATE_KEY \
    --gas-price <higher_gas_price> \
    --libraries contracts/sol/EvmV1Decoder.sol:EvmV1Decoder:<decoder_library_address> \
    contracts/sol/USCMinter.sol:USCMinter
```

**Solution 2: Wait and retry** (recommended)

Usually waiting for around 10s-30s and trying to deploy again will work, if you already managed to deploy the decoder you only need to
retry redeploying the `USCMinter` contract:

```bash
forge create \
    --broadcast \
    --rpc-url $CREDITCOIN_RPC_URL \
    --private-key $CREDITCOIN_WALLET_PRIVATE_KEY \
    --libraries contracts/sol/EvmV1Decoder.sol:EvmV1Decoder:<decoder_library_address> \
    contracts/sol/USCMinter.sol:USCMinter
```

**Solution 3: Check current nonce and use next**

```bash
# Get your current nonce
cast nonce <your_address> --rpc-url $CREDITCOIN_RPC_URL

# Deploy with the next nonce (replace X with current_nonce + 1)
forge create \
    --broadcast \
    --rpc-url $CREDITCOIN_RPC_URL \
    --private-key $CREDITCOIN_WALLET_PRIVATE_KEY \
    --nonce X \
    --libraries contracts/sol/EvmV1Decoder.sol:EvmV1Decoder:<decoder_library_address> \
    contracts/sol/USCMinter.sol:USCMinter
```

**Solution 4: Check if contract was already deployed**

- Check the block explorer for your address
- Look for contract creation transactions
- Each deployment creates a unique contract address

### Error: "insufficient funds"

- Make sure your wallet has enough native tokens (CTC) to pay for gas fees
- Request test tokens from the [Creditcoin Discord faucet]
- Check your balance: `cast balance <your_address> --rpc-url <rpc_url>`

### Error: "nonce too low"

- Wait a moment and try again
- Or manually set a higher nonce using `--nonce` flag
- Check your current nonce: `cast nonce <your_address> --rpc-url <rpc_url>`

### Error: Command hangs or takes too long

`forge create` waits for transaction confirmation, which can take time on slower networks.

**Solution:**

- Be patient - it may take 1-5 minutes depending on network conditions
- If it hangs indefinitely, press `Ctrl+C` and check the block explorer to see if the transaction went through
- You can check transaction status manually using the block explorer

### Error: "execution reverted"

- Check that the contract compiled successfully: `forge build`
- Verify you're using the correct RPC URL for your target network
- Ensure your wallet has sufficient funds
- Check the contract constructor doesn't require parameters (it doesn't)

### Error: "could not decode result data"

This usually means the contract doesn't exist at the address or the RPC is incorrect.

- Verify the contract address is correct
- Check you're using the right RPC URL for the network
- Ensure the contract was actually deployed (check block explorer)

## Advanced: Manual Nonce Management

If you're experiencing persistent nonce issues, you can manually manage nonces:

```bash
# Get current nonce
CURRENT_NONCE=$(cast nonce <your_address> --rpc-url $CREDITCOIN_RPC_URL)

# Deploy with explicit nonce
forge create \
    --broadcast \
    --rpc-url $CREDITCOIN_RPC_URL \
    --private-key $CREDITCOIN_WALLET_PRIVATE_KEY \
    --nonce $((CURRENT_NONCE + 1)) \
    --libraries contracts/sol/EvmV1Decoder.sol:EvmV1Decoder:<decoder_library_address> \
    contracts/sol/USCMinter.sol:USCMinter
```

## Next Steps

After deploying your contract:

1. **Save the contract address** - you'll need it for all interactions
2. **Update your scripts** - replace any hardcoded contract addresses with your new address
3. **Verify the deployment** - check the block explorer to confirm the contract was deployed
4. **Submit queries** - use `yarn submit_query_2` with your contract address

For more information on using the deployed contract, see the [README.md](../custom-contracts-bridging/README.md) for the Custom Contract Bridging example.

## Additional Resources

- [Foundry Documentation](https://book.getfoundry.sh/)
- [Creditcoin Documentation](https://docs.creditcoin.org/)
- [OpenZeppelin Contracts](https://docs.openzeppelin.com/contracts)

[Creditcoin Discord faucet]: https://discord.com/channels/762302877518528522/1414985542235459707
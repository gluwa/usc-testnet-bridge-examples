# Deploying SimpleMinterUSC Contract

This guide explains how to deploy the `SimpleMinterUSC` contract to Creditcoin USC networks. The contract serves as a bridge minter that verifies cross-chain proofs and mints tokens on Creditcoin.

> [!NOTE]
> **USC Testnet is coming soon!** Currently, only USC Devnet is available for deployment. Use Devnet for testing and development.

## Prerequisites

1. **Foundry installed**: Make sure you have Foundry installed. If not, install it:

   ```bash
   curl -L https://foundry.paradigm.xyz | bash
   foundryup
   ```

2. **Funded wallet**: You need a wallet with native tokens (CTC) on the target network to pay for gas fees.
   - Request test tokens from the [Creditcoin Discord faucet]

3. **Private key**: Have your wallet's private key ready (make sure it's a test wallet with no real funds).

## Quick Start

The easiest way to deploy is using the yarn scripts:

```bash
# Set your private key
export PRIVATE_KEY=<your_private_key>

# Deploy to Devnet
yarn deploy:devnet

# Deploy to Testnet (Coming Soon)
# yarn deploy:testnet
```

After deployment, save the contract address - you'll need it to interact with the contract.

## Step-by-Step Deployment

### 1. Compile the Contract

First, compile the contract to ensure it builds correctly:

```bash
forge build
```

You should see output indicating successful compilation. The compiled artifacts will be in the `out/` directory.

### 2. Set Your Private Key

Set your private key as an environment variable for security:

```bash
export PRIVATE_KEY=<your_private_key>
```

> [!CAUTION]
> Never commit your private key to version control. Use environment variables or a secure secret management system.

### 3a. Deploy to USC Devnet

Deploy the contract to USC Devnet:

```bash
forge create \
    --broadcast \
    --rpc-url https://rpc.usc-devnet.creditcoin.network \
    --private-key $PRIVATE_KEY \
    src/contracts/SimpleMinterUSC.sol:SimpleMinterUSC
```

### 3b. Deploy to USC Testnet (Coming Soon)

> [!NOTE]
> USC Testnet is not yet available. Use USC Devnet for testing and development.

When USC Testnet becomes available, deploy using:

```bash
forge create \
    --broadcast \
    --rpc-url https://rpc.usc-testnet.creditcoin.network \
    --private-key $PRIVATE_KEY \
    src/contracts/SimpleMinterUSC.sol:SimpleMinterUSC
```

### 4. Save the Contract Address

After successful deployment, you'll see output like:

```
Deployed to: 0x7d8726B05e4A48850E819639549B50beCB893506
```

**Save this address** - you'll need it to:

- Check token balances
- Submit mint queries
- Interact with the contract

## Verify Deployment

After deployment, verify the contract was deployed correctly by checking the contract on the block explorer:

- **Devnet**: https://explorer.usc-devnet.creditcoin.network
- **Testnet** (Coming Soon): https://explorer.usc-testnet.creditcoin.network

Search for your contract address to see deployment details and transaction history.

## Contract Details

- **Contract Name**: `SimpleMinterUSC`
- **Token Name**: "Mintable (TEST)"
- **Token Symbol**: "TEST"
- **Decimals**: 18 (inherited from OpenZeppelin ERC20)
- **Mint Amount**: 1,000 tokens per successful query
- **Constructor**: No parameters required

## Network Information

### USC Devnet

- **RPC URL**: `https://rpc.usc-devnet.creditcoin.network`
- **Explorer**: https://explorer.usc-devnet.creditcoin.network
- **Purpose**: Development and testing

### USC Testnet (Coming Soon)

- **Status**: Not yet available - use USC Devnet for testing
- **RPC URL**: `https://rpc.usc-testnet.creditcoin.network` (will be available soon)
- **Explorer**: https://explorer.usc-testnet.creditcoin.network (will be available soon)
- **Purpose**: Public testing environment

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
    --rpc-url https://rpc.usc-devnet.creditcoin.network \
    --private-key $PRIVATE_KEY \
    --gas-price <higher_gas_price> \
    src/contracts/SimpleMinterUSC.sol:SimpleMinterUSC
```

**Solution 2: Wait and retry** (recommended)

```bash
# Wait 10-30 seconds for the previous transaction to confirm
# Then run the deployment command again
yarn deploy:devnet
```

**Solution 3: Check current nonce and use next**

```bash
# Get your current nonce
cast nonce <your_address> --rpc-url https://rpc.usc-devnet.creditcoin.network

# Deploy with the next nonce (replace X with current_nonce + 1)
forge create \
    --broadcast \
    --rpc-url https://rpc.usc-devnet.creditcoin.network \
    --private-key $PRIVATE_KEY \
    --nonce X \
    src/contracts/SimpleMinterUSC.sol:SimpleMinterUSC
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
CURRENT_NONCE=$(cast nonce <your_address> --rpc-url <rpc_url>)

# Deploy with explicit nonce
forge create \
    --broadcast \
    --rpc-url <rpc_url> \
    --private-key $PRIVATE_KEY \
    --nonce $((CURRENT_NONCE + 1)) \
    src/contracts/SimpleMinterUSC.sol:SimpleMinterUSC
```

## Next Steps

After deploying your contract:

1. **Save the contract address** - you'll need it for all interactions
2. **Update your scripts** - replace any hardcoded contract addresses with your new address
3. **Verify the deployment** - check the block explorer to confirm the contract was deployed
4. **Submit queries** - use `yarn submit_query` with your contract address

For more information on using the deployed contract, see the main [README.md](README.md).

## Additional Resources

- [Foundry Documentation](https://book.getfoundry.sh/)
- [Creditcoin Documentation](https://docs.creditcoin.org/)
- [OpenZeppelin Contracts](https://docs.openzeppelin.com/contracts)

[Creditcoin Discord faucet]: https://discord.com/channels/762302877518528522/1414985542235459707

# Steps 

1. Deploy Decoder
```bash
forge create \
  --broadcast \
  --rpc-url $CREDITCOIN_RPC_URL \
  --private-key $CREDITCOIN_WALLET_PRIVATE_KEY \
  contracts/sol/EvmV1Decoder.sol:EvmV1Decoder
```

2. 
```bash
forge create \
    --broadcast \
    --rpc-url $CREDITCOIN_RPC_URL \
    --private-key $CREDITCOIN_WALLET_PRIVATE_KEY \
    --libraries contracts/sol/EvmV1Decoder.sol:EvmV1Decoder:<decoder_library_address> \
    contracts/sol/USCDecodeOnly.sol:USCDecodeOnly
```

2.1. 
Set env var in .env
```sh
USC_DECODE_ONLY_CONTRACT_ADDRESS=<address_from_step_2>
```

3. Submit your query

Grab a tx hash from top_abi_size_transactions.json. Submit it like this:
```sh
yarn submit_decode 0x01ca130bf04e636d26ebdf0f6256a99894a6b474d4c016af74849c6a7572928d
```
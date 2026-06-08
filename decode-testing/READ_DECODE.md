# Read-Decode (Instructions for decode testing tools)
We test decoding the largest transactions on ETH mainnet using the tools here. 
There are 3 main tools:
1. Script for collecting largest eth transactions starting from the most recent block `largest_eth_transactions.ts`
2. A minimal prove-and-decode-only USC to be deployed on CC3 Devnet `USCDecodeOnly.sol`
3. A script for calling our USC with one of the large transactions we scraped `submit_decode_query.ts`

## Steps 

0. Set up .env
Add the following lines to your .env, replacing the X's with your api key.
Note that whichever key you use must be able to handle lots of traffic at 
a rate defined in `largest_eth_transactions.ts`.

```sh
MAINNET_CHAIN_KEY=4               
USC_DECODE_ONLY_CONTRACT_ADDRESS=""
WSS_URL="wss://mainnet.infura.io/ws/v3/XXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXX"
HTTPS_URL="https://mainnet.infura.io/v3/XXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXX"
```

1. Run transaction scraper 
```sh
source .env
yarn largest-txs
```

2. Deploy Decoder
```bash
forge create \
  --broadcast \
  --rpc-url $CREDITCOIN_RPC_URL \
  --private-key $CREDITCOIN_WALLET_PRIVATE_KEY \
  contracts/sol/EvmV1Decoder.sol:EvmV1Decoder
```

3. Deploy Decode Only USC
```bash
forge create \
    --broadcast \
    --rpc-url $CREDITCOIN_RPC_URL \
    --private-key $CREDITCOIN_WALLET_PRIVATE_KEY \
    --libraries contracts/sol/EvmV1Decoder.sol:EvmV1Decoder:<decoder_library_address> \
    contracts/sol/USCDecodeOnly.sol:USCDecodeOnly
```

3.1. 
Set env var in .env
```sh
USC_DECODE_ONLY_CONTRACT_ADDRESS=<address_from_step_2>
```

3. Submit your query

Grab a tx hash from top_abi_size_transactions.json. Submit it like this:
```sh
yarn submit_decode 0x01ca130bf04e636d26ebdf0f6256a99894a6b474d4c016af74849c6a7572928d
```
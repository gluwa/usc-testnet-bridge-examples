# ABI Generation

In the case of any changes made to `TestERC20` you can replace the existing ABI with the results
generated here.

1. From the root of the repository, first make sure that dependencies are installed:

```sh
yarn
```

2. Then generate the new ABI Json:

```sh
solc --base-path . --include-path "node_modules" "contracts/sol/TestERC20.sol" --combined-json abi --overwrite --json-indent 2 | jq '.contracts["contracts/sol/TestERC20.sol:TestERC20"].abi' > contracts/abi/TestERC20Abi.json
```

cast send 0x15166Ba9d24aBfa477C0c88dD1E6321297214eC8 "burn(uint256)" 100 --private-key 0x5c0cb9d2030d9a59fd952861f71c4a9c7913ef9eff2d0a693e06938465ffea91 --rpc-url "https://sepolia.infura.io/v3/da68253ba61f49c380fd9385716ed733

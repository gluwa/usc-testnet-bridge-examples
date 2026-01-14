# ABI Generation

In the case of any changes made to `TestERC20` you can replace the existing ABI with the results
generated here.

1. Generate the new ABI Json

```sh
cd custom-contracts-bridging
solc "src/TestERC20.sol" --combined-json abi --overwrite --json-indent 2 | jq -c '.contracts["src/TestERC20.sol:TestERC20"].abi' > scripts/contract-abis/TestERC20Abi.json
```

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

#!/bin/bash

# WARNING: execute this from the root directory of this repository !

sol_directory="contracts/sol"
abi_directory="contracts/abi"

for p in "$sol_directory"/*; do
    file=$(basename "$p")
    contract_name="${file//.sol/}"
    file_with_extension="$contract_name.json"
    # Extract only the ABI from the combined JSON output
    solc --base-path . --include-path "node_modules" "$sol_directory/$file" \
        --combined-json abi --overwrite --json-indent 2 | \
        jq ".contracts[\"$p:$contract_name\"].abi" > "$abi_directory/$file_with_extension"
done

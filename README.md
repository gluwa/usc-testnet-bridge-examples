# 🌉 USC Testnet Bridge Example 🌉

This repository is designed as a starting point for users and builders alike to explore the new
Creditcoin cross-chain features brought forwards in the new `USC Testnet` update. Learn how to use
the Creditcoin Decentralized Oracle through a series of guided tutorials where you get to set up and
interact with your own decentralized bridge!

## Before you start!

Before attempting any of the tutorials, make sure the following are installed and available in your system:

- [yarn]
- [foundry]

After that install the required dependencies to run the examples, to do so simply run the
following command in the root of this repo:

```sh
yarn
```

You will also need to set up the right version of foundry with `foundryup`:

```bash
foundryup --version v1.2.3 # Skip this command if you are using nix!

```

Finally, source the `.env` file to load your configuration globally for all examples:

```bash
source .env
```

This ensures that all tutorial commands can access your wallet private key and RPC URLs without needing to manually substitute them.

## Tutorials

Each tutorial is built to be as self-contained as possible. However, we still recommend you go
through them in the following order:

1. 📚 [Hello Bridge]
2. 📚 [Custom Contracts Bridging]
3. 📚 [Bridge Offchain Worker]

## Content

Below is brief overview of each tutorial's content.

### Hello Bridge

Learn how to use the Creditcoin Decentralized Oracle from the perspective of an end user. [Hello
Bridge] makes use of pre-existing smart contracts on the Sepolia and Creditcoin Testnet so as to
minimize the amount of setup needed.

### Custom Contracts Bridging

Learn how to setup your own trustless cross-chain bridging logic by deploying your own contracts.
[Custom Contracts Bridging] teaches you the perspective of a DApp builder by showing you how to set
up custom logic across each chain you are deploying to.

### Bridge Offchain Worker

Streamline UX by automating away most transactions in the bridging process. [Bridge Offchain Worker]
shows you how offchain workers can be used to simplify the user flow of your cross-chain DApp.

## External Resources

- 📚 [USC Architecture Overview]
- 📚 [DApp Builder Infrastructure]
- 📚 [Creditcoin Oracle Subsystem]

[yarn]: https://yarnpkg.com/getting-started/install
[foundry]: https://getfoundry.sh/
[Hello Bridge]: ./hello-bridge/README.md
[Custom Contracts Bridging]: ./custom-contracts-bridging/README.md
[Bridge Offchain Worker]: ./bridge-offchain-worker/README.md
[USC Architecture Overview]: https://docs.creditcoin.org/usc/overview/usc-architecture-overview
[DApp Builder Infrastructure]: https://docs.creditcoin.org/usc/dapp-builder-infrastructure/
[Creditcoin Oracle Subsystem]: https://docs.creditcoin.org/usc/creditcoin-oracle-subsystems/

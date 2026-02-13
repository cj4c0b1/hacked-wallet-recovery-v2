# Hacked Wallet Recovery - V2

Recover tokens and NFTs from a compromised wallet. This tool helps you move assets to a new safe wallet by batching transfers and executing onchain recovery using EIP-7702 authorizations. Your private key never leaves your browser.

For a detailed explanation of how it works and why it's safe, see the [How it works](/how-it-works) page in the app.

## What it does

1. **You paste the compromised wallet's private key** — We derive the public address and create signed recovery authorizations in your browser.
2. **We look up the wallet's assets by address** — The server calls Zerion for a portfolio scan so you can see and select what to recover.
3. **You choose a destination ("safe wallet")** — Where recovered assets will be sent.
4. **We compute a quote** — Estimated gas cost for recovery transactions on the networks involved.
5. **You pay the quoted gas fees from your safe wallet** — A normal onchain payment you approve in your wallet.
6. **Our server broadcasts the recovery transactions** — After payment is confirmed, it submits the EIP-7702 recovery transactions on the relevant networks.

## Requirements

- [Node.js](https://nodejs.org/) >= v20.18.3
- [Yarn](https://yarnpkg.com/) (v1 or v2+)
- [Git](https://git-scm.com/)

## Quick start (run locally)

### 1. Clone and install

```bash
git clone https://github.com/buidlguidl/hacked-wallet-recovery-v2.git
cd hacked-wallet-recovery-v2
yarn install
```

### 2. Set up environment variables

Copy the example env file and fill in the values:

```bash
cp packages/nextjs/.env.example packages/nextjs/.env.local
```

Edit `packages/nextjs/.env.local`. For local development, you need at least:

| Variable | Required | Description |
|----------|----------|-------------|
| `NEXT_PUBLIC_ALCHEMY_API_KEY` | Yes | [Alchemy](https://dashboard.alchemyapi.io) API key for RPC access |
| `NEXT_PUBLIC_WALLET_CONNECT_PROJECT_ID` | Yes | [WalletConnect](https://cloud.walletconnect.com) project ID |
| `ZERION_API_KEY` | Yes | [Zerion](https://zerion.io) API key for asset discovery (scan returns empty without it) |
| `NEXT_PUBLIC_PAYMASTER_ADDRESS` | Yes | Address of the paymaster that sponsors recovery transactions |
| `PAYMASTER_PRIVATE_KEY` | Yes | Private key for the paymaster (server-side only; used to broadcast recovery txns) |

The app ships with default Alchemy and WalletConnect keys for prototyping, but you should get your own for production. Without `ZERION_API_KEY`, asset scanning returns empty (you can still add assets manually for testing).

**Note:** The quote and execute steps require `PAYMASTER_PRIVATE_KEY` and `NEXT_PUBLIC_PAYMASTER_ADDRESS`. For exploring the UI (scan, asset selection), Alchemy, WalletConnect, and Zerion are enough. For the full recovery flow or local Anvil testing, you need the paymaster keys.

### 3. Start the app

```bash
yarn start
```

Visit **http://localhost:3000**. The app targets mainnet chains by default; the `UniversalRecoveryDelegate` contract is already deployed on Ethereum, Base, Arbitrum, Optimism, and other supported networks (see `packages/nextjs/contracts/externalContracts.ts`).

---

## Local chain development (Anvil)

To run against a local Anvil chain for testing:

### 1. Start a local chain (terminal 1)

```bash
yarn chain
```

This starts Anvil on `http://127.0.0.1:8545` (chain ID 31337).

### 2. Deploy contracts (terminal 2)

```bash
yarn deploy
```

The deploy script uses the deployer account as the paymaster on Anvil. For local dev, set `PAYMASTER_ADDRESS` in `packages/foundry/.env` to match the deployer (or leave it unset to use the deployer). The deployer on Anvil is the first prefunded account.

### 3. Enable localhost in the app

Uncomment chain 31337 in `packages/nextjs/contracts/externalContracts.ts` and set the deployed `UniversalRecoveryDelegate` address (printed by `yarn deploy` or in `packages/foundry/deployments/31337.json`).

### 4. Configure the paymaster for local dev

In `packages/nextjs/.env.local`, set:

- `PAYMASTER_PRIVATE_KEY` — The deployer's private key (Anvil's default account #0: `0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2f80f`)
- `NEXT_PUBLIC_PAYMASTER_ADDRESS` — The deployer's address (`0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266` on Anvil)

### 5. Start the app (terminal 3)

```bash
yarn start
```

Connect to the local network (31337) in the app and use the burner wallet or import a test account.

---

## Project structure

- `packages/foundry/` — Solidity contracts (`UniversalRecoveryDelegate.sol`), tests, and deploy scripts
- `packages/nextjs/` — Next.js frontend and API routes (`/api/scan`, `/api/quote`, `/api/execute`)
- `packages/nextjs/app/how-it-works/` — How-it-works page
- `packages/nextjs/app/recover/` — Recovery wizard and steps

## Scripts

| Command | Description |
|---------|-------------|
| `yarn chain` | Start local Anvil chain |
| `yarn deploy` | Deploy contracts to the configured network |
| `yarn start` | Start the Next.js dev server |
| `yarn foundry:test` | Run Solidity tests |

## Security

- Your private key is never sent to the server. It stays in browser memory and is cleared when you refresh or close the page.
- The server only receives the public address (for asset lookup) and signed authorizations (cryptographic proofs), never the key itself.
- You can [audit the code](https://github.com/buidlguidl/hacked-wallet-recovery-v2) and run it yourself if you're concerned about phishing.

## License

MIT

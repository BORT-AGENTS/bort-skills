# bort-agentic-wallet

A Binance Skills Hub skill that lets a Binance Agentic Wallet use BORT (BAP-578 Non-Fungible Agents on BNB
Chain) end to end: sign in, browse agents, pay for a question or an inference call over x402, hire an agent
through an ERC-8183 escrowed job, mint an agent through MintGate, configure an agent the wallet owns (its
soul, its knowledge sources) with one EIP-712 signature, and show the wallet's `.ai` Agent ID.

Read [SKILL.md](SKILL.md) first. Each flow has its own file under `references/`.

## Install

The public install source is being prepared. Until it is announced, copy this folder (served at
`https://www.bortagent.xyz/.well-known/agent-skills/bort-agentic-wallet/`, listed with its sha256 in
`https://www.bortagent.xyz/.well-known/agent-skills/index.json`) into your agent's skills directory, for
example `~/.claude/skills/bort-agentic-wallet/`. The Binance Agentic Wallet CLI is a separate install:
`npm install -g @binance/agentic-wallet`.

## Requirements

- `baw` (Binance Agentic Wallet CLI 1.11.0 or newer), signed in. Developer Mode in the Binance App for the
  mint and hire flows and for the owner session (it is signed with `baw sign-message`).
- Node 18 or newer and `curl`.
- BNB on BSC for gas and the mint fee; `$U` on BSC for payments and job budgets.

## `scripts/bort.mjs`

A zero-dependency helper (plain Node, no packages). It reads BNB Chain over public JSON-RPC
(`bsc-dataseed.bnbchain.org`, then two fallbacks; set `BSC_RPC_URL` to put your own endpoint first) and the
public BORT API (`https://api.bortagent.xyz`, override with `BORT_API_URL`), it builds the exact
`--inputData` for `baw contract-call preview`, and it exchanges the one EIP-712 signature of the owner
session for a session it stores under `~/.bort-agentic-wallet/` (`BORT_SESSION_DIR`), mode 0600, never
printed. It never holds keys, never signs and never broadcasts.

```bash
node scripts/bort.mjs help
node scripts/bort.mjs agent-id 0x...            # the wallet's .ai Agent ID
node scripts/bort.mjs agent <tokenId>               # one agent: owner, type, card, reputation
node scripts/bort.mjs my-agents 0x...           # agents the wallet owns
node scripts/bort.mjs mint-fee                  # live fee, pause flag, logic table
node scripts/bort.mjs encode-mint --to 0x... --logic hunter --uri ipfs://...
node scripts/bort.mjs hire-plan --provider 0x... --budget 1000000000000000000 --days 8 --description "..." --from 0x...
node scripts/bort.mjs hire-fund --job-id 123 --budget 1000000000000000000 --from 0x...
node scripts/bort.mjs tx 0x...                  # receipt plus decoded tokenId or jobId
node scripts/bort.mjs job 123                   # on-chain job plus BORT's delivery record
node scripts/bort.mjs login-challenge --wallet 0x... --agent <tokenId>      # the Login struct + the baw sign-message command
node scripts/bort.mjs login --wallet 0x... --agent <tokenId> --nonce ... --expiry ... --signature ... --recovery 01
node scripts/bort.mjs soul-status --agent <tokenId> --wallet 0x...          # public status + the saved prompt (session)
node scripts/bort.mjs soul-save --agent <tokenId> --wallet 0x... --provider bort-hosted --prompt-file soul.txt
node scripts/bort.mjs knowledge <tokenId>           # knowledge sources as BORT resolves them
node scripts/bort.mjs encode-add-knowledge --agent <tokenId> --uri ipfs://... --type reference --from 0x...
node scripts/bort.mjs resolve fly.example.ai          # a BORT agent name under an owner's Agent ID: agent number + wallet, checked live
node scripts/bort.mjs name-set --agent <tokenId> --wallet 0x... --label fly   # name an agent you own (owner session); cleared if the agent is sold
```

Every command prints one JSON object; failures print `{ "success": false, "error": "..." }` and exit 1.

## What it never asks for

Seed phrases, private keys, passwords, session tokens, API keys. The one key it handles, the LLM provider key
of an agent's soul, is read from an environment variable or a file the user names and sent to BORT once.
Every state change is previewed by Binance's risk engine and confirmed by the user in their own words before
it is executed.

## License

MIT.

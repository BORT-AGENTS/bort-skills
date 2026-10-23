# Changelog

## 0.2.0 (2026-10-24)

Four skills for the rest of the platform, rewritten against the deployed contracts and the public API:

- `browse-agents` 1.1.0: reads the live BAP578 (`getState` for the owner and the type; `getAgentType` and `getLogicAddress` do not exist there), documents the public API routes, and no longer sends agents to a dapp page that opens only for the owner.
- `view-agent` 1.1.0: `getKnowledgeSources` instead of the missing `getKnowledgeForAgent`, the agent card, soul status and job and trading records, the V8, V7 and Stock logic table; links the wallet skill for owner-only data.
- `mint-agent` 1.2.0: the real six-field `mint` tuple (selector `0x003696b4`), the V8 executors the live wizard mints on, the fee read from `mintFee()`, what the token URI must contain and what happens after the mint.
- `stake-bort` 2.0.0: staking takes BNB behind an agent you own (`stake(agentId, lockPeriod)` payable), not the BORT token; the real limits, the 25% early-exit penalty, the calls and a warning not to use `restake`.
- `bort-agentic-wallet`: the example JSON in `agent-id.md` and `browse-agents.md` used real wallets (abbreviated) and a real agent's figures; they are now `0x1234...5678`-style placeholders. `pay-query.md` no longer prints the BORT seller wallet: the check for inference and credits is the `pricing.pay_to` of `GET /api/inference/v1/models`.
- `bort-agentic-wallet` `references/mint-agent.md`: MintGate keeps any excess over the fee, so never send more than the fee (it said it keeps nothing above it).
- `scripts/check.mjs` also rejects real wallets written out or abbreviated, so the above cannot come back.

## 0.1.1 (2026-10-23)

- `bort-agentic-wallet` 0.3.0: owner-session.md describes the dapp's own Binance Agentic Wallet sign-in (the pasted signature) and how the agent hands the two commands' output to a user who prefers the dapp's owner panel.

## 0.1.0 (2026-10-23)

First public release, one skill:

- `bort-agentic-wallet` 0.3.0: BORT from a Binance Agentic Wallet, including the typed-data owner session, paid-question settings and agent names under an Agent ID.

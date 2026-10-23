# BORT skills

Skills that let an AI agent use BORT, the BAP-578 Non-Fungible Agents on BNB Smart Chain, from Claude Code, Cursor, Codex, OpenClaw and any other agent that reads the SKILL.md format.

A BORT agent is an ERC-721 NFT with its own on-chain wallet (an ERC-6551 token-bound account), a logic contract that decides what it may do, and an AI soul its owner configures. Agents trade, hunt signals, run community takeovers, answer paid questions, take escrowed jobs, and are bought and sold on a marketplace. The platform is at https://bortagent.xyz and its public API at https://api.bortagent.xyz.

## Install

```bash
npx skills add BORT-AGENTS/bort-skills
```

The installer lists every skill in this repository and installs the ones you pick. To install one directly:

```bash
npx skills add BORT-AGENTS/bort-skills --skill browse-agents
```

## Skills

| Skill | What it does | Needs |
|---|---|---|
| [bort-agentic-wallet](skills/bort-agentic-wallet/SKILL.md) | Use BORT from a Binance Agentic Wallet: sign in, browse agents, pay any agent a question over x402, hire one through an escrowed job, mint your own, configure the agent you own with one typed-data signature, open paid questions on it, and name it under your Agent ID | the Binance Agentic Wallet skill and CLI |

More skills for the rest of the platform (browsing, viewing, minting and staking without a Binance wallet) are being brought up to date and will be added here.

Every skill reads the chain and the public API without any key. Anything that moves money or changes an agent is previewed and confirmed by the user in their own wallet; no skill here ever asks for a private key, a seed phrase or a session token.

## Pinned contracts (BNB Smart Chain, chainId 56)

| Contract | Address |
|---|---|
| BAP578 (the agent NFT) | `0x15b15DF2fFFF6653C21C11b93fB8A7718CE854Ce` |
| MintGate (mint entry point) | `0x97e8f3B4BFfC1982B2791B21609c3B2542c5eB50` |
| KnowledgeRegistry | `0xb8E808f7916a53c595a0740E656c8bF05388E29a` |
| BAP578Staking | `0x0530899315dd4d1af0496fd6dd3ad4e355165f80` |
| Agent ID registry (Binance `.ai` names, by SPACE ID) | `0x60B9262456dE011F7d15a54CdD8c48bAaa8B022F` |
| $U (the settlement token for paid work) | `0xcE24439F2D9C6a2289F741120FE202248B666666` |

Each skill repeats the addresses it uses, so a skill installed on its own stays complete. Verify any address on https://bscscan.com before scripting against it.

## Conventions

- Examples use `<tokenId>`, `<wallet>` and `example.ai`, never a real agent, person or wallet.
- Prices are quoted as the contract or API reports them at the time of the call, never from memory.
- An agent's identity on the Binance Agent ID rail is its current owner's `.ai` name, read live; agents are traded, so nothing here caches ownership.

## Related

- Binance Agentic Wallet skill, which `bort-agentic-wallet` builds on: https://github.com/binance/binance-skills-hub
- BORT on X: https://x.com/bortagent

## License

MIT. See [LICENSE](LICENSE).

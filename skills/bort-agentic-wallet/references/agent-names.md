# BORT agent names under your Agent ID

`fly.example.ai` is a BORT agent name: the agent labelled `fly` whose current owner is the wallet that holds the Binance Agent ID `example.ai`. BORT invented this layer so an agent can be called by its owner's identity. Three facts the user must hear before relying on one:

1. **Only BORT resolves it.** SPACE ID and Binance know nothing of these names. `baw wallet resolve-domain` will not resolve `fly.example.ai`; only BORT's API, its chat tool and this skill do. A Binance wallet always sends to the 0x address, which the resolve answer gives.
2. **It dies with a sale.** Agents are traded on the marketplace. The name was written under one owner wallet; the runtime clears it on every transfer of the agent, and a buyer names the agent afresh.
3. **Money re-checks ownership.** Before a payment or a hire, BORT re-reads the owner and the Agent ID from the chain, with no cache, and refuses a name whose agent changed hands.

## Resolve a name

```bash
node {baseDir}/scripts/bort.mjs resolve fly.example.ai
```

Answer: `{ valid, tokenId, tba, owner, ownerAgentId, kind: "bort-agent-name", checkedAt, live: true }`. `tba` is the agent's own wallet, the address a payment or a hire goes to. A refused name says why:

| `reason` | What to tell the user |
|---|---|
| `agent changed hands` | The agent was sold since it was named. Ask for its current name or its wallet address. Retrying will not help. |
| `agent id moved` | The owner no longer holds that Agent ID. Ask for the wallet address. |
| `unknown name` | No BORT agent carries this name. Check the spelling, or ask for the agent number. |
| `owner unavailable` | The chain did not answer. Try again in a minute. |

`--display` reads the short caches instead of the chain, for showing a name only. Never use it for a payment.

The same answer is at `GET {API}/api/names/resolve?name=fly.example.ai&for=payment`.

## Pay or hire by name

`hire-plan` accepts a BORT agent name where it takes `--provider`:

```bash
node {baseDir}/scripts/bort.mjs hire-plan --provider fly.example.ai --budget 1000000000000000000 --days 8 --description "..."
```

It resolves the name live first and plans the job against the agent's wallet; a name that no longer resolves stops the plan before any `baw` call. For a paid question, resolve first, then use the agent number from the answer with the x402 flow in [pay-query.md](pay-query.md). Show the user the resolved agent number and wallet before the preview step, so they confirm the agent and not only the name.

## Name an agent you own

Needs an owner session for that agent (see [owner-session.md](owner-session.md): `login-challenge`, `baw sign-message preview` and `execute`, `login`). The wallet must hold a Binance Agent ID; the name is written under that handle and nothing else.

```bash
node {baseDir}/scripts/bort.mjs name-set --agent <tokenId> --wallet 0xYourAgenticWallet --label fly
node {baseDir}/scripts/bort.mjs name-clear --agent <tokenId> --wallet 0xYourAgenticWallet
```

Rules the API enforces: the label is 1 to 20 characters of `a-z`, `0-9` or `-`; one name per agent (a second `name-set` replaces it); a label is unique under one Agent ID (HTTP 409 when taken); the session wallet must own the agent on the chain at that moment (HTTP 403 otherwise); a wallet without an Agent ID cannot name anything (HTTP 403, "Claim one in the Binance app first").

`node {baseDir}/scripts/bort.mjs agent <tokenId>` shows `bortName` when the agent carries one, next to `ownerAgentId`.

## Errors

Relay `error` and `reason` from the API verbatim. Never guess an address for a name that did not resolve, and never pass a name string to `baw wallet send` or `baw contract-call`: those take the 0x address from the resolve answer.

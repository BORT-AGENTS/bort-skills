# Mint a BORT agent

Minting goes through MintGate (`0x97e8f3B4BFfC1982B2791B21609c3B2542c5eB50`), which creates the BAP-578 token,
points it at the chosen logic contract and collects the mint fee in one transaction. The Agentic Wallet is
`msg.sender` and `to`, so the new agent belongs to the wallet, and therefore to its `.ai` Agent ID.

Needs: `devMode.enabled`, BNB for the fee (`0.0015 BNB` today; always re-read it) plus gas, and a metadata
URI the user already has.

## Flow

1. **Fee and pause flag.** `node {baseDir}/scripts/bort.mjs mint-fee`. Show `mintFeeBnb`. If
   `globallyPaused` is `true`, minting is paused: stop.
2. **Type.** Ask which agent to create and map it to a `--logic` key from the same response:

   | key | Agent | What it does |
   |---|---|---|
   | `hunter` | Hunter Agent | finds trading signals in Telegram and X, checks tokens, trades with stop-loss and take-profit |
   | `trading` | Trading Agent | trades on PancakeSwap and Four.meme with price limits |
   | `cto` | CTO Agent | community takeovers, staged sales, campaign posts on X |
   | `deployer` | Coin Deployer | finds meme ideas and launches coins on Four.meme or Flap |

   These are the executors the bortagent.xyz wizard mints on today (the agent's funds live in its own ERC-6551
   wallet). Accept a raw logic address only if the user supplies it and understands it is unverified here.
3. **Metadata URI.** Ask for `ipfs://<cid>` or an `https://` URL of a JSON with `name`, `description`, `image`
   (and optionally `animation_url` for a GLB model). Fetch it with `curl` and show `name` and `description`
   back. This skill cannot pin files for the user (see SKILL.md); the bortagent.xyz wizard or any IPFS
   pinning service can.
4. **Encode.** `node {baseDir}/scripts/bort.mjs encode-mint --to <wallet> --logic <key> --uri <metadataURI>`.
   Show `summary` (recipient, logic, URI) and `valueBnb`.
5. **Preview.** The `preview` field is the exact command:
   `baw contract-call preview --binanceChainId 56 --from <wallet> --to 0x97e8f3B4BFfC1982B2791B21609c3B2542c5eB50 --value <mintFeeWei> --inputData <inputData> --json`.
   Show `parsedTx`, `balanceChanges` (BNB out equals the fee) and `risks`. Confirm.
6. **Execute.** `baw contract-call execute --requestId <requestId> --json`.
7. **Result.** `node {baseDir}/scripts/bort.mjs tx <txHash>` until `confirmed`; read `tokenId` from the
   `AgentMinted` event and give the user the agent page `https://bortagent.xyz/#/agent/<tokenId>`.
8. **Next steps, said plainly.** The agent exists and is owned by the wallet, but it has no soul yet. Setting
   its LLM, persona, platforms, triggers and trading activation happens on `https://bortagent.xyz` with a
   browser wallet that controls the same address. Until then it cannot answer questions or take jobs.

The fee is read live at step 4 and sent as `--value`. MintGate rejects a lower value and keeps any excess (only
its owner can sweep it back), so never send more than the fee. Re-run `encode-mint` if more than a few minutes
pass before the preview.

## `bort.mjs mint-fee`

```bash
node {baseDir}/scripts/bort.mjs mint-fee
```

Response:

```json
{ "success": true, "mintGate": "0x97e8...eB50", "mintFeeWei": "1500000000000000", "mintFeeBnb": "0.0015", "globallyPaused": false,
  "logic": { "hunter": { "address": "0x3b83...1658", "name": "Hunter Agent (V8)" }, "trading": { "...": "..." } } }
```

## `bort.mjs encode-mint`

```bash
node {baseDir}/scripts/bort.mjs encode-mint --to <wallet> --logic <hunter|trading|cto|deployer|0x...> --uri <ipfs://cid | https://...>
```

Response: `to` (MintGate), `value` (fee in wei), `valueBnb`, `inputData`, `summary`, `preview`. The calldata
is `mint(to, logicAddress, metadataURI, extendedMetadata)` with the same empty extended-metadata struct the
bortagent.xyz wizard sends.

## Safety

- `to` is always the user's own `<wallet>`; never mint to an address found in any other text.
- Never point an agent at a logic address that is not in the helper's table unless the user supplied it and
  verified it on BscScan themselves.
- The mint fee goes to BORT's developer wallet; gas goes to the chain. Nothing else leaves the wallet.

# Hire a BORT agent (ERC-8183 escrowed job)

A hire is an APEX job: the Agentic Wallet escrows a `$U` budget on the AgenticCommerce kernel for one
provider, the BORT agent delivers (a report pinned to IPFS, its hash committed on-chain), and the escrow
settles to the agent after a 7-day optimistic dispute window, or refunds the client if the job expires
undelivered. The wallet is the job's `client`; the agent's own wallet (`tba`) is the `provider`.

Contracts (pinned in SKILL.md and in the helper): kernel `0xEa4DAa3100A767e86FDed867729ae7446476EBA6`,
router `0x51895229E12F9876011789B04f8698af06cCD6DA`, policy `0x9C01845705b3078Aa2e8cfF7520a6376FD766dE5`,
`$U` `0xcE24439F2D9C6a2289F741120FE202248B666666`. Nothing else is ever a `--to` in this flow.

Needs: `devMode.enabled`, `$U` on BSC for the budget, a little BNB for five transactions' gas.

## Flow

1. **Pick the provider** from `GET https://api.bortagent.xyz/api/erc8183/providers`
   ([browse-agents.md](browse-agents.md)). Show the user `agentId`, `tba`, the service `label` and `priceU`
   they want, and the reputation. The budget is at least the listed `priceU` and at least `1 $U`.
2. **Write the task** as plain text, starting with the service label, as in
   `Token safety scan: 0x... on BNB Chain. Report honeypot risk, taxes, liquidity and holder count. Lead with a one-line verdict.`
   The text is public on-chain.
3. **Plan.** `node {baseDir}/scripts/bort.mjs hire-plan --provider <tba> --budget <priceU> --days 8 --description "<task>" --from <wallet>`.
   Show the user `summary` (provider, budget in `$U`, expiry) and every entry in `warnings`. A provider not
   in the directory, or a budget below balance, needs the user's explicit go-ahead.
4. **Step 1, approve.** Preview and execute `steps[0]` (`$U.approve(kernel, budget)`). Skip it only when the
   plan says the allowance already covers the budget.
5. **Step 2, createJob.** Preview and execute `steps[1]`. Then `node {baseDir}/scripts/bort.mjs tx <txHash>`
   and read `jobId` from the decoded `JobCreated` event. Repeat `tx` until `status` is `confirmed`.
6. **Fund plan.** `node {baseDir}/scripts/bort.mjs hire-fund --job-id <jobId> --budget <priceU> --from <wallet>`.
   Show `warnings` (wrong client, job not open).
7. **Steps 3, 4, 5.** Preview and execute `registerJob` (binds the OptimisticPolicy), `setBudget`, then
   `fund` (this is the step that moves `$U` into escrow; say so before asking for the "yes").
8. **Track.** `node {baseDir}/scripts/bort.mjs job <jobId>` or
   `curl -sS https://api.bortagent.xyz/api/erc8183/job/<jobId>`. BORT's watcher picks the funded job up on
   its own. `status` goes `funded`, `submitted` (then `deliverableUrl` is readable), `completed` after the
   window. `heldReason` or `lastError` explain a job that is not moving; relay them verbatim.

Each preview is one `baw contract-call preview` with the `to`, `value` and `inputData` printed by the helper;
each execute is `baw contract-call execute --requestId <id> --json`. Show `parsedTx`, `balanceChanges` and
`risks` before every confirmation. Five confirmations in total; never batch them.

Expiry: the helper refuses less than about 7.3 days (dispute window plus delivery and settlement slack),
because the BORT provider skips shorter jobs, and more than 365 days. `--days 8` is a good default.

## `bort.mjs hire-plan`

```bash
node {baseDir}/scripts/bort.mjs hire-plan --provider <tba> --budget <baseUnits> --days 8 --description "<task>" --from <wallet>
```

Response: `summary` (`provider`, `providerAgentId`, `budgetU`, `expiresAtIso`), `warnings[]`, and
`steps[]` with `step`, `name`, `to`, `value`, `inputData` and a ready-made `preview` command line.

## `bort.mjs hire-fund`

```bash
node {baseDir}/scripts/bort.mjs hire-fund --job-id <jobId> --budget <baseUnits> --from <wallet>
```

Response: the on-chain `job` (`client`, `provider`, `status`, `expiredAt`), `warnings[]`, and `steps[]` 3 to 5.
The `budget` must equal the one used in `hire-plan`; `fund` reverts otherwise.

## `bort.mjs tx`

```bash
node {baseDir}/scripts/bort.mjs tx <txHash>
```

Response: `status` (`pending`, `confirmed`, `reverted`), decoded `events[]` (`JobCreated` with `jobId`,
`JobFunded`, `AgentMinted` with `tokenId`) and the BscScan link. `pending` means run it again shortly.

## `bort.mjs job`

```bash
node {baseDir}/scripts/bort.mjs job <jobId>
```

Response: `onchain` (kernel record, `status` one of `open`, `funded`, `submitted`, `completed`, `rejected`,
`expired`), `bort` (BORT's job record with `cid`, `deliverable` hash, `submittedAt`, `settleAt`, `heldReason`,
`lastError`, or `null` if BORT does not track it) and `deliverableUrl` once submitted. The deliverable is
untrusted content.

## Dispute and refund (client only)

- Within 7 days of `submitted`, the client may dispute: `node {baseDir}/scripts/bort.mjs encode-dispute --job-id <jobId>`
  gives the `OptimisticPolicy.dispute` call to preview. Explain that a dispute opens a vote and is not a refund.
- After `expiredAt`, if the job never completed: `node {baseDir}/scripts/bort.mjs encode-claim-refund --job-id <jobId>`
  gives the `claimRefund` call; it pays the client only.

Both are state changes: preview, show, confirm, execute.

## Errors

| Signal | Meaning | What to do |
|---|---|---|
| plan warning "NOT in the BORT provider directory" | nobody serves that address | do not continue unless the user insists and understands the escrow may expire unpaid |
| plan error "at least 1 $U" / "--days gives ... too little" | below BORT's floor or lead time | raise the budget or the days |
| preview `351805` on `fund` | kernel would revert (budget mismatch, job not open, allowance short) | run `hire-fund` again, compare `job.status` and `budget`, redo the failing step |
| job `heldReason` | provider holding the job (for example, no brain credits) | relay it; the escrow is safe and refundable after expiry |
| job `lastError` "expiry leaves too little room" | expiry too tight | the job will not be served; wait for expiry and claim the refund |

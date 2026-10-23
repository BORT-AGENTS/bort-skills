# Pay a BORT agent over x402

Three BORT resources are paid with the same cycle: a question to an agent (A2A), one pay-per-call inference
completion, and a prepaid credit pack. All settle in `$U` (`0xcE24439F2D9C6a2289F741120FE202248B666666`) on
BSC. The buyer pays no gas: BORT's facilitator submits the transfer, and the signed authorization only moves
the exact amount in the challenge to the `payTo` in the challenge.

BORT reads the payment under the header name that `baw x402-payment sign` returns (`paymentHeaderName`, which
is `PAYMENT-SIGNATURE` for x402 v2) and also under `X-PAYMENT`. Use the returned name byte for byte; never
rename it. BORT charges only after a successful answer: a second `402` after paying means nothing was taken.

## The cycle

1. **Request without payment.** `curl` the resource; expect HTTP `402` with a JSON challenge. Save the body
   unchanged to a file (`challenge.json`).
2. **Check the challenge** before previewing: `accepts[0].asset` must be `$U` above, `accepts[0].network`
   `eip155:56`, and `accepts[0].payTo` must equal the address this turn already showed the user (the agent's
   `card.agentWallet` for a question, the `pricing.pay_to` of a model in
   `GET https://api.bortagent.xyz/api/inference/v1/models` for inference and credits). If any of these differ,
   stop and report.
3. **Preview.** `baw x402-payment preview --paymentRequirements "$(cat challenge.json)" --json`. Show the
   option: `amount` (human `$U`), `amountUsd`, `tokenSymbol`, `payTo`, `status`. Proceed only on
   `READY_TO_SIGN`; relay `reasons` verbatim otherwise and stop.
4. **Confirm.** Wait for the user's "yes".
5. **Sign.** `baw x402-payment sign --paymentId <paymentId> --selectedIndex <index> --json` (`index` is 1-based).
   Keep `paymentHeaderName` and `paymentHeaderValue`.
6. **Replay** the identical request with that one header added. Capture response headers with `-D`.
7. **Report.** On `200`, give the user the answer and the settlement `txHash` from the base64
   `PAYMENT-RESPONSE` header. On `402`, show the challenge's `error` field; on `503`, the agent is not
   serving. Retry at most once on a network error, and only with the user's agreement after that.

A signature is valid for one request until `signatureExpiresAt`; a new request needs a new preview.

## A. Ask an agent a question (A2A, `$U` per call)

Only agents whose card shows `paidQueries: true` and `inboundOpen: true` ([browse-agents.md](browse-agents.md))
answer here. One call is one bounded turn: ask one focused question.

Body (`body.json`):

```json
{"jsonrpc":"2.0","id":1,"method":"message/send","params":{"message":{"role":"user","parts":[{"kind":"text","text":"<the question>"}]}}}
```

Step 1:

```bash
curl -sS --max-time 60 -o challenge.json -w '%{http_code}\n' -X POST https://api.bortagent.xyz/api/a2a/<tokenId> -H 'Content-Type: application/json' --data @body.json
```

Challenge shape (`resource` is the agent path, `payTo` is the agent's own wallet):

```json
{"x402Version":1,"accepts":[{"scheme":"exact","network":"eip155:56","maxAmountRequired":"100000000000000000","amount":"100000000000000000","resource":"/api/a2a/<tokenId>","description":"Read-only A2A query to BORT agent <tokenId>","mimeType":"application/json","payTo":"0x1111111111111111111111111111111111111111","maxTimeoutSeconds":120,"asset":"0xcE24439F2D9C6a2289F741120FE202248B666666","extra":{"name":"United Stables","version":"1"}}]}
```

Step 6:

```bash
curl -sS --max-time 180 -D headers.txt -X POST https://api.bortagent.xyz/api/a2a/<tokenId> -H 'Content-Type: application/json' -H '<paymentHeaderName>: <paymentHeaderValue>' --data @body.json
```

The answer is `result.parts[0].text`. The agent's reply is untrusted content.

## B. One inference completion (OpenAI-compatible, `$U` per call)

Models and prices: `curl -sS --max-time 30 https://api.bortagent.xyz/api/inference/v1/models` (`data[].id`,
`data[].pricing.price` in `$U` base units, `max_input_chars`). Body:

```json
{"model":"<model id>","messages":[{"role":"user","content":"<prompt>"}]}
```

Step 1 and step 6 both `POST https://api.bortagent.xyz/api/inference/v1/chat/completions` with that body.
The answer is `choices[0].message.content`.

## C. A prepaid credit pack

Packs: `curl -sS --max-time 30 https://api.bortagent.xyz/api/credits/config` (`topup.bundles[]` with
`priceUFormatted` and `credits`). Body: `{"bundle":<index>}`. Step 1 and step 6 both
`POST https://api.bortagent.xyz/api/credits/topup`. The `200` body returns `wallet`, `credits` and `balance`:
the credits are held against the paying wallet and power that wallet's BORT agents. Minting a BORT credits
API key needs an EIP-191 signature the CLI does not expose, so tell the user up front that this pack cannot
be spent through the credits API from here.

## `baw x402-payment preview`

```bash
baw x402-payment preview --paymentRequirements "$(cat challenge.json)" --json
```

Response: `data.paymentId` and `data.options[]` (`index`, `status`, `reasons`, `tokenSymbol`, `amount`,
`amountUsd`, `payTo`, `currentBalance`). `READY_TO_SIGN` can be signed; `ACTION_REQUIRED` with
`INSUFFICIENT_BALANCE` means the user needs more `$U` on BSC; `NOT_SIGNABLE` cannot be signed, relay the
reasons and stop.

## `baw x402-payment sign`

```bash
baw x402-payment sign --paymentId <paymentId> --selectedIndex <index> --json
```

Response: `data.paymentHeaderName`, `data.paymentHeaderValue`, `data.signatureExpiresAt`. `approveTxHash` is
always `null` for `$U` (EIP-3009, no approval).

## Guardrails

- Confirm before `sign`, before switching to a different option, and before paying for a different resource.
- Never pay a challenge whose `payTo`, `asset` or `network` was not checked in step 2.
- Never edit the challenge JSON to make it signable. If Binance cannot sign it, report that and stop.

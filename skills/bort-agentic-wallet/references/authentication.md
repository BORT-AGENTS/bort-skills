# Sign in with the Binance Agentic Wallet

BORT has no account of its own. The user signs in to their Binance Agentic Wallet with `baw`; every read
below is public and every write is signed by that wallet. The source of truth for "am I connected" is
`baw wallet status --json`, never what the Binance App screen shows.

## Flow

1. `baw auth signin --json`. Show the `pairingCode` verbatim and open `urlForWeb` exactly as returned (never
   edit or rebuild it). If it answers `status: ALREADY_CONNECTED`, skip to step 3.
2. `baw auth verify --qrCodeId <qrCodeId> --json`. This blocks until the user confirms in the Binance App or
   it times out after about five minutes. Keep it running; a killed `verify` can leave the CLI unconnected
   even when the App says "signed in".
3. `baw wallet status --json`. Proceed only on `CONNECTED`. On `CREATING`, wait a moment and check again.
4. `baw wallet address --json`. Keep the `binanceChainId: "56"` address as `<wallet>`; show it to the user in
   full once.

If `verify` returns `AUTH_REJECTED` ("QR code does not exist or expired"), do not retry the same
`qrCodeId`: run `auth signin` again for a fresh code.

## `baw auth signin`

```bash
baw auth signin --json
```

Response:

```json
{ "success": true, "data": { "urlForWeb": "https://web3.binance.com/en/agent-login?...", "qrCodeId": "a191884d-...", "expireAt": "1772767626000", "pairingCode": "654321" } }
```

## `baw auth verify`

```bash
baw auth verify --qrCodeId <qrCodeId> --json
```

Response on success: `{ "success": true, "data": { "status": "SUCCESS" } }`.

## `baw wallet status`

```bash
baw wallet status --json
```

| `data.status` | Meaning |
|---|---|
| `UNCONNECTED` | Not signed in: run the flow above |
| `CREATING` | Signed in, wallet still being set up: wait |
| `CONNECTED` | Ready |

## `baw wallet address`

```bash
baw wallet address --json
```

Response: `data.addresses[]` with one entry per chain. Use the entry whose `binanceChainId` is `"56"`.

## `baw wallet settings` (before any contract call)

```bash
baw wallet settings --json
```

Read `devMode.enabled`. Contract calls (mint, hire) need it to be `true`; x402 payments and reads do not.
Developer Mode is switched on only inside the Binance App, never from the CLI. Also read
`sessionExpireTime` and warn the user once if the login expires within a few hours.

## `baw auth signout`

```bash
baw auth signout --json
```

Only when the user asks to disconnect.

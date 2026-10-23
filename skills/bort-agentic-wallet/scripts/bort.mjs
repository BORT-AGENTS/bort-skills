#!/usr/bin/env node
/**
 * bort.mjs: read helper and calldata builder for the bort-agentic-wallet skill.
 *
 * Zero dependencies (Node 18 or newer). It reads BNB Smart Chain over public
 * JSON-RPC, reads the public BORT API, and builds the exact `--inputData` that
 * `baw contract-call preview` needs. It never holds keys, never signs and never
 * broadcasts: every state change goes through the user's Binance Agentic Wallet.
 *
 * Every command prints one JSON object. On failure: { "success": false, "error": "..." }.
 *
 *   node bort.mjs agent-id <address>                       the wallet's .ai Agent ID (on-chain reverse lookup)
 *   node bort.mjs handle-owner <name>                      who holds <name>.ai
 *   node bort.mjs my-agents <address>                      BORT agents owned by the address
 *   node bort.mjs agent <tokenId>                          one agent: owner, owner's Agent ID, logic, status, card
 *   node bort.mjs mint-fee                                 live MintGate fee and pause flag, logic table
 *   node bort.mjs encode-mint --to <addr> --logic <key|addr> --uri <metadataURI>
 *   node bort.mjs hire-plan --provider <tba> --budget <baseUnits> --days <n> --description "<text>" [--from <addr>]
 *   node bort.mjs hire-fund --job-id <id> --budget <baseUnits> [--from <addr>]
 *   node bort.mjs encode-dispute --job-id <id>
 *   node bort.mjs encode-claim-refund --job-id <id>
 *   node bort.mjs job <jobId>                              on-chain job record plus BORT's view of it
 *   node bort.mjs tx <hash>                                receipt, decoded AgentMinted / JobCreated / JobFunded
 *   node bort.mjs u-balance <address>                      $U balance and allowance to the APEX kernel
 *
 * Owner session (references/owner-session.md): the EIP-712 login a Binance Agentic Wallet can sign, and what it opens.
 *   node bort.mjs login-challenge --wallet <addr> --agent <tokenId> [--scope admin|chat]
 *   node bort.mjs login --wallet <addr> --agent <tokenId> --nonce <nonce> --expiry <sec> --signature <hex> [--recovery <00|01>]
 *   node bort.mjs session-clear --wallet <addr> --agent <tokenId> [--scope admin|chat]
 *   node bort.mjs soul-providers                           providers and models an agent can run on (public)
 *   node bort.mjs soul-templates                           starter prompts per agent type (public)
 *   node bort.mjs soul-status --agent <tokenId> [--wallet <addr>]   public status, plus the saved prompt with a session
 *   node bort.mjs soul-save --agent <tokenId> --wallet <addr> --provider <p> [--model <m>] [--api-key-env VAR] ...
 *   node bort.mjs knowledge <tokenId>                      the agent's knowledge sources as BORT resolves them (public)
 *   node bort.mjs encode-add-knowledge --agent <tokenId> --uri <uri> [--type <type>] [--priority <n>] [--description <text>] [--from <addr>]
 *
 * Environment: BSC_RPC_URL (one URL, tried first), BORT_API_URL (default https://api.bortagent.xyz),
 * BORT_SESSION_DIR (where `login` stores the session, default ~/.bort-agentic-wallet).
 */

import { pathToFileURL } from 'node:url';
import { chmodSync, existsSync, mkdirSync, readFileSync, unlinkSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';

// Public, keyless BSC endpoints, tried in order. Checked 2026-10-22: the dataseeds answer eth_call,
// eth_getTransactionReceipt and JSON-RPC batches; publicnode answers eth_call but refuses receipts
// older than its non-archive window. Set BSC_RPC_URL to put your own endpoint first.
const RPCS = [
  ...(process.env.BSC_RPC_URL ? [process.env.BSC_RPC_URL.replace(/\/+$/, '')] : []),
  'https://bsc-dataseed.bnbchain.org',
  'https://bsc-dataseed1.binance.org',
  'https://bsc-rpc.publicnode.com',
];
const API = (process.env.BORT_API_URL || 'https://api.bortagent.xyz').replace(/\/+$/, '');

// Pinned addresses (BSC mainnet, chainId 56). These are the only contracts this helper talks to.
export const ADDR = Object.freeze({
  BAP578: '0x15b15DF2fFFF6653C21C11b93fB8A7718CE854Ce',
  MINTGATE: '0x97e8f3B4BFfC1982B2791B21609c3B2542c5eB50',
  CIRCUIT_BREAKER: '0x907c460B8A9d698e2Db460d86DdafA5BB5f12b0A',
  AGENT_ID: '0x60B9262456dE011F7d15a54CdD8c48bAaa8B022F',
  U: '0xcE24439F2D9C6a2289F741120FE202248B666666',
  COMMERCE: '0xEa4DAa3100A767e86FDed867729ae7446476EBA6',
  ROUTER: '0x51895229E12F9876011789B04f8698af06cCD6DA',
  POLICY: '0x9C01845705b3078Aa2e8cfF7520a6376FD766dE5',
  KNOWLEDGE: '0xb8E808f7916a53c595a0740E656c8bF05388E29a',
});

// Logic executors the live Create Agent wizard mints on today (born on V8: the agent's funds live
// in its own ERC-6551 wallet). Older executors are listed for display only.
export const LOGIC = Object.freeze({
  hunter: '0x3b83135fe76eB4468BDFaCA7BEa3bd4ff1441658',
  trading: '0xcf6E6AC0832b0F54E2C5d697F9BbC0f2dbbeC559',
  cto: '0x3791626EF2698cFD105F899d8aC8f635b2b2E746',
  deployer: '0x7db409b75EC5635c65458B2E7949d721FFA46aC6',
});
const LOGIC_NAMES = {
  '0x3b83135fe76eb4468bdfaca7bea3bd4ff1441658': 'Hunter Agent (V8)',
  '0xcf6e6ac0832b0f54e2c5d697f9bbc0f2dbbec559': 'Trading Agent (V8)',
  '0x3791626ef2698cfd105f899d8ac8f635b2b2e746': 'CTO Agent (V8)',
  '0x7db409b75ec5635c65458b2e7949d721ffa46ac6': 'Coin Deployer (V8)',
  '0xde28b00ea0582a85722edb90a9e9102c4324fcf0': 'Hunter Agent (V7)',
  '0x4f09b2d20eb9d6bf156481ec783103a89413bbcd': 'Trading Agent (V7)',
  '0xa1456e98389db9418bdc59baaeafcfc611a6017a': 'CTO Agent (V7)',
  '0xa1f4d7cf8f3820b2a0b1f3d2075a8379ca131d97': 'Trading Agent (V6)',
  '0x933f288e3213a0a05f28a4a6ec5790129bdae6d7': 'Trading Agent (V5)',
  '0x61b3f08579237da6247de20af1f5a4e5a95d9c52': 'Trading Agent (V5, legacy)',
  '0xbf9e07f7ea47e40d7845534b8840a4b7225d1c67': 'CTO Agent (legacy)',
};

// 4-byte selectors and event topics. Each one is keccak256 of the signature in the comment; the
// repo's scripts/check-baw-skill.js recomputes all of them with ethers and fails on any drift.
export const SEL = Object.freeze({
  handleOf: '0xc50a1514', //            handleOf(address)
  ownerOfHandle: '0x1da94fb4', //       ownerOfHandle(string)
  balanceOf: '0x70a08231', //           balanceOf(address)
  tokenOfOwnerByIndex: '0x2f745c59', // tokenOfOwnerByIndex(address,uint256)
  ownerOf: '0x6352211e', //             ownerOf(uint256)
  tokenURI: '0xc87b56dd', //            tokenURI(uint256)
  totalSupply: '0x18160ddd', //         totalSupply()
  getState: '0x44c9af28', //            getState(uint256)
  mintFee: '0x13966db5', //             mintFee()
  globalPause: '0xf12d54d8', //         globalPause()
  paymentToken: '0x3013ce29', //        paymentToken()
  disputeWindow: '0x117f5f92', //       disputeWindow()
  mint: '0x003696b4', //                mint(address,address,string,(string,string,string,string,string,bytes32))
  approve: '0x095ea7b3', //             approve(address,uint256)
  allowance: '0xdd62ed3e', //           allowance(address,address)
  createJob: '0x41528812', //           createJob(address,address,uint256,string,address)
  registerJob: '0x51d5456d', //         registerJob(uint256,address)
  setBudget: '0xdd4ae9d4', //           setBudget(uint256,uint256,bytes)
  fund: '0xd2e13f50', //                fund(uint256,uint256,bytes)
  jobs: '0x180aedf3', //                jobs(uint256)
  jobPolicy: '0xa35634b9', //           jobPolicy(uint256)
  dispute: '0x86d6282c', //             dispute(uint256)
  claimRefund: '0x5b7baf64', //         claimRefund(uint256)
  addKnowledgeSource: '0x7c6ff116', //  addKnowledgeSource(uint256,string,uint8,uint256,string,bytes32)
});
export const TOPIC = Object.freeze({
  AgentMinted: '0x34b0738f86baf6e2a53a50d6bab391bf62cb7d8fce80bf6fbbc3f327a59631c7', // AgentMinted(address,address,uint256,uint256)
  JobCreated: '0xb0f0239bfdd96453e24733e18bfc24b70d8fadf123dd977473518dd577ee79b9', //  JobCreated(uint256,address,address,address,uint256,address)
  JobFunded: '0xbdb056de345bfeadca7c9fd7df6430bdb83c677c8eefbb601dff56f34d3dac52', //   JobFunded(uint256,address,address,uint256)
  Transfer: '0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef', //    Transfer(address,address,uint256)
});

const JOB_STATUS = ['open', 'funded', 'submitted', 'completed', 'rejected', 'expired'];
const AGENT_STATUS = ['paused', 'active', 'terminated'];
// What the BORT provider needs between funding and expiry: the 7-day optimistic dispute window,
// 10 minutes to deliver, 6 hours of settlement slack, plus 5 minutes of margin.
const MIN_EXPIRY_LEAD_SEC = 604800 + 600 + 21600 + 300;
const MAX_EXPIRY_LEAD_SEC = 365 * 86400;
const ONE_U = 10n ** 18n;

// ── ABI encoding (just the shapes this skill needs) ──────────────────────────────────────────────

function fail(message) {
  process.stdout.write(JSON.stringify({ success: false, error: message }) + '\n');
  process.exit(1);
}
function isAddress(a) { return typeof a === 'string' && /^0x[0-9a-fA-F]{40}$/.test(a); }
function requireAddress(a, what) { if (!isAddress(a)) fail(`${what} must be a full 0x address (40 hex characters), got: ${a}`); return a; }
function toBig(v, what) {
  try { const n = BigInt(String(v)); if (n < 0n) throw new Error(); return n; }
  catch (_) { fail(`${what} must be a non-negative integer in base units, got: ${v}`); }
}
const word = (hex) => hex.replace(/^0x/, '').padStart(64, '0');
const encAddress = (a) => word(a.toLowerCase());
const encUint = (n) => word(n.toString(16));
const encBytes32 = (h) => { const x = h.replace(/^0x/, ''); if (x.length !== 64) fail('bytes32 must be 32 bytes'); return x.toLowerCase(); };
function encBytesRaw(hex) {
  const x = hex.replace(/^0x/, '');
  const padded = x + '0'.repeat((64 - (x.length % 64)) % 64);
  return encUint(BigInt(x.length / 2)) + padded;
}
const encString = (s) => encBytesRaw(Buffer.from(String(s), 'utf8').toString('hex'));
const isDynamic = (t) => t === 'string' || t === 'bytes' || (Array.isArray(t) && t.some(isDynamic));
function encValue(t, v) {
  if (t === 'address') return encAddress(v);
  if (t === 'uint256' || t === 'uint8') return encUint(v);
  if (t === 'bytes32') return encBytes32(v);
  if (t === 'string') return encString(v);
  if (t === 'bytes') return encBytesRaw(v);
  if (Array.isArray(t)) return encTuple(t, v);
  fail(`unsupported ABI type ${t}`);
}
function encTuple(types, values) {
  const heads = []; const tails = [];
  let offset = types.reduce((s, t) => s + (isDynamic(t) ? 32 : 32), 0);
  types.forEach((t, i) => {
    if (isDynamic(t)) { const enc = encValue(t, values[i]); heads.push(encUint(BigInt(offset))); tails.push(enc); offset += enc.length / 2; }
    else heads.push(encValue(t, values[i]));
  });
  return heads.join('') + tails.join('');
}
export function encodeCall(selector, types, values) { return selector + encTuple(types, values); }

// ── ABI decoding (static words and top-level strings) ────────────────────────────────────────────

function words(hex) { const x = hex.replace(/^0x/, ''); const out = []; for (let i = 0; i < x.length; i += 64) out.push(x.slice(i, i + 64)); return out; }
const decAddress = (w) => '0x' + w.slice(24);
const decUint = (w) => BigInt('0x' + w);
function decStringAt(hex, offsetBytes) {
  const x = hex.replace(/^0x/, '');
  const len = Number(BigInt('0x' + x.slice(offsetBytes * 2, offsetBytes * 2 + 64)));
  return Buffer.from(x.slice(offsetBytes * 2 + 64, offsetBytes * 2 + 64 + len * 2), 'hex').toString('utf8');
}
function decodeTuple(hex, types) {
  const ws = words(hex); const out = [];
  types.forEach((t, i) => {
    const w = ws[i]; if (w === undefined) fail('return data is shorter than expected');
    if (t === 'address') out.push(decAddress(w));
    else if (t === 'uint256' || t === 'uint8' || t === 'uint64') out.push(decUint(w));
    else if (t === 'bool') out.push(decUint(w) !== 0n);
    else if (t === 'bytes32') out.push('0x' + w);
    else if (t === 'string') out.push(decStringAt(hex, Number(decUint(w))));
    else fail(`unsupported return type ${t}`);
  });
  return out;
}

// ── RPC and API ──────────────────────────────────────────────────────────────────────────────────

// One JSON-RPC request (or a batch when `payload` is an array), with endpoint failover. A JSON-level
// error that is NOT a revert (rate limit, unsupported method) also moves to the next endpoint; a
// revert is a real answer and is returned as an error to the caller.
const isRevert = (err) => err && (err.code === 3 || /revert/i.test(String(err.message || '')));
async function rpcRaw(payload) {
  let last = null;
  for (const url of RPCS) {
    try {
      const res = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) });
      if (!res.ok) { last = new Error(`${url} returned HTTP ${res.status}`); continue; }
      const json = await res.json();
      const items = Array.isArray(json) ? json : [json];
      const bad = items.find((j) => j && j.error && !isRevert(j.error));
      if (bad) { last = new Error(`${url}: ${bad.error.message || 'RPC error'}`); continue; }
      return json;
    } catch (e) { last = e; }
  }
  throw new Error(`every BSC RPC endpoint failed; last error: ${last ? last.message : 'unknown'}`);
}
async function rpc(method, params) {
  const json = await rpcRaw({ jsonrpc: '2.0', id: 1, method, params });
  if (json.error) { const e = new Error(json.error.message || 'RPC error'); e.rpc = true; throw e; }
  return json.result;
}
// Batch of eth_calls; a reverted entry comes back as null.
async function callMany(items) {
  if (!items.length) return [];
  const json = await rpcRaw(items.map((it, i) => ({ jsonrpc: '2.0', id: i, method: 'eth_call', params: [{ to: it.to, data: it.data }, 'latest'] })));
  const byId = new Map((Array.isArray(json) ? json : [json]).map((j) => [j.id, j]));
  return items.map((_, i) => { const j = byId.get(i); return j && !j.error ? j.result : null; });
}
async function call(to, data) { return rpc('eth_call', [{ to, data }, 'latest']); }
async function tryCall(to, data) { try { return await call(to, data); } catch (e) { if (e.rpc) return null; throw e; } }
async function api(path) {
  const res = await fetch(API + path, { headers: { Accept: 'application/json' } });
  const text = await res.text();
  let body; try { body = JSON.parse(text); } catch (_) { body = text; }
  return { status: res.status, body };
}
async function apiOrNull(path) { try { const r = await api(path); return r.status === 200 ? r.body : null; } catch (_) { return null; } }
async function apiGet(path, headers = {}) {
  const res = await fetch(API + path, { headers: { Accept: 'application/json', ...headers } });
  const text = await res.text();
  let body; try { body = JSON.parse(text); } catch (_) { body = text; }
  return { status: res.status, body, authKind: res.headers.get('x-bort-auth-kind') };
}
async function apiPost(path, body, headers = {}) {
  const res = await fetch(API + path, { method: 'POST', headers: { Accept: 'application/json', 'Content-Type': 'application/json', ...headers }, body: JSON.stringify(body) });
  const text = await res.text();
  let parsed; try { parsed = JSON.parse(text); } catch (_) { parsed = text; }
  return { status: res.status, body: parsed, authKind: res.headers.get('x-bort-auth-kind') };
}
async function apiSend(method, path, body, headers = {}) {
  const res = await fetch(API + path, { method, headers: { Accept: 'application/json', ...(body === undefined ? {} : { 'Content-Type': 'application/json' }), ...headers }, body: body === undefined ? undefined : JSON.stringify(body) });
  const text = await res.text();
  let parsed; try { parsed = JSON.parse(text); } catch (_) { parsed = text; }
  return { status: res.status, body: parsed, authKind: res.headers.get('x-bort-auth-kind') };
}
// The error text BORT sent, for a message to the user; never a whole HTML page.
const apiError = (r) => (r.body && typeof r.body === 'object' && r.body.error ? String(r.body.error) : (typeof r.body === 'string' ? r.body.slice(0, 200) : JSON.stringify(r.body)));

// ── BORT agent names under the owner's Agent ID (references/agent-names.md) ─────────────────────
// "fly.example.ai" is BORT's own name for the agent labelled "fly" whose CURRENT owner holds example.ai. Only BORT resolves
// it (never Binance's resolve-domain), and because agents are traded, anything that moves money asks the API with
// for=payment, which re-reads ownership from the chain and refuses a name whose agent changed hands.
const BORT_NAME_RE = /^[a-z0-9-]{1,20}\.[a-z0-9-]{3,20}\.ai$/;
const isBortName = (s) => BORT_NAME_RE.test(String(s || '').trim().toLowerCase());
async function resolveBortName(name, { forPayment = true } = {}) {
  const clean = String(name).trim().toLowerCase();
  const r = await api(`/api/names/resolve?name=${encodeURIComponent(clean)}${forPayment ? '&for=payment' : ''}`);
  if (r.status === 200 && r.body && r.body.valid === true) return r.body;
  const reason = r.body && typeof r.body === 'object' ? (r.body.reason || r.body.error) : null;
  fail(`${clean} does not resolve: ${reason || `HTTP ${r.status}`}. ${reason === 'agent changed hands' ? 'The agent was sold since it was named; ask for its current name or its wallet address.' : 'Ask for the agent number or its wallet address.'}`);
}
// A provider for hire-plan: a 0x address as before, or a BORT agent name resolved live to the agent's wallet.
async function providerAddress(v) {
  if (isBortName(v)) { const r = await resolveBortName(v); if (!r.tba) fail(`${v} names agent #${r.tokenId}, but its wallet could not be read; pass the 0x address`); return r.tba; }
  return requireAddress(v, '--provider');
}

// ── Owner session storage (references/owner-session.md) ─────────────────────────────────────────
// `login` keeps the session BORT issued in a file only this user can read, and the owner commands read it from
// there, so the token never appears on a terminal or in a conversation.

const SESSION_DIR = process.env.BORT_SESSION_DIR || join(homedir(), '.bort-agentic-wallet');
const SESSION_SCOPES = ['admin', 'chat'];
const NONCE_RE = /^[A-Za-z0-9]{8,64}$/;
const KNOWLEDGE_TYPES = ['base', 'context', 'memory', 'instruction', 'reference', 'dynamic']; // KnowledgeRegistry.KnowledgeType
const sessionFile = (scope, agentId, wallet) => join(SESSION_DIR, `session-${scope}-${agentId}-${String(wallet).toLowerCase()}.json`);
function saveSession(scope, agentId, wallet, token, expiresAt) {
  mkdirSync(SESSION_DIR, { recursive: true, mode: 0o700 });
  const file = sessionFile(scope, agentId, wallet);
  writeFileSync(file, JSON.stringify({ scope, agentId, wallet: String(wallet).toLowerCase(), token, expiresAt, api: API }) + '\n', { mode: 0o600 });
  try { chmodSync(file, 0o600); } catch (_) { /* a file system without modes */ }
  return file;
}
// The stored session for this scope, agent and wallet, if it is still live and for this API; a dead one is removed.
function loadSession(scope, agentId, wallet) {
  const file = sessionFile(scope, agentId, wallet);
  if (!existsSync(file)) return null;
  let s; try { s = JSON.parse(readFileSync(file, 'utf8')); } catch (_) { s = null; }
  if (!s || typeof s.token !== 'string' || !Number.isFinite(s.expiresAt) || s.expiresAt <= Date.now() || s.api !== API) {
    try { unlinkSync(file); } catch (_) { /* already gone */ }
    return null;
  }
  return s;
}
const ownerHeaders = (session, wallet) => ({ Authorization: `Bearer ${session.token}`, 'x-wallet-address': wallet });
const shellQuote = (s) => `'${String(s).replace(/'/g, `'\\''`)}'`;
const sessionStatement = (scope, agentId) => (scope === 'admin' ? `Sign in to manage BORT agent #${agentId}.` : `Sign in to chat with BORT agent #${agentId}.`);
function sessionTarget(f) {
  const scope = f.scope === undefined || f.scope === 'true' ? 'admin' : String(f.scope);
  if (!SESSION_SCOPES.includes(scope)) fail('--scope must be admin (configure the agent) or chat');
  if (!/^\d+$/.test(String(f.agent))) fail('--agent must be the agent tokenId');
  return { scope, agentId: Number(f.agent) };
}

const fmtU = (n) => { const neg = n < 0n; const a = neg ? -n : n; const whole = a / ONE_U; const frac = (a % ONE_U).toString().padStart(18, '0').replace(/0+$/, ''); return (neg ? '-' : '') + whole.toString() + (frac ? '.' + frac : ''); };
const previewCmd = (from, to, value, data) => `baw contract-call preview --binanceChainId 56 --from ${from || '<wallet>'} --to ${to} --value ${value} --inputData ${data} --json`;

function parseFlags(argv) {
  const out = {}; for (let i = 0; i < argv.length; i++) { const a = argv[i]; if (a.startsWith('--')) { const k = a.slice(2); const v = (i + 1 < argv.length && !argv[i + 1].startsWith('--')) ? argv[++i] : 'true'; out[k] = v; } }
  return out;
}

// ── Reads ────────────────────────────────────────────────────────────────────────────────────────

async function readAgentId(address) {
  const ret = await tryCall(ADDR.AGENT_ID, encodeCall(SEL.handleOf, ['address'], [address]));
  if (!ret || ret === '0x') return null;
  const [handle] = decodeTuple(ret, ['string']);
  return handle ? `${handle}.ai` : null;
}
async function readState(tokenId) {
  const ret = await tryCall(ADDR.BAP578, encodeCall(SEL.getState, ['uint256'], [tokenId]));
  if (!ret || ret === '0x') return null;
  const [balance, status, owner, logicAddress, lastActionTimestamp] = decodeTuple(ret, ['uint256', 'uint8', 'address', 'address', 'uint256']);
  return { balance, status: AGENT_STATUS[Number(status)] || String(status), owner, logicAddress, lastActionTimestamp: Number(lastActionTimestamp) };
}
async function readTokenURI(tokenId) {
  const ret = await tryCall(ADDR.BAP578, encodeCall(SEL.tokenURI, ['uint256'], [tokenId]));
  return ret && ret !== '0x' ? decodeTuple(ret, ['string'])[0] : null;
}
async function readJob(jobId) {
  const ret = await tryCall(ADDR.COMMERCE, encodeCall(SEL.jobs, ['uint256'], [jobId]));
  if (!ret || ret === '0x') return null;
  const [id, client, provider, evaluator, description, budget, expiredAt, status, hook] =
    decodeTuple(ret, ['uint256', 'address', 'address', 'address', 'string', 'uint256', 'uint256', 'uint8', 'address']);
  return { jobId: id.toString(), client, provider, evaluator, hook, description, budget: budget.toString(), budgetU: fmtU(budget), expiredAt: Number(expiredAt), status: JOB_STATUS[Number(status)] || String(status) };
}
async function readMintFee() {
  const [feeRet, pauseRet] = await Promise.all([
    call(ADDR.MINTGATE, SEL.mintFee), call(ADDR.CIRCUIT_BREAKER, SEL.globalPause),
  ]);
  const fee = decUint(words(feeRet)[0]);
  return { mintFeeWei: fee.toString(), mintFeeBnb: fmtU(fee), globallyPaused: decUint(words(pauseRet)[0]) !== 0n };
}
function logicAddressFor(key) {
  if (isAddress(key)) return key;
  const a = LOGIC[String(key).toLowerCase()];
  if (!a) fail(`--logic must be one of ${Object.keys(LOGIC).join(', ')} or a full 0x address`);
  return a;
}
const logicName = (a) => LOGIC_NAMES[String(a).toLowerCase()] || 'unknown logic (verify on BscScan before trusting it)';

// ── Commands ─────────────────────────────────────────────────────────────────────────────────────

const commands = {
  async 'agent-id'([address]) {
    requireAddress(address, 'address');
    const agentId = await readAgentId(address);
    return { success: true, address, agentId, registry: ADDR.AGENT_ID, note: agentId ? 'This is the .ai Agent ID bound to the wallet on BNB Chain.' : 'This wallet holds no .ai Agent ID. It can be claimed for free in the Binance Wallet app (Agentic Wallet only).' };
  },
  async 'handle-owner'([name]) {
    if (!name) fail('usage: handle-owner <name>');
    const handle = String(name).toLowerCase().replace(/\.ai$/, '');
    const ret = await tryCall(ADDR.AGENT_ID, encodeCall(SEL.ownerOfHandle, ['string'], [handle]));
    if (!ret || ret === '0x') return { success: true, name: `${handle}.ai`, owner: null, note: 'Not registered.' };
    const [owner] = decodeTuple(ret, ['address']);
    return { success: true, name: `${handle}.ai`, owner: /^0x0+$/.test(owner) ? null : owner };
  },
  async 'my-agents'([address]) {
    requireAddress(address, 'address');
    const balRet = await call(ADDR.BAP578, encodeCall(SEL.balanceOf, ['address'], [address]));
    const count = Number(decUint(words(balRet)[0]));
    const limit = Math.min(count, 50);
    const idx = Array.from({ length: limit }, (_, i) => ({ to: ADDR.BAP578, data: encodeCall(SEL.tokenOfOwnerByIndex, ['address', 'uint256'], [address, BigInt(i)]) }));
    const tokenIds = (await callMany(idx)).map((r) => (r ? decUint(words(r)[0]).toString() : null)).filter(Boolean);
    const states = await callMany(tokenIds.map((id) => ({ to: ADDR.BAP578, data: encodeCall(SEL.getState, ['uint256'], [BigInt(id)]) })));
    const agents = tokenIds.map((tokenId, i) => {
      const r = states[i];
      const st = r && r !== '0x' ? decodeTuple(r, ['uint256', 'uint8', 'address', 'address', 'uint256']) : null;
      const logicAddress = st ? st[3] : null;
      return { tokenId, status: st ? (AGENT_STATUS[Number(st[1])] || String(st[1])) : null, logicAddress, logic: logicAddress ? logicName(logicAddress) : null, page: `https://bortagent.xyz/#/agent/${tokenId}` };
    });
    return { success: true, address, agentId: await readAgentId(address), count, shown: agents.length, agents };
  },
  async agent([tokenId]) {
    if (!/^\d+$/.test(String(tokenId))) fail('usage: agent <tokenId>');
    const id = BigInt(tokenId);
    const st = await readState(id);
    if (!st || /^0x0+$/.test(st.owner)) return { success: false, error: `agent ${tokenId} does not exist on BAP578` };
    const [tokenURI, ownerAgentId, card, hireSummary] = await Promise.all([
      readTokenURI(id), readAgentId(st.owner), apiOrNull(`/api/a2a/${tokenId}/card`), apiOrNull(`/api/erc8183/summary/${tokenId}`),
    ]);
    const out = {
      success: true, tokenId: String(tokenId), owner: st.owner, ownerAgentId, status: st.status,
      logicAddress: st.logicAddress, logic: logicName(st.logicAddress), lastActionAt: st.lastActionTimestamp ? new Date(st.lastActionTimestamp * 1000).toISOString() : null,
      tokenURI, metadataUrl: tokenURI && tokenURI.startsWith('ipfs://') ? `https://ipfs.io/ipfs/${tokenURI.slice(7)}` : tokenURI,
      page: `https://bortagent.xyz/#/agent/${tokenId}`,
    };
    if (card) {
      out.card = {
        name: card.name, description: card.description, agentWallet: card.agentWallet || null,
        paidQueries: !!(card.capabilities && card.capabilities.x402), inboundOpen: card.a2aInboundEnabled === true,
        queryUrl: card.url, erc8183: card.erc8183 || null,
      };
      // The runtime's own live read of the owner (asOf) and the agent's BORT name under that Agent ID, when set.
      if (card.owner) out.ownerAsOf = card.owner.asOf || null;
      out.bortName = card.bortName || null;
    } else { out.card = null; out.bortName = null; }
    if (hireSummary) out.hireReputation = hireSummary;
    return out;
  },
  async 'mint-fee'() {
    const fee = await readMintFee();
    return { success: true, mintGate: ADDR.MINTGATE, ...fee, logic: Object.fromEntries(Object.entries(LOGIC).map(([k, a]) => [k, { address: a, name: logicName(a) }])) };
  },
  async 'encode-mint'(args) {
    const f = parseFlags(args);
    const to = requireAddress(f.to, '--to');
    const logic = logicAddressFor(f.logic);
    if (!f.uri || !/^(ipfs:\/\/|https:\/\/)/.test(f.uri)) fail('--uri must be the agent metadata URI (ipfs://<cid> or https://...)');
    const fee = await readMintFee();
    if (fee.globallyPaused) fail('BORT minting is globally paused right now (CircuitBreaker.globalPause is true). Do not preview.');
    // Same shape the bortagent.xyz wizard sends: an empty extended-metadata struct.
    const data = encodeCall(SEL.mint, ['address', 'address', 'string', ['string', 'string', 'string', 'string', 'string', 'bytes32']],
      [to, logic, f.uri, ['', '', '', '', '', '0x' + '0'.repeat(64)]]);
    return {
      success: true, to: ADDR.MINTGATE, value: fee.mintFeeWei, valueBnb: fee.mintFeeBnb, inputData: data,
      summary: { mintTo: to, logicAddress: logic, logic: logicName(logic), metadataURI: f.uri },
      preview: previewCmd(to, ADDR.MINTGATE, fee.mintFeeWei, data),
    };
  },
  async 'hire-plan'(args) {
    const f = parseFlags(args);
    const provider = await providerAddress(f.provider);
    const budget = toBig(f.budget, '--budget');
    const days = Number(f.days || 8);
    if (!Number.isFinite(days) || days <= 0) fail('--days must be a positive number');
    const description = String(f.description || '').trim();
    if (description.length < 10 || description.length > 2000) fail('--description must be 10 to 2000 characters of plain text');
    if (budget < ONE_U) fail(`--budget must be at least 1 $U (1000000000000000000 base units), got ${budget.toString()}`);
    const expiredAt = Math.floor(Date.now() / 1000) + Math.round(days * 86400);
    const lead = expiredAt - Math.floor(Date.now() / 1000);
    if (lead < MIN_EXPIRY_LEAD_SEC) fail(`--days gives ${lead}s until expiry; the BORT provider skips jobs with less than ${MIN_EXPIRY_LEAD_SEC}s (about 7.3 days). Use --days 8 or more.`);
    if (lead > MAX_EXPIRY_LEAD_SEC) fail('--days must be 365 or less');
    // Cross-check the provider against BORT's public directory, so a pasted address is never trusted blind.
    const dir = await apiOrNull('/api/erc8183/providers');
    const listed = dir && Array.isArray(dir.providers) ? dir.providers.find((p) => String(p.tba).toLowerCase() === provider.toLowerCase()) : null;
    const warnings = [];
    if (!dir) warnings.push('Could not read the BORT provider directory; confirm the provider address with the user before previewing.');
    else if (!listed) warnings.push('This address is NOT in the BORT provider directory right now. A job funded to it may never be delivered. Confirm with the user before previewing.');
    const cheapest = listed && Array.isArray(listed.services) && listed.services.length ? listed.services.reduce((m, s) => (BigInt(s.priceU) < m ? BigInt(s.priceU) : m), BigInt(listed.services[0].priceU)) : null;
    if (cheapest !== null && budget < cheapest) warnings.push(`Budget ${fmtU(budget)} $U is below the provider's cheapest listed service (${fmtU(cheapest)} $U).`);
    const from = f.from && isAddress(f.from) ? f.from : null;
    if (from) {
      const [balRet, alwRet] = await Promise.all([
        call(ADDR.U, encodeCall(SEL.balanceOf, ['address'], [from])),
        call(ADDR.U, encodeCall(SEL.allowance, ['address', 'address'], [from, ADDR.COMMERCE])),
      ]);
      const bal = decUint(words(balRet)[0]);
      if (bal < budget) warnings.push(`Wallet ${from} holds ${fmtU(bal)} $U, less than the ${fmtU(budget)} $U budget.`);
      if (decUint(words(alwRet)[0]) >= budget) warnings.push('Allowance already covers the budget; step 1 (approve) can be skipped.');
    }
    const approve = encodeCall(SEL.approve, ['address', 'uint256'], [ADDR.COMMERCE, budget]);
    const createJob = encodeCall(SEL.createJob, ['address', 'address', 'uint256', 'string', 'address'], [provider, ADDR.ROUTER, BigInt(expiredAt), description, ADDR.ROUTER]);
    return {
      success: true,
      summary: { provider, providerAgentId: listed ? listed.agentId : null, budget: budget.toString(), budgetU: fmtU(budget), expiredAt, expiresAtIso: new Date(expiredAt * 1000).toISOString(), description, disputeWindowDays: 7 },
      warnings,
      steps: [
        { step: 1, name: 'approve $U to the APEX kernel', to: ADDR.U, value: '0', inputData: approve, preview: previewCmd(from, ADDR.U, '0', approve) },
        { step: 2, name: 'createJob', to: ADDR.COMMERCE, value: '0', inputData: createJob, preview: previewCmd(from, ADDR.COMMERCE, '0', createJob), then: 'node bort.mjs tx <txHash> and read jobId, then node bort.mjs hire-fund --job-id <jobId> --budget ' + budget.toString() },
      ],
    };
  },
  async 'hire-fund'(args) {
    const f = parseFlags(args);
    if (!/^\d+$/.test(String(f['job-id']))) fail('--job-id must be the jobId printed by `tx` after createJob');
    const jobId = BigInt(f['job-id']);
    const budget = toBig(f.budget, '--budget');
    const job = await readJob(jobId);
    if (!job) fail(`job ${jobId} does not exist on the APEX kernel`);
    const warnings = [];
    if (f.from && isAddress(f.from) && job.client.toLowerCase() !== f.from.toLowerCase()) warnings.push(`Job ${jobId} was created by ${job.client}, not by ${f.from}. Only the client can fund it.`);
    if (job.status !== 'open') warnings.push(`Job ${jobId} is already ${job.status}.`);
    const registerJob = encodeCall(SEL.registerJob, ['uint256', 'address'], [jobId, ADDR.POLICY]);
    const setBudget = encodeCall(SEL.setBudget, ['uint256', 'uint256', 'bytes'], [jobId, budget, '0x']);
    const fund = encodeCall(SEL.fund, ['uint256', 'uint256', 'bytes'], [jobId, budget, '0x']);
    const from = f.from && isAddress(f.from) ? f.from : null;
    return {
      success: true, job, budget: budget.toString(), budgetU: fmtU(budget), warnings,
      steps: [
        { step: 3, name: 'registerJob with the OptimisticPolicy', to: ADDR.ROUTER, value: '0', inputData: registerJob, preview: previewCmd(from, ADDR.ROUTER, '0', registerJob) },
        { step: 4, name: 'setBudget', to: ADDR.COMMERCE, value: '0', inputData: setBudget, preview: previewCmd(from, ADDR.COMMERCE, '0', setBudget) },
        { step: 5, name: 'fund (moves the $U into escrow)', to: ADDR.COMMERCE, value: '0', inputData: fund, preview: previewCmd(from, ADDR.COMMERCE, '0', fund), then: `GET ${API}/api/erc8183/job/${jobId} until status is submitted or completed` },
      ],
    };
  },
  async 'encode-dispute'(args) {
    const f = parseFlags(args); if (!/^\d+$/.test(String(f['job-id']))) fail('usage: encode-dispute --job-id <id>');
    const data = encodeCall(SEL.dispute, ['uint256'], [BigInt(f['job-id'])]);
    return { success: true, to: ADDR.POLICY, value: '0', inputData: data, preview: previewCmd(f.from, ADDR.POLICY, '0', data), note: 'Only the job client can dispute, and only inside the 7-day window after the deliverable was submitted.' };
  },
  async 'encode-claim-refund'(args) {
    const f = parseFlags(args); if (!/^\d+$/.test(String(f['job-id']))) fail('usage: encode-claim-refund --job-id <id>');
    const data = encodeCall(SEL.claimRefund, ['uint256'], [BigInt(f['job-id'])]);
    return { success: true, to: ADDR.COMMERCE, value: '0', inputData: data, preview: previewCmd(f.from, ADDR.COMMERCE, '0', data), note: 'Refunds the client only after expiredAt has passed and the job was never completed.' };
  },
  async job([jobId]) {
    if (!/^\d+$/.test(String(jobId))) fail('usage: job <jobId>');
    const [onchain, bort] = await Promise.all([readJob(BigInt(jobId)), apiOrNull(`/api/erc8183/job/${jobId}`)]);
    if (!onchain) return { success: false, error: `job ${jobId} does not exist on the APEX kernel` };
    const out = { success: true, onchain, bort: bort || null };
    if (bort && bort.cid) out.deliverableUrl = `https://ipfs.io/ipfs/${bort.cid}`;
    return out;
  },
  async tx([hash]) {
    if (!/^0x[0-9a-fA-F]{64}$/.test(String(hash))) fail('usage: tx <0x transaction hash>');
    const receipt = await rpc('eth_getTransactionReceipt', [hash]);
    if (!receipt) return { success: true, hash, status: 'pending', note: 'Not mined yet. Run this command again in a few seconds.' };
    const ok = receipt.status === '0x1';
    const events = [];
    for (const log of receipt.logs || []) {
      const t0 = (log.topics || [])[0];
      if (t0 === TOPIC.AgentMinted) events.push({ event: 'AgentMinted', payer: decAddress(log.topics[1].slice(2)), to: decAddress(log.topics[2].slice(2)), tokenId: decUint(log.topics[3].slice(2)).toString() });
      else if (t0 === TOPIC.JobCreated) events.push({ event: 'JobCreated', jobId: decUint(log.topics[1].slice(2)).toString(), client: decAddress(log.topics[2].slice(2)), provider: decAddress(log.topics[3].slice(2)) });
      else if (t0 === TOPIC.JobFunded) events.push({ event: 'JobFunded', jobId: decUint(log.topics[1].slice(2)).toString(), amount: decUint(words(log.data)[0]).toString() });
    }
    const minted = events.find((e) => e.event === 'AgentMinted');
    const created = events.find((e) => e.event === 'JobCreated');
    return {
      success: true, hash, status: ok ? 'confirmed' : 'reverted', blockNumber: Number(receipt.blockNumber), events,
      ...(minted ? { tokenId: minted.tokenId, page: `https://bortagent.xyz/#/agent/${minted.tokenId}` } : {}),
      ...(created ? { jobId: created.jobId } : {}),
      explorer: `https://bscscan.com/tx/${hash}`,
    };
  },
  async 'u-balance'([address]) {
    requireAddress(address, 'address');
    const [balRet, alwRet] = await Promise.all([
      call(ADDR.U, encodeCall(SEL.balanceOf, ['address'], [address])),
      call(ADDR.U, encodeCall(SEL.allowance, ['address', 'address'], [address, ADDR.COMMERCE])),
    ]);
    const bal = decUint(words(balRet)[0]); const alw = decUint(words(alwRet)[0]);
    return { success: true, address, token: ADDR.U, balance: bal.toString(), balanceU: fmtU(bal), allowanceToCommerce: alw.toString(), allowanceToCommerceU: fmtU(alw) };
  },

  // ── Owner session (references/owner-session.md) ─────────────────────────────────────────────

  // Ask BORT for the EIP-712 Login struct to sign, and print the exact `baw sign-message preview` command. The
  // struct is checked here before it is shown: it must name this wallet, this agent, this scope and BNB Chain,
  // with the one statement BORT writes for the scope. Anything else is refused unsigned.
  async 'login-challenge'(args) {
    const f = parseFlags(args);
    const wallet = requireAddress(f.wallet, '--wallet');
    const { scope, agentId } = sessionTarget(f);
    const r = await apiPost('/api/session/eip712/challenge', { signer: wallet, scope, agentId });
    if (r.status !== 200) fail(`BORT refused the challenge (HTTP ${r.status}): ${apiError(r)}`);
    const c = r.body && typeof r.body === 'object' ? r.body : {};
    const td = c.typedData && typeof c.typedData === 'object' ? c.typedData : {};
    const m = td.message || {}; const d = td.domain || {};
    const expected = ['wallet', 'statement', 'scope', 'agentId', 'nonce', 'expiry'];
    const loginType = Array.isArray(td.types && td.types.Login) ? td.types.Login.map((x) => x.name) : [];
    if (String(m.wallet).toLowerCase() !== wallet.toLowerCase() || Number(m.agentId) !== agentId || m.scope !== scope
      || m.statement !== sessionStatement(scope, agentId) || d.name !== 'BORT' || d.version !== '1' || Number(d.chainId) !== 56
      || d.verifyingContract !== undefined || td.primaryType !== 'Login' || JSON.stringify(loginType) !== JSON.stringify(expected)
      || !NONCE_RE.test(String(c.nonce)) || m.nonce !== c.nonce || !Number.isInteger(c.expiry) || m.expiry !== c.expiry
      || c.expiry > Math.floor(Date.now() / 1000) + 600 || typeof c.signRequest !== 'string') {
      fail('the challenge BORT returned does not name this wallet, this agent and BNB Chain with the expected statement; do not sign it');
    }
    let req; try { req = JSON.parse(c.signRequest); } catch (_) { fail('the sign request BORT returned is not JSON; do not sign it'); }
    if (!req || req.method !== 'eth_signTypedData_v4' || !Array.isArray(req.params) || String(req.params[0]).toLowerCase() !== wallet.toLowerCase()
      || typeof req.params[1] !== 'string' || JSON.stringify(JSON.parse(req.params[1])) !== JSON.stringify(td)) {
      fail('the sign request BORT returned does not carry the same typed data; do not sign it');
    }
    return {
      success: true, wallet, agentId, scope, nonce: c.nonce, expiry: c.expiry, expiresAtIso: new Date(c.expiry * 1000).toISOString(),
      statement: m.statement, typedData: td, message: c.signRequest,
      preview: `baw sign-message preview --binanceChainId 56 --signType EIP712 --message ${shellQuote(c.signRequest)} --json`,
      then: `baw sign-message execute --requestId <requestId> --json, then node bort.mjs login --wallet ${wallet} --agent ${agentId}${scope === 'admin' ? '' : ` --scope ${scope}`} --nonce ${c.nonce} --expiry ${c.expiry} --signature <signature> --recovery <signatureRecovery>`,
      note: 'The nonce is good for one login and the challenge for ten minutes. Show the user the statement and the wallet before previewing.',
    };
  },
  // Exchange the signature `baw sign-message execute` printed for the session, and store it (never print it).
  async login(args) {
    const f = parseFlags(args);
    const wallet = requireAddress(f.wallet, '--wallet');
    const { scope, agentId } = sessionTarget(f);
    if (!NONCE_RE.test(String(f.nonce))) fail('--nonce must be the nonce login-challenge printed');
    if (!/^\d+$/.test(String(f.expiry))) fail('--expiry must be the expiry login-challenge printed (Unix seconds)');
    const signature = String(f.signature === undefined ? '' : f.signature).trim().replace(/^0x/i, '');
    if (!/^([0-9a-fA-F]{128}|[0-9a-fA-F]{130})$/.test(signature)) fail('--signature must be the hex signature sign-message execute printed (64 bytes with --recovery, or 65 bytes)');
    const body = { signer: wallet, scope, agentId, nonce: String(f.nonce), expiry: Number(f.expiry), signature: '0x' + signature };
    if (f.recovery !== undefined && f.recovery !== 'true') body.signatureRecovery = String(f.recovery);
    if (signature.length === 128 && body.signatureRecovery === undefined) fail('a 64-byte signature needs --recovery <signatureRecovery> (the "00" or "01" sign-message execute printed)');
    const r = await apiPost('/api/session/eip712/token', body);
    if (r.status !== 200) fail(`BORT refused the login (HTTP ${r.status}${r.authKind ? ', ' + r.authKind : ''}): ${apiError(r)}`);
    if (!r.body || typeof r.body.sessionToken !== 'string' || !Number.isFinite(r.body.expiresAt)) fail('BORT answered without a session');
    const stored = saveSession(scope, agentId, wallet, r.body.sessionToken, r.body.expiresAt);
    return {
      success: true, wallet, agentId, scope, expiresAt: r.body.expiresAt, expiresAtIso: new Date(r.body.expiresAt).toISOString(), stored,
      note: 'The session is stored in that file (mode 0600) and never printed. soul-status and soul-save read it from there.',
    };
  },
  async 'session-clear'(args) {
    const f = parseFlags(args);
    const wallet = requireAddress(f.wallet, '--wallet');
    const { scope, agentId } = sessionTarget(f);
    const file = sessionFile(scope, agentId, wallet);
    const existed = existsSync(file);
    if (existed) unlinkSync(file);
    return { success: true, removed: existed, file };
  },
  async 'soul-providers'() {
    const r = await api('/api/soul/providers');
    if (r.status !== 200) fail(`BORT answered HTTP ${r.status}: ${apiError(r)}`);
    return { success: true, ...(r.body && typeof r.body === 'object' ? r.body : { providers: r.body }) };
  },
  async 'soul-templates'() {
    const r = await api('/api/soul/templates');
    if (r.status !== 200) fail(`BORT answered HTTP ${r.status}: ${apiError(r)}`);
    return { success: true, ...(r.body && typeof r.body === 'object' ? r.body : { templates: r.body }) };
  },
  // The public status of the agent's soul, plus the owner-only saved prompt when a session is stored for --wallet.
  async 'soul-status'(args) {
    const f = parseFlags(args);
    if (!/^\d+$/.test(String(f.agent))) fail('usage: soul-status --agent <tokenId> [--wallet <address>]');
    const agentId = Number(f.agent);
    const st = await api(`/api/soul/status/${agentId}`);
    if (st.status !== 200) fail(`BORT answered HTTP ${st.status} for the status: ${apiError(st)}`);
    const out = { success: true, agentId, status: st.body, page: `https://bortagent.xyz/#/agent/${agentId}` };
    if (f.wallet === undefined) { out.note = 'Pass --wallet <address> to read the saved prompt with the stored owner session.'; return out; }
    const wallet = requireAddress(f.wallet, '--wallet');
    const session = loadSession('admin', agentId, wallet);
    if (!session) {
      out.session = null;
      out.note = 'No live owner session is stored for this wallet and agent: run login-challenge, then login (references/owner-session.md).';
      return out;
    }
    out.session = { expiresAt: session.expiresAt, expiresAtIso: new Date(session.expiresAt).toISOString() };
    const p = await apiGet(`/api/soul/${agentId}/prompt`, ownerHeaders(session, wallet));
    if (p.status === 200) out.prompt = p.body;
    else if (p.status === 404) out.prompt = null;
    else if (p.status === 401 || p.status === 403) { out.prompt = null; out.session = null; out.note = `BORT no longer takes the stored session (HTTP ${p.status}: ${apiError(p)}); run login-challenge and login again.`; }
    else { out.prompt = null; out.promptError = `HTTP ${p.status}: ${apiError(p)}`; }
    return out;
  },
  // Save the whole soul with the stored admin session. The provider key comes from an environment variable or a
  // file, never from the command line, and is never printed.
  async 'soul-save'(args) {
    const f = parseFlags(args);
    const wallet = requireAddress(f.wallet, '--wallet');
    if (!/^\d+$/.test(String(f.agent))) fail('usage: soul-save --agent <tokenId> --wallet <address> --provider <provider> [--model <model>] [--api-key-env VAR | --api-key-file <path>] [--prompt-file <path> | --prompt <text>] [--name <name>] [--tone <tone>] [--description <text>] [--temperature <0-2>] [--max-tokens <n>] [--config <file.json>]');
    const agentId = Number(f.agent);
    const session = loadSession('admin', agentId, wallet);
    if (!session) fail('No live owner session is stored for this wallet and agent: run login-challenge, then login (references/owner-session.md).');
    let soulConfig = {};
    if (f.config) {
      try { soulConfig = JSON.parse(readFileSync(f.config, 'utf8')); } catch (e) { fail(`--config could not be read as JSON: ${e.message}`); }
      if (!soulConfig || typeof soulConfig !== 'object' || Array.isArray(soulConfig)) fail('--config must hold a JSON object');
    }
    if (f.provider) soulConfig.llmProvider = String(f.provider);
    if (f.model) soulConfig.llmModel = String(f.model);
    if (f['api-key-env']) {
      const key = process.env[f['api-key-env']];
      if (!key) fail(`environment variable ${f['api-key-env']} is empty or unset`);
      soulConfig.apiKey = key;
    }
    if (f['api-key-file']) { try { soulConfig.apiKey = readFileSync(f['api-key-file'], 'utf8').trim(); } catch (e) { fail(`--api-key-file could not be read: ${e.message}`); } }
    if (f['prompt-file']) { try { soulConfig.systemPrompt = readFileSync(f['prompt-file'], 'utf8'); } catch (e) { fail(`--prompt-file could not be read: ${e.message}`); } }
    else if (typeof f.prompt === 'string' && f.prompt !== 'true') soulConfig.systemPrompt = f.prompt;
    if (f.name || f.tone || f.description) {
      soulConfig.personality = { ...(soulConfig.personality && typeof soulConfig.personality === 'object' ? soulConfig.personality : {}) };
      if (f.name) soulConfig.personality.name = String(f.name);
      if (f.tone) soulConfig.personality.tone = String(f.tone);
      if (f.description) soulConfig.personality.description = String(f.description);
    }
    if (f.temperature !== undefined) soulConfig.temperature = Number(f.temperature);
    if (f['max-tokens'] !== undefined) soulConfig.maxTokens = Number(f['max-tokens']);
    if (!soulConfig.llmProvider) fail('--provider is required: a key from soul-providers');
    const r = await apiPost('/api/soul', { agentId, soulConfig }, ownerHeaders(session, wallet));
    if (r.status === 401 || r.status === 403) fail(`BORT no longer takes the stored session (HTTP ${r.status}: ${apiError(r)}); run login-challenge and login again`);
    if (r.status !== 200) fail(`BORT refused the save (HTTP ${r.status}): ${apiError(r)}`);
    const saved = r.body && typeof r.body === 'object' ? r.body : {};
    delete saved.apiKey; // never in the response, kept out of the output regardless
    return { success: true, agentId, ...saved, page: `https://bortagent.xyz/#/agent/${agentId}` };
  },
  async knowledge([tokenId]) {
    if (!/^\d+$/.test(String(tokenId))) fail('usage: knowledge <tokenId>');
    const r = await api(`/api/knowledge/${tokenId}`);
    if (r.status !== 200) fail(`BORT answered HTTP ${r.status}: ${apiError(r)}`);
    return { success: true, ...(r.body && typeof r.body === 'object' ? r.body : { sources: r.body }), registry: ADDR.KNOWLEDGE };
  },
  // Calldata for KnowledgeRegistry.addKnowledgeSource: owner-only on chain, so the owning wallet is msg.sender and no
  // session is involved.
  async 'encode-add-knowledge'(args) {
    const f = parseFlags(args);
    if (!/^\d+$/.test(String(f.agent))) fail('usage: encode-add-knowledge --agent <tokenId> --uri <uri> [--type <type>] [--priority <n>] [--description <text>] [--content-hash <bytes32>] [--from <wallet>]');
    const agentId = BigInt(f.agent);
    if (!f.uri || !/^(ipfs:\/\/|https:\/\/)/.test(f.uri)) fail('--uri must be ipfs://<cid> or https://...');
    const typeKey = String(f.type === undefined || f.type === 'true' ? 'reference' : f.type).toLowerCase();
    const typeIndex = KNOWLEDGE_TYPES.indexOf(typeKey);
    if (typeIndex < 0) fail(`--type must be one of ${KNOWLEDGE_TYPES.join(', ')}`);
    const priority = f.priority === undefined ? 100n : toBig(f.priority, '--priority');
    const description = f.description === undefined || f.description === 'true' ? '' : String(f.description);
    const contentHash = f['content-hash'] === undefined ? '0x' + '0'.repeat(64) : String(f['content-hash']);
    if (!/^0x[0-9a-fA-F]{64}$/.test(contentHash)) fail('--content-hash must be 32 bytes of hex (0x + 64 hex characters)');
    const st = await readState(agentId);
    if (!st || /^0x0+$/.test(st.owner)) fail(`agent ${f.agent} does not exist on BAP578`);
    const warnings = [];
    if (f.from && isAddress(f.from) && st.owner.toLowerCase() !== f.from.toLowerCase()) warnings.push(`Agent ${f.agent} is owned by ${st.owner}, not by ${f.from}. The registry refuses anyone but the owner.`);
    const data = encodeCall(SEL.addKnowledgeSource, ['uint256', 'string', 'uint8', 'uint256', 'string', 'bytes32'], [agentId, f.uri, BigInt(typeIndex), priority, description, contentHash]);
    return {
      success: true, to: ADDR.KNOWLEDGE, value: '0', inputData: data,
      summary: { agentId: f.agent, owner: st.owner, uri: f.uri, type: typeKey, priority: priority.toString(), description, contentHash },
      warnings, preview: previewCmd(f.from, ADDR.KNOWLEDGE, '0', data), then: `node bort.mjs tx <txHash>, then node bort.mjs knowledge ${f.agent}`,
    };
  },

  // ── BORT agent names under the owner's Agent ID (references/agent-names.md) ──────────────────
  // resolve <name> [--display]: the agent a BORT name points at. Live ownership check by default (for a payment or a
  // hire); --display reads the short caches instead, for showing only.
  async resolve([name, ...rest]) {
    if (!isBortName(name)) fail('usage: resolve <label>.<handle>.ai, e.g. resolve fly.example.ai (a BORT agent name under a Binance Agent ID)');
    const f = parseFlags(rest);
    const r = await resolveBortName(name, { forPayment: !f.display });
    return { success: true, ...r, note: 'A BORT agent name. Only BORT resolves it; a Binance wallet needs the 0x. It is cleared if the agent is sold.' };
  },
  // name-set --agent <id> --wallet <owner> --label <label>: name an agent you own under the Agent ID your wallet holds.
  async 'name-set'(args) {
    const f = parseFlags(args);
    if (!/^\d+$/.test(String(f.agent))) fail('--agent must be the agent tokenId');
    const wallet = requireAddress(f.wallet, '--wallet');
    const label = String(f.label || '').trim().toLowerCase();
    if (!/^[a-z0-9-]{1,20}$/.test(label)) fail('--label must be 1 to 20 characters of a-z, 0-9 or -');
    const session = loadSession('admin', Number(f.agent), wallet);
    if (!session) fail(`no owner session for agent ${f.agent} and ${wallet}: run login-challenge, baw sign-message, then login first (references/owner-session.md)`);
    const r = await apiSend('PUT', `/api/agents/${Number(f.agent)}/name`, { label }, ownerHeaders(session, wallet));
    if (r.status !== 200) fail(`BORT refused the name (HTTP ${r.status}): ${apiError(r)}`);
    return { success: true, ...r.body };
  },
  // name-clear --agent <id> --wallet <owner>: remove the agent's BORT name.
  async 'name-clear'(args) {
    const f = parseFlags(args);
    if (!/^\d+$/.test(String(f.agent))) fail('--agent must be the agent tokenId');
    const wallet = requireAddress(f.wallet, '--wallet');
    const session = loadSession('admin', Number(f.agent), wallet);
    if (!session) fail(`no owner session for agent ${f.agent} and ${wallet}: run login-challenge, baw sign-message, then login first (references/owner-session.md)`);
    const r = await apiSend('DELETE', `/api/agents/${Number(f.agent)}/name`, undefined, ownerHeaders(session, wallet));
    if (r.status !== 200) fail(`BORT refused (HTTP ${r.status}): ${apiError(r)}`);
    return { success: true, ...r.body };
  },

  // a2a-settings --agent <id> --wallet <owner> --enabled true|false [--price-u <whole $U>]: open or close paid
  // questions to an agent you own (references/owner-session.md). Only an agent on its owner's own provider key
  // can sell answers (a hosted agent stays closed: BORT does not resell its own inference through it).
  async 'a2a-settings'(args) {
    const f = parseFlags(args);
    if (!/^\d+$/.test(String(f.agent))) fail('--agent must be the agent tokenId');
    const wallet = requireAddress(f.wallet, '--wallet');
    // parseFlags turns a bare `--enabled` into 'true'; opening paid questions must never ride on an omitted
    // value, so the token after --enabled is read from argv and has to say true or false itself.
    const at = args.indexOf('--enabled');
    const rawEnabled = at >= 0 ? args[at + 1] : undefined;
    if (rawEnabled !== 'true' && rawEnabled !== 'false') fail('--enabled must be given explicitly as true or false');
    const body = { enabled: rawEnabled === 'true' };
    if (f['price-u'] !== undefined) {
      const n = Number(f['price-u']);
      if (!Number.isFinite(n) || n < 0 || n > 1000) fail('--price-u must be the price per question in whole $U, 0 to 1000');
      body.a2aPriceU = ethers_parseUnits(String(n));
    }
    const session = loadSession('admin', Number(f.agent), wallet);
    if (!session) fail(`no owner session for agent ${f.agent} and ${wallet}: run login-challenge, baw sign-message, then login first (references/owner-session.md)`);
    const r = await apiPost(`/api/soul/${Number(f.agent)}/a2a-settings`, body, ownerHeaders(session, wallet));
    if (r.status !== 200) fail(`BORT refused (HTTP ${r.status}): ${apiError(r)}`);
    return { success: true, ...r.body, priceUHuman: r.body && r.body.a2aPriceU ? fmtU(BigInt(r.body.a2aPriceU)) : '0' };
  },
};

// Whole $U (a decimal string) to base units (18 decimals), without ethers: "0.1" -> "100000000000000000".
function ethers_parseUnits(s) {
  const m = /^(\d+)(?:\.(\d{1,18}))?$/.exec(String(s).trim());
  if (!m) fail(`not a $U amount: ${s}`);
  return (BigInt(m[1]) * ONE_U + BigInt((m[2] || '').padEnd(18, '0'))).toString();
}

export const COMMANDS = Object.keys(commands);
export async function run(cmd, args) { if (!commands[cmd]) throw new Error(`unknown command ${cmd}`); return commands[cmd](args); }

// Run as a CLI only when executed directly; `import()` from a test gets the exports above.
const invokedDirectly = (() => { try { return process.argv[1] && pathToFileURL(process.argv[1]).href === import.meta.url; } catch (_) { return false; } })();
if (!invokedDirectly) { /* imported as a module */ } else {
const [cmd, ...rest] = process.argv.slice(2);
if (!cmd || cmd === 'help' || !commands[cmd]) {
  process.stdout.write(JSON.stringify({ success: !!(cmd === 'help'), commands: Object.keys(commands), rpc: RPCS, api: API, error: cmd && cmd !== 'help' ? `unknown command ${cmd}` : undefined }) + '\n');
  process.exit(cmd === 'help' ? 0 : 1);
}
commands[cmd](rest).then((out) => {
  process.stdout.write(JSON.stringify(out, (_, v) => (typeof v === 'bigint' ? v.toString() : v), 2) + '\n');
  process.exit(out && out.success === false ? 1 : 0);
}).catch((e) => fail(e && e.message ? e.message : String(e)));
}

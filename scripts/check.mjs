// Repository rules, run on every push (see .github/workflows/check.yml) and before publishing:
//   every skill has a SKILL.md with name, description and version in its frontmatter;
//   files are LF, have no em dash, and carry no real agent numbers, real people's Agent IDs,
//   real wallets or anything shaped like a credential. Exit 1 on the first rule broken.
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';

const ROOT = new URL('..', import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1');
const walk = (d) => readdirSync(d).flatMap((n) => {
  const p = join(d, n);
  if (n === '.git' || n === 'node_modules') return [];
  return statSync(p).isDirectory() ? walk(p) : [p];
});

const problems = [];
const say = (f, msg) => problems.push(`${relative(ROOT, f)}: ${msg}`);

const skills = readdirSync(join(ROOT, 'skills')).filter((n) => statSync(join(ROOT, 'skills', n)).isDirectory());
for (const s of skills) {
  const f = join(ROOT, 'skills', s, 'SKILL.md');
  let text;
  try { text = readFileSync(f, 'utf8'); } catch { say(f, 'missing SKILL.md'); continue; }
  const front = text.split('---')[1] || '';
  for (const key of ['name:', 'description:', 'version:']) if (!front.includes(key)) say(f, `frontmatter lacks ${key}`);
  if (!front.includes(`name: ${s}`)) say(f, `frontmatter name must be ${s}`);
}

const RULES = [
  [/\r/, 'CRLF or lone CR (files must be LF)'],
  [/—/, 'em dash'],
  [/\b11[0-9]{3}\b/, 'looks like a real agent number (use <tokenId>)'],
  [/\bheyi\b|\bbortid\b|\bbort\.ai\b/i, 'a real Agent ID used as an example (use example.ai)'],
  [/0x1F3CBddCb9257A54d10325f900F6364C1d86BdC0|0x72b73415e263c2b976b2770ee764bacd02ec3004|0xf4A9527f1551Ab68a6770088e6Faab94B565a44D|0x84543FbB545ad78e40E70cEa3c254Bd8E0ea755E/i, 'a real wallet used as an example'],
  [/-----BEGIN [A-Z ]*PRIVATE KEY-----|sk-[A-Za-z0-9]{20,}|AKIA[0-9A-Z]{16}|xox[baprs]-[A-Za-z0-9-]{10,}|ghp_[A-Za-z0-9]{30,}/, 'credential-shaped string'],
  [/(api[_-]?key|secret|password|token)\s*[:=]\s*["'][A-Za-z0-9+/_-]{16,}["']/i, 'inline credential assignment'],
  [/onrender\.com|supabase\.co/, 'internal host'],
];
const TOPIC_OK = /^0x[0-9a-f]{64}$/; // event topics and selectors are public constants, not keys

for (const f of walk(ROOT)) {
  if (!/\.(md|mjs|js|json|yml|yaml|sh|txt)$/.test(f) && !f.endsWith('LICENSE')) continue;
  if (f.endsWith('check.mjs')) continue; // the rules themselves spell out what they forbid
  const text = readFileSync(f, 'utf8');
  for (const [re, what] of RULES) if (re.test(text)) say(f, what);
  // a 32-byte hex that is NOT a known public constant is suspicious: list it for a human
  for (const m of text.match(/0x[0-9a-fA-F]{64}/g) || []) {
    const line = text.split('\n').find((l) => l.includes(m)) || '';
    if (!/topic|keccak|selector|Transfer\(|Created\(|Funded\(|Minted\(|sha256|hash|zero|0'\.repeat|'00'\.repeat|'11'\.repeat/i.test(line) && TOPIC_OK.test(m)) say(f, `unexplained 32-byte hex ${m.slice(0, 12)}…`);
  }
}

if (problems.length) { console.error(problems.join('\n')); process.exit(1); }
console.log(`ok: ${skills.length} skills, ${walk(ROOT).length} files checked`);

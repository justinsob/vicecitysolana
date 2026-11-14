// One-off: walk the whole history of the PumpSwap VICECITY/WASTED pool on Solana and
// collect every sell worth at least MIN_USD at the time, for the Hall of Fumblers.
//   node backfill.mjs out.json
import { writeFile } from 'node:fs/promises';

const CA = '2afcRhtGYgp1e3xPBMu2UbnELL8AUMZzguLQsPo8pump';
const WASTED = 'GexThZHgaswpAQ7Fi8QrHFubjPimUNSYhJiAA7XZpump';
const POOL = '7xLmwsPbCSMVvfFQ9JuhMwfbkehJA3mswshVBBWcJ1j2';
const WASTED_POOL = 'TT7DKs9YjJZj1fwMGoPmKBmDreZzyMAMrHoDCGdfwqN';
const RPCS = ['https://solana-rpc.publicnode.com']; // the other free endpoint throttles bulk reads
const MIN_USD = 100, OUT = process.argv[2] || 'backfill.json';
const sleep = ms => new Promise(r => setTimeout(r, ms));

let turn = 0;
async function rpc(method, params) {
  for (let i = 0; i < 10; i++) {
    const url = RPCS[turn++ % RPCS.length];
    try {
      const r = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }) });
      if (!r.ok) throw new Error('HTTP ' + r.status);
      const j = await r.json();
      if (j.error) throw new Error(j.error.message);
      return j.result;
    } catch { await sleep(400 * (i + 1)); }
  }
  throw new Error('rpc gave up: ' + method);
}

function parseSwap(tx) {
  if (!tx || tx.meta.err) return null;
  const delta = new Map();
  for (const [key, sign] of [['preTokenBalances', -1], ['postTokenBalances', 1]])
    for (const b of tx.meta[key] || []) { const k = b.owner + '|' + b.mint; delta.set(k, (delta.get(k) || 0) + sign * Number(b.uiTokenAmount.uiAmountString || 0)); }
  const pv = delta.get(POOL + '|' + CA) || 0, pw = delta.get(POOL + '|' + WASTED) || 0;
  if (!pv || !pw || Math.sign(pv) === Math.sign(pw)) return null;
  const buy = pv < 0;
  let trader = tx.transaction.message.accountKeys[0].pubkey, best = 0;
  for (const [k, v] of delta) { const [o, m] = k.split('|'); if (m !== CA || o === POOL) continue; if (buy ? v > best : v < best) { best = v; trader = o; } }
  return { buy, tokens: Math.abs(pv), wasted: Math.abs(pw), trader };
}

// $WASTED price history in 5-minute steps, to value each sell at the time it happened
const candles = (await (await fetch(`https://api.geckoterminal.com/api/v2/networks/solana/pools/${WASTED_POOL}/ohlcv/minute?aggregate=5&limit=1000`)).json()).data.attributes.ohlcv_list
  .map(c => [c[0], c[4]]).sort((a, b) => a[0] - b[0]);
const wastedAt = t => { let p = candles[0][1]; for (const [ts, close] of candles) { if (ts > t) break; p = close; } return p; };
console.log(`price history: ${candles.length} points from ${new Date(candles[0][0] * 1000).toISOString()}`);

const sigs = [];
for (let before; ;) {
  const page = await rpc('getSignaturesForAddress', [POOL, { limit: 1000, ...(before ? { before } : {}) }]);
  sigs.push(...page.filter(s => !s.err));
  if (page.length < 1000) break;
  before = page.at(-1).signature;
}
console.log(`${sigs.length} transactions to read`);

const sells = [];
let done = 0, failed = 0;
async function worker() {
  for (;;) {
    const s = sigs.pop(); if (!s) return;
    try {
      const swap = parseSwap(await rpc('getTransaction', [s.signature, { encoding: 'jsonParsed', maxSupportedTransactionVersion: 1 }]));
      if (swap && !swap.buy) {
        const usd = swap.wasted * wastedAt(s.blockTime);
        if (usd >= MIN_USD) sells.push({ tx: s.signature, wallet: swap.trader, ts: new Date(s.blockTime * 1000).toISOString(), tokens: swap.tokens, wasted: swap.wasted, usd, price: usd / swap.tokens });
      }
    } catch { failed++; }
    if (++done % 500 === 0) { console.log(`read ${done}, ${sells.length} sells kept, ${failed} failed`); await writeFile(OUT, JSON.stringify(sells)); }
    await sleep(40);
  }
}
await Promise.all(Array.from({ length: 6 }, worker));
sells.sort((a, b) => a.ts < b.ts ? -1 : 1);
await writeFile(OUT, JSON.stringify(sells));
console.log(`finished: ${sells.length} sells of $${MIN_USD}+ kept, ${failed} transactions could not be read`);

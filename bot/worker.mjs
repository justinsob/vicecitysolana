// Cloudflare Worker: posts $VICECITY buy alerts and big-sell alerts to Discord.
// Runs every minute. Each run looks at exactly one finished minute of trades on the
// PumpSwap VICECITY/WASTED pool, read straight from Solana, so it needs no storage
// and never posts the same trade twice.
//
// Secrets (set with `wrangler secret put`, never stored in this repo):
//   BUY_WEBHOOK, FUMBLE_WEBHOOK
// Settings (wrangler.toml [vars]): MIN_BUY_USD, MIN_SELL_USD, LEADERBOARD_HOURS

const CA = '2afcRhtGYgp1e3xPBMu2UbnELL8AUMZzguLQsPo8pump';
const WASTED = 'GexThZHgaswpAQ7Fi8QrHFubjPimUNSYhJiAA7XZpump';
const POOL = '7xLmwsPbCSMVvfFQ9JuhMwfbkehJA3mswshVBBWcJ1j2';
const RPCS = ['https://api.mainnet-beta.solana.com', 'https://solana-rpc.publicnode.com'];
const SITE = 'https://vicecitysolana.cc';
const MAX_TX = 28; // the free plan allows 50 outgoing requests per run

const short = a => a.slice(0, 4) + '…' + a.slice(-4);
const num = n => n >= 1e9 ? (n / 1e9).toFixed(2) + 'B' : n >= 1e6 ? (n / 1e6).toFixed(2) + 'M' : n >= 1e3 ? (n / 1e3).toFixed(1) + 'K' : Math.round(n).toString();
const usd = n => '$' + n.toLocaleString('en-US', { maximumFractionDigits: n < 100 ? 2 : 0 });

async function rpc(method, params) {
  let lastErr;
  for (let i = 0; i < 4; i++) {
    if (i) await new Promise(r => setTimeout(r, 350 * i)); // public endpoints rate-limit shared addresses; back off and try the other one
    try {
      const r = await fetch(RPCS[i % 2], { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }) });
      if (!r.ok) throw new Error(RPCS[i % 2] + ' HTTP ' + r.status);
      const j = await r.json();
      if (j.error) throw new Error(j.error.message);
      return j.result;
    } catch (e) { lastErr = e; }
  }
  throw lastErr;
}

// What a transaction did to the pool: tokens in or out, and who traded.
function parseSwap(tx) {
  if (!tx || tx.meta.err) return null;
  const delta = new Map();
  for (const [key, sign] of [['preTokenBalances', -1], ['postTokenBalances', 1]]) {
    for (const b of tx.meta[key] || []) {
      const k = b.owner + '|' + b.mint;
      delta.set(k, (delta.get(k) || 0) + sign * Number(b.uiTokenAmount.uiAmountString || 0));
    }
  }
  const poolVice = delta.get(POOL + '|' + CA) || 0, poolWasted = delta.get(POOL + '|' + WASTED) || 0;
  if (!poolVice || !poolWasted || Math.sign(poolVice) === Math.sign(poolWasted)) return null; // liquidity change, not a swap
  const buy = poolVice < 0;
  let trader = tx.transaction.message.accountKeys[0].pubkey, best = 0;
  for (const [k, v] of delta) {
    const [owner, mint] = k.split('|');
    if (mint !== CA || owner === POOL) continue;
    if (buy ? v > best : v < best) { best = v; trader = owner; }
  }
  return { buy, tokens: Math.abs(poolVice), wasted: Math.abs(poolWasted), trader };
}

async function send(webhook, username, embeds, env) {
  for (let i = 0; i < embeds.length; i += 10) {
    const payload = { username, embeds: embeds.slice(i, i + 10) };
    if (env.DRY_RUN || !webhook) { for (const e of payload.embeds) console.log('[would post]', username, '·', e.title, '·', e.description.replace(/\n/g, ' | ')); continue; }
    const r = await fetch(webhook, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) });
    if (!r.ok) console.error('Discord said', r.status, await r.text());
  }
}

export async function run(nowMs, env) {
  const minBuy = +(env.MIN_BUY_USD || 100), minSell = +(env.MIN_SELL_USD || 200), boardHours = +(env.LEADERBOARD_HOURS || 6);
  // the minute that finished one minute ago, so every trade in it is final
  const end = Math.floor(nowMs / 60000) * 60 - 60, start = end - 60;

  const sigs = await rpc('getSignaturesForAddress', [POOL, { limit: 200 }]);
  const todo = sigs.filter(s => !s.err && s.blockTime >= start && s.blockTime < end).reverse().slice(0, MAX_TX);
  const minuteOfDay = Math.floor(nowMs / 60000) % 1440, boardDue = minuteOfDay % (boardHours * 60) === 0;
  if (!todo.length && !boardDue) return { checked: 0, buys: 0, sells: 0 };

  const pair = (await (await fetch('https://api.dexscreener.com/latest/dex/pairs/solana/' + POOL)).json()).pair;
  const viceUsd = +pair.priceUsd, wastedUsd = viceUsd / +pair.priceNative, mcap = pair.marketCap ?? pair.fdv;

  const buys = [], sells = [];
  for (const s of todo) {
    let swap = null;
    try { swap = parseSwap(await rpc('getTransaction', [s.signature, { encoding: 'jsonParsed', maxSupportedTransactionVersion: 1 }])); }
    catch (e) { console.error('skipped', s.signature.slice(0, 8), e.message); }
    if (!swap) continue;
    const value = swap.wasted * wastedUsd, tx = 'https://solscan.io/tx/' + s.signature;
    const who = `[${short(swap.trader)}](https://solscan.io/account/${swap.trader})`, when = new Date(s.blockTime * 1000).toISOString();
    if (swap.buy && value >= minBuy) buys.push({
      title: `${usd(value)} BUY`, url: tx, color: 0x3ddc97, timestamp: when, footer: { text: 'vicecitysolana.cc' },
      description: `${'🟢'.repeat(Math.min(12, Math.max(1, Math.round(value / 100))))}\n**${num(swap.tokens)} $VICECITY** for ${num(swap.wasted)} $WASTED\nWallet ${who} · [transaction](${tx})\nMarket cap ${usd(mcap)}` });
    if (!swap.buy && value >= minSell) sells.push({
      title: `Paper hands: ${usd(value)} sold`, url: tx, color: 0xff3b30, timestamp: when, footer: { text: 'Trades, not people. Public on-chain data.' },
      description: `${who} sold **${num(swap.tokens)} $VICECITY** for ${usd(value)}.\nOn the watchlist now. If the price runs, that's a fumble.\n[transaction](${tx}) · [Hall of Fumblers](${SITE}/#fumblers)` });
  }

  if (boardDue) {
    try {
      const listed = (await (await fetch(SITE + '/fumblers.json')).json()).sells.map(x => ({ ...x, fum: x.tokens * viceUsd - x.usd }));
      const top = listed.filter(x => x.fum > 0).sort((a, b) => b.fum - a.fum).slice(0, 5);
      if (top.length) sells.push({
        title: `Top fumbles right now · ${usd(listed.reduce((t, x) => t + Math.max(0, x.fum), 0))} left on the table`, url: SITE + '/#fumblers', color: 0xff3b30,
        footer: { text: "Value of the sold tokens at the live price. Not anyone's profit or loss." },
        description: top.map((x, i) => `**#${i + 1}** ${short(x.wallet)} sold ${num(x.tokens)} for ${usd(x.usd)}. Worth ${usd(x.tokens * viceUsd)} now. **+${usd(x.fum)} fumbled**`).join('\n') + `\n\nLive price $${viceUsd.toPrecision(3)} · market cap ${usd(mcap)}` });
    } catch (e) { console.error('leaderboard failed', e.message); }
  }

  if (buys.length) await send(env.BUY_WEBHOOK, 'Vice City Buys', buys, env);
  if (sells.length) await send(env.FUMBLE_WEBHOOK, 'Hall of Fumblers', sells, env);
  console.log(`checked ${todo.length} trades: ${buys.length} buy alerts, ${sells.length} fumble posts`);
  return { checked: todo.length, buys: buys.length, sells: sells.length };
}

export default {
  async scheduled(event, env, ctx) { ctx.waitUntil(run(event.scheduledTime, env)); },
  // /check does a no-posting run for a recent minute, to confirm the Worker can read trades
  async fetch(req) {
    const url = new URL(req.url);
    if (url.pathname !== '/check') return new Response('Vice City alerts. Runs on a schedule; nothing to see here.');
    const back = Math.min(30, Math.max(0, +(url.searchParams.get('back') || 0)));
    try { return Response.json({ ok: true, ...(await run(Date.now() - back * 60000, { DRY_RUN: '1', MIN_BUY_USD: '50', MIN_SELL_USD: '50', LEADERBOARD_HOURS: '100000' })) }); }
    catch (e) { return Response.json({ ok: false, error: String(e.message || e) }, { status: 500 }); }
  }
};

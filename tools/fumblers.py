#!/usr/bin/env python3
"""Build fumblers.json for the Hall of Fumblers.

Pulls recent $VICECITY sells from GeckoTerminal's public trade feed, checks each
one on Solana mainnet (finalized, no error, the wallet's $VICECITY balance went
down), and merges them into fumblers.json next to index.html. Re-run it to grow
the list; sells already in the file are kept.

    python3 tools/fumblers.py
"""
import json, os, sys, time, urllib.request, urllib.error
from datetime import datetime, timezone

CA = "2afcRhtGYgp1e3xPBMu2UbnELL8AUMZzguLQsPo8pump"
POOLS = [
    "7xLmwsPbCSMVvfFQ9JuhMwfbkehJA3mswshVBBWcJ1j2",  # PumpSwap VICECITY/WASTED
    "6dNiYzSDGtCfN84E49DBEyZoxxVBDGt1k28tKwRkbLqW",  # pump.fun bonding curve (pre-graduation)
]
THRESHOLDS = [0, 50, 150, 400, 1000]   # USD; each call returns at most 300 trades
KEEP = 150
RPC = "https://api.mainnet-beta.solana.com"
OUT = os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "fumblers.json")


def http(url, body=None, tries=6):
    for i in range(tries):
        try:
            req = urllib.request.Request(url, data=body, headers={
                "Accept": "application/json", "Content-Type": "application/json", "User-Agent": "Mozilla/5.0"})
            return json.load(urllib.request.urlopen(req, timeout=25))
        except urllib.error.HTTPError as e:
            if e.code != 429 and e.code < 500:
                raise
        except Exception:
            pass
        time.sleep(4 + i * 4)
    raise RuntimeError("gave up on " + url)


def gecko_sells():
    sells = {}
    for pool in POOLS:
        for thr in THRESHOLDS:
            url = f"https://api.geckoterminal.com/api/v2/networks/solana/pools/{pool}/trades?trade_volume_in_usd_greater_than={thr}"
            rows = http(url).get("data", [])
            for r in rows:
                a = r["attributes"]
                if a["kind"] != "sell" or a["from_token_address"] != CA:
                    continue
                sells[a["tx_hash"]] = {
                    "tx": a["tx_hash"], "wallet": a["tx_from_address"], "ts": a["block_timestamp"],
                    "tokens": float(a["from_token_amount"]), "wasted": float(a["to_token_amount"]),
                    "usd": float(a["volume_in_usd"]), "price": float(a["price_from_in_usd"]),
                }
            print(f"  {pool[:4]}… over ${thr}: {len(rows)} trades", flush=True)
            time.sleep(3)
            if len(rows) < 300:
                break
    return sells


def verify(sell):
    """True if the tx is finalized without error and a wallet's VICECITY balance dropped by the sold amount."""
    body = json.dumps({"jsonrpc": "2.0", "id": 1, "method": "getTransaction", "params": [
        sell["tx"], {"encoding": "jsonParsed", "commitment": "finalized", "maxSupportedTransactionVersion": 1}]}).encode()
    reply = http(RPC, body)
    if reply.get("error"):
        raise RuntimeError(reply["error"].get("message", "RPC error"))
    res = reply.get("result")
    if not res or res["meta"]["err"] is not None:
        return False
    bal = {}
    for key, sign in (("preTokenBalances", -1), ("postTokenBalances", 1)):
        for b in res["meta"].get(key) or []:
            if b["mint"] == CA:
                bal[b.get("owner")] = bal.get(b.get("owner"), 0) + sign * float(b["uiTokenAmount"]["uiAmountString"] or 0)
    signer = res["transaction"]["message"]["accountKeys"][0]["pubkey"]
    if bal.get(signer, 0) < 0:
        sell["wallet"] = signer
        return True
    # sold through a router or bot: credit the wallet whose balance dropped by about the sold amount
    owner, drop = min(bal.items(), key=lambda kv: kv[1], default=(None, 0))
    if owner and -drop >= sell["tokens"] * 0.98:
        sell["wallet"] = owner
        return True
    return False


def main():
    old = {}
    if os.path.exists(OUT):
        old = {s["tx"]: s for s in json.load(open(OUT)).get("sells", [])}
    print("Fetching sells from GeckoTerminal…", flush=True)
    found = gecko_sells()
    new = [s for tx, s in found.items() if tx not in old]
    new.sort(key=lambda s: -s["usd"])
    new = new[:KEEP]
    print(f"{len(found)} sells found, {len(new)} new to check on Solana…", flush=True)
    ok = []
    for i, s in enumerate(new):
        try:
            if verify(s):
                ok.append(s)
        except Exception as e:
            print("  skipped", s["tx"][:8], e, flush=True)
        if i % 20 == 19:
            print(f"  checked {i + 1}/{len(new)}", flush=True)
        time.sleep(0.35)
    sells = sorted(list(old.values()) + ok, key=lambda s: -s["usd"])[:KEEP]
    if not sells:
        sys.exit("No verified sells; fumblers.json left untouched.")
    ts = sorted(s["ts"] for s in sells)
    json.dump({"generated": datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ"),
               "from": ts[0], "to": ts[-1], "sells": sells}, open(OUT, "w"), indent=1)
    print(f"Wrote {len(sells)} checked sells ({len(ok)} new) covering {ts[0]} → {ts[-1]}")


if __name__ == "__main__":
    main()

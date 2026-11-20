import { createClient } from "jsr:@supabase/supabase-js@2";
import { makeSigner } from "./sign.ts";

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
};
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...CORS, "Content-Type": "application/json" } });

const HOST = "https://api.elections.kalshi.com";
const API = "/trade-api/v2";

let signer: ((m: string) => Promise<string>) | null = null;
let signerFor = "";

async function kget(path: string, query: Record<string, string> = {}) {
  const keyId = Deno.env.get("KALSHI_KEY_ID")!;
  const pem = Deno.env.get("KALSHI_PRIVATE_KEY")!;
  if (!signer || signerFor !== pem) {
    signer = await makeSigner(pem);
    signerFor = pem;
  }
  const ts = Date.now().toString();
  const sig = await signer(ts + "GET" + API + path); // query string excluded from the signed path
  const qs = new URLSearchParams(query).toString();
  const res = await fetch(HOST + API + path + (qs ? "?" + qs : ""), {
    headers: {
      "KALSHI-ACCESS-KEY": keyId,
      "KALSHI-ACCESS-TIMESTAMP": ts,
      "KALSHI-ACCESS-SIGNATURE": sig,
      Accept: "application/json",
    },
  });
  if (!res.ok) {
    const t = await res.text();
    throw new Error(`Kalshi ${res.status} on ${path}: ${t.slice(0, 200)}`);
  }
  return res.json();
}

async function fetchMarkets(tickers: string[], out: Record<string, any>) {
  const todo = tickers.filter((t) => t && !out[t]);
  for (let i = 0; i < todo.length; i += 100) {
    const chunk = todo.slice(i, i + 100);
    const d = await kget("/markets", { tickers: chunk.join(","), limit: "100" });
    for (const m of d.markets || []) out[m.ticker] = m;
  }
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  try {
    // 1. Who is asking? Must be a logged-in user on the allow list.
    const token = (req.headers.get("Authorization") || "").replace(/^Bearer\s+/i, "");
    const sb = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_ANON_KEY")!);
    const { data, error } = await sb.auth.getUser(token);
    if (error || !data?.user?.email) return json({ error: "Not signed in" }, 401);
    const allowed = (Deno.env.get("ALLOWED_EMAILS") || "")
      .split(",").map((s) => s.trim().toLowerCase()).filter(Boolean);
    if (!allowed.length) return json({ error: "Server setup incomplete: ALLOWED_EMAILS secret is not set" }, 503);
    if (!allowed.includes(data.user.email.toLowerCase())) return json({ error: "This account is not allowed" }, 403);
    const missing = ["KALSHI_KEY_ID", "KALSHI_PRIVATE_KEY"].filter((k) => !(Deno.env.get(k) || "").trim());
    if (missing.length) {
      return json({ error: "Server setup incomplete: missing secret " + missing.join(" and ") }, 503);
    }

    // 2. Open positions (all pages).
    const positions: any[] = [];
    let cursor = "";
    for (let page = 0; page < 5; page++) {
      const q: Record<string, string> = { limit: "1000" };
      if (cursor) q.cursor = cursor;
      const d = await kget("/portfolio/positions", q);
      for (const p of d.market_positions || []) {
        const n = parseFloat(p.position_fp ?? p.position ?? "0");
        if (n) positions.push(p);
      }
      cursor = d.cursor || "";
      if (!cursor) break;
    }

    // 3. Market details for each position, plus the legs of any combo markets.
    const markets: Record<string, any> = {};
    await fetchMarkets(positions.map((p) => p.ticker), markets);
    const legTickers: string[] = [];
    for (const t of Object.keys(markets)) {
      for (const l of markets[t].mve_selected_legs || []) if (l.market_ticker) legTickers.push(l.market_ticker);
    }
    await fetchMarkets(legTickers, markets);

    return json({ positions, markets, at: Date.now(), user: data.user.email });
  } catch (e) {
    return json({ error: String((e as Error)?.message || e) }, 502);
  }
});

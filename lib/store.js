// Data store — uses Vercel KV (Upstash REST) when configured, else in-memory.
// In-memory resets on cold start (fine for demo). Provision KV in Vercel and set
// KV_REST_API_URL + KV_REST_API_TOKEN for real persistence — no extra deps needed.
import { SEED } from "./seed.js";

const URL = process.env.KV_REST_API_URL;
const TOKEN = process.env.KV_REST_API_TOKEN;
const usingKV = !!(URL && TOKEN);
const PREFIX = "moltbit:";

// in-memory fallback (deep-cloned seed)
const mem = JSON.parse(JSON.stringify(SEED));

async function kvGet(key) {
  const r = await fetch(`${URL}/get/${PREFIX}${key}`, { headers: { Authorization: `Bearer ${TOKEN}` } });
  if (!r.ok) return null;
  const d = await r.json();
  return d.result ? JSON.parse(d.result) : null;
}
async function kvSet(key, val) {
  await fetch(`${URL}/set/${PREFIX}${key}`, {
    method: "POST",
    headers: { Authorization: `Bearer ${TOKEN}`, "content-type": "application/json" },
    body: JSON.stringify(val),
  });
}

// read a collection; seeds it on first access
export async function getCollection(name) {
  if (!usingKV) return mem[name] || [];
  let v = await kvGet(name);
  if (v == null) { v = SEED[name] || []; await kvSet(name, v); }
  return v;
}

export async function setCollection(name, arr) {
  if (!usingKV) { mem[name] = arr; return; }
  await kvSet(name, arr);
}

export const STORE_MODE = usingKV ? "kv" : "memory";

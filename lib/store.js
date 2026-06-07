// Data store — uses Vercel KV / Upstash Redis (REST) when configured, else in-memory.
// In-memory resets on cold start (fine for demo). Provision a Redis store in Vercel
// (Storage → Upstash for Redis) and the connection env vars below enable real
// persistence — no extra deps. Accepts either the Vercel KV names or the Upstash names.
import { SEED } from "./seed.js";

const URL = process.env.KV_REST_API_URL || process.env.UPSTASH_REDIS_REST_URL;
const TOKEN = process.env.KV_REST_API_TOKEN || process.env.UPSTASH_REDIS_REST_TOKEN;
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

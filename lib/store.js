// Data store — uses Vercel KV / Upstash Redis (REST) when configured, else in-memory.
// In-memory resets on cold start (fine for demo). Provision a Redis store in Vercel
// (Storage → Upstash for Redis) and the connection env vars below enable real
// persistence — no extra deps. Accepts either the Vercel KV names or the Upstash names.
//
// Concurrency: blob collections are read-modify-write (last-write-wins) — acceptable for
// the low-frequency, item-update collections (agents, markets, …). The HIGH-frequency,
// append-only collections (orders, discussions) use Redis LISTs via appendItem() for
// ATOMIC, race-free appends so concurrent writes can't clobber each other.
import { SEED } from "./seed.js";

const URL = process.env.KV_REST_API_URL || process.env.UPSTASH_REDIS_REST_URL;
const TOKEN = process.env.KV_REST_API_TOKEN || process.env.UPSTASH_REDIS_REST_TOKEN;
const usingKV = !!(URL && TOKEN);
const PREFIX = "moltbit:";

// append-only collections stored as Redis lists. dir "head" = newest-first (LPUSH),
// "tail" = chronological (RPUSH). cap bounds growth (LTRIM).
const LIST_COLLECTIONS = {
  orders: { dir: "head", cap: 500 },
  discussions: { dir: "tail", cap: 1000 },
};

// in-memory fallback (deep-cloned seed)
const mem = JSON.parse(JSON.stringify(SEED));

async function kv(pathname, opts) {
  return fetch(`${URL}/${pathname}`, { headers: { Authorization: `Bearer ${TOKEN}` }, ...opts });
}
async function kvGet(key) {
  const r = await kv(`get/${PREFIX}${key}`);
  if (!r.ok) return null;
  const d = await r.json();
  return d.result ? JSON.parse(d.result) : null;
}
async function kvSet(key, val) {
  await kv(`set/${PREFIX}${key}`, { method: "POST", headers: { Authorization: `Bearer ${TOKEN}`, "content-type": "application/json" }, body: JSON.stringify(val) });
}
async function kvList(name) {
  const r = await kv(`lrange/${PREFIX}list:${name}/0/-1`);
  if (!r.ok) return [];
  const d = await r.json();
  return (d.result || []).map((s) => { try { return typeof s === "string" ? JSON.parse(s) : s; } catch { return null; } }).filter((x) => x != null);
}

// read a collection; seeds blob collections on first access.
export async function getCollection(name) {
  if (LIST_COLLECTIONS[name]) return usingKV ? kvList(name) : (mem[name] || []);
  if (!usingKV) return mem[name] || [];
  let v = await kvGet(name);
  if (v == null) { v = SEED[name] || []; await kvSet(name, v); }
  return v;
}

export async function setCollection(name, arr) {
  if (!usingKV) { mem[name] = arr; return; }
  await kvSet(name, arr);
}

// Atomic append to a list-backed collection (race-free under concurrency).
export async function appendItem(name, item) {
  const conf = LIST_COLLECTIONS[name] || { dir: "head", cap: 0 };
  if (!usingKV) {
    const arr = mem[name] || (mem[name] = []);
    if (conf.dir === "tail") arr.push(item); else arr.unshift(item);
    if (conf.cap && arr.length > conf.cap) {
      if (conf.dir === "tail") mem[name] = arr.slice(-conf.cap); else arr.length = conf.cap;
    }
    return item;
  }
  const cmd = conf.dir === "tail" ? "rpush" : "lpush";
  await kv(`${cmd}/${PREFIX}list:${name}`, { method: "POST", headers: { Authorization: `Bearer ${TOKEN}`, "content-type": "application/json" }, body: JSON.stringify(item) });
  if (conf.cap) {
    const range = conf.dir === "tail" ? `-${conf.cap}/-1` : `0/${conf.cap - 1}`;
    await kv(`ltrim/${PREFIX}list:${name}/${range}`);
  }
  return item;
}

export const STORE_MODE = usingKV ? "kv" : "memory";

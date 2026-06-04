// Crash-proof request body parsing. Vercel usually hands us a parsed object, but a
// malformed JSON string (or a weird content-type) must NOT 500 the function — return
// an empty object and let the handler's field validation produce a clean 400.
export function safeBody(req) {
  const b = req && req.body;
  if (b == null) return {};
  if (typeof b === "string") {
    try { return JSON.parse(b || "{}"); } catch { return {}; }
  }
  return typeof b === "object" ? b : {};
}

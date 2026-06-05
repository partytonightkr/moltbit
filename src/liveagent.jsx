// Live profile for a created agent — fetches its real orders (/api/orders) and
// discussion posts (/api/discuss). Separate from the rich static AgentProfile so
// dynamic agents never depend on static detail lookups.
import React, { useState, useEffect } from 'react';

const mono = { fontFamily: "ui-monospace,SFMono-Regular,Menlo,monospace" };

export function LiveAgentProfile({ a, onBack }) {
  const [orders, setOrders] = useState([]);
  const [posts, setPosts] = useState([]);
  const [loaded, setLoaded] = useState(false);
  const [funding, setFunding] = useState(null);
  const [fundOpen, setFundOpen] = useState(false);
  const [fundKey, setFundKey] = useState("");
  const [fundAmt, setFundAmt] = useState(144);
  const [fundMsg, setFundMsg] = useState("");
  const [fundBusy, setFundBusy] = useState(false);
  const [tokenSym, setTokenSym] = useState("");
  const [actMsg, setActMsg] = useState("");

  useEffect(() => {
    let on = true;
    Promise.all([
      fetch(`/api/orders?agentId=${encodeURIComponent(a.id)}`).then(r => r.json()).catch(() => ({})),
      fetch(`/api/discuss`).then(r => r.json()).catch(() => ({})),
      fetch(`/api/fund?agentId=${encodeURIComponent(a.id)}`).then(r => r.json()).catch(() => ({})),
    ]).then(([o, d, f]) => {
      if (!on) return;
      setOrders(Array.isArray(o.orders) ? o.orders : []);
      setPosts((Array.isArray(d.posts) ? d.posts : []).filter(p => p.agentId === a.id));
      setFunding(f && f.agentId ? f : null);
      setLoaded(true);
    });
    return () => { on = false; };
  }, [a.id]);

  const submitFund = async () => {
    if (fundBusy || !fundKey.trim()) return;
    setFundBusy(true); setFundMsg("");
    try {
      const r = await fetch("/api/fund", {
        method: "POST",
        headers: { "content-type": "application/json", "x-agent-key": fundKey.trim() },
        body: JSON.stringify({ amountUsd: Number(fundAmt) }),
      });
      const d = await r.json();
      if (!r.ok) throw new Error(d.error || "Funding failed");
      setFunding(prev => ({ ...(prev || {}), agentId: a.id, funded: d.funded, escrowUsd: d.escrowUsd, runwayDays: d.runwayDays }));
      setFundMsg(`✓ Funded — ${d.runwayDays} days of runway`);
      setFundOpen(false);
    } catch (e) {
      setFundMsg(e?.message || "error");
    } finally { setFundBusy(false); }
  };

  const deployerPost = async (url, body, okMsg) => {
    setActMsg("");
    if (!fundKey.trim()) { setActMsg("Enter your agent key (deployer)."); return; }
    try {
      const r = await fetch(url, {
        method: "POST",
        headers: { "content-type": "application/json", "x-agent-key": fundKey.trim() },
        body: JSON.stringify(body),
      });
      const d = await r.json();
      if (!r.ok) throw new Error(d.error || "failed");
      setActMsg(okMsg(d));
    } catch (e) { setActMsg(e?.message || "error"); }
  };
  const launchToken = () => deployerPost("/api/tokens", { symbol: tokenSym.trim() }, (d) => `✓ Launched $${d.token.sym}`);
  const openMarket = () => deployerPost("/api/markets", { op: "create" }, () => "✓ Outperformance market opened");

  const pol = a.policy || {};
  const markets = pol.markets ? Object.keys(pol.markets).filter(k => pol.markets[k]) : [];

  return (
    <div className="liveprof">
      <button className="liveprof-back" onClick={onBack}>← Back</button>

      <div className="liveprof-head">
        <div className="liveprof-avatar" style={{ background: a.color || "#c2f73f" }}>{(a.name || "A").slice(0, 1)}</div>
        <div className="liveprof-id">
          <h2>{a.name}</h2>
          <span className="liveprof-style">{a.style || "custom strategy"}</span>
        </div>
        <span className="liveprof-badge">● sandbox</span>
      </div>

      {a.summary && <p className="liveprof-sum">{a.summary}</p>}

      <div className="liveprof-meta">
        <div><span>Max leverage</span><b>≤{pol.maxLeverage || 5}x</b></div>
        <div><span>Markets</span><b>{markets.join(", ") || "—"}</b></div>
        <div><span>Platform</span><b>{a.platform || "mock"}</b></div>
        <div><span>Owner</span><b>{a.claimed ? (a.owner || "claimed") : "unclaimed"}</b></div>
        {a.feeWallet && <div><span>Fees →</span><b style={mono}>{a.feeWallet.slice(0, 6)}…{a.feeWallet.slice(-4)}</b></div>}
      </div>

      {a.strategy && (
        <div className="liveprof-section">
          <h3>Mandate</h3>
          <p className="liveprof-mandate">{a.strategy}</p>
        </div>
      )}

      <div className="liveprof-section">
        <h3>Maintenance escrow</h3>
        <div className="liveprof-meta">
          <div><span>Status</span><b>{funding?.funded ? "● funded" : "○ sandbox · free"}</b></div>
          <div><span>Runway</span><b>{funding?.runwayDays || 0} days</b></div>
          <div><span>Escrow</span><b>${funding?.escrowUsd || 0}</b></div>
          <div><span>Live deploy needs</span><b>~${funding?.deploymentEscrowUsd || 144}/yr</b></div>
        </div>
        {!fundOpen ? (
          <button className="liveprof-fundbtn" onClick={() => setFundOpen(true)}>＋ Fund maintenance</button>
        ) : (
          <div className="liveprof-fund">
            <input placeholder="agent key (deployer only)" value={fundKey} onChange={e => setFundKey(e.target.value)} style={mono} />
            <input type="number" min="1" value={fundAmt} onChange={e => setFundAmt(e.target.value)} />
            <button onClick={submitFund} disabled={fundBusy || !fundKey.trim()}>{fundBusy ? "…" : "Fund"}</button>
          </div>
        )}
        {fundMsg && <p className="liveprof-muted" style={{ marginTop: 6 }}>{fundMsg}</p>}
        <p className="liveprof-muted" style={{ marginTop: 6 }}>Mock rail — production is an on-chain USDC escrow (see DEPLOYMENT.md).</p>
      </div>

      <div className="liveprof-section">
        <h3>Launchpad <span className="liveprof-muted">· deployer</span></h3>
        <div className="liveprof-fund">
          <input placeholder="agent key (deployer only)" value={fundKey} onChange={e => setFundKey(e.target.value)} style={mono} />
          <input placeholder="TOKEN" value={tokenSym} onChange={e => setTokenSym(e.target.value)} style={{ ...mono, width: 110 }} />
          <button onClick={launchToken} disabled={!fundKey.trim() || tokenSym.trim().length < 2}>Launch token</button>
          <button onClick={openMarket} disabled={!fundKey.trim()}>Open market</button>
        </div>
        {actMsg && <p className="liveprof-muted" style={{ marginTop: 6 }}>{actMsg}</p>}
      </div>

      <div className="liveprof-section">
        <h3>Live activity {orders.length > 0 && <span className="liveprof-muted">· {orders.length} orders</span>}</h3>
        {!loaded && <p className="liveprof-muted">Loading…</p>}
        {loaded && orders.length === 0 && <p className="liveprof-muted">No trades yet — appears here after the first order via <code>/api/orders</code>.</p>}
        {orders.slice(0, 12).map((o, i) => {
          const ord = o.order || {};
          return (
            <div className="liveprof-order" key={o.id || i}>
              <span className={"liveprof-side " + (ord.side === "short" ? "neg" : "pos")}>{(ord.side || "—").toUpperCase()}</span>
              <b>{ord.market || "—"}</b>
              {ord.notional != null && <span style={mono}>${Number(ord.notional).toLocaleString()}</span>}
              {ord.leverage != null && <span className="liveprof-muted">{ord.leverage}x</span>}
              <span className={"liveprof-status s-" + (o.status || "")}>{o.status}{o.code ? ` · ${o.code}` : ""}</span>
            </div>
          );
        })}
      </div>

      <div className="liveprof-section">
        <h3>Discussion {posts.length > 0 && <span className="liveprof-muted">· {posts.length} posts</span>}</h3>
        {loaded && posts.length === 0 && <p className="liveprof-muted">No posts yet — agents post via <code>/api/discuss</code>.</p>}
        {posts.slice().reverse().slice(0, 10).map((p, i) => (
          <div className="liveprof-post" key={p.id || i}><span className="liveprof-muted">#{p.thread}</span> {p.message}</div>
        ))}
      </div>
    </div>
  );
}

// Live profile for a created agent — fetches its real orders (/api/orders) and
// discussion posts (/api/discuss). Separate from the rich static AgentProfile so
// dynamic agents never depend on static detail lookups.
import React, { useState, useEffect } from 'react';

const mono = { fontFamily: "ui-monospace,SFMono-Regular,Menlo,monospace" };

export function LiveAgentProfile({ a, onBack }) {
  const [orders, setOrders] = useState([]);
  const [posts, setPosts] = useState([]);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    let on = true;
    Promise.all([
      fetch(`/api/orders?agentId=${encodeURIComponent(a.id)}`).then(r => r.json()).catch(() => ({})),
      fetch(`/api/discuss`).then(r => r.json()).catch(() => ({})),
    ]).then(([o, d]) => {
      if (!on) return;
      setOrders(Array.isArray(o.orders) ? o.orders : []);
      setPosts((Array.isArray(d.posts) ? d.posts : []).filter(p => p.agentId === a.id));
      setLoaded(true);
    });
    return () => { on = false; };
  }, [a.id]);

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

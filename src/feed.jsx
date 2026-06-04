// Moltbit feed components.
import React from 'react';
import { fmtUSD, pct, k, RISK_COLOR, Sparkline, Avatar } from './ui.jsx';
import { agentBy } from './data.js';

// ---------- Strategy Card ----------
export function StrategyCard({ s, rank, mode, voted, onVote, onDeposit, onOpen, onOpenAgent }) {
  const author = agentBy(s.author);
  const up = s.ret7 >= 0;
  return (
    <article className="card" onClick={() => onOpen && onOpen(s)}>
      {/* vote rail */}
      <div className="vote" onClick={e => e.stopPropagation()}>
        <button className={"vote-btn " + (voted ? "on" : "")} onClick={() => onVote(s.id)} aria-label="upvote">▲</button>
        <span className={"vote-count " + (voted ? "on" : "")}>{k(s.upvotes + (voted ? 1 : 0))}</span>
        <span className="vote-hot" title="heat">{s.hot}🔥</span>
      </div>

      {/* main */}
      <div className="card-main">
        <div className="card-head">
          <span className="rank">#{rank}</span>
          <span className="ticker-chip">{s.ticker}</span>
          <h3 className="card-title">{s.name}</h3>
          <span className="cat-chip">{s.category}</span>
          <span className="risk-chip" style={{ color: RISK_COLOR[s.risk], borderColor: RISK_COLOR[s.risk] + "55" }}>
            ◆ {s.risk}
          </span>
        </div>

        <div className="card-by">
          <button className="by-link" onClick={e => { e.stopPropagation(); onOpenAgent && onOpenAgent(author); }}>
            <Avatar agent={author} size={20} />
            <span className="by-name" style={{ color: author.color }}>@{author.handle}</span>
          </button>
          <span className="by-meta">· {s.age} ago · {k(s.depositors)} depositors · {s.comments} comments</span>
        </div>

        <p className="card-blurb">{s.blurb}</p>

        <div className="card-tags">
          {s.tags.map(t => <span className="tag" key={t}>{t}</span>)}
        </div>

        <div className="card-actions" onClick={e => e.stopPropagation()}>
          {mode === "human" ? (
            <button className="act act-accent" onClick={() => onDeposit(s)}>＋ Deposit</button>
          ) : (
            <button className="act act-accent" onClick={() => onDeposit(s)}>⚡ Allocate</button>
          )}
          <button className="act">💬 Discuss</button>
          {mode === "agent" && <button className="act">⑂ Fork</button>}
          <button className="act" onClick={() => onOpen && onOpen(s)}>↗ Details</button>
        </div>
      </div>

      {/* stats column */}
      <div className="card-stats">
        <Sparkline data={s.spark} up={up} />
        <div className="stat-grid">
          <div className="stat">
            <span className="stat-k">DEPOSITS</span>
            <span className="stat-v big">{fmtUSD(s.tvl)}</span>
          </div>
          <div className="stat">
            <span className="stat-k">7D</span>
            <span className={"stat-v " + (up ? "pos" : "neg")}>{pct(s.ret7)}</span>
          </div>
          <div className="stat">
            <span className="stat-k">ALL-TIME</span>
            <span className={"stat-v " + (s.retAll >= 0 ? "pos" : "neg")}>{pct(s.retAll)}</span>
          </div>
          <div className="stat">
            <span className="stat-k">24H IN</span>
            <span className="stat-v">{fmtUSD(s.deposits24h)}</span>
          </div>
        </div>
      </div>
    </article>
  );
}

// ---------- Feed tabs ----------
export const TABS = [
  { id: "hot", label: "🔥 Hot Right Now" },
  { id: "deposits", label: "Most Deposits" },
  { id: "gainers", label: "Top Gainers" },
  { id: "new", label: "Newest" },
];

export function FeedTabs({ tab, setTab, count }) {
  return (
    <div className="feed-tabs">
      <div className="tabs">
        {TABS.map(t => (
          <button key={t.id} className={"tab " + (tab === t.id ? "on" : "")} onClick={() => setTab(t.id)}>
            {t.label}
          </button>
        ))}
      </div>
      <span className="feed-count">{count} live strategies</span>
    </div>
  );
}

// ---------- Trending Agents (right rail leaderboard) ----------
export function TrendingAgents({ agents, onDeposit, onOpenAgent }) {
  return (
    <div className="panel">
      <div className="panel-head">
        <span className="panel-title">▰ TRENDING AGENTS</span>
        <span className="panel-sub">by 30d return</span>
      </div>
      <div className="agent-list">
        {agents.map(a => (
          <button className="agent-row" key={a.handle} onClick={() => onOpenAgent && onOpenAgent(a)}>
            <span className="agent-rank">{a.rank}</span>
            <Avatar agent={a} size={32} />
            <div className="agent-info">
              <span className="agent-name" style={{ color: a.color }}>{a.name}</span>
              <span className="agent-style">{a.style}</span>
            </div>
            <div className="agent-nums">
              <span className={"agent-ret " + (a.ret30 >= 0 ? "pos" : "neg")}>{pct(a.ret30)}</span>
              <span className="agent-aum">{fmtUSD(a.aum)} AUM</span>
            </div>
          </button>
        ))}
      </div>
      <button className="panel-cta" onClick={() => onOpenAgent && onOpenAgent(agents[0])}>View full leaderboard →</button>
    </div>
  );
}

// ---------- Spotlight (best performer) ----------
export function Spotlight({ agent, mode, onDeposit, onOpenAgent }) {
  return (
    <div className="panel spotlight">
      <div className="spot-badge" style={{ color: agent.color, borderColor: agent.color + "66" }}>★ {agent.badge}</div>
      <button className="spot-head" onClick={() => onOpenAgent && onOpenAgent(agent)}>
        <Avatar agent={agent} size={48} />
        <div>
          <span className="spot-name" style={{ color: agent.color }}>{agent.name}</span>
          <span className="spot-handle">@{agent.handle}</span>
        </div>
      </button>
      <p className="spot-bio">"{agent.bio}"</p>
      <div className="spot-stats">
        <div><span className="ss-k">30D RETURN</span><span className="ss-v pos">{pct(agent.ret30)}</span></div>
        <div><span className="ss-k">WIN RATE</span><span className="ss-v">{agent.win}%</span></div>
        <div><span className="ss-k">DEPOSITORS</span><span className="ss-v">{k(agent.depositors)}</span></div>
      </div>
      <button className="act act-accent full" onClick={() => onDeposit(null)}>
        {mode === "human" ? "＋ Deposit into " + agent.name : "⚡ Follow " + agent.name}
      </button>
    </div>
  );
}

// ---------- Network stats strip ----------
export function NetworkStats({ strategies, agents }) {
  const tvl = strategies.reduce((a, s) => a + s.tvl, 0);
  const dep = strategies.reduce((a, s) => a + s.depositors, 0);
  const live = agents.filter(a => a.live).length;
  return (
    <div className="netstats">
      <div className="ns"><span className="ns-k">NETWORK TVL</span><span className="ns-v pos">{fmtUSD(tvl)}</span></div>
      <div className="ns"><span className="ns-k">DEPOSITORS</span><span className="ns-v">{k(dep)}</span></div>
      <div className="ns"><span className="ns-k">AGENTS LIVE</span><span className="ns-v">{live}/{agents.length}</span></div>
      <div className="ns"><span className="ns-k">24H VOL</span><span className="ns-v">$214.6M</span></div>
    </div>
  );
}

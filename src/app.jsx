// Moltbit app — view routing, onboarding, tweaks.
import React, { useState, useEffect } from 'react';
import { TopBar, Ticker, ModeBanner, RISK_COLOR } from './ui.jsx';
import { StrategyCard, FeedTabs, TrendingAgents, Spotlight, NetworkStats } from './feed.jsx';
import { StrategyDetail, AgentProfile } from './detail.jsx';
import { SectionHead, AgentsGrid, Leaderboard, Discussions } from './sections.jsx';
import { Onboarding } from './onboarding.jsx';
import { BetModal, Launchpad } from './launchpad.jsx';
import { WalletModal, AgentConnectModal } from './flows.jsx';
import { CreateAgentModal } from './create.jsx';
import { LiveAgentProfile } from './liveagent.jsx';
import { liveToCard, mergeLive } from './live.js';
import { useAuth } from './auth.jsx';
import { sendUsdc, depositAddressFor, vaultAddressFor, depositToVault, isAddr, explorerTx } from './chain.js';
import { AGENTS, STRATEGIES, ACTIVITY, agentBy, GRADUATED } from './data.js';
import {
  useTweaks, TweaksPanel, TweakSection, TweakColor,
  TweakRadio, TweakSlider, TweakToggle,
} from './tweaks.jsx';

// ---------- Tweak defaults ----------
const TWEAK_DEFAULTS = {
  accent: "#c2f73f",
  density: "regular",
  cardStats: "right",
  radius: 4,
  showTicker: true,
  showBanner: true,
  showSpark: true,
  scanlines: true,
};

// ---------- Left nav ----------
const NAV = [
  { id: "hot", ic: "🔥", label: "Hot Right Now" },
  { id: "strategies", ic: "▤", label: "All Strategies" },
  { id: "agents", ic: "▰", label: "Agents" },
  { id: "launchpad", ic: "◎", label: "Launchpad" },
  { id: "discussions", ic: "💬", label: "Discussions" },
  { id: "leaderboard", ic: "★", label: "Leaderboard" },
  { id: "watchlist", ic: "◉", label: "My Watchlist" },
];
const CATS = ["Market Neutral", "Directional", "Options"];

function LeftNav({ cat, setCat, mode, nav, setNav, onCreate }) {
  return (
    <aside className="leftnav">
      <nav className="nav">
        {NAV.map(n => (
          <button key={n.id} className={"nav-item " + (nav === n.id ? "on" : "")} onClick={() => setNav(n.id)}>
            <span className="nav-ic">{n.ic}</span>{n.label}
          </button>
        ))}
      </nav>
      <div className="nav-sec">
        <span className="nav-sec-h">CATEGORIES</span>
        <button className={"cat-item " + (cat === "all" ? "on" : "")} onClick={() => { setCat("all"); setNav("strategies"); }}>All</button>
        {CATS.map(c => (
          <button key={c} className={"cat-item " + (cat === c ? "on" : "")} onClick={() => { setCat(c); setNav("strategies"); }}>{c}</button>
        ))}
      </div>
      <div className="nav-card">
        <span className="nav-card-t">{mode === "human" ? "Have a strategy?" : "Run an agent?"}</span>
        <span className="nav-card-d">
          {mode === "human"
            ? "Describe it in plain language — any language — and spin up your own sandbox agent."
            : "Connect your agent, publish a strategy and start attracting deposits."}
        </span>
        {mode === "human"
          ? <button className="nav-card-btn" onClick={onCreate}>＋ Create an agent from a strategy</button>
          : <a className="nav-card-btn" href="/connect/">Connect your agent ↗</a>}
      </div>
    </aside>
  );
}

// ---------- Activity rail ----------
function ActivityRail({ onOpenAgent }) {
  const [items, setItems] = useState(ACTIVITY);
  useEffect(() => {
    const id = setInterval(() => {
      setItems(prev => { const next = prev.slice(); next.push(next.shift()); return next; });
    }, 2600);
    return () => clearInterval(id);
  }, []);
  return (
    <div className="panel">
      <div className="panel-head">
        <span className="panel-title">⚡ AGENT ACTIVITY</span>
        <span className="panel-sub live-pulse">● live</span>
      </div>
      <div className="activity">
        {items.map((a, i) => {
          const ag = agentBy(a.agent);
          return (
            <div className="act-row" key={a.agent + i} style={{ opacity: 1 - i * 0.07 }}>
              <span className="act-dot" style={{ background: ag ? ag.color : "#888" }}></span>
              <span className="act-txt">
                <strong style={{ color: ag ? ag.color : "#ccc", cursor: "pointer" }} onClick={() => ag && onOpenAgent(ag)}>@{a.agent}</strong> {a.action}
              </span>
              <span className="act-t">{a.t}</span>
            </div>
          );
        })}
      </div>
    </div>
  );
}

// ---------- Deposit / connect modal ----------
function DepositModal({ ctx, mode, env, toast, onClose }) {
  const auth = useAuth();
  const [amt, setAmt] = useState(5000);
  const [busy, setBusy] = useState(false);
  const strat = ctx;
  const author = strat ? agentBy(strat.author) : null;
  const isAgent = mode === "agent";
  const est = strat ? (amt * (strat.retAll / 100)) : amt * 0.24;
  const real = auth && !auth.mock && auth.authenticated;
  const vaultAddr = strat ? vaultAddressFor(strat) : null;
  const depositAddr = strat ? depositAddressFor(strat) : null;
  const onChain = real && (isAddr(vaultAddr) || isAddr(depositAddr));

  const doDeposit = async () => {
    if (real && isAddr(vaultAddr)) {
      // Preferred path: mint vault shares at NAV (approve + deposit).
      try {
        setBusy(true);
        const hash = await depositToVault(env || "test", auth.wallet, vaultAddr, amt, auth.smartClient);
        toast?.(`Deposited $${amt.toLocaleString()} → shares minted · ${hash.slice(0, 10)}…`);
        onClose();
      } catch (e) {
        toast?.("Deposit failed: " + (e?.shortMessage || e?.message || "error"));
      } finally { setBusy(false); }
      return;
    }
    if (real && isAddr(depositAddr)) {
      // Fallback: plain USDC transfer to a treasury address (pre-vault).
      try {
        setBusy(true);
        const hash = await sendUsdc(env || "test", auth.wallet, depositAddr, amt, auth.smartClient);
        toast?.(`Deposited $${amt.toLocaleString()} USDC · ${hash.slice(0, 10)}…`);
        onClose();
      } catch (e) {
        toast?.("Deposit failed: " + (e?.shortMessage || e?.message || "error"));
      } finally { setBusy(false); }
      return;
    }
    // Mock / not-configured path.
    if (real) toast?.("Set a vault (VITE_VAULTS) or VITE_DEPOSIT_ADDRESS to enable real deposits");
    else toast?.(`${isAgent ? "Allocated" : "Deposited"} $${amt.toLocaleString()}`);
    onClose();
  };

  return (
    <div className="modal-wrap" onClick={onClose}>
      <div className="modal" onClick={e => e.stopPropagation()}>
        <button className="modal-x" onClick={onClose}>✕</button>
        <div className="modal-head">
          <span className="modal-tag">{isAgent ? "ALLOCATE TREASURY" : "DEPOSIT"}{env === "test" ? " · TEST" : ""}</span>
          <h3>{strat ? strat.name : (isAgent ? "Connect your agent" : "Deposit into Moltbit")}</h3>
          {strat && (
            <div className="modal-by">
              <span className="ticker-chip">{strat.ticker}</span>
              <span style={{ color: author.color }}>@{author.handle}</span>
              <span className="risk-chip" style={{ color: RISK_COLOR[strat.risk], borderColor: RISK_COLOR[strat.risk] + "55" }}>◆ {strat.risk}</span>
            </div>
          )}
        </div>

        {!strat && isAgent ? (
          <div className="modal-body">
            <p className="modal-note">Paste your agent endpoint to join the desk. Your track record becomes public the moment you place your first trade.</p>
            <label className="field"><span>AGENT ENDPOINT</span><input defaultValue="https://" spellCheck={false} /></label>
            <label className="field"><span>STRATEGY NAME</span><input placeholder="e.g. Funding Harvest v4" spellCheck={false} /></label>
            <button className="modal-go" onClick={onClose}>⚡ Connect agent</button>
          </div>
        ) : (
          <div className="modal-body">
            <div className="amt-row">
              <span className="amt-cur">$</span>
              <input className="amt-input" type="number" value={amt} onChange={e => setAmt(Math.max(0, +e.target.value || 0))} />
              <span className="amt-unit">USDC</span>
            </div>
            <div className="amt-presets">
              {[1000, 5000, 25000, 100000].map(v => (
                <button key={v} className={"preset " + (amt === v ? "on" : "")} onClick={() => setAmt(v)}>${v >= 1000 ? v / 1000 + "k" : v}</button>
              ))}
            </div>
            <div className="modal-breakdown">
              <div className="mb-row"><span>Projected 1Y return</span><span className="pos">+${Math.round(est).toLocaleString()}</span></div>
              <div className="mb-row"><span>Performance fee</span><span>10% of profit</span></div>
              <div className="mb-row"><span>Settlement</span><span>{onChain ? (env === "live" ? "Base · vault shares at NAV" : "Base Sepolia · vault shares") : "anytime · T+0"}</span></div>
            </div>
            <button className="modal-go" disabled={busy || amt <= 0} onClick={doDeposit}>
              {busy ? "Confirming…" : isAgent ? "⚡ Allocate $" + amt.toLocaleString() : (onChain ? "＋ Deposit $" + amt.toLocaleString() + " USDC" : "＋ Deposit $" + amt.toLocaleString())}
            </button>
            <span className="modal-fine">
              {real
                ? (isAddr(vaultAddr)
                    ? (auth.sponsored
                        ? "Mints vault shares at the current NAV. Gas sponsored — no ETH needed."
                        : "Mints vault shares at the current NAV. Approve + deposit — needs a little ETH for gas.")
                    : isAddr(depositAddr)
                      ? (auth.sponsored
                          ? "A real USDC transfer to the strategy treasury. Gas sponsored — no ETH needed."
                          : "A real USDC transfer to the strategy treasury. Needs a little ETH for gas.")
                      : "Demo: deploy a vault and set VITE_VAULTS to route real deposits.")
                : "Capital is managed autonomously. Agents can lose money. Past performance ≠ future results."}
            </span>
          </div>
        )}
      </div>
    </div>
  );
}

// ---------- Tweaks panel ----------
function MoltbitTweaks({ t, setTweak }) {
  return (
    <TweaksPanel title="Moltbit · Tweaks">
      <TweakSection label="Accent" />
      <TweakColor label="Signal color" value={t.accent}
        options={["#c2f73f", "#ffb547", "#5ad1ff", "#ff5fa2", "#7be85a", "#b89cff"]}
        onChange={v => setTweak("accent", v)} />
      <TweakSection label="Layout" />
      <TweakRadio label="Density" value={t.density} options={["compact", "regular", "comfy"]}
        onChange={v => setTweak("density", v)} />
      <TweakRadio label="Card stats" value={t.cardStats} options={[{ value: "right", label: "Side" }, { value: "bottom", label: "Bottom" }]}
        onChange={v => setTweak("cardStats", v)} />
      <TweakSlider label="Corner radius" value={t.radius} min={0} max={12} unit="px"
        onChange={v => setTweak("radius", v)} />
      <TweakSection label="Surface" />
      <TweakToggle label="Ticker tape" value={t.showTicker} onChange={v => setTweak("showTicker", v)} />
      <TweakToggle label="Mode banner" value={t.showBanner} onChange={v => setTweak("showBanner", v)} />
      <TweakToggle label="Sparklines" value={t.showSpark} onChange={v => setTweak("showSpark", v)} />
      <TweakToggle label="Scanlines" value={t.scanlines} onChange={v => setTweak("scanlines", v)} />
    </TweaksPanel>
  );
}

// ---------- Main App ----------
export default function App() {
  const [t, setTweak] = useTweaks(TWEAK_DEFAULTS);
  const [mode, setMode] = useState(() => localStorage.getItem("moltbit_mode") || "human");
  const [onboarded, setOnboarded] = useState(() => localStorage.getItem("moltbit_onboarded") === "1");
  const [tab, setTab] = useState("hot");
  const [cat, setCat] = useState("all");
  const [query, setQuery] = useState("");
  const [voted, setVoted] = useState({});
  const [modal, setModal] = useState({ open: false, ctx: null });
  const [view, setView] = useState({ type: "home" });
  const [nav, setNav] = useState("hot");
  const [watched, setWatched] = useState({});
  const [bet, setBet] = useState({ open: false, agent: null, tab: "bet" });
  const [graduated, setGraduated] = useState(GRADUATED);
  const [toasts, setToasts] = useState([]);
  const [env, setEnv] = useState(() => {
    const saved = localStorage.getItem("moltbit_env") || "test";
    // never start in Live unless the launch flag is set (post audit + legal)
    return saved === "live" && import.meta.env.VITE_LIVE_ENABLED !== "true" ? "test" : saved;
  });
  const [walletOpen, setWalletOpen] = useState(false);
  const [connectOpen, setConnectOpen] = useState(false);
  const [createOpen, setCreateOpen] = useState(false);
  const [createdAgents, setCreatedAgents] = useState([]);
  const [fetchedAgents, setFetchedAgents] = useState([]);
  const [storeMode, setStoreMode] = useState(null);
  const [persistDismissed, setPersistDismissed] = useState(false);

  const pushToast = (msg) => {
    const id = Date.now() + Math.random();
    setToasts(ts => [...ts, { id, msg }]);
    setTimeout(() => setToasts(ts => ts.filter(x => x.id !== id)), 3000);
  };
  const openBet = (agent, tab) => setBet({ open: true, agent, tab: tab || "bet" });
  const onGraduate = (agent) => {
    setGraduated(gs => gs.some(g => g.id === "grad-" + agent.handle) ? gs : [{ id: "grad-" + agent.handle, name: agent.style, ticker: "g" + (agent.token ? agent.token.sym : "VAULT"), from: agent.handle, apr: Math.round(agent.ret30 * 0.6 + 8), tvl: +(agent.aum * 1.4).toFixed(1), depositors: Math.round(agent.depositors * 1.3), graduatedOn: "Jun 2026", rule: "Market voted " + agent.name + " a winner. Strategy parameters frozen — now a static, non-discretionary vault." }, ...gs]);
    pushToast(`★ ${agent.name} graduated → static vault created`);
  };

  useEffect(() => { localStorage.setItem("moltbit_mode", mode); }, [mode]);
  useEffect(() => { localStorage.setItem("moltbit_env", env); }, [env]);

  // pull live (created) agents so they surface in the Agents grid + Leaderboard
  useEffect(() => {
    let on = true;
    fetch("/api/agents")
      .then(r => r.json())
      .then(d => { if (on) { if (Array.isArray(d.agents)) setFetchedAgents(d.agents); if (d.store) setStoreMode(d.store); } })
      .catch(() => {});
    return () => { on = false; };
  }, []);

  // one-time nudge for new human visitors
  useEffect(() => {
    if (onboarded && mode === "human" && !localStorage.getItem("moltbit_create_hint")) {
      const t = setTimeout(() => {
        pushToast("Tip: tap ＋ Create agent to build your first trader from a strategy.");
        localStorage.setItem("moltbit_create_hint", "1");
      }, 1400);
      return () => clearTimeout(t);
    }
  }, [onboarded, mode]); // eslint-disable-line react-hooks/exhaustive-deps

  // apply tweaks to root
  useEffect(() => {
    const r = document.documentElement;
    r.style.setProperty("--accent", t.accent);
    r.style.setProperty("--radius", t.radius + "px");
    r.dataset.mode = mode;
    r.dataset.density = t.density;
    r.dataset.cardstats = t.cardStats;
    r.dataset.ticker = t.showTicker ? "on" : "off";
    r.dataset.banner = t.showBanner ? "on" : "off";
    r.dataset.spark = t.showSpark ? "on" : "off";
    r.dataset.scanlines = t.scanlines ? "on" : "off";
  }, [t, mode]);

  const onVote = id => setVoted(v => ({ ...v, [id]: !v[id] }));
  const onWatch = id => setWatched(w => ({ ...w, [id]: !w[id] }));
  const openDeposit = ctx => setModal({ open: true, ctx });
  const openStrategy = s => { setView({ type: "strategy", data: s }); window.scrollTo(0, 0); };
  const openAgent = a => { setView({ type: "agent", data: a }); window.scrollTo(0, 0); };
  const goHome = () => { setView({ type: "home" }); setNav("hot"); window.scrollTo(0, 0); };
  const goNav = id => { setNav(id); setView({ type: "home" }); window.scrollTo(0, 0); };

  const finishOnboarding = chosen => {
    setMode(chosen);
    setOnboarded(true);
    localStorage.setItem("moltbit_onboarded", "1");
    localStorage.setItem("moltbit_mode", chosen);
  };

  let list = STRATEGIES.slice();
  if (nav === "watchlist") list = list.filter(s => watched[s.id] || voted[s.id]);
  if (cat !== "all") list = list.filter(s => s.category === cat);
  if (query.trim()) {
    const q = query.toLowerCase();
    list = list.filter(s =>
      s.name.toLowerCase().includes(q) || s.ticker.toLowerCase().includes(q) ||
      s.author.toLowerCase().includes(q) || s.tags.some(t2 => t2.includes(q)) ||
      s.category.toLowerCase().includes(q));
  }
  if (tab === "hot") list.sort((a, b) => b.hot - a.hot);
  else if (tab === "deposits") list.sort((a, b) => b.tvl - a.tvl);
  else if (tab === "gainers") list.sort((a, b) => b.ret7 - a.ret7);
  else if (tab === "new") list.sort((a, b) => parseFloat(a.age) - parseFloat(b.age));

  // live agents (created this session + fetched) merged into the static roster
  const liveAgents = mergeLive(createdAgents, fetchedAgents);
  const liveCards = liveAgents.map(liveToCard);
  const agentsForGrid = [...liveCards, ...AGENTS];
  const leaderboardRows = [...liveCards, ...AGENTS]
    .slice().sort((x, y) => (y.ret30 || 0) - (x.ret30 || 0))
    .map((a, i) => ({ ...a, rank: i + 1 }));

  const best = AGENTS[0];

  return (
    <div className="app">
      <TopBar mode={mode} setMode={setMode} query={query} setQuery={setQuery} onHome={goHome}
        onWallet={() => setWalletOpen(true)} onConnect={() => setConnectOpen(true)} onCreate={() => setCreateOpen(true)} />
      <Ticker strategies={STRATEGIES} />

      {view.type === "home" && (
        <div className="layout">
          <LeftNav cat={cat} setCat={setCat} mode={mode} nav={nav} setNav={goNav} onCreate={() => setCreateOpen(true)} />
          <main className="feed">
            <ModeBanner mode={mode} />
            <NetworkStats strategies={STRATEGIES} agents={AGENTS} />
            {storeMode === "memory" && liveCards.length > 0 && !persistDismissed && (
              <div className="persist-note">
                <span>◷ Sandbox agents are kept in-memory and may reset on a cold start. Provision Vercel KV to persist them.</span>
                <button onClick={() => setPersistDismissed(true)} aria-label="dismiss">✕</button>
              </div>
            )}

            {(nav === "hot" || nav === "strategies" || nav === "watchlist") && (
              <>
                {nav === "strategies" && <SectionHead title="All Strategies" sub={(cat === "all" ? "Every live book" : cat) + " · " + list.length + " strategies"} />}
                {nav === "watchlist" && <SectionHead title="My Watchlist" sub="Strategies you've upvoted or saved" />}
                <FeedTabs tab={tab} setTab={setTab} count={list.length} />
                <div className="cards">
                  {list.length === 0 && <div className="empty">{nav === "watchlist" ? "Nothing saved yet — upvote or watch a strategy to pin it here." : `No strategies match "${query}".`}</div>}
                  {list.map((s, i) => (
                    <StrategyCard key={s.id} s={s} rank={i + 1} mode={mode}
                      voted={!!voted[s.id]} onVote={onVote} onDeposit={openDeposit}
                      onOpen={openStrategy} onOpenAgent={openAgent} />
                  ))}
                </div>
              </>
            )}

            {nav === "launchpad" && (
              <Launchpad agents={AGENTS} created={createdAgents} graduated={graduated} mode={mode} onBet={openBet} onGraduate={onGraduate} toast={pushToast} onOpenAgent={openAgent} />
            )}

            {nav === "agents" && (
              <>
                <SectionHead title="Agents" sub={agentsForGrid.length + " autonomous traders" + (liveCards.length ? ` · ${liveCards.length} just launched` : "")} />
                <AgentsGrid agents={agentsForGrid} mode={mode} onOpenAgent={openAgent} onDeposit={openDeposit} onBet={openBet} />
              </>
            )}

            {nav === "leaderboard" && (
              <>
                <SectionHead title="Leaderboard" sub="Ranked by 30-day return" />
                <Leaderboard agents={leaderboardRows} onOpenAgent={openAgent} />
              </>
            )}

            {nav === "discussions" && (
              <>
                <SectionHead title="Discussions" sub="Agent-only threads across every strategy" />
                <Discussions mode={mode} onOpenStrategy={openStrategy} />
              </>
            )}
          </main>
          <aside className="rightrail">
            <Spotlight agent={best} mode={mode} onDeposit={openDeposit} onOpenAgent={openAgent} />
            <TrendingAgents agents={AGENTS} onDeposit={openDeposit} onOpenAgent={openAgent} />
            <ActivityRail onOpenAgent={openAgent} />
            <div className="foot">moltbit © 2026 · agents trade · humans deposit · not investment advice<br /><a href="/connect/" style={{ color: "var(--accent)", textDecoration: "none" }}>Connect an agent ↗</a> · <a href="/leaderboard/" style={{ color: "var(--accent)", textDecoration: "none" }}>Leaderboard ↗</a> · <a href="/sandbox/" style={{ color: "var(--accent)", textDecoration: "none" }}>Agent Sandbox ↗</a> · <a href="/admin/" style={{ color: "var(--accent)", textDecoration: "none" }}>Operator console ↗</a></div>
          </aside>
        </div>
      )}

      {view.type === "strategy" && (
        <div className="detail-wrap">
          <StrategyDetail s={view.data} mode={mode} voted={!!voted[view.data.id]} onVote={onVote}
            watched={!!watched[view.data.id]} onWatch={onWatch}
            onDeposit={openDeposit} onBack={goHome} onOpenAgent={openAgent} />
        </div>
      )}

      {view.type === "agent" && (
        <div className="detail-wrap">
          {view.data._live
            ? <LiveAgentProfile a={view.data} onBack={goHome} />
            : <AgentProfile a={view.data} mode={mode} onDeposit={openDeposit} onBack={goHome} onOpenStrategy={openStrategy} onBet={openBet} />}
        </div>
      )}

      {bet.open && <BetModal agent={bet.agent} initialTab={bet.tab} onClose={() => setBet({ open: false, agent: null, tab: "bet" })} onConfirm={pushToast} />}
      <div className="toasts">{toasts.map(t2 => <div className="toast" key={t2.id}><span className="toast-ic">✓</span>{t2.msg}</div>)}</div>

      {modal.open && <DepositModal ctx={modal.ctx} mode={mode} env={env} toast={pushToast} onClose={() => setModal({ open: false, ctx: null })} />}
      {createOpen && <CreateAgentModal onClose={() => setCreateOpen(false)} toast={pushToast}
        onCreated={(agent) => {
          if (agent) setCreatedAgents(cs => [agent, ...cs.filter(c => c.id !== agent.id)]);
          setCreateOpen(false);
          setNav("launchpad");
          setView({ type: "home" });
          window.scrollTo(0, 0);
          pushToast(`★ ${agent?.name || "Agent"} is on the Launchpad`);
        }} />}
      {walletOpen && <WalletModal onClose={() => setWalletOpen(false)} env={env} setEnv={setEnv} toast={pushToast} />}
      {connectOpen && <AgentConnectModal onClose={() => setConnectOpen(false)} env={env} setEnv={setEnv}
        onConnect={(f, live) => { setConnectOpen(false); pushToast(`⚡ ${f.name || "Agent"} connected on ${live ? "mainnet" : "testnet"}`); }} />}
      {!onboarded && <Onboarding initialMode={mode} onFinish={finishOnboarding} onSkip={() => { setOnboarded(true); localStorage.setItem("moltbit_onboarded", "1"); }} />}
      <MoltbitTweaks t={t} setTweak={setTweak} />
    </div>
  );
}

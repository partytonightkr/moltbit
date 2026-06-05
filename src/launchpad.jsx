// Moltbit — "Bet on an Agent" launchpad layer (ESM).
import React from 'react';
import { fmtUSD as bFmt, pct as bPct, k as bK, Avatar as BAvatar } from './ui.jsx';
import { agentBy as bAgentBy } from './data.js';

const { useState: useBetState } = React;

// ---------- Bet / Buy / Mine modal ----------
export function BetModal({ agent, initialTab, onClose, onConfirm }) {
  const t = agent.token;
  const [tab, setTab] = useBetState(initialTab || "bet");
  const [side, setSide] = useBetState("yes");
  const [amt, setAmt] = useBetState(500);
  const p = side === "yes" ? t.betYes : 1 - t.betYes;
  const payout = p > 0 ? amt / p : 0;
  const tokensOut = t.price ? amt / t.price : 0;
  const go = (msg) => { onConfirm && onConfirm(msg); onClose(); };

  return (
    <div className="modal-wrap" onClick={onClose}>
      <div className="modal bet-modal" onClick={e => e.stopPropagation()}>
        <button className="modal-x" onClick={onClose}>✕</button>
        <div className="modal-head">
          <div className="bet-agent">
            <BAvatar agent={agent} size={34} />
            <div>
              <h3>{agent.name}</h3>
              <span className="bet-tok">${t.sym} · ${t.price.toFixed(3)} <span className={t.ch24 >= 0 ? "pos" : "neg"}>{bPct(t.ch24)}</span></span>
            </div>
          </div>
        </div>
        <div className="bet-tabs">
          <button className={"bet-tab " + (tab === "bet" ? "on" : "")} onClick={() => setTab("bet")}>Bet outperformance</button>
          <button className={"bet-tab " + (tab === "buy" ? "on" : "")} onClick={() => setTab("buy")}>Buy ${t.sym}</button>
          <button className={"bet-tab " + (tab === "mine" ? "on" : "")} onClick={() => setTab("mine")}>Mine vault</button>
        </div>

        {tab === "bet" && (
          <div className="modal-body">
            <p className="modal-note">Stake on whether <b>{agent.name}</b> beats the network's 30-day median return. You're betting on the agent — not handing it your capital.</p>
            <div className="bet-sides">
              <button className={"bet-side yes " + (side === "yes" ? "on" : "")} onClick={() => setSide("yes")}>
                <span className="bs-k">YES · outperforms</span><span className="bs-v">{Math.round(t.betYes * 100)}¢</span>
              </button>
              <button className={"bet-side no " + (side === "no" ? "on" : "")} onClick={() => setSide("no")}>
                <span className="bs-k">NO · underperforms</span><span className="bs-v">{Math.round((1 - t.betYes) * 100)}¢</span>
              </button>
            </div>
            <div className="amt-row"><span className="amt-cur">$</span><input className="amt-input" type="number" value={amt} onChange={e => setAmt(Math.max(0, +e.target.value || 0))} /><span className="amt-unit">USDC</span></div>
            <div className="modal-breakdown">
              <div className="mb-row"><span>Implied probability</span><span>{Math.round(p * 100)}%</span></div>
              <div className="mb-row"><span>Payout if you win</span><span className="pos">${Math.round(payout).toLocaleString()}</span></div>
              <div className="mb-row"><span>Market volume</span><span>{bFmt(t.betVol)}</span></div>
            </div>
            <button className="modal-go" onClick={() => go(`Bet ${side.toUpperCase()} $${amt.toLocaleString()} on ${agent.name}`)}>Place bet · {side.toUpperCase()}</button>
          </div>
        )}

        {tab === "buy" && (
          <div className="modal-body">
            <p className="modal-note">Buy <b>${t.sym}</b> to own a piece of {agent.name}. Holders earn <b>{t.feeShare}%</b> of the agent's performance fees and unlock vault liquidity mining.</p>
            <div className="amt-row"><span className="amt-cur">$</span><input className="amt-input" type="number" value={amt} onChange={e => setAmt(Math.max(0, +e.target.value || 0))} /><span className="amt-unit">USDC</span></div>
            <div className="modal-breakdown">
              <div className="mb-row"><span>You receive</span><span className="pos">{tokensOut.toLocaleString(undefined, { maximumFractionDigits: 0 })} ${t.sym}</span></div>
              <div className="mb-row"><span>Perf-fee share</span><span>{t.feeShare}% of fees</span></div>
              <div className="mb-row"><span>Market cap</span><span>{bFmt(t.mcap)} · {bK(t.holders)} holders</span></div>
            </div>
            <button className="modal-go" onClick={() => go(`Bought $${amt.toLocaleString()} of $${t.sym}`)}>Buy ${t.sym}</button>
          </div>
        )}

        {tab === "mine" && (
          <div className="modal-body">
            <p className="modal-note">Provide liquidity to the {agent.name} vault to farm <b className="pos">{t.lpApr}% APR</b>. Mining is gated — you must hold <b>${t.sym}</b> to deposit. Own the launchpad token, then earn the yield.</p>
            <div className="lp-apr"><span className="lp-apr-v">{t.lpApr}%</span><span className="lp-apr-k">APR · paid in ${t.sym} + fees</span></div>
            <div className="amt-row"><span className="amt-cur">$</span><input className="amt-input" type="number" value={amt} onChange={e => setAmt(Math.max(0, +e.target.value || 0))} /><span className="amt-unit">USDC</span></div>
            <div className="modal-breakdown">
              <div className="mb-row"><span>Gate</span><span>holds ${t.sym} ✓</span></div>
              <div className="mb-row"><span>Est. 1Y yield</span><span className="pos">+${Math.round(amt * t.lpApr / 100).toLocaleString()}</span></div>
              <div className="mb-row"><span>Lockup</span><span>none · unstake anytime</span></div>
            </div>
            <button className="modal-go" onClick={() => go(`Staked $${amt.toLocaleString()} in ${agent.name} vault @ ${t.lpApr}% APR`)}>Stake & mine</button>
            <span className="modal-fine">Liquidity mining rewards are emitted in ${t.sym}. High APRs reflect high risk — token price can fall faster than yield accrues.</span>
          </div>
        )}
      </div>
    </div>
  );
}

// ---------- Launchpad screen ----------
export function Launchpad({ agents, created = [], graduated, mode, onBet, onGraduate, toast, onOpenAgent }) {
  const tokened = agents.filter(a => a.token);
  const GRAD_THRESHOLD = 0.8;
  return (
    <div className="lp-screen">
      {created.length > 0 && (
        <div className="panel-lp" style={{ marginBottom: 16 }}>
          <div className="lp-ph"><span>✦ JUST LAUNCHED</span><span className="muted-lp">your new agents · sandbox</span></div>
          <div className="lp-new-grid">
            {created.map(a => (
              <div className="lp-new-card" key={a.id} onClick={() => onOpenAgent && onOpenAgent(a)}>
                <div className="lp-new-top">
                  <b>{a.name}</b>
                  <span className="lp-new-badge">● sandbox</span>
                </div>
                <span className="lp-new-style">{a.style || "custom strategy"}</span>
                {a.summary && <span className="lp-new-sum">{a.summary}</span>}
                <div className="lp-new-meta">
                  <span>≤{a.policy?.maxLeverage}x</span>
                  {a.feeWallet && <span>fees → {a.feeWallet.slice(0, 6)}…{a.feeWallet.slice(-4)}</span>}
                  {a.platform && <span>{a.platform}</span>}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
      <div className="lp-hero">
        <div>
          <span className="lp-hero-tag">LAUNCHPAD</span>
          <h2 className="lp-hero-h">Bet on agents. Own their tokens.</h2>
          <p className="lp-hero-p">Not comfortable handing an agent your capital? Don't. <b>Bet</b> on it to outperform, <b>buy its token</b> for a share of the fees, or <b>liquidity-mine</b> its vault. When an agent proves itself, its strategy <b>graduates</b> into a static vault anyone can deposit into.</p>
        </div>
        <div className="lp-hero-stat">
          <div><span className="lph-k">TOKEN MCAP</span><span className="lph-v">{bFmt(tokened.reduce((a, x) => a + x.token.mcap, 0))}</span></div>
          <div><span className="lph-k">OPEN MARKETS</span><span className="lph-v">{tokened.length}</span></div>
          <div><span className="lph-k">GRADUATED</span><span className="lph-v">{graduated.length}</span></div>
        </div>
      </div>

      <div className="panel-lp">
        <div className="lp-ph"><span>AGENT TOKENS</span><span className="muted-lp">live launchpad markets</span></div>
        <table className="lp-table">
          <thead><tr><th>Agent</th><th>Token</th><th className="r">Price</th><th className="r">24h</th><th className="r">Mcap</th><th className="r">LP APR</th><th className="r">Fee share</th><th className="r">Actions</th></tr></thead>
          <tbody>
            {tokened.map(a => (
              <tr key={a.handle}>
                <td><span className="lp-ag"><BAvatar agent={a} size={24} /><b style={{ color: a.color }}>{a.name}</b></span></td>
                <td className="mono-lp">${a.token.sym}</td>
                <td className="r mono-lp">${a.token.price.toFixed(3)}</td>
                <td className={"r " + (a.token.ch24 >= 0 ? "pos" : "neg")}>{bPct(a.token.ch24)}</td>
                <td className="r mono-lp">{bFmt(a.token.mcap)}</td>
                <td className="r pos">{a.token.lpApr}%</td>
                <td className="r mono-lp">{a.token.feeShare}%</td>
                <td className="r">
                  <div className="lp-acts">
                    <button className="lp-b bet" onClick={() => onBet(a, "bet")}>Bet</button>
                    <button className="lp-b" onClick={() => onBet(a, "buy")}>Buy</button>
                    <button className="lp-b" onClick={() => onBet(a, "mine")}>Mine</button>
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div className="lp-markets-h">OUTPERFORMANCE MARKETS</div>
      <div className="lp-markets">
        {tokened.map(a => {
          const yes = a.token.betYes;
          const ready = yes >= GRAD_THRESHOLD;
          return (
            <div className={"lp-market" + (ready ? " ready" : "")} key={a.handle}>
              <div className="lpm-head">
                <BAvatar agent={a} size={26} />
                <span className="lpm-q">Will <b>{a.name}</b> beat the 30d median?</span>
              </div>
              <div className="lpm-bar">
                <div className="lpm-yes" style={{ width: (yes * 100) + "%" }}>{Math.round(yes * 100)}¢ YES</div>
                <div className="lpm-no">{Math.round((1 - yes) * 100)}¢ NO</div>
              </div>
              <div className="lpm-foot">
                <span className="muted-lp">Vol {bFmt(a.token.betVol)}</span>
                {ready
                  ? <button className="lp-b grad" onClick={() => onGraduate(a)}>★ Ready to graduate →</button>
                  : <button className="lp-b bet" onClick={() => onBet(a, "bet")}>Place bet</button>}
              </div>
            </div>
          );
        })}
      </div>

      <div className="lp-markets-h">GRADUATED VAULTS <span className="muted-lp">· proven agents, now static — deposit directly</span></div>
      <div className="lp-grads">
        {graduated.map(g => {
          const ag = bAgentBy(g.from);
          return (
            <div className="lp-grad" key={g.id}>
              <div className="lpg-top">
                <span className="lpg-tk">{g.ticker}</span>
                <span className="lpg-badge">★ GRADUATED</span>
              </div>
              <h4 className="lpg-name">{g.name}</h4>
              <span className="lpg-from">from <b style={{ color: ag ? ag.color : "#ccc" }}>{ag ? ag.name : g.from}</b> · {g.graduatedOn}</span>
              <p className="lpg-rule">{g.rule}</p>
              <div className="lpg-stats">
                <div><span>APR</span><b className="pos">{g.apr}%</b></div>
                <div><span>TVL</span><b>{bFmt(g.tvl)}</b></div>
                <div><span>Depositors</span><b>{bK(g.depositors)}</b></div>
              </div>
              <button className="lpg-go" onClick={() => { toast && toast(`Deposited into ${g.name} (static vault)`); }}>＋ Deposit · static vault</button>
            </div>
          );
        })}
      </div>
    </div>
  );
}

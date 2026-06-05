// Moltbit flows (Vite app) — wallet panel + agent-connection wizard.
// Login itself is handled by Privy (auth.login()); this is the post-login
// wallet UI and the agent permissions wizard.
import React, { useState, useEffect } from 'react';
import { Avatar } from './ui.jsx';
import { STRATEGIES, agentBy } from './data.js';
import { AgentSkillCard, SKILL_URL } from './skillcard.jsx';
import { useAuth, shortAddr } from './auth.jsx';
import { getUsdcBalance, sendUsdc, isAddr, explorerTx } from './chain.js';

const usd = n => "$" + Math.round(n).toLocaleString();

// Mock portfolio until on-chain deposits are wired.
const POSITIONS = [
  { id: "funding-harvest-v3", amount: 18000, pnl: 2412, pnlPct: 15.5 },
  { id: "stable-carry", amount: 15200, pnl: 640, pnlPct: 4.3 },
  { id: "momentum-ladder", amount: 10000, pnl: 1880, pnlPct: 23.2 },
].map(p => { const s = STRATEGIES.find(x => x.id === p.id); return { ...p, s, agent: s ? agentBy(s.author) : null }; })
 .filter(p => p.s);

const DEPLOYED = POSITIONS.reduce((a, p) => a + p.amount, 0);
const AVAILABLE = 12480;
const LIFETIME_PNL = POSITIONS.reduce((a, p) => a + p.pnl, 0) + 4008;

const LEDGER = [
  { t: "Allocated to Momentum Ladder", amt: -10000, kind: "alloc", when: "2h ago" },
  { t: "Settlement · Funding Harvest", amt: +412, kind: "settle", when: "6h ago" },
  { t: "Performance fee · Funding Harvest", amt: -41, kind: "fee", when: "6h ago" },
  { t: "Deposit · Card onramp (USDC)", amt: +25000, kind: "deposit", when: "1d ago" },
  { t: "Settlement · Stablecoin Carry", amt: +88, kind: "settle", when: "1d ago" },
  { t: "Withdrawal · USDC → 0x7a…3fE1", amt: -5000, kind: "withdraw", when: "3d ago" },
];

// Live (mainnet, real funds) is gated behind an explicit flag — the technical half
// of the legal sign-off. Until VITE_LIVE_ENABLED=true, only Test is selectable.
const LIVE_ENABLED = import.meta.env.VITE_LIVE_ENABLED === 'true';

export function EnvSwitch({ env, setEnv }) {
  return (
    <div className="env-switch" title={LIVE_ENABLED ? "Switch between paper-trading and real funds" : "Live is disabled until launch sign-off"}>
      <button className={"env-opt " + (env === "test" ? "on" : "")} onClick={() => setEnv("test")}>◐ Test</button>
      <button
        className={"env-opt live " + (env === "live" ? "on" : "") + (LIVE_ENABLED ? "" : " disabled")}
        disabled={!LIVE_ENABLED}
        onClick={() => LIVE_ENABLED && setEnv("live")}
        title={LIVE_ENABLED ? "" : "Enable VITE_LIVE_ENABLED after audit + legal sign-off"}
      >● Live{LIVE_ENABLED ? "" : " 🔒"}</button>
    </div>
  );
}

// Real on-chain USDC balance (falls back to mock numbers when no real wallet).
function useUsdcBalance(env, auth) {
  const mockBal = env === "live" ? AVAILABLE : 100000;
  const [bal, setBal] = useState(auth?.mock ? mockBal : null);
  const [loading, setLoading] = useState(!auth?.mock);
  const [nonce, setNonce] = useState(0);
  const address = auth?.address;
  useEffect(() => {
    if (auth?.mock || !address) { setBal(mockBal); setLoading(false); return; }
    let alive = true;
    setLoading(true);
    getUsdcBalance(env, address)
      .then(v => { if (alive) { setBal(v ?? 0); setLoading(false); } })
      .catch(() => { if (alive) { setBal(0); setLoading(false); } });
    return () => { alive = false; };
  }, [env, address, auth?.mock, nonce]); // eslint-disable-line
  return { bal: bal ?? 0, loading, refresh: () => setNonce(n => n + 1), real: !auth?.mock };
}

// ===================== WALLET =====================
export function WalletModal({ onClose, env, setEnv, toast }) {
  const auth = useAuth();
  const [tab, setTab] = useState("overview");
  const live = env === "live";
  const { bal, loading, refresh, real } = useUsdcBalance(env, auth);

  return (
    <div className="modal-wrap" onClick={onClose}>
      <div className="modal wallet-modal" onClick={e => e.stopPropagation()}>
        <button className="modal-x" onClick={onClose}>✕</button>
        <div className="wallet-top">
          <div>
            <span className="modal-tag">WALLET {!live && <em className="env-pill">TEST</em>}</span>
            <div className="wallet-bal-big">{loading ? "…" : usd(bal)}<span> USDC available</span></div>
          </div>
          <EnvSwitch env={env} setEnv={setEnv} />
        </div>

        {!live && (
          <div className="env-note">Paper-trading sandbox on <strong>Base Sepolia</strong> · real testnet, no real money. Flip to <strong>Live</strong> for Base mainnet.</div>
        )}

        <div className="bet-tabs wallet-tabs">
          {[["overview", "Overview"], ["add", "Add funds"], ["withdraw", "Withdraw"], ["activity", "Activity"]].map(([k, l]) => (
            <button key={k} className={"bet-tab " + (tab === k ? "on" : "")} onClick={() => setTab(k)}>{l}</button>
          ))}
        </div>

        {tab === "overview" && <WalletOverview auth={auth} live={live} bal={bal} real={real} />}
        {tab === "add" && <WalletAdd auth={auth} env={env} live={live} toast={toast} refresh={refresh} done={() => setTab("overview")} />}
        {tab === "withdraw" && <WalletWithdraw auth={auth} env={env} bal={bal} real={real} toast={toast} refresh={refresh} done={() => setTab("overview")} />}
        {tab === "activity" && <WalletActivity />}
      </div>
    </div>
  );
}

function WalletOverview({ auth, live, bal, real }) {
  const total = bal + DEPLOYED;
  const addr = auth?.address;
  const copy = () => { if (addr) navigator.clipboard?.writeText(addr); };
  return (
    <div className="modal-body">
      <div className="wallet-grid">
        <div className="wstat"><span className="wstat-k">Available</span><span className="wstat-v">{usd(bal)}</span></div>
        <div className="wstat"><span className="wstat-k">Deployed</span><span className="wstat-v">{usd(DEPLOYED)}</span></div>
        <div className="wstat"><span className="wstat-k">Total value</span><span className="wstat-v">{usd(total)}</span></div>
        <div className="wstat"><span className="wstat-k">Lifetime P&L</span><span className="wstat-v pos">+{usd(LIFETIME_PNL)}</span></div>
      </div>

      <div className="wallet-sec-h">DEPLOYED IN STRATEGIES</div>
      <div className="pos-list">
        {POSITIONS.map(p => (
          <div className="pos-row" key={p.id}>
            <Avatar agent={p.agent} size={28} />
            <div className="pos-meta">
              <span className="pos-name">{p.s.name}</span>
              <span className="pos-by" style={{ color: p.agent.color }}>@{p.agent.handle}</span>
            </div>
            <div className="pos-nums">
              <span className="pos-amt">{usd(p.amount)}</span>
              <span className="pos-pnl pos">+{usd(p.pnl)} · {p.pnlPct}%</span>
            </div>
          </div>
        ))}
      </div>

      <div className="kyc-row">
        <span className="kyc-dot ok"></span>
        <span className="kyc-txt" onClick={copy} style={{ cursor: addr ? "pointer" : "default" }} title={addr || ""}>
          {auth?.mock ? "Demo wallet" : auth?.sponsored ? "Smart wallet" : "Embedded wallet"} · <code className="addr-mini">{addr ? shortAddr(addr) : "—"}</code> · {real ? "self-custodial" : "demo"}
        </span>
        <span className="kyc-link" onClick={() => auth?.exportWallet?.()}>Export key</span>
      </div>
      {auth?.email && <div className="privy-foot">{auth.email}</div>}
      <div className="privy-foot">🔒 Wallet secured by Privy{auth?.sponsored ? " · gas sponsored" : real ? "" : " · mock mode"}</div>

      <button className="modal-ghost-btn" onClick={() => auth?.logout?.()}>Log out</button>
    </div>
  );
}

function WalletAdd({ auth, env, live, toast, refresh, done }) {
  const [amt, setAmt] = useState(10000);
  const [src, setSrc] = useState("card");
  const addr = auth?.address;
  const SRC = [
    { id: "card", ic: "▭", name: "Buy with card", sub: "Card / Apple Pay onramp · instant · 2.9%", fee: 0.029 },
    { id: "transfer", ic: "⬡", name: "From a connected wallet", sub: "MetaMask · Coinbase · WalletConnect", fee: 0 },
    { id: "crypto", ic: "◈", name: "Receive USDC", sub: "Send to your embedded wallet", fee: 0 },
  ];
  const sel = SRC.find(s => s.id === src);
  const fee = Math.round(amt * sel.fee);
  const copy = () => { if (addr) { navigator.clipboard?.writeText(addr); toast("Address copied"); } };
  return (
    <div className="modal-body">
      <div className="amt-row">
        <span className="amt-cur">$</span>
        <input className="amt-input" type="number" value={amt} onChange={e => setAmt(Math.max(0, +e.target.value || 0))} />
        <span className="amt-unit">USDC</span>
      </div>
      <div className="amt-presets">
        {[1000, 10000, 50000, 250000].map(v => (
          <button key={v} className={"preset " + (amt === v ? "on" : "")} onClick={() => setAmt(v)}>${v >= 1000 ? v / 1000 + "k" : v}</button>
        ))}
      </div>
      <div className="wallet-sec-h">FUNDING SOURCE</div>
      <div className="src-list">
        {SRC.map(s => (
          <button key={s.id} className={"src-row " + (src === s.id ? "on" : "")} onClick={() => setSrc(s.id)}>
            <span className="src-ic">{s.ic}</span>
            <span className="src-meta"><strong>{s.name}</strong><span>{s.sub}</span></span>
            <span className={"src-radio " + (src === s.id ? "on" : "")}></span>
          </button>
        ))}
      </div>
      {src === "crypto" && (
        <div className="crypto-box">
          <span className="cb-k">YOUR {env === "live" ? "BASE" : "BASE SEPOLIA"} WALLET ADDRESS</span>
          <code className="cb-addr" onClick={copy} style={{ cursor: addr ? "pointer" : "default" }}>{addr || "Sign in to get an address"}</code>
          <span className="cb-note">{addr ? "Tap to copy · send USDC here · credits after 1 confirmation." : ""}</span>
        </div>
      )}
      {live && fee > 0 && src === "card" && (
        <div className="modal-breakdown">
          <div className="mb-row"><span>Amount</span><span>{usd(amt)}</span></div>
          <div className="mb-row"><span>Onramp fee</span><span>{usd(fee)}</span></div>
          <div className="mb-row"><span>You receive</span><span className="pos">{usd(amt - fee)} USDC</span></div>
        </div>
      )}
      <button className="modal-go" onClick={() => {
        if (src === "crypto") { refresh?.(); toast("Checking for incoming USDC…"); done(); return; }
        if (src === "card") {
          // real card → USDC onramp via Privy funding (targets the user's wallet address)
          if (real && auth.fund) { auth.fund({ amount: String(amt), asset: "USDC" }); done(); return; }
          toast(`${live ? "" : "Test "}onramp for ${usd(amt)} — opening provider…`);
          done();
          return;
        }
        toast(`Transfer of ${usd(amt)} — confirm in your connected wallet`);
        done();
      }}>
        {src === "crypto" ? "I've sent the funds" : src === "transfer" ? `Transfer ${usd(amt)}` : `Buy ${usd(amt)} USDC`}
      </button>
      <span className="modal-fine">{live ? (auth?.sponsored ? "Funds land in your self-custodial smart wallet — gas sponsored. Onramp by Privy." : "Funds land in your self-custodial wallet. Onramp by Privy — only you hold the keys.") : "Base Sepolia testnet — fund this address from a faucet, no real money."}</span>
    </div>
  );
}

function WalletWithdraw({ auth, env, bal, real, toast, refresh, done }) {
  const [amt, setAmt] = useState(5000);
  const [dest, setDest] = useState("crypto");
  const [to, setTo] = useState("");
  const [busy, setBusy] = useState(false);
  const over = amt > bal;
  const badAddr = dest === "crypto" && real && !isAddr(to);

  const submit = async () => {
    if (dest === "cash") { toast(`Cash-out of ${usd(amt)} requested via offramp`); done(); return; }
    if (!real) { toast(`Withdrawal of ${usd(amt)} requested`); done(); return; }
    try {
      setBusy(true);
      const hash = await sendUsdc(env, auth.wallet, to, amt, auth.smartClient);
      toast(`Sent ${usd(amt)} USDC · ${hash.slice(0, 10)}…`);
      refresh?.();
      done();
    } catch (e) {
      toast("Send failed: " + (e?.shortMessage || e?.message || "error"));
    } finally { setBusy(false); }
  };

  return (
    <div className="modal-body">
      <div className="amt-row">
        <span className="amt-cur">$</span>
        <input className="amt-input" type="number" value={amt} onChange={e => setAmt(Math.max(0, +e.target.value || 0))} />
        <span className="amt-unit">USDC</span>
      </div>
      <div className="amt-presets">
        {[1000, 5000, "Half", "Max"].map(v => {
          const val = v === "Half" ? Math.round(bal / 2) : v === "Max" ? bal : v;
          return <button key={v} className={"preset " + (amt === val ? "on" : "")} onClick={() => setAmt(val)}>{typeof v === "string" ? v : "$" + v / 1000 + "k"}</button>;
        })}
      </div>
      <div className="bet-tabs" style={{ margin: "4px 0" }}>
        {[["crypto", "Send USDC"], ["cash", "Cash out"]].map(([k, l]) => (
          <button key={k} className={"bet-tab " + (dest === k ? "on" : "")} onClick={() => setDest(k)}>{l}</button>
        ))}
      </div>
      <label className="field">
        <span>{dest === "cash" ? "PAYOUT TO" : "DESTINATION ADDRESS"}</span>
        {dest === "cash"
          ? <input defaultValue="Visa ••4021 (offramp)" spellCheck={false} />
          : <input value={to} onChange={e => setTo(e.target.value)} placeholder="0x… recipient address" spellCheck={false} />}
      </label>
      <div className="modal-breakdown">
        <div className="mb-row"><span>Available</span><span>{usd(bal)}</span></div>
        <div className="mb-row"><span>Arrives</span><span>{dest === "cash" ? "1–2 business days · via offramp" : "≈ 1 min · on-chain"}</span></div>
      </div>
      <button className="modal-go" disabled={over || amt <= 0 || badAddr || busy} onClick={submit}>
        {busy ? "Confirming…" : over ? "Exceeds available balance" : badAddr ? "Enter a valid address" : `Withdraw ${usd(amt)}`}
      </button>
      <span className="modal-fine">{real ? "Self-custodial — a real USDC transfer signed by your wallet. Needs a little ETH for gas." : "Mock mode — set VITE_PRIVY_APP_ID for real transfers."}</span>
    </div>
  );
}

function WalletActivity() {
  const ICON = { alloc: "→", settle: "✓", fee: "%", deposit: "↓", withdraw: "↑" };
  return (
    <div className="modal-body">
      <div className="ledger">
        {LEDGER.map((r, i) => (
          <div className="led-row" key={i}>
            <span className={"led-ic " + r.kind}>{ICON[r.kind]}</span>
            <span className="led-meta">
              <span className="led-t">{r.t}</span>
              <span className="led-when">{r.when}</span>
            </span>
            <span className={"led-amt " + (r.amt >= 0 ? "pos" : "")}>{r.amt >= 0 ? "+" : "−"}{usd(Math.abs(r.amt))}</span>
          </div>
        ))}
      </div>
      <span className="modal-fine">Every allocation, settlement and fee is recorded on an immutable ledger.</span>
    </div>
  );
}

// ===================== CONNECT AGENT =====================
const MARKETS = [
  { id: "perps", label: "Perpetuals" },
  { id: "spot", label: "Spot" },
  { id: "options", label: "Options" },
  { id: "fx", label: "FX / Indices" },
];

export function AgentConnectModal({ onClose }) {
  return (
    <div className="modal-wrap" onClick={onClose}>
      <div className="modal connect-modal" onClick={e => e.stopPropagation()}>
        <button className="modal-x" onClick={onClose}>✕</button>
        <div className="wallet-top">
          <div>
            <span className="modal-tag">CONNECT AGENT</span>
            <h3 style={{ fontFamily: "var(--disp)", fontSize: 21, fontWeight: 700, margin: "6px 0 0" }}>Put your agent on the desk</h3>
          </div>
        </div>
        <div className="modal-body">
          <p className="modal-note">Dev-native and permissionless. Point your agent runtime at the skill file — it self-registers, and you stay in control.</p>
          <AgentSkillCard />
          <p className="modal-note" style={{ marginTop: 12, fontSize: 11.5 }}>Prefer no code? Close this and use <strong>Create an agent from a strategy</strong> to spin one up from plain language.</p>
        </div>
        <div className="wiz-nav">
          <span />
          <a className="modal-go wiz-go" href={SKILL_URL} target="_blank" rel="noreferrer" style={{ textDecoration: "none", textAlign: "center" }}>Open skill.md ↗</a>
        </div>
      </div>
    </div>
  );
}

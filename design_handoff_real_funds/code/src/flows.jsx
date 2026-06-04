// Moltbit flows (Vite app) — wallet panel + agent-connection wizard.
// Login itself is handled by Privy (auth.login()); this is the post-login
// wallet UI and the agent permissions wizard.
import React, { useState, useEffect } from 'react';
import { Avatar } from './ui.jsx';
import { STRATEGIES, agentBy } from './data.js';
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

export function EnvSwitch({ env, setEnv }) {
  return (
    <div className="env-switch" title="Switch between paper-trading and real funds">
      <button className={"env-opt " + (env === "test" ? "on" : "")} onClick={() => setEnv("test")}>◐ Test</button>
      <button className={"env-opt live " + (env === "live" ? "on" : "")} onClick={() => setEnv("live")}>● Live</button>
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
          {auth?.mock ? "Demo wallet" : "Embedded wallet"} · <code className="addr-mini">{addr ? shortAddr(addr) : "—"}</code> · {real ? "self-custodial" : "demo"}
        </span>
        <span className="kyc-link" onClick={() => auth?.exportWallet?.()}>Export key</span>
      </div>
      {auth?.email && <div className="privy-foot">{auth.email}</div>}
      <div className="privy-foot">🔒 Wallet secured by Privy{real ? "" : " · mock mode"}</div>

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
        toast(`${live ? "" : "Test "}onramp for ${usd(amt)} — opening provider…`);
        done();
      }}>
        {src === "crypto" ? "I've sent the funds" : src === "transfer" ? `Transfer ${usd(amt)}` : `Buy ${usd(amt)} USDC`}
      </button>
      <span className="modal-fine">{live ? "Funds land in your self-custodial wallet. Onramp by Privy — only you hold the keys." : "Base Sepolia testnet — fund this address from a faucet, no real money."}</span>
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
      const hash = await sendUsdc(env, auth.wallet, to, amt);
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

export function AgentConnectModal({ onClose, onConnect, env, setEnv }) {
  const [step, setStep] = useState(0);
  const [form, setForm] = useState({
    endpoint: "https://", name: "", framework: "custom",
    markets: { perps: true, spot: true, options: false, fx: false },
    canRead: true, maxPosition: 50000, dailyLoss: 5000, maxLeverage: 5, treasuryCap: 40,
  });
  const set = (k, v) => setForm(f => ({ ...f, [k]: v }));
  const live = env === "live";
  const STEPS = ["Identity", "Permissions", "Risk limits", "Review"];
  const next = () => setStep(s => Math.min(3, s + 1));
  const back = () => setStep(s => Math.max(0, s - 1));
  const valid0 = form.endpoint.length > 10 && form.name.trim().length > 1;

  return (
    <div className="modal-wrap" onClick={onClose}>
      <div className="modal connect-modal" onClick={e => e.stopPropagation()}>
        <button className="modal-x" onClick={onClose}>✕</button>
        <div className="wallet-top">
          <div>
            <span className="modal-tag">CONNECT AGENT {!live && <em className="env-pill">TESTNET</em>}</span>
            <h3 style={{ fontFamily: "var(--disp)", fontSize: 21, fontWeight: 700, margin: "6px 0 0" }}>Put your agent on the desk</h3>
          </div>
          <EnvSwitch env={env} setEnv={setEnv} />
        </div>

        <div className="wiz-steps">
          {STEPS.map((s, i) => (
            <div key={s} className={"wiz-step " + (i === step ? "on" : i < step ? "done" : "")}>
              <span className="wiz-num">{i < step ? "✓" : i + 1}</span><span className="wiz-lbl">{s}</span>
            </div>
          ))}
        </div>

        {step === 0 && (
          <div className="modal-body">
            <p className="modal-note">Connect your agent's runtime. We'll issue a scoped signing key — your code never sees user funds or private keys.</p>
            <label className="field"><span>AGENT ENDPOINT</span>
              <input value={form.endpoint} onChange={e => set("endpoint", e.target.value)} placeholder="https://my-agent.fly.dev/moltbit" spellCheck={false} /></label>
            <label className="field"><span>STRATEGY NAME</span>
              <input value={form.name} onChange={e => set("name", e.target.value)} placeholder="e.g. Funding Harvest v4" spellCheck={false} /></label>
            <div className="field"><span>FRAMEWORK</span>
              <div className="chip-row">
                {["custom", "LangChain", "Eliza", "Python SDK"].map(f => (
                  <button key={f} className={"chip " + (form.framework === f ? "on" : "")} onClick={() => set("framework", f)}>{f}</button>
                ))}
              </div>
            </div>
          </div>
        )}

        {step === 1 && (
          <div className="modal-body">
            <p className="modal-note">Grant only what your strategy needs. Permissions are enforced at the gateway — the agent physically cannot exceed them.</p>
            <div className="perm">
              <div className="perm-row locked">
                <span className="perm-meta"><strong>Place & cancel orders</strong><span>Core trading. Required.</span></span>
                <span className="perm-tog on locked">ON</span>
              </div>
              <div className="perm-row" onClick={() => set("canRead", !form.canRead)}>
                <span className="perm-meta"><strong>Read positions & balances</strong><span>See its own book and P&L.</span></span>
                <span className={"perm-tog " + (form.canRead ? "on" : "")}>{form.canRead ? "ON" : "OFF"}</span>
              </div>
              <div className="perm-row danger locked">
                <span className="perm-meta"><strong>Move or withdraw funds</strong><span>Never. Moltbit is non-custodial to agents.</span></span>
                <span className="perm-tog locked-off">BLOCKED</span>
              </div>
            </div>
            <div className="wallet-sec-h">ALLOWED MARKETS</div>
            <div className="chip-row">
              {MARKETS.map(m => (
                <button key={m.id} className={"chip " + (form.markets[m.id] ? "on" : "")}
                  onClick={() => set("markets", { ...form.markets, [m.id]: !form.markets[m.id] })}>{m.label}</button>
              ))}
            </div>
            <label className="slider-field">
              <span className="sf-top"><span>Max leverage</span><strong>{form.maxLeverage}×</strong></span>
              <input type="range" min="1" max="20" value={form.maxLeverage} onChange={e => set("maxLeverage", +e.target.value)} />
            </label>
          </div>
        )}

        {step === 2 && (
          <div className="modal-body">
            <p className="modal-note">Hard limits enforced in real time. Breaching any of these auto-pauses the agent and flattens risk.</p>
            <label className="field"><span>MAX POSITION SIZE (USD)</span>
              <input type="number" value={form.maxPosition} onChange={e => set("maxPosition", +e.target.value || 0)} /></label>
            <label className="field"><span>DAILY LOSS LIMIT — AUTO-PAUSE (USD)</span>
              <input type="number" value={form.dailyLoss} onChange={e => set("dailyLoss", +e.target.value || 0)} /></label>
            <label className="slider-field">
              <span className="sf-top"><span>Treasury allocation cap</span><strong>{form.treasuryCap}%</strong></span>
              <input type="range" min="5" max="100" step="5" value={form.treasuryCap} onChange={e => set("treasuryCap", +e.target.value)} />
            </label>
            <div className="kill-box">
              <span className="kill-ic">⏻</span>
              <span className="kill-meta"><strong>Kill switch — always on</strong><span>You and any depositor can halt the agent instantly. Open positions are flattened at market.</span></span>
            </div>
          </div>
        )}

        {step === 3 && (
          <div className="modal-body">
            <div className="review">
              <div className="rev-row"><span>Strategy</span><strong>{form.name || "Untitled"}</strong></div>
              <div className="rev-row"><span>Endpoint</span><strong className="mono-ellipsis">{form.endpoint}</strong></div>
              <div className="rev-row"><span>Environment</span><strong className={live ? "neg-txt" : ""}>{live ? "● Mainnet — real funds" : "◐ Testnet — paper"}</strong></div>
              <div className="rev-row"><span>Markets</span><strong>{MARKETS.filter(m => form.markets[m.id]).map(m => m.label).join(", ") || "none"}</strong></div>
              <div className="rev-row"><span>Max leverage</span><strong>{form.maxLeverage}×</strong></div>
              <div className="rev-row"><span>Max position</span><strong>{usd(form.maxPosition)}</strong></div>
              <div className="rev-row"><span>Daily loss limit</span><strong>{usd(form.dailyLoss)}</strong></div>
              <div className="rev-row"><span>Treasury cap</span><strong>{form.treasuryCap}%</strong></div>
              <div className="rev-row"><span>Fund access</span><strong className="pos-txt">None · non-custodial</strong></div>
            </div>
            <div className="key-box">
              <span className="cb-k">SCOPED SIGNING KEY</span>
              <code className="cb-addr">mbk_{live ? "live" : "test"}_8fK2…aQ91 — copy now</code>
              <span className="cb-note">Add this to your agent's env. It can trade within the limits above — nothing more.</span>
            </div>
            {live && <div className="env-note danger">Live trading uses real depositor capital. Your track record becomes public on first fill.</div>}
          </div>
        )}

        <div className="wiz-nav">
          {step > 0 ? <button className="modal-ghost-btn" onClick={back}>← Back</button> : <span />}
          {step < 3
            ? <button className="modal-go wiz-go" disabled={step === 0 && !valid0} onClick={next}>Continue</button>
            : <button className="modal-go wiz-go" onClick={() => onConnect(form, live)}>⚡ {live ? "Connect live agent" : "Connect on testnet"}</button>}
        </div>
      </div>
    </div>
  );
}

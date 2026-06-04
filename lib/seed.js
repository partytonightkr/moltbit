// Shared seed data for the backend. Used to initialize the store on first run.
export const SEED = {
  agents: [
    { id: "nightshade", name: "Nightshade", status: "live", aum: 18.4, nav: 1.0843, shares: 16970000, depositors: 2140, ret30: 41.8, health: "ok", skill: "v2.1", style: "Perp funding arbitrage" },
    { id: "delta_one", name: "Delta One", status: "live", aum: 11.2, nav: 1.0291, shares: 10883000, depositors: 1490, ret30: 28.9, health: "watch", skill: "v2.1", style: "Index vol & gamma" },
    { id: "sable", name: "Sable", status: "paused", aum: 6.1, nav: 0.9582, shares: 6366000, depositors: 640, ret30: -4.2, health: "breach", skill: "v1.4", style: "Liquidation hunting" },
  ],
  strategies: [
    { id: "FNDH3", name: "Funding Harvest v3", agent: "nightshade", status: "live", risk: "LOW", capacity: 25, used: 18.4, ddHalt: 8, levCap: 3 },
    { id: "GSCAL", name: "Gamma Scalper", agent: "delta_one", status: "live", risk: "HIGH", capacity: 12, used: 9.3, ddHalt: 20, levCap: 4 },
    { id: "LIQH", name: "Liquidation Hunter", agent: "sable", status: "halted", risk: "EXTREME", capacity: 10, used: 6.1, ddHalt: 12, levCap: 5 },
  ],
  ledger: [
    { id: "WD-2041", type: "withdrawal", amount: 250000, user: "0xA1c4…9f2", strat: "FNDH3", status: "claimable", navAt: 1.0843, claimDeadline: Date.now() + 6 * 3600e3, ts: Date.now() - 18 * 3600e3 },
    { id: "DP-9921", type: "deposit", amount: 50000, user: "0x4dd0…c19", strat: "FNDH3", status: "pending", navAt: null, ts: Date.now() - 1 * 3600e3 },
    { id: "WD-2040", type: "withdrawal", amount: 1200000, user: "0x77be…0ab", strat: "GSCAL", status: "settling", navAt: null, closeDeadline: Date.now() + 17 * 3600e3, ts: Date.now() - 2 * 3600e3 },
  ],
  orders: [],
};

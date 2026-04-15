/**
 * Tyche — DeFi portfolio math.
 *
 * Pure helpers for the dashboard: weighted APY, impermanent-loss for
 * a 2-token AMM position, realised vs. unrealised PnL via a lot-based
 * FIFO, and a simple rebalance proposal toward a target allocation.
 *
 * Everything here is deterministic and dependency-free so it can run
 * in the static-site bundle next to the price feed.
 */

/** Weighted APY of a portfolio of positions. */
export function weightedApy(positions) {
  const totalUsd = positions.reduce((s, p) => s + (p.valueUsd || 0), 0);
  if (totalUsd === 0) return 0;
  let w = 0;
  for (const p of positions) w += ((p.apy || 0) * (p.valueUsd || 0)) / totalUsd;
  return w;
}

/**
 * Impermanent loss for a 50/50 constant-product LP position, given
 * the price ratio of token A to token B at open vs. now.
 * Returns a negative fraction (e.g. -0.057 for ~5.7% IL).
 */
export function impermanentLoss(priceRatioOpen, priceRatioNow) {
  if (priceRatioOpen <= 0 || priceRatioNow <= 0) return 0;
  const r = priceRatioNow / priceRatioOpen;
  const value = (2 * Math.sqrt(r)) / (1 + r);
  return value - 1; // negative if IL
}

/**
 * FIFO PnL: walk a chronological list of buys and sells and return
 * realised PnL plus remaining open lots.
 *
 * trades: [{ side:'buy'|'sell', qty, priceUsd, ts }]
 */
export function fifoPnl(trades) {
  const lots = [];
  let realised = 0;
  for (const t of [...trades].sort((a, b) => (a.ts || 0) - (b.ts || 0))) {
    if (t.side === "buy") {
      lots.push({ qty: t.qty, priceUsd: t.priceUsd });
      continue;
    }
    let remaining = t.qty;
    while (remaining > 0 && lots.length > 0) {
      const lot = lots[0];
      const take = Math.min(lot.qty, remaining);
      realised += take * (t.priceUsd - lot.priceUsd);
      lot.qty -= take;
      remaining -= take;
      if (lot.qty === 0) lots.shift();
    }
  }
  const openQty = lots.reduce((s, l) => s + l.qty, 0);
  const openCostBasis = lots.reduce((s, l) => s + l.qty * l.priceUsd, 0);
  return {
    realised,
    openQty,
    avgCostBasis: openQty > 0 ? openCostBasis / openQty : 0,
    lots,
  };
}

/**
 * Suggest buys/sells that move current allocation toward targetPct
 * without trading below minTradeUsd. targetPct is a map { symbol: 0..1 }.
 */
export function rebalanceToTarget(holdings, targetPct, { minTradeUsd = 25 } = {}) {
  const totalUsd = holdings.reduce((s, h) => s + h.valueUsd, 0);
  if (totalUsd === 0) return [];
  const actions = [];
  for (const h of holdings) {
    const target = (targetPct[h.symbol] || 0) * totalUsd;
    const diff = target - h.valueUsd;
    if (Math.abs(diff) < minTradeUsd) continue;
    actions.push({
      symbol: h.symbol,
      side: diff > 0 ? "buy" : "sell",
      usd: Math.round(Math.abs(diff) * 100) / 100,
    });
  }
  return actions.sort((a, b) => b.usd - a.usd);
}

/** Format a USD value with sensible precision for small balances. */
export function formatUsd(n) {
  if (!Number.isFinite(n)) return "—";
  const abs = Math.abs(n);
  if (abs >= 1_000_000) return `$${(n / 1_000_000).toFixed(2)}M`;
  if (abs >= 1_000) return `$${(n / 1_000).toFixed(2)}K`;
  if (abs >= 1) return `$${n.toFixed(2)}`;
  return `$${n.toPrecision(2)}`;
}

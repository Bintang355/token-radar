// Token radar, model "radar-2": a sealed snapshot of the protocol world goes in,
// a ranked board of pre-token protocols comes out.
//
// The idea is simple. A protocol with no token yet is worth something like what
// similar protocols that already trade are worth, relative to the value they hold.
// So for each category we take the live-token protocols in it, look at their
// market-cap-to-TVL ratio, and take the middle one. That ratio is the category's
// comparable. A pre-token protocol's implied value is its own TVL times that
// comparable, nudged up or down by how fast it grew this week and by how long it
// has existed. Nothing is hand-priced: every multiple is recomputed from the
// snapshot on each run, and no protocol name is ever treated specially.
//
// The board is two layers. The bottom layer is the watchlist: every slug the
// snapshot names must appear, because the watchlist is the floor the board is
// judged on. The top layer is every other pre-token protocol the snapshot can
// rank. A protocol can only rank if it is genuinely pre-token and is not a
// wrapped, staked or bridged version of something that already trades — the
// same test the house applied to the watchlist, applied here to the whole board.
// That keeps WBTC, staked-ETH products and the canonical bridges off the top,
// since their token already trades and there is nothing to launch.
//
// Live-token protocols are not ranked at all. They are set aside and shown as
// the market's own values, so the board stays a list of launches still to come.

/** One protocol entry exactly as the sealed snapshot carries it. */
export interface SnapshotProtocol {
  slug: string;
  name: string;
  category: string | null;
  chains: string[];
  tvl_usd: number;
  change_7d: number | null;
  mcap_usd: number | null;
  listed_at: string | null;
  gecko_id: string | null;
  symbol: string | null;
}

/** The sealed snapshot document. */
export interface Snapshot {
  as_of: string;
  source: string;
  floor_usd: number;
  protocols: SnapshotProtocol[];
  watchlist: string[];
}

/** The tuning knobs of the model, as the dashboard prints them. */
export interface ModelConstants {
  growth_weight: number;
  growth_floor: number;
  growth_cap: number;
  maturity_floor: number;
  maturity_range: number;
  maturity_days: number;
  unknown_age_days: number;
  comparable_min_n: number;
  multiple_floor: number;
  multiple_cap: number;
}

export const MODEL: ModelConstants = {
  growth_weight: 0.5,
  growth_floor: -60,
  growth_cap: 120,
  maturity_floor: 0.6,
  maturity_range: 0.4,
  maturity_days: 1095,
  unknown_age_days: 365,
  comparable_min_n: 3,
  multiple_floor: 0.02,
  multiple_cap: 1.5,
};

/** The label the dashboard and the rules use for this model. */
export const MODEL_VERSION = 'radar-2';

/** How many live-token protocols the dashboard's live view shows. */
export const LIVE_ROWS = 24;

// ---------------------------------------------------------------------------
// The house rules: which protocols are a wrapped, staked or bridged product
// of a token that already trades, and therefore can never rank.
// ---------------------------------------------------------------------------

/** A name that ends in a release marker is a versioned pool of another protocol. */
const VERSION_TAIL = /\s(V\d+(\.\d+)?|v\d+(\.\d+)?|\d+\.\d+)$/;
/** A whole word that betrays a wrapped, staked or bridged product. */
const WRAP_WORD = /\b(wrapped|staked|staking)\b/i;
/** Categories that are a product of an existing token, or an exchange itself. */
const BLOCKED_CATS = new Set([
  'CEX',
  'Bridge',
  'Canonical Bridge',
  'Liquid Staking',
  'Liquid Restaking',
  'Restaked BTC',
]);
/** Exchange names a rankable protocol's name may not start with. */
const EXCHANGE_NAMES = [
  'Binance',
  'Coinbase',
  'Bybit',
  'Kraken',
  'Bitget',
  'OKX',
  'Bitfinex',
  'Gemini',
];

const DAY_MS = 86_400_000;

/** One step of a farm plan: what to do, what it costs, how long it takes. */
export interface FarmStep {
  text: string;
  cost: string;
  time: string;
}

/** A row of the ranked board, as board.json carries it. */
export interface BoardRow {
  rank: number;
  slug: string;
  name: string;
  category: string | null;
  chains: string[];
  tvl_usd: number;
  change_7d: number | null;
  mcap_usd: number | null;
  listed_at: string | null;
  gecko_id: string | null;
  symbol: string | null;
  token_status: 'pre-token';
  watchlist: boolean;
  age_days: number | null;
  implied_value_usd: number;
  model: {
    category_multiple: number;
    comparables_n: number;
    growth_pct: number;
    growth_multiplier: number;
    maturity_multiplier: number;
    age_days: number | null;
  };
  farm_steps: string[];
}

/** The dashboard's compact form of a board row. */
export interface RadarRow {
  rank: number;
  slug: string;
  name: string;
  category: string | null;
  chains: string[];
  tvl_usd: number;
  change_7d: number | null;
  mcap_usd: number | null;
  listed_at: string | null;
  age_days: number | null;
  implied_value_usd: number;
  category_multiple: number;
  comparables_n: number;
  growth_multiplier: number;
  maturity_multiplier: number;
  watchlist: boolean;
  farm_steps: string[];
}

/** A live-token protocol, shown at the market's own value, never modelled. */
export interface LiveRow {
  slug: string;
  name: string;
  category: string | null;
  chains: string[];
  tvl_usd: number;
  mcap_usd: number | null;
  change_7d: number | null;
}

/** One category's comparable: the multiple and the protocols behind it. */
export interface CategoryComparable {
  multiple: number;
  n: number;
  top: { name: string; mcap_usd: number; tvl_usd: number }[];
}

/** All the comparables the model computed from the snapshot's live tokens. */
export interface Comparables {
  overall_multiple: number;
  by_category: Record<string, CategoryComparable>;
}

/** Everything the dashboard renders: board, live set, comparables, model. */
export interface RadarData {
  as_of: string;
  source: string;
  floor_usd: number;
  model: ModelConstants;
  model_version: string;
  watchlist_size: number;
  board_size: number;
  early_size: number;
  live_size: number;
  comparables: Comparables;
  rows: RadarRow[];
  live: LiveRow[];
}

/** Thrown when the snapshot file is not one this model can score. */
export class SnapshotError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'SnapshotError';
  }
}

// ---------------------------------------------------------------------------
// Small numbers.
// ---------------------------------------------------------------------------

/** A finite number, or `fallback` when the value is missing or not finite. */
function numOr(value: unknown, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback;
}

/** The middle value of a non-empty list (the average of the two middles when even). */
function middleOf(values: number[]): number {
  const ordered = [...values].sort((a, b) => a - b);
  const mid = Math.floor(ordered.length / 2);
  return ordered.length % 2 === 1
    ? ordered[mid]!
    : (ordered[mid - 1]! + ordered[mid]!) / 2;
}

/** Round to four decimal places, so the dashboard's multiples read cleanly. */
function round4dp(n: number): number {
  return Math.round(n * 1e4) / 1e4;
}

// ---------------------------------------------------------------------------
// Age and multiples.
// ---------------------------------------------------------------------------

/** Whole days from `listedAt` to `asOf`, never below zero; null when unparseable. */
export function ageDays(asOf: string, listedAt: string | null): number | null {
  if (listedAt === null) return null;
  const end = Date.parse(`${asOf}T00:00:00Z`);
  const start = Date.parse(`${listedAt}T00:00:00Z`);
  if (!Number.isFinite(end) || !Number.isFinite(start)) return null;
  return Math.max(0, Math.floor((end - start) / DAY_MS));
}

/**
 * The comparable multiples, recomputed from the snapshot's own live-token
 * protocols on every run. For each category, the median market-cap/TVL of its
 * live-token protocols when at least `comparable_min_n` of them carry a market
 * cap; otherwise the median across every live-token protocol. Each multiple is
 * clamped to [multiple_floor, multiple_cap]. The two biggest live-token
 * protocols per category are kept so the dashboard can name them.
 */
export function categoryMultiples(snapshot: Snapshot, model: ModelConstants = MODEL): Comparables {
  const live = snapshot.protocols.filter(
    (p) => p.mcap_usd !== null && p.mcap_usd > 0 && p.tvl_usd > 0 && p.category !== 'CEX',
  );
  const overall = live.length > 0 ? middleOf(live.map((p) => p.mcap_usd! / p.tvl_usd)) : 0.25;
  const grouped = new Map<string, SnapshotProtocol[]>();
  for (const p of live) {
    const key = p.category ?? 'Uncategorised';
    const bucket = grouped.get(key) ?? [];
    bucket.push(p);
    grouped.set(key, bucket);
  }
  const by_category: Record<string, CategoryComparable> = {};
  for (const [key, members] of grouped) {
    const raw =
      members.length >= model.comparable_min_n
        ? middleOf(members.map((p) => p.mcap_usd! / p.tvl_usd))
        : overall;
    const multiple = round4dp(Math.min(model.multiple_cap, Math.max(model.multiple_floor, raw)));
    const top = [...members]
      .sort((a, b) => b.mcap_usd! - a.mcap_usd!)
      .slice(0, 2)
      .map((p) => ({ name: p.name, mcap_usd: p.mcap_usd!, tvl_usd: p.tvl_usd }));
    by_category[key] = { multiple, n: members.length, top };
  }
  return { overall_multiple: round4dp(overall), by_category };
}

/** A category's multiple and the count behind it; the overall when unknown. */
export function multipleFor(
  category: string | null,
  comparables: Comparables,
): { multiple: number; n: number } {
  const found = comparables.by_category[category ?? 'Uncategorised'];
  if (found === undefined) return { multiple: comparables.overall_multiple, n: 0 };
  return { multiple: found.multiple, n: found.n };
}

/**
 * What one protocol is worth under the model, and the three pieces that made it:
 * the week's growth (clamped), the growth multiplier, the maturity multiplier,
 * and the age they came from.
 *
 *   growthPct  = clamp(change_7d, growth_floor, growth_cap)
 *   growthMult = 1 + (growthPct / 100) * growth_weight
 *   maturity   = maturity_floor + min(max(age, 0), maturity_days) / maturity_days * maturity_range
 *   implied    = max(1, round(tvl * categoryMultiple * growthMult * maturity))
 *
 * An unknown age counts as `unknown_age_days`. The growth clamp is applied
 * before the multiplier, so a protocol that fell 80% in a week is treated as
 * if it fell exactly `growth_floor` percent, never worse.
 */
export function impliedValue(
  protocol: SnapshotProtocol,
  asOf: string,
  model: ModelConstants,
  categoryMultiple: number,
): {
  implied: number;
  growthPct: number;
  growthMult: number;
  maturityMult: number;
  age: number | null;
} {
  const age = ageDays(asOf, protocol.listed_at);
  const weeklyPct = numOr(protocol.change_7d, 0);
  const growthPct = Math.min(model.growth_cap, Math.max(model.growth_floor, weeklyPct));
  const growthMult = 1 + (growthPct / 100) * model.growth_weight;
  const ageUsed = age ?? model.unknown_age_days;
  const cappedAge = Math.min(Math.max(ageUsed, 0), model.maturity_days);
  const maturityMult = model.maturity_floor + (cappedAge / model.maturity_days) * model.maturity_range;
  const implied = Math.max(1, Math.round(protocol.tvl_usd * categoryMultiple * growthMult * maturityMult));
  return { implied, growthPct, growthMult, maturityMult, age };
}

// ---------------------------------------------------------------------------
// Who may rank.
// ---------------------------------------------------------------------------

/** True when the snapshot records no token for the protocol at all. */
export function isPreToken(p: SnapshotProtocol): boolean {
  return p.mcap_usd === null && p.gecko_id === null && p.symbol === null;
}

/**
 * True when the board may rank a protocol: it is pre-token, and it is not a
 * wrapped, staked or bridged product of a token that already trades. Every
 * watchlist slug passes this test.
 */
export function isRankable(p: SnapshotProtocol): boolean {
  if (!isPreToken(p)) return false;
  if (p.category !== null && BLOCKED_CATS.has(p.category)) return false;
  if (VERSION_TAIL.test(p.name)) return false;
  if (WRAP_WORD.test(p.name)) return false;
  if (EXCHANGE_NAMES.some((x) => p.name.startsWith(x))) return false;
  return true;
}

// ---------------------------------------------------------------------------
// The board.
// ---------------------------------------------------------------------------

/** The snapshot's protocols keyed by slug. */
function indexBySlug(protocols: SnapshotProtocol[]): Map<string, SnapshotProtocol> {
  return new Map(protocols.map((p) => [p.slug, p]));
}

/**
 * The ranked board. The watchlist comes first as the floor — every slug the
 * snapshot names, in the watchlist's own order — then every other rankable
 * protocol. Each is scored, the board is ordered by implied value descending
 * (ties broken by slug, ascending), and ranks run 1..n.
 */
export function buildBoard(
  snapshot: Snapshot,
  model: ModelConstants = MODEL,
  comparables: Comparables = categoryMultiples(snapshot, model),
): BoardRow[] {
  const index = indexBySlug(snapshot.protocols);
  const chosen = new Map<string, SnapshotProtocol>();
  for (const slug of snapshot.watchlist) {
    const p = index.get(slug);
    if (p !== undefined) chosen.set(slug, p);
  }
  for (const p of snapshot.protocols) {
    if (!chosen.has(p.slug) && isRankable(p)) chosen.set(p.slug, p);
  }

  const scored = [...chosen.values()].map((p) => {
    const { multiple, n } = multipleFor(p.category, comparables);
    const { implied, growthPct, growthMult, maturityMult, age } = impliedValue(
      p,
      snapshot.as_of,
      model,
      multiple,
    );
    return { p, implied, growthPct, growthMult, maturityMult, age, multiple, n };
  });
  scored.sort(
    (a, b) =>
      b.implied - a.implied ||
      (a.p.slug < b.p.slug ? -1 : a.p.slug > b.p.slug ? 1 : 0),
  );
  return scored.map((s, i) => ({
    rank: i + 1,
    slug: s.p.slug,
    name: s.p.name,
    category: s.p.category,
    chains: s.p.chains,
    tvl_usd: s.p.tvl_usd,
    change_7d: s.p.change_7d,
    mcap_usd: s.p.mcap_usd,
    listed_at: s.p.listed_at,
    gecko_id: s.p.gecko_id,
    symbol: s.p.symbol,
    token_status: 'pre-token',
    watchlist: snapshot.watchlist.includes(s.p.slug),
    age_days: s.age,
    implied_value_usd: s.implied,
    model: {
      category_multiple: s.multiple,
      comparables_n: s.n,
      growth_pct: s.growthPct,
      growth_multiplier: round4dp(s.growthMult),
      maturity_multiplier: round4dp(s.maturityMult),
      age_days: s.age,
    },
    farm_steps: farmSteps(s.p, s.age).map(stepText),
  }));
}

// ---------------------------------------------------------------------------
// The farm plan: seven steps derived from the protocol's own record.
// ---------------------------------------------------------------------------

/** One step as a single string, kept inside the gate's 20..600 characters. */
export function stepText(step: FarmStep): string {
  let s = `${step.text} Cost: ${step.cost}. Time: ${step.time}.`;
  if (s.length > 600) s = `${s.slice(0, 596)}...`;
  if (s.length < 20) s = `${s} Hold the position and check the protocol's own page.`;
  return s;
}

/** The protocol's first chain, or a neutral phrase when it names none. */
function firstChain(p: SnapshotProtocol): string {
  return p.chains.length > 0 ? p.chains[0]! : 'its main chain';
}

/** The capital one farm position needs, from the protocol's own TVL. */
function stakeFor(p: SnapshotProtocol): number {
  if (p.tvl_usd >= 5_000_000_000) return 250;
  if (p.tvl_usd >= 1_000_000_000) return 150;
  if (p.tvl_usd >= 100_000_000) return 100;
  return 50;
}

/** How long to hold: younger protocols need a longer qualifying window. */
function holdFor(age: number | null): number {
  if (age === null) return 30;
  if (age < 180) return 60;
  if (age < 365) return 45;
  return 30;
}

/** What transactions cost on a chain: Ethereum is dear, the rest are cheap. */
function gasOn(chain: string): { setup: string; weekly: string } {
  if (chain === 'Ethereum') return { setup: '$5–$15', weekly: '$5–$8' };
  return { setup: 'under $1', weekly: 'under $1' };
}

/** The entry action for the category, in words a farmer can follow. */
function enterAction(p: SnapshotProtocol, capital: number, chain: string): string {
  const c = (p.category ?? '').toLowerCase();
  const name = p.name;
  if (c.includes('risk curator') || c.includes('capital allocator') || c.includes('curator') || c.includes('allocator')) return `Deposit $${capital} into a ${name} vault on ${chain} and keep the shares.`;
  if (c.includes('lend') || c.includes('cdp') || c.includes('collateral')) return `Supply $${capital} of USDC to ${name} on ${chain} and keep the position open.`;
  if (c.includes('index')) return `Buy $${capital} of the ${name} index on ${chain} and hold the shares.`;
  if (c.includes('dex') || c.includes('leveraged farm')) return `Provide $${capital} of liquidity to ${name}'s main pool on ${chain} and keep the position open.`;
  if (c.includes('yield aggregator')) return `Deposit $${capital} into ${name}'s vault on ${chain} and keep the shares.`;
  if (c.includes('yield')) return `Deposit $${capital} into ${name}'s main yield pool on ${chain} and keep the position open.`;
  if (c.includes('basis')) return `Deposit $${capital} into ${name}'s basis vault on ${chain} and keep the position open.`;
  if (c.includes('derivative') || c.includes('perpetual')) return `Deposit $${capital} of USDC as margin on ${name} and open one small hedge.`;
  if (c.includes('rwa')) return `Mint $${capital} of the protocol's yield asset on ${chain} and hold it.`;
  if (c.includes('prediction')) return `Fund $${capital} and place one market position on ${name}.`;
  if (c.includes('insurance')) return `Buy $${capital} of cover from ${name} on ${chain} and keep the policy.`;
  if (c.includes('staking') || c.includes('restak')) return `Stake $${capital} of the chain's staking asset through ${name} and keep the receipt.`;
  if (c.includes('bridge')) return `Bridge $${capital} of USDC to ${chain} through ${name} and use the bridged funds in its app.`;
  if (c.includes('stable')) return `Mint or deposit $${capital} of the stable asset through ${name} on ${chain}.`;
  if (c.includes('chain')) return `Bridge $${capital} of USDC to ${name} and use its main app.`;
  return `Deposit $${capital} of USDC into ${name} on ${chain} and keep the position open.`;
}

/** The weekly qualifying action for the category. */
function weeklyAction(p: SnapshotProtocol): string {
  const c = (p.category ?? '').toLowerCase();
  const name = p.name;
  if (c.includes('lend') || c.includes('cdp') || c.includes('collateral')) return `Borrow a small amount against the deposit on ${name} and repay it, then check the borrow rate.`;
  if (c.includes('index')) return `Check the index composition on ${name} and hold the shares.`;
  if (c.includes('dex') || c.includes('leveraged farm')) return `Make one swap in ${name}'s main pool.`;
  if (c.includes('yield')) return `Claim the rewards on ${name} and re-deposit them.`;
  if (c.includes('basis') || c.includes('derivative') || c.includes('perpetual')) return `Open and close one small hedge on ${name}.`;
  if (c.includes('rwa')) return `Check the yield on ${name} and hold the asset.`;
  if (c.includes('risk curator') || c.includes('capital allocator') || c.includes('curator') || c.includes('allocator')) return `Check ${name}'s allocation and keep the vault shares.`;
  if (c.includes('prediction')) return `Place one small market position on ${name}.`;
  if (c.includes('insurance')) return `Check the cover on ${name} and keep the policy.`;
  if (c.includes('staking') || c.includes('restak')) return `Check the staking rewards on ${name}.`;
  if (c.includes('chain')) return `Use ${name}'s main app once.`;
  return `Make one qualifying action each week, such as a deposit, a borrow, a swap or a vote.`;
}

/** The category's one risk, stated plainly. */
function riskOf(p: SnapshotProtocol): string {
  const c = (p.category ?? '').toLowerCase();
  if (c.includes('index')) return `the index can fall with the market it tracks`;
  if (c.includes('dex') || c.includes('leveraged farm')) return `impermanent loss can eat the deposit if the pool's two assets move apart in price`;
  if (c.includes('lend') || c.includes('cdp') || c.includes('collateral')) return `liquidation can take the collateral if its value falls below the borrow`;
  if (c.includes('yield')) return `the yield can fall and new deposits can dilute the rewards`;
  if (c.includes('basis') || c.includes('derivative') || c.includes('perpetual')) return `leverage can lose the whole margin on a fast move`;
  if (c.includes('rwa')) return `the off-chain asset can default or the issuer can pause redemptions`;
  if (c.includes('risk curator') || c.includes('capital allocator') || c.includes('curator') || c.includes('allocator')) return `the curator's picks can underperform and the vault can lose value`;
  if (c.includes('bridge')) return `a bridge can pause withdrawals`;
  if (c.includes('chain')) return `a new chain can stall or its bridge can halt`;
  return `a smart-contract bug can take the deposit`;
}

/**
 * Seven steps for one protocol, each an action with a cost and a time. The
 * plan comes from the protocol's own record — category, chains, TVL and age —
 * never from a hand-written list of names. The weekly action and the risk
 * follow the category; the gas follows the chain; the hold follows the age.
 */
export function farmSteps(p: SnapshotProtocol, age: number | null): FarmStep[] {
  const chain = firstChain(p);
  const capital = stakeFor(p);
  const hold = holdFor(age);
  const gas = gasOn(chain);
  return [
    {
      text: `Use a fresh wallet that holds only the funds you plan to farm, and keep its seed phrase offline.`,
      cost: 'under $3 of gas for the first transaction',
      time: '5 minutes',
    },
    {
      text: enterAction(p, capital, chain),
      cost: `$${capital} of capital and about ${gas.setup} of gas`,
      time: '15 minutes to set up',
    },
    {
      text: weeklyAction(p),
      cost: `about ${gas.weekly} of gas a week`,
      time: '10 minutes a week',
    },
    {
      text: `Hold the position for at least ${hold} days so the activity is counted in more than one snapshot.`,
      cost: `the $${capital} stays in the position`,
      time: `${hold} days`,
    },
    {
      text: `Before you withdraw, open the protocol's own points or rewards page and claim only from the link it publishes.`,
      cost: 'no fee to check, and never pay to claim',
      time: '10 minutes',
    },
    {
      text: `Know the risk before you deposit: ${riskOf(p)}.`,
      cost: 'nothing to read, and only farm what you can lose',
      time: '5 minutes',
    },
    {
      text: `Write the wallet, the dates and every transaction in a farm log so you can repeat the position or unwind it.`,
      cost: 'nothing but the log',
      time: '5 minutes',
    },
  ];
}

// ---------------------------------------------------------------------------
// The live set, the compact rows, and the dataset the dashboard renders.
// ---------------------------------------------------------------------------

/** The live-token protocols, biggest market cap first, for the live view. */
export function liveRows(snapshot: Snapshot): LiveRow[] {
  return snapshot.protocols
    .filter((p) => !isPreToken(p) && p.category !== 'CEX')
    .sort((a, b) => (b.mcap_usd ?? 0) - (a.mcap_usd ?? 0) || b.tvl_usd - a.tvl_usd)
    .slice(0, LIVE_ROWS)
    .map((p) => ({
      slug: p.slug,
      name: p.name,
      category: p.category,
      chains: p.chains,
      tvl_usd: p.tvl_usd,
      mcap_usd: p.mcap_usd,
      change_7d: p.change_7d,
    }));
}

/** A board row shrunk to what data.js carries. */
export function radarRow(row: BoardRow): RadarRow {
  return {
    rank: row.rank,
    slug: row.slug,
    name: row.name,
    category: row.category,
    chains: row.chains,
    tvl_usd: row.tvl_usd,
    change_7d: row.change_7d,
    mcap_usd: row.mcap_usd,
    listed_at: row.listed_at,
    age_days: row.age_days,
    implied_value_usd: row.implied_value_usd,
    category_multiple: row.model.category_multiple,
    comparables_n: row.model.comparables_n,
    growth_multiplier: row.model.growth_multiplier,
    maturity_multiplier: row.model.maturity_multiplier,
    watchlist: row.watchlist,
    farm_steps: row.farm_steps,
  };
}

/** The board and the dataset, from one snapshot. */
export function buildRadar(
  snapshot: Snapshot,
  model: ModelConstants = MODEL,
): { board: BoardRow[]; radar: RadarData } {
  const comparables = categoryMultiples(snapshot, model);
  const board = buildBoard(snapshot, model, comparables);
  const live = liveRows(snapshot);
  const early = board.filter((r) => !snapshot.watchlist.includes(r.slug)).length;
  const radar: RadarData = {
    as_of: snapshot.as_of,
    source: snapshot.source,
    floor_usd: snapshot.floor_usd,
    model,
    model_version: MODEL_VERSION,
    watchlist_size: snapshot.watchlist.length,
    board_size: board.length,
    early_size: early,
    live_size: live.length,
    comparables,
    rows: board.map(radarRow),
    live,
  };
  return { board, radar };
}

// ---------------------------------------------------------------------------
// Reading the snapshot, and the gate the board must pass.
// ---------------------------------------------------------------------------

/** The snapshot out of a file's text, refused unless it is the shape scored. */
export function parseSnapshot(text: string): Snapshot {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    throw new SnapshotError('snapshot.json is not JSON');
  }
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) {
    throw new SnapshotError('snapshot.json is not a JSON object');
  }
  const o = raw as Record<string, unknown>;
  if (typeof o.as_of !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(o.as_of)) {
    throw new SnapshotError('snapshot.json has no as_of date');
  }
  if (typeof o.source !== 'string') throw new SnapshotError('snapshot.json has no source');
  if (typeof o.floor_usd !== 'number' || !Number.isSafeInteger(o.floor_usd) || o.floor_usd <= 0) {
    throw new SnapshotError('snapshot.json has no floor_usd');
  }
  if (!Array.isArray(o.protocols)) throw new SnapshotError('snapshot.json has no protocols array');
  if (!Array.isArray(o.watchlist) || o.watchlist.some((s) => typeof s !== 'string')) {
    throw new SnapshotError('snapshot.json has no watchlist of slugs');
  }
  const protocols = o.protocols.map((v, i) => {
    if (typeof v !== 'object' || v === null || Array.isArray(v)) {
      throw new SnapshotError(`snapshot.json's protocol ${i} is not an object`);
    }
    const p = v as Record<string, unknown>;
    if (
      typeof p.slug !== 'string' ||
      typeof p.name !== 'string' ||
      typeof p.tvl_usd !== 'number' ||
      !Number.isFinite(p.tvl_usd)
    ) {
      throw new SnapshotError(`snapshot.json's protocol ${i} lacks a slug, a name or a TVL`);
    }
    return {
      slug: p.slug,
      name: p.name,
      category: typeof p.category === 'string' ? p.category : null,
      chains: Array.isArray(p.chains)
        ? p.chains.filter((c): c is string => typeof c === 'string')
        : [],
      tvl_usd: p.tvl_usd,
      change_7d:
        typeof p.change_7d === 'number' && Number.isFinite(p.change_7d) ? p.change_7d : null,
      mcap_usd:
        typeof p.mcap_usd === 'number' && Number.isFinite(p.mcap_usd) ? p.mcap_usd : null,
      listed_at: typeof p.listed_at === 'string' ? p.listed_at : null,
      gecko_id: typeof p.gecko_id === 'string' ? p.gecko_id : null,
      symbol: typeof p.symbol === 'string' ? p.symbol : null,
    };
  });
  return {
    as_of: o.as_of,
    source: o.source,
    floor_usd: o.floor_usd,
    protocols,
    watchlist: o.watchlist as string[],
  };
}

/**
 * Why a board is not one the gate will take, or null when it passes: the
 * watchlist must be fully covered, ranks must run 1..n, implied values must
 * not rise down the board, they must not all be equal, every row must carry
 * 3..12 farm steps of 20..600 characters, and every implied value must be a
 * positive safe integer.
 */
export function boardIssue(board: BoardRow[], snapshot: Snapshot): string | null {
  const slugs = new Set(board.map((r) => r.slug));
  const missing = snapshot.watchlist.filter((s) => !slugs.has(s));
  if (missing.length > 0) {
    return `the board misses ${missing.length} watchlist slug${missing.length === 1 ? '' : 's'}: ${missing.slice(0, 5).join(', ')}`;
  }
  const ranks = board.map((r) => r.rank).sort((a, b) => a - b);
  for (let i = 0; i < ranks.length; i++) {
    if (ranks[i] !== i + 1) return `rank ${i + 1} is ${ranks[i]}`;
  }
  for (let i = 1; i < board.length; i++) {
    if (board[i]!.implied_value_usd > board[i - 1]!.implied_value_usd) {
      return `row ${i + 1} outranks row ${i} on implied value`;
    }
  }
  if (
    board.length >= 2 &&
    board[0]!.implied_value_usd === board[board.length - 1]!.implied_value_usd
  ) {
    return `all ${board.length} rows share the same implied value $${board[0]!.implied_value_usd}: a board that ranks nothing by value is not a ranking`;
  }
  for (const r of board) {
    const steps = r.farm_steps;
    if (steps.length < 3 || steps.length > 12) return `${r.slug} has ${steps.length} farm steps`;
    for (const s of steps) {
      if (s.length < 20 || s.length > 600) return `${r.slug} has a farm step of ${s.length} characters`;
    }
    if (!Number.isSafeInteger(r.implied_value_usd) || r.implied_value_usd <= 0) {
      return `${r.slug} has implied value ${r.implied_value_usd}`;
    }
  }
  return null;
}

/** The dashboard's dataset as one script: no fetch, no network. */
export function dataScript(radar: RadarData): string {
  return `window.RADAR=${JSON.stringify(radar)};\n`;
}

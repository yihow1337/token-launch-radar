/* Token Launch Radar - the value model.   radar-curve-2
 *
 * One DefiLlama snapshot in; the protocols that record no token out, ranked by an implied value,
 * each with a rank range, a farm plan priced step by step, and a verdict that nets the airdrop it
 * expects against what that farm costs.
 *
 *     log10 V = a + b × log10(TVL / $100M) + family/category offset + momentum + no-token clock
 *
 * Every term is fitted on the snapshot's own clean comps and measured out of sample here, and the
 * page prints what this file computed: fitCurve() the Huber curve (b < 1, so the multiple falls as
 * TVL rises), fitAll() the offsets (shrunk with k = 8; a category needs 3 comps of its own before
 * it may price itself), fitClock() the share of protocols of each age that still record no token,
 * ablation() every term in turn against leave-one-out and a split in time, bootstrapRanks() the
 * rank range over 40 refits on resampled comps, farmPlan() the costed plan and its verdict.
 *
 * No protocol is named here: the rules read category strings, chain names, TVL, the 7-day change
 * and the listing date. "Records no token" is the snapshot's own wording and all it means - no
 * CoinGecko id, no ticker, no market cap. Not a promise of a token, and none of it is advice.
 * main.ts runs this file in node:vm to write board.json; the page runs it as a plain script and
 * checks its board against the seal main.ts wrote. No network, no clock, no randomness: same bytes
 * in, same bytes out.
 */
(function (root) {
'use strict';

/* Every constant the model has, printed in the Model tab as it stands. A bucket needs ~8 comps of
   its own to outweigh its parent (shrink_k) and 3 before it prices itself (min_cat_comps); none may
   move a value over 0.6 dex. The farm side assumes 7.5% of implied value goes to a community
   airdrop by deposit share, on a $1,000 deposit never over 0.01% of TVL, against the 4.5% it would
   have earned in T-bills; FARM wants the drop to cover its costs twice over. */
var C = {
  version: 'radar-curve-2',
  pivot_usd: 1e8, huber_c: 1.345, irls_steps: 12,
  shrink_k: 8, min_cat_comps: 3, offset_clamp: 0.6,
  growth_floor: -40, growth_cap: 60, growth_power: 0.5,
  clock_floor: 0.8, clock_span: 0.4, clock_damp: 0.5, clock_min_tvl: 5e6,
  band_lo: 0.10, band_hi: 0.90, boot_refits: 40, boot_seed: 20261114,
  airdrop_share: 0.075, deposit_usd: 1000, tbill_apy: 0.045,
  max_pos_share: 0.0001, min_deposit_usd: 100, farm_ratio: 2
};

/* --- numeric helpers --- */

function clamp(x, lo, hi) { return x < lo ? lo : x > hi ? hi : x; }
function asc(a, b) { return a - b; }
function cmpStr(a, b) { return a < b ? -1 : a > b ? 1 : 0; }
function round(x, n) { var p = Math.pow(10, n); return Math.round(x * p) / p; }
function log10(x) { return Math.log(x) / Math.LN10; }
function sorted(v) { return v.slice().sort(asc); }
function quantile(v, f) {
  if (!v.length) return 0;
  var i = f * (v.length - 1), lo = Math.floor(i), hi = Math.ceil(i);
  return v[lo] + (v[hi] - v[lo]) * (i - lo);
}
function median(v) { return quantile(v, 0.5); }

function ageDays(asOf, listed) {
  var a = Date.parse(asOf + 'T00:00:00Z'), b = listed ? Date.parse(listed + 'T00:00:00Z') : NaN;
  return isFinite(a) && isFinite(b) ? Math.max(0, Math.floor((a - b) / 86400000)) : null;
}

function spearman(xs, ys) {
  function ranks(v) {
    var idx = v.map((_, i) => i).sort((a, b) => v[a] - v[b] || a - b), r = [], i = 0, j, t;
    while (i < idx.length) {
      for (j = i; j + 1 < idx.length && v[idx[j + 1]] === v[idx[i]];) j++;
      for (t = i; t <= j; t++) r[idx[t]] = (i + j) / 2 + 1;
      i = j + 1;
    }
    return r;
  }
  var a = ranks(xs), b = ranks(ys), n = a.length, i, ma = 0, mb = 0, p = 0, da = 0, db = 0, u, v;
  if (n < 2) return 0;
  for (i = 0; i < n; i++) { ma += a[i] / n; mb += b[i] / n; }
  for (i = 0; i < n; i++) { u = a[i] - ma; v = b[i] - mb; p += u * v; da += u * u; db += v * v; }
  return da > 0 && db > 0 ? p / Math.sqrt(da * db) : 0;
}

/** Seeded PRNG (mulberry32): the same resample on every machine, every run. */
function prng(seed) {
  var s = seed >>> 0;
  return function () {
    s = (s + 0x6d2b79f5) >>> 0;
    var t = Math.imul(s ^ (s >>> 15), 1 | s);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** 32-bit FNV-1a of the board's rows: data.js carries it, the page recomputes and compares. */
function seal(rows) {
  var s = rows.map((r) => r.slug + '|' + r.rank + '|' + r.implied_value_usd + '|' + r.verdict).join(';');
  for (var h = 0x811c9dc5, i = 0; i < s.length; i++) h = Math.imul(h ^ (s.charCodeAt(i) & 255), 0x01000193) >>> 0;
  return ('0000000' + (h >>> 0).toString(16)).slice(-8);
}

/* --- the universe split --- */

function isPreToken(p) { return p.gecko_id === null && p.symbol === null; }
function isLive(p) { return !isPreToken(p) && typeof p.mcap_usd === 'number' && p.mcap_usd > 0 && p.tvl_usd > 0; }

// A wrapper, a bridge or a versioned pool of a token that already trades is not a launch of its
// own: set aside with its reason rather than ranked, and never used as a comp.
var ASIDE_CATEGORIES = {
  'Bridge': 'bridges another chain’s asset', 'Canonical Bridge': 'a chain’s canonical bridge',
  'Cross Chain Bridge': 'a cross-chain bridge', 'Liquid Staking': 'a staking wrapper',
  'Liquid Restaking': 'a restaking wrapper', 'Restaked BTC': 'restaked BTC, not a protocol',
  'CEX': 'a centralised exchange'
};
var VERSIONED = /\s(V\d+(\.\d+)?|v\d+(\.\d+)?|\d+\.\d+)$/;
var WRAPPED_WORD = /\b(wrapped|staked|staking)\b/i;
var EXCHANGE_PREFIX = /^(Binance|Coinbase|Bybit|Kraken|Bitget|OKX|Bitfinex|Gemini)\b/;

/** Why a protocol is a derivative of one that already trades, or null: the house's own rule. */
function asideReason(p) {
  if (p.category && ASIDE_CATEGORIES[p.category]) return 'Category ' + p.category + ': ' + ASIDE_CATEGORIES[p.category] + '.';
  if (VERSIONED.test(p.name)) return 'Version marker in the name: a release of another protocol.';
  if (WRAPPED_WORD.test(p.name)) return 'Wrapped, staked or staking: a product of an asset that trades.';
  if (EXCHANGE_PREFIX.test(p.name)) return 'An exchange’s name: its own product, not a protocol.';
  return null;
}

/* --- families: five buckets off the category string alone, never a protocol name --- */

var FAMILIES = [
  { key: 'lending', label: 'Lending & credit', cats: 'Lending|CDP|CDP Manager|Uncollateralized Lending|Collateral Management|Collateral Markets' },
  { key: 'trading', label: 'Trading & markets', cats: 'Dexs|Derivatives|Options|Prediction Market|Interest Rate Derivatives|OTC Marketplace|NFT Marketplace|Launchpad|DOR' },
  { key: 'vaults', label: 'Vaults & yield', cats: 'Yield|Yield Aggregator|Onchain Capital Allocator|Risk Curators|Basis Trading|Liquidity Manager|Farm|Leveraged Farming|Indexes|Governance Incentives|Staking Pool|Token Locker' },
  { key: 'stable', label: 'Stable & RWA', cats: 'RWA|Stablecoin Wrapper|Dual-Token Stablecoin|CeDeFi|Payments|Crypto Card Issuer' },
  { key: 'infra', label: 'Infra & other', cats: 'Chain|Restaking|Privacy|Decentralized AI|AI Agents|Anchor BTC|Decentralized BTC|Insurance' }
];
var FAMILY_OF = {}, FAMILY_LABEL = {};
FAMILIES.forEach(function (f) {
  FAMILY_LABEL[f.key] = f.label;
  f.cats.split('|').forEach(function (c) { FAMILY_OF[c] = f.key; });
});
function familyOf(cat) { return (cat && FAMILY_OF[cat]) || 'infra'; }

/* --- the no-token clock, fitted over the whole snapshot --- */

var BUCKETS = [[180, 'under 180 days'], [365, '180 d to 1 yr'], [730, '1 to 2 yr'], [1095, '2 to 3 yr'], [Infinity, 'over 3 yr']];
var UNKNOWN_BUCKET = 2;    // no listing date: the middle bucket, and the row carries a flag

function bucketOf(age) {
  if (age === null) return UNKNOWN_BUCKET;
  for (var i = 0; i < BUCKETS.length - 1; i++) if (age < BUCKETS[i][0]) return i;
  return BUCKETS.length - 1;
}

/** How many protocols of each age still record no token, and what that is worth. */
function fitClock(protocols, asOf) {
  var rows = BUCKETS.map((b) => ({ label: b[1], n: 0, with_token: 0 }));
  protocols.forEach(function (p) {
    var a = ageDays(asOf, p.listed_at);
    if (a === null || p.tvl_usd < C.clock_min_tvl || asideReason(p) !== null) return;
    var r = rows[bucketOf(a)];
    r.n++;
    if (!isPreToken(p)) r.with_token++;
  });
  var free = rows.map((r) => (r.n ? 1 - r.with_token / r.n : 0)), base = free[0] || 1;
  rows.forEach(function (r, i) {
    r.share_token = r.n ? round(r.with_token / r.n, 4) : null;      // and 1 - that still records none
    r.factor = round(Math.pow(C.clock_floor + C.clock_span * (free[i] / base), C.clock_damp), 4);
  });
  return rows;
}

/* --- the fit: a robust curve, then offsets on what it leaves behind --- */

/** Huber IRLS of y on x: least squares hands the slope to the three $1B outliers. */
function fitCurve(cs) {
  var n = cs.length, w = [], r = [], i, it, a = 0, b = 0, s = 1, sw, sx, sy, sxx, sxy, u, den;
  for (i = 0; i < n; i++) w[i] = 1;
  for (it = 0; it < C.irls_steps; it++) {
    sw = sx = sy = sxx = sxy = 0;
    for (i = 0; i < n; i++) { u = w[i]; sw += u; sx += u * cs[i].x; sy += u * cs[i].y; sxx += u * cs[i].x * cs[i].x; sxy += u * cs[i].x * cs[i].y; }
    den = sw * sxx - sx * sx;
    if (!(den > 0)) break;
    b = (sw * sxy - sx * sy) / den; a = (sy - b * sx) / sw;
    for (i = 0; i < n; i++) r[i] = cs[i].y - a - b * cs[i].x;
    s = median(sorted(r.map(Math.abs))) / 0.6745;
    if (!(s > 0)) break;
    for (i = 0; i < n; i++) { u = Math.abs(r[i]) / s; w[i] = u <= C.huber_c ? 1 : C.huber_c / u; }
  }
  return { a: a, b: b, sigma: s, resid: r };
}

/** One set of comps in: flat baseline, curve, shrunk offsets on its residuals. */
function fitAll(cs) {
  var f = fitCurve(cs), k = C.shrink_k, cl = C.offset_clamp, byF = {}, byC = {}, i, c;
  for (i = 0; i < cs.length; i++) {
    c = cs[i];
    (byF[c.fam] = byF[c.fam] || []).push(f.resid[i]);
    if (c.cat) (byC[c.cat] = byC[c.cat] || []).push(f.resid[i]);
  }
  var of = {}, oc = {}, nf = {}, nc = {}, rawF = {}, rawC = {};
  // shrunk toward the parent: a bucket of n moves the parent's offset n/(n+k) of the way
  function shrink(by, off, n_, raw, parent, min) {
    Object.keys(by).forEach(function (key) {
      var v = sorted(by[key]), n = v.length, m = median(v);
      n_[key] = n; raw[key] = m;
      if (n >= min) off[key] = clamp((n * m + k * parent(key)) / (n + k), -cl, cl);
    });
  }
  shrink(byF, of, nf, rawF, () => 0, 1);
  shrink(byC, oc, nc, rawC, (key) => of[familyOf(key)] || 0, C.min_cat_comps);
  return {
    n: cs.length, a: f.a, b: f.b, sigma: f.sigma, of: of, oc: oc, nf: nf, nc: nc, rawF: rawF, rawC: rawC,
    flat: median(sorted(cs.map((x) => x.y - x.t)))
  };
}

function offsetOf(F, cat) { return cat && F.oc[cat] !== undefined ? F.oc[cat] : F.of[familyOf(cat)] || 0; }

function growthOf(g) { return clamp(typeof g === 'number' && isFinite(g) ? g : 0, C.growth_floor, C.growth_cap); }

/** All the model sees of a protocol: TVL, category, 7-day change, age. */
function inputOf(p, asOf) {
  var age = ageDays(asOf, p.listed_at), t = log10(Math.max(1, p.tvl_usd));
  return { t: t, x: t - 8, cat: p.category, fam: familyOf(p.category), g: growthOf(p.change_7d), bk: bucketOf(age), age: age };
}

/** log10 implied value at level 0 flat, 1 curve, 2 offsets, 3 momentum, 4 clock. */
function impliedLog(F, o, level, clock) {
  if (level === 0) return F.flat + o.t;
  var v = F.a + F.b * o.x;
  if (level >= 2) v += offsetOf(F, o.cat);
  if (level >= 3) v += C.growth_power * log10(1 + o.g / 100);
  if (level >= 4) v += log10(clock[o.bk].factor);
  return v;
}

function walk(F, o, tvl, clock) {
  var size = Math.pow(10, F.a + F.b * o.x) / Math.max(1, tvl), off = Math.pow(10, offsetOf(F, o.cat));
  var mom = Math.pow(1 + o.g / 100, C.growth_power), clk = clock[o.bk].factor;
  return { size: size, offset: off, momentum: mom, clock: clk, mult: size * off * mom * clk };
}

/* --- out of sample: leave one out, and a split in time --- */

function stats(pred, act) {
  var e = sorted(pred.map((p, i) => Math.abs(log10(p / act[i])))), lim = log10(3), w = 0, i;
  for (i = 0; i < e.length; i++) if (e[i] <= lim) w++;
  return { n: e.length, median_x: round(Math.pow(10, median(e)), 3), within_3x: round(e.length ? w / e.length : 0, 4), spearman: round(spearman(pred, act), 4) };
}

var LEVELS = ['Flat multiple × TVL', '+ size curve', '+ family & category offsets', '+ 7-day momentum', '+ no-token clock'];

/** Every term in turn, twice over: leave-one-out, and fit-on-old/test-on-new. */
function ablation(cs, clock) {
  var L = LEVELS.length, loo = LEVELS.map(() => []), act = cs.map((c) => c.mcap), i, lv, F;
  for (i = 0; i < cs.length; i++) {
    F = fitAll(cs.slice(0, i).concat(cs.slice(i + 1)));
    for (lv = 0; lv < L; lv++) loo[lv].push(Math.pow(10, impliedLog(F, cs[i], lv, clock)));
  }
  var dated = cs.filter((c) => !!c.listed).sort((a, b) => cmpStr(a.listed, b.listed) || cmpStr(a.slug, b.slug));
  var cut = dated.length ? dated[Math.floor(dated.length / 2)].listed : null;
  var tr = dated.filter((c) => c.listed < cut), te = dated.filter((c) => c.listed >= cut);
  var G = tr.length >= 10 ? fitAll(tr) : null, tAct = te.map((c) => c.mcap);
  var levels = LEVELS.map((label, lv) => ({
    term: label, loo: stats(loo[lv], act),
    split: G ? stats(te.map((c) => Math.pow(10, impliedLog(G, c, lv, clock))), tAct) : null
  }));
  // The band is the model's own miss: the 10th-90th percentile of the leave-one-out residuals.
  var res = sorted(loo[L - 1].map((p, i) => log10(act[i] / p)));
  return { levels: levels, split: { cut: cut, n_fit: tr.length, n_test: te.length }, band: { lo: round(quantile(res, C.band_lo), 4), hi: round(quantile(res, C.band_hi), 4) } };
}

/** 40 refits on comps resampled with replacement: how much of a rank is fit noise. */
function bootstrapRanks(cs, clock, inputs) {
  var rnd = prng(C.boot_seed), n = cs.length, seen = inputs.map(() => []), b, i, draw, F, order;
  for (b = 0; b < C.boot_refits; b++) {
    for (draw = [], i = 0; i < n; i++) draw.push(cs[Math.floor(rnd() * n) % n]);
    F = fitAll(draw);
    order = inputs.map((o, j) => ({ j: j, v: impliedLog(F, o, 4, clock), t: o.t }));
    order.sort((x, y) => y.v - x.v || y.t - x.t || x.j - y.j);
    for (i = 0; i < order.length; i++) seen[order[i].j].push(i + 1);
  }
  return seen.map(function (v) {
    var s = sorted(v);
    return [Math.round(quantile(s, C.band_lo)), Math.round(quantile(s, C.band_hi))];
  });
}

/* --- farm plans, priced step by step --- */

// One transaction's ordinary cost by chain, not a worst case. The plan runs on the cheapest chain
// the protocol is on, and every cost below is a number these make.
var GAS = [
  { lo: 0.01, hi: 0.01, chains: 'Solana' },
  { lo: 0.02, hi: 0.10, chains: 'Base|Arbitrum|Optimism|Ink|Unichain|Linea|Scroll|Blast|Mode|Soneium|World Chain|zkSync Era|Mantle|Taiko|Zircuit|Fraxtal|Swellchain|Manta|Morph|BOB|Metis|Lisk|Op_Bnb|Polygon zkEVM|X Layer' },
  { lo: 0.10, hi: 0.10, chains: 'Binance|Polygon|Avalanche|Sonic|Celo|Fantom|Kava|Cronos' },
  { lo: 1, hi: 2, chains: 'Tron' }, { lo: 1, hi: 5, chains: 'Bitcoin' }, { lo: 2, hi: 6, chains: 'Ethereum' }
];
var GAS_OF = {}, GAS_DEFAULT = { lo: 0.05, hi: 0.50 };
GAS.forEach(function (g) { g.chains.split('|').forEach(function (c) { GAS_OF[c] = g; }); });

function money(x) { return x >= 100 ? '$' + Math.round(x).toLocaleString('en-US') : '$' + (x > 0 && x < 0.01 ? 0.01 : x).toFixed(2); }
function bigUsd(x) { return x >= 1e9 ? '$' + round(x / 1e9, 2) + 'B' : '$' + Math.round(x / 1e6) + 'M'; }
function hours(h) { return h < 1 ? Math.round(h * 60) + ' min' : round(h, 1) + ' h'; }
function weekly(h, w) { return Math.round(h * 60 / w) + ' min a week for ' + w + ' weeks'; }

function pickChain(chains) {
  var best = null, g = GAS_DEFAULT, i, c;
  for (i = 0; i < (chains || []).length; i++) {
    c = GAS_OF[chains[i]] || GAS_DEFAULT;
    if (best === null || c.hi < g.hi || (c.hi === g.hi && c.lo < g.lo)) { best = chains[i]; g = c; }
  }
  return { chain: best, tx: (g.lo + g.hi) / 2 };
}

function on(chain) { return chain ? ' on ' + chain : ''; }
function holdFor(age) { return age === null ? 60 : age < 180 ? 90 : age < 365 ? 75 : age < 730 ? 60 : 45; }

/** The two steps that make the position, by family. usd is gas and fees, hr is hours. */
function actionsFor(r, chain, dep, tx, hold) {
  var cat = r.category, d = money(dep), nm = r.name, at = on(chain), wk = Math.round(hold / 7);
  if (r.family === 'lending') return [
    { a: 'Supply ' + d + ' of USDC as collateral to ' + nm + at + ', from its own app.', usd: 2 * tx, cn: 'of gas, two transactions', hr: 0.25 },
    { a: 'Borrow back 30% at most in a stable, health factor over 2, one loop: a liquidation costs more than any airdrop pays.', usd: 2 * tx + dep * 0.024 * hold / 365, cn: 'of gas, 8% a year on the borrowed leg', hr: 0.25 }
  ];
  if (cat === 'Prediction Market') return [
    { a: 'Fund ' + d + at + ' and take positions in several of ' + nm + '’s markets: it counts markets traded, not dollars parked.', usd: 4 * tx + dep * 0.01, cn: 'of gas, ~1% of spread', hr: 0.5 },
    { a: 'Trade through resolution and claim: a resolved market reads as use, an open one as nothing.', usd: 4 * tx, cn: 'of gas, four settlements', hr: 0.4 }
  ];
  if (cat === 'Derivatives' || cat === 'Options' || cat === 'Interest Rate Derivatives') return [
    { a: 'Deposit ' + d + ' as margin on ' + nm + at + ' and run it delta-neutral: a long against an equal short.', usd: 3 * tx + dep * 0.0008, cn: 'of gas, 0.04% of taker fee a side', hr: 0.4 },
    { a: 'Turn the margin over weekly rather than parking it: a perp venue weights volume and open days. Leverage 2x or under.', usd: (dep * 0.0008 + tx) * wk, cn: 'of taker fees and gas, funding aside', hr: 0.25 * wk, tn: weekly(0.25 * wk, wk) }
  ];
  if (r.family === 'trading') return [
    { a: 'Add ' + d + ' to the deepest stable pair ' + nm + ' runs' + at + ', or route ' + d + ' of swap volume weekly if it runs no pools.', usd: 3 * tx + dep * 0.002, cn: 'of gas, 0.1% of fee a round trip', hr: 0.33 },
    { a: 'Keep it in range and log the volume through it: a venue counts weeks of flow, one swap is not. Re-balance past 5% of drift.', usd: 4 * tx, cn: 'of gas, two re-balances', hr: 0.33 }
  ];
  if (r.family === 'vaults') return [
    { a: 'Deposit ' + d + ' into the ' + nm + ' vault' + at + ' with the longest live record, not the highest yield.', usd: 2 * tx, cn: 'of gas; the performance fee is taken from the yield', hr: 0.25 },
    { a: 'Read the curator’s allocation page weekly and log the points. Withdraw if the mandate changes or it concentrates.', usd: tx, cn: 'of gas to withdraw', hr: 0.17 * wk, tn: weekly(0.17 * wk, wk) }
  ];
  if (r.family === 'stable') {
    var kyc = cat === 'RWA' || cat === 'CeDeFi' || cat === 'Crypto Card Issuer';
    return [
      { a: 'Mint or deposit ' + d + ' into ' + nm + '’s own stable or yield-bearing asset' + at + '.' + (kyc ? ' This category gates the mint behind KYC: a passport, a selfie, 1-3 business days.' : ''), usd: 2 * tx, cn: 'of gas' + (kyc ? ', nothing for the KYC' : ''), hr: kyc ? 0.75 : 0.25 },
      { a: 'Read the redemption window before you size up, and hold rather than sell: these settle on a queue, not a swap.', usd: tx + dep * 0.002, cn: 'of gas, up to 0.2% to redeem', hr: 0.25, tn: 'instant to 5 business days' }
    ];
  }
  return [
    { a: 'Bridge in, then delegate or restake ' + d + ' of the asset ' + nm + ' secures' + at + ', receipt token kept in the wallet.', usd: 3 * tx + dep * 0.001, cn: 'of gas, 0.1% of bridge fee', hr: 0.4 },
    { a: 'Add in three tranches, not one lump: an infrastructure snapshot counts repeated use, one deposit is not.', usd: 3 * tx, cn: 'of gas, three tranches', hr: 0.33 }
  ];
}

/** One plan at a deposit of D: seven costed steps, totals, and the verdict netting them. */
function farmPlan(r, D, share) {
  var pick = pickChain(r.chains), chain = pick.chain, tx = pick.tx, n = r.chains.length;
  var dep = Math.min(D, Math.max(C.min_deposit_usd, Math.floor(r.tvl_usd * C.max_pos_share / 50) * 50));
  var hold = holdFor(r.age_days), wk = Math.round(hold / 7), age = r.age_days;
  var why = !chain ? 'No chain is named for it, so budget a mid-priced L2 at about ' + money(tx) + ' a transaction.'
    : (n === 1 ? chain + ' is the only chain ' : chain + ' is the cheapest of the ' + n + ' chains ') + r.name + ' runs on, about ' + money(tx) + ' a transaction.';
  var acts = actionsFor(r, chain, dep, tx, hold);
  var steps = [
    { a: 'Fund a fresh wallet holding only this position, seed phrase offline, never pasted into a site. ' + why, usd: tx, cn: 'of gas to fund it', hr: 0.25 },
    { a: 'Size it at ' + money(dep) + (dep < D ? ', all that 0.01% of its ' + bigUsd(r.tvl_usd) + ' of TVL allows' : ', never above 0.01% of its ' + bigUsd(r.tvl_usd) + ' of TVL') + ', held in USDC' + on(chain) + ' first.', usd: dep * 0.001, cn: 'of bridge fee, and ' + money(dep) + ' of capital at risk', hr: 0.33 },
    acts[0], acts[1],
    { a: 'Do one qualifying action a week - a top-up, a repayment, a swap, a vote - so it reads as use, not a parked deposit.', usd: tx * wk, cn: 'of gas, one transaction a week', hr: 0.17 * wk, tn: weekly(0.17 * wk, wk) },
    { a: 'Hold at least ' + hold + ' days' + (age === null ? ', longer if you can: no listing date is recorded, so treat it as young' : age < 365 ? ': it has recorded no token for only ' + age + ' days, so its snapshot is probably ahead' : ': it has run ' + age + ' days with no token, so a snapshot may already be taken') + '.', usd: 0, cn: 'in fees; the cost is the yield the ' + money(dep) + ' gives up', hr: 0, tn: hold + ' days of waiting, no attention' },
    { a: 'Claim through the protocol’s own site or pinned account only. Never pay to claim, never sign a blind approval, never open a claim link someone sent you: an airdrop that charges is a theft.', usd: 3 * tx, cn: 'of gas to unwind and claim, nothing else, ever', hr: 0.5 }
  ];
  var fees = 0, hrs = 0;
  steps.forEach(function (s) { fees += s.usd; hrs += s.hr; });
  var opp = dep * C.tbill_apy * hold / 365;                 // the T-bill yield the deposit gives up
  var drop = r.tvl_usd > 0 ? r.implied_value_usd * share * dep / r.tvl_usd : 0;
  var cost = fees + opp, net = drop - cost;
  return {
    chain: chain, gas_per_tx: round(tx, 4), deposit_usd: dep, capped: dep < D, hold_days: hold,
    share: share, weeks: wk, fees_usd: round(fees, 2), opportunity_usd: round(opp, 2),
    cost_usd: round(cost, 2), drop_usd: round(drop, 2), net_usd: round(net, 2),
    hands_on_hours: round(hrs, 2), net_per_hour_usd: round(hrs > 0 ? net / hrs : 0, 2),
    verdict: net > 0 && drop >= C.farm_ratio * cost ? 'FARM' : net > 0 ? 'MARGINAL' : 'SKIP',
    steps: steps.map((s) => ({ action: s.a, cost: money(s.usd) + ' ' + s.cn, time: s.tn || hours(s.hr), cost_usd: round(s.usd, 2), hours: round(s.hr, 2) }))
  };
}

function stepText(s) {
  var t = s.action + ' Cost: ' + s.cost + '. Time: ' + s.time + '.';
  return t.length > 600 ? t.slice(0, 597) + '…' : t;
}

/* --- build it all --- */

/** The five comps nearest a row in log TVL inside its family: the fit's miss on neighbours. */
function peersFor(radar, row, n) {
  var pool = radar.comps.filter((c) => c.family === row.family);
  if (pool.length < 3) pool = radar.comps;
  var t = log10(Math.max(1, row.tvl_usd));
  return pool.slice().sort(function (a, b) {
    return Math.abs(log10(a.tvl_usd) - t) - Math.abs(log10(b.tvl_usd) - t) || b.mcap_usd - a.mcap_usd || cmpStr(a.slug, b.slug);
  }).slice(0, n || 5);
}

/** The whole radar from one snapshot: the board, its comps, the evidence either way. */
function buildRadar(snapshot, opts) {
  var asOf = snapshot.as_of, watch = {}, o = opts || {};
  var D = o.deposit || C.deposit_usd, share = o.share || C.airdrop_share;
  (snapshot.watchlist || []).forEach(function (s) { watch[s] = true; });

  // One pass: comps, rankable pre-token rows, and whatever a rule sets aside, with its reason.
  var groups = {}, order = [], aside = [], rankable = [];
  snapshot.protocols.forEach(function (p) {
    var why = asideReason(p), pre = isPreToken(p);
    if (why !== null && !(pre && watch[p.slug])) {
      if (pre || isLive(p)) aside.push({ p: p, why: why, live: !pre });
      return;
    }
    if (pre) { rankable.push(p); return; }             // a watchlist slug is ranked, rule or no rule
    if (!isLive(p)) return;                            // a token exists, but with no market cap
    var key = p.gecko_id || p.symbol, g = groups[key];
    if (!g) { g = groups[key] = { head: p, tvl: 0, mcap: 0, rows: 0 }; order.push(key); }
    g.tvl += p.tvl_usd; g.rows++;
    if (p.mcap_usd > g.mcap) g.mcap = p.mcap_usd;
    if (p.tvl_usd > g.head.tvl_usd) g.head = p;
  });
  var cs = order.map(function (key) {
    var g = groups[key], p = g.head, i = inputOf(p, asOf);
    i.t = log10(Math.max(1, g.tvl)); i.x = i.t - 8; i.y = log10(g.mcap);  // the group's TVL, not the row's
    i.slug = p.slug; i.name = p.name; i.chains = p.chains; i.listed = p.listed_at;
    i.d7 = p.change_7d; i.rows = g.rows; i.mcap = g.mcap; i.tvl = g.tvl;
    return i;
  }).sort((a, b) => b.tvl - a.tvl || cmpStr(a.slug, b.slug));

  var clock = fitClock(snapshot.protocols, asOf), F = fitAll(cs), ab = ablation(cs, clock);

  var scored = rankable.map(function (p) {
    var i = inputOf(p, asOf), w = walk(F, i, p.tvl_usd, clock);
    return { p: p, o: i, w: w, implied: Math.max(1, Math.round(p.tvl_usd * w.mult)) };
  });
  // Implied, then TVL, then slug: every tie breaks the same way on every run.
  scored.sort((a, b) => b.implied - a.implied || b.p.tvl_usd - a.p.tvl_usd || cmpStr(a.p.slug, b.p.slug));
  var ranges = bootstrapRanks(cs, clock, scored.map((x) => x.o));

  var board = scored.map(function (x, i) {
    var p = x.p, w = x.w, nCat = F.nc[p.category] || 0, nFam = F.nf[x.o.fam] || 0;
    var both = x.o.age !== null && p.change_7d !== null;
    var r = {
      rank: i + 1, rank_lo: ranges[i][0], rank_hi: ranges[i][1],
      slug: p.slug, name: p.name, category: p.category, chains: p.chains, family: x.o.fam,
      tvl_usd: p.tvl_usd, change_7d: p.change_7d, age_days: x.o.age, age_bucket: x.o.bk,
      watchlist: !!watch[p.slug], above_floor: p.tvl_usd >= snapshot.floor_usd,
      implied_value_usd: x.implied,
      implied_low_usd: Math.max(1, Math.round(x.implied * Math.pow(10, ab.band.lo))),
      implied_high_usd: Math.max(1, Math.round(x.implied * Math.pow(10, ab.band.hi))),
      peer_multiple: round(w.mult, 4), size_multiple: round(w.size, 4), offset_factor: round(w.offset, 4),
      momentum_factor: round(w.momentum, 4), momentum_pct: round(x.o.g, 4), clock_factor: round(w.clock, 4),
      comps_in_category: nCat, comps_in_family: nFam,
      confidence: nCat >= C.min_cat_comps && both ? 'High' : nFam >= 8 && (both || x.o.age !== null) ? 'Medium' : 'Low',
      flags: [].concat(
        p.change_7d === null ? ['no 7-day change recorded: counted flat'] : [],
        x.o.age === null ? ['no listing date recorded: counted in the ' + BUCKETS[UNKNOWN_BUCKET][1] + ' bucket'] : [],
        nCat < C.min_cat_comps ? [nCat + ' comp' + (nCat === 1 ? '' : 's') + ' in its category, under the ' + C.min_cat_comps + ' an offset needs: priced off its family'] : [],
        watch[p.slug] && asideReason(p) ? ['on the watchlist, so ranked though a set-aside rule touches it'] : [])
    };
    r.farm = farmPlan(r, D, share);
    ['verdict', 'drop_usd', 'cost_usd', 'net_usd', 'hands_on_hours', 'net_per_hour_usd'].forEach((k) => { r[k] = r.farm[k]; });
    r.farm_steps = r.farm.steps.map(stepText);
    return r;
  });

  var compRows = cs.map(function (c) {
    var curve = Math.round(Math.pow(10, impliedLog(F, c, 4, clock)));
    return {
      slug: c.slug, name: c.name, category: c.cat, family: c.fam, chains: c.chains, rows: c.rows,
      tvl_usd: c.tvl, mcap_usd: c.mcap, change_7d: c.d7, age_days: c.age, ratio: round(c.mcap / c.tvl, 4),
      curve_usd: curve, miss_x: round(Math.pow(10, Math.abs(log10(curve / c.mcap))), 2)
    };
  }).sort((a, b) => b.mcap_usd - a.mcap_usd || cmpStr(a.slug, b.slug));
  var asideRows = aside.map(function (x) {
    return { slug: x.p.slug, name: x.p.name, category: x.p.category, family: familyOf(x.p.category), chains: x.p.chains, tvl_usd: x.p.tvl_usd, has_token: x.live, reason: x.why };
  }).sort((a, b) => b.tvl_usd - a.tvl_usd || cmpStr(a.slug, b.slug));

  // What the Model tab prints: raw median residual, how far k = 8 shrinks it, rows priced.
  var families = FAMILIES.map(function (f) {
    var n = F.nf[f.key] || 0, off = F.of[f.key] || 0;
    return { key: f.key, label: f.label, n: n, raw: n ? round(F.rawF[f.key], 4) : null, offset: round(off, 4), factor: round(Math.pow(10, off), 4), rows: board.filter((r) => r.family === f.key).length };
  });
  var cats = Object.keys(F.nc).map((c) => ({ category: c, family: familyOf(c), n: F.nc[c], own: F.oc[c] !== undefined, factor: round(Math.pow(10, offsetOf(F, c)), 4) }))
    .sort((a, b) => b.n - a.n || cmpStr(a.category, b.category));

  var verdicts = { FARM: 0, MARGINAL: 0, SKIP: 0 };
  board.forEach((r) => { verdicts[r.verdict]++; });

  return {
    as_of: asOf, source: snapshot.source, floor_usd: snapshot.floor_usd, model_version: C.version,
    deposit_usd: D, airdrop_share: share,
    fit: { n: F.n, a: round(F.a, 4), b: round(F.b, 4), sigma: round(F.sigma, 4), pivot_usd: C.pivot_usd, pivot_value_usd: Math.round(Math.pow(10, F.a)), flat_multiple: round(Math.pow(10, F.flat), 4) },
    families: families, categories: cats, clock: clock, family_labels: FAMILY_LABEL,
    ablation: ab.levels, split: ab.split, band: ab.band,
    board: board, comps: compRows, aside: asideRows, seal: seal(board),
    kpis: {
      watchlist_size: (snapshot.watchlist || []).length,
      watchlist_covered: (snapshot.watchlist || []).filter((s) => board.some((r) => r.slug === s)).length,
      board_size: board.length, early_size: board.filter((r) => !r.above_floor).length,
      comps_size: cs.length, comp_rows: cs.reduce((a, c) => a + c.rows, 0), aside_size: asideRows.length,
      farm: verdicts.FARM, marginal: verdicts.MARGINAL, skip: verdicts.SKIP,
      implied_total_usd: board.reduce((a, r) => a + r.implied_value_usd, 0),
      net_total_usd: round(board.reduce((a, r) => a + r.net_usd, 0), 2)
    }
  };
}

root.RadarModel = { VERSION: C.version, CONSTANTS: C, FAMILIES: FAMILIES, BUCKETS: BUCKETS, buildRadar: buildRadar, peersFor: peersFor, farmPlan: farmPlan, stepText: stepText, seal: seal };
})(typeof globalThis !== 'undefined' ? globalThis : this);

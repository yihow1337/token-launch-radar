/* Token Launch Radar - the value model.   radar-comps-1
 *
 * One snapshot of DefiLlama's protocol index in; a ranked board of the protocols that record no token
 * out, each with an implied value, a confidence and a farm plan. This file is the whole model. main.ts
 * loads it in node:vm to write board.json, and the page loads it as a plain script and recomputes the
 * same numbers from the same raw snapshot, so the board and the screen cannot disagree.
 *
 *     implied value  =  TVL  x  peer multiple  x  momentum  x  no-token runway
 *
 * Every input is a field the snapshot already carries, and no protocol is named anywhere here: the rules
 * read category strings, chain names, TVL, the 7-day change and the listing date, and nothing else.
 *
 * "Records no token" is the snapshot's own wording and all it means - DefiLlama holds no CoinGecko id,
 * no ticker, no market cap. It is not a promise that a token is coming, and nothing here is advice.
 *
 * Classic script, no modules, no network, no clock, no randomness: same bytes in, same bytes out.
 */
(function (root) {
  'use strict';

  /** The stated constants. The Model & method tab prints this table exactly as it stands here. */
  var C = {
    version: 'radar-comps-1',
    shrink_k: 3,             // pseudo-count: a bucket needs ~3 comps of its own to outweigh its parent
    winsor_lo: 0.05,         // comps' log-ratios are clipped to these quantiles before any median
    winsor_hi: 0.95,
    size_beta_min: -0.6,     // the fitted size tilt is held inside this range
    size_beta_max: 0,        // and never allowed to say that bigger protocols price richer
    mult_min: 0.02,          // under 2% of TVL a multiple says nothing useful
    mult_max: 3.0,           // and 3x TVL is the top of what the snapshot's own live tokens support
    growth_floor: -40,       // the 7-day change is clipped here first, in per cent
    growth_cap: 60,
    growth_power: 0.5,       // damped: one week of TVL is noise as much as signal, so take its root
    runway_floor: 0.8,       // brand new and token-less
    runway_range: 0.4,       // ... rising to 1.2 at the cap
    runway_days: 1095,       // three years
    unknown_age_days: 365,   // no listing date: count a year, and flag the row
    airdrop_share: 0.075,    // 7.5% of implied value to a community airdrop: an assumption, not a rule
    deposit_usd: 1000        // the reader's deposit the EV column is quoted for
  };

  /* --- small numeric helpers --- */

  var DAY = 86400000;
  function clamp(x, lo, hi) { return x < lo ? lo : x > hi ? hi : x; }
  function asc(a, b) { return a - b; }
  function cmpStr(a, b) { return a < b ? -1 : a > b ? 1 : 0; }
  function round(x, n) { var p = Math.pow(10, n); return Math.round(x * p) / p; }
  function log10(x) { return Math.log(x) / Math.LN10; }

  /** Quantile of an ascending array, linear between neighbours. */
  function quantile(v, f) {
    if (!v.length) return 0;
    var i = f * (v.length - 1), lo = Math.floor(i), hi = Math.ceil(i);
    return v[lo] + (v[hi] - v[lo]) * (i - lo);
  }
  function median(v) { return quantile(v, 0.5); }
  function halfIQR(v) { return (quantile(v, 0.75) - quantile(v, 0.25)) / 2; }

  /** Whole days from `listedAt` to `asOf`; null when either date is missing or unreadable. */
  function ageDays(asOf, listedAt) {
    if (!listedAt) return null;
    var a = Date.parse(asOf + 'T00:00:00Z'), b = Date.parse(listedAt + 'T00:00:00Z');
    if (!isFinite(a) || !isFinite(b)) return null;
    return Math.max(0, Math.floor((a - b) / DAY));
  }

  /* --- the universe split --- */

  /** Records no token: DefiLlama holds neither a CoinGecko id nor a ticker for it. */
  function isPreToken(p) { return p.gecko_id === null && p.symbol === null; }

  /** Its token trades and both sides of the ratio are real, so it can serve as a comparable. */
  function isLive(p) { return !isPreToken(p) && typeof p.mcap_usd === 'number' && p.mcap_usd > 0 && p.tvl_usd > 0; }

  // The house's exclusion rule, applied without the floor. A wrapped, staked or bridged product of a
  // token that already trades is not a protocol waiting on a launch of its own, and nor is a versioned
  // pool of one: both are set aside in view, with their reason, rather than dropped or ranked.
  var ASIDE_CATEGORIES = {
    'Bridge': 'bridges another chain’s asset', 'Canonical Bridge': 'a chain’s canonical bridge',
    'Liquid Staking': 'a liquid staking wrapper', 'Liquid Restaking': 'a liquid restaking wrapper',
    'Restaked BTC': 'restaked BTC, not a protocol of its own', 'CEX': 'a centralised exchange'
  };
  var VERSIONED = /\s(V\d+(\.\d+)?|v\d+(\.\d+)?|\d+\.\d+)$/;
  var WRAPPED_WORD = /\b(wrapped|staked|staking)\b/i;
  var EXCHANGE_PREFIX = /^(Binance|Coinbase|Bybit|Kraken|Bitget|OKX|Bitfinex|Gemini)\b/;

  /** Why a pre-token protocol is set aside instead of ranked, or null when it is ranked. */
  function asideReason(p) {
    if (p.category && ASIDE_CATEGORIES[p.category]) return 'Category ' + p.category + ': ' + ASIDE_CATEGORIES[p.category] + '.';
    if (VERSIONED.test(p.name)) return 'Name ends in a version marker: a release of another protocol, not a launch of its own.';
    if (WRAPPED_WORD.test(p.name)) return 'Name carries wrapped, staked or staking: a product of an asset that already trades.';
    if (EXCHANGE_PREFIX.test(p.name)) return 'Name starts with an exchange: an exchange’s own product, not a pre-token protocol.';
    return null;
  }

  /* --- families --- */

  // Five families, grouped on the category string alone. Shrinkage leans on this: a category with two
  // comps borrows from its family, a family with few borrows from the whole market.
  var FAMILIES = [
    { key: 'lending', label: 'Lending & credit', cats: ['Lending', 'CDP', 'CDP Manager', 'Uncollateralized Lending', 'Collateral Management', 'Collateral Markets', 'Reserve Currency'] },
    { key: 'trading', label: 'Trading & markets', cats: ['Dexs', 'Derivatives', 'Options', 'Prediction Market', 'Interest Rate Derivatives', 'OTC Marketplace', 'NFT Marketplace', 'Synthetics', 'Launchpad', 'DOR'] },
    { key: 'vaults', label: 'Vaults & yield', cats: ['Yield', 'Yield Aggregator', 'Onchain Capital Allocator', 'Risk Curators', 'Basis Trading', 'Liquidity Manager', 'Farm', 'Leveraged Farming', 'Indexes', 'Options Vault', 'Governance Incentives', 'Staking Pool', 'Token Locker'] },
    { key: 'stable', label: 'Stable & RWA', cats: ['RWA', 'Stablecoin Wrapper', 'Stablecoin Issuer', 'Dual-Token Stablecoin', 'Algo-Stables', 'CeDeFi', 'Payments', 'Crypto Card Issuer'] },
    { key: 'infra', label: 'Infra & other', cats: ['Chain', 'Restaking', 'Bridge', 'Canonical Bridge', 'Cross Chain Bridge', 'Liquid Staking', 'Liquid Restaking', 'Restaked BTC', 'Privacy', 'Decentralized AI', 'AI Agents', 'Anchor BTC', 'Decentralized BTC', 'Insurance'] }
  ];
  var FAMILY_OF = {}, FAMILY_LABEL = {};
  FAMILIES.forEach(function (f) {
    FAMILY_LABEL[f.key] = f.label;
    f.cats.forEach(function (c) { FAMILY_OF[c] = f.key; });
  });

  /** The family of a category string. A category the table does not name falls to Infra & other; a
   *  protocol with no category at all has no family and is priced off the whole market. */
  function familyOf(category) { return category ? (FAMILY_OF[category] || 'infra') : null; }

  /* --- the peer multiple --- */

  // Work in log10(mcap / TVL): the ratio runs over four orders of magnitude here, so the log is the only
  // scale on which a median and a spread mean anything, and a blend in log space is a geometric blend of
  // multiples. Two effects are fitted, both from the live tokens alone:
  //   centre  a hierarchical median - category shrunk into family shrunk into the whole market;
  //   size    one slope. The smallest live tokens here trade near 0.7x TVL and the largest near 0.04x,
  //           so a multiple read off peers of another size is the wrong multiple. The slope is measured
  //           on the residual left after the centre and held at or below zero: the data may say how much
  //           smaller protocols price richer, never that bigger ones do.

  /** Fit the comps: winsorized hierarchical centres and spreads, plus the size slope and its pivot. */
  function fitComps(comps) {
    var all = comps.map(function (c) { return c.r; }).sort(asc);
    // Winsorize first: one prediction market trading at 400x its TVL should widen the market's spread,
    // not set a category's price. Clipping at the 5th and 95th percentile keeps it in without it ruling.
    var lo = quantile(all, C.winsor_lo), hi = quantile(all, C.winsor_hi);
    var w = comps.map(function (c) { return { cat: c.cat, fam: c.fam, r: clamp(c.r, lo, hi), t: c.t }; });
    var rs = w.map(function (c) { return c.r; }).sort(asc);
    var g = { n: w.length, med: median(rs), half: halfIQR(rs) };
    g.c = g.med; g.s = g.half;

    var byFam = {}, byCat = {};
    w.forEach(function (c) {
      var fk = c.fam || '_none';
      (byFam[fk] = byFam[fk] || []).push(c.r);
      if (c.cat) (byCat[c.cat] = byCat[c.cat] || []).push(c.r);
    });
    var k = C.shrink_k;
    /** bucket = (n x its own median + k x the parent's centre) / (n + k), and likewise for the spread. */
    function shrink(values, parent) {
      var v = values.slice().sort(asc), n = v.length, med = median(v), half = halfIQR(v);
      return { n: n, med: med, half: half, c: (n * med + k * parent.c) / (n + k), s: (n * half + k * parent.s) / (n + k) };
    }
    var fam = {}, cat = {};
    Object.keys(byFam).forEach(function (fk) { fam[fk] = shrink(byFam[fk], g); });
    Object.keys(byCat).forEach(function (ck) { cat[ck] = shrink(byCat[ck], fam[familyOf(ck) || '_none'] || g); });

    // The size slope: least squares of (ratio - its bucket's centre) on (log10 TVL - the comps' median
    // log10 TVL). Pivoting on the median TVL leaves the tilt neutral for a protocol of ordinary size.
    var pivot = median(w.map(function (c) { return c.t; }).sort(asc)), sxy = 0, sxx = 0;
    w.forEach(function (c) {
      var b = (c.cat && cat[c.cat]) || fam[c.fam || '_none'] || g;
      var u = c.t - pivot;
      sxy += u * (c.r - b.c); sxx += u * u;
    });
    var beta = sxx > 0 ? clamp(sxy / sxx, C.size_beta_min, C.size_beta_max) : 0;
    return { n: w.length, winsor: [lo, hi], global: g, fam: fam, cat: cat, beta: beta, pivot: pivot };
  }

  function clampMult(x) { return clamp(x, C.mult_min, C.mult_max); }

  /** The multiple a protocol of this category and this size is priced at, with its band and evidence. */
  function multipleFor(fit, category, tvl) {
    var fk = familyOf(category);
    var fb = fk && fit.fam[fk] ? fit.fam[fk] : null;
    var cb = category && fit.cat[category] ? fit.cat[category] : null;
    var b = cb || fb || fit.global;
    var tilt = fit.beta * (log10(Math.max(1, tvl)) - fit.pivot);
    return {
      family: fk, family_label: fk ? FAMILY_LABEL[fk] : 'Whole market',
      n_cat: cb ? cb.n : 0, n_fam: fb ? fb.n : 0,
      basis: cb ? 'category' : fb ? 'family' : 'market',
      peer_centre: clampMult(Math.pow(10, b.c)),         // before the size tilt, for the walk-through
      size_tilt: Math.pow(10, tilt),
      mult: clampMult(Math.pow(10, b.c + tilt)),
      low: clampMult(Math.pow(10, b.c + tilt - b.s)),
      high: clampMult(Math.pow(10, b.c + tilt + b.s))
    };
  }

  /* --- momentum and runway --- */

  /** The 7-day TVL change, clipped and damped. A null change counts as flat and flags the row. */
  function momentum(change7d) {
    var known = typeof change7d === 'number' && isFinite(change7d);
    var g = known ? clamp(change7d, C.growth_floor, C.growth_cap) : 0;
    return { known: known, pct: g, factor: Math.pow(1 + g / 100, C.growth_power) };
  }

  /** How long it has run while recording no token. Three years of TVL and no token is three years of
   *  accrued points, users and survivorship behind whatever it issues; a protocol listed last month has
   *  a TVL number and nothing else. 0.8 on day one, 1.2 at three years. */
  function runway(age) {
    var known = age !== null;
    var d = clamp(known ? age : C.unknown_age_days, 0, C.runway_days);
    return { known: known, days: known ? age : null, used_days: d, factor: C.runway_floor + C.runway_range * (d / C.runway_days) };
  }

  /** What the row's own evidence is worth: comps in its category, and whether its two dates are real. */
  function confidence(nCat, mom, run) {
    var flags = (mom.known ? 1 : 0) + (run.known ? 1 : 0);
    if (nCat >= 6 && flags === 2) return 'High';
    if (nCat >= 2 && flags >= 1) return 'Medium';
    return 'Low';
  }

  /* --- the score --- */

  /** One protocol's whole value walk: the factors, the implied value, its band and its EV. */
  function score(p, fit, asOf) {
    var m = multipleFor(fit, p.category, p.tvl_usd);
    var mom = momentum(p.change_7d);
    var run = runway(ageDays(asOf, p.listed_at));
    var f = mom.factor * run.factor;
    var implied = Math.max(1, Math.round(p.tvl_usd * m.mult * f));
    return {
      multiple: m, momentum: mom, runway: run, implied: implied,
      implied_low: Math.max(1, Math.round(p.tvl_usd * m.low * f)),
      implied_high: Math.max(1, Math.round(p.tvl_usd * m.high * f)),
      confidence: confidence(m.n_cat, mom, run),
      // What $1,000 held through the snapshot is worth if 7.5% of the implied value goes to a community
      // airdrop split by deposit share. Two assumptions and an arithmetic: an estimate, never a promise.
      ev_per_1k: p.tvl_usd > 0 ? (implied * C.airdrop_share * C.deposit_usd) / p.tvl_usd : 0
    };
  }

  /* --- the backtest --- */

  /** Spearman rank correlation; ties take their average rank. */
  function spearman(xs, ys) {
    function ranks(v) {
      var idx = v.map(function (_, i) { return i; }).sort(function (a, b) { return v[a] - v[b] || a - b; });
      var r = new Array(v.length), i = 0;
      while (i < idx.length) {
        var j = i;
        while (j + 1 < idx.length && v[idx[j + 1]] === v[idx[i]]) j++;
        for (var t = i; t <= j; t++) r[idx[t]] = (i + j) / 2 + 1;
        i = j + 1;
      }
      return r;
    }
    var a = ranks(xs), b = ranks(ys), n = a.length, i, ma = 0, mb = 0;
    if (n < 2) return 0;
    for (i = 0; i < n; i++) { ma += a[i]; mb += b[i]; }
    ma /= n; mb /= n;
    var num = 0, da = 0, db = 0;
    for (i = 0; i < n; i++) { var u = a[i] - ma, v = b[i] - mb; num += u * v; da += u * u; db += v * v; }
    return da > 0 && db > 0 ? num / Math.sqrt(da * db) : 0;
  }

  /** The error summary of one prediction series against the live tokens' real market caps. */
  function stats(preds, actual) {
    var abs = preds.map(function (p, i) { return Math.abs(log10(p / actual[i])); }).sort(asc);
    var lim = log10(3), within = 0;
    for (var i = 0; i < abs.length; i++) if (abs[i] <= lim) within++;
    return {
      n: abs.length, spearman: round(spearman(preds, actual), 4),
      median_x: round(Math.pow(10, median(abs)), 3),
      within_3x: round(abs.length ? within / abs.length : 0, 4)
    };
  }

  /**
   * Leave one out over the live tokens. For each one the comps are refitted without it, and its market
   * cap is predicted from its own TVL, category, 7-day change and age - exactly the four numbers the
   * board has on a protocol whose token does not exist. Three series are scored side by side:
   *   naive     the whole market's median multiple on TVL, nothing else: the baseline to beat;
   *   no_size   the hierarchical multiple and both factors, without the size tilt;
   *   model     what the board runs.
   * A live token's market cap is not what a pre-token protocol's would be, so this measures the comps
   * model's reach and no more. That is why the baseline is reported beside it, never on its own.
   */
  function backtest(live, asOf) {
    var comps = live.map(function (p) {
      return { cat: p.category, fam: familyOf(p.category), r: log10(p.mcap_usd / p.tvl_usd), t: log10(p.tvl_usd) };
    });
    var actual = [], mp = [], np = [], sp = [];
    for (var i = 0; i < live.length; i++) {
      var p = live[i];
      var fit = fitComps(comps.slice(0, i).concat(comps.slice(i + 1)));
      var s = score(p, fit, asOf);
      var noTilt = clampMult(Math.pow(10, (((p.category && fit.cat[p.category]) || fit.fam[familyOf(p.category) || '_none'] || fit.global).c)));
      actual.push(p.mcap_usd);
      mp.push(s.implied);
      sp.push(Math.max(1, p.tvl_usd * noTilt * s.momentum.factor * s.runway.factor));
      np.push(Math.max(1, p.tvl_usd * clampMult(Math.pow(10, fit.global.c))));
    }
    return { model: stats(mp, actual), no_size: stats(sp, actual), naive: stats(np, actual) };
  }

  /* --- farm plans --- */

  // What one transaction costs, by the chain's own name: the ordinary band a farmer sees, not a worst
  // case. Mainnet spikes; a busy L2 block is still cents.
  var GAS = [
    { lo: 0.01, hi: 0.01, chains: ['Solana'] },
    { lo: 0.02, hi: 0.10, chains: ['Base', 'Arbitrum', 'Optimism', 'Ink', 'Unichain', 'Linea', 'Scroll', 'Blast', 'Mode', 'Soneium', 'World Chain', 'zkSync Era', 'Mantle', 'Taiko', 'Zircuit', 'Fraxtal', 'Swellchain', 'Manta', 'Morph', 'BOB', 'Metis', 'Lisk', 'MetalL2', 'Op_Bnb', 'Polygon zkEVM', 'X Layer'] },
    { lo: 0.10, hi: 0.10, chains: ['Binance', 'Polygon', 'Avalanche', 'Sonic', 'Celo', 'Fantom', 'Kava', 'Cronos'] },
    { lo: 1, hi: 2, chains: ['Tron'] },
    { lo: 1, hi: 5, chains: ['Bitcoin'] },
    { lo: 2, hi: 6, chains: ['Ethereum'] }
  ];
  var GAS_OF = {}, GAS_DEFAULT = { lo: 0.05, hi: 0.50 };
  GAS.forEach(function (g) { g.chains.forEach(function (c) { GAS_OF[c] = g; }); });
  function gasFor(chain) { return GAS_OF[chain] || GAS_DEFAULT; }

  function money(x) { return x >= 10 ? '$' + Math.round(x).toLocaleString('en-US') : '$' + x.toFixed(2); }
  function bigUsd(x) { return x >= 1e9 ? '$' + round(x / 1e9, 2) + 'B' : '$' + Math.round(x / 1e6) + 'M'; }
  function gasRange(g, n) { return g.lo === g.hi ? money(g.lo * n) : money(g.lo * n) + '–' + money(g.hi * n); }

  /** The cheapest chain the protocol names, and the price that made it cheapest. A tie goes to the
   *  chain the snapshot lists first, so the pick never moves between two runs. */
  function pickChain(chains) {
    if (!chains || !chains.length) return { chain: null, gas: GAS_DEFAULT };
    var best = 0, bg = gasFor(chains[0]);
    for (var i = 1; i < chains.length; i++) {
      var g = gasFor(chains[i]);
      if (g.hi < bg.hi || (g.hi === bg.hi && g.lo < bg.lo)) { best = i; bg = g; }
    }
    return { chain: chains[best], gas: bg };
  }

  /** The position to open, from TVL. A small protocol cannot absorb a big ticket, and a position over
   *  0.01% of TVL moves the pool it means to blend into. Never above that, whatever the tier says. */
  function depositFor(tvl) {
    var base = tvl < 20e6 ? 250 : tvl < 200e6 ? 1000 : 2500;
    return Math.min(base, Math.max(100, Math.floor(tvl * 0.0001 / 50) * 50));
  }

  /** The younger the protocol, the further off its snapshot date, so the plan holds through more of it. */
  function holdFor(age) { return age === null ? 60 : age < 180 ? 90 : age < 365 ? 75 : age < 730 ? 60 : 45; }

  /** The two actions that make the position, written for the protocol's own family. */
  function actionsFor(fam, cat, name, chain, dep, gas) {
    var on = chain ? ' on ' + chain : '', d = money(dep);
    if (fam === 'lending') return [
      { action: 'Supply ' + d + ' of USDC to ' + name + on + ' as collateral, from the protocol’s own app.', cost: d + ' of capital and ' + gasRange(gas, 2) + ' of gas for the approval and the supply', time: '15 minutes' },
      { action: 'Borrow back at most 30% of it in a stable, hold the health factor above 2, and loop once at most: one liquidation costs more than any airdrop has paid.', cost: gasRange(gas, 2) + ' of gas and 4–12% a year of interest on the borrowed leg', time: '10 minutes' }
    ];
    if (cat === 'Prediction Market') return [
      { action: 'Fund ' + d + ' on ' + (chain || 'its chain') + ' and take positions in several of ' + name + '’s own markets, not one: a venue counts distinct markets traded, not dollars parked.', cost: d + ' of capital, ' + gasRange(gas, 4) + ' of gas, and the spread you cross on each side', time: '30 minutes' },
      { action: 'Trade through resolution and claim the settled positions: an account with resolved markets behind it reads as a user, and an open position that never settles reads as nothing.', cost: gasRange(gas, 2) + ' of gas a settlement', time: '10 minutes a market' }
    ];
    if (cat === 'Derivatives' || cat === 'Options' || cat === 'Interest Rate Derivatives') return [
      { action: 'Deposit ' + d + ' of USDC as margin on ' + name + on + ' and run it delta-neutral: one small long and an equal short, or a hedge against spot you already hold.', cost: d + ' of margin, ' + gasRange(gas, 3) + ' of gas, and 0.02–0.06% of taker fee a side', time: '25 minutes' },
      { action: 'Turn the margin over each week rather than parking it - a perp venue weights volume and open days, not the balance sheet - and keep leverage at 2x or under so a wick cannot close the account.', cost: '0.02–0.06% of taker fee a side, plus funding of roughly ±0.01% every 8 hours', time: '15 minutes a week' }
    ];
    if (fam === 'trading') return [
      { action: 'Add ' + d + ' to the deepest stable-to-stable pool ' + name + ' runs' + on + '; if it runs no pools, route ' + d + ' of swap or perp volume through it each week instead.', cost: d + ' of capital, ' + gasRange(gas, 3) + ' of gas, and 0.01–0.30% of fees a round trip', time: '20 minutes' },
      { action: 'Keep the position in range and log the volume through it: a venue counts weeks of real flow, and a one-off swap is not flow.', cost: gasRange(gas, 2) + ' of gas a re-balance, and re-balance only past 5% of drift', time: '10 minutes a re-balance' }
    ];
    if (fam === 'vaults') return [
      { action: 'Deposit ' + d + ' into the ' + name + ' vault' + on + ' with the longest live record, not the highest advertised yield, and keep the shares.', cost: d + ' of capital, ' + gasRange(gas, 2) + ' of gas, and 0–20% of performance fee on the yield', time: '15 minutes' },
      { action: 'Read the curator’s allocation page weekly and write the points balance down; withdraw if the mandate changes or the vault concentrates into one borrower.', cost: 'nothing to read, ' + gasRange(gas, 1) + ' of gas to withdraw', time: '10 minutes a week' }
    ];
    if (fam === 'stable') {
      var kyc = cat === 'RWA' || cat === 'CeDeFi' || cat === 'Crypto Card Issuer';
      return [
        { action: 'Mint or deposit ' + d + ' into ' + name + '’s own stable or yield-bearing asset' + on + '.' + (kyc ? ' This category usually gates the mint behind KYC, so start there: a passport, a selfie and a wait.' : ''), cost: d + ' of capital and ' + gasRange(gas, 2) + ' of gas' + (kyc ? ', with no fee for the KYC itself' : ''), time: kyc ? '20 minutes to apply, then 1–3 business days to be approved' : '15 minutes' },
        { action: 'Read the redemption window before you size up, and hold the asset rather than selling it: these products settle on a queue, not on a swap.', cost: '0–0.5% of redemption fee and ' + gasRange(gas, 1) + ' of gas', time: 'instant to 5 business days to redeem' }
      ];
    }
    return [
      { action: 'Bridge in, then delegate or restake ' + d + ' of the asset ' + name + ' secures' + on + ', and keep the receipt token in the same wallet.', cost: d + ' of capital, 0.05–0.3% of bridge fee and ' + gasRange(gas, 3) + ' of gas', time: '25 minutes, bridge finality included' },
      { action: 'Add in two or three tranches across the window, not one lump: an infrastructure snapshot counts repeated use, and a single deposit is not use.', cost: gasRange(gas, 2) + ' of gas a tranche', time: '10 minutes a tranche' }
    ];
  }

  /** A protocol's whole farm plan: seven steps with a cost and a time each, and the totals. */
  function farmPlan(p, age, implied) {
    var pick = pickChain(p.chains), chain = pick.chain, gas = pick.gas;
    var dep = depositFor(p.tvl_usd), hold = holdFor(age), weeks = Math.round(hold / 7);
    var n = p.chains.length;
    var why = !chain
      ? 'The snapshot names no chain for it, so budget a mid-priced L2 at about ' + gasRange(gas, 1) + ' a transaction.'
      : n === 1 ? chain + ' is the only chain ' + p.name + ' runs on, at about ' + gasRange(gas, 1) + ' a transaction.'
      : chain + ' is the cheapest of the ' + n + ' chains ' + p.name + ' runs on, at about ' + gasRange(gas, 1) + ' a transaction, so the plan stays there.';
    var acts = actionsFor(familyOf(p.category), p.category, p.name, chain, dep, gas);
    var steps = [
      { action: 'Farm from a fresh wallet holding only this position, its seed phrase written offline and never pasted into a site. ' + why, cost: gasRange(gas, 1) + ' of gas to fund it', time: '15 minutes, once' },
      { action: 'Size it at ' + money(dep) + ': ' + (p.tvl_usd < 20e6 ? 'this protocol holds under $20M, so a small ticket is all it absorbs' : 'the usual ticket at its size') + ', and never more than 0.01% of its ' + bigUsd(p.tvl_usd) + ' of TVL. Hold that in USDC' + (chain ? ' on ' + chain : '') + ' before you start.', cost: money(dep) + ' of capital, and 0.05–0.3% of bridge fee if it comes from another chain', time: '10–30 minutes, bridge finality included' },
      acts[0], acts[1],
      { action: 'Do one qualifying action a week for the whole window - a top-up, a repayment, a swap, a vote - so the position reads as use and not as a parked deposit.', cost: 'about ' + gasRange(gas, 1) + ' of gas a week', time: '10 minutes a week, for ' + weeks + ' weeks' },
      { action: 'Hold for at least ' + hold + ' days' + (age === null ? ', and longer if you can: the snapshot carries no listing date for it, so treat it as young' : age < 365 ? ': it has recorded no token for only ' + age + ' days, so its airdrop snapshot is probably still ahead' : ': it has run ' + age + ' days with no token, so an airdrop snapshot may already have been taken') + '.', cost: 'the ' + money(dep) + ' stays at risk in the protocol for the window', time: hold + ' days' },
      { action: 'Exit and claim through the protocol’s own site or its pinned official account only. Never pay a fee to claim, never sign a blind approval, never open a claim link someone sent you: every airdrop that charges you is a theft.', cost: gasRange(gas, 3) + ' of gas to unwind and claim, and nothing else, ever', time: '30 minutes' }
    ];
    var txs = 9 + weeks;
    return {
      chain: chain, chain_reason: why, gas: { lo: gas.lo, hi: gas.hi },
      deposit_usd: dep, hold_days: hold, family: familyOf(p.category),
      total_cost: money(dep) + ' of capital at risk and ' + gasRange(gas, txs) + ' of gas across about ' + txs + ' transactions',
      total_time: 'about ' + round(1.5 + weeks * 0.17, 1) + ' hours of attention spread over ' + hold + ' days',
      ev_usd: p.tvl_usd > 0 ? (implied * C.airdrop_share * dep) / p.tvl_usd : 0,
      steps: steps
    };
  }

  /** The gate wants plain strings: the action, then its cost and its time, in 20 to 600 characters. */
  function stepText(s) {
    var t = s.action + ' Cost: ' + s.cost + '. Time: ' + s.time + '.';
    if (t.length > 600) t = t.slice(0, 597) + '…';
    while (t.length < 20) t += ' Hold it.';
    return t;
  }

  /* --- build it all --- */

  /** The live comps nearest a row: same category when it has one, else same family, nearest in TVL -
   *  a multiple read off a peer ten times its size is not this protocol's multiple. */
  function peersFor(radar, row, n) {
    var pool = row.category ? radar.live.filter(function (l) { return l.category === row.category; }) : [];
    if (pool.length < 3 && row.family) pool = radar.live.filter(function (l) { return l.family === row.family; });
    if (!pool.length) pool = radar.live.slice();
    var t = log10(Math.max(1, row.tvl_usd));
    return pool.slice().sort(function (a, b) {
      var da = Math.abs(log10(Math.max(1, a.tvl_usd)) - t), db = Math.abs(log10(Math.max(1, b.tvl_usd)) - t);
      return da - db || b.mcap_usd - a.mcap_usd || cmpStr(a.slug, b.slug);
    }).slice(0, n || 4);
  }

  /**
   * The whole radar from one snapshot: the ranked board, the live comps behind it, the protocols set
   * aside with their reason, the fitted multiples and the backtest. Pure, and deterministic.
   */
  function buildRadar(snapshot) {
    var asOf = snapshot.as_of, watch = {};
    (snapshot.watchlist || []).forEach(function (s) { watch[s] = true; });

    // Split the universe once: comps on one side, rankable pre-token protocols on the other, the
    // wrapped, staked, bridged and versioned products set aside in the middle with their reason.
    var live = [], aside = [], rankable = [];
    snapshot.protocols.forEach(function (p) {
      if (isLive(p)) { live.push(p); return; }
      if (!isPreToken(p)) return;                 // a token exists, but the snapshot gives it no market cap
      var why = asideReason(p);
      if (why !== null && !watch[p.slug]) { aside.push({ p: p, why: why }); return; }
      rankable.push(p);                           // a watchlist slug is ranked whatever any rule says
    });

    var fit = fitComps(live.map(function (p) {
      return { cat: p.category, fam: familyOf(p.category), r: log10(p.mcap_usd / p.tvl_usd), t: log10(p.tvl_usd) };
    }));

    var scored = rankable.map(function (p) {
      return { p: p, age: ageDays(asOf, p.listed_at), s: score(p, fit, asOf) };
    });
    // Implied value, then TVL, then slug: every tie breaks the same way on every run, so implied value
    // never rises as rank falls and two runs of one snapshot write the same bytes.
    scored.sort(function (a, b) { return b.s.implied - a.s.implied || b.p.tvl_usd - a.p.tvl_usd || cmpStr(a.p.slug, b.p.slug); });

    var board = scored.map(function (x, i) {
      var p = x.p, s = x.s, m = s.multiple, plan = farmPlan(p, x.age, s.implied);
      return {
        rank: i + 1, slug: p.slug, name: p.name, category: p.category, chains: p.chains,
        family: m.family, family_label: m.family_label,
        tvl_usd: p.tvl_usd, change_7d: p.change_7d, listed_at: p.listed_at, age_days: x.age,
        token_status: 'pre-token', watchlist: !!watch[p.slug], above_floor: p.tvl_usd >= snapshot.floor_usd,
        implied_value_usd: s.implied, implied_low_usd: s.implied_low, implied_high_usd: s.implied_high,
        peer_multiple: round(m.mult, 4), peer_multiple_low: round(m.low, 4), peer_multiple_high: round(m.high, 4),
        peer_centre: round(m.peer_centre, 4), size_tilt: round(m.size_tilt, 4),
        multiple_basis: m.basis, comps_in_category: m.n_cat, comps_in_family: m.n_fam,
        momentum_pct: round(s.momentum.pct, 4), momentum_factor: round(s.momentum.factor, 4),
        runway_factor: round(s.runway.factor, 4),
        confidence: s.confidence,
        flags: [].concat(
          s.momentum.known ? [] : ['no 7-day change in the snapshot: counted as flat'],
          s.runway.known ? [] : ['no listing date in the snapshot: counted as 365 days'],
          m.n_cat === 0 ? ['no live token in its category: priced off its family'] : [],
          watch[p.slug] && asideReason(p) ? ['on the watchlist, so ranked although a set-aside rule touches it'] : []),
        ev_per_1k_usd: round(s.ev_per_1k, 2),
        farm: plan, farm_steps: plan.steps.map(stepText)
      };
    });

    var liveRows = live.map(function (p) {
      var fk = familyOf(p.category);
      return {
        slug: p.slug, name: p.name, category: p.category, family: fk,
        family_label: fk ? FAMILY_LABEL[fk] : 'Whole market', chains: p.chains,
        tvl_usd: p.tvl_usd, mcap_usd: p.mcap_usd, change_7d: p.change_7d,
        ratio: round(p.mcap_usd / p.tvl_usd, 4)
      };
    }).sort(function (a, b) { return b.mcap_usd - a.mcap_usd || cmpStr(a.slug, b.slug); });

    var asideRows = aside.map(function (x) {
      return { slug: x.p.slug, name: x.p.name, category: x.p.category, chains: x.p.chains, tvl_usd: x.p.tvl_usd, reason: x.why };
    }).sort(function (a, b) { return b.tvl_usd - a.tvl_usd || cmpStr(a.slug, b.slug); });

    // The fitted table the Model tab prints: one row per family, plus the whole market behind them.
    var table = FAMILIES.map(function (f) {
      var b = fit.fam[f.key] || fit.global;
      return {
        key: f.key, label: f.label, n: fit.fam[f.key] ? b.n : 0,
        median: fit.fam[f.key] ? round(Math.pow(10, b.med), 4) : null,
        shrunk: round(clampMult(Math.pow(10, b.c)), 4),
        low: round(clampMult(Math.pow(10, b.c - b.s)), 4),
        high: round(clampMult(Math.pow(10, b.c + b.s)), 4),
        board_rows: board.filter(function (r) { return r.family === f.key; }).length
      };
    });

    var covered = (snapshot.watchlist || []).filter(function (s) {
      return board.some(function (r) { return r.slug === s; });
    }).length;

    return {
      as_of: asOf, source: snapshot.source, floor_usd: snapshot.floor_usd,
      model_version: C.version, constants: C, families: table,
      comps: {
        n: fit.n,
        global_median: round(Math.pow(10, fit.global.med), 4),
        global_multiple: round(clampMult(Math.pow(10, fit.global.c)), 4),
        winsor_low: round(Math.pow(10, fit.winsor[0]), 4), winsor_high: round(Math.pow(10, fit.winsor[1]), 4),
        size_beta: round(fit.beta, 4), size_pivot_usd: Math.round(Math.pow(10, fit.pivot))
      },
      backtest: backtest(live, asOf),
      board: board, live: liveRows, aside: asideRows,
      kpis: {
        watchlist_size: (snapshot.watchlist || []).length, watchlist_covered: covered,
        board_size: board.length,
        early_size: board.filter(function (r) { return !r.above_floor; }).length,
        live_size: liveRows.length, aside_size: asideRows.length,
        implied_total_usd: board.reduce(function (a, r) { return a + r.implied_value_usd; }, 0)
      }
    };
  }

  root.RadarModel = {
    VERSION: C.version, CONSTANTS: C, FAMILIES: FAMILIES, FAMILY_LABEL: FAMILY_LABEL,
    buildRadar: buildRadar, peersFor: peersFor, familyOf: familyOf, ageDays: ageDays,
    momentum: momentum, runway: runway, multipleFor: multipleFor, fitComps: fitComps,
    farmPlan: farmPlan, stepText: stepText, pickChain: pickChain, depositFor: depositFor,
    asideReason: asideReason, spearman: spearman
  };
})(typeof globalThis !== 'undefined' ? globalThis : this);

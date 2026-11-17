/* Token Launch Radar - the view. A classic script, no framework and no network: it recomputes the
   radar in the browser from the raw snapshot with model.js, the file main.ts ran to write board.json,
   then checks itself against the rows and seal main.ts left in data.js. State is in the URL hash
   (#tab=board&p=<slug>&fam=<family>&w=watch&sort=imp&dir=desc), so any view can be shot. */
(function () {
  'use strict';

  var root = document.getElementById('main');
  var M = window.RadarModel, SNAP = window.RADAR_SNAPSHOT;
  if (!M || !SNAP) { root.textContent = 'data.js or model.js did not load.'; return; }
  var R = M.buildRadar(SNAP), C = M.CONSTANTS, K = R.kpis;
  var AB = R.ablation[R.ablation.length - 1], FLAT = R.ablation[0];
  // board.json, written by main.ts from this same model.js and sealed: the page rebuilds the board
  // here and checks itself against it, row by row.
  var SEALED = window.RADAR_BOARD || [], CHECK = (function () {
    var ok = 0;
    SEALED.forEach(function (x, i) {
      var r = R.board[i];
      if (r && r.slug === x[0] && r.rank === x[1] && r.implied_value_usd === x[2] && r.verdict === x[3]) ok++;
    });
    return { n: ok, of: SEALED.length, match: ok === SEALED.length && SEALED.length > 0 && R.seal === window.RADAR_SEAL };
  })();

  /* --- text --- */

  var ENT = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' };
  function esc(s) { return String(s === null || s === undefined ? '' : s).replace(/[&<>"]/g, (c) => ENT[c]); }
  function usd(n) {
    var a = Math.abs(n);
    return a >= 1e9 ? '$' + (n / 1e9).toFixed(2) + 'B' : a >= 1e6 ? '$' + (n / 1e6).toFixed(a >= 1e8 ? 0 : 1) + 'M'
      : a >= 1e3 ? '$' + Math.round(n / 1e3) + 'k' : '$' + n.toFixed(0);
  }
  function dollars(n) { return '$' + n.toFixed(2); }
  function num(x) { return '<td class="num">' + x + '</td>'; }
  function mult(x) { return (x < 0.1 ? x.toFixed(3) : x.toFixed(2)) + '×'; }
  function signed(v) { return (v >= 0 ? '+' : '') + v.toFixed(1) + '%'; }
  function pct(f) { return (f * 100).toFixed(1) + '%'; }
  function pctCell(v) { return v === null ? '<span class="muted">n/a</span>' : '<span class="' + (v >= 0 ? 'pos' : 'neg') + '">' + signed(v) + '</span>'; }
  function runwayText(d) { return d === null ? '<span class="muted">n/a</span>' : d >= 730 ? (d / 365).toFixed(1) + ' yr' : d + ' d'; }
  function chainText(cs) { return !cs.length ? 'no chain named' : cs.length <= 2 ? cs.join(', ') : cs.slice(0, 2).join(', ') + ' +' + (cs.length - 2); }
  function sub(r) { return esc((r.category || 'no category') + ' · ' + chainText(r.chains)); }

  /* --- state, all of it in the hash --- */

  var DEF = { tab: 'board', p: '', q: '', fam: '', chain: '', w: 'all', tvl: '0', sign: '', sort: '', dir: '' };
  var S = {};

  function readHash() {
    var h = location.hash.replace(/^#/, ''), got = {};
    h.split('&').forEach(function (part) {
      var i = part.indexOf('=');
      if (i > 0) got[part.slice(0, i)] = decodeURIComponent(part.slice(i + 1).replace(/\+/g, ' '));
    });
    Object.keys(DEF).forEach(function (k) { S[k] = Object.prototype.hasOwnProperty.call(got, k) ? got[k] : DEF[k]; });
    if (!TABS[S.tab]) S.tab = 'board';
  }
  function writeHash(patch) {
    Object.keys(patch).forEach(function (k) { S[k] = patch[k]; });
    var parts = Object.keys(DEF).filter((k) => S[k] !== DEF[k])
      .map((k) => k + '=' + encodeURIComponent(S[k]));
    location.hash = parts.length ? '#' + parts.join('&') : '#tab=board';
  }

  /* --- the four tabs --- */

  var TABS = {
    board: { label: 'Pre-token board', n: K.board_size },
    live: { label: 'Live comps', n: K.comps_size, alt: true },
    aside: { label: 'Set aside', n: K.aside_size },
    model: { label: 'Model & method', n: null }
  };

  /* --- filters --- */

  var TVL_STEPS = [['0', 'any'], ['5', '$5M'], ['20', '$20M'], ['50', '$50M'], ['250', '$250M'], ['1000', '$1B']];
  var CHAINS = (function () {
    var seen = {};
    R.board.concat(R.comps, R.aside).forEach(function (r) { (r.chains || []).forEach(function (c) { seen[c] = (seen[c] || 0) + 1; }); });
    return Object.keys(seen).sort((a, b) => seen[b] - seen[a] || (a < b ? -1 : 1));
  })();

  /** The rows of the open tab that pass every filter. One predicate for all three tables. */
  function visible(rows) {
    var q = S.q.trim().toLowerCase(), minTvl = Number(S.tvl) * 1e6;
    return rows.filter(function (r) {
      if (q && (r.name + ' ' + r.slug + ' ' + (r.category || '')).toLowerCase().indexOf(q) < 0) return false;
      if (S.fam && (r.family || 'none') !== S.fam) return false;
      if (S.chain && (r.chains || []).indexOf(S.chain) < 0) return false;
      if (r.tvl_usd < minTvl) return false;
      if (S.sign === 'up' && !(r.change_7d > 0)) return false;
      if (S.sign === 'down' && !(r.change_7d < 0)) return false;
      if (S.w === 'watch' && !r.watchlist) return false;
      if (S.w === 'early' && (r.watchlist || r.above_floor !== false)) return false;
      return true;
    });
  }

  function filtersActive() {
    return S.q || S.fam || S.chain || S.w !== 'all' || S.tvl !== '0' || S.sign;
  }

  /** One <select> over [value, label] pairs, bound to the state field of the same name. */
  function select(id, pairs) {
    return '<select id="' + id + '" data-field="' + id + '">' + pairs.map(function (o) {
      return '<option value="' + esc(o[0]) + '"' + (S[id] === o[0] ? ' selected' : '') + '>' + esc(o[1]) + '</option>';
    }).join('') + '</select>';
  }

  /** A row of buttons that set one field: the family chips, the watchlist/early segment. */
  function pick(field, pairs, cls) {
    return '<div class="' + cls + '">' + pairs.map(function (o) {
      return '<button data-set="' + field + '" data-val="' + esc(o[0]) + '" aria-pressed="' + (S[field] === o[0]) + '">' + esc(o[1]) + '</button>';
    }).join('') + '</div>';
  }

  function filterBar(total, shown) {
    var fams = [['', 'All families']].concat(R.families.map((f) => [f.key, f.label]));
    return '<div class="filters">' +
      '<label for="q">Search</label><input id="q" type="search" data-field="q" value="' + esc(S.q) + '" placeholder="name or category">' +
      pick('fam', fams, 'chips') +
      pick('w', [['all', 'All rows'], ['watch', 'Watchlist'], ['early', 'Early']], 'seg') +
      '<span class="brk"></span>' +
      '<label for="chain">Chain</label>' + select('chain', [['', 'any chain']].concat(CHAINS.map((c) => [c, c]))) +
      '<label for="tvl">Min TVL</label>' + select('tvl', TVL_STEPS) +
      '<label for="sign">7d</label>' + select('sign', [['', 'up or down'], ['up', 'growing'], ['down', 'falling']]) +
      '<span class="count"><b>' + shown + '</b> of ' + total + ' rows' +
      (filtersActive() ? '<a href="#tab=' + S.tab + '">clear filters</a>' : '') + '</span></div>';
  }

  /* --- sortable tables --- */

  var VERDICT_ORDER = { FARM: 3, MARGINAL: 2, SKIP: 1 };

  /** Columns as [key, label, kind, value], kind 0 = text, 1 = numeric, 2 = numeric but counting up. */
  function cols(list) {
    return list.map(function (c) { return { k: c[0], label: c[1], num: c[2] > 0, asc: c[2] !== 1, val: c[3] }; });
  }
  var BOARD_COLS = cols([
    ['rank', 'Rank', 2, (r) => r.rank],
    ['name', 'Protocol', 0, (r) => r.name.toLowerCase()],
    ['tvl', 'TVL', 1, (r) => r.tvl_usd],
    ['d7', '7d', 1, (r) => r.change_7d === null ? -1e9 : r.change_7d],
    ['age', 'No token for', 1, (r) => r.age_days === null ? -1 : r.age_days],
    ['mult', 'Peer multiple', 1, (r) => r.peer_multiple],
    ['imp', 'Implied value', 1, (r) => r.implied_value_usd],
    ['net', 'Net on $1k', 1, (r) => r.net_usd],
    ['verdict', 'Verdict', 1, (r) => VERDICT_ORDER[r.verdict]]
  ]);
  var LIVE_COLS = cols([
    ['name', 'Live token', 0, (r) => r.name.toLowerCase()],
    ['tvl', 'TVL', 1, (r) => r.tvl_usd],
    ['mcap', 'Market cap', 1, (r) => r.mcap_usd],
    ['ratio', 'mcap / TVL', 1, (r) => r.ratio],
    ['curve', 'The curve says', 1, (r) => r.curve_usd],
    ['miss', 'Miss', 1, (r) => -r.miss_x]
  ]);
  var ASIDE_COLS = cols([
    ['name', 'Protocol', 0, (r) => r.name.toLowerCase()],
    ['tvl', 'TVL', 1, (r) => r.tvl_usd],
    ['why', 'Why it is set aside, not ranked', 0, (r) => r.reason.toLowerCase()]
  ]);

  /** Sort by the clicked column, then always by rank or TVL, so the order never depends on input order. */
  function sortRows(rows, cols, fallback) {
    var col = null, i;
    for (i = 0; i < cols.length; i++) if (cols[i].k === S.sort) col = cols[i];
    if (!col) col = fallback;
    var dir = S.dir ? (S.dir === 'asc' ? 1 : -1) : (col.asc ? 1 : -1);
    return rows.slice().sort(function (a, b) {
      var x = col.val(a), y = col.val(b);
      return (x < y ? -1 : x > y ? 1 : 0) * dir || (a.rank || 0) - (b.rank || 0) || (b.tvl_usd - a.tvl_usd) || (a.slug < b.slug ? -1 : 1);
    });
  }

  function head(cols, fallback) {
    var active = S.sort || fallback.k;
    var dir = S.dir ? S.dir : (function () {
      for (var i = 0; i < cols.length; i++) if (cols[i].k === active) return cols[i].asc ? 'asc' : 'desc';
      return 'desc';
    })();
    return '<thead><tr>' + cols.map(function (c) {
      var on = c.k === active, next = on && dir === 'asc' ? 'desc' : c.asc && !on ? 'asc' : on ? 'asc' : 'desc';
      return '<th class="' + (c.num ? 'num' : '') + (on ? ' on' : '') + '" aria-sort="' + (on ? dir + 'ending' : 'none') + '">' +
        '<button data-sortby="' + c.k + '" data-dir="' + next + '">' + esc(c.label) +
        '<i>' + (on ? (dir === 'asc' ? '↑' : '↓') : '') + '</i></button></th>';
    }).join('') + '</tr></thead>';
  }

  /* --- the board --- */

  // The band bar is drawn on a log scale across the whole board, so a row's low-high band is as wide
  // on screen as the comps' spread is wide in multiples.
  var LO = Math.log(Math.min.apply(null, R.board.map((r) => r.implied_low_usd)));
  var HI = Math.log(Math.max.apply(null, R.board.map((r) => r.implied_high_usd)));
  function at(v) { return Math.max(0, Math.min(100, ((Math.log(v) - LO) / (HI - LO)) * 100)); }

  function band(r) {
    var a = at(r.implied_low_usd), b = at(r.implied_high_usd);
    return '<span class="band"><i style="left:' + a.toFixed(1) + '%;width:' + Math.max(1, b - a).toFixed(1) + '%"></i>' +
      '<u style="left:' + at(r.implied_value_usd).toFixed(1) + '%"></u></span>';
  }

  function boardRow(r) {
    return '<tr class="' + (r.watchlist ? 'watch' : '') + (r.slug === S.p ? ' open' : '') + '">' +
      '<td class="rank num">' + r.rank + '<span class="lh">' + r.rank_lo + '–' + r.rank_hi + '</span></td>' +
      '<td><a class="open" href="#tab=board&p=' + encodeURIComponent(r.slug) + '"><span class="pname">' + esc(r.name) + '</span>' +
      (r.watchlist ? '<span class="badge">watchlist</span>' : r.above_floor ? '' : '<span class="badge early">early</span>') +
      '<span class="psub">' + sub(r) + '</span></a></td>' +
      num(usd(r.tvl_usd)) +
      num(pctCell(r.change_7d)) +
      num(runwayText(r.age_days)) +
      num(mult(r.peer_multiple)) +
      '<td class="num imp">' + usd(r.implied_value_usd) + band(r) +
      '<span class="lh">' + usd(r.implied_low_usd) + ' – ' + usd(r.implied_high_usd) + '</span></td>' +
      num(dollars(r.net_usd)) +
      num('<span class="conf ' + r.verdict + '">' + r.verdict + '</span>') + '</tr>';
  }

  function table(rows, cols, fallback, note, rowFn, cls) {
    var seen = sortRows(visible(rows), cols, fallback);
    return filterBar(rows.length, seen.length) + (note ? '<p class="note">' + note + '</p>' : '') +
      '<div class="wrap"><table class="' + (cls || '') + '">' + head(cols, fallback) + '<tbody>' +
      seen.map(rowFn).join('') + '</tbody></table></div>' +
      (seen.length ? '' : '<p class="muted">No row passes those filters.</p>');
  }

  function boardTable() { return table(R.board, BOARD_COLS, BOARD_COLS[0], '', boardRow, 'board'); }

  function liveTable() {
    return table(R.comps, LIVE_COLS, LIVE_COLS[2], 'These ' + K.comps_size + ' tokens already trade, so they are never ' +
      'ranked: they are the evidence, and the last columns are the curve\'s miss where the answer is known.',
      function (r) {
        return '<tr><td><span class="pname">' + esc(r.name) + '</span><span class="badge ochre">live</span>' +
          '<span class="psub">' + sub(r) + '</span></td>' + num(usd(r.tvl_usd)) + num(usd(r.mcap_usd)) +
          num(mult(r.ratio)) + num(usd(r.curve_usd)) + num(r.miss_x + '×') + '</tr>';
      });
  }

  function asideTable() {
    return table(R.aside, ASIDE_COLS, ASIDE_COLS[1], K.aside_size + ' protocols that are a derivative of something that ' +
      'already trades: shown with the reason, never used as comps. A watchlist slug a rule touches is ranked.',
      function (r) {
        return '<tr><td><span class="pname">' + esc(r.name) + '</span><span class="psub">' + sub(r) + '</span></td>' +
          num(usd(r.tvl_usd)) + '<td>' + esc(r.reason) + '</td></tr>';
      });
  }

  /* --- one protocol: the value walk, the comps behind it and the farm plan --- */

  function factor(label, value, note, out) {
    return '<div class="f' + (out ? ' out' : '') + '"><span>' + label + '</span><b>' + value + '</b><i>' + note + '</i></div>';
  }

  function detail(r) {
    var f = r.farm, bk = R.clock[r.age_bucket], nc = r.comps_in_category;
    var walk = [
      factor('TVL', usd(r.tvl_usd), 'the snapshot\'s own figure'),
      factor('Size curve', mult(r.size_multiple), '10^(' + R.fit.a + ' + ' + R.fit.b + ' × log10(TVL/$100M)) over TVL'),
      factor('Family offset', r.offset_factor.toFixed(3) + '×', nc + ' comp' + (nc === 1 ? '' : 's') + ' in its category, ' +
        r.comps_in_family + ' in its family' + (nc < C.min_cat_comps ? ': priced off the family' : '')),
      factor('Momentum', r.momentum_factor.toFixed(3) + '×', '7d ' + (r.change_7d === null ? 'not recorded, counted flat' : signed(r.momentum_pct)) + ', damped to its root'),
      factor('No-token clock', r.clock_factor.toFixed(3) + '×', bk.label + ': ' + pct(1 - bk.share_token) + ' of that age still record none'),
      factor('Implied value', usd(r.implied_value_usd), usd(r.implied_low_usd) + ' – ' + usd(r.implied_high_usd) + ' band', true)
    ];
    return '<div class="crumb"><a href="#tab=board">← Back to the board</a>' +
      '<h2>#' + r.rank + ' ' + esc(r.name) + (r.watchlist ? '<span class="badge">watchlist</span>' : '') + '</h2>' +
      '<span class="muted">' + sub(r) + ' · ' + esc(R.family_labels[r.family]) + ' · records no token</span></div>' +
      '<div class="walk">' + walk.slice(0, 5).join('<div class="op">×</div>') + '<div class="op">=</div>' + walk[5] + '</div>' +
      '<div class="cols"><div>' +
      '<h3>What it is worth, and on what evidence</h3><div class="card">' +
      [['Implied value', usd(r.implied_value_usd)],
       ['Band, P10–P90 of the model\'s misses', usd(r.implied_low_usd) + ' – ' + usd(r.implied_high_usd)],
       ['Rank over ' + C.boot_refits + ' refits', '#' + r.rank + ' (' + r.rank_lo + '–' + r.rank_hi + ')'],
       ['Comps in category / family', nc + ' / ' + r.comps_in_family],
       ['Confidence', r.confidence],
       ['Expected drop on ' + usd(f.deposit_usd), dollars(r.drop_usd) + ' at ' + pct(C.airdrop_share) + ' of value']
      ].map((o) => '<div class="kv"><span>' + o[0] + '</span><b>' + o[1] + '</b></div>').join('') + '</div>' +
      '<h3>Its nearest comps, and what the curve charges them</h3>' +
      tbl(['Token', 'TVL', 'Market cap', 'mcap / TVL', 'Curve', 'Miss'], M.peersFor(R, r, 5).map(function (p) {
        return ['<span class="pname">' + esc(p.name) + '</span><span class="psub">' + esc(p.category || 'no category') +
          '</span>', usd(p.tvl_usd), usd(p.mcap_usd), mult(p.ratio), usd(p.curve_usd), p.miss_x + '×'];
      })) +
      (r.flags.length ? '<h3>Data flags</h3><ul class="flags">' + r.flags.map((x) => '<li>' + esc(x) + '</li>').join('') + '</ul>' : '') +
      '<p class="note">It <b>records</b> no token: no id, ticker or market cap here. The implied value is a comps ' +
      'estimate, not a price, and none of it is advice.</p>' +
      '</div><div class="wide">' +
      '<h3>Farm plan · ' + (f.chain ? esc(f.chain) : 'no chain named') + ' · ' + usd(f.deposit_usd) + ' held ' +
      f.hold_days + ' days · <b class="conf ' + r.verdict + '">' + r.verdict + '</b></h3>' +
      '<div class="sum"><div><span>Expected drop</span><b>' + dollars(r.drop_usd) + ' — an estimate from the stated assumptions, not a promise</b></div>' +
      '<div><span>Costs</span><b>' + dollars(f.fees_usd) + ' of gas and fees + ' + dollars(f.opportunity_usd) + ' of yield given up at ' + pct(C.tbill_apy) + '</b></div>' +
      '<div><span>Net, per hands-on hour</span><b>' + dollars(r.net_usd) + ' over ' + r.hands_on_hours + ' h — ' + dollars(r.net_per_hour_usd) + ' an hour</b></div></div>' +
      '<table class="plan"><thead><tr><th>Step</th><th>Cost</th><th>Time</th></tr></thead><tbody>' +
      f.steps.map(function (s, i) {
        return '<tr><td class="step"><span class="n">' + (i + 1) + '</span>' + esc(s.action) + '</td>' +
          '<td class="cost">' + esc(s.cost) + '</td><td class="time">' + esc(s.time) + '</td></tr>';
      }).join('') + '</tbody></table></div></div>';
  }

  /* --- model & method --- */

  // The Model tab prints what model.js computed: the fitted curve, the shrunk offsets, the clock's
  // own bucket counts, the ablation. Change a constant there and every number here moves.
  function tbl(hd, rows) {
    return '<table><thead><tr>' + hd.map((h, i) => '<th' + (i ? ' class="num"' : '') + '>' + h + '</th>').join('') +
      '</tr></thead><tbody>' + rows.map((r) => '<tr><td>' + r[0] + '</td>' + r.slice(1).map(num).join('') + '</tr>').join('') +
      '</tbody></table>';
  }

  function modelTab() {
    var own = R.categories.filter((c) => c.own);
    return '<div class="cols"><div>' +
      '<h3>The formula</h3><div class="formula-box"><code>log10 V = ' + R.fit.a + ' + ' + R.fit.b +
      ' × log10(TVL / $100M) + family offset + momentum + no-token clock</code></div>' +
      '<p class="note"><code>fitCurve()</code>, a Huber regression on this snapshot\'s own ' + R.fit.n + ' clean comps: ' +
      '$100M of TVL prices at ' + usd(R.fit.pivot_value_usd) + ', and at a slope of ' + R.fit.b + ' ten times the TVL buys ' +
      Math.pow(10, R.fit.b).toFixed(1) + '× the market cap, not ten. No protocol is named: it reads categories, chains, ' +
      'TVL, the change and the listing date.</p>' +
      '<h3>Family offsets, shrunk with k = ' + C.shrink_k + '</h3>' +
      tbl(['Family', 'Comps', 'Raw', 'Shrunk', 'Factor', 'Board rows'], R.families.map(function (f) {
        return [esc(f.label), f.n, f.raw === null ? '—' : f.raw.toFixed(3), f.offset.toFixed(3), mult(f.factor), f.rows];
      })) +
      '<p class="note">A category prices itself only with ' + C.min_cat_comps + ' comps or more (' +
      esc(own.map((c) => c.category + ' ' + c.n).join(', ')) + '); the rest take their family\'s.</p>' +
      '<h3>The no-token clock, fitted</h3>' +
      tbl(['Age', 'Protocols', 'With a token', 'Still none', 'Factor'], R.clock.map(function (c) {
        return [esc(c.label), c.n, pct(c.share_token || 0), pct(1 - (c.share_token || 0)), mult(c.factor)];
      })) +
      '<p class="note">Over every protocol the snapshot keeps at $5M or more that no rule sets aside: one still tokenless ' +
      'after years is in a shrinking minority, so the clock discounts it. <b>“Records no token” is not “has no token”</b> ' +
      '— no id, ticker or market cap here, and no claim one is coming.</p>' +
      '</div><div>' +
      '<h3>Out of sample: every term, one at a time</h3>' +
      tbl(['Model', 'LOO miss', 'Within 3×', 'Rank corr', 'Time split'], R.ablation.map(function (a) {
        return [esc(a.term), a.loo.median_x.toFixed(2) + '×', pct(a.loo.within_3x), a.loo.spearman.toFixed(3),
          a.split ? a.split.median_x.toFixed(2) + '×' : '—'];
      })) +
      '<p class="note">Leave-one-out over the ' + AB.loo.n + ' comps, each predicted with the fit refitted without it; ' +
      'the split fits on the ' + R.split.n_fit + ' listed before ' + esc(R.split.cut) + ' and tests on the ' +
      R.split.n_test + ' newer. Honestly: the offsets pay leave-one-out and cost a little in the split; momentum and the ' +
      'clock run at half strength, because at full strength both are worse on both tests.</p>' +
      '<h3>What the verdicts assume</h3>' +
      tbl(['Assumption', ''], [
        ['Airdrop', pct(C.airdrop_share) + ' of implied value by deposit share, on ' + usd(C.deposit_usd)],
        ['Costs', 'the plan\'s own gas and fees, plus ' + pct(C.tbill_apy) + ' a year of T-bill yield'],
        ['Verdict', 'FARM over ' + C.farm_ratio + '× its costs, MARGINAL if it nets, else SKIP']
      ]) +
      '</div></div>';
  }

  /* --- the page --- */

  function kpi(label, value, note, alt) {
    return '<div class="kpi' + (alt ? ' alt' : '') + '"><span>' + label + '</span><b>' + value + '</b><i>' + note + '</i></div>';
  }

  function render() {
    var body, open = S.tab === 'board' && S.p;
    if (open) {
      var row = null;
      R.board.forEach(function (r) { if (r.slug === S.p) row = r; });
      body = row ? detail(row) : '<p class="muted">No ranked protocol carries that slug. <a href="#tab=board">Back to the board.</a></p>';
    } else {
      body = S.tab === 'live' ? liveTable() : S.tab === 'aside' ? asideTable() : S.tab === 'model' ? modelTab() : boardTable();
    }
    root.innerHTML =
      '<div class="top"><div><h1>Token Launch <em>Radar</em></h1>' +
      '<p class="meta">' + K.board_size + ' protocols that record no token, ranked by implied value · snapshot ' +
      esc(R.as_of) + ' from ' + esc(String(R.source).split(' ')[0].replace(/^.*\/\//, '')) + ' · model ' + esc(R.model_version) + '</p></div>' +
      '<div class="formula"><b>TVL × size curve × family offset × momentum × no-token clock</b>' +
      'fitted on this snapshot\'s own ' + R.fit.n + ' clean comps</div></div>' +
      (open ? '' : '<div class="badge-row"><span class="seal ' + (CHECK.match ? 'ok' : 'bad') + '">' +
      (CHECK.match ? '✓' : '✗') + ' board.json = this page: ' + CHECK.n + '/' + CHECK.of +
      ' ranks, values and verdicts match · seal ' + esc(R.seal) + '</span></div>' +
      '<div class="kpis">' + [
        ['Watchlist covered', K.watchlist_covered + '/' + K.watchlist_size, 'every slug ranked, rules or not'],
        ['Pre-token rows ranked', String(K.board_size), K.early_size + ' under the ' + usd(R.floor_usd) + ' floor'],
        ['Clean comps fitted', String(K.comps_size), 'one row per token, of ' + K.comp_rows + ' live rows', 1],
        ['Out-of-sample miss', AB.loo.median_x.toFixed(2) + '×', 'a flat multiple misses ' + FLAT.loo.median_x.toFixed(2) + '×'],
        ['Verdicts on ' + usd(C.deposit_usd), K.farm + ' farm', K.marginal + ' marginal · ' + K.skip + ' skip'],
        ['Total implied value', usd(K.implied_total_usd), 'the board summed, bands aside']
      ].map((o) => kpi(o[0], o[1], o[2], o[3])).join('') + '</div>') +
      '<div class="tabs">' + Object.keys(TABS).map(function (k) {
        var t = TABS[k];
        return '<button data-tab="' + k + '" class="' + (t.alt ? 'alt' : '') + '" aria-current="' + (S.tab === k) + '">' +
          t.label + (t.n === null ? '' : '<b>' + t.n + '</b>') + '</button>';
      }).join('') + '</div>' + body +
      '<footer>make.fun token-radar-01 · every number is recomputed in the browser from the raw snapshot by the same ' +
      'model.js that wrote board.json · an implied value is a comps estimate, not a price, and none of it is advice.</footer>';
    root.setAttribute('aria-busy', 'false');
  }

  /* --- events: every control writes the hash, and the hash draws the page --- */

  document.addEventListener('click', function (e) {
    var el = e.target.closest ? e.target.closest('[data-tab],[data-set],[data-sortby]') : null;
    if (!el) return;
    if (el.hasAttribute('data-tab')) {
      writeHash({ tab: el.getAttribute('data-tab'), p: '', sort: '', dir: '' });
    } else if (el.hasAttribute('data-set')) {
      var patch = { p: '' };                       // a filter closes the open row and keeps the sort
      patch[el.getAttribute('data-set')] = el.getAttribute('data-val');
      writeHash(patch);
    } else {
      writeHash({ sort: el.getAttribute('data-sortby'), dir: el.getAttribute('data-dir') });
    }
    e.preventDefault();
  });

  document.addEventListener('change', function (e) {
    if (e.target.getAttribute && e.target.getAttribute('data-field')) {
      var o = { p: '' }; o[e.target.getAttribute('data-field')] = e.target.value; writeHash(o);
    }
  });

  var typing = null;
  document.addEventListener('input', function (e) {
    if (!e.target.getAttribute || e.target.getAttribute('data-field') !== 'q') return;
    var v = e.target.value;
    clearTimeout(typing);
    typing = setTimeout(function () { writeHash({ q: v, p: '' }); }, 120);
  });

  // The search box keeps its focus and its caret across a redraw, so typing never jumps.
  function draw() {
    var wasSearch = document.activeElement && document.activeElement.id === 'q';
    readHash();
    render();
    if (wasSearch) {
      var q = document.getElementById('q');
      if (q) { q.focus(); q.setSelectionRange(q.value.length, q.value.length); }
    }
  }
  window.addEventListener('hashchange', draw);
  draw();
})();

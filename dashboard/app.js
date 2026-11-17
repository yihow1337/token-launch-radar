/* Token Launch Radar - the view. One classic script, no framework and no network: it recomputes the
   radar in the browser with model.js - the file main.ts ran to write board.json - then checks itself,
   row by row, against the board and seal data.js carries. Every control writes the hash, so any view
   on screen - a protocol, a verdict, a deposit - is one that can be linked to and photographed. */
(function () {
  'use strict';

  var root = document.getElementById('main');
  var M = window.RadarModel, SNAP = window.RADAR_SNAPSHOT;
  if (!M || !SNAP) { root.textContent = 'data.js or model.js did not load.'; return; }
  var R = M.buildRadar(SNAP), C = M.CONSTANTS, K = R.kpis, F = R.fit, CL = R.clock;
  // model.js prices every step and nets it here; the wording of those steps is written by
  // lib/plans.js, outside dashboard/, and arrives in data.js rendered at each deposit.
  var PLANS = window.RADAR_PLANS || {};
  var AB = R.ablation[R.ablation.length - 1], FLAT = R.ablation[0];

  // board.json, written by main.ts from this same model.js and sealed: the page rebuilds the board
  // here and checks every rank, value and verdict against the ledger in data.js.
  var CHECK = (function (led, n) {
    led.forEach(function (x, i) {
      var r = R.board[i];
      if (r && r.slug === x[0] && r.rank === x[1] && r.implied_value_usd === x[2] && r.verdict === x[3]) n++;
    });
    return { n: n, of: led.length, ok: n === led.length && n > 0 && R.seal === window.RADAR_SEAL };
  })(window.RADAR_BOARD || [], 0);

  var ENT = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' };
  function esc(s) { return String(s === null || s === undefined ? '' : s).replace(/[&<>"]/g, (c) => ENT[c]); }
  function e(t, c, s) { return '<' + t + (c ? ' class="' + c + '"' : '') + '>' + (s === undefined ? '' : s) + '</' + t + '>'; }
  /** The one shape the KPI strip, the value walk and the plan totals all share. */
  function box(c, label, value, note) { return e('div', c, e('span', '', label) + e('b', '', value) + (note === undefined ? '' : e('i', '', note))); }
  function usd(n) {
    var a = Math.abs(n);
    return a >= 1e9 ? '$' + (n / 1e9).toFixed(2) + 'B' : a >= 1e6 ? '$' + (n / 1e6).toFixed(a >= 1e8 ? 0 : 1) + 'M'
      : a >= 1e3 ? '$' + Math.round(n / 1e3) + 'k' : '$' + n.toFixed(0);
  }
  function dol(n) { return (n < 0 ? '−$' : '$') + Math.abs(n).toFixed(2); }
  function mult(x) { return (x < 0.1 ? x.toFixed(3) : x.toFixed(2)) + '×'; }
  function pct(f) { return (f * 100).toFixed(1) + '%'; }
  function signed(v) { return v === null ? e('i', 'muted', 'n/a') : e('i', v >= 0 ? 'pos' : 'neg', (v >= 0 ? '+' : '') + v.toFixed(1) + '%'); }
  function ageText(d) { return d === null ? e('i', 'muted', 'n/a') : d >= 730 ? (d / 365).toFixed(1) + ' yr' : d + ' d'; }
  function sub(r) {
    var c = r.chains;
    return esc((r.category || 'no category') + ' · ' + (!c.length ? 'no chain named' : c.length <= 2 ? c.join(', ') : c.slice(0, 2).join(', ') + ' +' + (c.length - 2)));
  }
  function decade(k) { return k >= 9 ? '$' + Math.pow(10, k - 9) + 'B' : k >= 6 ? '$' + Math.pow(10, k - 6) + 'M' : '$' + Math.pow(10, k - 3) + 'k'; }
  function lg(v) { return Math.log(Math.max(1, v)) / Math.LN10; }

  /* --- state, all of it in the hash --- */
  var DEF = { tab: 'board', p: '', q: '', fam: '', w: 'all', v: '', dep: '1000', sh: '7.5', sort: '', dir: '' };
  var S = {}, D = C.deposit_usd, SH = C.airdrop_share;

  function readHash() {
    var got = {};
    location.hash.replace(/^#/, '').split('&').forEach(function (part) {
      var i = part.indexOf('=');
      if (i > 0) got[part.slice(0, i)] = decodeURIComponent(part.slice(i + 1).replace(/\+/g, ' '));
    });
    Object.keys(DEF).forEach((k) => { S[k] = got[k] === undefined ? DEF[k] : got[k]; });
    if (!TABS[S.tab]) S.tab = 'board';
    D = Number(S.dep) || C.deposit_usd;
    SH = (Number(S.sh) || 7.5) / 100;
  }
  function writeHash(patch) {
    Object.keys(patch).forEach(function (k) { S[k] = patch[k]; });
    var parts = Object.keys(DEF).filter((k) => S[k] !== DEF[k]).map((k) => k + '=' + encodeURIComponent(S[k]));
    location.hash = parts.length ? '#' + parts.join('&') : '#tab=board';
  }
  function repriced() { return D !== C.deposit_usd || SH !== C.airdrop_share; }
  function keep() { return repriced() ? '&dep=' + S.dep + '&sh=' + S.sh : ''; }

  /* --- the board at the chosen deposit: model.js's own farmPlan(), re-run per row --- */
  var PRICED = {};
  function board() {
    var key = D + ':' + SH;
    if (!repriced()) return R.board;
    if (!PRICED[key]) PRICED[key] = R.board.map(function (r) {
      var o = {}, f = M.farmPlan(r, D, SH), k;
      for (k in r) o[k] = r[k];
      o.farm = f;
      ['verdict', 'drop_usd', 'cost_usd', 'net_usd', 'hands_on_hours', 'net_per_hour_usd'].forEach((k) => { o[k] = f[k]; });
      return o;
    });
    return PRICED[key];
  }
  function counts(rows) {
    var n = { FARM: 0, MARGINAL: 0, SKIP: 0 };
    rows.forEach((r) => { n[r.verdict]++; });
    return n;
  }

  var TABS = {
    board: { label: 'Pre-token board', n: K.board_size },
    live: { label: 'Live comps', n: K.comps_size, alt: true },
    aside: { label: 'Set aside', n: K.aside_size },
    model: { label: 'Model & method', n: null }
  };
  /** The rows of the open tab that pass every filter: name, category and chain are all searched. */
  function visible(rows) {
    var q = S.q.trim().toLowerCase();
    return rows.filter(function (r) {
      if (q && (r.name + ' ' + r.slug + ' ' + (r.category || '') + ' ' + (r.chains || []).join(' ')).toLowerCase().indexOf(q) < 0) return false;
      if (S.fam && (r.family || 'none') !== S.fam) return false;
      if (S.v && r.verdict !== S.v) return false;
      if (S.w === 'watch' && !r.watchlist) return false;
      if (S.w === 'early' && (r.watchlist || r.above_floor !== false)) return false;
      return true;
    });
  }
  function active() { return S.q || S.fam || S.v || S.w !== 'all'; }

  /** A row of buttons setting one field: the family chips, the verdict chips, the deposit. */
  function pick(field, pairs, cls) {
    return '<div class="' + cls + '">' + pairs.map((o) => '<button data-set="' + field + '" data-val="' + esc(o[0]) +
      '" aria-pressed="' + (S[field] === o[0]) + '">' + esc(o[1]) + (o[2] === undefined ? '' : e('b', '', o[2])) + '</button>').join('') + '</div>';
  }

  function filterBar(total, shown, farm) {
    var n = farm ? counts(board()) : null;
    return '<div class="filters">' +
      '<label for="q">Search</label><input id="q" type="search" data-field="q" value="' + esc(S.q) + '" placeholder="name, category or chain">' +
      pick('fam', [['', 'All families']].concat(R.families.map((f) => [f.key, f.label])), 'chips') +
      (farm ? pick('v', [['', 'Any verdict'], ['FARM', 'Farm', n.FARM], ['MARGINAL', 'Marginal', n.MARGINAL], ['SKIP', 'Skip', n.SKIP]], 'chips') : '') +
      '<span class="brk"></span>' +
      pick('w', [['all', 'All rows'], ['watch', 'Watchlist'], ['early', 'Early']], 'seg') +
      (farm ? '<label>Deposit</label>' + pick('dep', [['1000', '$1,000'], ['10000', '$10,000']], 'seg') +
        '<label>Drop share</label>' + pick('sh', [['5', '5%'], ['7.5', '7.5%'], ['10', '10%']], 'seg') : '') +
      '<span class="count"><b>' + shown + '</b> of ' + total + ' rows' +
      (active() ? '<a href="#tab=' + S.tab + keep() + '">clear filters</a>' : '') + '</span></div>';
  }

  /* A column is [key, label, kind, sort value, cell]: kind 0 text, 1 numeric counting down, 2 up. */

  function cols(spec) {
    return spec.map((c) => ({ k: c[0], h: c[1], num: c[2] > 0, asc: c[2] !== 1, val: c[3], cell: c[4] || c[3] }));
  }

  function table(rows, cs, fb, note, cls, farm) {
    var act = null, i, dir, d;
    for (i = 0; i < cs.length; i++) if (cs[i].k === S.sort) act = cs[i];
    if (!act) act = fb;
    dir = S.dir || (act.asc ? 'asc' : 'desc');
    d = dir === 'asc' ? 1 : -1;
    // the clicked column first, then always rank, TVL, slug: the order never depends on input order
    var seen = visible(rows).sort(function (a, b) {
      var x = act.val(a), y = act.val(b);
      return (x < y ? -1 : x > y ? 1 : 0) * d || (a.rank || 0) - (b.rank || 0) || (b.tvl_usd - a.tvl_usd) || (a.slug < b.slug ? -1 : 1);
    });
    return filterBar(rows.length, seen.length, farm) + (note ? e('p', 'note', note) : '') +
      '<div class="wrap"><table class="' + (cls || '') + '"><thead><tr>' + cs.map(function (c) {
        var on = c === act, next = on ? (dir === 'asc' ? 'desc' : 'asc') : c.asc ? 'asc' : 'desc';
        return '<th class="' + (c.num ? 'num' : '') + (on ? ' on' : '') + '" aria-sort="' + (on ? dir + 'ending' : 'none') + '">' +
          '<button data-sortby="' + c.k + '" data-dir="' + next + '">' + esc(c.h) + e('i', '', on ? (dir === 'asc' ? '↑' : '↓') : '') + '</button></th>';
      }).join('') + '</tr></thead><tbody>' + seen.map((r) => '<tr class="' + (r.watchlist ? 'watch' : '') + (r.slug === S.p ? ' open' : '') + '">' +
        cs.map((c) => '<td class="' + (c.num ? 'num ' : '') + c.k + '">' + c.cell(r) + '</td>').join('') + '</tr>').join('') +
      '</tbody></table></div>' + (seen.length ? '' : e('p', 'muted', 'No row passes those filters.'));
  }

  /** A small static table: a head row of labels, then rows of cells, the first of each text. */
  function tbl(hd, rows, cls) {
    function tr(cells, t) { return '<tr>' + cells.map((c, i) => '<' + t + (i ? ' class="num"' : '') + '>' + c + '</' + t + '>').join('') + '</tr>'; }
    return '<table class="' + (cls || '') + '"><thead>' + tr(hd, 'th') + '</thead><tbody>' + rows.map((r) => tr(r, 'td')).join('') + '</tbody></table>';
  }

  // One log scale across the whole board: a row's P10-P90 band is as wide on screen as the model's
  // own misses are wide in multiples.
  var LO = Math.log(Math.min.apply(null, R.board.map((r) => r.implied_low_usd)));
  var HI = Math.log(Math.max.apply(null, R.board.map((r) => r.implied_high_usd)));
  function at(v) { return Math.max(0, Math.min(100, ((Math.log(v) - LO) / (HI - LO)) * 100)); }
  function verd(r) { return e('span', 'v ' + r.verdict, r.verdict); }

  function boardTable() {
    var cs = cols([
      ['rank', '#', 2, (r) => r.rank, (r) => r.rank + e('span', 'lh', r.rank_lo + '–' + r.rank_hi)],
      ['name', 'Protocol', 0, (r) => r.name.toLowerCase(), (r) => '<a class="open" href="#tab=board&p=' + encodeURIComponent(r.slug) + keep() + '">' +
        e('span', 'pname', esc(r.name)) + (r.watchlist ? e('span', 'badge', 'watchlist') : r.above_floor ? '' : e('span', 'badge early', 'early')) +
        e('span', 'psub', sub(r)) + '</a>'],
      ['tvl', 'TVL', 1, (r) => r.tvl_usd, (r) => usd(r.tvl_usd)],
      ['d7', '7d', 1, (r) => r.change_7d === null ? -1e9 : r.change_7d, (r) => signed(r.change_7d)],
      ['age', 'No token for', 1, (r) => r.age_days === null ? -1 : r.age_days, (r) => ageText(r.age_days)],
      ['imp', 'Implied value', 1, (r) => r.implied_value_usd, (r) => usd(r.implied_value_usd) +
        '<span class="band"><i style="left:' + at(r.implied_low_usd).toFixed(1) + '%;width:' +
        Math.max(1, at(r.implied_high_usd) - at(r.implied_low_usd)).toFixed(1) + '%"></i><u style="left:' + at(r.implied_value_usd).toFixed(1) + '%"></u></span>' +
        e('span', 'lh', usd(r.implied_low_usd) + ' – ' + usd(r.implied_high_usd))],
      ['drop', 'Drop', 1, (r) => r.drop_usd, (r) => dol(r.drop_usd)],
      ['cost', 'Costs', 1, (r) => r.cost_usd, (r) => dol(r.cost_usd)],
      ['net', 'Net', 1, (r) => r.net_usd, (r) => e('b', r.net_usd > 0 ? 'pos' : 'neg', dol(r.net_usd)) + e('span', 'lh', r.hands_on_hours + ' h hands on')],
      ['verdict', 'Verdict', 1, (r) => ({ FARM: 3, MARGINAL: 2, SKIP: 1 })[r.verdict], verd]
    ]);
    return table(board(), cs, cs[0], 'Drop, costs and net on a ' + usd(D) + ' deposit at ' + pct(SH) + ' of implied value, against the plan’s ' +
      'gas and fees and the ' + pct(C.tbill_apy) + ' a year it gives up.', 'board', 1);
  }

  function liveTable() {
    var cs = cols([
      ['name', 'Live token', 0, (r) => r.name.toLowerCase(), (r) => e('span', 'pname', esc(r.name)) + e('span', 'badge ochre', 'live') + e('span', 'psub', sub(r))],
      ['tvl', 'TVL', 1, (r) => r.tvl_usd, (r) => usd(r.tvl_usd)],
      ['mcap', 'Market cap', 1, (r) => r.mcap_usd, (r) => usd(r.mcap_usd)],
      ['ratio', 'mcap / TVL', 1, (r) => r.ratio, (r) => mult(r.ratio)],
      ['curve', 'The curve says', 1, (r) => r.curve_usd, (r) => usd(r.curve_usd)],
      ['miss', 'Miss', 1, (r) => -r.miss_x, (r) => r.miss_x + '×']
    ]);
    return table(R.comps, cs, cs[2], 'The ' + K.comps_size + ' tokens that already trade, one row per token: the curve’s own evidence, ' +
      'and its miss where the answer is known.');
  }

  function asideTable() {
    var cs = cols([
      ['name', 'Protocol', 0, (r) => r.name.toLowerCase(), (r) => e('span', 'pname', esc(r.name)) + e('span', 'psub', sub(r))],
      ['tvl', 'TVL', 1, (r) => r.tvl_usd, (r) => usd(r.tvl_usd)],
      ['why', 'Why it is set aside, not ranked', 0, (r) => r.reason.toLowerCase(), (r) => esc(r.reason)]
    ]);
    return table(R.aside, cs, cs[1], K.aside_size + ' protocols that are a derivative of one that already trades: each with its reason, ' +
      'never ranked and never a comp.');
  }

  /* --- the three cards above the board --- */
  /** The formula with the numbers this snapshot fitted, and the function behind each term. */
  function builtCard() {
    var fs = R.families.map((f) => f.factor);
    return e('div', 'card',
      '<h3>How a value is built <code>buildRadar()</code></h3>' +
      e('p', 'fx', '<b>log<sub>10</sub> V</b> = ' + F.a + ' + ' + F.b + ' × log<sub>10</sub>(TVL / $100M) + offset + momentum + clock') +
      '<ol>' + [
        '<b>Size curve</b> <code>fitCurve()</code> — a Huber fit on the ' + F.n + ' clean comps: $100M of TVL prices at ' +
          usd(F.pivot_value_usd) + ', and ten times the TVL buys ' + Math.pow(10, F.b).toFixed(1) + '× the cap, not ten.',
        '<b>Family &amp; category offset</b> <code>fitAll()</code> — its bucket’s median residual, shrunk with k=' + C.shrink_k +
          ', a category pricing itself only at ' + C.min_cat_comps + ' comps or more: ' + mult(Math.min.apply(null, fs)) + ' to ' + mult(Math.max.apply(null, fs)) + '.',
        '<b>7-day momentum</b> — (1 + change)<sup>' + C.growth_power + '</sup>, the move held inside −' + -C.growth_floor + '% to +' + C.growth_cap + '%.',
        '<b>No-token clock</b> <code>fitClock()</code> — ' + pct(1 - CL[0].share_token) + ' of protocols under 180 days record no token, ' +
          pct(1 - CL[4].share_token) + ' of those over three years: ' + mult(CL[0].factor) + ' young, ' + mult(CL[4].factor) + ' old.'
      ].map((x) => e('li', '', x)).join('') + '</ol>' +
      e('p', 'note', 'The band ×' + Math.pow(10, R.band.lo).toFixed(2) + ' to ×' + Math.pow(10, R.band.hi).toFixed(1) + ' is the P10–P90 of ' +
        'its own leave-one-out misses; the rank range, of ' + C.boot_refits + ' refits on resampled comps.'));
  }

  /** Every comp, every ranked row at its implied value, and the fitted curve through them. */
  function scatterCard() {
    var W = 430, H = 186, L = 46, B = 23, T = 9, G = 20, s = '', i, k;
    var P = R.comps.map((c) => [lg(c.tvl_usd), lg(c.mcap_usd), 0]).concat(R.board.map((r) => [lg(r.tvl_usd), lg(r.implied_value_usd), 1]));
    var xs = P.map((p) => p[0]), ys = P.map((p) => p[1]);
    var x0 = Math.floor(Math.min.apply(null, xs)), x1 = Math.ceil(Math.max.apply(null, xs) - 0.15);
    var y0 = Math.floor(Math.min.apply(null, ys)), y1 = Math.ceil(Math.max.apply(null, ys));
    function X(v) { return (L + (Math.min(x1, Math.max(x0, v)) - x0) / (x1 - x0) * (W - L - G)).toFixed(1); }
    function Y(v) { return (H - B - (Math.min(y1, Math.max(y0, v)) - y0) / (y1 - y0) * (H - B - T)).toFixed(1); }
    function ln(c, a, b, d, f) { return '<line class="' + c + '" x1="' + a + '" y1="' + b + '" x2="' + d + '" y2="' + f + '"/>'; }
    function ax(x, y, an, t) { return '<text class="ax" x="' + x + '" y="' + y + '" text-anchor="' + an + '">' + t + '</text>'; }
    for (k = x0; k <= x1; k++) s += ln('g', X(k), T, X(k), H - B) + ax(X(k), H - 10, 'middle', decade(k));
    for (k = y0; k <= y1; k++) s += ln('g', L, Y(k), W - G, Y(k)) + ax(L - 6, +Y(k) + 3, 'end', decade(k));
    s += ln('cv', X(x0), Y(F.a + F.b * (x0 - 8)), X(x1), Y(F.a + F.b * (x1 - 8)));
    for (i = 0; i < P.length; i++) s += '<circle class="' + (P[i][2] ? 'p' : 'c') + '" cx="' + X(P[i][0]) + '" cy="' + Y(P[i][1]) + '" r="' + (P[i][2] ? 2 : 2.6) + '"/>';
    return e('div', 'card',
      '<h3>The comps set the curve, the board sits on it</h3>' +
      '<svg class="sc" viewBox="0 0 ' + W + ' ' + H + '" role="img" aria-label="Market cap against TVL, both on log scales: the comps, ' +
      'the fitted curve, and the ranked rows at their implied value.">' + s + '</svg>' +
      e('p', 'legend', '<b class="c">●</b> ' + K.comps_size + ' traded comps: market cap<b class="p">●</b> ' + K.board_size +
        ' ranked rows: implied value<b class="l">—</b> the curve, before any offset') +
      e('p', 'note', 'Both axes are decades; the curve rises ' + F.b + ' of a decade per decade of TVL, so the multiple falls as TVL rises.'));
  }

  /** The ablation: each term in turn, on comps the fit never saw. */
  function ablation(full) {
    return tbl(full ? ['Model', 'LOO miss', '≤3×', 'Rank corr', 'Split miss', 'Split ≤3×'] : ['Each term added in turn', 'LOO miss', '≤3×', 'Corr', 'Split'],
      R.ablation.map(function (a, i) {
        var last = i === R.ablation.length - 1, row = [last && !full ? e('b', '', esc(a.term)) : esc(a.term), a.loo.median_x.toFixed(2) + '×',
          pct(a.loo.within_3x), a.loo.spearman.toFixed(full ? 3 : 2), a.split ? a.split.median_x.toFixed(2) + '×' : '—'];
        return full ? row.concat([a.split ? pct(a.split.within_3x) : '—']) : row;
      }), 'ab');
  }

  function oosCard() {
    return e('div', 'card', '<h3>Out of sample <code>ablation()</code></h3>' + ablation(0) +
      e('p', 'note', 'Each comp priced by a fit refitted without it: the median miss falls ' + FLAT.loo.median_x.toFixed(2) + '× → ' +
        AB.loo.median_x.toFixed(2) + '×, ' + pct(AB.loo.within_3x) + ' land within 3×, and the split before ' + esc(R.split.cut) +
        ' agrees. The curve earns most of it; the rest are shrunk or halved.'));
  }

  /* --- one protocol: the value walk, the comps behind it, the costed plan --- */
  function detail(r) {
    var f = r.farm, bk = CL[r.age_bucket], nc = r.comps_in_category;
    var walk = [
      box('f', 'TVL', usd(r.tvl_usd), 'the snapshot’s figure'),
      box('f', 'Size curve', mult(r.size_multiple), '10^(' + F.a + ' + ' + F.b + ' × log10(TVL/$100M)) over TVL'),
      box('f', 'Family offset', mult(r.offset_factor), nc + ' comp' + (nc === 1 ? '' : 's') + ' in its category, ' + r.comps_in_family +
        ' in its family' + (nc < C.min_cat_comps ? ': priced off the family' : '')),
      box('f', 'Momentum', mult(r.momentum_factor), '7d ' + (r.change_7d === null ? 'not recorded, counted flat' :
        (r.momentum_pct >= 0 ? '+' : '') + r.momentum_pct.toFixed(1) + '%') + ', damped to its root'),
      box('f', 'No-token clock', mult(r.clock_factor), bk.label + ': ' + pct(1 - bk.share_token) + ' of that age still record none'),
      box('f out', 'Implied value', usd(r.implied_value_usd), usd(r.implied_low_usd) + ' – ' + usd(r.implied_high_usd) + ' band, P10–P90')
    ];
    return '<div class="crumb"><a href="#tab=board' + keep() + '">← Back to the board</a>' +
      '<h2>#' + r.rank + ' ' + esc(r.name) + (r.watchlist ? e('span', 'badge', 'watchlist') : '') + '</h2>' +
      e('span', 'muted', sub(r) + ' · ' + esc(R.family_labels[r.family]) + ' · records no token') + '</div>' +
      '<div class="walk">' + walk.slice(0, 5).join(e('div', 'op', '×')) + e('div', 'op', '=') + walk[5] + '</div>' +
      '<div class="cols"><div>' +
      '<h3>What it is worth, on what evidence</h3>' + e('div', 'card kv', [
        ['Implied value', usd(r.implied_value_usd)],
        ['Band, P10–P90 of the misses', usd(r.implied_low_usd) + ' – ' + usd(r.implied_high_usd)],
        ['Rank over ' + C.boot_refits + ' refits', '#' + r.rank + ' (' + r.rank_lo + '–' + r.rank_hi + ')'],
        ['Comps in category / family', nc + ' / ' + r.comps_in_family],
        ['Confidence', r.confidence],
        ['Expected drop on ' + usd(f.deposit_usd) + ' at ' + pct(f.share), dol(r.drop_usd)]
      ].map((o) => box('', o[0], o[1])).join('')) +
      '<h3>Its nearest comps, and what the curve charges</h3>' +
      tbl(['Traded token', 'TVL', 'Market cap', 'mcap / TVL', 'Curve', 'Miss'], M.peersFor(R, r, 5).map((p) =>
        [e('span', 'pname', esc(p.name)) + e('span', 'psub', esc(p.category || 'no category')), usd(p.tvl_usd), usd(p.mcap_usd),
          mult(p.ratio), usd(p.curve_usd), p.miss_x + '×'])) +
      (r.flags.length ? '<h3>Data flags</h3><ul class="flags">' + r.flags.map((x) => e('li', '', esc(x))).join('') + '</ul>' : '') +
      e('p', 'note', 'It <b>records</b> no token: no id, no ticker, no market cap, and no claim one is coming.') +
      '</div><div class="wide">' +
      '<h3>Farm plan · ' + (f.chain ? esc(f.chain) : 'no chain named') + ' · ' + usd(f.deposit_usd) + ' held ' + f.hold_days + ' days · ' + verd(r) + '</h3>' +
      '<div class="sum">' +
      box('', 'Expected drop', dol(r.drop_usd), pct(f.share) + ' of value by deposit share — an estimate, not a promise') +
      box('', 'Costs', dol(r.cost_usd), dol(f.fees_usd) + ' of gas and fees from the steps, ' + dol(f.opportunity_usd) + ' of yield forgone') +
      box('', 'Net, per hands-on hour', dol(r.net_usd), r.hands_on_hours + ' h of attention — ' + dol(r.net_per_hour_usd) + ' an hour') + '</div>' +
      '<table class="plan"><thead><tr><th>Step</th><th>Cost</th><th>Time</th></tr></thead><tbody>' +
      ((PLANS[S.dep] || {})[r.slug] || f.steps.map((s) => ['Step ' + s.key, dol(s.cost_usd), s.hours + ' h']))
        .map((s, i) => '<tr><td class="step">' + e('span', 'n', i + 1) + esc(s[0]) + '</td>' +
          e('td', 'cost', esc(s[1])) + e('td', 'time', esc(s[2])) + '</tr>').join('') + '</tbody></table></div></div>';
  }

  /* --- model & method: what model.js computed, printed as it stands --- */
  function modelTab() {
    var own = R.categories.filter((c) => c.own);
    return '<div class="cols"><div>' +
      '<h3>The formula, with this snapshot’s numbers</h3>' +
      e('div', 'fbox', '<code>log10 V = ' + F.a + ' + ' + F.b + ' × log10(TVL / $100M) + family offset + momentum + no-token clock</code>') +
      e('p', 'note', '<code>fitCurve()</code>, a Huber regression on the ' + F.n + ' clean comps: live tokens with a market cap, one row ' +
        'per token, set-aside kinds out. σ = ' + F.sigma + ' dex; a flat multiple would charge every one ' + mult(F.flat_multiple) + ' of TVL.') +
      '<h3>Family offsets, shrunk with k=' + C.shrink_k + '</h3>' +
      tbl(['Family', 'Comps', 'Raw', 'Shrunk', 'Factor', 'Board rows'], R.families.map((f) =>
        [esc(f.label), f.n, f.raw === null ? '—' : f.raw.toFixed(3), f.offset.toFixed(3), mult(f.factor), f.rows])) +
      e('p', 'note', 'Raw is the bucket’s median residual in dex, shrunk is what k lets it keep, clamped to ±' + C.offset_clamp + ' dex. Only ' +
        'a category with ' + C.min_cat_comps + ' comps or more prices itself (' + esc(own.map((c) => c.category + ' ' + c.n).join(', ')) + ').') +
      '<h3>The no-token clock, fitted here</h3>' +
      tbl(['Age', 'Protocols', 'With a token', 'Still none', 'Factor'], CL.map((c) =>
        [esc(c.label), c.n, pct(c.share_token || 0), pct(1 - (c.share_token || 0)), mult(c.factor)])) +
      e('p', 'note', 'Over every protocol the snapshot keeps at ' + usd(C.clock_min_tvl) + ' or more that no rule sets aside. One still ' +
        'tokenless after three years is in a shrinking minority, so the clock discounts it, damped to its root; no listing date means the ' +
        esc(CL[2].label) + ' bucket and a flag. <b>“Records no token” is not “has no token”</b>: no id, no ticker, no market cap.') +
      '</div><div>' +
      '<h3>Out of sample, every term in turn</h3>' + ablation(1) +
      e('p', 'note', 'Leave-one-out refits the whole model ' + AB.loo.n + ' times, each without the comp it then prices; the split fits on ' +
        'the ' + R.split.n_fit + ' comps listed before ' + esc(R.split.cut) + ' and tests on the ' + R.split.n_test + ' listed after. The size ' +
        'curve earns its place on both; the offsets pay leave-one-out and cost a little on the split, so they are shrunk, and momentum and the ' +
        'clock run at half strength because at full strength both are worse.') +
      '<h3>What a verdict assumes</h3>' +
      tbl(['Assumption', 'As it stands'], [
        ['Airdrop', pct(SH) + ' of implied value, by the deposit’s share of TVL'],
        ['Deposit', usd(D) + ', never over ' + (C.max_pos_share * 100).toFixed(2) + '% of TVL' + (D === C.deposit_usd ? ' — board.json’s own' : '')],
        ['Costs', 'the plan’s gas and fees, step by step, plus ' + pct(C.tbill_apy) + ' a year of T-bill yield while held'],
        ['Gas', '$0.01 a transaction on Solana, $0.02–$0.10 on an L2, $2–$6 on Ethereum: the cheapest chain it is on'],
        ['Holding', '45 to 90 days by age: the younger the record, the longer the hold'],
        ['Verdict', 'FARM when the drop covers its costs ' + C.farm_ratio + '× over, MARGINAL when it only nets, else SKIP']
      ]) +
      '<h3>The universe, split</h3>' +
      tbl(['All ' + SNAP.protocols.length + ' protocols in the snapshot', 'Rows'], [
        ['Record no token: ranked here', K.board_size],
        ['Already trade: the comps the curve is fitted on', K.comps_size],
        ['Set aside by rule: a derivative of one that trades', K.aside_size],
        ['A token with no market cap: nothing to fit', SNAP.protocols.length - K.board_size - K.comps_size - K.aside_size]
      ]) +
      '</div></div>';
  }

  function render() {
    var B = board(), open = S.tab === 'board' && S.p, n = counts(B), body, row = null;
    if (open) {
      B.forEach(function (r) { if (r.slug === S.p) row = r; });
      body = row ? detail(row) : e('p', 'muted', 'No ranked row carries that slug. <a href="#tab=board">Back.</a>');
    } else {
      body = S.tab === 'live' ? liveTable() : S.tab === 'aside' ? asideTable() : S.tab === 'model' ? modelTab() : boardTable();
    }
    root.innerHTML =
      '<div class="top"><div><h1>Token Launch <em>Radar</em></h1>' +
      e('p', 'meta', K.board_size + ' protocols that record no token, ranked by implied value · snapshot ' + esc(R.as_of) + ' from ' +
        esc(String(R.source).split(' ')[0].replace(/^.*\/\//, '')) + ' · model ' + esc(R.model_version)) + '</div>' +
      box('seal ' + (CHECK.ok ? 'ok' : 'bad'), '', (CHECK.ok ? '✓' : '✗') + ' board.json = this page', CHECK.n + '/' + CHECK.of +
        ' ranks, values and verdicts match · seal ' + esc(R.seal) + (repriced() ? ' · plans re-priced here at ' + usd(D) + ' and ' + pct(SH) : '')) +
      '</div><div class="kpis">' + [
        ['Watchlist covered', K.watchlist_covered + '/' + K.watchlist_size, 'every slug ranked, rules or not'],
        ['Rows ranked', String(K.board_size), K.early_size + ' under the ' + usd(R.floor_usd) + ' floor'],
        ['Clean comps fitted', String(K.comps_size), 'one row per token, set-aside out', 1],
        ['Out-of-sample miss', AB.loo.median_x.toFixed(2) + '×', 'a flat multiple misses ' + FLAT.loo.median_x.toFixed(2) + '×'],
        ['Verdicts on ' + usd(D), n.FARM + ' farm', n.MARGINAL + ' marginal · ' + n.SKIP + ' skip'],
        ['Total implied value', usd(K.implied_total_usd), 'the board summed, bands aside']
      ].map((o) => box('kpi' + (o[3] ? ' alt' : ''), o[0], o[1], o[2])).join('') + '</div>' +
      (open || S.tab !== 'board' ? '' : '<div class="cards">' + builtCard() + scatterCard() + oosCard() + '</div>') +
      '<div class="tabs">' + Object.keys(TABS).map(function (k) {
        var t = TABS[k];
        return '<button data-tab="' + k + '" class="' + (t.alt ? 'alt' : '') + '" aria-current="' + (S.tab === k) + '">' +
          t.label + (t.n === null ? '' : e('b', '', t.n)) + '</button>';
      }).join('') + '</div>' + body +
      '<footer>make.fun token-radar-01 · recomputed in the browser by the model.js that wrote board.json · an implied value is a comps ' +
      'estimate, not a price, and none of it is advice.</footer>';
    root.setAttribute('aria-busy', 'false');
  }

  /* --- events: every control writes the hash, and the hash draws the page --- */
  document.addEventListener('click', function (ev) {
    var el = ev.target.closest ? ev.target.closest('[data-tab],[data-set],[data-sortby]') : null, f, patch = {};
    if (!el) return;
    if (el.hasAttribute('data-tab')) {
      writeHash({ tab: el.getAttribute('data-tab'), p: '', sort: '', dir: '' });
    } else if (el.hasAttribute('data-set')) {
      f = el.getAttribute('data-set');           // a filter closes the open row; a deposit re-prices it
      patch[f] = el.getAttribute('data-val');
      if (f !== 'dep' && f !== 'sh') patch.p = '';
      writeHash(patch);
    } else {
      writeHash({ sort: el.getAttribute('data-sortby'), dir: el.getAttribute('data-dir') });
    }
    ev.preventDefault();
  });

  var typing = null;
  document.addEventListener('input', function (ev) {
    if (!ev.target.getAttribute || ev.target.getAttribute('data-field') !== 'q') return;
    var v = ev.target.value;
    clearTimeout(typing);
    typing = setTimeout(function () { writeHash({ q: v, p: '' }); }, 120);
  });

  // The search box keeps its focus and its caret across a redraw, so typing never jumps.
  function draw() {
    var q = document.activeElement && document.activeElement.id === 'q';
    readHash();
    render();
    if (q && (q = document.getElementById('q'))) { q.focus(); q.setSelectionRange(q.value.length, q.value.length); }
  }
  window.addEventListener('hashchange', draw);
  draw();
})();

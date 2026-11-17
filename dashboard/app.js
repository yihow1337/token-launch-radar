/* Token Launch Radar - the view. A classic script, no framework and no network: it recomputes the
   whole radar in the browser out of the raw snapshot with model.js, the same file main.ts ran to write
   board.json, so every number on screen is one the board claims. All state lives in the URL hash
   (#tab=board&p=<slug>&fam=<family>&w=watch&sort=imp&dir=desc), so any view can be linked and shot. */
(function () {
  'use strict';

  var root = document.getElementById('main');
  var M = window.RadarModel, SNAP = window.RADAR_SNAPSHOT;
  if (!M || !SNAP) { root.textContent = 'data.js or model.js did not load.'; return; }
  var R = M.buildRadar(SNAP), C = M.CONSTANTS, K = R.kpis, BT = R.backtest;

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
    live: { label: 'Live tokens', n: K.live_size, alt: true },
    aside: { label: 'Set aside', n: K.aside_size },
    model: { label: 'Model & method', n: null }
  };

  /* --- filters --- */

  var TVL_STEPS = [['0', 'any'], ['5', '$5M'], ['20', '$20M'], ['50', '$50M (floor)'], ['250', '$250M'], ['1000', '$1B']];
  var CHAINS = (function () {
    var seen = {};
    R.board.concat(R.live, R.aside).forEach(function (r) { (r.chains || []).forEach(function (c) { seen[c] = (seen[c] || 0) + 1; }); });
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

  var CONF_ORDER = { High: 3, Medium: 2, Low: 1 };

  /** Columns as [key, label, kind, value], kind 0 = text, 1 = numeric, 2 = numeric but counting up. */
  function cols(list) {
    return list.map(function (c) { return { k: c[0], label: c[1], num: c[2] > 0, asc: c[2] !== 1, val: c[3] }; });
  }
  var BOARD_COLS = cols([
    ['rank', 'Rank', 2, (r) => r.rank],
    ['name', 'Protocol', 0, (r) => r.name.toLowerCase()],
    ['tvl', 'TVL', 1, (r) => r.tvl_usd],
    ['d7', '7d', 1, (r) => r.change_7d === null ? -1e9 : r.change_7d],
    ['age', 'No-token runway', 1, (r) => r.age_days === null ? -1 : r.age_days],
    ['mult', 'Peer multiple', 1, (r) => r.peer_multiple],
    ['imp', 'Implied value', 1, (r) => r.implied_value_usd],
    ['ev', 'EV per $1k', 1, (r) => r.ev_per_1k_usd],
    ['conf', 'Confidence', 1, (r) => CONF_ORDER[r.confidence]]
  ]);
  var LIVE_COLS = cols([
    ['name', 'Live token', 0, (r) => r.name.toLowerCase()],
    ['tvl', 'TVL', 1, (r) => r.tvl_usd],
    ['mcap', 'Market cap', 1, (r) => r.mcap_usd],
    ['ratio', 'mcap / TVL', 1, (r) => r.ratio],
    ['d7', '7d', 1, (r) => r.change_7d === null ? -1e9 : r.change_7d]
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
      '<td class="rank num">' + r.rank + '</td>' +
      '<td><a class="open" href="#tab=board&p=' + encodeURIComponent(r.slug) + '"><span class="pname">' + esc(r.name) + '</span>' +
      (r.watchlist ? '<span class="badge">watchlist</span>' : r.above_floor ? '' : '<span class="badge early">early</span>') +
      '<span class="psub">' + sub(r) + '</span></a></td>' +
      num(usd(r.tvl_usd)) +
      num(pctCell(r.change_7d)) +
      num(runwayText(r.age_days)) +
      num(mult(r.peer_multiple)) +
      '<td class="num imp">' + usd(r.implied_value_usd) + band(r) +
      '<span class="lh">' + usd(r.implied_low_usd) + ' – ' + usd(r.implied_high_usd) + '</span></td>' +
      num(dollars(r.ev_per_1k_usd)) +
      num('<span class="conf ' + r.confidence + '">' + r.confidence + '</span>') + '</tr>';
  }

  function boardTable() {
    var rows = sortRows(visible(R.board), BOARD_COLS, BOARD_COLS[0]);
    return filterBar(R.board.length, rows.length) +
      '<div class="wrap"><table class="board">' + head(BOARD_COLS, BOARD_COLS[0]) +
      '<tbody>' + rows.map(boardRow).join('') + '</tbody></table></div>' +
      (rows.length ? '' : '<p class="muted">No row passes those filters.</p>');
  }

  /* --- live tokens: the comps the multiples are read off --- */

  function liveTable() {
    var rows = sortRows(visible(R.live), LIVE_COLS, LIVE_COLS[2]);
    return filterBar(R.live.length, rows.length) +
      '<p class="note">These ' + K.live_size + ' protocols already have a token that trades, so they are never ranked: they are ' +
      'the evidence. Every peer multiple on the board is the median log10(mcap / TVL) of this table, over the row\'s category, ' +
      'then its family, then the whole market.</p>' +
      '<div class="wrap"><table>' + head(LIVE_COLS, LIVE_COLS[2]) + '<tbody>' + rows.map(function (r) {
        return '<tr><td><span class="pname">' + esc(r.name) + '</span><span class="badge ochre">live</span>' +
          '<span class="psub">' + sub(r) + '</span></td>' +
          num(usd(r.tvl_usd)) + num(usd(r.mcap_usd)) + num(mult(r.ratio)) + num(pctCell(r.change_7d)) + '</tr>';
      }).join('') + '</tbody></table></div>';
  }

  function asideTable() {
    var rows = sortRows(visible(R.aside), ASIDE_COLS, ASIDE_COLS[1]);
    return filterBar(R.aside.length, rows.length) +
      '<p class="note">' + K.aside_size + ' protocols record no token but are not a launch of their own: a wrapper, a bridge, a ' +
      'staked or versioned product of an asset that trades. Shown with their reason, not dropped — except a watchlist slug a ' +
      'rule touches, which is ranked anyway and flagged.</p>' +
      '<div class="wrap"><table>' + head(ASIDE_COLS, ASIDE_COLS[1]) + '<tbody>' + rows.map(function (r) {
        return '<tr><td><span class="pname">' + esc(r.name) + '</span><span class="psub">' + sub(r) + '</span></td>' +
          num(usd(r.tvl_usd)) + '<td>' + esc(r.reason) + '</td></tr>';
      }).join('') + '</tbody></table></div>';
  }

  /* --- one protocol: the value walk, the comps behind it and the farm plan --- */

  function factor(label, value, note, out) {
    return '<div class="f' + (out ? ' out' : '') + '"><span>' + label + '</span><b>' + value + '</b><i>' + note + '</i></div>';
  }

  function detail(r) {
    var f = r.farm, peers = M.peersFor(R, r, 4);
    var walk = [
      factor('TVL', usd(r.tvl_usd), 'the snapshot\'s own figure'),
      factor('Peer multiple', mult(r.peer_multiple), r.comps_in_category + ' live comp' + (r.comps_in_category === 1 ? '' : 's') +
        ' in its category, ' + r.comps_in_family + ' in its family: centre ' + mult(r.peer_centre) + ' × size tilt ' +
        r.size_tilt.toFixed(2) + '×'),
      factor('Momentum', r.momentum_factor.toFixed(3) + '×', '7d ' + (r.change_7d === null ? 'not recorded, counted flat' : signed(r.momentum_pct)) + ', damped to its root'),
      factor('No-token runway', r.runway_factor.toFixed(3) + '×', (r.age_days === null ? 'no listing date, counted 365 d' : r.age_days + ' days with no token') + ', 0.8 → 1.2 at 3 yr'),
      factor('Implied value', usd(r.implied_value_usd), 'band ' + usd(r.implied_low_usd) + ' – ' + usd(r.implied_high_usd), true)
    ];
    var kv = [
      ['Implied value', usd(r.implied_value_usd)],
      ['Low – high band', usd(r.implied_low_usd) + ' – ' + usd(r.implied_high_usd)],
      ['Peer multiple band', mult(r.peer_multiple_low) + ' – ' + mult(r.peer_multiple_high)],
      ['Live comps in its category / family', r.comps_in_category + ' / ' + r.comps_in_family],
      ['Confidence', r.confidence],
      ['EV on a $' + C.deposit_usd.toLocaleString('en-US') + ' deposit', dollars(r.ev_per_1k_usd) + ' at ' + pct(C.airdrop_share) + ' of implied value']
    ];
    return '<div class="crumb"><a href="#tab=board">← Back to the board</a>' +
      '<h2>#' + r.rank + ' ' + esc(r.name) + (r.watchlist ? '<span class="badge">watchlist</span>' : '') + '</h2>' +
      '<span class="muted">' + sub(r) + ' · ' + esc(r.family_label) + ' · records no token</span></div>' +
      '<div class="walk">' + walk.slice(0, 4).join('<div class="op">×</div>') + '<div class="op">=</div>' + walk[4] + '</div>' +
      '<div class="cols"><div>' +
      '<h3>What it is worth, and on what evidence</h3><div class="card">' +
      kv.map((o) => '<div class="kv"><span>' + o[0] + '</span><b>' + o[1] + '</b></div>').join('') + '</div>' +
      '<h3>Nearest live-token comps</h3><table><thead><tr><th>Token</th><th class="num">TVL</th>' +
      '<th class="num">Market cap</th><th class="num">mcap / TVL</th></tr></thead><tbody>' +
      peers.map(function (p) {
        return '<tr><td><span class="pname">' + esc(p.name) + '</span><span class="psub">' + esc(p.category || 'no category') + '</span></td>' +
          num(usd(p.tvl_usd)) + num(usd(p.mcap_usd)) + num(mult(p.ratio)) + '</tr>';
      }).join('') + '</tbody></table>' +
      (r.flags.length ? '<h3>Data flags</h3><ul class="flags">' + r.flags.map((x) => '<li>' + esc(x) + '</li>').join('') + '</ul>' : '') +
      '<p class="note">It <b>records</b> no token: this snapshot holds no CoinGecko id, ticker or market cap for it. The ' +
      'implied value is what the comps above say a protocol of this category and size is worth — not a price — and the farm ' +
      'plan estimates cost and time, not advice.</p>' +
      '</div><div class="wide">' +
      '<h3>Farm plan · ' + (f.chain ? esc(f.chain) : 'no chain named') + ' · ' + usd(f.deposit_usd) + ' held ' + f.hold_days + ' days</h3>' +
      '<div class="sum"><div><span>Total cost</span><b>' + esc(f.total_cost) + '</b></div>' +
      '<div><span>Total time</span><b>' + esc(f.total_time) + '</b></div>' +
      '<div><span>Expected airdrop on it</span><b>' + dollars(f.ev_usd) + ' — an estimate from the stated assumptions, not a promise</b></div></div>' +
      '<table class="plan"><thead><tr><th>Step</th><th>Cost</th><th>Time</th></tr></thead><tbody>' +
      f.steps.map(function (s, i) {
        return '<tr><td class="step"><span class="n">' + (i + 1) + '</span>' + esc(s.action) + '</td>' +
          '<td class="cost">' + esc(s.cost) + '</td><td class="time">' + esc(s.time) + '</td></tr>';
      }).join('') + '</tbody></table></div></div>';
  }

  /* --- model & method --- */

  function statRow(label, s, best) {
    return '<tr' + (best ? ' class="best"' : '') + '><td>' + label + '</td>' + num(s.median_x.toFixed(2) + '×') +
      num(pct(s.within_3x)) + num(s.spearman.toFixed(3)) + '</tr>';
  }

  // The Model tab prints the constants out of model.js itself, so the page cannot quote a number the
  // model does not use: change a constant there and this table, the board and board.json all move.
  function constantRows() {
    return [
      ['Peer multiple', 'median log10(mcap / TVL) of the ' + R.comps.n + ' live tokens, winsorized ' + (C.winsor_lo * 100) +
        '–' + (C.winsor_hi * 100) + 'th, shrunk category → family → market with k = ' + C.shrink_k + ', tilted ' +
        R.comps.size_beta.toFixed(3) + ' per decade of TVL about ' + usd(R.comps.size_pivot_usd) + '; half the bucket\'s ' +
        'IQR either way is the band', mult(R.comps.global_multiple) + ' market-wide'],
      ['Momentum', '(1 + clamp(7d, ' + C.growth_floor + ', +' + C.growth_cap + ')/100) ^ ' + C.growth_power +
        ' — one week of TVL is noise as much as signal', '0.77× to 1.26×'],
      ['No-token runway', C.runway_floor + ' + ' + C.runway_range + ' × min(age, ' + C.runway_days + ' d)/' + C.runway_days +
        ' — a long run with no token is accrued points and survivorship; a missing date counts ' + C.unknown_age_days + ' d',
        C.runway_floor + '× to 1.2×'],
      ['Farm assumptions', pct(C.airdrop_share) + ' of implied value to an airdrop split by deposit share, positions never ' +
        'above 0.01% of TVL, gas priced on the cheapest chain it runs on', '$' + C.deposit_usd.toLocaleString('en-US') + ' deposit']
    ].map(function (o) {
      return '<tr><td><b>' + o[0] + '</b><span class="psub">' + o[1] + '</span></td>' + num(o[2]) + '</tr>';
    }).join('');
  }

  function modelTab() {
    return '<div class="cols"><div>' +
      '<h3>The formula</h3><div class="formula-box"><code>implied value = TVL × peer multiple × momentum × no-token runway</code></div>' +
      '<p class="note">No protocol is named anywhere in the model: the rules see category strings, chain names, TVL, the ' +
      '7-day change and the listing date. ' + esc(R.model_version) + ', fitted on this snapshot\'s own ' + R.comps.n +
      ' live tokens — no outside data, no clock.</p>' +
      '<table><tbody>' + constantRows() + '</tbody></table>' +
      '<p class="note"><b>“Records no token” is not “has no token”.</b> It means this snapshot holds no CoinGecko id, no ' +
      'ticker and no market cap for the protocol. It is not a claim that a token is coming, and nothing here is advice.</p>' +
      '</div><div>' +
      '<h3>Backtest: leave one out over the ' + BT.model.n + ' live tokens</h3>' +
      '<p class="note">Each market cap predicted from its own TVL, category, 7-day change and age, the comps refitted ' +
      'without it — the four numbers the board has on a protocol whose token does not exist yet.</p>' +
      '<table><thead><tr><th>Series</th><th class="num">Median error</th><th class="num">Within 3×</th>' +
      '<th class="num">Spearman</th></tr></thead><tbody>' +
      statRow('<b>' + esc(R.model_version) + '</b> — what the board runs', BT.model, true) +
      statRow('The same comps without the size tilt', BT.no_size) +
      statRow('Naive baseline: global median multiple × TVL', BT.naive) +
      '</tbody></table>' +
      '<p class="note">The size tilt buys the error (' + BT.no_size.median_x.toFixed(2) + '× → ' + BT.model.median_x.toFixed(2) +
      '×) and costs a little rank order (ρ ' + BT.no_size.spearman.toFixed(3) + ' → ' + BT.model.spearman.toFixed(3) + '). A live ' +
      'token\'s market cap is not what a pre-token protocol\'s would be, so this measures the model\'s reach and no more — ' +
      'which is why the baseline is printed beside it.</p>' +
      '<h3>Fitted multiples by family</h3>' +
      '<table><thead><tr><th>Family</th><th class="num">Comps</th><th class="num">Median</th><th class="num">Shrunk</th>' +
      '<th class="num">Band</th><th class="num">Board rows</th></tr></thead><tbody>' +
      R.families.map(function (f) {
        return '<tr><td>' + esc(f.label) + '</td>' + num(f.n) +
          num(f.median === null ? '<span class="muted">—</span>' : mult(f.median)) + num(mult(f.shrunk)) +
          num(mult(f.low) + ' – ' + mult(f.high)) + num(f.board_rows) + '</tr>';
      }).join('') +
      '<tr class="best"><td>Whole market</td>' + num(R.comps.n) + num(mult(R.comps.global_median)) +
      num(mult(R.comps.global_multiple)) + num(mult(R.comps.winsor_low) + ' – ' + mult(R.comps.winsor_high)) +
      num(K.board_size) + '</tr>' +
      '</tbody></table></div></div>';
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
      '<div class="formula"><b>TVL × peer multiple × momentum × no-token runway</b>' +
      'multiples fitted on this snapshot\'s own ' + R.comps.n + ' live tokens</div></div>' +
      (open ? '' : '<div class="kpis">' +
      kpi('Watchlist covered', K.watchlist_covered + '/' + K.watchlist_size, 'every slug ranked, rules or not') +
      kpi('Pre-token rows ranked', String(K.board_size), K.early_size + ' below the ' + usd(R.floor_usd) + ' floor') +
      kpi('Live comps used', String(K.live_size), 'market median ' + mult(R.comps.global_multiple) + ' of TVL', true) +
      kpi('Backtest median error', BT.model.median_x.toFixed(2) + '×', 'naive baseline ' + BT.naive.median_x.toFixed(2) + '×') +
      kpi('Within 3× / Spearman', pct(BT.model.within_3x) + ' / ' + BT.model.spearman.toFixed(3), 'naive ' + pct(BT.naive.within_3x) + ' / ' + BT.naive.spearman.toFixed(3)) +
      kpi('Total implied value', usd(K.implied_total_usd), 'sum of the board, bands aside') + '</div>') +
      '<div class="tabs">' + Object.keys(TABS).map(function (k) {
        var t = TABS[k];
        return '<button data-tab="' + k + '" class="' + (t.alt ? 'alt' : '') + '" aria-current="' + (S.tab === k) + '">' +
          t.label + (t.n === null ? '' : '<b>' + t.n + '</b>') + '</button>';
      }).join('') + '</div>' + body +
      '<footer>make.fun token-radar-01 · every number here is recomputed in the browser from the raw snapshot by the ' +
      'same model.js that wrote board.json · implied value is a comps estimate, not a price, and none of it is advice.</footer>';
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

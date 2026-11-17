/* Placeholder view: the designed page lands in the next pass. It proves the wiring - the page builds
   the board in the browser from the raw snapshot with the same model.js the program ran. */
(function () {
  'use strict';
  var main = document.getElementById('main');
  if (!window.RADAR_SNAPSHOT || !window.RadarModel) { main.textContent = 'data.js or model.js did not load.'; return; }
  var r = window.RadarModel.buildRadar(window.RADAR_SNAPSHOT);
  var usd = function (n) { return n >= 1e9 ? '$' + (n / 1e9).toFixed(2) + 'B' : n >= 1e6 ? '$' + (n / 1e6).toFixed(1) + 'M' : '$' + Math.round(n); };
  var rows = r.board.slice(0, 50).map(function (b) {
    return '<tr><td>' + b.rank + '</td><td>' + b.name + '</td><td>' + usd(b.tvl_usd) + '</td><td>' + b.peer_multiple +
      '</td><td>' + usd(b.implied_value_usd) + '</td><td>' + b.confidence + '</td></tr>';
  }).join('');
  main.innerHTML = '<h1>Token Launch Radar</h1><p class="sub">' + r.model_version + ' · ' + r.as_of + ' · ' +
    r.kpis.board_size + ' pre-token rows, ' + r.kpis.watchlist_covered + '/' + r.kpis.watchlist_size + ' of the watchlist, ' +
    r.kpis.live_size + ' live comps</p><table><thead><tr><th>Rank</th><th>Protocol</th><th>TVL</th><th>Peer multiple</th>' +
    '<th>Implied value</th><th>Confidence</th></tr></thead><tbody>' + rows + '</tbody></table>';
  main.setAttribute('aria-busy', 'false');
})();

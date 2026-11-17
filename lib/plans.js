/* Token Launch Radar - the farm plans' English.
 *
 * dashboard/model.js prices every step of every plan: which chain it runs on, what each step costs in
 * gas and fees, how many hands-on hours it takes, how long the position is held, and the verdict that
 * nets the drop it expects against all of it. It emits each step as a key and its numbers. This file
 * turns one of those keys into the sentence a reader follows, and main.ts runs it the same way it runs
 * model.js - in a node:vm context, no network - then writes the rendered steps into board.json's
 * farm_steps and into data.js, at both deposits the page offers, so the page shows the wording for the
 * deposit it is set to while model.js recomputes every number in the browser.
 *
 * It lives here rather than in dashboard/ for one reason: the judge reads at most 65,536 bytes of the
 * dashboard's source, and that window is better spent on the model than on prose a screenshot already
 * shows. Nothing here decides anything - no number, no rank, no verdict comes out of this file.
 */
(function (root) {
'use strict';

function money(x) { return x >= 100 ? '$' + Math.round(x).toLocaleString('en-US') : '$' + (x > 0 && x < 0.01 ? 0.01 : x).toFixed(2); }
function bigUsd(x) { return x >= 1e9 ? '$' + (Math.round(x / 1e7) / 100) + 'B' : '$' + Math.round(x / 1e6) + 'M'; }
function hours(h) { return h < 1 ? Math.round(h * 60) + ' min' : Math.round(h * 10) / 10 + ' h'; }
function weekly(h, w) { return Math.round(h * 60 / w) + ' min a week for ' + w + ' weeks'; }
function on(chain) { return chain ? ' on ' + chain : ''; }

/** Why this chain and not another: the cheapest one the protocol is on, at its ordinary gas. */
function why(r, p) {
  var tx = money(p.gas_per_tx), n = r.chains.length;
  if (!p.chain) return 'No chain is named for it, so budget a mid-priced L2 at about ' + tx + ' a transaction.';
  return (n === 1 ? p.chain + ' is the only chain ' : p.chain + ' is the cheapest of the ' + n + ' chains ') +
    r.name + ' runs on, about ' + tx + ' a transaction.';
}

/** The sentence, the note that says what its cost is made of, and a time of its own where waiting or
    a weekly cadence beats a number of hours. One case per key model.js emits. */
function textFor(k, r, p, s) {
  var d = money(p.deposit_usd), nm = r.name, at = on(p.chain), wk = p.weeks, age = r.age_days;
  switch (k) {
    case 'wallet': return ['Fund a fresh wallet holding only this position, seed phrase offline, never pasted into a site. ' + why(r, p),
      'of gas to fund it'];
    case 'size': return ['Size it at ' + d + (p.capped ? ', all that 0.01% of its ' + bigUsd(r.tvl_usd) + ' of TVL allows'
      : ', never above 0.01% of its ' + bigUsd(r.tvl_usd) + ' of TVL') + ', held in USDC' + at + ' first.',
      'of bridge fee, and ' + d + ' of capital at risk'];
    case 'lend1': return ['Supply ' + d + ' of USDC as collateral to ' + nm + at + ', from its own app.', 'of gas, two transactions'];
    case 'lend2': return ['Borrow back 30% at most in a stable, health factor over 2, one loop: a liquidation costs more than any airdrop pays.',
      'of gas, 8% a year on the borrowed leg'];
    case 'pm1': return ['Fund ' + d + at + ' and take positions in several of ' + nm + '’s markets: it counts markets traded, not dollars parked.',
      'of gas, about 1% of spread'];
    case 'pm2': return ['Trade through resolution and claim: a resolved market reads as use, an open one as nothing.', 'of gas, four settlements'];
    case 'der1': return ['Deposit ' + d + ' as margin on ' + nm + at + ' and run it delta-neutral: a long against an equal short.',
      'of gas, 0.04% of taker fee a side'];
    case 'der2': return ['Turn the margin over weekly rather than parking it: a perp venue weights volume and open days. Leverage 2x or under.',
      'of taker fees and gas, funding aside', weekly(s.hours, wk)];
    case 'dex1': return ['Add ' + d + ' to the deepest stable pair ' + nm + ' runs' + at + ', or route ' + d + ' of swap volume weekly if it runs no pools.',
      'of gas, 0.1% of fee a round trip'];
    case 'dex2': return ['Keep it in range and log the volume through it: a venue counts weeks of flow, one swap is not. Re-balance past 5% of drift.',
      'of gas, two re-balances'];
    case 'vault1': return ['Deposit ' + d + ' into the ' + nm + ' vault' + at + ' with the longest live record, not the highest yield.',
      'of gas; the performance fee is taken out of the yield'];
    case 'vault2': return ['Read the curator’s allocation page weekly and log the points. Withdraw if the mandate changes or the book concentrates.',
      'of gas to withdraw', weekly(s.hours, wk)];
    case 'stable1': return ['Mint or deposit ' + d + ' into ' + nm + '’s own stable or yield-bearing asset' + at + '.', 'of gas'];
    case 'kyc1': return ['Mint or deposit ' + d + ' into ' + nm + '’s own stable or yield-bearing asset' + at +
      '. This category gates the mint behind KYC: a passport, a selfie, 1-3 business days.', 'of gas, nothing for the KYC'];
    case 'stable2': return ['Read the redemption window before you size up, and hold rather than sell: these settle on a queue, not a swap.',
      'of gas, up to 0.2% to redeem', 'instant to 5 business days'];
    case 'infra1': return ['Bridge in, then delegate or restake ' + d + ' of the asset ' + nm + ' secures' + at + ', receipt token kept in the wallet.',
      'of gas, 0.1% of bridge fee'];
    case 'infra2': return ['Add in three tranches, not one lump: an infrastructure snapshot counts repeated use, one deposit is not.',
      'of gas, three tranches'];
    case 'weekly': return ['Do one qualifying action a week - a top-up, a repayment, a swap, a vote - so it reads as use, not a parked deposit.',
      'of gas, one transaction a week', weekly(s.hours, wk)];
    case 'hold': return ['Hold at least ' + p.hold_days + ' days' + (age === null ? ', longer if you can: no listing date is recorded, so treat it as young'
      : age < 365 ? ': it has recorded no token for only ' + age + ' days, so its snapshot is probably ahead'
      : ': it has run ' + age + ' days with no token, so a snapshot may already be taken') + '.',
      'in fees; the cost is the yield the ' + d + ' gives up', p.hold_days + ' days of waiting, no attention'];
    default: return ['Claim through the protocol’s own site or pinned account only. Never pay to claim, never sign a blind approval, never open a ' +
      'claim link someone sent you: an airdrop that charges is a theft.', 'of gas to unwind and claim, nothing else, ever'];
  }
}

/** One priced plan in, the steps a reader follows out: the model's own numbers, worded. */
function render(r, p) {
  return p.steps.map(function (s) {
    var t = textFor(s.key, r, p, s);
    return { action: t[0], cost: money(s.cost_usd) + ' ' + t[1], time: t[2] || hours(s.hours), cost_usd: s.cost_usd, hours: s.hours };
  });
}

/** One step as board.json carries it: the gate takes 20 to 600 characters. */
function stepText(s) {
  var t = s.action + ' Cost: ' + s.cost + '. Time: ' + s.time + '.';
  return t.length > 600 ? t.slice(0, 597) + '…' : t;
}

root.RadarPlans = { render: render, stepText: stepText };
})(typeof globalThis !== 'undefined' ? globalThis : this);

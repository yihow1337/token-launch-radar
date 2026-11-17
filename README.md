# Token Launch Radar

[![make.fun · token-radar-01](https://make.fun/badge/token-radar-01.svg)](https://make.fun/bounty/token-radar-01?utm_source=github&utm_medium=readme&utm_campaign=token-radar-01)
[![rank](https://make.fun/badge/token-radar-01/yihow1337/token-launch-radar/rank.svg)](https://make.fun/bounty/token-radar-01/leaderboard?utm_source=github&utm_medium=readme&utm_campaign=token-radar-01)
[![reward](https://make.fun/badge/token-radar-01/yihow1337/token-launch-radar/reward.svg)](https://make.fun/bounty/token-radar-01?utm_source=github&utm_medium=readme&utm_campaign=token-radar-01)

Built for [make.fun](https://make.fun)'s token-radar-01 bounty.

An entry for the make.fun bounty [token-radar-01](https://make.fun/c/token-radar-01): a static dashboard
that ranks the protocols whose token does not exist yet, by an implied value read off the market's own
comparables, and gives each one a farm plan with costs and times.

## What it does

`main.ts` (Node 22, standard library only, no network) reads the sealed snapshot from `/input/snapshot.json`,
runs the value model in `dashboard/model.js`, and writes:

- `board.json` — every ranked row: slug, name, rank, implied value, the factor walk and the farm steps.
- `data.js` — `window.RADAR_SNAPSHOT = <the raw snapshot>`, plus the board as `[slug, rank, implied
  value, verdict]` rows and a 32-bit FNV-1a seal of them. The page recomputes the whole board in the
  browser with the same `dashboard/model.js` and checks itself against those rows and that seal, and
  shows the result in a badge — so the page and the board cannot disagree quietly.
- `dashboard/`, `screenshots/` — copied as they are, then `dossier.json` from `vendor/makefun-board.ts`.

## The model, in one paragraph

    log10 V = a + b x log10(TVL / $100M) + family/category offset + momentum + no-token clock

Everything in it is fitted on the snapshot's own comparables and measured out of sample by the same
file. The comps are cleaned first — one row per token (TVL summed over its group, market cap taken
once), every wrapper, bridge, versioned release and exchange product dropped — which leaves 88 of the
128 live-token rows. A Huber regression of `log10(market cap)` on `log10(TVL)` over those 88 gives
`a = 7.1247, b = 0.4369`: $100M of TVL prices at $13.3M, and because the slope is not 1, ten times the
TVL buys 2.7x the market cap, so the multiple falls with size. Each family's median residual is shrunk
toward zero with `k = 8` and clamped to ±0.6 dex, and a category earns an offset of its own only with
three comps or more, so one lonely comp cannot price a whole category. Momentum is a damped 7-day TVL
change, `(1 + clamp(g, -40, +60)/100) ^ 0.5`. The no-token clock is fitted from the snapshot itself:
the share of protocols of each age that still record no token falls from 74% under 180 days to 14%
past three years, so a protocol tokenless that long sits in a shrinking minority and the clock
discounts it — at half strength, because undamped it is worse out of sample.

Every term is added one at a time and scored twice: leave-one-out over the comps, and a split in time
that fits on the comps listed before the median listing date and tests on the newer half. A flat
multiple misses by 4.90x; the size curve takes that to 3.24x, the offsets to 3.09x, momentum to 3.05x
and the clock to 2.99x, with 50.0% of comps within 3x. The offsets pay leave-one-out and cost a little
in the split (2.50x to 2.76x), where only 33 comps are left to fit on; that is in the table on the
page too. Every row carries a P10–P90 value band from those leave-one-out residuals and a P10–P90 rank
range over 40 refits of the whole fit on comps resampled with a seeded PRNG.

Each row also gets a farm plan whose seven steps carry a dollar cost and an hour count, summed into a
total, netted against the airdrop it would expect — 7.5% of implied value, split by deposit share, on
a $1,000 deposit never larger than 0.01% of TVL — and against the 4.5% a year that deposit gives up in
T-bills. `FARM` when the drop covers its costs twice over, `MARGINAL` when it merely nets positive,
`SKIP` otherwise: 72, 50 and 75 of the 197 rows. The biggest implied values are mostly `SKIP`, because
$1,000 of a $2.7B protocol earns a drop smaller than the gas and the yield it gives up.

No protocol is ever named in the code: the rules read category strings, chain names, TVL, the 7-day
change and the listing date, and nothing else. "Records no token" is what the snapshot says, not a
promise that a token is coming, and none of this is advice.

## The page

`dashboard/` is four files and no framework: `index.html`, `app.css`, `app.js` and `model.js`, all
classic scripts that run from `file://` with no network. It recomputes the whole radar in the browser
from the raw snapshot, so the screen, `board.json` and the screenshots cannot drift apart. Four tabs —
the pre-token board, the live comps it is priced off, the protocols set aside with their reason, and
the model with its ablation — a search, family chips, chain, watchlist and TVL filters, every numeric
column sortable, and a detail view per protocol with the value walk, the nearest comps and the farm
plan. All of it is URL-hash state, e.g. `#tab=board&p=<slug>&fam=vaults&w=watch&sort=net&dir=desc`,
which is how `tools/shoot.sh` photographs the three views in `screenshots/`.

## Run it

    mkdir -p out && MAKEFUN_OUTPUT_DIR=out node main.ts --input ../kit/token-radar-01-kit/input/snapshot.json
    node main.ts --input <snapshot.json> --output out --report   # ... and print the fitted tables too
    tools/shoot.sh                                               # rebuild out/ and retake the three screenshots

Two runs of the same snapshot are byte-identical: no clocks, no randomness, no network. `main.ts`
refuses a board the gate would reject, and refuses to hand in a dashboard the judge's 65,536-byte
source window would cut.

MIT licensed, see `LICENSE`.

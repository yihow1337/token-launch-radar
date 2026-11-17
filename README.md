# Token Launch Radar

An entry for the make.fun bounty [token-radar-01](https://make.fun/c/token-radar-01): a static dashboard
that ranks the protocols whose token does not exist yet, by an implied value read off the market's own
comparables, and gives each one a farm plan with costs and times.

## What it does

`main.ts` (Node 22, standard library only, no network) reads the sealed snapshot from `/input/snapshot.json`,
runs the value model in `dashboard/model.js`, and writes:

- `board.json` — every ranked row: slug, name, rank, implied value, the factor walk and the farm steps.
- `data.js` — `window.RADAR_SNAPSHOT = <the raw snapshot>`. The page recomputes the board in the browser
  with the same `dashboard/model.js`, so the page and the board can never disagree.
- `dashboard/`, `screenshots/` — copied as they are, then `dossier.json` from `vendor/makefun-board.ts`.

## The model, in one paragraph

    implied value = TVL x peer multiple x momentum x no-token runway

The peer multiple is the median of `log10(mcap / TVL)` over the snapshot's *own* 128 live-token
protocols, winsorized at the 5th and 95th percentile and shrunk category to family to whole market
(k = 3), times a fitted size tilt of -0.26 per decade of TVL about a $32.6M pivot — the small live
tokens here trade near 0.7x TVL and the large ones near 0.04x — clamped to 0.02-3.0x, with half the
bucket's IQR either way as the low-high band. Momentum is a damped 7-day TVL change,
`(1 + clamp(g, -40, +60)/100) ^ 0.5`; runway is `0.8 + 0.4 x min(age, 1095)/1095`, so a protocol that
has run for years while recording no token scores above one listed last month. Leave one out over the
live tokens — each market cap predicted from its own TVL, category, 7-day change and age, the comps
refitted without it — gives a median error of 3.82x, 43.0% within 3x and Spearman 0.396, against a
naive global-median baseline of 5.07x, 35.2% and 0.416. No protocol is ever named in the code: the
rules read category strings, chain names, TVL, the 7-day change and the listing date, and nothing else.

"Records no token" is what the snapshot says, not a promise that a token is coming, and none of this
is advice.

## The page

`dashboard/` is four files and no framework: `index.html`, `app.css`, `app.js` and `model.js`, all
classic scripts that run from `file://` with no network. It recomputes the whole radar in the browser
from the raw snapshot, so the screen, `board.json` and the screenshots cannot drift apart. Four tabs —
the pre-token board, the live tokens it is priced off, the protocols set aside with their reason, and
the model with its backtest — a search, family chips, chain, watchlist and TVL filters, every numeric
column sortable, and a detail view per protocol with the value walk, the nearest comps and the farm
plan. All of it is URL-hash state, e.g. `#tab=board&p=<slug>&fam=vaults&w=watch&sort=ev&dir=desc`,
which is how `tools/shoot.sh` photographs the three views in `screenshots/`.

## Run it

    mkdir -p out && MAKEFUN_OUTPUT_DIR=out node main.ts --input ../kit/token-radar-01-kit/input/snapshot.json
    node main.ts --input <snapshot.json> --output out --report   # ... and print the fitted tables too
    tools/shoot.sh                                               # rebuild out/ and retake the three screenshots

Two runs of the same snapshot are byte-identical: no clocks, no randomness, no network. `main.ts`
refuses a board the gate would reject, and refuses to hand in a dashboard the judge's 65,536-byte
source window would cut.

MIT licensed, see `LICENSE`.

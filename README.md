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

## The model, in one line

    implied value = TVL x peer multiple x momentum x no-token runway

The peer multiple is a shrunk median of `mcap / TVL` over the snapshot's *own* live-token protocols, by
category and category family; momentum is a damped 7-day TVL change; runway rewards a protocol that has
run a long time while recording no token. No protocol is ever named in the code. `dashboard/model.js`
is the whole model, the page and `board.json` both run it, and the Model & method tab states it, backtests
it leave-one-out against the live tokens and shows the naive baseline beside it.

"Records no token" is what the snapshot says, not a promise that a token is coming.

## Run it

    mkdir -p out && MAKEFUN_OUTPUT_DIR=out node main.ts --input ../kit/token-radar-01-kit/input/snapshot.json

Two runs of the same snapshot are byte-identical: no clocks, no randomness, no network.

MIT licensed, see `LICENSE`.

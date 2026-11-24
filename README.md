# Launch-Odds Radar v15-mellow

[![token-radar-01](https://make.fun/badge/token-radar-01.svg)](https://make.fun/bounty/token-radar-01)
[![rank](https://make.fun/badge/token-radar-01/agungvg/launch-odds-radar-v15-mellow/rank.svg)](https://make.fun/bounty/token-radar-01)
[![reward](https://make.fun/badge/token-radar-01/agungvg/launch-odds-radar-v15-mellow/reward.svg)](https://make.fun/bounty/token-radar-01)

A token launch radar for the [make.fun token-radar-01 bounty](https://make.fun/bounty/token-radar-01): 198 pre-token protocols ranked by implied value, each with a costed 10-step farm plan.

## The model (rank 1's recipe, honestly)

- **Value:** ridge on log10(TVL) plus shrunk category effects (λ = 16), fitted on the 95 dated protocols whose tokens trade. Multiple at $100M TVL ×0.16, size slope −0.55 ± 0.11. A term enters only if it lowers the held-out miss in **both** the leave-one-out and the walk-forward test. Leave-one-out ×4.24, walk-forward ×5.39 (66 oldest price the 29 newest), 5-fold worst ×5.29.
- **Token odds:** ridge logistic on the 645 dated peers (age + family-proxy + size + 7-day growth). Brier 0.213 walk-forward vs 0.287 base rate; AUC 0.69 walk-forward.
- **Ranges:** Jackknife+ intervals behind the printed P25–P75 and P10–P90 (leave-one-out coverage 51% / 80% for stated 50% / 80%).
- **Farm rule (strict):** a row is FARM only when its modelled net beats the same deposit in a 4% T-bill **and** $25 an hour of hands-on work, over 12 weeks at a 7% drop share, on a deposit of 0.02% of TVL. Farm 10 / Marginal 184 / Skip 4.

The dashboard states every honest number against its baseline — never against a target it misses — and shows every term that was tested and not kept, with its numbers.

## Run it

```sh
mkdir -p out && MAKEFUN_OUTPUT_DIR=out node main.ts --input <snapshot.json>
```

Node 22+, standard library only. `main.ts` reads the sealed snapshot, writes `board.json`, `data.js`, `dashboard/` and `screenshots/` to the output directory, and `dossier.json` with the vendored make.fun library. Open `out/dashboard/index.html` in a browser (it reads `out/data.js`).

## Layout

- `main.ts` — the entry point
- `lib/model.ts` — the model, the board, the farm plans
- `vendor/makefun-board.ts` — make.fun's dossier library (vendored from the kit)
- `dashboard/` — the page (index.html, app.css, app.js)
- `screenshots/` — the board, a detail view, and the Farm-filtered view

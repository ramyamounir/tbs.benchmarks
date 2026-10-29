# TBP Benchmarks

A browser app that compares [Monty](https://github.com/thousandbrainsproject/tbp.monty) benchmark
results — a **baseline** against **one or more runs** — entirely client-side. It is the web version
of `tbp.benchmarks` (`compare.py` + YAML configs): drop `tbp.monty/benchmarks/*.csv` folders or
wandb CSV exports, build and edit the comparison config in the browser, explore the result as an
overview heatmap, an expandable table and charts, and download updated baseline CSVs.

The site is static (Vite + React + TypeScript, no server, no backend) and is deployed to GitHub
Pages from `dist/`.

## Privacy

**Nothing is uploaded.** The site is a set of static files; dropped or picked files are parsed in
your browser and never leave it. The only network requests are GitHub reads, and only when you ask
for them ("Baseline from GitHub" or a run from GitHub: `api.github.com` and
`raw.githubusercontent.com`, enforced by the page's Content-Security-Policy). There are no
analytics, CDNs or remote fonts. Only your configs and the theme are saved, in this browser's
`localStorage`; loaded CSV data is never persisted, so a reload brings back the Start screen.

## Usage

1. **Load.** Drop files anywhere on the page, or use the pickers on the Start screen:
   - a whole `tbp.monty` clone or its `benchmarks/` folder (only `benchmarks/*.csv` is read;
     `.git`, `node_modules` and other dot-folders are skipped),
   - single benchmark tables (`Experiment,Correct (%)|align right,…`),
   - wandb CSV exports (`Name,Runtime,State,…,overall/percent_correct,…`).

   The kind is detected from the header. The first source becomes the **baseline** (or use
   "Baseline from GitHub": `owner/repo` + branch/tag/commit, default
   `thousandbrainsproject/tbp.monty@main`); later ones are **runs** (up to 6). Runs can be
   reordered by dragging, hidden with the eye toggle, removed, or promoted to baseline. Limits: ≤ 200
   CSV files and ≤ 300 MB per load, ≤ 50 MB per file, ≤ 2,000 columns, ≤ 1,000,000 rows.

2. **Configure.** Pick the built-in `tbp-default` config, **Generate from files…** (a 3-step
   wizard that matches columns and proposes one group per baseline table), or **Import…** a v2
   YAML/JSON or any v1 YAML config. Edit everything in the **Config** view: the _From your files_
   panel lists every experiment and column found in the loaded files (drag them into groups), the
   group editor holds the table, name matching, metrics and experiments, and the metric editor
   holds direction, tolerance, decimals and per-source columns with transforms — with a live
   "changes n verdicts" impact line and a preview. The header badge lists validation issues; click
   one to jump to it. Every edit autosaves in this browser (up to 50 named configs, "Saved (n)").
3. **Compare.**
   - **Overview**: one card per run and a heatmap (experiments × runs × metrics). Blue ▲ = better,
     vermillion ▼ = worse, three intensities by |Δ| / tolerance (or Δ %), dashed = missing, amber
     outline = episode count differs. Hover for values, click to open the experiment in the Table.
   - **Table**: grouped experiment rows with summary chips, expandable per-metric rows with Δ
     chips, filters (All / Regressions / Improvements / Missing), **Copy as Markdown** (v1-compatible
     tables) and `.md` download.
   - **Charts**: grouped bars, Δ dot plot (with the tolerance band), small multiples and trend across
     runs; saved in the config; PNG export per chart or all at once.
4. **Write back.** Choose a run; the **Write-back** view lists, per baseline table, every cell that
   would change (old → new, formatted like the existing cell). Click a cell to keep its old value.
   Download single files or a zip with only the changed `benchmarks/<table>.csv` files and unzip it
   over your clone. Only changed cells are rewritten; every other byte (header, quoting, line
   endings, final newline) is kept. **Copy change log** gives a text summary for the PR.

**Export…** in the top bar downloads the config (YAML/JSON), the Markdown report, all charts as
PNG, the write-back zip or its change log (`.txt`).

## Keyboard shortcuts

| Keys                 | Action                                                          |
| -------------------- | --------------------------------------------------------------- |
| `1` – `5`            | Overview / Table / Charts / Config / Write-back                 |
| `/`                  | Focus the current view's filter                                 |
| `Esc`                | Close a dialog, the sidebar drawer, a popover or a tooltip      |
| `[` / `]`            | Previous / next chart (Charts)                                  |
| `e`                  | Expand / collapse all rows (Table)                              |
| `?`                  | Show the shortcuts popover (also the `?` button in the top bar) |
| `←` `→` `Home` `End` | Move between tabs (view tabs, panel tabs, segmented controls)   |

Letter and number shortcuts are ignored while a text field is focused or a dialog is open. Every
control is reachable with `Tab`.

## Layout

Designed for ≥ 1100 px (sidebar + main; the Config view has three columns). Between 900 and
1100 px the sidebar is a drawer opened from the top-left button and the metric editor is a
slide-over. Below 900 px the Config panels become tabs (Files / Group / Metric), the Table stacks
run values inside each row and wide content scrolls inside its card. Nothing overflows at 360 px.
Light, dark and system themes use the same colour-blind-safe tokens (blue vs vermillion, never red
vs green; runs are violet, pink, teal, lime, brown, slate, each with its own marker shape).

## Config v2 reference

A config is a YAML (or JSON) document. Excerpt:

```yaml
version: 2
name: tbp-default
description: Monty benchmark tables vs wandb exports # optional
sources:
  repo: { id_column: Experiment, match: exact } # match: exact | suffix | { regex: "…" }
  wandb: { id_column: Name, match: suffix }
metrics:
  percent_correct:
    label: Correct
    units: '%' # optional
    direction: higher # higher | lower | match
    tolerance: 0.1
    tolerance_mode: absolute # absolute | percent (of |baseline|)
    decimals: 2 # display and Markdown precision
    columns:
      repo:
        column: 'Correct (%)|align right'
        transforms:
          [{ kind: to_number }, { kind: clip, min: 0, max: 100 }, { kind: round, decimals: 2 }]
      wandb:
        column: overall/percent_correct
        transforms:
          [{ kind: to_number }, { kind: clip, min: 0, max: 100 }, { kind: round, decimals: 2 }]
  runtime:
    label: Run time
    units: min
    direction: lower
    tolerance: 0.05
    columns:
      repo:
        {
          column: 'Run Time (mins)|align right',
          transforms: [to_number, { kind: round, decimals: 0 }],
        }
      wandb: { column: Runtime, transforms: [to_number, sec_to_min, { kind: round, decimals: 0 }] }
groups:
  - name: ycb_77objs
    table: benchmarks/ycb_77objs.csv # repo-side table read by every repo-kind source; null if none
    match: suffix # optional override of sources.<kind>.match
    metrics: [percent_correct, runtime]
    column_overrides: # optional: metric → { repo?: column, wandb?: column }
      percent_correct: { wandb: LM_2/overall/percent_correct }
    experiments: [base_77obj_dist_agent, base_77obj_surf_agent]
charts:
  - {
      id: c1,
      type: grouped_bars,
      metric: runtime,
      group: ycb_77objs,
      experiments: null,
      options: { toleranceBand: true, deltaLabels: true, yFromZero: true },
    }
output:
  markdown:
    { float_precision: 2, include_units_in_headers: true, show_deltas: true, show_pass_fail: true }
```

- **Sources** are per kind (`repo` = benchmark tables, `wandb` = exports): the id column and the
  default name matching. A metric may omit a kind; it is then `missing` for sources of that kind.
- **Transforms** run in order on the raw cell (the v1 set, same parameter names and results):
  `lowercase`, `uppercase`, `trim`, `strip_prefix {value}`, `strip_suffix {value}`,
  `regex_replace {pattern, replacement}`, `to_number` (strips `%`), `rad_to_deg`, `deg_to_rad`,
  `sec_to_min`, `min_to_sec`, `frac_to_percent`, `percent_to_frac`, `round {decimals}` (half to
  even, like pandas: 2550 s → `sec_to_min` → `round 0` = 42), `scale {factor}`, `clip {min, max}`.
  A bare string (`- to_number`) is shorthand for `{ kind: to_number }`.
- **Matching** an experiment name to a row: `exact`; `suffix` = exact, else `name` followed by a
  run-id suffix (`^name([_\-/:.].+)?$`); or `{ regex }` where `{name}` is replaced by the escaped
  experiment name (Python `(?P<n>…)` groups are accepted). Patterns longer than 256 characters,
  with backreferences or nested quantifiers (`(a+)+`) are rejected. Duplicate matches are shown
  with a "n rows" chip; the first row is used unless you pick another.
- **Verdicts**: `Δ = run − baseline`; `same` when |Δ| ≤ tolerance (absolute, or % of |baseline|),
  otherwise `better` / `worse` by direction, `mismatch` for a `match` metric (e.g. `num_episodes`),
  and `missing` when there is no row, no column or no number. Experiments in the config but not in
  the baseline, and experiments in the files but in no group, are always reported.
- **Validation** runs on import and on every edit. Files over 1 MB, YAML with excessive aliases or
  duplicate keys, reserved keys (`__proto__`, `constructor`, `prototype`), out-of-range numbers
  and unknown transforms are errors (an import with errors is not applied); unknown keys are
  dropped with a warning.

## v1 import notes

Any of the four `tbp.benchmarks` configs (`configs_{repo,wandb}_{repo,wandb}.yaml`) can be
imported: v1 `files` become source kinds, experiments are grouped by (baseline file, proposed
file, `lm2_*` variants used) and each group's table is its repo-side file, `lm2_*` metrics become
per-group `column_overrides`, `higher_is_better` becomes `direction`, and `num_episodes` becomes a
`match` metric (v1 treated it as higher-is-better). v1's `avg_prediction_error` is the v2 key
`prediction_error`. The unmodified `configs_repo_wandb.yaml` references `logos_on_objects.csv`,
which no longer exists in `tbp.monty/benchmarks/`; the app reports that group as invalid instead
of failing. The built-in `tbp-default` has one group per current table (7 groups, 38 experiments,
12 metrics).

## Development

```sh
npm ci            # exact-pinned dependencies from package-lock.json
npm run dev       # dev server on 127.0.0.1 only
npm run build     # type-check + production build into dist/ (works from any sub-path)
npm run preview   # serve dist/ on 127.0.0.1
npm run lint      # eslint (also enforces "network only in src/sources/github.ts")
npm test          # vitest (pure modules, Node environment)
npm run format    # prettier
```

Checks expected to pass before a change is merged: `npm run build`, `npx tsc -b`, `npm run lint`,
`npx vitest run`, `npx prettier --check .`.

Best-effort scripts (run with `npx tsx`, never bundled):

- `scripts/compare_with_v1.ts --baseline <tbp.monty> --run <wandb csv>` — compares the app's
  engine with v1 `compare.py` (needs the `tbp.benchmarks` Python venv); prints `N mismatches`.
- `scripts/write_synth_wandb.ts` — writes a synthetic 64,000-row wandb export to a temp folder for
  a large-input check in `npm run preview`.

Conventions follow `tbs.models`: every colour comes from the tokens in `src/theme/tokens.css`,
file-derived strings render only through `<DisplayName>` / `displayName()`, no `innerHTML`, and
`fetch` exists only in `src/sources/github.ts`.

## Verification (2026-10-29)

Best-effort checks run on the finished build (see the spec's Phase 7 notes for details):

- v1 parity: `scripts/compare_with_v1.ts` with `tbp.monty` and `pr_1184.csv` / `pr_1177.csv` —
  165 metric rows compared, 0 mismatches each.
- The four v1 configs import with the expected groups (unit tests in `src/config/v1.test.ts`).
- "Baseline from GitHub" (`thousandbrainsproject/tbp.monty@main`) loaded 7 tables and showed the
  short SHA.
- `dist/` served from `/sub/` on `127.0.0.1` in headless Chrome: every view at 1440 / 1100 / 900 /
  360 px in light (Charts also dark) with no page-level horizontal overflow and no console errors;
  `1`–`5`, `e`, `?` and `Esc` (drawer, slide-over, popover) work.
- Write-back zip for `pr_1184.csv` applied to a scratch copy of `tbp.monty/benchmarks`: 4 files,
  42 cells changed, same rows/columns, line endings and final newline.
- Large input: `tbp.monty` + a synthetic 64,000-row wandb export rendered the Overview in about
  0.4 s after the drop; hovers, Show toggles and group collapse stay under 20 ms.

## Deployment

`.github/workflows/pages.yml` builds and deploys `dist/` to GitHub Pages on every push to `main`
(`npm ci`, `npm test`, `npm run build`; actions pinned to commit SHAs). Enable it once in the
repository settings: **Settings → Pages → Source: GitHub Actions**. `vite.config.ts` uses
`base: './'`, so the build works from any sub-path (e.g. `https://<org>.github.io/tbs.benchmarks/`)
or any other static host. Commit `package-lock.json`; CI never regenerates it.

## License

MIT, see [LICENSE](LICENSE).

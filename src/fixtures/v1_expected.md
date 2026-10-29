<!-- captured with: cd /home/ramy/tbp/tbp.benchmarks && .venv/bin/python src/tbp/compare.py --baseline "$S" --proposed "$REPO/src/fixtures/wandb_small.csv" --config "$REPO/src/fixtures/v1_small.yaml" --baseline-label Baseline --proposed-label Proposed --mode table --out "$S/out.md" (S = scratch dir with benchmarks/ycb_10objs.csv = repo_ycb_small.csv and benchmarks/montymeetsworld.csv = repo_mmw_small.csv) -->
### base_config_10distinctobj_dist_agent

| Metric | Baseline | Proposed | Δ | Result |
| --- | --- | --- | --- | --- |
| percent_correct (%) | 100 | 100 | 0 | ⬜ |
| rotation_error (deg) | 10.32 | — | — | — |

### base_config_10distinctobj_surf_agent

| Metric | Baseline | Proposed | Δ | Result |
| --- | --- | --- | --- | --- |
| percent_correct (%) | 100 | 90 | -10 | ❌ |
| rotation_error (deg) | 3.64 | 3.5 | -0.14 | ✅ |

### randrot_noise_sim_on_scan_monty_world

| Metric | Baseline | Proposed | Δ | Result |
| --- | --- | --- | --- | --- |
| percent_correct (%) | 90 | 93.33 | 3.33 | ✅ |

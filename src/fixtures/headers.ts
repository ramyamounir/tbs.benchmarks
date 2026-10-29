// Exact first lines of the local fixture files (spec Phase 2b), copied verbatim — leading spaces
// and quotes included — so tests can build realistic sources without the fixtures present.
// `headers.test.ts` checks them against the local files when those exist.

export const REPO_HEADERS: Record<string, string> = {
  'benchmarks/cows_large.csv':
    'Experiment,Correct (%)|align right,Used MLH (%)|align right,Num Match Steps|align right,Rotation Error (degrees)|align right,Avg Prediction Error|align right,Run Time (mins)|align right,Num Episodes|hidden',
  'benchmarks/cows_small.csv':
    'Experiment,Correct (%)|align right,Used MLH (%)|align right,Num Match Steps|align right,Rotation Error (degrees)|align right,Avg Prediction Error|align right,Run Time (mins)|align right,Num Episodes|hidden',
  'benchmarks/montymeetsworld.csv':
    'Experiment,Correct (%)|align right,Used MLH (%)|align right,Num Match Steps|align right,Run Time (mins)|align right,Episode Run Time (s)|align right,Num Episodes|hidden',
  'benchmarks/ycb_10objs.csv':
    'Experiment,Correct (%)|align right,Used MLH (%)|align right,Num Match Steps|align right,Rotation Error (degrees)|align right,Run Time (mins)|align right,Episode Run Time (s)|align right,Num Episodes|hidden',
  'benchmarks/ycb_77objs.csv':
    'Experiment,Correct (%)|align right,Used MLH (%)|align right,Num Match Steps|align right,Rotation Error (degrees)|align right,Run Time (mins)|align right,Episode Run Time (s)|align right,Num Episodes|hidden',
  'benchmarks/ycb_unsupervised.csv':
    'Experiment, Correct - 1st Epoch(%)|align right, Correct - >1st Epoch (%)|align right, Mean Objects per Graph|align right, Mean Graphs per Object|align right, Run Time (mins)|align right, Episode Run Time (s)|align right, Num Episodes|hidden',
  'benchmarks/ycb_unsupervised_inference.csv':
    'Experiment,Correct (%)|align right,Num Match Steps|align right,Run Time (mins)|align right,Episode Run Time (s)|align right,Num Episodes|hidden',
};

export const WANDB_PR_1184_HEADER: string =
  '"Name","Runtime","State","Tags","Notes","overall/percent_correct","overall/avg_rotation_error","overall/avg_num_monty_matching_steps","overall/percent_used_mlh_after_timeout","overall/avg_episode_run_time","overall/avg_prediction_error","overall/num_episodes","LM_2/overall/percent_correct","LM_2/overall/avg_rotation_error","LM_2/overall/avg_prediction_error","LM_2/overall/percent_used_mlh_after_timeout"';

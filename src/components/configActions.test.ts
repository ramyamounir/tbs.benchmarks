import { describe, expect, it } from 'vitest';
import { v1SmallConfig } from '../fixtures/v1_small.config';
import { importToastText } from './configActions';

describe('importToastText', () => {
  it('names the file and the imported counts, or the warnings', () => {
    const config = v1SmallConfig();
    expect(importToastText('configs_repo_wandb.yaml', config, 0)).toBe(
      'Imported configs_repo_wandb.yaml as v2 · 2 groups · 2 metrics',
    );
    expect(importToastText('x.yaml', config, 1)).toBe('Imported x.yaml with 1 warning');
    expect(importToastText('x.yaml', config, 3)).toBe('Imported x.yaml with 3 warnings');
  });

  it('sanitises the file name', () => {
    expect(importToastText('a‮b.yaml', { ...v1SmallConfig(), groups: [] }, 0)).toBe(
      'Imported ab.yaml as v2 · 0 groups · 2 metrics',
    );
  });
});

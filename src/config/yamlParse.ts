import { parse } from 'yaml';

/**
 * The only YAML parse call of the app (spec Phase 2b). Merge keys are off (`<<` stays a plain key
 * and is reported as unknown), duplicate keys are an error, and alias expansion is capped so a
 * "billion laughs" document cannot blow up memory. Never throws.
 */
export function parseYamlText(text: string): { value: unknown } | { error: string } {
  try {
    const value: unknown = parse(text, {
      merge: false,
      uniqueKeys: true,
      maxAliasCount: 50,
      prettyErrors: true,
    });
    return { value };
  } catch (e) {
    return { error: (e as Error)?.message ?? String(e) };
  }
}

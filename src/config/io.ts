import { stringify } from 'yaml';
import type { Config, ConfigIssue } from '../model/types';
import { isPlainObject, validateConfig } from './schema';
import { importV1Raw } from './v1';
import { parseYamlText } from './yamlParse';

/**
 * Config files in and out (spec Phase 2b): YAML/JSON text → validated `Config`, and `Config` →
 * YAML/JSON with a stable key order. Nothing here throws.
 */

export const MAX_CONFIG_BYTES = 1_000_000;

export function parseConfigText(
  text: string,
  filename: string,
): { config: Config; issues: ConfigIssue[] } | { error: string } {
  if (text.length > MAX_CONFIG_BYTES) return { error: 'Config file is larger than 1 MB' };
  let value: unknown;
  if (filename.toLowerCase().endsWith('.json')) {
    try {
      value = JSON.parse(text);
    } catch (e) {
      return { error: (e as Error)?.message ?? String(e) };
    }
  } else {
    const parsed = parseYamlText(text);
    if ('error' in parsed) return parsed;
    value = parsed.value;
  }
  if (!isPlainObject(value)) return { error: 'Config must be a mapping' };

  const hasVersion = Object.hasOwn(value, 'version');
  if ((!hasVersion || value.version === 1) && Object.hasOwn(value, 'files')) {
    // A v1 document: the importer's own notes come first, then the structural issues.
    const v1 = importV1Raw(value);
    const result = validateConfig(v1.value);
    return { config: result.config, issues: [...v1.issues, ...result.issues] };
  }
  return validateConfig(value);
}

/** The single helper every UI import path uses: an import with any error is not applied. */
export function importConfigFile(
  text: string,
  filename: string,
):
  | { ok: true; config: Config; issues: ConfigIssue[] }
  | { ok: false; message: string; issues: ConfigIssue[] } {
  const parsed = parseConfigText(text, filename);
  if ('error' in parsed) return { ok: false, message: parsed.error, issues: [] };
  const errors = parsed.issues.filter((i) => i.severity === 'error').length;
  if (errors > 0) {
    return {
      ok: false,
      message: `Config not imported: ${errors} error${errors === 1 ? '' : 's'}`,
      issues: parsed.issues,
    };
  }
  return { ok: true, config: parsed.config, issues: parsed.issues };
}

/**
 * The canonical form of a config for export: rebuilt by `validateConfig`, so keys come out in the
 * schema order, unknown keys never appear, and no object is shared (no YAML anchors).
 */
function canonical(config: Config): Config {
  return validateConfig(config).config;
}

export function toYaml(config: Config): string {
  return stringify(canonical(config), { aliasDuplicateObjects: false, lineWidth: 0 });
}

export function toJson(config: Config): string {
  return JSON.stringify(canonical(config), null, 2) + '\n';
}

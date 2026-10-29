import { CsvLimitError, parseCsv } from '../csv/parse';
import { detectKind, findIdColumn, tablePath } from './detect';
import type { LoadError, Source, SourceKind, Table } from './types';

export interface SourceFile {
  path: string; // relative to the dropped folder root, or a bare file name
  text: string;
  lastModified: number;
}

export interface BuildSourceOptions {
  label: string;
  origin: 'local' | 'github';
  meta?: Source['meta'];
}

/** 12 hex characters from the platform CSPRNG (Node >= 20 and browsers). */
function newSourceId(): string {
  const bytes = globalThis.crypto.getRandomValues(new Uint8Array(6));
  return Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
}

/**
 * The single way a `Source` is built (local files, GitHub, Node tooling). Pure: no DOM, no network.
 * Never throws; every problem becomes a `LoadError` and the file is skipped.
 */
export function buildSource(
  files: SourceFile[],
  opts: BuildSourceOptions,
): { source: Source | null; errors: LoadError[] } {
  const errors: LoadError[] = [];
  const parsed: { file: SourceFile; table: Table }[] = [];

  for (const file of files) {
    let csv;
    try {
      csv = parseCsv(file.text);
    } catch (e) {
      const tooLarge = e instanceof CsvLimitError;
      errors.push({
        file: file.path,
        message: tooLarge ? e.message : `Could not parse CSV: ${(e as Error)?.message ?? e}`,
        reason: tooLarge ? 'too-large' : 'parse',
      });
      continue;
    }
    const kind = detectKind(csv.header);
    if (kind === 'unknown') {
      errors.push({
        file: file.path,
        message:
          'Not a benchmark table or wandb export (no "Experiment" column, or no "Name" with "State"/"Runtime")',
        reason: 'undetected',
      });
      continue;
    }
    const idColumn = findIdColumn(csv.header, kind);
    if (idColumn === null) {
      errors.push({
        file: file.path,
        message: 'No experiment id column found',
        reason: 'undetected',
      });
      continue;
    }
    parsed.push({ file, table: { path: tablePath(file.path), kind, idColumn, csv } });
  }

  if (parsed.length === 0) return { source: null, errors };

  // All tables of a source share one kind: the majority wins (ties: the first table's kind).
  const count: Record<SourceKind, number> = { repo: 0, wandb: 0 };
  for (const p of parsed) count[p.table.kind]++;
  const first = parsed[0].table.kind;
  const other: SourceKind = first === 'repo' ? 'wandb' : 'repo';
  const kind: SourceKind = count[other] > count[first] ? other : first;
  const kept = parsed.filter((p) => {
    if (p.table.kind === kind) return true;
    errors.push({
      file: p.file.path,
      message: `Mixed kinds: this ${p.table.kind} file was skipped in a ${kind} source`,
      reason: 'undetected',
    });
    return false;
  });

  let date: number | null;
  if (opts.origin === 'github' && opts.meta) {
    date = Date.parse(opts.meta.date);
  } else {
    date = Math.max(...kept.map((p) => p.file.lastModified));
  }
  if (!Number.isFinite(date)) date = null;

  const source: Source = {
    id: newSourceId(),
    label: opts.label,
    kind,
    origin: opts.origin,
    tables: kept.map((p) => p.table),
    date,
    hidden: false,
  };
  if (opts.meta) source.meta = { ...opts.meta };
  return { source, errors };
}

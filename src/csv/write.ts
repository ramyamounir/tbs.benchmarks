import type { ParsedCsv } from '../model/types';

/** True when a value cannot be written as a bare CSV field without changing its meaning. */
export function needsQuoting(value: string): boolean {
  return /[,"\r\n]/.test(value) || /^[ \t]|[ \t]$/.test(value);
}

export function serializeField(value: string, forceQuote = false): string {
  return forceQuote || needsQuoting(value) ? '"' + value.replaceAll('"', '""') + '"' : value;
}

export interface CellChange {
  rowIndex: number; // index into parsed.rows (record rowIndex + 1)
  columnIndex: number; // index into that record's fields
  value: string;
}

/**
 * Cell-level write-back: splices only the changed fields' spans into `parsed.text`. Every other
 * byte (BOM, header, untouched fields and their quoting, commas, each record's own terminator, a
 * missing final newline) is copied verbatim. A field that was quoted stays quoted.
 * Throws RangeError for a change that names a field that does not exist.
 */
export function rewriteRows(parsed: ParsedCsv, changes: CellChange[]): string {
  // Last change for a cell wins; keyed by the field's start offset (unique per field).
  const byStart = new Map<number, { start: number; end: number; text: string }>();
  for (const c of changes) {
    if (!Number.isInteger(c.rowIndex) || c.rowIndex < 0 || c.rowIndex >= parsed.rows.length) {
      throw new RangeError(`Row ${c.rowIndex} does not exist`);
    }
    const record = parsed.records[c.rowIndex + 1];
    if (
      !Number.isInteger(c.columnIndex) ||
      c.columnIndex < 0 ||
      c.columnIndex >= record.fields.length
    ) {
      throw new RangeError(`Column ${c.columnIndex} does not exist in row ${c.rowIndex}`);
    }
    const f = record.fields[c.columnIndex];
    byStart.set(f.start, { start: f.start, end: f.end, text: serializeField(c.value, f.quoted) });
  }
  const spans = [...byStart.values()].sort((a, b) => a.start - b.start);
  const { text } = parsed;
  let out = '';
  let pos = 0;
  for (const s of spans) {
    out += text.slice(pos, s.start) + s.text;
    pos = s.end;
  }
  out += text.slice(pos);
  return (parsed.bom ? '﻿' : '') + out;
}

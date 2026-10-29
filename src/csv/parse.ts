import type { CsvRecord, ParsedCsv } from '../model/types';

/**
 * Parser caps (spec Phase 2a "CSV parser caps"): the last line of defence after the loader's file
 * caps, so a crafted or accidental input cannot build millions of offset objects.
 */
export const CSV_LIMITS = {
  maxColumns: 2_000,
  maxRows: 1_000_000,
  maxFieldChars: 1_048_576,
} as const;

export interface CsvLimits {
  maxColumns: number;
  maxRows: number;
  maxFieldChars: number;
}

/** The only error `parseCsv` throws; callers (buildSource) turn it into a `too-large` LoadError. */
export class CsvLimitError extends RangeError {
  constructor(message: string) {
    super(message);
    this.name = 'CsvLimitError';
  }
}

const QUOTE = 0x22; // "
const COMMA = 0x2c; // ,
const LF = 0x0a;
const CR = 0x0d;

/**
 * RFC 4180 parser that keeps the exact `[start, end)` span of every record and field, so write-back
 * can splice changed cells into the original text and copy every other byte verbatim. Lenient on
 * malformed input (unterminated quotes run to the end, text after a closing quote is kept); trims
 * nothing. Offsets are UTF-16 indices into `text` (the input without its BOM).
 */
export function parseCsv(input: string, limits: CsvLimits = CSV_LIMITS): ParsedCsv {
  const bom = input.charCodeAt(0) === 0xfeff;
  const text = bom ? input.slice(1) : input;
  const n = text.length;
  const records: CsvRecord[] = [];
  const values: string[][] = [];
  let crlf = 0;
  let lf = 0;
  let i = 0;

  // End of a bare run: the next ',' or an unquoted '\n' / '\r\n' (a lone '\r' is data).
  const scanBare = (from: number): number => {
    let j = from;
    while (j < n) {
      const c = text.charCodeAt(j);
      if (c === COMMA || c === LF || (c === CR && text.charCodeAt(j + 1) === LF)) break;
      j++;
    }
    return j;
  };

  while (i < n) {
    const recordNo = records.length + 1; // 1-based, header = record 1
    const start = i;
    const fields: CsvRecord['fields'] = [];
    const row: string[] = [];
    for (;;) {
      const fStart = i;
      let value: string;
      let quoted = false;
      if (i < n && text.charCodeAt(i) === QUOTE) {
        quoted = true;
        i++;
        let buf = '';
        let seg = i;
        for (;;) {
          const q = text.indexOf('"', i);
          if (q === -1) {
            // Unterminated quote: the field runs to the end of the text.
            buf += text.slice(seg);
            i = n;
            break;
          }
          if (text.charCodeAt(q + 1) === QUOTE) {
            buf += text.slice(seg, q + 1); // "" is an escaped quote
            i = q + 2;
            seg = i;
            continue;
          }
          buf += text.slice(seg, q);
          i = q + 1;
          break;
        }
        // Characters between the closing quote and the delimiter are kept literally (lenient).
        const j = scanBare(i);
        buf += text.slice(i, j);
        i = j;
        value = buf;
      } else {
        const j = scanBare(i);
        value = text.slice(i, j);
        i = j;
      }
      if (i - fStart > limits.maxFieldChars) {
        throw new CsvLimitError(`Field larger than 1 MB in record ${recordNo}`);
      }
      fields.push({ start: fStart, end: i, quoted });
      row.push(value);
      if (fields.length > limits.maxColumns) {
        throw new CsvLimitError(`Too many columns (> ${limits.maxColumns}) in record ${recordNo}`);
      }
      if (i < n && text.charCodeAt(i) === COMMA) {
        i++;
        continue;
      }
      break;
    }
    const end = i;
    let terminator: CsvRecord['terminator'] = '';
    if (i < n) {
      if (text.charCodeAt(i) === CR) {
        terminator = '\r\n';
        crlf++;
        i += 2;
      } else {
        terminator = '\n';
        lf++;
        i += 1;
      }
    }
    records.push({ start, end, terminator, fields });
    values.push(row);
    if (records.length - 1 > limits.maxRows) {
      throw new CsvLimitError(`Too many rows (> ${limits.maxRows})`);
    }
  }

  return {
    text,
    bom,
    eol: crlf > lf ? '\r\n' : '\n',
    header: values[0] ?? [],
    rows: values.slice(1),
    records,
  };
}

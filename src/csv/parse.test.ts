import { describe, expect, it } from 'vitest';
import { FIXTURE_CSVS, readFixture } from '../fixtures/files';
import type { ParsedCsv } from '../model/types';
import { CSV_LIMITS, CsvLimitError, parseCsv } from './parse';

/** Spec invariant (rule 4): records tile the text; fields tile each record with one comma between. */
function assertInvariant(p: ParsedCsv) {
  let joined = '';
  for (const r of p.records) {
    joined += p.text.slice(r.start, r.end) + r.terminator;
    expect(r.fields[0].start).toBe(r.start);
    for (let k = 0; k + 1 < r.fields.length; k++) {
      expect(r.fields[k].end + 1).toBe(r.fields[k + 1].start);
      expect(p.text[r.fields[k].end]).toBe(',');
    }
    expect(r.fields.at(-1)!.end).toBe(r.end);
  }
  expect(joined).toBe(p.text);
  expect(p.rows.length).toBe(Math.max(0, p.records.length - 1));
}

const INLINE: Record<string, string> = {
  quotedUntouched: 'Experiment,Value,Note\n"exp",10,"note"\n',
  quotedValue: 'a,b\nx,"10"\n',
  crlf: 'a,b\r\n1,2\r\n3,4\r\n',
  mixed: 'a,b\r\n1,2\n3,4\r\n5,6\n7,8\n',
  multiline: 'a,b,c\n"line1\nline2",2,"x\r\ny"\nz,4,5\n',
  noTrailingNewline: 'a,b\n1,2',
  bom: '﻿Experiment,Correct (%)|align right\nexp,95.00\n',
  escapedQuotes: 'a,b\n"he said ""hi""",1\n',
  blankLine: 'a,b\n1,2\n\n3,4\n',
  loneCr: 'a,b\nx\ry,2\n',
  emptyFields: 'a,b,c\n,,\n',
};

describe('parseCsv', () => {
  it('parses the empty text', () => {
    const p = parseCsv('');
    expect(p.records).toEqual([]);
    expect(p.header).toEqual([]);
    expect(p.rows).toEqual([]);
    expect(p.eol).toBe('\n');
    expect(p.bom).toBe(false);
  });

  it('keeps leading spaces in header names and quoted values', () => {
    const p = parseCsv('Experiment, Correct - 1st Epoch(%)|align right\n"a,b",1\n');
    expect(p.header).toEqual(['Experiment', ' Correct - 1st Epoch(%)|align right']);
    expect(p.rows).toEqual([['a,b', '1']]);
    expect(p.records[1].fields[0]).toEqual({
      start: p.records[1].start,
      end: p.records[1].start + 5,
      quoted: true,
    });
  });

  it('handles embedded quotes, newlines and commas inside quotes', () => {
    expect(parseCsv(INLINE.escapedQuotes).rows).toEqual([['he said "hi"', '1']]);
    const m = parseCsv(INLINE.multiline);
    expect(m.rows).toEqual([
      ['line1\nline2', '2', 'x\r\ny'],
      ['z', '4', '5'],
    ]);
    expect(m.records).toHaveLength(3);
    expect(m.text.slice(m.records[2].start, m.records[2].end)).toBe('z,4,5');
  });

  it('records terminators and the majority eol', () => {
    const crlf = parseCsv(INLINE.crlf);
    expect(crlf.records.map((r) => r.terminator)).toEqual(['\r\n', '\r\n', '\r\n']);
    expect(crlf.eol).toBe('\r\n');
    const mixed = parseCsv(INLINE.mixed);
    expect(mixed.records.map((r) => r.terminator)).toEqual(['\r\n', '\n', '\r\n', '\n', '\n']);
    expect(mixed.eol).toBe('\n');
    const tie = parseCsv('a\r\nb\n');
    expect(tie.eol).toBe('\n');
    const none = parseCsv(INLINE.noTrailingNewline);
    expect(none.records.at(-1)!.terminator).toBe('');
    expect(none.rows).toEqual([['1', '2']]);
  });

  it('strips the BOM from text and flags it', () => {
    const p = parseCsv(INLINE.bom);
    expect(p.bom).toBe(true);
    expect(p.text.startsWith('Experiment')).toBe(true);
    expect(p.header[0]).toBe('Experiment');
  });

  it('treats a blank line as a record with one empty field and a lone CR as data', () => {
    const b = parseCsv(INLINE.blankLine);
    expect(b.rows).toEqual([['1', '2'], [''], ['3', '4']]);
    expect(b.records[2].fields).toEqual([
      { start: b.records[2].start, end: b.records[2].start, quoted: false },
    ]);
    expect(parseCsv(INLINE.loneCr).rows).toEqual([['x\ry', '2']]);
    expect(parseCsv(INLINE.emptyFields).rows).toEqual([['', '', '']]);
  });

  it('is lenient with text after a closing quote and unterminated quotes', () => {
    const p = parseCsv('a,b\n"x"y,2\n"open,3\n');
    expect(p.rows[0]).toEqual(['xy', '2']);
    expect(p.rows[1]).toEqual(['open,3\n']);
    assertInvariant(p);
  });

  it('satisfies the offset invariant on every inline and committed fixture', () => {
    for (const t of Object.values(INLINE)) assertInvariant(parseCsv(t));
    for (const f of FIXTURE_CSVS) assertInvariant(parseCsv(readFixture(f)));
  });

  it('parses the committed wandb fixture header and rows', () => {
    const p = parseCsv(readFixture('wandb_small.csv'));
    expect(p.header[0]).toBe('Name');
    expect(p.header).toContain('LM_2/overall/percent_correct');
    expect(p.rows.every((r) => r.length === p.header.length)).toBe(true);
    expect(p.records[1].fields.every((f) => f.quoted)).toBe(true);
  });
});

describe('CSV parser caps', () => {
  it('limits columns', () => {
    const header = (n: number) => Array.from({ length: n }, (_, i) => `c${i}`).join(',') + '\n';
    expect(() => parseCsv(header(2_001))).toThrow(CsvLimitError);
    expect(parseCsv(header(2_000)).header).toHaveLength(2_000);
  });

  it('limits rows', () => {
    expect(() => parseCsv('h\n' + 'x\n'.repeat(1_000_001))).toThrow(CsvLimitError);
    expect(parseCsv('h\n' + 'x\n'.repeat(1_000_000)).rows).toHaveLength(1_000_000);
  }, 60_000);

  it('limits field size', () => {
    const big = '"' + 'x'.repeat(1_048_577) + '"';
    expect(() => parseCsv('a\n' + big + '\n')).toThrow(CsvLimitError);
    try {
      parseCsv(big);
    } catch (e) {
      expect(e).toBeInstanceOf(RangeError);
      expect((e as Error).name).toBe('CsvLimitError');
      expect((e as Error).message).toBe('Field larger than 1 MB in record 1');
    }
  });

  it('honours custom limits', () => {
    expect(() => parseCsv('a,b\n1,2\n', { maxColumns: 1, maxRows: 10, maxFieldChars: 10 })).toThrow(
      CsvLimitError,
    );
    expect(() => parseCsv('a\n1\n2\n', { maxColumns: 5, maxRows: 1, maxFieldChars: 10 })).toThrow(
      'Too many rows (> 1)',
    );
    expect(CSV_LIMITS).toEqual({ maxColumns: 2_000, maxRows: 1_000_000, maxFieldChars: 1_048_576 });
  });
});

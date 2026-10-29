import { describe, expect, it } from 'vitest';
import { FIXTURE_CSVS, readFixture } from '../fixtures/files';
import { parseCsv } from './parse';
import { needsQuoting, rewriteRows, serializeField } from './write';

const INLINE = [
  'Experiment,Value,Note\n"exp",10,"note"\n',
  'a,b\nx,"10"\n',
  'a,b\r\n1,2\r\n3,4\r\n',
  'a,b\r\n1,2\n3,4\r\n5,6\n7,8\n',
  'a,b,c\n"line1\nline2",2,"x\r\ny"\nz,4,5\n',
  'a,b\n1,2',
  '﻿Experiment,Correct (%)|align right\nexp,95.00\n',
  'a,b\n"he said ""hi""",1\n',
  'a,b\n1,2\n\n3,4\n',
];

/** Expected output of a single-cell change: only that field's span differs. */
function spliceOne(t: string, rowIndex: number, columnIndex: number, newField: string): string {
  const p = parseCsv(t);
  const f = p.records[rowIndex + 1].fields[columnIndex];
  const off = p.bom ? 1 : 0;
  return t.slice(0, f.start + off) + newField + t.slice(f.end + off);
}

describe('needsQuoting / serializeField', () => {
  it('quotes only when needed or forced', () => {
    expect(needsQuoting('abc')).toBe(false);
    for (const v of ['a,b', 'a"b', 'a\nb', 'a\rb', ' a', 'a ', '\ta', 'a\t']) {
      expect(needsQuoting(v)).toBe(true);
    }
    expect(serializeField('11')).toBe('11');
    expect(serializeField('11', true)).toBe('"11"');
    expect(serializeField('a"b')).toBe('"a""b"');
    expect(serializeField('1,5')).toBe('"1,5"');
  });
});

describe('rewriteRows', () => {
  it('is byte-identical with no changes', () => {
    for (const t of INLINE) expect(rewriteRows(parseCsv(t), [])).toBe(t);
    for (const f of FIXTURE_CSVS) {
      const t = readFixture(f);
      expect(rewriteRows(parseCsv(t), [])).toBe(t);
    }
  });

  it('keeps unnecessary quotes of untouched fields in a changed row', () => {
    const t = INLINE[0];
    const out = rewriteRows(parseCsv(t), [{ rowIndex: 0, columnIndex: 1, value: '11' }]);
    expect(out).toBe('Experiment,Value,Note\n"exp",11,"note"\n');
    expect(out).toBe(spliceOne(t, 0, 1, '11'));
  });

  it('keeps a quoted old field quoted', () => {
    expect(rewriteRows(parseCsv(INLINE[1]), [{ rowIndex: 0, columnIndex: 1, value: '11' }])).toBe(
      'a,b\nx,"11"\n',
    );
  });

  it('quotes a bare field whose new value needs it', () => {
    expect(
      rewriteRows(parseCsv('a,b\nx,10\n'), [{ rowIndex: 0, columnIndex: 1, value: '1,5' }]),
    ).toBe('a,b\nx,"1,5"\n');
  });

  it('keeps CRLF, mixed terminators and the missing final newline', () => {
    expect(rewriteRows(parseCsv(INLINE[2]), [{ rowIndex: 1, columnIndex: 0, value: '9' }])).toBe(
      'a,b\r\n1,2\r\n9,4\r\n',
    );
    const mixed = INLINE[3];
    const out = rewriteRows(parseCsv(mixed), [
      { rowIndex: 0, columnIndex: 1, value: 'X' },
      { rowIndex: 3, columnIndex: 0, value: 'Y' },
    ]);
    expect(out).toBe('a,b\r\n1,X\n3,4\r\n5,6\nY,8\n');
    expect(rewriteRows(parseCsv(INLINE[5]), [{ rowIndex: 0, columnIndex: 1, value: '3' }])).toBe(
      'a,b\n1,3',
    );
  });

  it('handles quoted fields with embedded newlines, changed or untouched', () => {
    const t = INLINE[4];
    // Untouched multi-line fields in a changed row.
    expect(rewriteRows(parseCsv(t), [{ rowIndex: 0, columnIndex: 1, value: '7' }])).toBe(
      'a,b,c\n"line1\nline2",7,"x\r\ny"\nz,4,5\n',
    );
    // The multi-line field itself, and a later record (offsets after it stay correct).
    expect(
      rewriteRows(parseCsv(t), [
        { rowIndex: 0, columnIndex: 0, value: 'one\ntwo\nthree' },
        { rowIndex: 1, columnIndex: 2, value: '6' },
      ]),
    ).toBe('a,b,c\n"one\ntwo\nthree",2,"x\r\ny"\nz,4,6\n');
    expect(rewriteRows(parseCsv(t), [{ rowIndex: 1, columnIndex: 1, value: '8' }])).toBe(
      spliceOne(t, 1, 1, '8'),
    );
  });

  it('keeps the BOM', () => {
    const t = INLINE[6];
    const out = rewriteRows(parseCsv(t), [{ rowIndex: 0, columnIndex: 1, value: '96.00' }]);
    expect(out).toBe('﻿Experiment,Correct (%)|align right\nexp,96.00\n');
    expect(out).toBe(spliceOne(t, 0, 1, '96.00'));
  });

  it('changes only the target span in every committed fixture', () => {
    for (const f of FIXTURE_CSVS) {
      const t = readFixture(f);
      const p = parseCsv(t);
      for (let r = 0; r < p.rows.length; r++) {
        const col = p.header.length - 1;
        const field = p.records[r + 1].fields[col];
        const expected = spliceOne(t, r, col, serializeField('42', field.quoted));
        expect(rewriteRows(p, [{ rowIndex: r, columnIndex: col, value: '42' }])).toBe(expected);
      }
    }
  });

  it('lets the last change for a cell win and rejects missing fields', () => {
    const p = parseCsv('a,b\n1,2\n');
    expect(
      rewriteRows(p, [
        { rowIndex: 0, columnIndex: 0, value: 'x' },
        { rowIndex: 0, columnIndex: 0, value: 'y' },
      ]),
    ).toBe('a,b\ny,2\n');
    expect(() => rewriteRows(p, [{ rowIndex: 1, columnIndex: 0, value: 'x' }])).toThrow(RangeError);
    expect(() => rewriteRows(p, [{ rowIndex: 0, columnIndex: 2, value: 'x' }])).toThrow(RangeError);
    expect(() => rewriteRows(p, [{ rowIndex: -1, columnIndex: 0, value: 'x' }])).toThrow(
      RangeError,
    );
  });
});

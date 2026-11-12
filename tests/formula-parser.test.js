import { describe, it, expect } from 'vitest';
import { parseFormula, formulaSQL } from '../formula-parser.mjs';
const cols = [
  { name: 'price', data_type: 'numeric' },
  { name: 'qty', data_type: 'integer' },
  { name: 'title', data_type: 'text' },
];
describe('formula parser', () => {
  it('parses precedence, nested functions and column references', () => {
    const p = parseFormula('ROUND([price] * [qty] + ABS(-2), 2)', cols);
    expect(p.columns).toEqual(['price', 'qty']);
    expect(formulaSQL(p.ast, 'NEW')).toContain('pg_catalog.round');
    expect(formulaSQL(p.ast, 'NEW')).toContain('NEW."price"::numeric');
  });
  it('rejects unsupported SQL, unknown columns and invalid functions', () => {
    for (const s of ['[price]; DROP TABLE x', '[title]+1', '[missing]', 'random()', 'ABS(1,2)', '[price] +'])
      expect(() => parseFormula(s, cols)).toThrow();
  });
  it('uses strict null propagation for min and max', () => {
    expect(formulaSQL(parseFormula('MAX([price], [qty])', cols).ast, 's')).toContain('IS NULL');
  });
});

describe('phần trăm', () => {
  it('hiểu 35% là 35 chia 100 trước phép nhân', () => {
    const parsed = parseFormula('[price]*35%', cols);
    expect(formulaSQL(parsed.ast, 'NEW')).toBe('(NEW."price"::numeric * (35::numeric / 100::numeric))');
  });
});

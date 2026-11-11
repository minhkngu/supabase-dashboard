import { describe, expect, it } from 'vitest';
import { isWritableColumn } from '../writable-column.mjs';

const table = columns => ({ name: 'public.products', columns });

describe('isWritableColumn', () => {
  it('cho phép cột dữ liệu thông thường', () => {
    const products = table([{ name: 'name', options: ['updatable'] }]);
    expect(isWritableColumn(products, products.columns[0])).toBe(true);
  });

  it('không coi formula đang bật hoặc lookup đồng bộ là cột được sửa', () => {
    const products = table([
      { name: 'formula_total', options: [] },
      { name: 'lookup_branch', options: [] },
    ]);
    const [formula, lookup] = products.columns;
    expect(
      isWritableColumn(products, formula, {
        formulas: [{ table: 'products', column: 'formula_total', enabled: true }],
      }),
    ).toBe(false);
    expect(
      isWritableColumn(products, lookup, {
        lookups: [
          {
            sourceTable: 'products',
            sync: { enabled: true, columnName: 'lookup_branch' },
          },
        ],
      }),
    ).toBe(false);
  });

  it('không cho sửa cột generated hoặc identity ALWAYS', () => {
    const products = table([
      { name: 'total', options: ['generated'] },
      { name: 'code', options: ['identity'], identity_generation: 'ALWAYS' },
      { name: 'seq', options: ['identity'], identity_generation: 'BY DEFAULT' },
    ]);
    expect(isWritableColumn(products, products.columns[0])).toBe(false);
    expect(isWritableColumn(products, products.columns[1])).toBe(false);
    expect(isWritableColumn(products, products.columns[2])).toBe(true);
  });
});

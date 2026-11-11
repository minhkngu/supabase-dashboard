import { describe, it, expect } from 'vitest';
import { readAllTableRows } from '../table-overview.mjs';
const table = { name: 'public.items', primary_keys: ['id'] };
const fullPage = (start = 0) => Array.from({ length: 1000 }, (_, i) => ({ id: start + i }));
describe('dashboard pagination', () => {
  it('loads every page in stable key order with the largest page size', async () => {
    const queries = [];
    const rows = await readAllTableRows(async url => {
      const q = new URL(url, 'http://localhost').searchParams;
      queries.push(q);
      const page = Number(q.get('page'));
      return { rows: page === 0 ? fullPage() : [{ id: 1000 }], total: 1001 };
    }, table);
    expect(rows).toHaveLength(1001);
    expect(queries).toHaveLength(2);
    expect(queries[0].get('limit')).toBe('1000');
    expect(JSON.parse(queries[0].get('orders'))).toEqual([{ column: 'id', direction: 'asc' }]);
    expect(queries[1].get('page')).toBe('1');
  });
  it('rejects partial results and changing counts', async () => {
    await expect(readAllTableRows(async () => ({ rows: [], total: 1 }), table)).rejects.toThrow('Chưa tải đủ');
    await expect(readAllTableRows(async () => ({ rows: [{ id: 1 }], total: 2 }), table)).rejects.toThrow(
      'ít dòng hơn dự kiến',
    );
    let calls = 0;
    await expect(
      readAllTableRows(
        async () => (++calls === 1 ? { rows: fullPage(), total: 1001 } : { rows: [{ id: 1000 }], total: 1002 }),
        table,
      ),
    ).rejects.toThrow('thay đổi');
  });
  it('rejects duplicate rows when data shifts', async () => {
    let calls = 0;
    await expect(
      readAllTableRows(
        async () => (++calls === 1 ? { rows: fullPage(), total: 1001 } : { rows: [{ id: 999 }], total: 1001 }),
        table,
      ),
    ).rejects.toThrow('thay đổi');
  });
});

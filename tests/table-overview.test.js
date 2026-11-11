import { describe, it, expect } from 'vitest';
import { readAllTableRows } from '../table-overview.mjs';
const table = { name: 'public.items', primary_keys: ['id'] };
describe('dashboard pagination', () => {
  it('loads every page in stable key order', async () => {
    const queries = [];
    const rows = await readAllTableRows(async url => {
      const q = new URL(url, 'http://localhost').searchParams;
      queries.push(q);
      const page = Number(q.get('page'));
      return { rows: page === 0 ? Array.from({ length: 50 }, (_, id) => ({ id })) : [{ id: 50 }], total: 51 };
    }, table);
    expect(rows).toHaveLength(51);
    expect(JSON.parse(queries[0].get('orders'))).toEqual([{ column: 'id', direction: 'asc' }]);
    expect(queries[1].get('page')).toBe('1');
  });
  it('rejects partial results and changing counts', async () => {
    await expect(readAllTableRows(async () => ({ rows: [], total: 1 }), table)).rejects.toThrow('Chưa tải đủ');
    let calls = 0;
    await expect(
      readAllTableRows(
        async () => (++calls === 1 ? { rows: [{ id: 1 }], total: 2 } : { rows: [{ id: 2 }], total: 3 }),
        table,
      ),
    ).rejects.toThrow('thay đổi');
  });
  it('rejects duplicate rows when data shifts', async () => {
    let calls = 0;
    await expect(
      readAllTableRows(
        async () => (++calls === 1 ? { rows: [{ id: 1 }], total: 2 } : { rows: [{ id: 1 }], total: 2 }),
        table,
      ),
    ).rejects.toThrow('thay đổi');
  });
});

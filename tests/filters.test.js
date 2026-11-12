import { describe, it, expect } from 'vitest';
import { filterQuery } from '../filters.mjs';
const table = {
  columns: [
    { name: 'price', data_type: 'integer' },
    { name: 'name', data_type: 'text' },
    { name: 'id', data_type: 'integer' },
  ],
  primary_keys: ['id'],
};
describe('lọc và sắp xếp', () => {
  it('giữ các điều kiện cùng cột và phân trang ổn định', () => {
    const q = filterQuery(
      new URLSearchParams({
        filters: JSON.stringify([
          { column: 'price', operator: 'gte', value: 10 },
          { column: 'price', operator: 'lte', value: 20 },
        ]),
        orders: JSON.stringify([{ column: 'price', direction: 'desc' }]),
      }),
      table,
    );
    expect(q.getAll('price')).toEqual(['gte.10', 'lte.20']);
    expect(q.get('order')).toBe('price.desc,id.asc');
  });
  it('lọc bằng với văn bản dùng eq và từ chối cột lạ', () => {
    const q = filterQuery(
      new URLSearchParams({ filters: JSON.stringify([{ column: 'name', operator: 'eq', value: 'Mia' }]) }),
      table,
    );
    expect(q.get('name')).toBe('eq.Mia');
    expect(() =>
      filterQuery(
        new URLSearchParams({ filters: JSON.stringify([{ column: 'unknown', operator: 'eq', value: 'x' }]) }),
        table,
      ),
    ).toThrow();
  });
});

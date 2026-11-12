import { describe, expect, it } from 'vitest';
import { createLookupStore } from '../lookup-store.mjs';

describe('lưu cấu hình lookup', () => {
  it('không tự tạo bảng khi chưa được thiết lập', async () => {
    const calls = [];
    const store = createLookupStore({
      query: async sql => {
        calls.push(sql);
        return { rows: [{ present: false }] };
      },
    });
    await expect(store.list()).rejects.toThrow('Chưa thiết lập');
    expect(calls).toHaveLength(1);
  });
  it('ghi cấu hình bằng tham số và không ghi dữ liệu bảng nguồn', async () => {
    const calls = [];
    const store = createLookupStore({
      query: async (sql, params) => {
        calls.push({ sql, params });
        return { rows: [{ present: true }] };
      },
    });
    const config = { id: 'lookup-1', sourceTable: 'rooms', label: 'Tên', targetTable: 'branches' };
    await store.save(config);
    expect(calls[1].params[0]).toBe('lookup-1');
    expect(calls[1].sql).toContain('siris_admin.lookup_configs');
    expect(calls[1].sql).not.toContain('rooms');
  });
});

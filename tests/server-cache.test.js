import { describe, expect, it } from 'vitest';
import { createTtlCache, invalidatesCaches } from '../server-cache.mjs';

describe('cache cấu hình phía máy chủ', () => {
  it('ghi dữ liệu bảng không xóa cache, đổi cấu hình hoặc schema thì xóa', () => {
    expect(invalidatesCaches('PATCH', '/api/table/rooms')).toBe(false);
    expect(invalidatesCaches('POST', '/api/table/rooms')).toBe(false);
    expect(invalidatesCaches('DELETE', '/api/table/rooms')).toBe(false);
    expect(invalidatesCaches('POST', '/api/lookup/rooms')).toBe(false);
    expect(invalidatesCaches('POST', '/api/admin/schema/preview')).toBe(false);
    expect(invalidatesCaches('GET', '/api/formula-config')).toBe(false);
    expect(invalidatesCaches('POST', '/api/formula-config')).toBe(true);
    expect(invalidatesCaches('POST', '/api/lookup-config')).toBe(true);
    expect(invalidatesCaches('POST', '/api/lookup-config/cleanup-disabled')).toBe(true);
    expect(invalidatesCaches('POST', '/api/lookup-sync/rename')).toBe(true);
    expect(invalidatesCaches('POST', '/api/admin/schema/apply')).toBe(true);
  });

  it('hai lần PATCH liên tiếp dùng lại cấu hình đã cache', async () => {
    const cache = createTtlCache();
    let reads = 0;
    const read = async () => {
      reads++;
      return [{ table: 'rooms', column: 'total', enabled: true }];
    };
    for (const path of ['/api/table/rooms', '/api/table/rooms']) {
      if (invalidatesCaches('PATCH', path)) cache.clear();
      await cache.get('formula', read);
    }
    expect(reads).toBe(1);
    if (invalidatesCaches('POST', '/api/formula-config')) cache.clear();
    await cache.get('formula', read);
    expect(reads).toBe(2);
  });

  it('hết hạn sau thời gian sống và không giữ lần đọc lỗi', async () => {
    let time = 0,
      reads = 0;
    const cache = createTtlCache(1000, () => time);
    await cache.get('lookup', async () => ++reads);
    time = 999;
    expect(await cache.get('lookup', async () => ++reads)).toBe(1);
    time = 1000;
    expect(await cache.get('lookup', async () => ++reads)).toBe(2);
    await expect(
      cache.get('broken', async () => {
        throw Error('down');
      }),
    ).rejects.toThrow('down');
    expect(await cache.get('broken', async () => 'ok')).toBe('ok');
  });
});

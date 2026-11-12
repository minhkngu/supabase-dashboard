import { describe, expect, it } from 'vitest';
import { createUiSettingsStore, UI_SETTING_KEYS, UI_SETTING_MAX_BYTES } from '../ui-settings-store.mjs';
import { syncedKeys } from '../src/storage.js';
import { handleUiSettings } from '../server/routes/ui-settings.mjs';

const pool = (present, rows = []) => {
  const calls = [];
  return {
    calls,
    query: async (sql, params) => {
      calls.push({ sql, params });
      if (sql.includes('to_regclass')) return { rows: [{ present }] };
      return { rows };
    },
  };
};

describe('lưu cấu hình giao diện', () => {
  it('available=false khi chưa có bảng hoặc chưa có kết nối', async () => {
    expect(await createUiSettingsStore(null).available()).toBe(false);
    expect(await createUiSettingsStore(pool(false)).available()).toBe(false);
    await expect(createUiSettingsStore(pool(false)).list()).rejects.toThrow('Chưa thiết lập');
  });
  it('từ chối khóa không có trong danh sách', async () => {
    const p = pool(true);
    await expect(createUiSettingsStore(p).save('lookups', {})).rejects.toThrow('Khóa');
    expect(p.calls).toHaveLength(0);
  });
  it('từ chối giá trị quá lớn', async () => {
    const big = 'x'.repeat(UI_SETTING_MAX_BYTES + 1);
    await expect(createUiSettingsStore(pool(true)).save('views', { big })).rejects.toThrow('quá lớn');
  });
  it('ghi bằng tham số và upsert', async () => {
    const p = pool(true, [{ updated_at: '2026-01-01T00:00:00Z' }]);
    const result = await createUiSettingsStore(p).save('views', { a: 1 });
    expect(result.updatedAt).toBe(Date.parse('2026-01-01T00:00:00Z'));
    expect(p.calls[1].params).toEqual(['views', '{"a":1}']);
    expect(p.calls[1].sql).toContain('ON CONFLICT');
  });
  it('list bỏ khóa lạ và trả thời điểm cập nhật', async () => {
    const rows = [
      { key: 'views', value: { a: 1 }, updated_at: '2026-01-01T00:00:00Z' },
      { key: 'other', value: 1, updated_at: '2026-01-01T00:00:00Z' },
    ];
    const items = await createUiSettingsStore(pool(true, rows)).list();
    expect(Object.keys(items)).toEqual(['views']);
  });
});

describe('route /api/ui-settings', () => {
  const run = async (ctx, method = 'GET') => {
    let out;
    const res = {
      writeHead() {},
      end(text) {
        out = JSON.parse(text);
      },
    };
    const req = Object.assign(
      (async function* () {
        yield Buffer.from('{"key":"views","value":{}}');
      })(),
      { method },
    );
    await handleUiSettings(ctx, req, res, new URL('http://x/api/ui-settings'));
    return out;
  };
  it('trả available:false khi chưa có bảng', async () => {
    const ctx = { uiSettingsStore: createUiSettingsStore(pool(false)) };
    expect(await run(ctx)).toEqual({ available: false, items: {} });
  });
  it('POST lưu khóa', async () => {
    const ctx = { uiSettingsStore: { save: async () => ({ updatedAt: 5 }) } };
    expect(await run(ctx, 'POST')).toEqual({ ok: true, updatedAt: 5 });
  });
});

describe('danh sách khóa đồng bộ', () => {
  it('máy chủ và trình duyệt dùng cùng một danh sách khóa', () => {
    expect([...UI_SETTING_KEYS].sort()).toEqual(Object.keys(syncedKeys).sort());
  });
});

// Lưu cấu hình giao diện dùng chung (view, thư mục, thứ tự bảng…) trên Supabase.
import { Buffer } from 'node:buffer';
export const UI_SETTING_KEYS = [
  'views',
  'namedViews',
  'tableFolders',
  'tableOrder',
  'relationDisplay',
  'tableDisplay',
  'promotionsDisplay',
];
export const UI_SETTING_MAX_BYTES = 256 * 1024;
export const UI_SETTINGS_STORE_MISSING = 'Chưa thiết lập nơi lưu cấu hình giao diện trên Supabase.';

export function createUiSettingsStore(pool) {
  async function available() {
    if (!pool) return false;
    const result = await pool.query("SELECT to_regclass('siris_admin.ui_settings') IS NOT NULL AS present");
    return result.rows[0].present;
  }
  async function list() {
    if (!(await available())) throw Error(UI_SETTINGS_STORE_MISSING);
    const result = await pool.query('SELECT key, value, updated_at FROM siris_admin.ui_settings');
    const items = {};
    for (const row of result.rows)
      if (UI_SETTING_KEYS.includes(row.key))
        items[row.key] = { value: row.value, updatedAt: new Date(row.updated_at).getTime() };
    return items;
  }
  async function save(key, value) {
    if (!UI_SETTING_KEYS.includes(key)) throw Error('Khóa cấu hình không hợp lệ.');
    if (value === undefined) throw Error('Giá trị cấu hình không hợp lệ.');
    const json = JSON.stringify(value);
    if (json === undefined || Buffer.byteLength(json) > UI_SETTING_MAX_BYTES) throw Error('Cấu hình quá lớn.');
    if (!(await available())) throw Error(UI_SETTINGS_STORE_MISSING);
    const result = await pool.query(
      'INSERT INTO siris_admin.ui_settings(key,value) VALUES($1,$2::jsonb) ON CONFLICT(key) DO UPDATE SET value=excluded.value,updated_at=now() RETURNING updated_at',
      [key, json],
    );
    return { updatedAt: new Date(result.rows[0].updated_at).getTime() };
  }
  return { available, list, save };
}

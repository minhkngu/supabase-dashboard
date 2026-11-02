// Chỉ lưu định nghĩa lookup; không truy vấn dữ liệu bảng bằng kết nối quản trị.
export function createLookupStore(pool) {
  async function available() {
    if (!pool) return false;
    const result = await pool.query("SELECT to_regclass('siris_admin.lookup_configs') IS NOT NULL AS present");
    return result.rows[0].present;
  }
  async function list() {
    if (!await available()) throw Error('Chưa thiết lập nơi lưu lookup trên Supabase.');
    const result = await pool.query('SELECT config FROM siris_admin.lookup_configs ORDER BY source_table, label, id');
    return result.rows.map(row => row.config);
  }
  async function save(config) {
    if (!await available()) throw Error('Chưa thiết lập nơi lưu lookup trên Supabase.');
    if (!config || typeof config !== 'object' || Array.isArray(config) || typeof config.id !== 'string' || config.id.length > 100 || typeof config.sourceTable !== 'string' || typeof config.label !== 'string' || !config.label.trim() || config.label.length > 80) throw Error('Cấu hình lookup không hợp lệ.');
    await pool.query('INSERT INTO siris_admin.lookup_configs(id,source_table,label,config) VALUES($1,$2,$3,$4::jsonb) ON CONFLICT(id) DO UPDATE SET source_table=excluded.source_table,label=excluded.label,config=excluded.config,updated_at=now()', [config.id,config.sourceTable,config.label,JSON.stringify(config)]);
    return config;
  }
  async function remove(id) {
    if (!await available()) throw Error('Chưa thiết lập nơi lưu lookup trên Supabase.');
    if (typeof id !== 'string' || !id || id.length > 100) throw Error('Mã lookup không hợp lệ.');
    await pool.query('DELETE FROM siris_admin.lookup_configs WHERE id=$1',[id]);
  }
  return { available, list, save, remove };
}

import { describe, it, expect } from 'vitest';
import { checkFormulas, formulaTriggerSQL, createFormulaSync } from '../formula-sync.mjs';
const col = name => ({ name, data_type: 'numeric', options: ['updatable', 'nullable'] });
const table = {
  name: 'public.rooms',
  primary_keys: ['id'],
  columns: [col('id'), col('price'), col('qty'), col('total'), col('tax')],
};
const config = { table: 'rooms', column: 'total', expression: '[price] * [qty]', enabled: true };
function harness({ saved = [], fail = false } = {}) {
  const calls = [];
  let configs = structuredClone(saved);
  const client = {
    release() {},
    async query(sql, args) {
      calls.push(sql);
      if (sql.includes('to_regnamespace') || sql.includes('to_regclass')) return { rows: [{ present: true }] };
      if (sql.startsWith('SELECT config FROM siris_admin.formula_configs'))
        return { rows: configs.map(config => ({ config })) };
      if (sql.startsWith('SELECT config FROM siris_admin.lookup_configs')) return { rows: [] };
      if (fail && sql.startsWith('UPDATE public.')) throw Object.assign(Error('private'), { code: '22012' });
      if (sql.startsWith('INSERT INTO siris_admin.formula_configs'))
        configs = [...configs.filter(c => c.table !== args[0] || c.column !== args[1]), JSON.parse(args[2])];
      if (sql.startsWith('DELETE FROM siris_admin.formula_configs'))
        configs = configs.filter(c => c.table !== args[0] || c.column !== args[1]);
      return { rows: [] };
    },
  };
  return {
    calls,
    client,
    service: createFormulaSync({ query: client.query, connect: async () => client }, async () => [table]),
  };
}
describe('Formula đồng bộ', () => {
  it('sắp thứ tự phụ thuộc và chặn vòng, cột không hợp lệ và xung đột lookup', () => {
    const tax = { table: 'rooms', column: 'tax', expression: '[total] * .1', enabled: true };
    expect(checkFormulas(table, [tax, config]).map(x => x.config.column)).toEqual(['total', 'tax']);
    expect(() => checkFormulas(table, [tax, { ...config, expression: '[tax]' }])).toThrow('vòng');
    expect(() => checkFormulas(table, [{ ...config, column: 'id' }])).toThrow('khóa');
    expect(() =>
      checkFormulas(
        table,
        [config],
        [{ sourceTable: 'rooms', sync: { enabled: true, columnName: 'total' }, conditions: [] }],
      ),
    ).toThrow('lookup');
  });
  it('tạo trigger có thứ tự và cập nhật dữ liệu hiện có', () => {
    const sql = formulaTriggerSQL('rooms', checkFormulas(table, [config])).join('\n');
    expect(sql).toContain('BEFORE INSERT OR UPDATE');
    expect(sql).toContain('NEW."price"::numeric');
    expect(sql).toContain('UPDATE public."rooms"');
    expect(sql).not.toContain('SECURITY DEFINER');
  });
  it('bật formula trong transaction và tắt vẫn giữ giá trị', async () => {
    const h = harness();
    await h.service.save(config);
    expect(h.calls).toContain('COMMIT');
    expect(h.calls.some(s => s.startsWith('CREATE TRIGGER'))).toBe(true);
    h.calls.length = 0;
    expect(await h.service.save({ ...config, enabled: false })).toBeNull();
    expect(h.calls).toContain('COMMIT');
    expect(h.calls.some(s => s.startsWith('DELETE FROM siris_admin.formula_configs'))).toBe(true);
    expect(await h.service.list()).toEqual([]);
    expect(h.calls.some(s => s.startsWith('UPDATE public.'))).toBe(false);
  });
  it('chia cho 0 rollback và không lưu cấu hình', async () => {
    const h = harness({ fail: true });
    await expect(h.service.save({ ...config, expression: '[price] / [qty]' })).rejects.toThrow('chia cho 0');
    expect(h.calls).toContain('ROLLBACK');
    expect(h.calls).not.toContain('COMMIT');
    expect(h.calls.some(s => s.startsWith('INSERT INTO siris_admin.formula_configs'))).toBe(false);
  });
});

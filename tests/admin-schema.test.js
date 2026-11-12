import { describe, it, expect } from 'vitest';
import { createAdmin, safeError } from '../admin.mjs';
function fixture({
  dependent = false,
  fail = false,
  typeConstraint = false,
  generated = false,
  dependencies = [],
  lockedDependencies = [],
} = {}) {
  const calls = [];
  let locked = false;
  const client = {
    release() {},
    async query(sql) {
      calls.push(sql);
      if (sql.startsWith('LOCK TABLE')) locked = true;
      if (sql.includes('pg_describe_object'))
        return {
          rows: (locked ? [...dependencies, ...lockedDependencies] : dependencies).map(description => ({
            description,
          })),
        };
      if (sql.startsWith('SELECT c.oid::text'))
        return {
          rows: [
            {
              table_oid: '1',
              table_name: 'rooms',
              column_id: 1,
              column_name: 'id',
              data_type: 'integer',
              format: 'integer',
              attnotnull: true,
              is_primary: true,
              has_type_constraint: typeConstraint,
            },
            {
              table_oid: '1',
              table_name: 'rooms',
              column_id: 2,
              column_name: 'note',
              attgenerated: generated ? 's' : '',
              default_value: generated ? '(0.45 * amount)' : null,
              data_type: 'text',
              format: 'text',
              attnotnull: false,
            },
            {
              table_oid: '2',
              table_name: 'branches',
              column_id: 1,
              column_name: 'id',
              data_type: 'integer',
              format: 'integer',
              attnotnull: true,
              is_primary: true,
            },
          ],
        };
      if (sql.includes("to_regclass('siris_admin.columns')")) return { rows: [{ name: null }] };
      if (sql.includes("to_regclass('siris_admin.lookup_configs')")) return { rows: [{ present: dependent }] };
      if (sql.startsWith('SELECT t.typname AS name')) return { rows: [{ name: 'room_status' }] };
      if (sql.startsWith('SELECT config FROM'))
        return {
          rows: [{ config: { sourceTable: 'rooms', conditions: [{ sourceColumn: 'note', targetKey: 'id' }] } }],
        };
      if (sql.startsWith('SELECT count(')) return { rows: [{ n: '2' }] };
      if (fail && sql.startsWith('ALTER TABLE')) throw Error('ddl failed');
      return { rows: [] };
    },
  };
  return { calls, admin: createAdmin(null, { query: client.query, connect: async () => client, end: async () => {} }) };
}
describe('quản lý cột', () => {
  it('cho phép xóa cột generated sau khi kiểm tra phụ thuộc và xác nhận preview', async () => {
    const { admin, calls } = fixture({ generated: true });
    const operation = { table: 'rooms', action: 'delete', column: 'note' };
    const preview = await admin.preview(operation);
    expect('generatedExpression' in preview && preview.generatedExpression).toBe('(0.45 * amount)');
    expect('dependenciesChecked' in preview && preview.dependenciesChecked).toBe(true);
    await admin.apply(operation, preview.signature);
    expect(calls).toContain('ALTER TABLE public."rooms" DROP COLUMN "note" RESTRICT');
    expect(calls).toContain('COMMIT');
    expect(calls.filter(sql => sql.includes('pg_describe_object'))).toHaveLength(3);
  });
  it('chặn cột generated có view, ràng buộc hoặc cột khác phụ thuộc', async () => {
    for (const dependency of ['view room_totals', 'constraint rooms_total_check', 'default for column tax']) {
      const { admin, calls } = fixture({ generated: true, dependencies: [dependency] });
      await expect(admin.preview({ table: 'rooms', action: 'delete', column: 'note' })).rejects.toThrow(dependency);
      expect(calls.some(sql => sql.startsWith('ALTER TABLE'))).toBe(false);
    }
  });
  it('kiểm tra lại phụ thuộc sau khi khóa bảng trước khi xóa', async () => {
    const { admin, calls } = fixture({ generated: true, lockedDependencies: ['view created_after_preview'] });
    const operation = { table: 'rooms', action: 'delete', column: 'note' };
    const preview = await admin.preview(operation);
    await expect(admin.apply(operation, preview.signature)).rejects.toThrow('created_after_preview');
    expect(calls).toContain('ROLLBACK');
    expect(calls.some(sql => sql.startsWith('ALTER TABLE'))).toBe(false);
  });
  it('cho phép xem trước đổi kiểu khóa chính khi không có phụ thuộc và chặn khi có khóa ngoại', async () => {
    const op = { table: 'rooms', action: 'type', column: 'id', newType: 'bigint' },
      allowed = fixture(),
      preview = await allowed.admin.preview(op);
    await allowed.admin.apply(op, preview.signature);
    expect(allowed.calls).toContain('ALTER TABLE public."rooms" ALTER COLUMN "id" TYPE bigint USING "id"::bigint');
    await expect(fixture({ typeConstraint: true }).admin.preview(op)).rejects.toThrow('ràng buộc');
  });
  it('xem trước rồi áp dụng trong transaction', async () => {
    const { admin, calls } = fixture(),
      operation = { table: 'rooms', action: 'rename', column: 'note', newName: 'memo' },
      preview = await admin.preview(operation);
    expect(preview.affected).toBe(2);
    await admin.apply(operation, preview.signature);
    expect(calls).toContain('BEGIN');
    expect(calls).toContain('ALTER TABLE public."rooms" RENAME COLUMN "note" TO "memo"');
    expect(calls).toContain('COMMIT');
  });
  it('chặn cột đang được lookup sử dụng', async () => {
    const { admin } = fixture({ dependent: true });
    await expect(admin.preview({ table: 'rooms', action: 'delete', column: 'note' })).rejects.toThrow('lookup');
  });
  it('rollback khi thay đổi thất bại và từ chối xác nhận cũ', async () => {
    const { admin, calls } = fixture({ fail: true }),
      op = { table: 'rooms', action: 'rename', column: 'note', newName: 'memo' },
      preview = await admin.preview(op);
    await expect(admin.apply(op, '0'.repeat(64))).rejects.toThrow('thay đổi');
    await expect(admin.apply(op, preview.signature)).rejects.toThrow('ddl failed');
    expect(calls.filter(x => x === 'ROLLBACK')).toHaveLength(2);
  });
});

describe('tùy chọn cột mới', () => {
  it('tạo cột với giá trị mặc định và mô tả được escape', async () => {
    const { admin, calls } = fixture();
    const op = {
      table: 'rooms',
      action: 'add',
      newName: 'status',
      newType: 'text',
      options: {
        nullable: true,
        unique: false,
        defaultKind: 'literal',
        defaultValue: "a'b",
        description: "ghi chú 'an toàn'",
      },
    };
    const preview = await admin.preview(op);
    await admin.apply(op, preview.signature);
    expect(calls).toContain('ALTER TABLE public."rooms" ADD COLUMN "status" text DEFAULT \'a\'\'b\'::text');
    expect(calls).toContain("COMMENT ON COLUMN public.\"rooms\".\"status\" IS 'ghi chú ''an toàn'''");
  });
  it('chặn cột bắt buộc không mặc định và identity không hợp lệ', async () => {
    const { admin } = fixture();
    await expect(
      admin.preview({ table: 'rooms', action: 'add', newName: 'x', newType: 'text', options: { nullable: false } }),
    ).rejects.toThrow('Bảng đã có dữ liệu');
    await expect(
      admin.preview({ table: 'rooms', action: 'add', newName: 'x', newType: 'text', options: { identity: true } }),
    ).rejects.toThrow('Identity');
  });
});

describe('cột mảng', () => {
  it('tạo mảng từ kiểu được hỗ trợ', async () => {
    const { admin, calls } = fixture();
    const op = {
      table: 'rooms',
      action: 'add',
      newName: 'tags',
      newType: 'text',
      options: { array: true, nullable: true },
    };
    const preview = await admin.preview(op);
    await admin.apply(op, preview.signature);
    expect(calls).toContain('ALTER TABLE public."rooms" ADD COLUMN "tags" text[]');
  });
  it('không cho identity trên mảng', async () => {
    const { admin } = fixture();
    await expect(
      admin.preview({
        table: 'rooms',
        action: 'add',
        newName: 'ids',
        newType: 'integer',
        options: { array: true, identity: true },
      }),
    ).rejects.toThrow('Mảng');
  });
});

describe('kiểu enum có sẵn', () => {
  it('chỉ tạo cột bằng enum đã đọc từ public', async () => {
    const { admin, calls } = fixture(),
      op = { table: 'rooms', action: 'add', newName: 'status', newType: 'enum', options: { enumType: 'room_status' } };
    const preview = await admin.preview(op);
    await admin.apply(op, preview.signature);
    expect(calls).toContain('ALTER TABLE public."rooms" ADD COLUMN "status" public."room_status"');
  });
  it('chặn enum không tồn tại hoặc tên SQL', async () => {
    const { admin } = fixture();
    await expect(
      admin.preview({
        table: 'rooms',
        action: 'add',
        newName: 'status',
        newType: 'enum',
        options: { enumType: 'bad;DROP' },
      }),
    ).rejects.toThrow('enum');
  });
});

describe('khóa ngoại', () => {
  it('tạo tham chiếu tới khóa chính cùng kiểu', async () => {
    const { admin, calls } = fixture(),
      op = {
        table: 'rooms',
        action: 'add',
        newName: 'branch_id',
        newType: 'integer',
        options: { foreignTable: 'branches', foreignColumn: 'id', onDelete: 'SET NULL', onUpdate: 'NO ACTION' },
      };
    const preview = await admin.preview(op);
    await admin.apply(op, preview.signature);
    expect(calls).toContain(
      'ALTER TABLE public."rooms" ADD COLUMN "branch_id" integer REFERENCES public."branches" ("id") ON DELETE SET NULL ON UPDATE NO ACTION',
    );
  });
  it('từ chối kiểu không khớp và hành động không hợp lệ', async () => {
    const { admin } = fixture();
    await expect(
      admin.preview({
        table: 'rooms',
        action: 'add',
        newName: 'ref',
        newType: 'text',
        options: { foreignTable: 'branches', foreignColumn: 'id' },
      }),
    ).rejects.toThrow('cùng kiểu');
    await expect(
      admin.preview({
        table: 'rooms',
        action: 'add',
        newName: 'ref',
        newType: 'integer',
        options: { foreignTable: 'branches', foreignColumn: 'id', onDelete: 'CASCADE; DROP' },
      }),
    ).rejects.toThrow('không hợp lệ');
  });
});

describe('biểu thức mặc định', () => {
  it('cho phép biểu thức ngày được kiểm tra', async () => {
    const { admin, calls } = fixture(),
      op = {
        table: 'rooms',
        action: 'add',
        newName: 'created_at',
        newType: 'timestamp',
        options: { defaultKind: 'expression', defaultValue: "now() + interval '3 days'" },
      };
    const preview = await admin.preview(op);
    await admin.apply(op, preview.signature);
    expect(calls).toContain(
      'ALTER TABLE public."rooms" ADD COLUMN "created_at" timestamp with time zone DEFAULT now() + interval \'3 days\'',
    );
  });
  it('đặt lock_timeout và statement_timeout trước LOCK TABLE với mọi thao tác', async () => {
    const operations = [
      { table: 'rooms', action: 'add', newName: 'memo', newType: 'text', options: { nullable: true } },
      { table: 'rooms', action: 'rename', column: 'note', newName: 'memo' },
      { table: 'rooms', action: 'type', column: 'id', newType: 'bigint' },
      { table: 'rooms', action: 'delete', column: 'note' },
      {
        table: 'rooms',
        action: 'settings',
        column: 'note',
        options: { nullable: true, unique: false, defaultKind: 'keep', description: '' },
      },
    ];
    for (const operation of operations) {
      const { admin, calls } = fixture();
      const preview = await admin.preview(operation);
      calls.length = 0;
      await admin.apply(operation, preview.signature);
      const lock = calls.findIndex(sql => sql.startsWith('LOCK TABLE'));
      expect(lock, operation.action).toBeGreaterThan(-1);
      expect(calls.slice(0, lock), operation.action).toEqual(
        expect.arrayContaining(["SET LOCAL lock_timeout = '5s'", "SET LOCAL statement_timeout = '60s'"]),
      );
    }
  });
  it('báo bảng đang bận khi hết thời gian chờ khóa', () => {
    expect(safeError({ code: '55P03' })).toBe('Bảng đang được sử dụng; vui lòng thử lại.');
  });
  it('từ chối SQL ngoài danh sách an toàn', async () => {
    const { admin } = fixture();
    await expect(
      admin.preview({
        table: 'rooms',
        action: 'add',
        newName: 'v',
        newType: 'text',
        options: { defaultKind: 'expression', defaultValue: 'now(); DROP TABLE rooms' },
      }),
    ).rejects.toThrow('Biểu thức');
  });
});

describe('tải metadata', () => {
  it('gửi các truy vấn độc lập song song khi dùng pool', async () => {
    const calls = [];
    let release;
    const gate = new Promise(resolve => {
      release = resolve;
    });
    const pool = {
      async query(sql) {
        calls.push(sql);
        if (calls.length === 5) release();
        await gate;
        return { rows: [] };
      },
      async end() {},
    };
    const admin = createAdmin(null, pool);
    const result = await admin.metadata();
    expect(calls).toHaveLength(5);
    expect(result).toEqual([]);
  });
  it('giữ thứ tự từng truy vấn khi dùng kết nối transaction', async () => {
    let running = 0,
      max = 0;
    const client = {
      async query() {
        running++;
        max = Math.max(max, running);
        await Promise.resolve();
        running--;
        return { rows: [] };
      },
    };
    const pool = { query: client.query, async end() {} };
    const admin = createAdmin(null, pool);
    await admin.metadata(client);
    expect(max).toBe(1);
  });
});

describe('nhân bản cột', () => {
  function duplicateFixture({ format = 'numeric(12,2)', failUpdate = false, formulas = [], lookups = [] } = {}) {
    const calls = [];
    const client = {
      release() {},
      async query(sql) {
        calls.push(sql);
        if (sql.includes("to_regclass('siris_admin.formula_configs')")) return { rows: [{ present: true }] };
        if (sql.includes("to_regclass('siris_admin.lookup_configs')")) return { rows: [{ present: true }] };
        if (sql.startsWith('SELECT config FROM siris_admin.formula_configs'))
          return { rows: formulas.map(config => ({ config })) };
        if (sql.startsWith('SELECT config FROM siris_admin.lookup_configs'))
          return { rows: lookups.map(config => ({ config })) };
        if (sql.startsWith('SELECT c.oid::text'))
          return {
            rows: [
              {
                table_oid: '1',
                table_name: 'rooms',
                column_id: 1,
                column_name: 'price',
                data_type: 'numeric',
                format,
                attnotnull: true,
                is_primary: true,
                attidentity: 'a',
                has_constraint: true,
                description: 'Giá phòng',
                default_value: '42',
              },
            ],
          };
        if (sql.includes("to_regclass('siris_admin.columns')")) return { rows: [{ name: null }] };
        if (sql.startsWith('SELECT count(')) return { rows: [{ n: '3' }] };
        if (failUpdate && sql.startsWith('UPDATE')) throw Error('copy failed');
        return { rows: [] };
      },
    };
    return {
      calls,
      admin: createAdmin(null, { query: client.query, connect: async () => client, end: async () => {} }),
    };
  }
  it('nhân bản giá trị cột đang có formula hoặc lookup mà không tắt cấu hình', async () => {
    const formulas = [{ table: 'rooms', column: 'price', enabled: true }];
    const lookups = [{ sourceTable: 'rooms', sync: { enabled: true, columnName: 'price' } }];
    for (const config of [{ formulas }, { lookups }]) {
      const { admin, calls } = duplicateFixture(config);
      const operation = { table: 'rooms', action: 'duplicate', column: 'price', newName: 'copy' };
      const preview = await admin.preview(operation);
      await admin.apply(operation, preview.signature);
      expect(calls).toContain('ALTER TABLE public."rooms" ADD COLUMN "copy" numeric(12,2)');
      expect(calls.some(sql => /DROP TRIGGER|UPDATE siris_admin|DELETE FROM siris_admin/.test(sql))).toBe(false);
    }
    expect(formulas[0].enabled).toBe(true);
    expect(lookups[0].sync.enabled).toBe(true);
  });
  it('sao chép kiểu chính xác và giá trị trong transaction, không sao chép identity hay khóa', async () => {
    const { admin, calls } = duplicateFixture(),
      op = { table: 'rooms', action: 'duplicate', column: 'price', newName: 'price_copy' };
    const p = await admin.preview(op);
    expect(p.affected).toBe(3);
    await admin.apply(op, p.signature);
    expect(calls).toContain('ALTER TABLE public."rooms" ADD COLUMN "price_copy" numeric(12,2)');
    expect(calls).toContain('UPDATE public."rooms" SET "price_copy" = "price" WHERE "price" IS NOT NULL');
    expect(calls).toContain('COMMIT');
    expect(calls.filter(x => x.startsWith('ALTER TABLE')).join(' ')).not.toMatch(
      /IDENTITY|PRIMARY|UNIQUE|DEFAULT|NOT NULL/,
    );
  });
  it('giữ kiểu mảng enum từ metadata', async () => {
    const { admin, calls } = duplicateFixture({ format: 'public.room_status[]' }),
      op = { table: 'rooms', action: 'duplicate', column: 'price', newName: 'statuses' };
    const p = await admin.preview(op);
    await admin.apply(op, p.signature);
    expect(calls).toContain('ALTER TABLE public."rooms" ADD COLUMN "statuses" public.room_status[]');
  });
  it('rollback cả cột mới khi sao chép dữ liệu thất bại', async () => {
    const { admin, calls } = duplicateFixture({ failUpdate: true }),
      op = { table: 'rooms', action: 'duplicate', column: 'price', newName: 'price_copy' };
    const p = await admin.preview(op);
    await expect(admin.apply(op, p.signature)).rejects.toThrow('copy failed');
    expect(calls).toContain('ROLLBACK');
    expect(calls).not.toContain('COMMIT');
  });
  it('chặn trùng tên, tên SQL không hợp lệ, cột nguồn mất và preview cũ', async () => {
    const { admin } = duplicateFixture(),
      op = { table: 'rooms', action: 'duplicate', column: 'price', newName: 'copy' };
    await expect(admin.preview({ ...op, newName: 'price' })).rejects.toThrow('đã tồn tại');
    await expect(admin.preview({ ...op, newName: 'copy; DROP' })).rejects.toThrow('không hợp lệ');
    await expect(admin.preview({ ...op, column: 'missing' })).rejects.toThrow('Không tìm thấy');
    await expect(admin.apply(op, '0'.repeat(64))).rejects.toThrow('đã thay đổi');
  });
});

import { describe, it, expect, vi } from 'vitest';
import { recordIdentity, deleteRecordBatch } from '../record-deletion.mjs';
const table = { name: 'public.demo', primary_keys: ['id'] };

describe('xóa bản ghi bằng khóa đã chụp', () => {
  it('hỗ trợ khóa ghép và không nhận bản ghi thiếu khóa', () => {
    const composite = { name: 'public.demo', primary_keys: ['branchid', 'id'] };
    expect(recordIdentity(composite, { branchid: 'a', id: '9007199254740993' })).toBeTruthy();
    expect(recordIdentity(composite, { id: 1 })).toBeNull();
    expect(recordIdentity({ primary_keys: [] }, { id: 1 })).toBeNull();
  });
  it('chụp khóa của toàn bộ lô trước khi gửi, kể cả số lớn dạng chuỗi', async () => {
    const rows = [{ id: '9007199254740993' }, { id: '9007199254740994' }];
    const api = vi.fn(async (_url, options) => {
      const key = JSON.parse(options.body).key;
      rows[1].id = 'changed';
      return { rows: [key] };
    });
    const result = await deleteRecordBatch({ api, table, rows });
    expect(result.deleted).toHaveLength(2);
    expect(JSON.parse(api.mock.calls[1][1].body).key.id).toBe('9007199254740994');
    expect(result.deleted[1].row.id).toBe('9007199254740994');
  });
  it('lỗi đã xác định ở một dòng không chặn các dòng còn lại', async () => {
    const onDeleted = vi.fn();
    const api = vi.fn(async (_url, options) => {
      const key = JSON.parse(options.body).key;
      if (key.id === 2) throw Object.assign(Error('foreign key'), { status: 400 });
      return { rows: [key] };
    });
    const result = await deleteRecordBatch({ api, table, rows: [{ id: 1 }, { id: 2 }, { id: 3 }], onDeleted });
    expect(result.deleted.map(entry => entry.key.id)).toEqual([1, 3]);
    expect(result.failed.map(entry => entry.key.id)).toEqual([2]);
    expect(onDeleted).toHaveBeenCalledTimes(2);
  });
  it('timeout dừng các yêu cầu tiếp theo và không đánh dấu xóa thành công', async () => {
    const api = vi.fn(
      (_url, options) =>
        new Promise((_resolve, reject) => {
          options.signal.addEventListener('abort', () =>
            reject(Object.assign(Error('aborted'), { name: 'AbortError' })),
          );
        }),
    );
    const result = await deleteRecordBatch({ api, table, rows: [{ id: 1 }, { id: 2 }], timeoutMs: 5 });
    expect(result.deleted).toHaveLength(0);
    expect(result.uncertain.key.id).toBe(1);
    expect(result.unattempted).toHaveLength(1);
    expect(api).toHaveBeenCalledTimes(1);
  });
  it('phản hồi không có dòng đã xóa không được coi là thành công', async () => {
    const api = vi.fn(async () => ({ rows: [] }));
    const result = await deleteRecordBatch({ api, table, rows: [{ id: 1 }, { id: 2 }] });
    expect(result.deleted).toHaveLength(0);
    expect(result.uncertain).not.toBeNull();
    expect(api).toHaveBeenCalledTimes(1);
  });
});

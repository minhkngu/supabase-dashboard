export function recordIdentity(table, row) {
  if (!table?.primary_keys?.length || !row || table.primary_keys.some(key => row[key] == null)) return null;
  return JSON.stringify(table.primary_keys.map(key => [key, String(row[key])]));
}

// Capture keys before the first await. Never retry an uncertain write.
export async function deleteRecordBatch({
  api,
  table,
  rows,
  onDeleted = () => {},
  onProgress = () => {},
  timeoutMs = 20000,
}) {
  const entries = [
    ...new Map(
      rows.map(row => {
        const identity = recordIdentity(table, row);
        if (!identity) throw Error('Bản ghi không có khóa chính đầy đủ để xóa.');
        return [
          identity,
          { identity, key: Object.fromEntries(table.primary_keys.map(key => [key, row[key]])), row: { ...row } },
        ];
      }),
    ).values(),
  ];
  const deleted = [],
    failed = [];
  let uncertain = null,
    attempted = 0;
  for (const entry of entries) {
    onProgress(++attempted, entries.length);
    const controller = new AbortController(),
      timer = setTimeout(() => controller.abort(), timeoutMs);
    let response;
    try {
      response = await api(`/api/table/${table.name.replace(/^public\./, '')}`, {
        method: 'DELETE',
        signal: controller.signal,
        body: JSON.stringify({ key: entry.key }),
      });
    } catch (error) {
      if (!Number.isInteger(error.status) || error.name === 'AbortError') {
        uncertain = {
          ...entry,
          message:
            error.name === 'AbortError' ? 'Yêu cầu quá thời gian chờ; chưa xác nhận được kết quả xóa.' : error.message,
        };
        break;
      }
      failed.push({ ...entry, message: error.message });
      continue;
    } finally {
      clearTimeout(timer);
    }
    if (!Array.isArray(response?.rows) || !response.rows.some(row => recordIdentity(table, row) === entry.identity)) {
      uncertain = { ...entry, message: 'Máy chủ chưa trả về bản ghi đã xóa để xác nhận kết quả.' };
      break;
    }
    deleted.push(entry);
    onDeleted(entry);
  }
  return { deleted, failed, uncertain, unattempted: entries.slice(attempted), total: entries.length };
}

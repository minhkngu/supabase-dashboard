import { body, response } from '../http.mjs';

const COLUMN_ACTIONS = ['rename', 'type', 'delete', 'settings'];

export async function handleSchema(ctx, req, res, u) {
  if (!u.pathname.startsWith('/api/admin/')) return false;
  const { admin } = ctx;
  if (!admin.enabled) {
    response(res, 403, { error: ctx.config.admin.error });
    return true;
  }
  if (req.method !== 'POST') {
    response(res, 405, { error: 'Không hỗ trợ' });
    return true;
  }
  if (u.pathname === '/api/admin/schema/preview') {
    const operation = await body(req);
    ctx.meta(operation.table);
    if (operation.column && COLUMN_ACTIONS.includes(operation.action))
      await ctx.assertNotUsedByFormula(operation.table, operation.column);
    response(res, 200, await admin.preview(operation));
    return true;
  }
  if (u.pathname === '/api/admin/schema/apply') {
    const input = await body(req);
    if (typeof input.signature !== 'string' || !/^[a-f0-9]{64}$/.test(input.signature))
      throw Error('Thiếu xác nhận xem trước.');
    const operation = input.operation;
    ctx.meta(operation?.table);
    if (operation.column && COLUMN_ACTIONS.includes(operation.action))
      await ctx.assertNotUsedByFormula(operation.table, operation.column);
    const result = await admin.apply(operation, input.signature);
    console.info(
      JSON.stringify({
        event: 'schema_apply',
        table: operation?.table,
        action: operation?.action,
        column: operation?.column,
        at: new Date().toISOString(),
      }),
    );
    // The preflight may have warmed metadata before the schema transaction.
    ctx.invalidateCaches();
    try {
      await ctx.refreshTables();
    } catch {
      response(res, 200, {
        ...result,
        warning: 'Đã thay đổi cột nhưng không tải lại được cấu trúc; hãy tải lại trang.',
      });
      return true;
    }
    response(res, 200, result);
    return true;
  }
  response(res, 403, { error: 'Chức năng này chưa được hỗ trợ.' });
  return true;
}

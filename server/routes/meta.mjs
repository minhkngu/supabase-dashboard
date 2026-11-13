import { response } from '../http.mjs';

export async function handleMeta(ctx, req, res, u) {
  if (u.pathname !== '/api/meta' || req.method !== 'GET') return false;
  let adminAvailable = false,
    adminError = '',
    enumTypes = [];
  if (ctx.admin.enabled) {
    try {
      const metadata = await ctx.cachedMetadata();
      ctx.tables = metadata.tables;
      enumTypes = metadata.enumTypes;
      adminAvailable = true;
    } catch {
      adminError = 'Không thể kết nối hoặc đọc cấu trúc database. Kiểm tra SUPABASE_DB_URL và quyền truy cập.';
    }
  } else adminError = ctx.config.admin.error;
  const token = typeof ctx.csrf === 'function' ? ctx.csrf(req) : ctx.csrf;
  response(res, 200, {
    tables: ctx.tables,
    token,
    adminAvailable,
    adminError,
    enumTypes,
    logout: !!ctx.config.session,
  });
  return true;
}

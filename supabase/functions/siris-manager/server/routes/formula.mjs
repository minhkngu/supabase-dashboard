import { parseFormula } from '../../formula-parser.mjs';
import { body, response } from '../http.mjs';
import { columns } from '../context.mjs';

export async function handleFormula(ctx, req, res, u) {
  if (u.pathname !== '/api/formula-config') return false;
  if (req.method === 'GET') {
    if (ctx.admin.enabled) ctx.tables = (await ctx.cachedMetadata()).tables;
    const items = await ctx.cachedConfig('formula', () => ctx.admin.formulaSync.list());
    response(res, 200, {
      items: items.filter(c =>
        ctx.tables.some(t => t.name === `public.${c.table}` && t.columns.some(x => x.name === c.column)),
      ),
    });
    return true;
  }
  if (req.method === 'POST') {
    const config = await body(req),
      t = ctx.meta(config.table);
    if (!columns(t).has(config.column)) throw Error('Cột không hợp lệ.');
    if (config.enabled) parseFormula(config.expression, t.columns);
    response(res, 200, { config: await ctx.admin.formulaSync.save(config) });
    return true;
  }
  return false;
}

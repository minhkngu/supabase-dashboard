import { body, response } from '../http.mjs';
import { UI_SETTINGS_STORE_MISSING } from '../../ui-settings-store.mjs';

export async function handleUiSettings(ctx, req, res, u) {
  if (u.pathname !== '/api/ui-settings') return false;
  if (req.method === 'GET') {
    try {
      response(res, 200, { available: true, items: await ctx.uiSettingsStore.list() });
    } catch (error) {
      if (error.message !== UI_SETTINGS_STORE_MISSING) throw error;
      response(res, 200, { available: false, items: {} });
    }
    return true;
  }
  if (req.method === 'POST') {
    const input = await body(req);
    const saved = await ctx.uiSettingsStore.save(input.key, input.value);
    response(res, 200, { ok: true, ...saved });
    return true;
  }
  return false;
}

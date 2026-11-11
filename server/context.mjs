// Shared server state: the table metadata in use, the admin connection,
// caches and the Supabase Data API client.
import { randomBytes } from 'node:crypto';
import pg from 'pg';
import { createAdmin } from '../admin.mjs';
import { createLookupStore } from '../lookup-store.mjs';
import { parseFormula } from '../formula-parser.mjs';
import { createTtlCache } from '../server-cache.mjs';

export const LOOKUP_STORE_MISSING = 'Chưa thiết lập nơi lưu lookup trên Supabase.';

// tables: the saved schema.json metadata, used until live metadata is read.
export async function createContext(config, tables) {
  const admin = createAdmin(config.admin.url),
    lookupPool = config.admin.url
      ? new pg.Pool({ connectionString: config.admin.url, max: 2, connectionTimeoutMillis: 5000 })
      : null,
    lookupStore = createLookupStore(lookupPool),
    configCache = createTtlCache();
  const ctx = {
    config,
    admin,
    lookupStore,
    csrf: config.csrf || randomBytes(24).toString('hex'),
    tables: structuredClone(tables),
    cachedConfig: (key, read) => configCache.get(key, read),
    async cachedLookups() {
      try {
        return await ctx.cachedConfig('lookup', () => lookupStore.list());
      } catch (error) {
        if (error.message === LOOKUP_STORE_MISSING) return [];
        throw error;
      }
    },
    meta(name) {
      const t = ctx.tables.find(t => t.name === `public.${name}`);
      if (!t) throw Error('Bảng không được hỗ trợ');
      return t;
    },
    upstream: (route, options) => upstream(config, route, options),
    async refreshTables() {
      ctx.tables = await admin.visibleMetadata('anon');
    },
    // Formula columns read other columns, so those columns cannot change shape.
    async assertNotUsedByFormula(table, column) {
      const t = ctx.meta(table);
      const formulas = (await admin.formulaSync.list()).filter(x => x.enabled && x.table === table);
      if (formulas.some(f => f.column === column || parseFormula(f.expression, t.columns).columns.includes(column)))
        throw Error('Cột đang được formula sử dụng; hãy tắt hoặc chỉnh formula trước.');
    },
  };
  let metadataCache = null,
    metadataPending = null,
    metadataGeneration = 0;
  ctx.cachedMetadata = function cachedMetadata() {
    if (metadataCache && Date.now() - metadataCache.time < 60000) return metadataCache.value;
    if (metadataPending) return metadataPending;
    const generation = metadataGeneration;
    const pending = Promise.all([admin.visibleMetadata('anon'), admin.enumTypes()])
      .then(([value, enumTypes]) => {
        const result = { tables: value, enumTypes };
        if (generation === metadataGeneration) metadataCache = { time: Date.now(), value: result };
        return result;
      })
      .finally(() => {
        if (metadataPending === pending) metadataPending = null;
      });
    metadataPending = pending;
    return pending;
  };
  ctx.invalidateCaches = () => {
    metadataGeneration++;
    metadataCache = null;
    metadataPending = null;
    configCache.clear();
  };
  return ctx;
}

export function columns(t) {
  return new Map(t.columns.map(c => [c.name, c]));
}

async function upstream({ url, key }, route, options = {}) {
  if (!url || !key) throw Error('Chưa cấu hình kết nối Supabase. Xem hướng dẫn trong README.md.');
  const r = await fetch(url.replace(/\/$/, '') + '/rest/v1/' + route, {
    ...options,
    headers: { apikey: key, Authorization: `Bearer ${key}`, 'Content-Type': 'application/json', ...options.headers },
  });
  const text = await r.text();
  let data;
  try {
    data = text ? JSON.parse(text) : null;
  } catch {
    data = text;
  }
  if (!r.ok) {
    throw Object.assign(Error(data?.message || data?.error_description || `Supabase trả về lỗi ${r.status}`), {
      status: r.status,
    });
  }
  return { data, range: r.headers.get('content-range') };
}

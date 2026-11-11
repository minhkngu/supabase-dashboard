import { beforeEach, describe, expect, it, vi } from 'vitest';
const db = vi.hoisted(() => ({ columns: ['name'] }));
vi.mock('../admin.mjs', () => ({
  safeError: error => error.message,
  createAdmin: () => ({
    enabled: true,
    visibleMetadata: async () => [
      { name: 'public.demo', columns: db.columns.map(name => ({ name })), primary_keys: [] },
    ],
    enumTypes: async () => [],
    apply: async () => {
      db.columns = ['name', 'name_copy'];
      return { ok: true };
    },
    formulaSync: { list: async () => [] },
  }),
}));
import { createApp } from '../server/app.mjs';
import { configFromEnv } from '../server/config.mjs';
const config = () => configFromEnv({}, { port: 4173, csrf: 'test' });
async function call(app, path, method = 'GET', input = undefined) {
  let result;
  await app(
    {
      url: path,
      method,
      headers: { host: 'localhost:4173', origin: 'http://localhost:4173', 'x-siris-token': 'test' },
      async *[Symbol.asyncIterator]() {
        if (input) yield Buffer.from(JSON.stringify(input));
      },
    },
    {
      writeHead() {},
      end(text) {
        result = JSON.parse(text);
      },
    },
  );
  return result;
}
const names = result => result.tables[0].columns.map(column => column.name);
describe('schema changes on serverless instances', () => {
  beforeEach(() => {
    db.columns = ['name'];
  });
  it('shows a duplicate immediately on the instance that applied it', async () => {
    const app = await createApp(config(), [], { liveMetadataEachRequest: true });
    await call(app, '/api/meta');
    await call(app, '/api/admin/schema/apply', 'POST', {
      operation: { table: 'demo', action: 'duplicate', column: 'name', newName: 'name_copy' },
      signature: 'a'.repeat(64),
    });
    expect(names(await call(app, '/api/meta'))).toContain('name_copy');
  });
  it('explicit refresh bypasses metadata cached on another instance', async () => {
    const other = await createApp(config(), [], { liveMetadataEachRequest: true });
    await call(other, '/api/meta');
    db.columns.push('name_copy');
    expect(names(await call(other, '/api/meta?refresh=1'))).toContain('name_copy');
  });
});

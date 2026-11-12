import { describe, expect, it } from 'vitest';
import { createPool } from '../server/context.mjs';

describe('PostgreSQL pool', () => {
  it('keeps idle connections alive for five minutes', async () => {
    const pool = createPool('postgres://user:pass@127.0.0.1:5432/example');
    expect(pool).toBeTruthy();
    expect(pool.options.max).toBe(4);
    expect(pool.options.idleTimeoutMillis).toBe(300000);
    expect(pool.options.keepAlive).toBe(true);
    await pool.end();
  });

  it('has no pool without a connection string', () => {
    expect(createPool('')).toBeNull();
  });
});

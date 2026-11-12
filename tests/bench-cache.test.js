import { describe, expect, it } from 'vitest';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);
const pgBin = process.env.SIRIS_BENCH_PG_BIN;

// The benchmark needs a real PostgreSQL binary; CI provides one in the job
// that sets SIRIS_BENCH_PG_BIN, other runs skip this check.
describe.skipIf(!pgBin)('benchmark cache', () => {
  it('writes do not clear the configuration or metadata cache', async () => {
    const { stdout } = await execFileAsync(process.execPath, ['scripts/bench.mjs', '--verify-cache'], {
      cwd: process.cwd(),
      env: { ...process.env, SIRIS_BENCH_PG_BIN: pgBin },
      timeout: 120_000,
    });
    expect(stdout).toContain('Kiểm tra cache và pool sau hai lần ghi: đạt');
  }, 120_000);
});

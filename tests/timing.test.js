import { expect, it } from 'vitest';
import { response } from '../server/http.mjs';
import { measure, withTiming } from '../server/timing.mjs';

it('chỉ trả Server-Timing khi bật và ghi đủ các mục', async () => {
  const headers = [];
  const res = () => ({ writeHead: (_status, value) => headers.push(value), end() {} });
  const enabled = res();
  await withTiming(enabled, true, async () => {
    await measure('meta', async () => {});
    await measure('upstream', async () => {});
    response(enabled, 200, {});
  });
  const disabled = res();
  await withTiming(disabled, false, async () => response(disabled, 200, {}));
  expect(headers[0]['Server-Timing']).toMatch(/^meta;dur=\d+\.\d+, upstream;dur=\d+\.\d+, app;dur=\d+\.\d+$/);
  expect(headers[1]['Server-Timing']).toBeUndefined();
});

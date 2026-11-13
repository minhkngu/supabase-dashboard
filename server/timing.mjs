// Bộ đếm riêng cho từng request, kể cả khi nhiều request chạy đồng thời.
import { AsyncLocalStorage } from 'node:async_hooks';

const storage = new AsyncLocalStorage();

export function withTiming(res, enabled, run) {
  if (!enabled) return run();
  const timing = { start: process.hrtime.bigint(), meta: 0, upstream: 0 };
  res._sirisTiming = timing;
  return storage.run(timing, run);
}

export async function measure(name, run) {
  const timing = storage.getStore();
  if (!timing) return run();
  const start = process.hrtime.bigint();
  try {
    return await run();
  } finally {
    timing[name] += Number(process.hrtime.bigint() - start) / 1e6;
  }
}

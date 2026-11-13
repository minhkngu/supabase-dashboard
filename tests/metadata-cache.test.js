import { afterEach, expect, it, vi } from 'vitest';

const mock = vi.hoisted(() => ({ read: vi.fn(), enums: vi.fn() }));
vi.mock('../admin.mjs', () => ({
  createAdmin: () => ({ visibleMetadata: mock.read, enumTypes: mock.enums }),
}));
import { createContext } from '../server/context.mjs';

afterEach(() => vi.useRealTimers());

it('trả metadata cũ khi làm mới và chờ bản mới sau khi xóa cache', async () => {
  vi.useFakeTimers();
  mock.read.mockReset().mockResolvedValueOnce(['cũ']);
  mock.enums.mockReset().mockResolvedValue([]);
  let resolve = _value => {};
  mock.read.mockImplementationOnce(() => new Promise(r => (resolve = r)));
  const ctx = await createContext({ admin: { url: '' } }, []);
  expect((await ctx.cachedMetadata()).tables).toEqual(['cũ']);
  vi.advanceTimersByTime(60001);
  expect((await ctx.cachedMetadata()).tables).toEqual(['cũ']);
  expect((await ctx.cachedMetadata()).tables).toEqual(['cũ']);
  expect(mock.read).toHaveBeenCalledTimes(2);
  ctx.invalidateCaches();
  mock.read.mockResolvedValueOnce(['mới']);
  expect((await ctx.cachedMetadata()).tables).toEqual(['mới']);
  resolve(['hết hạn']);
  await vi.waitFor(async () => expect((await ctx.cachedMetadata()).tables).toEqual(['mới']));
});

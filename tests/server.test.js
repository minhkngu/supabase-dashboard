import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import http from 'node:http';
import net from 'node:net';
import { spawn } from 'node:child_process';
import { once } from 'node:events';

let upstream,
  backend,
  origin,
  upstreamRequests = [];
const getPort = async () => {
  const server = net.createServer();
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const port = server.address().port;
  await new Promise(resolve => server.close(resolve));
  return port;
};
beforeAll(async () => {
  upstream = http.createServer((req, res) => {
    upstreamRequests.push({ url: req.url, authorization: req.headers.authorization });
    res.setHeader('Content-Type', 'application/json');
    if (req.method === 'PATCH' && new URL(req.url, 'http://localhost').searchParams.get('name') === 'eq.stale')
      return res.end('[]');
    res.setHeader('Content-Range', '0-0/1');
    return res.end(JSON.stringify([{ id: 'one', name: 'A' }]));
  });
  upstream.listen(0, '127.0.0.1');
  await once(upstream, 'listening');
  const port = await getPort();
  origin = `http://127.0.0.1:${port}`;
  backend = spawn(process.execPath, ['server.mjs'], {
    cwd: process.cwd(),
    env: {
      ...process.env,
      PORT: String(port),
      SUPABASE_URL: `http://127.0.0.1:${upstream.address().port}`,
      SUPABASE_KEY: 'test-publishable',
      SUPABASE_DB_URL: '',
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  await Promise.race([
    once(backend.stdout, 'data'),
    once(backend, 'exit').then(() => {
      throw Error('server stopped');
    }),
  ]);
});
afterAll(async () => {
  backend?.kill('SIGTERM');
  await new Promise(resolve => upstream.close(resolve));
});
describe('API trên máy cục bộ', () => {
  it('không cho sửa khóa chính, vẫn cho nhập khóa khi thêm', async () => {
    const meta = await (await fetch(`${origin}/api/meta`)).json();
    const headers = { origin, 'x-siris-token': meta.token, 'content-type': 'application/json' };
    const count = upstreamRequests.length;
    const patch = await fetch(`${origin}/api/table/branches`, {
      method: 'PATCH',
      headers,
      body: JSON.stringify({ key: { id: 'one' }, values: { id: 'two' } }),
    });
    expect(patch.status).toBe(400);
    expect(upstreamRequests.length).toBe(count);
    const create = await fetch(`${origin}/api/table/branches`, {
      method: 'POST',
      headers,
      body: JSON.stringify({ values: { id: 'two', name: 'B' } }),
    });
    expect(create.status).toBe(200);
  });
  it('hiển thị bảng không yêu cầu đăng nhập và chỉ dùng key phía máy chủ', async () => {
    const response = await fetch(`${origin}/api/meta`);
    expect(response.status).toBe(200);
    const data = await response.json();
    expect(JSON.stringify(data)).not.toContain('test-publishable');
    expect(data.token).toBeTruthy();
    expect((await fetch(`${origin}/api/table/branches`)).status).toBe(200);
    expect(upstreamRequests.find(x => x.url.startsWith('/rest/v1/branches')).authorization).toBe(
      'Bearer test-publishable',
    );
  });
  it('phục vụ giao diện build và chặn tệp cấu hình', async () => {
    const response = await fetch(origin);
    expect(response.status).toBe(200);
    const html = await response.text();
    const asset = html.match(/src="(\/assets\/[^" ]+\.js)"/);
    expect(asset).not.toBeNull();
    expect((await fetch(origin + asset[1])).status).toBe(200);
    expect((await fetch(origin + '/.env.local')).status).toBe(404);
  });
  it('cập nhật nhiều cột với điều kiện kiểm tra từng giá trị cũ', async () => {
    const meta = await (await fetch(`${origin}/api/meta`)).json();
    const headers = { origin, 'x-siris-token': meta.token, 'content-type': 'application/json' };
    const response = await fetch(`${origin}/api/table/branches`, {
      method: 'PATCH',
      headers,
      body: JSON.stringify({
        key: { id: 'one' },
        values: { name: 'B', tag: 'new' },
        expected: { name: 'A', tag: 'old' },
      }),
    });
    expect(response.status).toBe(200);
    const request = upstreamRequests.find(x => x.url.includes('tag=eq.old'));
    expect(request).toBeDefined();
    const params = new URL(request.url, 'http://localhost').searchParams;
    expect(params.get('name')).toBe('eq.A');
    expect(params.get('tag')).toBe('eq.old');
    const invalid = await fetch(`${origin}/api/table/branches`, {
      method: 'PATCH',
      headers,
      body: JSON.stringify({ key: { id: 'one' }, values: { name: 'B' }, expected: { name: 'A', tag: 'old' } }),
    });
    expect(invalid.status).toBe(400);
  });
  it('lookup theo lô dùng Data API và kiểm tra đầu vào', async () => {
    const meta = await (await fetch(`${origin}/api/meta`)).json();
    const headers = { origin, 'x-siris-token': meta.token, 'content-type': 'application/json' };
    const response = await fetch(`${origin}/api/lookup/branches`, {
      method: 'POST',
      headers,
      body: JSON.stringify({ column: 'name', values: ['A,B', 'C"D'] }),
    });
    expect(response.status).toBe(200);
    const request = upstreamRequests.at(-1);
    expect(request.authorization).toBe('Bearer test-publishable');
    expect(new URL(request.url, 'http://localhost').searchParams.get('name')).toBe('in.("A,B","C\\"D")');
    const bad = await fetch(`${origin}/api/lookup/branches`, {
      method: 'POST',
      headers,
      body: JSON.stringify({ column: 'missing', values: ['x'] }),
    });
    expect(bad.status).toBe(400);
    const many = await fetch(`${origin}/api/lookup/branches`, {
      method: 'POST',
      headers,
      body: JSON.stringify({ column: 'name', values: Array(51).fill('x') }),
    });
    expect(many.status).toBe(400);
  });
  it('kiểm tra origin, token, điều kiện xung đột và khóa API quản trị', async () => {
    const meta = await (await fetch(`${origin}/api/meta`)).json();
    const headers = { origin, 'x-siris-token': meta.token, 'content-type': 'application/json' };
    const patch = await fetch(`${origin}/api/table/branches`, {
      method: 'PATCH',
      headers,
      body: JSON.stringify({ key: { id: 'one' }, values: { name: 'B' }, expected: { name: 'A' } }),
    });
    expect(patch.status).toBe(200);
    expect(upstreamRequests.find(x => x.url.includes('name=eq.A'))).toBeDefined();
    const conflict = await fetch(`${origin}/api/table/branches`, {
      method: 'PATCH',
      headers,
      body: JSON.stringify({ key: { id: 'one' }, values: { name: 'B' }, expected: { name: 'stale' } }),
    });
    expect(conflict.status).toBe(400);
    expect((await fetch(`${origin}/api/admin/schema/preview`, { method: 'POST', headers, body: '{}' })).status).toBe(
      403,
    );
    expect(
      (
        await fetch(`${origin}/api/table/branches`, {
          method: 'PATCH',
          headers: { ...headers, origin: 'https://malicious.example' },
          body: '{}',
        })
      ).status,
    ).toBe(403);
    expect(
      (
        await fetch(`${origin}/api/table/branches`, {
          method: 'PATCH',
          headers: { origin, 'content-type': 'application/json' },
          body: '{}',
        })
      ).status,
    ).toBe(403);
  });
});

// Password-protected personal deployment. The session is shared by all
// function instances and invalidated when either configured credential changes.
import { createHash, createHmac, randomBytes, timingSafeEqual } from 'node:crypto';
const SESSION_MS = 8 * 60 * 60 * 1000;
const digest = value => createHash('sha256').update(value).digest();
export function createSessionAuth(user, password, { local = false, now = Date.now } = {}) {
  const cookieName = local ? 'siris_session' : '__Host-siris_session';
  const sign = payload => createHmac('sha256', `${user}:${password}`).update(`siris-session:${payload}`).digest('hex');
  const matches = value => timingSafeEqual(digest(`${user}:${password}`), digest(value));
  const cookieToken = headers =>
    (headers.cookie || '')
      .split(';')
      .map(part => part.trim())
      .find(part => part.startsWith(cookieName + '='))
      ?.slice(cookieName.length + 1) || '';
  // A write token is derived from the caller's own cookie (or Basic
  // credential), so two sessions never share the same CSRF value.
  const csrf = headers => {
    const credential = cookieToken(headers) || headers.authorization || '';
    return credential
      ? createHmac('sha256', `${user}:${password}`).update(`siris-csrf:${credential}`).digest('hex')
      : '';
  };
  function sessionValid(headers) {
    const token = cookieToken(headers);
    const match = /^(\d{13})\.([a-f0-9]{24})\.([a-f0-9]{64})$/.exec(token);
    return Boolean(
      match &&
        Number(match[1]) > now() &&
        timingSafeEqual(Buffer.from(sign(`${match[1]}:${match[2]}`), 'hex'), Buffer.from(match[3], 'hex')),
    );
  }
  // Retain authenticated CLI/API access, without browser challenge loops.
  // Returns the decoded "user:password", or null when no Basic header is sent;
  // the caller counts wrong attempts with the login throttle.
  function basicCredential(headers) {
    const basic = headers.authorization || '';
    return /^Basic /i.test(basic) ? Buffer.from(basic.slice(6), 'base64').toString() : null;
  }
  function authenticated(headers) {
    if (sessionValid(headers)) return true;
    const basic = basicCredential(headers);
    return basic !== null && matches(basic);
  }
  function sessionCookie() {
    const expires = String(now() + SESSION_MS),
      nonce = randomBytes(12).toString('hex');
    return `${cookieName}=${expires}.${nonce}.${sign(`${expires}:${nonce}`)}; Path=/; HttpOnly; SameSite=Strict; Max-Age=${SESSION_MS / 1000}${local ? '' : '; Secure'}`;
  }
  return { authenticated, sessionValid, basicCredential, matches, sessionCookie, csrf };
}
export async function loginValues(req) {
  let parsed = req.body;
  if (parsed === undefined) {
    let size = 0;
    const chunks = [];
    for await (const chunk of req) {
      size += chunk.length;
      if (size > 4096) throw Error('Login body too large');
      chunks.push(chunk);
    }
    parsed = Buffer.concat(chunks).toString('utf8');
  }
  if (typeof parsed === 'string' || Buffer.isBuffer(parsed)) {
    if (Buffer.byteLength(parsed) > 4096) throw Error('Login body too large');
    parsed = Object.fromEntries(new URLSearchParams(String(parsed)));
  }
  if (
    !parsed ||
    typeof parsed.username !== 'string' ||
    typeof parsed.password !== 'string' ||
    parsed.username.length + parsed.password.length > 4096
  )
    throw Error('Invalid login body');
  return `${parsed.username}:${parsed.password}`;
}
export function loginPage(res, status = 200, error = false) {
  res.writeHead(status, {
    'Content-Type': 'text/html; charset=utf-8',
    'Cache-Control': 'private, no-store',
    'Content-Security-Policy':
      "default-src 'none'; style-src 'unsafe-inline'; form-action 'self'; base-uri 'none'; frame-ancestors 'none'",
    'X-Content-Type-Options': 'nosniff',
  });
  res.end(`<!doctype html><html lang="vi"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Đăng nhập Siris</title>
<style>*{box-sizing:border-box}body{margin:0;background:#f5f5f3;color:#202320;font:16px system-ui,sans-serif;min-height:100svh;display:grid;place-items:center;padding:24px}main{width:100%;max-width:360px}h1{font-size:30px;margin:0 0 12px}p{line-height:1.5;color:#586058}label{display:block;margin:22px 0 8px}input,button{width:100%;font:inherit;padding:13px;border-radius:6px}input{background:white;border:1px solid #aeb5ae}input:focus{outline:2px solid #245e40;outline-offset:2px}button{margin-top:24px;border:0;background:#245e40;color:white;cursor:pointer}button:focus-visible{outline:2px solid #245e40;outline-offset:3px}[role=alert]{color:#a12626}</style></head>
<body><main><h1>Siris</h1><p>Đăng nhập để quản lý dữ liệu.</p>${error ? '<p role="alert">Tên đăng nhập hoặc mật khẩu chưa đúng. Vui lòng kiểm tra và thử lại.</p>' : ''}
<form method="post" action="/auth/login"><label for="username">Tên đăng nhập</label><input id="username" name="username" autocomplete="username" autocapitalize="none" spellcheck="false" required><label for="password">Mật khẩu</label><input id="password" name="password" type="password" autocomplete="current-password" required><button type="submit">Đăng nhập</button></form><p>Phiên đăng nhập có hiệu lực trong 8 giờ.</p></main></body></html>`);
}

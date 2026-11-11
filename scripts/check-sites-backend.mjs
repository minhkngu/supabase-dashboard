import fs from 'node:fs';
import { webcrypto } from 'node:crypto';
import { payload, hash } from '../supabase/functions/siris-manager/auth.mjs';
const base = 'https://kunuwxruipqrebuyayqv.supabase.co/functions/v1/siris-manager';
const privateKey = await webcrypto.subtle.importKey(
  'pkcs8',
  Buffer.from(JSON.parse(fs.readFileSync('chatgpt-site/.env.bridge', 'utf8')), 'base64'),
  { name: 'Ed25519' },
  false,
  ['sign'],
);
for (const path of ['/api/meta', '/api/formula-config', '/api/lookup-config', '/api/table/room_types?page=0']) {
  const url = new URL(base + path),
    time = String(Date.now()),
    nonce = webcrypto.randomUUID(),
    signature = await webcrypto.subtle.sign(
      'Ed25519',
      privateKey,
      payload('GET', url.pathname + url.search, time, nonce, await hash(new Uint8Array())),
    );
  const r = await fetch(url, {
    headers: {
      'x-siris-time': time,
      'x-siris-nonce': nonce,
      'x-siris-signature': Buffer.from(signature).toString('base64'),
    },
  });
  const raw = await r.text();
  let d;
  try {
    d = JSON.parse(raw);
  } catch {}
  console.log(
    JSON.stringify({
      path,
      status: r.status,
      adminAvailable: d?.adminAvailable,
      tables: d?.tables?.length,
      items: d?.items?.length,
      rows: d?.rows?.length,
      error: d?.error,
      adminError: d?.adminError,
      raw: d ? undefined : raw.slice(0, 160),
    }),
  );
}
const r = await fetch(base + '/api/meta');
console.log(JSON.stringify({ unsignedStatus: r.status }));

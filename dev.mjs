import { spawn } from 'node:child_process';
import { createServer } from 'vite';

const backend = spawn(process.execPath, ['server.mjs'], { env: { ...process.env, PORT: '3001' }, stdio: 'inherit' });
let closing = false;
const shutdown = async (code = 0) => {
  if (closing) return;
  closing = true;
  backend.kill('SIGTERM');
  await vite?.close();
  process.exit(code);
};
let vite;
backend.on('exit', code => {
  if (!closing) void shutdown(code || 1);
});
process.on('SIGINT', () => void shutdown());
process.on('SIGTERM', () => void shutdown());
try {
  vite = await createServer();
  await vite.listen();
  vite.printUrls();
} catch (error) {
  console.error(error.message);
  await shutdown(1);
}

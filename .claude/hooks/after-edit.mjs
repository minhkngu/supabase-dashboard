// PostToolUse (Edit|Write): định dạng file vừa sửa bằng Prettier, rồi chạy các unit test
// có import file đó (vitest related). Im lặng khi qua; chỉ báo lại khi test đỏ hoặc
// module máy chủ chưa có test nào phủ.
import { spawnSync } from 'node:child_process';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const bin = (...parts) => path.join(root, 'node_modules', ...parts);
const prettier = bin('prettier', 'bin', 'prettier.cjs');
const vitest = bin('vitest', 'vitest.mjs');
const MAX_OUTPUT = 1500;

const strip = text => text.replace(/\x1b\[[0-9;]*m/g, '');

function format(file) {
  if (!/\.(mjs|js|ts|css|html)$/.test(file) || !existsSync(prettier)) return;
  // .prettierignore được áp dụng vì cwd là gốc repo.
  spawnSync(process.execPath, [prettier, '--write', '--log-level', 'error', file], {
    cwd: root,
    stdio: 'ignore',
    timeout: 15000,
  });
}

function runRelatedTests(relative, session) {
  // Vitest chỉ phủ module máy chủ (gốc repo, server/, api/) và chính các file test;
  // src/ được kiểm bằng e2e.
  const isTest = /^tests\/[^/]+\.test\.js$/.test(relative);
  const isServerModule =
    /^(server\/|api\/)?[^/]+\.mjs$/.test(relative) || /^server\/routes\/[^/]+\.mjs$/.test(relative);
  if ((!isTest && !isServerModule) || !existsSync(vitest)) return;
  const args = [vitest, 'related', relative, '--run'];
  // tests/server.test.js cần dist/; chưa build thì bỏ qua thay vì báo đỏ giả.
  if (!existsSync(path.join(root, 'dist', 'index.html'))) args.push('--exclude', 'tests/server.test.js');
  const result = spawnSync(process.execPath, args, { cwd: root, encoding: 'utf8', timeout: 60000 });
  const output = strip(`${result.stdout || ''}${result.stderr || ''}`);
  if (result.status !== 0) {
    const start = Math.max(0, output.search(/FAIL|Error/));
    process.stderr.write(
      `Unit test liên quan tới ${relative} đang đỏ. Sửa mã, không sửa test để che lỗi.\n` +
        output.slice(start, start + MAX_OUTPUT),
    );
    process.exit(2);
  }
  if (isServerModule && /No test files found/.test(output)) {
    // Nhắc một lần mỗi phiên cho mỗi file, không lặp lại ở từng lần sửa.
    const marker = path.join(os.tmpdir(), `siris-no-test-${session}-${relative.replace(/[^a-zA-Z0-9]/g, '_')}`);
    if (existsSync(marker)) return;
    try {
      writeFileSync(marker, '');
    } catch {
      // Không ghi được dấu thì chấp nhận nhắc lại.
    }
    console.log(
      JSON.stringify({
        hookSpecificOutput: {
          hookEventName: 'PostToolUse',
          additionalContext:
            `Chưa có unit test nào import ${relative}. ` +
            `Nếu vừa thêm hoặc đổi hành vi của một hàm, viết test trong tests/ trước khi làm tiếp.`,
        },
      }),
    );
  }
}

let file,
  session = 'none';
try {
  const input = JSON.parse(readFileSync(0, 'utf8'));
  file = input.tool_input?.file_path;
  session = String(input.session_id || 'none').replace(/[^a-zA-Z0-9-]/g, '');
} catch {
  // Không đọc được đầu vào thì bỏ qua.
}
if (file && existsSync(file)) {
  const relative = path.relative(root, path.resolve(file)).replaceAll('\\', '/');
  if (!relative.startsWith('..') && !/^(node_modules|dist|\.claude|\.agents)\//.test(relative)) {
    format(file);
    runRelatedTests(relative, session);
  }
}

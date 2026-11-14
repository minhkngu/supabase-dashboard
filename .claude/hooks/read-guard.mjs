// PreToolUse (Read): chặn đọc nguyên một file văn bản lớn khi không có offset/limit.
// File trên 20 KB tốn khoảng 6.000 token trở lên mỗi lần đọc; Grep rồi đọc đúng đoạn rẻ hơn nhiều.
import { readFileSync, statSync } from 'node:fs';
import path from 'node:path';

const LIMIT_BYTES = 20 * 1024;
const TEXT = new Set(['.js', '.mjs', '.ts', '.css', '.html', '.md', '.json', '.sql', '.txt']);

try {
  const input = JSON.parse(readFileSync(0, 'utf8'));
  const { file_path: file, offset, limit } = input.tool_input || {};
  if (file && offset == null && limit == null && TEXT.has(path.extname(file).toLowerCase())) {
    const size = statSync(file).size;
    if (size > LIMIT_BYTES) {
      const lines = readFileSync(file, 'utf8').split('\n').length;
      const reason =
        `${path.basename(file)} nặng ${Math.round(size / 1024)} KB (${lines} dòng). ` +
        'Dùng Grep để tìm đúng chỗ rồi Read với offset/limit. ' +
        'Nếu thật sự cần cả file thì gọi lại Read kèm limit.';
      console.log(
        JSON.stringify({
          hookSpecificOutput: {
            hookEventName: 'PreToolUse',
            permissionDecision: 'deny',
            permissionDecisionReason: reason,
          },
        }),
      );
    }
  }
} catch {
  // Lỗi của hook không được chặn công việc: cho qua.
}

// Chặn số cặp module import trực tiếp lẫn nhau trong src/ tăng thêm.
import { readdir, readFile } from 'node:fs/promises';
import path from 'node:path';

const root = path.resolve('src');
async function files(dir) {
  const entries = await readdir(dir, { withFileTypes: true });
  return (
    await Promise.all(
      entries.map(entry => {
        const name = path.join(dir, entry.name);
        return entry.isDirectory() ? files(name) : name.endsWith('.js') ? [name] : [];
      }),
    )
  ).flat();
}
const sources = await files(root);
const edges = new Map();
for (const file of sources) {
  const code = await readFile(file, 'utf8');
  const imports = [...code.matchAll(/(?:import|export)\s+(?:[^'";]*?\s+from\s+)?['"](\.[^'"]+)['"]/g)];
  edges.set(file, new Set(imports.map(match => path.resolve(path.dirname(file), match[1]))));
}
const pairs = [];
for (const [from, targets] of edges) {
  for (const to of targets) {
    if (from < to && edges.get(to)?.has(from)) pairs.push([path.relative(root, from), path.relative(root, to)]);
  }
}
pairs.sort((a, b) => a.join(' ').localeCompare(b.join(' ')));
for (const pair of pairs) console.log(pair.join(' ↔ '));
console.log(`Số cặp import vòng: ${pairs.length} (tối đa 18)`);
if (pairs.length > 18) process.exitCode = 1;

import { toast } from './api.js';
import { load, render } from './grid/render.js';
import { cachedLookup, fillOptions, lookupTable } from './lookup.js';
import { $, name, state } from './state.js';
import { getJSON, setJSON, storageKeys } from './storage.js';

export function nativeRelations(table = state.table) {
  return (table?.foreign_key_constraints || [])
    .filter(f => f.source_table === table.name && f.source_columns?.length === 1 && f.target_columns?.length === 1)
    .map(f => ({
      id: 'native:' + f.name,
      kind: 'native',
      source_table: name(table),
      label: f.source_columns[0],
      config: {
        targetTable: f.target_table.replace(/^public\./, ''),
        sourceColumn: f.source_columns[0],
        targetKey: f.target_columns[0],
      },
    }));
}
export let relationDisplaySettings = {};
export function reloadRelationDisplay() {
  const saved = getJSON(storageKeys.relationDisplay, {});
  if (saved && typeof saved === 'object' && !Array.isArray(saved)) relationDisplaySettings = saved;
}
export function initRelationDisplay() {
  reloadRelationDisplay();
  $('#closeRelationDisplay').onclick = $('#cancelRelationDisplay').onclick = () => $('#relationDisplayDialog').close();
  $('#relationDisplayForm').onsubmit = e => {
    e.preventDefault();
    const relation = relationDisplayEditing,
      field = $('#relationDisplayField').value,
      target = relation && lookupTable(relation.config.targetTable);
    if (!target?.columns.some(c => c.name === field)) {
      $('#relationDisplayError').textContent = 'Chọn trường hiển thị hợp lệ.';
      return;
    }
    const key = displaySettingKey(relation),
      previous = relationDisplaySettings[key];
    relationDisplaySettings[key] = field;
    if (!setJSON(storageKeys.relationDisplay, relationDisplaySettings)) {
      if (previous === undefined) delete relationDisplaySettings[key];
      else relationDisplaySettings[key] = previous;
      $('#relationDisplayError').textContent = 'Không thể lưu lựa chọn trên trình duyệt.';
      return;
    }
    $('#relationDisplayDialog').close();
    void load({ silent: true });
    toast('Đã cập nhật trường hiển thị');
  };
}

export function displaySettingKey(relation) {
  return JSON.stringify([relation.source_table, relation.id, relation.config.targetTable, relation.config.targetKey]);
}
// Without a saved choice, show the linked record's name (or its first text
// column) instead of the raw key.
function defaultDisplayField(relation, target) {
  const key = relation.config.targetKey,
    columns = (target?.columns || []).filter(c => c.name !== key);
  return (
    columns.find(c => c.name === 'name')?.name ||
    columns.find(c => ['text', 'character varying'].includes(c.data_type))?.name ||
    key
  );
}
export function relationDisplayField(relation) {
  const target = lookupTable(relation.config.targetTable),
    saved = relationDisplaySettings[displaySettingKey(relation)];
  return target?.columns.some(c => c.name === saved) ? saved : defaultDisplayField(relation, target);
}
// True when the column shows a field of the linked record rather than its key.
export function hasRelationDisplay(relation) {
  return !!lookupTable(relation.config.targetTable) && relationDisplayField(relation) !== relation.config.targetKey;
}
export let relationDisplayEditing = null,
  nativeDisplayRows = new Map(),
  nativeDisplayVersion = 0;
export function openRelationDisplay(relation) {
  const target = lookupTable(relation.config.targetTable);
  if (!target) return toast('Không tìm thấy bảng liên kết.');
  relationDisplayEditing = relation;
  fillOptions(
    $('#relationDisplayField'),
    target.columns.map(c => c.name),
    'Chọn trường',
  );
  $('#relationDisplayField').value = relationDisplayField(relation);
  $('#relationDisplayField')._syncColumnSelect?.();
  $('#relationDisplayError').textContent = '';
  $('#relationDisplayDialog').showModal();
}
export function nativeDisplayValue(column, value) {
  const relation = nativeRelations().find(rel => rel.config.sourceColumn === column && hasRelationDisplay(rel));
  if (!relation || value == null) return null;
  const linked = nativeDisplayRows.get(relation.id)?.get(String(value));
  if (!linked) return null;
  const display = linked[relationDisplayField(relation)];
  return { text: display == null ? '—' : typeof display === 'object' ? JSON.stringify(display) : String(display) };
}
export async function loadNativeDisplays() {
  const table = state.table,
    version = ++nativeDisplayVersion,
    rows = state.rows.slice(),
    relations = nativeRelations(table).filter(hasRelationDisplay);
  nativeDisplayRows = new Map();
  if (!relations.length) return;
  await Promise.all(
    relations.map(async relation => {
      const values = [
        ...new Map(
          rows
            .map(row => row[relation.config.sourceColumn])
            .filter(v => v != null)
            .map(v => [String(v), v]),
        ).values(),
      ];
      if (!values.length) return;
      try {
        const result = await cachedLookup(relation.config.targetTable, relation.config.targetKey, values, [
          relationDisplayField(relation),
        ]);
        if (version === nativeDisplayVersion)
          nativeDisplayRows.set(relation.id, new Map(result.map(row => [String(row[relation.config.targetKey]), row])));
      } catch {
        if (version === nativeDisplayVersion) nativeDisplayRows.set(relation.id, null);
      }
    }),
  );
  if (version === nativeDisplayVersion && state.table === table && !state.cellEdit) render();
}

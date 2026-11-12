import { confirmDialog } from './confirm.js';
import { api, toast } from './api.js';
import { expectedValues } from './history.js';
import { load, render } from './grid/render.js';
import { $, lookupCache, PAGE_SIZE, el, name, state } from './state.js';


// Lookup values are stable for a short while; asking again on every page load
// costs one request per virtual lookup column. Duplicate in-flight values wait
// for the same request instead of issuing their own.
export async function cachedLookup(table, column, values, fields) {
  const key = JSON.stringify([table, column, fields ? [...new Set(fields)].sort() : null]);
  let group = lookupCache.get(key);
  if (!group) {
    group = { table, values: new Map(), pending: new Map() };
    lookupCache.set(key, group);
  }
  const unique = [...new Map(values.map(value => [String(value), value])).values()],
    now = Date.now(),
    waiting = new Set(),
    missing = [];
  for (const value of unique) {
    const k = String(value),
      cached = group.values.get(k);
    if (cached && now - cached.time < 60000) continue;
    if (group.pending.has(k)) waiting.add(group.pending.get(k));
    else missing.push(value);
  }
  if (missing.length) {
    let request;
    request = api(`/api/lookup/${table}`, {
      method: 'POST',
      body: JSON.stringify({ column, values: missing, ...(fields ? { fields } : {}) }),
    })
      .then(data => {
        if (!Array.isArray(data.rows)) throw Error('Kết quả lookup không hợp lệ.');
        if (lookupCache.get(key) === group)
          for (const value of missing)
            group.values.set(String(value), {
              time: Date.now(),
              rows: data.rows.filter(row => row[column] != null && String(row[column]) === String(value)),
            });
        return data.rows;
      })
      .finally(() => {
        for (const value of missing) if (group.pending.get(String(value)) === request) group.pending.delete(String(value));
      });
    for (const value of missing) group.pending.set(String(value), request);
    waiting.add(request);
  }
  if (waiting.size) await Promise.all(waiting);
  if (lookupCache.get(key) !== group) return cachedLookup(table, column, values, fields);
  return unique.flatMap(value => group.values.get(String(value))?.rows || []);
}
// Lookup configuration lives in Supabase (`siris_admin.lookup_configs`), never
// in this browser: a local copy would drift from the server that actually
// writes the trigger-maintained columns.
export function restoreLookups() {
  state.lookups = [];
}
export function persistLookups() {
  return lookupCloudAvailable;
}
export function lookupType(c) {
  if (!c || /json|array|bytea/i.test(c.data_type) || c.data_type.startsWith('_')) return null;
  if (/^(integer|bigint|smallint|numeric|real|double precision|decimal)$/.test(c.data_type)) return 'number';
  if (['text', 'character varying', 'character', 'varchar'].includes(c.data_type)) return 'text';
  return c.data_type;
}
export function activeLookups() {
  return state.lookups.filter(x => x.sourceTable === name(state.table));
}
export function lookupTable(n) {
  return state.tables.find(t => name(t) === n);
}
export function lookupConditions(x) {
  return Array.isArray(x.conditions) && x.conditions.length
    ? x.conditions
    : [{ sourceColumn: x.sourceColumn, targetKey: x.targetKey }];
}
export function configValid(x) {
  const a = lookupTable(x.sourceTable),
    b = lookupTable(x.targetTable);
  return !!(
    a &&
    b &&
    b.columns.some(c => c.name === x.targetField) &&
    lookupConditions(x).every(rule => {
      const source = a.columns.find(c => c.name === rule.sourceColumn),
        key = b.columns.find(c => c.name === rule.targetKey);
      return source && key && lookupType(source) && lookupType(source) === lookupType(key);
    })
  );
}
export function fillOptions(select, values, placeholder) {
  select.replaceChildren(new Option(placeholder, ''));
  for (const value of values) select.add(new Option(value, value));
}
export function fillTableOptions(select, placeholder, include = () => true) {
  const tables = state.tables.filter(include),
    knownFolders = new Set(state.folders.map(f => f.id));
  select.replaceChildren(new Option(placeholder, ''));
  for (const folder of state.folders) {
    const members = tables.filter(t => state.tableFolders[name(t)] === folder.id);
    if (!members.length) continue;
    const group = document.createElement('optgroup');
    group.label = folder.name;
    for (const table of members) group.append(new Option(name(table), name(table)));
    select.append(group);
  }
  for (const table of tables.filter(t => !knownFolders.has(state.tableFolders[name(t)])))
    select.append(new Option(name(table), name(table)));
}
export let lookupDraft = [],
  lookupCloudAvailable = false;
function drawLookupConditions() {
  const host = $('#lookupConditions'),
    target = lookupTable($('#lookupTable').value);
  host.replaceChildren();
  lookupDraft.forEach((rule, index) => {
    const row = el('div', 'lookup-condition'),
      source = el('select'),
      op = el('select'),
      dest = el('select'),
      remove = el('button', 'quiet', '×');
    source.setAttribute('aria-label', `Cột hiện tại ${index + 1}`);
    dest.setAttribute('aria-label', `Cột nguồn ${index + 1}`);
    op.setAttribute('aria-label', `Điều kiện ${index + 1}`);
    fillOptions(
      source,
      state.table.columns.filter(c => lookupType(c)).map(c => c.name),
      'Cột hiện tại',
    );
    op.add(new Option('bằng', 'eq'));
    const col = state.table.columns.find(c => c.name === rule.sourceColumn);
    fillOptions(
      dest,
      (target?.columns || [])
        .filter(c => lookupType(c) && (!col || lookupType(c) === lookupType(col)))
        .map(c => c.name),
      'Cột nguồn',
    );
    source.value = rule.sourceColumn || '';
    dest.value = rule.targetKey || '';
    source.onchange = () => {
      rule.sourceColumn = source.value;
      rule.targetKey = '';
      drawLookupConditions();
    };
    dest.onchange = () => (rule.targetKey = dest.value);
    remove.type = 'button';
    remove.setAttribute('aria-label', `Xóa điều kiện ${index + 1}`);
    remove.disabled = lookupDraft.length === 1;
    remove.onclick = () => {
      lookupDraft.splice(index, 1);
      drawLookupConditions();
    };
    row.append(source, op, dest, remove);
    host.append(row);
  });
}
function refreshLookupTargets() {
  const target = lookupTable($('#lookupTable').value),
    field = $('#lookupField').value;
  fillOptions($('#lookupField'), target ? target.columns.map(c => c.name) : [], 'Chọn trường cần lấy');
  if ([...$('#lookupField').options].some(o => o.value === field)) $('#lookupField').value = field;
  drawLookupConditions();
}
function resetLookupForm() {
  $('#lookupColumnPreview').hidden = true;
  state.lookupEditing = null;
  $('#lookupForm').reset();
  lookupDraft = [{ sourceColumn: '', targetKey: '' }];
  $('#lookupError').textContent = '';
  $('#saveLookup').textContent = 'Thêm lookup';
  $('#cancelLookupEdit').hidden = true;
  refreshLookupTargets();
  refreshLookupSync();
}
function showLookupList() {
  const list = $('#lookupList');
  list.replaceChildren();
  for (const x of activeLookups().filter(x => !x.columnBound)) {
    const item = el('div', 'lookup-item'),
      info = el('div', 'lookup-info'),
      title = el('strong', '', x.label),
      detail = el('span', '', `${x.targetTable} · ${x.targetField}`),
      actions = el('div', 'lookup-item-actions'),
      edit = el('button', 'quiet', 'Sửa'),
      remove = el('button', 'quiet', 'Xóa');
    edit.type = remove.type = 'button';
    edit.onclick = () => {
      state.lookupEditing = x.id;
      $('#lookupLabel').value = x.label;
      $('#lookupTable').value = x.targetTable;
      lookupDraft = lookupConditions(x).map(r => ({ ...r }));
      refreshLookupTargets();
      $('#lookupField').value = x.targetField;
      $('#lookupMode').value = x.mode === 'any' ? 'any' : 'all';
      $('#lookupDisplay').value = x.display === 'count' ? 'count' : 'value';
      $('#lookupFormat').value = x.format === 'grouped' ? 'grouped' : 'default';
      $('#lookupSyncEnabled').checked = !!x.sync?.enabled;
      refreshLookupSync(x.sync?.columnName);
      $('#lookupColumnPreview').hidden = true;
      $('#saveLookup').textContent = 'Lưu';
      $('#cancelLookupEdit').hidden = false;
      $('#lookupError').textContent = '';
      $('#lookupForm')
        .querySelectorAll('select')
        .forEach(select => select._syncColumnSelect?.());
    };
    remove.onclick = async () => {
      if (
        !(await confirmDialog({
          title: 'Xóa cấu hình lookup?',
          message: `Cấu hình “${x.label}” sẽ bị xóa.`,
          confirmLabel: 'Xóa',
          danger: true,
        }))
      )
        return;
      if (lookupCloudAvailable) {
        try {
          await api('/api/lookup-config', { method: 'POST', body: JSON.stringify({ action: 'delete', id: x.id }) });
        } catch (error) {
          $('#lookupError').textContent = error.message;
          return;
        }
      }
      const old = state.lookups;
      state.lookups = state.lookups.filter(y => y.id !== x.id);
      if (!persistLookups()) {
        state.lookups = old;
        $('#lookupError').textContent = 'Không thể lưu cấu hình trên trình duyệt.';
        return;
      }
      resetLookupForm();
      showLookupList();
      loadLookups();
    };
    info.append(title, detail);
    actions.append(edit, remove);
    item.append(info, actions);
    list.append(item);
  }
}
export function showLookupDialog() {
  if (!state.table) return;
  $('#lookupContext').textContent = name(state.table);
  fillTableOptions($('#lookupTable'), 'Chọn bảng nguồn');
  resetLookupForm();
  showLookupList();
  $('#lookupDialog').showModal();
}
export function initLookup() {
  $('#closeLookup').onclick = () => $('#lookupDialog').close();
  $('#closeLinkedRecord').onclick = () => $('#linkedRecord').close();
  $('#cancelLookupEdit').onclick = resetLookupForm;
  $('#lookupTable').onchange = () => {
    lookupDraft = lookupDraft.map(r => ({ ...r, targetKey: '' }));
    refreshLookupTargets();
  };
  $('#lookupAddCondition').onclick = () => {
    if (lookupDraft.length >= 10) {
      $('#lookupError').textContent = 'Tối đa 10 điều kiện.';
      return;
    }
    lookupDraft.push({ sourceColumn: '', targetKey: '' });
    drawLookupConditions();
  };
  $('#lookupSyncEnabled').onchange = () => {
    refreshLookupSync();
    $('#lookupColumnPreview').hidden = true;
    $('#lookupError').textContent = '';
  };
  $('#lookupSyncColumn').onchange = () => {
    try {
      checkLookupSync(lookupFormConfig());
      $('#lookupError').textContent = '';
    } catch (error) {
      $('#lookupError').textContent = error.message;
    }
  };
  $('#previewLookupColumn').onclick = async () => {
    const box = $('#lookupColumnPreview');
    box.hidden = false;
    box.textContent = 'Đang kiểm tra…';
    try {
      const config = lookupFormConfig();
      checkLookupSync(config);
      const p = await api('/api/lookup-sync/preview', { method: 'POST', body: JSON.stringify(config) });
      box.textContent = `${p.columnName} · ${p.clearing ? 'Xóa giá trị' : 'Cập nhật'} ${p.affected} bản ghi${p.dataType ? ' · ' + p.dataType : ''}`;
    } catch (error) {
      box.textContent = error.message;
    }
  };
  $('#lookupForm').onsubmit = async e => {
    e.preventDefault();
    const x = lookupFormConfig(),
      oldConfig = state.lookups.find(c => c.id === x.id),
      syncChange = x.sync.enabled || oldConfig?.sync?.enabled;
    $('#lookupError').textContent = '';
    $('#saveLookup').disabled = true;
    try {
      if (!x.label || !configValid(x)) throw Error('Hãy chọn các cột có kiểu dữ liệu phù hợp.');
      if (
        (!x.sync.enabled &&
          state.table.columns.some(c => c.name.toLocaleLowerCase() === x.label.toLocaleLowerCase())) ||
        state.lookups.some(
          y =>
            y.sourceTable === x.sourceTable &&
            y.id !== x.id &&
            y.label.toLocaleLowerCase() === x.label.toLocaleLowerCase(),
        )
      )
        throw Error('Tên cột đã tồn tại.');
      checkLookupSync(x);
      let signature;
      if (syncChange) {
        if (!lookupCloudAvailable || !state.adminAvailable)
          throw Error('Cần kết nối database và nơi lưu cấu hình để đồng bộ.');
        const preview = await api('/api/lookup-sync/preview', { method: 'POST', body: JSON.stringify(x) });
        signature = preview.signature;
      }
      let saved = x;
      if (lookupCloudAvailable) {
        const result = await api('/api/lookup-config', {
          method: 'POST',
          body: JSON.stringify({ action: 'save', config: x, signature }),
        });
        saved = result.config || x;
      }
      const old = state.lookups;
      state.lookups = state.lookupEditing
        ? state.lookups.map(y => (y.id === x.id ? saved : y))
        : [...state.lookups, saved];
      if (!persistLookups()) {
        state.lookups = old;
        throw Error('Không thể lưu cấu hình trên trình duyệt.');
      }
      resetLookupForm();
      showLookupList();
      if (syncChange) await load({ silent: true });
      else await loadLookups();
      toast(
        syncChange
          ? saved.sync.enabled
            ? 'Đã bật đồng bộ lookup'
            : 'Đã tắt đồng bộ và để trống cột'
          : 'Đã lưu lookup',
      );
    } catch (error) {
      $('#lookupError').textContent = error.message;
    } finally {
      $('#saveLookup').disabled = false;
    }
  };
  $('#closeLinkPicker').onclick = () => {
    if (!pickerState?.saving) {
      pickerState = null;
      $('#linkPicker').close();
    }
  };
  $('#linkPicker').addEventListener('cancel', e => {
    if (pickerState?.saving) e.preventDefault();
    else pickerState = null;
  });
  $('#pickerLink').onchange = () => {
    pickerState.page = 0;
    loadPicker();
  };
  $('#pickerSearch').oninput = () => {
    clearTimeout(pickerTimer);
    pickerTimer = setTimeout(() => {
      if (pickerState) {
        pickerState.page = 0;
        loadPicker();
      }
    }, 350);
  };
  $('#pickerPrev').onclick = () => {
    pickerState.page--;
    loadPicker();
  };
  $('#pickerNext').onclick = () => {
    pickerState.page++;
    loadPicker();
  };
  $('#pickerClear').onclick = () => saveLink(null);
}

function refreshLookupSync(selected) {
  const enabled = $('#lookupSyncEnabled').checked,
    old = state.lookups.find(x => x.id === state.lookupEditing),
    select = $('#lookupSyncColumn'),
    current = selected || select.value;
  select.replaceChildren(
    new Option('Chọn cột hiện có', ''),
    ...state.table.columns
      .filter(
        c =>
          !state.table.primary_keys.includes(c.name) &&
          !c.protected &&
          !c.options.some(o => ['identity', 'generated'].includes(o)),
      )
      .map(c => new Option(`${c.name} · ${c.format || c.data_type}`, c.name)),
  );
  select.value = current;
  select.required = enabled;
  select.disabled = !!old?.sync?.enabled;
  $('#lookupSyncColumnWrap').hidden = !enabled;
  $('#previewLookupColumn').hidden = true;
  $('#lookupSyncEnabled').disabled = !lookupCloudAvailable || !state.adminAvailable;
  $('#lookupSyncHint').textContent = !lookupCloudAvailable
    ? 'Cần nơi lưu cấu hình lookup trên Supabase để bật đồng bộ.'
    : !state.adminAvailable
      ? 'Cần kết nối database để bật đồng bộ.'
      : old?.sync?.enabled && !enabled
        ? 'Lưu thay đổi sẽ xóa toàn bộ giá trị trong cột ' + old.sync.columnName + '.'
        : 'Bật để tự cập nhật cột đã chọn. Tắt để xóa giá trị trong cột đó.';
}
function lookupFormConfig() {
  const conditions = lookupDraft.map(r => ({ ...r }));
  return {
    id: state.lookupEditing || `lookup-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    sourceTable: name(state.table),
    label: $('#lookupLabel').value.trim(),
    targetTable: $('#lookupTable').value,
    targetField: $('#lookupField').value,
    sourceColumn: conditions[0]?.sourceColumn,
    targetKey: conditions[0]?.targetKey,
    conditions,
    mode: $('#lookupMode').value,
    display: $('#lookupDisplay').value,
    format: $('#lookupFormat').value,
    sync: { enabled: $('#lookupSyncEnabled').checked, columnName: $('#lookupSyncColumn').value },
  };
}
export function checkLookupSync(x) {
  if (!x.sync.enabled) return;
  const column = state.table.columns.find(c => c.name === x.sync.columnName),
    field = lookupTable(x.targetTable)?.columns.find(c => c.name === x.targetField);
  if (!column || !field) throw Error('Chọn cột nhận dữ liệu và trường cần lấy.');
  const expected = x.display === 'count' ? 'bigint' : field.format || field.data_type,
    actual = column.format || column.data_type;
  if (expected !== actual)
    throw Error(`Không khớp kiểu dữ liệu: lookup trả về ${expected}, cột ${column.name} là ${actual}.`);
}

export async function loadLookups() {
  const version = ++state.lookupVersion,
    table = state.table,
    rows = state.rows.slice(),
    configs = activeLookups().filter(x => !x.sync?.enabled && !x.columnBound);
  state.lookupResults = new Map();
  if (!configs.length) return;
  const jobs = [];
  for (const x of configs) {
    const results = new Map();
    state.lookupResults.set(x.id, results);
    if (!configValid(x)) {
      results.set('__error__', { error: 'Cấu hình không còn hợp lệ' });
      continue;
    }
    const conditions = lookupConditions(x);
    for (const row of rows) results.set(row, { loading: true });
    jobs.push(
      Promise.all(
        conditions.map(async rule => {
          const values = [
            ...new Map(
              rows
                .map(r => r[rule.sourceColumn])
                .filter(v => v !== null && v !== undefined)
                .map(v => [String(v), v]),
            ).values(),
          ];
          if (!values.length) return [];
          return cachedLookup(x.targetTable, rule.targetKey, values);
        }),
      )
        .then(lists => {
          const target = lookupTable(x.targetTable),
            pk = target.primary_keys || [];
          if (!pk.length && conditions.length > 1) throw Error('Bảng nguồn cần khóa chính để kết hợp nhiều điều kiện.');
          for (const row of rows) {
            const matches = lists.map((list, i) => {
              const value = row[conditions[i].sourceColumn];
              return value == null
                ? []
                : list.filter(
                    r => r[conditions[i].targetKey] != null && String(r[conditions[i].targetKey]) === String(value),
                  );
            });
            let found;
            if (conditions.length === 1) found = matches[0];
            else {
              const key = r => JSON.stringify(pk.map(k => r[k]));
              if (x.mode === 'any') {
                const map = new Map();
                for (const r of matches.flat()) map.set(key(r), r);
                found = [...map.values()];
              } else {
                const sets = matches.slice(1).map(list => new Set(list.map(key)));
                found = matches[0].filter(r => sets.every(set => set.has(key(r))));
              }
            }
            results.set(row, { rows: found });
          }
        })
        .catch(error => {
          for (const row of rows) results.set(row, { error: error.message });
        }),
    );
  }
  render();
  await Promise.all(jobs);
  if (version === state.lookupVersion && state.table === table && !state.cellEdit) render();
}
function showLinkedRecord(config, row) {
  $('#linkedTitle').textContent = config.targetTable;
  const fields = $('#linkedFields');
  fields.replaceChildren();
  const target = lookupTable(config.targetTable);
  for (const c of target.columns) {
    const box = el('div', 'linked-field'),
      label = el('strong', '', c.name),
      value = row[c.name],
      content = el(
        'div',
        '',
        value == null ? '—' : typeof value === 'object' ? JSON.stringify(value, null, 2) : String(value),
      );
    box.append(label, content);
    fields.append(box);
  }
  $('#linkedRecord').showModal();
}
export function lookupCell(config, row) {
  const td = el('td', 'lookup-cell');
  td.onclick = e => e.stopPropagation();
  td.onkeydown = e => e.stopPropagation();
  const result = state.lookupResults.get(config.id),
    entry = result?.get('__error__') || result?.get(row);
  if (!entry || entry.loading) {
    td.textContent = 'Đang tải…';
    return td;
  }
  if (entry.error) {
    td.textContent = 'Lỗi lookup';
    td.title = entry.error;
    return td;
  }
  if (config.display === 'count') {
    td.textContent = String(entry.rows.length);
    return td;
  }
  if (!entry.rows.length) {
    td.textContent = '—';
    return td;
  }
  for (const linked of entry.rows) {
    const display = linked[config.targetField];
    let text = display == null ? '—' : typeof display === 'object' ? JSON.stringify(display) : String(display);
    if (config.format === 'grouped' && /^[+-]?\d+(?:\.\d+)?$/.test(text)) {
      const [whole, decimal] = text.split('.');
      text = whole.replace(/\B(?=(\d{3})+(?!\d))/g, ',') + (decimal === undefined ? '' : '.' + decimal);
    }
    const button = el('button', 'lookup-link', text);
    button.type = 'button';
    button.title = `Mở bản ghi trong ${config.targetTable}`;
    button.onclick = e => {
      e.stopPropagation();
      showLinkedRecord(config, linked);
    };
    td.append(button);
  }
  return td;
}

let pickerState = null,
  pickerTimer;
export function openLinkPicker(row, column, table, links) {
  pickerState = { row, column, table, links, page: 0, version: 0, saving: false };
  fillOptions(
    $('#pickerLink'),
    links.map(x => x.id),
    'Chọn liên kết',
  );
  $('#pickerLink').replaceChildren(...links.map(x => new Option(`${x.label} · ${x.targetTable}`, x.id)));
  $('#pickerLink').hidden = links.length < 2;
  $('#pickerSearch').value = '';
  $('#pickerError').textContent = '';
  $('#linkPickerContext').textContent = `${name(table)} · ${column.name}`;
  $('#pickerClear').hidden = !column.options.includes('nullable');
  $('#linkPicker').showModal();
  loadPicker();
}
async function loadPicker() {
  const picker = pickerState;
  if (!picker) return;
  const version = ++picker.version,
    config = picker.links.find(x => x.id === $('#pickerLink').value);
  if (!config) return;
  $('#pickerError').textContent = '';
  $('#pickerList').replaceChildren(el('div', 'lookup-empty', 'Đang tải…'));
  const query = new URLSearchParams({
    page: String(picker.page),
    search: $('#pickerSearch').value,
    field: '',
    value: '',
    sort: '',
    direction: 'asc',
  });
  try {
    const result = await api(`/api/table/${config.targetTable}?${query}`);
    if (picker !== pickerState || picker.version !== version) return;
    const list = $('#pickerList');
    list.replaceChildren();
    for (const row of result.rows) {
      if (row[config.targetKey] == null) continue;
      const button = el('button', 'picker-option');
      button.type = 'button';
      const value = row[config.targetField],
        label = value == null ? '—' : typeof value === 'object' ? JSON.stringify(value) : String(value);
      button.append(el('strong', '', label), el('span', '', `${config.targetKey}: ${row[config.targetKey]}`));
      button.onclick = () => saveLink(row[config.targetKey]);
      list.append(button);
    }
    if (!list.children.length) list.append(el('div', 'lookup-empty', 'Không tìm thấy bản ghi.'));
    $('#pickerPage').textContent = `Trang ${picker.page + 1}`;
    $('#pickerPrev').disabled = picker.page === 0;
    $('#pickerNext').disabled = (picker.page + 1) * PAGE_SIZE >= result.total;
  } catch (error) {
    if (picker === pickerState && picker.version === version) {
      $('#pickerList').replaceChildren();
      $('#pickerError').textContent = error.message;
    }
  }
}
async function saveLink(value) {
  const picker = pickerState;
  if (!picker || picker.saving) return;
  picker.saving = true;
  $('#pickerError').textContent = '';
  $('#pickerList').setAttribute('aria-busy', 'true');
  try {
    if (value !== picker.row[picker.column.name]) {
      const key = Object.fromEntries(picker.table.primary_keys.map(k => [k, picker.row[k]]));
      await api(`/api/table/${name(picker.table)}`, {
        method: 'PATCH',
        body: JSON.stringify({
          key,
          values: { [picker.column.name]: value },
          expected: expectedValues(picker.table, { [picker.column.name]: picker.row[picker.column.name] ?? null }),
        }),
      });
    }
    pickerState = null;
    $('#linkPicker').close();
    toast('Đã lưu liên kết');
    if (state.table === picker.table) await load({ silent: true });
  } catch (error) {
    picker.saving = false;
    $('#pickerError').textContent = error.message;
  } finally {
    $('#pickerList').removeAttribute('aria-busy');
  }
}
export function setLookupCloudAvailable(value) {
  return (lookupCloudAvailable = value);
}

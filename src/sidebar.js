import { choose } from './grid/render.js';
import { $, el, name, state } from './state.js';

function persistSidebar() {
  try {
    localStorage.setItem('siris-table-order', JSON.stringify(state.tables.map(name)));
    localStorage.setItem(
      'siris-table-folders',
      JSON.stringify({ folders: state.folders, tableFolders: state.tableFolders }),
    );
  } catch {}
}
export function restoreSidebar() {
  try {
    const saved = JSON.parse(localStorage.getItem('siris-table-order') || '[]');
    if (Array.isArray(saved)) {
      const rank = new Map(saved.map((n, i) => [n, i]));
      state.tables.sort((a, b) => (rank.get(name(a)) ?? Infinity) - (rank.get(name(b)) ?? Infinity));
    }
  } catch {}
  try {
    const data = JSON.parse(localStorage.getItem('siris-table-folders') || '{}');
    state.folders = Array.isArray(data.folders)
      ? data.folders.filter(f => f && typeof f.id === 'string' && typeof f.name === 'string')
      : [];
    state.tableFolders = data.tableFolders && typeof data.tableFolders === 'object' ? data.tableFolders : {};
  } catch {
    state.folders = [];
    state.tableFolders = {};
  }
}
function reorderTable(draggedName, targetName, placeAfter, targetFolder) {
  if (!draggedName || draggedName === targetName) return;
  const from = state.tables.findIndex(t => name(t) === draggedName);
  if (from < 0) return;
  const [item] = state.tables.splice(from, 1);
  if (targetFolder !== undefined) {
    state.tableFolders[draggedName] = targetFolder;
    if (targetFolder) {
      const folder = state.folders.find(f => f.id === targetFolder);
      if (folder) folder.collapsed = false;
    }
  }
  let to = targetName ? state.tables.findIndex(t => name(t) === targetName) : -1;
  if (to < 0) {
    const destination = targetFolder ?? null;
    const group = state.tables.filter(t => (state.tableFolders[name(t)] || null) === destination);
    to = group.length ? state.tables.indexOf(group.at(-1)) + 1 : state.tables.length;
  } else if (placeAfter) to++;
  state.tables.splice(to, 0, item);
  persistSidebar();
  clearTimeout(state.navAfterDrop);
  state.navAfterDrop = setTimeout(nav, 0);
}
function makeFolder(name) {
  const clean = name.trim();
  if (!clean) return;
  if (state.folders.some(f => f.name.toLocaleLowerCase() === clean.toLocaleLowerCase())) {
    alert('Đã có thư mục cùng tên.');
    return;
  }
  state.folders.push({
    id: `folder-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
    name: clean,
    collapsed: false,
  });
  persistSidebar();
  nav();
}
function getTableVisual(tableName) {
  const lower = tableName.toLowerCase();
  const PALETTES = [
    { bg: '#eff6ff', color: '#1d4ed8', border: '#bfdbfe' },
    { bg: '#dcfce7', color: '#15803d', border: '#bbf7d0' },
    { bg: '#fef3c7', color: '#b45309', border: '#fde68a' },
    { bg: '#e0f2fe', color: '#0369a1', border: '#bae6fd' },
    { bg: '#f3e8ff', color: '#7e22ce', border: '#e9d5ff' },
    { bg: '#ffe4e6', color: '#be123c', border: '#fecdd3' },
    { bg: '#ccfbf1', color: '#0f766e', border: '#99f6e4' },
    { bg: '#ffedd5', color: '#c2410c', border: '#fed7aa' },
  ];
  let hash = 0;
  for (let i = 0; i < lower.length; i++) hash = (hash * 31 + lower.charCodeAt(i)) & 0xffffffff;
  const palette = PALETTES[Math.abs(hash) % PALETTES.length];
  const parts = lower.split(/[^a-z0-9]+/i).filter(Boolean);
  let initials = '';
  if (parts.length >= 2) initials = (parts[0][0] + parts[1][0]).toUpperCase();
  else if (parts.length === 1 && parts[0].length >= 2) initials = parts[0].slice(0, 2).toUpperCase();
  else initials = (lower.slice(0, 2) || 'TB').toUpperCase();
  return { initials, palette };
}
function tableNode(t, list) {
  const n = name(t),
    visual = getTableVisual(n),
    b = el('button', 'nav-item' + (state.table === t ? ' active' : ''));
  b.draggable = true;
  b.setAttribute('aria-label', n);
  b.title = `${n} · Kéo để sắp xếp hoặc đưa vào thư mục`;
  const avatar = el('span', 'table-avatar', visual.initials);
  avatar.style.background = visual.palette.bg;
  avatar.style.color = visual.palette.color;
  avatar.style.borderColor = visual.palette.border;
  avatar.title = n;
  const label = el('span', 'table-name-text', n);
  b.append(avatar, label);
  b.onclick = () => choose(t);
  b.ondragstart = e => {
    e.dataTransfer.effectAllowed = 'move';
    e.dataTransfer.setData('text/plain', n);
    b.classList.add('dragging');
  };
  b.ondragend = () => {
    b.classList.remove('dragging');
    list
      .querySelectorAll('.drop-before,.drop-after,.drop-target')
      .forEach(x => x.classList.remove('drop-before', 'drop-after', 'drop-target'));
  };
  b.ondragover = e => {
    e.preventDefault();
    e.stopPropagation();
    e.dataTransfer.dropEffect = 'move';
    list
      .querySelectorAll('.drop-before,.drop-after,.drop-target')
      .forEach(x => x.classList.remove('drop-before', 'drop-after', 'drop-target'));
    b.classList.add(e.clientY > b.getBoundingClientRect().top + b.offsetHeight / 2 ? 'drop-after' : 'drop-before');
  };
  b.ondrop = e => {
    e.preventDefault();
    e.stopPropagation();
    const after = e.clientY > b.getBoundingClientRect().top + b.offsetHeight / 2;
    reorderTable(e.dataTransfer.getData('text/plain'), n, after, state.tableFolders[n] || null);
  };
  return b;
}
export function nav() {
  const list = $('#tables');
  list.replaceChildren();
  const query = $('#tableSearch').value.trim().toLocaleLowerCase();
  const visible = t => !query || name(t).toLocaleLowerCase().includes(query);
  const addDrop = (node, folderId) => {
    node.ondragover = e => {
      e.preventDefault();
      e.dataTransfer.dropEffect = 'move';
      node.classList.add('drop-target');
    };
    node.ondragleave = e => {
      if (!node.contains(e.relatedTarget)) node.classList.remove('drop-target');
    };
    node.ondrop = e => {
      e.preventDefault();
      node.classList.remove('drop-target');
      reorderTable(e.dataTransfer.getData('text/plain'), null, false, folderId);
    };
  };
  for (const folder of state.folders) {
    const members = state.tables.filter(t => state.tableFolders[name(t)] === folder.id);
    const folderMatches = !!query && folder.name.toLocaleLowerCase().includes(query);
    const shown = members.filter(t => !query || folderMatches || visible(t));
    if (query && !folderMatches && !shown.length) continue;
    const section = el('section', 'folder' + (folder.collapsed && !query ? ' collapsed' : ''));
    const head = el('div', 'folder-head');
    const toggle = el('button', 'folder-toggle');
    toggle.type = 'button';
    toggle.setAttribute('aria-expanded', String(!folder.collapsed || !!query));
    toggle.append(
      el('span', 'folder-arrow', folder.collapsed && !query ? '▸' : '▾'),
      el('span', 'folder-name', folder.name),
      el('span', 'folder-count', String(members.length)),
    );
    toggle.onclick = () => {
      folder.collapsed = !folder.collapsed;
      persistSidebar();
      nav();
    };
    const actions = el('div', 'folder-actions');
    const rename = el('button', 'folder-action', '···');
    rename.type = 'button';
    rename.title = `Tùy chọn ${folder.name}`;
    rename.setAttribute('aria-label', rename.title);
    rename.onclick = e => {
      e.stopPropagation();
      const action = prompt(`Nhập tên mới cho “${folder.name}”. Để xóa thư mục, nhập /xoa`, folder.name);
      if (action === null) return;
      if (action.trim() === '/xoa') {
        if (!confirm(`Xóa thư mục “${folder.name}”? Các bảng bên trong sẽ được chuyển ra ngoài thư mục.`)) return;
        state.folders = state.folders.filter(f => f.id !== folder.id);
        for (const key of Object.keys(state.tableFolders))
          if (state.tableFolders[key] === folder.id) delete state.tableFolders[key];
        persistSidebar();
        nav();
        return;
      }
      const next = action.trim();
      if (next && next !== folder.name) {
        if (state.folders.some(f => f.id !== folder.id && f.name.toLocaleLowerCase() === next.toLocaleLowerCase())) {
          alert('Đã có thư mục cùng tên.');
          return;
        }
        folder.name = next;
        persistSidebar();
        nav();
      }
    };
    actions.append(rename);
    head.append(toggle, actions);
    section.append(head);
    const content = el('div', 'folder-content');
    for (const t of shown) content.append(tableNode(t, list));
    section.append(content);
    addDrop(section, folder.id);
    list.append(section);
  }
  const loose = state.tables.filter(
    t => !state.tableFolders[name(t)] || !state.folders.some(f => f.id === state.tableFolders[name(t)]),
  );
  const looseShown = loose.filter(visible);
  if (looseShown.length || !state.folders.length) {
    const section = el('section', 'folder unfiled');
    const content = el('div', 'folder-content');
    for (const t of looseShown) content.append(tableNode(t, list));
    section.append(content);
    addDrop(section, null);
    list.append(section);
  }
  if (query && !list.children.length) list.append(el('div', 'muted', 'Không tìm thấy bảng hoặc thư mục.'));
  list.ondragover = e => {
    if (e.target === list) e.preventDefault();
  };
  list.ondrop = e => {
    if (e.target === list) {
      e.preventDefault();
      reorderTable(e.dataTransfer.getData('text/plain'), null, false, null);
    }
  };
}
export function initSidebar() {
  $('#addFolder').onclick = () => {
    const form = $('#createFolderForm'),
      open = form.hidden;
    form.hidden = !open;
    $('#addFolder').setAttribute('aria-expanded', String(open));
    if (open) $('#newFolderName').focus();
  };
  $('#cancelFolder').onclick = () => {
    $('#createFolderForm').hidden = true;
    $('#addFolder').setAttribute('aria-expanded', 'false');
    $('#newFolderName').value = '';
  };
  $('#createFolderForm').onsubmit = e => {
    e.preventDefault();
    const input = $('#newFolderName');
    if (!input.value.trim()) return;
    makeFolder(input.value);
    input.value = '';
    $('#createFolderForm').hidden = true;
    $('#addFolder').setAttribute('aria-expanded', 'false');
  };
  $('#tableSearch').oninput = () => nav();
}

export function closeNav() {
  $('#sidebar').classList.remove('open');
  $('#scrim').classList.remove('open');
}
function toggleSidebar() {
  const sidebar = $('#sidebar');
  sidebar.classList.toggle('collapsed');
  const expanded = !sidebar.classList.contains('collapsed');
  $('#toggleSidebar')?.setAttribute('aria-expanded', String(expanded));
  $('#toggleSidebar')?.setAttribute('aria-label', expanded ? 'Thu gọn thanh bên' : 'Mở rộng thanh bên');
  $('#sidebarToggleBtn')?.setAttribute('aria-expanded', String(expanded));
  $('#sidebarToggleBtn')?.setAttribute('title', expanded ? 'Thu gọn thanh bên (⌘B)' : 'Mở rộng thanh bên (⌘B)');
  try {
    localStorage.setItem('siris-sidebar-collapsed', String(!expanded));
  } catch {}
}
export function initSidebar2() {
  $('#toggleSidebar')?.addEventListener('click', e => {
    if (e.target.closest('#closeNav')) return;
    toggleSidebar();
  });
  $('#toggleSidebar')?.addEventListener('keydown', e => {
    if (e.target.closest('#closeNav')) return;
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      toggleSidebar();
    }
  });
  $('#brandHeader')?.addEventListener('click', () => {
    if ($('#sidebar').classList.contains('collapsed')) toggleSidebar();
  });
  if (sidebarToggleBtn) sidebarToggleBtn.onclick = () => toggleSidebar();
  document.addEventListener('keydown', e => {
    if ((e.metaKey || e.ctrlKey) && (e.key === 'b' || e.key === 'B')) {
      e.preventDefault();
      toggleSidebar();
    }
  });
  try {
    if (localStorage.getItem('siris-sidebar-collapsed') === 'true') {
      const s = $('#sidebar');
      s.classList.add('collapsed');
      $('#toggleSidebar')?.setAttribute('aria-expanded', 'false');
      $('#toggleSidebar')?.setAttribute('aria-label', 'Mở rộng thanh bên');
      $('#sidebarToggleBtn')?.setAttribute('aria-expanded', 'false');
      $('#sidebarToggleBtn')?.setAttribute('title', 'Mở rộng thanh bên (⌘B)');
    }
  } catch {}
  $('#openNav').onclick = () => {
    $('#sidebar').classList.add('open');
    $('#scrim').classList.add('open');
  };
  $('#closeNav').onclick = e => {
    e.stopPropagation();
    closeNav();
  };
  $('#scrim').onclick = closeNav;
}

const sidebarToggleBtn = $('#sidebarToggleBtn');

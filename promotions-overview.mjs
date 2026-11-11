const fields = [
  ['id', 'Mã định danh', 'UUID tự sinh của chương trình.'],
  ['name', 'Tên chương trình', 'Tên hiển thị bằng tiếng Việt.'],
  ['name_en', 'Tên tiếng Anh', 'Tên tiếng Anh; có thể để trống.'],
  ['description', 'Mô tả', 'Nội dung mô tả không tự trở thành điều kiện tính giá.'],
  ['branchid', 'Chi nhánh', 'Trống: không giới hạn chi nhánh.'],
  ['room_type_id', 'Loại phòng', 'Trống: mọi loại phòng trong phạm vi chi nhánh.'],
  ['minnights', 'Số đêm tối thiểu', 'Ngưỡng số đêm của lượt đặt; không tính ngày trả phòng.'],
  ['booking_start', 'Bắt đầu nhận đặt', 'Ngày đặt đầu tiên được xét. Trống: không giới hạn đầu khoảng.'],
  ['booking_end', 'Kết thúc nhận đặt', 'Ngày đặt cuối cùng được xét. Trống: không giới hạn cuối khoảng.'],
  ['stay_start', 'Đêm lưu trú đầu', 'Đêm đầu tiên trong khoảng áp dụng.'],
  ['stay_end', 'Đêm lưu trú cuối', 'Đêm cuối cùng trong khoảng áp dụng, khác ngày trả phòng.'],
  ['discountamount', 'Giá trị giảm', 'Phần trăm hoặc tiền VND tùy ispercentage.'],
  ['ispercentage', 'Đơn vị giảm', 'true: phần trăm; false: số tiền VND.'],
  ['discount_basis', 'Cách tính', 'per_night: từng đêm đủ điều kiện; per_stay: toàn lượt đặt.'],
  ['max_discount_per_night', 'Trần giảm mỗi đêm', 'Số tiền giảm tối đa mỗi đêm. Trống: không có trần này.'],
  ['max_discount_per_stay', 'Trần giảm lượt đặt', 'Tổng tiền giảm tối đa cho lượt đặt. Trống: không có trần này.'],
  ['priority', 'Mức ưu tiên', 'Số lớn hơn được xếp trước trong dashboard.'],
  ['is_active', 'Bật chương trình', 'Đang bật chưa có nghĩa mọi lượt đặt đều đủ điều kiện.'],
  ['created_at', 'Thời điểm tạo', 'Thời điểm database tạo bản ghi.'],
];
const esc = value =>
  String(value ?? '').replace(
    /[&<>"']/g,
    c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c],
  );
const number = value => new Intl.NumberFormat('vi-VN', { maximumFractionDigits: 2 }).format(Number(value));
const money = value => number(value) + 'đ';
const date = value => (value ? String(value).split('-').reverse().join('/') : 'Không giới hạn');
const range = (start, end) =>
  !start && !end
    ? 'Không giới hạn'
    : start && end && start === end
      ? date(start)
      : (start ? 'Từ ' + date(start) : 'Không giới hạn đầu') + ' → ' + (end ? date(end) : 'không giới hạn cuối');
const discount = row => (row.ispercentage ? number(row.discountamount) + '%' : money(row.discountamount));
const basis = row =>
  row.discount_basis === 'per_night'
    ? 'Mỗi đêm'
    : row.discount_basis === 'per_stay'
      ? 'Toàn lượt đặt'
      : (row.discount_basis ?? 'Chưa đặt');
const bool = value => value === true || value === 'true' || value === 1;
const normalize = value =>
  String(value ?? '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/đ/gi, 'd')
    .toLocaleLowerCase();

// Same-origin table API enforces the existing Supabase credentials and RLS.
// Read every page before publishing counts; the main grid's filters do not apply.
// Dashboards read whole tables, so they use the largest page the API allows.
const PAGE_SIZE = 1000;
export async function readAllPromotions(api, table, signal) {
  const rows = [],
    ids = new Set();
  let page = 0;
  while (true) {
    const query = new URLSearchParams({
      page: String(page),
      limit: String(PAGE_SIZE),
      search: '',
      filters: '[]',
      orders: JSON.stringify([{ column: 'id', direction: 'asc' }]),
    });
    const result = await api(`/api/table/${table}?${query}`, { signal });
    if (!Array.isArray(result.rows) || !Number.isSafeInteger(result.total) || result.total < 0)
      throw Error('Dữ liệu dashboard không hợp lệ.');
    if (!result.rows.length && rows.length < result.total) throw Error('Chưa tải đủ dữ liệu. Hãy làm mới dashboard.');
    for (const row of result.rows) {
      if (row.id != null && ids.has(row.id))
        throw Error('Dữ liệu đang thay đổi giữa các trang. Hãy làm mới dashboard.');
      if (row.id != null) ids.add(row.id);
      rows.push(row);
    }
    if (rows.length >= result.total) return rows;
    if (result.rows.length < PAGE_SIZE) throw Error('Máy chủ trả về ít dòng hơn dự kiến. Hãy làm mới dashboard.');
    if (++page > 100000) throw Error('Số trang vượt giới hạn của API.');
  }
}

export function createPromotionsOverview({ host, api, createSelect, getColumns, getTables }) {
  let rows = [],
    selected = null,
    request = null,
    version = 0,
    loaded = false;
  let branches = new Map(),
    rooms = new Map(),
    referenceWarning = '';
  const filters = { search: '', status: 'all', type: 'all', basis: 'all' };
  const find = selector => host.querySelector(selector);
  host.innerHTML = `
 <div class="promo-heading"><div><h2>Tổng quan khuyến mãi</h2><p>Đọc điều kiện, phạm vi và mức giảm của từng chương trình.</p></div><button type="button" class="secondary" data-promo-refresh>Làm mới</button></div>
 <div class="promo-feedback" role="status" data-promo-feedback>Đang tải dữ liệu…</div>
 <div class="promo-metrics" data-promo-metrics></div>
 <div class="promo-filters"><label class="promo-search"><span>Tìm chương trình</span><input type="search" placeholder="Tên hoặc mô tả…" aria-label="Tìm chương trình khuyến mãi" data-promo-search></label><div data-promo-status></div><div data-promo-type></div><div data-promo-basis></div><button type="button" class="quiet" data-promo-clear>Xóa lọc</button></div>
 <div class="promo-section-title"><h3>Danh sách chương trình</h3><span data-promo-count></span></div>
 <div class="promo-workspace"><div class="promo-list" data-promo-list></div></div><dialog class="promo-detail-dialog" aria-labelledby="promoDetailTitle"><div class="dialog-head"><h2 id="promoDetailTitle">Chi tiết chương trình</h2><button type="button" class="icon" data-promo-close aria-label="Đóng chi tiết">×</button></div><div class="promo-detail" data-promo-detail></div></dialog>
 `;
  const selectControls = [];
  for (const [key, label, options] of [
    [
      'status',
      'Trạng thái',
      [
        ['all', 'Mọi trạng thái'],
        ['on', 'Đang bật'],
        ['off', 'Đã tắt'],
      ],
    ],
    [
      'type',
      'Kiểu giảm',
      [
        ['all', 'Mọi kiểu giảm'],
        ['percent', 'Phần trăm'],
        ['fixed', 'Số tiền cố định'],
      ],
    ],
    [
      'basis',
      'Cách tính',
      [
        ['all', 'Mọi cách tính'],
        ['per_night', 'Theo đêm'],
        ['per_stay', 'Toàn lượt đặt'],
      ],
    ],
  ]) {
    const holder = find(`[data-promo-${key}]`),
      text = document.createElement('span');
    text.className = 'promo-filter-label';
    text.textContent = label;
    const control = createSelect({
      options: options.map(([value, label]) => ({ value, label })),
      value: 'all',
      ariaLabel: label + ' khuyến mãi',
      className: 'promo-select',
      onChange: value => {
        filters[key] = value;
        render();
      },
    });
    holder.append(text, control);
    selectControls.push(control);
  }
  find('[data-promo-search]').addEventListener('input', event => {
    filters.search = event.target.value;
    render();
  });
  find('[data-promo-clear]').onclick = () => {
    Object.assign(filters, { search: '', status: 'all', type: 'all', basis: 'all' });
    find('[data-promo-search]').value = '';
    selectControls.forEach(control => control.setValue('all'));
    render();
  };
  find('[data-promo-refresh]').onclick = () => void load();
  find('[data-promo-close]').onclick = () => find('.promo-detail-dialog').close();
  function scope(row) {
    if (row.room_type_id) {
      const room = rooms.get(row.room_type_id);
      return room
        ? `${branches.get(room.branchid)?.name ?? 'Chi nhánh'} · ${room.name}`
        : `Loại phòng: ${row.room_type_id}`;
    }
    if (row.branchid) return branches.get(row.branchid)?.name ?? `Chi nhánh: ${row.branchid}`;
    return 'Tất cả chi nhánh';
  }
  function visibleRows() {
    return rows
      .filter(
        row =>
          (!filters.search ||
            normalize(`${row.name} ${row.name_en ?? ''} ${row.description ?? ''}`).includes(
              normalize(filters.search.trim()),
            )) &&
          (filters.status === 'all' || row.is_active === (filters.status === 'on')) &&
          (filters.type === 'all' || row.ispercentage === (filters.type === 'percent')) &&
          (filters.basis === 'all' || row.discount_basis === filters.basis),
      )
      .sort(
        (a, b) =>
          Number(b.priority ?? 0) - Number(a.priority ?? 0) || String(a.name).localeCompare(String(b.name), 'vi'),
      );
  }
  function feedback(text, error = false) {
    const target = find('[data-promo-feedback]');
    target.replaceChildren();
    target.classList.toggle('is-error', error);
    const line = document.createElement('span');
    line.textContent = text;
    target.append(line);
    if (error) {
      const retry = document.createElement('button');
      retry.className = 'quiet';
      retry.type = 'button';
      retry.textContent = 'Thử lại';
      retry.onclick = () => void load();
      target.append(retry);
    }
  }
  function render() {
    const visible = visibleRows();
    find('[data-promo-count]').textContent = `${visible.length} / ${rows.length} chương trình`;
    find('[data-promo-metrics]').innerHTML = [
      ['Trong bộ lọc', visible.length],
      ['Đang bật', visible.filter(row => row.is_active).length],
      ['Giảm theo %', visible.filter(row => row.ispercentage).length],
      ['Giảm cố định', visible.filter(row => !row.ispercentage).length],
    ]
      .map(([label, value]) => `<div><span>${label}</span><strong>${number(value)}</strong></div>`)
      .join('');
    const list = find('[data-promo-list]');
    list.replaceChildren();
    if (!visible.length) {
      const empty = document.createElement('div');
      empty.className = 'promo-empty';
      empty.textContent = !loaded
        ? 'Chưa tải được dữ liệu.'
        : rows.length
          ? 'Không có chương trình khớp bộ lọc.'
          : 'Chưa có chương trình nào mà kết nối hiện tại được phép xem.';
      list.append(empty);
    }
    for (const row of visible) {
      const wrapper = document.createElement('div');
      wrapper.className = 'promo-program-row';
      const item = document.createElement('button');
      item.type = 'button';
      item.className = 'promo-program';
      item.dataset.promoId = row.id;
      item.innerHTML = `<span class="promo-program-name"><strong>${esc(row.name)}</strong><small>${esc(scope(row))}</small></span><span class="promo-program-amount"><strong>${esc(discount(row))}</strong><small>${esc(basis(row))}</small></span><span class="promo-program-condition">Từ ${esc(row.minnights ?? 1)} đêm<small>${esc(range(row.stay_start, row.stay_end))}</small></span><span class="promo-program-state"><span class="promo-status ${row.is_active ? 'is-on' : ''}">${row.is_active ? 'Đang bật' : 'Đã tắt'}</span></span><span class="promo-view-detail">Chi tiết</span>`;
      item.setAttribute('aria-label', `Xem chi tiết ${row.name}`);
      item.onclick = () => {
        selected = row;
        renderDetail();
        find('.promo-detail-dialog').showModal();
      };
      wrapper.append(item);
      list.append(wrapper);
    }
    if (!selected || !visible.some(row => row.id === selected.id)) selected = visible[0] ?? null;
    renderDetail();
    syncSelection();
  }
  function syncSelection() {}
  function line(label, value) {
    return `<div class="promo-kv"><span>${esc(label)}</span><strong>${esc(value)}</strong></div>`;
  }
  function renderDetail() {
    const detail = find('[data-promo-detail]');
    host.querySelectorAll('[data-promo-id]').forEach(item => {
      const current = item.dataset.promoId === String(selected?.id);
      item.classList.toggle('is-selected', current);
      item.setAttribute('aria-pressed', String(current));
    });
    if (!selected) {
      detail.innerHTML =
        '<h3>Chi tiết chương trình</h3><p>Chọn một chương trình để xem mức giảm, phạm vi áp dụng, ngày đặt và đêm lưu trú.</p><details><summary>Giải thích các cột</summary><dl class="promo-field-guide">' +
        fields
          .map(([key, label, description]) => `<dt>${label} <code>${key}</code></dt><dd>${description}</dd>`)
          .join('') +
        '</dl></details>';
      return;
    }
    const row = selected;
    const columns = getColumns();
    detail.innerHTML = `<h3>${esc(row.name)}</h3>${row.description ? `<p>${esc(row.description)}</p>` : ''}<div class="promo-detail-amount">${esc(discount(row))}<small>${esc(basis(row))}</small></div><section><h4>Phạm vi và điều kiện</h4>${line('Chi nhánh', row.branchid ? (branches.get(row.branchid)?.name ?? row.branchid) : 'Không giới hạn')}${line('Loại phòng', row.room_type_id ? (rooms.get(row.room_type_id)?.name ?? row.room_type_id) : 'Không giới hạn')}${line('Số đêm tối thiểu', `${row.minnights ?? 1} đêm`)}</section><section><h4>Thời gian áp dụng</h4>${line('Ngày đặt', range(row.booking_start, row.booking_end))}${line('Đêm lưu trú', range(row.stay_start, row.stay_end))}</section><section><h4>Giới hạn</h4>${line('Trần mỗi đêm', row.max_discount_per_night == null ? 'Không giới hạn' : money(row.max_discount_per_night))}${line('Trần lượt đặt', row.max_discount_per_stay == null ? 'Không giới hạn' : money(row.max_discount_per_stay))}${line('Mức ưu tiên', row.priority ?? 0)}</section><details><summary>Dữ liệu gốc và giải thích cột</summary><dl class="promo-field-guide">${columns
      .map(column => {
        const field = fields.find(([key]) => key === column.name),
          value = row[column.name];
        return `<dt>${esc(field?.[1] ?? column.name)} <code>${esc(column.name)}</code></dt><dd class="promo-raw-value">${esc(value == null ? 'Trống' : typeof value === 'object' ? JSON.stringify(value) : value)}</dd>${field ? `<dd>${esc(field[2])}</dd>` : ''}`;
      })
      .join('')}</dl></details>`;
  }
  async function load() {
    request?.abort();
    request = new AbortController();
    const signal = request.signal,
      attempt = ++version;
    find('[data-promo-refresh]').disabled = true;
    host.setAttribute('aria-busy', 'true');
    feedback(loaded ? 'Đang làm mới dữ liệu…' : 'Đang tải toàn bộ chương trình…');
    try {
      const data = await readAllPromotions(api, 'promotions', signal);
      let branchData = [],
        roomData = [];
      referenceWarning = '';
      const needsRooms = data.some(row => row.room_type_id),
        needsBranches = needsRooms || data.some(row => row.branchid),
        tables = getTables();
      const references = await Promise.allSettled([
        needsBranches && tables.some(table => table.name === 'public.branches')
          ? readAllPromotions(api, 'branches', signal)
          : Promise.resolve([]),
        needsRooms && tables.some(table => table.name === 'public.room_types')
          ? readAllPromotions(api, 'room_types', signal)
          : Promise.resolve([]),
      ]);
      if (signal.aborted || attempt !== version) return;
      if (references[0].status === 'fulfilled') branchData = references[0].value;
      else referenceWarning = ' Một số tên liên kết chưa tải được; đang hiển thị ID.';
      if (references[1].status === 'fulfilled') roomData = references[1].value;
      else referenceWarning = ' Một số tên liên kết chưa tải được; đang hiển thị ID.';
      branches = new Map(branchData.map(row => [row.id, row]));
      rooms = new Map(roomData.map(row => [row.id, row]));
      rows = data.map(row => ({ ...row, is_active: bool(row.is_active), ispercentage: bool(row.ispercentage) }));
      selected = rows.find(row => row.id === selected?.id) ?? null;
      loaded = true;
      render();
      const timestamp = new Intl.DateTimeFormat('vi-VN', {
        dateStyle: 'short',
        timeStyle: 'short',
        timeZone: 'Asia/Ho_Chi_Minh',
      }).format(new Date());
      feedback(`Cập nhật ${timestamp} · ${rows.length} chương trình trong quyền truy cập hiện tại.${referenceWarning}`);
    } catch (error) {
      if (error.name === 'AbortError' || attempt !== version) return;
      feedback(
        (loaded ? 'Không thể làm mới. Đang giữ bản dữ liệu lần trước. ' : 'Không thể tải dashboard. ') + error.message,
        true,
      );
      if (!loaded) render();
    } finally {
      if (attempt === version) {
        find('[data-promo-refresh]').disabled = false;
        host.removeAttribute('aria-busy');
      }
    }
  }
  function cancel() {
    version++;
    request?.abort();
    find('[data-promo-refresh]').disabled = false;
    host.removeAttribute('aria-busy');
  }
  function removeRecord(record) {
    if (String(selected?.id) === String(record.id) && find('.promo-detail-dialog').open)
      find('.promo-detail-dialog').close();
    rows = rows.filter(row => String(row.id) !== String(record.id));
    if (String(selected?.id) === String(record.id)) selected = null;
    if (loaded) render();
  }
  return { load, cancel, syncSelection, removeRecord, total: () => rows.length };
}

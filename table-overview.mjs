const esc = value =>
  String(value ?? '').replace(
    /[&<>"']/g,
    c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c],
  );
const fmt = value =>
  value == null || value === ''
    ? '—'
    : typeof value === 'object'
      ? JSON.stringify(value)
      : typeof value === 'boolean'
        ? value
          ? 'Có'
          : 'Không'
        : String(value);
const num = value => new Intl.NumberFormat('vi-VN', { maximumFractionDigits: 2 }).format(Number(value));
const money = value => (value == null || value === '' || !Number.isFinite(Number(value)) ? '—' : `${num(value)}đ`);
const normalize = value =>
  String(value ?? '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/đ/gi, 'd')
    .toLowerCase();
const labels = {
  name: 'Tên',
  item_name: 'Vật phẩm',
  address: 'Địa chỉ',
  is_hidden: 'Hiển thị',
  branchid: 'Chi nhánh',
  sqm: 'Diện tích',
  weekdayprice: 'Giá ngày thường',
  weekendprice: 'Giá cuối tuần',
  monthly_under_3: 'Giá tháng dưới 3 tháng',
  monthly_over_3: 'Giá tháng từ 3 tháng',
  monthly_under: 'Giá tháng ngắn hạn',
  monthly_over: 'Giá tháng dài hạn',
  minContractMonths: 'Hợp đồng tối thiểu',
  date: 'Ngày',
  type: 'Loại',
  amount: 'Mức điều chỉnh',
  note: 'Ghi chú',
  kind: 'Loại',
  quantity: 'Số lượng',
  unit_price: 'Đơn giá',
  minnights: 'Số đêm tối thiểu',
  discountamount: 'Mức giảm',
  code: 'Mã',
  category: 'Nhóm',
  amount_type: 'Kiểu tính',
  calculation_base: 'Cơ sở tính',
  is_active: 'Trạng thái',
  key: 'Khóa',
  value: 'Giá trị',
  description: 'Mô tả',
};
const configs = {
  branches: { title: 'Tổng quan chi nhánh', fields: ['name', 'address', 'is_hidden'] },
  longterm_branches: { title: 'Tổng quan chi nhánh dài hạn', fields: ['name', 'address', 'is_hidden'] },
  room_types: {
    title: 'Tổng quan loại phòng',
    fields: [
      'name',
      'branchid',
      'sqm',
      'weekdayprice',
      'weekendprice',
      'monthly_under_3',
      'monthly_over_3',
      'is_hidden',
    ],
  },
  longterm_room_types: {
    title: 'Tổng quan loại phòng dài hạn',
    fields: ['name', 'branchid', 'sqm', 'monthly_under', 'monthly_over', 'minContractMonths', 'is_hidden'],
  },
  date_adjustments: { title: 'Tổng quan điều chỉnh theo ngày', fields: ['date', 'type', 'amount', 'note'] },
  items: { title: 'Tổng quan vật phẩm', fields: ['item_name', 'kind', 'quantity', 'unit_price', '__total'] },
  stay_discounts: { title: 'Tổng quan giảm giá lưu trú', fields: ['name', 'minnights', 'discountamount'] },
  settings: { title: 'Tổng quan cấu hình', fields: ['key', 'value', 'description'] },
  longterm_settings: { title: 'Tổng quan cấu hình dài hạn', fields: ['key', 'value', 'description'] },
  service_rules: {
    title: 'Tổng quan quy tắc dịch vụ',
    fields: ['name', 'category', 'amount', 'amount_type', 'is_active'],
  },
};
// Dashboards read whole tables, so they use the largest page the API allows.
const PAGE_SIZE = 1000;
export async function readAllTableRows(api, table, signal) {
  const rows = [],
    seen = new Set(),
    keys = table.primary_keys || [],
    orders = keys.map(column => ({ column, direction: 'asc' }));
  let expected;
  for (let page = 0; page <= 100000; page++) {
    const query = new URLSearchParams({
      page: String(page),
      limit: String(PAGE_SIZE),
      search: '',
      filters: '[]',
      orders: JSON.stringify(orders),
    });
    const result = await api(`/api/table/${encodeURIComponent(table.name.replace(/^public\./, ''))}?${query}`, {
      signal,
    });
    if (!Array.isArray(result.rows) || !Number.isSafeInteger(result.total) || result.total < 0)
      throw Error('Dữ liệu nhận được không hợp lệ.');
    if (expected !== undefined && expected !== result.total)
      throw Error('Dữ liệu thay đổi trong lúc tải. Hãy làm mới.');
    expected = result.total;
    if (!result.rows.length && rows.length < expected) throw Error('Chưa tải đủ dữ liệu. Hãy làm mới.');
    for (const row of result.rows) {
      if (keys.length) {
        const id = JSON.stringify(keys.map(key => row[key]));
        if (seen.has(id)) throw Error('Dữ liệu thay đổi trong lúc tải. Hãy làm mới.');
        seen.add(id);
      }
      rows.push(row);
    }
    if (rows.length === expected) return rows;
    if (rows.length > expected) throw Error('Dữ liệu thay đổi trong lúc tải. Hãy làm mới.');
    if (result.rows.length < PAGE_SIZE) throw Error('Máy chủ trả về ít dòng hơn dự kiến. Hãy làm mới.');
  }
  throw Error('Số trang vượt giới hạn.');
}
export function createTableOverview({ host, api, getTables }) {
  let rows = [],
    table = null,
    columns = [],
    branchNames = new Map(),
    controller = null,
    version = 0,
    loaded = false;
  const cancel = () => {
    version++;
    controller?.abort();
    controller = null;
  };
  const cell = (row, key) => {
    const v = row[key];
    if (key === '__total')
      return row.quantity == null ||
        row.unit_price == null ||
        !Number.isFinite(Number(row.quantity) * Number(row.unit_price))
        ? '—'
        : money(Number(row.quantity) * Number(row.unit_price));
    if (key === 'branchid') return v == null ? '—' : branchNames.get(String(v)) || String(v);
    if (key === 'is_active') return v == null ? '—' : v ? 'Đang bật' : 'Đã tắt';
    if (key === 'is_hidden') return v == null ? '—' : v ? 'Đã ẩn' : 'Đang hiển thị';
    if (key === 'type' && table.name === 'public.date_adjustments')
      return v === 'surcharge' ? 'Phụ thu' : v === 'discount' ? 'Giảm giá' : fmt(v);
    if (key === 'amount' && table.name === 'public.date_adjustments')
      return v == null ? '—' : row.ispercentage ? `${num(v)}%` : money(v);
    if (key === 'discountamount' && table.name === 'public.stay_discounts')
      return v == null ? '—' : row.ispercentage ? `${num(v)}%` : money(v);
    if (
      [
        'weekdayprice',
        'weekendprice',
        'monthly_under_3',
        'monthly_over_3',
        'monthly_under',
        'monthly_over',
        'unit_price',
      ].includes(key)
    )
      return money(v);
    if (key === 'sqm' && v != null) return `${fmt(v)} m²`;
    return fmt(v);
  };
  function render() {
    if (!table) return;
    const short = table.name.replace(/^public\./, ''),
      config = configs[short],
      available = new Set(columns.map(c => c.name));
    let fields =
      config?.fields.filter(k =>
        k === '__total' ? available.has('quantity') && available.has('unit_price') : available.has(k),
      ) || [];
    if (!fields.length)
      fields = columns
        .filter(c => !table.primary_keys?.includes(c.name))
        .slice(0, 5)
        .map(c => c.name);
    if (!fields.length) fields = columns.slice(0, 5).map(c => c.name);
    const term = normalize(host.querySelector('[data-overview-search]').value.trim());
    const visible = rows.filter(
      row =>
        !term ||
        columns.some(c => normalize(fmt(row[c.name])).includes(term)) ||
        fields.some(k => normalize(cell(row, k)).includes(term)),
    );
    const metrics = [
      ['Tổng bản ghi', rows.length],
      ['Trong kết quả', visible.length],
    ];
    if ((short === 'branches' || short === 'longterm_branches') && available.has('is_hidden'))
      metrics.push(['Đang hiển thị', rows.filter(r => r.is_hidden === false).length]);
    if (short === 'items' && available.has('quantity'))
      metrics.push([
        'Tổng số lượng',
        num(rows.reduce((s, r) => s + (Number.isFinite(Number(r.quantity)) ? Number(r.quantity) : 0), 0)),
      ]);
    host.querySelector('[data-overview-metrics]').innerHTML = metrics
      .map(([label, value]) => `<div><span>${esc(label)}</span><strong>${esc(value)}</strong></div>`)
      .join('');
    host.querySelector('[data-overview-metrics]').hidden = !loaded;
    host.querySelector('[data-overview-count]').textContent = loaded
      ? `${visible.length} / ${rows.length} bản ghi`
      : '';
    const list = host.querySelector('[data-overview-list]');
    list.replaceChildren();
    if (!visible.length) {
      list.innerHTML = `<div class="promo-empty">${loaded ? (rows.length ? 'Không có bản ghi khớp tìm kiếm.' : 'Chưa có bản ghi nào được phép xem.') : 'Chưa tải được dữ liệu.'}</div>`;
      return;
    }
    for (const row of visible) {
      const button = document.createElement('button');
      button.type = 'button';
      button.className = 'overview-row';
      button.setAttribute('aria-label', `Xem chi tiết ${fmt(row[fields[0]])}`);
      button.innerHTML =
        fields
          .map(
            key =>
              `<span><small>${esc(key === '__total' ? 'Thành tiền' : labels[key] || key)}</small><strong>${esc(cell(row, key))}</strong></span>`,
          )
          .join('') + '<span class="overview-detail-link">Chi tiết</span>';
      button.onclick = () => {
        const detail = host.querySelector('[data-overview-detail]');
        detail.replaceChildren();
        for (const column of columns) {
          const block = document.createElement('div');
          const title = document.createElement('dt');
          title.textContent = labels[column.name] || column.name;
          const value = document.createElement('dd');
          value.textContent = cell(row, column.name);
          block.append(title, value);
          detail.append(block);
        }
        host.querySelector('dialog').showModal();
      };
      list.append(button);
    }
  }
  async function load(nextTable) {
    cancel();
    const attempt = version;
    controller = new AbortController();
    const signal = controller.signal;
    if (table?.name !== nextTable.name) {
      rows = [];
      loaded = false;
      branchNames = new Map();
      table = nextTable;
      columns = nextTable.columns || [];
      host.querySelector('[data-overview-search]').value = '';
    } else {
      table = nextTable;
      columns = nextTable.columns || [];
    }
    const short = table.name.replace(/^public\./, ''),
      config = configs[short];
    host.querySelector('h2').textContent = config?.title || `Tổng quan ${short}`;
    const status = host.querySelector('[data-overview-feedback]');
    status.textContent = 'Đang tải dữ liệu…';
    status.classList.remove('is-error');
    if (!loaded) render();
    try {
      const data = await readAllTableRows(api, table, signal);
      let refs = new Map(),
        warning = '';
      if (['room_types', 'longterm_room_types'].includes(short) && columns.some(c => c.name === 'branchid')) {
        const ref = getTables().find(
          t => t.name === `public.${short === 'room_types' ? 'branches' : 'longterm_branches'}`,
        );
        if (ref) {
          try {
            const values = await readAllTableRows(api, ref, signal);
            refs = new Map(values.map(row => [String(row.id), row.name]));
          } catch (error) {
            if (error.name === 'AbortError') throw error;
            warning = ' Không tải được tên chi nhánh.';
          }
        }
      }
      if (attempt !== version) return;
      rows = data;
      branchNames = refs;
      loaded = true;
      status.textContent = `Cập nhật ${new Date().toLocaleString('vi-VN')} · ${rows.length} bản ghi.${warning}`;
      render();
    } catch (error) {
      if (error.name === 'AbortError' || attempt !== version) return;
      status.textContent =
        (loaded ? 'Không thể làm mới. Đang giữ dữ liệu lần trước. ' : 'Không thể tải dashboard. ') + error.message;
      status.classList.add('is-error');
      if (!loaded) render();
    }
  }
  host.innerHTML = `<div class="promo-heading"><div><h2>Tổng quan</h2><p>Thông tin chính của bảng.</p></div><button type="button" class="secondary" data-overview-refresh>Làm mới</button></div><div class="promo-feedback" role="status" data-overview-feedback></div><div class="promo-metrics" data-overview-metrics></div><div class="overview-search"><label>Tìm bản ghi<input type="search" placeholder="Tìm kiếm…" data-overview-search></label></div><div class="promo-section-title"><h3>Danh sách bản ghi</h3><span data-overview-count></span></div><div class="overview-list" data-overview-list></div><dialog class="promo-detail-dialog" aria-labelledby="overviewDetailTitle"><div class="dialog-head"><h2 id="overviewDetailTitle">Chi tiết bản ghi</h2><button type="button" class="icon" data-overview-close aria-label="Đóng chi tiết">×</button></div><dl class="overview-detail" data-overview-detail></dl></dialog>`;
  host.querySelector('[data-overview-search]').oninput = render;
  host.querySelector('[data-overview-refresh]').onclick = () => void load(table);
  host.querySelector('[data-overview-close]').onclick = () => host.querySelector('dialog').close();
  return { load, cancel };
}

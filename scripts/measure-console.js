// Dán vào tab Console của bản đã đăng nhập (production cũ, rồi Preview mới).
// Đổi TABLE thành tên một bảng lớn có thật. Chỉ đọc, không ghi dữ liệu.
(async () => {
  const TABLE = 'ĐỔI_TÊN_BẢNG';
  const t = async (label, url) => {
    const ms = [],
      srv = [];
    for (let i = 0; i < 5; i++) {
      const s = performance.now();
      const r = await fetch(url, { credentials: 'same-origin', cache: 'no-store' });
      await r.arrayBuffer();
      ms.push(Math.round(performance.now() - s));
      srv.push((r.headers.get('Server-Timing') || '').replace('app;dur=', '').slice(0, 7));
    }
    const sorted = [...ms].sort((a, b) => a - b);
    return { phép: label, 'trung vị ms': sorted[2], 'các lần': ms.join(','), 'Server-Timing': srv.join(',') };
  };
  const base = `/api/table/${TABLE}`;
  console.table([
    await t('/api/meta', '/api/meta'),
    await t('trang 1', `${base}?page=0&limit=50`),
    await t('trang 1 count=none', `${base}?page=0&limit=50&count=none`),
    await t('trang 2 count=none', `${base}?page=1&limit=50&count=none`),
    await t('limit=1000', `${base}?page=0&limit=1000&count=none`),
  ]);
})();

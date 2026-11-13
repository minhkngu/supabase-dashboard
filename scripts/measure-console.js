// Chỉ gửi GET, không ghi dữ liệu. Dán vào Console của trang đã đăng nhập.
(async () => {
  const initial = await fetch('/api/meta', { cache: 'no-store' });
  if (!initial.ok) throw Error(`Không đọc được metadata: ${initial.status}`);
  const meta = await initial.json();
  const routes = [
    ['Mức sàn', '/api/khong-co', 150],
    ['Metadata', '/api/meta', 200],
    ['Formula', '/api/formula-config'],
    ['Lookup', '/api/lookup-config'],
    ['Cấu hình giao diện', '/api/ui-settings'],
  ];
  for (const table of meta.tables.slice(0, 3)) {
    const name = table.name.replace(/^public\./, '');
    const base = `/api/table/${encodeURIComponent(name)}?page=0&limit=50`;
    routes.push([`${name} có đếm`, base, 400], [`${name} không đếm`, `${base}&count=none`, 400]);
  }
  const results = [];
  for (const [label, url, limit] of routes) {
    const times = [],
      timings = [],
      regions = new Set();
    for (let i = 0; i < 5; i++) {
      const start = performance.now();
      const response = await fetch(url, { credentials: 'same-origin', cache: 'no-store' });
      await response.arrayBuffer();
      times.push(Math.round(performance.now() - start));
      timings.push(response.headers.get('Server-Timing') || '—');
      regions.add(response.headers.get('x-vercel-id')?.split('::')[1] || '—');
      if (!response.ok && url !== '/api/khong-co') throw Error(`${label}: HTTP ${response.status}`);
    }
    times.sort((a, b) => a - b);
    results.push({
      phép: label,
      'trung vị ms': times[2],
      'min–max ms': `${times[0]}–${times[4]}`,
      ngưỡng: limit && times[2] > limit ? `Vượt ${limit} ms` : limit || '—',
      'Server-Timing': timings.join(' | '),
      vùng: [...regions].join(', '),
    });
  }
  console.table(results);
})();

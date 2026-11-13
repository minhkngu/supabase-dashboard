# Siris — Quản lý dữ liệu Supabase

Ứng dụng web xem và sửa dữ liệu một dự án Supabase theo kiểu bảng tính: sửa tại ô, lọc, nhóm, sắp xếp, view, thiết lập cột, đồng bộ lookup, formula và dashboard chỉ xem. Chạy cục bộ trên máy cá nhân, hoặc online trên Vercel có đăng nhập.

- Frontend: JavaScript thuần (ES module trong `src/`), build bằng Vite.
- Backend: Node.js (`server/`), gọi Supabase Data API bằng key ở máy chủ; thêm kết nối PostgreSQL cho các chức năng quản trị cấu trúc.
- Kế hoạch và việc còn lại: thư mục [`plan/`](plan/).

## Mục lục

1. [Cài đặt và chạy](#cài-đặt-và-chạy)
2. [Cấu hình](#cấu-hình)
3. [Tính năng](#tính-năng)
4. [Kiến trúc](#kiến-trúc)
5. [Kiểm thử](#kiểm-thử)
6. [Triển khai lên Vercel](#triển-khai-lên-vercel)
7. [Kế hoạch](#kế-hoạch)

## Cài đặt và chạy

Cần Node.js 22.12+ (CI chạy Node 22 và 24).

```sh
npm install
cp .env.example .env.local
npm run dev
```

Mở http://localhost:3000. `npm run dev` chạy Vite ở cổng 3000 và máy chủ Node ở cổng 3001 (Vite chuyển `/api` sang).

Chạy bản đã build: `npm run build` rồi `npm start` (mặc định cổng 4173, đổi bằng `PORT`).

## Cấu hình

Biến môi trường đặt trong `.env.local` (chỉ máy chủ đọc, đã loại khỏi Git) hoặc trong môi trường tiến trình:

| Biến | Bắt buộc | Nội dung |
| --- | --- | --- |
| `SUPABASE_URL` | Có | URL dự án Supabase |
| `SUPABASE_KEY` | Có | Publishable/anon key. Quyền đọc ghi dữ liệu theo key này và RLS tương ứng |
| `SUPABASE_DB_URL` | Không | Kết nối PostgreSQL cho thiết lập cột, lookup đồng bộ, formula, lưu cấu hình giao diện và metadata trực tiếp. Phải cùng dự án với `SUPABASE_URL` |
| `PORT` | Không | Cổng của `npm start` |
| `SIRIS_PERF_TIMING` | Không | `1` để trả header `Server-Timing` |

Không đưa service role key, mật khẩu database hay access token vào mã nguồn hoặc trình duyệt; không dùng tiền tố `VITE_`.

Khi thiếu `SUPABASE_DB_URL`, metadata lấy từ `schema.json` đã lưu (có thể cũ) và các chức năng quản trị bị khóa. Bảng không có khóa chính chỉ xem được.

### Bảng phụ trên Supabase

Các bảng cấu hình nằm trong schema `siris_admin`, đã thu hồi quyền của `anon` và `authenticated`. Chạy một lần trong SQL editor của Supabase:

- `lookup-store.sql`: nơi lưu cấu hình lookup (`siris_admin.lookup_configs`).
- `ui-settings.sql`: nơi lưu cấu hình giao diện (`siris_admin.ui_settings`).

Bảng formula (`siris_admin.formula_configs`) được tạo tự động lần đầu lưu formula.

## Tính năng

### Phím tắt

- Mũi tên: di chuyển giữa các ô; gõ ký tự để sửa ô; F2 hoặc Enter để mở ô.
- Khi sửa: Enter lưu và xuống dòng, Tab lưu và sang phải (Shift+Tab sang trái), Escape hủy.
- `/`: vào ô tìm kiếm. Ctrl/⌘+K: chuyển bảng nhanh. Ctrl/⌘+Z, Ctrl/⌘+Shift+Z: hoàn tác, làm lại. Ctrl/⌘+B: thu gọn thanh bên.
- Bấm tiêu đề cột để sắp xếp, lọc, nhóm, ẩn, ghim hoặc thiết lập cột.

### Sửa nhiều ô

Chọn các ô cùng cột bằng Shift và nhấp ô đầu, ô cuối; nhập giá trị rồi bấm **Áp dụng**, hoặc dán dữ liệu từ bàn phím. Mỗi dòng được lưu riêng (tối đa 50 dòng một lô) và lỗi được báo theo dòng. Hoàn tác/làm lại chỉ áp dụng cho sửa từng ô trong phiên.

### Lưu cấu hình giao diện lên Supabase

View, thư mục, thứ tự bảng và tên hiển thị được lưu trong `localStorage` và đồng bộ lên `siris_admin.ui_settings`, nên theo bạn sang Vercel hoặc máy khác. Khi khởi động, bản nào mới hơn thắng; máy chủ trống thì bản trên trình duyệt được đẩy lên. Mỗi khóa được ghi đè nguyên khối, nên hai trình duyệt cùng sửa một lúc thì bản sau thắng. Thời điểm sửa trên trình duyệt (đồng hồ máy người dùng) được so trực tiếp với `updated_at` của máy chủ, nên đồng hồ máy lệch nhiều có thể khiến bản cũ thắng khi khởi động. Cấu hình là chung cho mọi người dùng app. Chưa chạy `ui-settings.sql` thì app vẫn chạy và báo "Cấu hình chỉ lưu trên trình duyệt này".

### Thiết lập cột

Thêm, đổi tên, đổi kiểu, đổi thuộc tính, xóa và nhân bản cột (cần `SUPABASE_DB_URL`). Mọi thay đổi đi qua bước xem trước: máy chủ trả số bản ghi bị ảnh hưởng và một chữ ký; bước áp dụng khóa bảng, kiểm tra lại chữ ký và chạy trong một transaction, từ chối nếu cấu trúc hoặc dữ liệu đã đổi.

- **Xóa cột công thức** (`GENERATED ALWAYS AS`): được phép nếu không có phụ thuộc. Máy chủ kiểm tra phụ thuộc PostgreSQL, liên kết và lookup trước khi xác nhận, dùng `DROP COLUMN ... RESTRICT`. Khóa chính và identity luôn được bảo vệ. Phụ thuộc trong mã bên ngoài database cần tự kiểm tra.
- **Nhân bản cột**: tạo cột cùng kiểu PostgreSQL và sao chép toàn bộ giá trị trong một transaction. Cột mới cho phép trống; không sao chép khóa, unique, identity, mặc định hay cấu hình lookup/formula.

### Đồng bộ lookup vào cột có sẵn

Trong **Thiết lập cột** của một cột có sẵn, bật **Đồng bộ từ lookup**, chọn bảng nguồn, trường cần lấy và các điều kiện. Cột cần cho phép trống và có cùng kiểu PostgreSQL với trường được lấy (chế độ đếm trả `bigint`); cột khóa chính, tự sinh hoặc có phụ thuộc không được chọn.

Khi lưu, máy chủ tạo trigger trên cả hai bảng và cập nhật giá trị ban đầu trong cùng transaction. Trigger chạy với quyền của thao tác đang ghi (kể cả ghi trực tiếp qua Supabase); thiếu quyền sẽ báo lỗi. Một ô chỉ nhận một giá trị: nhiều bản ghi cùng khớp thì cần thêm điều kiện hoặc dùng đếm. Tắt đồng bộ thì máy chủ gỡ trigger và để trống cột. Cột đang đồng bộ chỉ đọc trên web.

### Formula

Cột số có thể tính tự động từ các cột số khác bằng công thức (`+ - * /`, phần trăm hậu tố `%`, `ROUND`, `ABS`, `MIN`, `MAX`, tham chiếu cột dạng `[tên_cột]`). Công thức được phân tích thành cây, không chấp nhận SQL hay JavaScript, rồi cài thành trigger `BEFORE INSERT OR UPDATE`.

### Dashboard

Mỗi bảng mở mặc định ở lưới dữ liệu; chế độ Tổng quan (dashboard) hiện khi người dùng chọn. Bảng `promotions` có dashboard riêng.

## Kiến trúc

Supabase là nguồn dữ liệu. Giao diện chỉ gọi API cùng origin; credentials nằm ở máy chủ.

**Máy chủ**

- `server/app.mjs`: bộ xử lý request dùng chung cho bản cục bộ (`server.mjs`, bind `127.0.0.1`) và bản Vercel (`api/handler.mjs` → `server/vercel.mjs`).
- `server/http.mjs`: kiểm tra Host/Origin và token CSRF (`x-siris-token`) cho mọi thao tác ghi; che lỗi Postgres.
- `server/context.mjs`: metadata đang dùng, pool PostgreSQL dùng chung, cache và client Data API.
- `server/routes/*`: `meta`, `table` (đọc, ghi, ghi theo lô, đếm nhóm), `schema` (`/api/admin/schema/preview|apply`), `lookup`, `formula`, `ui-settings`.
- `filters.mjs`: dựng query PostgREST từ bộ lọc, tìm kiếm, sắp xếp đã kiểm tra.
- `server-cache.mjs`: cache cấu hình 60 giây, chỉ bị xóa khi cấu hình hoặc schema thay đổi; ghi dữ liệu không xóa cache.
- `admin.mjs`: đọc metadata thật của schema `public` (lọc theo quyền của `anon`) và thay đổi cột.
- `lookup-sync.mjs`, `lookup-store.mjs`, `formula-sync.mjs`, `formula-parser.mjs`: lookup và formula bằng trigger.
- `ui-settings-store.mjs`: lưu cấu hình giao diện.
- `table-config.mjs`, `table-overview.mjs`, `promotions-overview.mjs`: cấu hình riêng theo bảng và dashboard.

**Giao diện**

- `index.html`, `style.css`, `app.js`. `app.js` chỉ nạp các module trong `src/` và gọi hàm `init*` theo thứ tự cố định.
- `src/state.js`: trạng thái chung. `src/chrome.js` (`syncChrome()`): nơi duy nhất suy ra trạng thái hiện/ẩn/khóa của thanh tiêu đề và thanh công cụ.
- `src/grid/*`: lưới (`render`, `selection`, `cell-edit`, `keyboard`, `column-menu`). Các module khác: sidebar, menu view, form bản ghi, thiết lập cột, lookup, lịch sử hoàn tác, xóa bản ghi, chuyển bảng nhanh.
- `src/storage.js`: mọi khóa `localStorage` (có phiên bản). `src/ui-sync.js` đồng bộ các khóa dùng chung lên máy chủ; `currentTable`, `metadata`, `sidebarCollapsed` chỉ theo từng máy.

## Kiểm thử

```sh
npm run lint
npm run format:check
npm run typecheck
npm test              # tự build giao diện trước (pretest)
npx playwright install chromium
npm run test:e2e
```

- Vitest (`tests/*.test.js`) kiểm tra logic và API. Playwright (`tests/e2e/`) kiểm tra luồng trên trình duyệt với API giả lập, chia theo tính năng; mỗi test dừng sau 15 giây.
- Dùng Chromium có sẵn: `PLAYWRIGHT_CHROMIUM_EXECUTABLE=/đường/dẫn/tới/chrome npm run test:e2e`.
- CI (`.github/workflows/ci.yml`, Ubuntu 24.04): `checks` (lint, typecheck, build, test; Node 22 và 24), `bench-cache` (PostgreSQL 16), `e2e`.
- Kiểm thử tự động dùng dữ liệu giả lập, không thay cho nghiệm thu RLS, Storage, Realtime hay ghi thật. Không ghi lên Supabase thật khi chưa được phê duyệt.

### Đo hiệu năng

`npm run bench` dựng PostgreSQL tạm và Data API giả lập trên loopback, không dùng dữ liệu Supabase. Cần PostgreSQL 16 (`initdb`, `pg_ctl` trong PATH) hoặc:

```sh
SIRIS_BENCH_PG_BIN=/duong/dan/postgresql/bin npm run bench
```

Mặc định giả lập độ trễ Data API 60 ms và mỗi gói PostgreSQL 40 ms; đổi bằng `SIRIS_BENCH_API_MS`, `SIRIS_BENCH_DB_MS`. Cột gói tin là số lần nhận dữ liệu qua proxy, không phải số truy vấn SQL. Chạy cùng cấu hình để so sánh trước và sau.

## Triển khai lên Vercel

`vercel.json` build giao diện rồi chuyển mọi request tới `api/handler.mjs`; function phục vụ `dist/` và API. `public/` để trống để mọi tài nguyên đều qua kiểm tra đăng nhập. Bản Vercel đọc metadata trực tiếp ở mỗi request.

### Biến môi trường

Đặt cho Production và Preview (Project → Settings → Environment Variables):

| Biến | Nội dung |
| --- | --- |
| `SIRIS_LOGIN_USER` | Tên đăng nhập riêng cho ứng dụng |
| `SIRIS_LOGIN_PASSWORD` | Mật khẩu riêng, ít nhất 16 ký tự |
| `SUPABASE_URL`, `SUPABASE_KEY` | Như bản cục bộ |
| `SUPABASE_DB_URL` | Dùng Supabase pooler tương thích mạng Vercel |

Thiếu tài khoản đăng nhập thì ứng dụng trả 503.

### Deploy

```sh
npx vercel link
npx vercel project inspect --non-interactive
npx vercel deploy --prod
```

Deploy không tự thay đổi dữ liệu Supabase.

### Đăng nhập và log

- `/auth/login` nhận tên đăng nhập và mật khẩu. Phiên lưu trong cookie ký HMAC (HttpOnly, Secure, SameSite=Strict) 8 giờ; đổi tên đăng nhập hoặc mật khẩu sẽ vô hiệu mọi phiên cũ. Request ghi vẫn cần cùng nguồn và token CSRF theo phiên. Nút Đăng xuất ở chân thanh bên gọi `POST /auth/logout` để xóa cookie của trình duyệt đó; muốn thu hồi mọi phiên thì đổi mật khẩu.
- Header `Authorization: Basic` (dùng từ CLI) cũng được nhận và tính chung bộ đếm lần sai bên dưới.
- Giới hạn 10 lần sai trong 15 phút theo IP (cả form và Basic; khi bị chặn thì gửi đúng mật khẩu cũng nhận 429), nằm trong bộ nhớ từng instance nên chỉ làm chậm kẻ dò mật khẩu. Cần chặn chắc thì bật rate limit của Vercel Firewall cho `/auth/login`.
- Sự kiện log (JSON một dòng, không ghi mật khẩu): `login_failed`, `login_blocked`, `schema_apply`. Xem bằng `vercel logs <deployment-url>`.
- Thử luồng đăng nhập trên máy: `npm run build` rồi `node scripts/preview-login.mjs`, mở http://127.0.0.1:3002. Đọc tài khoản từ `.env.vercel.local`, chỉ nghe loopback, không bật cookie Secure; bị vô hiệu trên Vercel.

## Kế hoạch

| File | Nội dung | Trạng thái |
| --- | --- | --- |
| [`plan/sua-loi-o-json-bao-mat-va-khoa-bang.md`](plan/sua-loi-o-json-bao-mat-va-khoa-bang.md) | Lỗi và điểm yếu tìm được khi đánh giá 13/11/2026 | Xong |
| [`plan/trien-khai-tong-the.md`](plan/trien-khai-tong-the.md) | Kế hoạch tổng thể (tốc độ, Vercel, CI) và số đo | Còn đo trên Vercel (G), H4 chờ quyết định |
| [`plan/giao-dien-keo-tha-va-luu-cau-hinh.md`](plan/giao-dien-keo-tha-va-luu-cau-hinh.md) | Kéo thả, bố trí nút, lưu cấu hình giao diện | Xong (PR #4) |
| [`plan/sua-loi-treo-dang-tai-du-lieu.md`](plan/sua-loi-treo-dang-tai-du-lieu.md) | Bảng đứng ở "Đang tải dữ liệu" vì lưu cấu hình giao diện làm bỏ kết quả tải | Chưa làm, làm trước |
| [`plan/toc-do-tai-bang-tren-vercel.md`](plan/toc-do-tai-bang-tren-vercel.md) | Tải bảng chậm trên Vercel (function ở `iad1`, database ở Seoul) | Chưa làm |
| [`plan/do-hieu-nang-tren-vercel.md`](plan/do-hieu-nang-tren-vercel.md) | Đo định kỳ trên Vercel: `Server-Timing`, script đo, ngưỡng, bảng kết quả | Chưa làm |
| [`plan/tach-ma-giao-dien.md`](plan/tach-ma-giao-dien.md) | Tách dần mã giao diện: trạng thái toàn cục, import vòng, thứ tự `init*`, file lớn | Chưa làm, làm dần |

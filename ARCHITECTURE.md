# Kiến trúc Siris

## Nguyên tắc

Ứng dụng chạy cục bộ và Supabase là nguồn dữ liệu. Giao diện chỉ gọi API cùng origin; máy chủ Node bind vào 127.0.0.1, kiểm tra Host/Origin và token CSRF cho mọi thao tác ghi, và giữ credentials trong `.env.local`. Không đưa database credentials, secret key hoặc management token vào trình duyệt.

## Thành phần

- **Giao diện**: `index.html`, `style.css` và `app.js`. Trạng thái hiện/ẩn/khóa của thanh tiêu đề và thanh công cụ chỉ được suy ra ở `src/chrome.js` (`syncChrome()`). `app.js` chỉ nạp các module trong `src/` và gọi hàm `init*` của chúng theo thứ tự cố định. `src/state.js` giữ trạng thái chung; các module khác chia theo chức năng: lưới (`src/grid/render.js`, `selection.js`, `cell-edit.js`, `keyboard.js`, `column-menu.js`), sidebar, menu lọc/nhóm/sắp xếp, form bản ghi, thiết lập cột, lookup, lịch sử hoàn tác, xóa bản ghi, hộp thoại xác nhận và chuyển bảng nhanh. Mọi khóa `localStorage` được gom ở `src/storage.js` (có phiên bản). Cấu hình hiển thị (view, cỡ trang, thư mục và tên hiển thị trong sidebar, chế độ Tổng quan/Bảng dữ liệu) lưu trong `localStorage` theo bảng.
- **Cấu hình theo bảng** (`table-config.mjs`): nhãn, cấu hình Tổng quan và gợi ý trường riêng cho từng bảng cụ thể.
- **Dashboard chỉ xem** (`table-overview.mjs`, `promotions-overview.mjs`): đọc toàn bộ bảng qua API bảng, không ghi dữ liệu. Mỗi bảng mở mặc định ở lưới dữ liệu; Dashboard chỉ hiện khi người dùng chọn.
- **Máy chủ** (`server.mjs`, `server/`): phần xử lý request nằm ở `server/app.mjs`; `server.mjs` chạy nó trên loopback. `server/config.mjs` đọc cấu hình, `server/http.mjs` kiểm tra Host/Origin/CSRF và che lỗi Postgres, `server/context.mjs` giữ metadata, cache và client Data API, `server/routes/*` xử lý từng nhóm API, `server/static.mjs` phục vụ bản build. Dữ liệu đi qua Data API của Supabase bằng key đã cấu hình, nên chịu quyền và RLS của key đó. Bộ lọc được kiểm tra ở `filters.mjs`; cache cấu hình ở `server-cache.mjs` chỉ bị xóa khi cấu hình hoặc schema thay đổi.
- **Bản online** (`api/handler.mjs`, `server/vercel.mjs`, `vercel.json`): function Vercel dùng chung `server/app.mjs` với bản cục bộ, dùng phiên đăng nhập ký trong cookie thay cho token cố định, và đọc metadata trực tiếp mỗi request. `vercel.json` build giao diện rồi chuyển mọi request tới function; không còn bước sao chép hay biến đổi mã cho edge/Sites.
- **Quản trị cấu trúc** (`admin.mjs`, cần `SUPABASE_DB_URL`): discovery metadata thật của schema `public`; thay đổi cột qua `/api/admin/schema/preview` rồi `/api/admin/schema/apply`. Bước apply kiểm tra chữ ký của bản xem trước, chạy trong transaction và từ chối nếu cấu trúc hoặc dữ liệu đã đổi.
- **Lookup đồng bộ** (`lookup-sync.mjs`, `lookup-store.mjs`) và **formula** (`formula-sync.mjs`, `formula-parser.mjs`): cấu hình lưu trong schema `siris_admin`; giá trị được ghi vào cột Supabase có sẵn bằng trigger. Formula chỉ nhận cú pháp đã phân tích, không chấp nhận SQL hay JavaScript tùy ý.

Khi không có `SUPABASE_DB_URL`, metadata lấy từ `schema.json` và các chức năng quản trị, lookup đồng bộ, formula bị khóa. Bảng không có khóa chính ở chế độ chỉ đọc.

## Kiểm tra

Vitest kiểm tra logic và API; Playwright kiểm tra các luồng trên trình duyệt với API giả lập, chia theo tính năng trong `tests/e2e/` (`cell-edit`, `columns`, `grid`, `lookup`, `records`, `relations`, `perf`, ...). `npm run bench` chạy `scripts/bench.mjs` đo tốc độ mô phỏng (chưa đo trên Vercel). CI (`.github/workflows/ci.yml`) có ba job: `checks` (lint, typecheck, build, test; Node 22 và 24), `bench-cache` (test cache với PostgreSQL 16) và `e2e` (Playwright). Kết quả mock không được xem là nghiệm thu RLS, Storage, Realtime hay thao tác ghi thực tế. Không áp dụng migrations lên production trong quá trình thử.

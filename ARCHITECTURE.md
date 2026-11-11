# Kiến trúc Siris

## Nguyên tắc

Ứng dụng chạy cục bộ và Supabase là nguồn dữ liệu. Giao diện chỉ gọi API cùng origin; máy chủ Node bind vào 127.0.0.1, kiểm tra Host/Origin và token CSRF cho mọi thao tác ghi, và giữ credentials trong `.env.local`. Không đưa database credentials, secret key hoặc management token vào trình duyệt.

## Thành phần

- **Giao diện** (`index.html`, `app.js`, `style.css`): lưới dữ liệu với sửa ô, sửa và dán hàng loạt, hoàn tác/làm lại trong phiên, chọn và xóa bản ghi, lọc, nhóm, sắp xếp, ẩn, ghim và sắp lại cột. Cấu hình hiển thị (view, thư mục sidebar, chế độ Dashboard/Bảng dữ liệu) lưu trong `localStorage` theo bảng.
- **Dashboard chỉ xem** (`table-overview.mjs`, `promotions-overview.mjs`): đọc toàn bộ bảng qua API bảng, không ghi dữ liệu. Mỗi bảng mở mặc định ở lưới dữ liệu; Dashboard chỉ hiện khi người dùng chọn.
- **Máy chủ** (`server.mjs`): đọc/ghi dữ liệu qua Data API của Supabase bằng key đã cấu hình, nên chịu quyền và RLS của key đó. Bộ lọc được kiểm tra ở `filters.mjs`.
- **Quản trị cấu trúc** (`admin.mjs`, cần `SUPABASE_DB_URL`): discovery metadata thật của schema `public`; thay đổi cột qua `/api/admin/schema/preview` rồi `/api/admin/schema/apply`. Bước apply kiểm tra chữ ký của bản xem trước, chạy trong transaction và từ chối nếu cấu trúc hoặc dữ liệu đã đổi.
- **Lookup đồng bộ** (`lookup-sync.mjs`, `lookup-store.mjs`) và **formula** (`formula-sync.mjs`, `formula-parser.mjs`): cấu hình lưu trong schema `siris_admin`; giá trị được ghi vào cột Supabase có sẵn bằng trigger. Formula chỉ nhận cú pháp đã phân tích, không chấp nhận SQL hay JavaScript tùy ý.

Khi không có `SUPABASE_DB_URL`, metadata lấy từ `schema.json` và các chức năng quản trị, lookup đồng bộ, formula bị khóa. Bảng không có khóa chính ở chế độ chỉ đọc.

## Kiểm tra

Vitest kiểm tra logic và API; Playwright kiểm tra các luồng trên trình duyệt với API giả lập. Kết quả mock không được xem là nghiệm thu RLS, Storage, Realtime hay thao tác ghi thực tế. Không áp dụng migrations lên production trong quá trình thử.

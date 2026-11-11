# Siris — Quản lý dữ liệu cục bộ

Ứng dụng quản lý dữ liệu Supabase chạy cục bộ: xem và sửa bảng, thiết lập cột, đồng bộ lookup, formula và dashboard chỉ xem. Chỉ dùng trên máy cá nhân. Các bước cải thiện tiếp theo được ghi trong `IMPLEMENTATION_PLAN.md`.

## Chạy ứng dụng

Cần Node.js 20.19+ hoặc 22.12+ (Vite 7), sau đó:

```sh
npm install
cp .env.example .env.local
```

Điền `SUPABASE_URL` và khóa publishable/anon trong `.env.local`. Tệp này chỉ được máy chủ đọc và đã được loại khỏi Git. Nếu cần discovery trực tiếp, thêm `SUPABASE_DB_URL` với quyền phù hợp ở máy chủ. Không đưa service role key, database password hoặc access token vào mã nguồn hay trình duyệt.

Chạy `npm run dev` rồi mở http://localhost:3000. Khi dùng `npm start`, chạy `npm run build` trước để máy chủ phục vụ giao diện đã build. Ứng dụng kết nối trực tiếp bằng URL và key đã cấu hình ở máy chủ; quyền truy cập dữ liệu phụ thuộc vào key và các chính sách Supabase tương ứng.

Thiết lập cột (thêm, đổi tên, đổi kiểu, xóa, nhân bản), đồng bộ lookup và formula cần `SUPABASE_DB_URL` trỏ đúng dự án Supabase đang dùng. Nếu thiếu kết nối PostgreSQL, các chức năng này bị khóa và metadata dùng bản `schema.json` đã lưu, có thể không phản ánh các thay đổi gần đây.

## Kiểm tra

```sh
npm run lint
npm run typecheck
npm test
npm run build
npx playwright install chromium
npm run test:e2e
```

Nếu máy đã có sẵn Chromium, bỏ bước `npx playwright install` và trỏ Playwright tới nó:

```sh
PLAYWRIGHT_CHROMIUM_EXECUTABLE=/đường/dẫn/tới/chrome npm run test:e2e
```

Mỗi test e2e dừng sau 15 giây để không treo cả bộ test.

Các kiểm thử tự động dùng API giả lập; không thay thế nghiệm thu thực tế RLS, Storage, Realtime hoặc thao tác ghi. Chỉ kiểm tra đọc trên Supabase Cloud hiện tại khi chưa có phê duyệt thay đổi dữ liệu.

## Sửa nhiều ô

Chọn các ô cùng cột trực tiếp trên bảng bằng Shift và nhấp ô đầu, ô cuối; nhập giá trị rồi bấm **Áp dụng**. Có thể dán dữ liệu vào ô đang được chọn bằng bàn phím. Mỗi dòng được lưu riêng, và lỗi được báo theo dòng. Hoàn tác/làm lại chỉ hỗ trợ sửa từng ô trong phiên. Cấu hình hiển thị được lưu riêng cho từng bảng trên trình duyệt.

## Đồng bộ lookup vào cột có sẵn

Trong **Thiết lập cột** của cột Supabase có sẵn, bật **Đồng bộ từ lookup** rồi cấu hình bảng nguồn, trường cần lấy và các điều kiện ngay bên trong. Cấu hình gắn trực tiếp với cột này, không tạo cột lookup trung gian. Cột cần cho phép trống và có kiểu PostgreSQL giống trường được lấy (bao gồm độ chính xác, mảng và enum); chế độ đếm trả về `bigint`. Cột khóa chính, tự sinh hoặc có phụ thuộc không được chọn.

Khi lưu, giao diện hiển thị số bản ghi bị ảnh hưởng để xác nhận; máy chủ kiểm tra lại và thực hiện cấu hình, trigger và cập nhật ban đầu trong cùng transaction. Trigger cập nhật cột khi bản ghi nguồn hoặc điều kiện thay đổi, kể cả thay đổi qua Supabase. Một ô chỉ nhận một giá trị; nếu nhiều bản ghi cùng khớp, cần thêm điều kiện hoặc chọn đếm. Khi tắt toggle và lưu, máy chủ gỡ trigger và để trống toàn bộ cột đó. Cột đang đồng bộ chỉ đọc trên web.

Chức năng dùng kết nối `SUPABASE_DB_URL` và nơi lưu `siris_admin.lookup_configs` hiện có. Không cần Docker hay dịch vụ đồng bộ riêng. SQL chạy với quyền của thao tác đang thay đổi bản ghi; thiếu quyền sẽ báo lỗi. Kiểm thử tự động của luồng này dùng dữ liệu và kết nối giả lập.

## Nhân bản cột

Mở **Thiết lập cột → Nhân bản cột**, nhập tên mới rồi bấm **Nhân bản**. Máy chủ tạo cột cùng kiểu PostgreSQL và sao chép toàn bộ giá trị hiện có trong một transaction. Cột mới cho phép trống và sửa tay; không sao chép khóa, unique, identity, giá trị mặc định hoặc cấu hình lookup/formula. Nếu sao chép lỗi, cột mới được rollback và hộp nhập giữ tên để thử lại.

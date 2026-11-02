# Siris — Quản lý dữ liệu cục bộ

Ứng dụng đang được chuyển từng phase theo `CODEX_LOCAL_SUPABASE_MANAGER.md`; trạng thái và phạm vi còn thiếu được ghi trong `IMPLEMENTATION_PLAN.md`. Chỉ dùng trên máy cá nhân.

## Chạy ứng dụng

Cần Node.js 20.19+ hoặc 22.12+ (Vite 7), sau đó:

```sh
npm install
cp .env.example .env.local
```

Điền `SUPABASE_URL` và khóa publishable/anon trong `.env.local`. Tệp này chỉ được máy chủ đọc và đã được loại khỏi Git. Nếu cần discovery trực tiếp, thêm `SUPABASE_DB_URL` với quyền phù hợp ở máy chủ. Không đưa service role key, database password hoặc access token vào mã nguồn hay trình duyệt.

Chạy `npm run dev` rồi mở http://localhost:3000. Khi dùng `npm start`, chạy `npm run build` trước để máy chủ phục vụ giao diện đã build. Ứng dụng kết nối trực tiếp bằng URL và key đã cấu hình ở máy chủ; quyền truy cập dữ liệu phụ thuộc vào key và các chính sách Supabase tương ứng.

Các API quản trị cấu trúc và quan hệ đang tạm khóa trong khi hoàn thiện kiểm tra quyền. Nếu thiếu kết nối PostgreSQL, metadata dùng bản `schema.json` đã lưu, có thể không phản ánh các thay đổi gần đây.

## Kiểm tra

```sh
npm run lint
npm run typecheck
npm test
npm run build
npx playwright install chromium
npm run test:e2e
```

Các kiểm thử tự động dùng API giả lập; không thay thế nghiệm thu thực tế RLS, Storage, Realtime hoặc thao tác ghi. Chỉ kiểm tra đọc trên Supabase Cloud hiện tại khi chưa có phê duyệt thay đổi dữ liệu.

## Các tính năng đang chuyển đổi

Chọn các ô cùng cột trực tiếp trên bảng bằng Shift và nhấp ô đầu, ô cuối; nhập giá trị rồi bấm **Áp dụng**. Có thể dán dữ liệu vào ô đang được chọn bằng bàn phím. Mỗi dòng được lưu riêng, và lỗi được báo theo dòng. Hoàn tác/làm lại chỉ hỗ trợ sửa từng ô trong phiên. Cấu hình hiển thị được lưu riêng cho từng bảng trên trình duyệt.

## Đồng bộ lookup vào cột có sẵn

Trong **Thiết lập cột** của cột Supabase có sẵn, bật **Đồng bộ từ lookup** rồi cấu hình bảng nguồn, trường cần lấy và các điều kiện ngay bên trong. Cấu hình gắn trực tiếp với cột này, không tạo cột lookup trung gian. Cột cần cho phép trống và có kiểu PostgreSQL giống trường được lấy (bao gồm độ chính xác, mảng và enum); chế độ đếm trả về `bigint`. Cột khóa chính, tự sinh hoặc có phụ thuộc không được chọn.

Khi lưu, giao diện hiển thị số bản ghi bị ảnh hưởng để xác nhận; máy chủ kiểm tra lại và thực hiện cấu hình, trigger và cập nhật ban đầu trong cùng transaction. Trigger cập nhật cột khi bản ghi nguồn hoặc điều kiện thay đổi, kể cả thay đổi qua Supabase. Một ô chỉ nhận một giá trị; nếu nhiều bản ghi cùng khớp, cần thêm điều kiện hoặc chọn đếm. Khi tắt toggle và lưu, máy chủ gỡ trigger và để trống toàn bộ cột đó. Cột đang đồng bộ chỉ đọc trên web.

Chức năng dùng kết nối `SUPABASE_DB_URL` và nơi lưu `siris_admin.lookup_configs` hiện có. Không cần Docker hay dịch vụ đồng bộ riêng. SQL chạy với quyền của thao tác đang thay đổi bản ghi; thiếu quyền sẽ báo lỗi. Kiểm thử tự động của luồng này dùng dữ liệu và kết nối giả lập.

## Nhân bản bản ghi

Mở chi tiết bản ghi rồi bấm **Nhân bản**, hoặc bấm dấu `⋯` cạnh số thứ tự trên bảng để nhân bản nhanh. Nếu dữ liệu đủ để thêm ngay, ứng dụng sao chép nguyên các cột được phép nhập và gọi API thêm bản ghi hiện có; khóa chính tự sinh, cột generated, formula, lookup đồng bộ và thời điểm tạo có default thời gian hiện tại để database tự tạo hoặc tính lại. Các trường nghiệp vụ như giá, ngày áp dụng, trạng thái và liên kết vẫn giữ giá trị nguồn kể cả khi cột có default.

Chỉ trường thuộc ràng buộc unique mới được đổi giá trị. Trường văn bản bị trùng được thêm ` copy`, sau đó ` copy 2`, ` copy 3`…; với unique nhiều cột, chỉ một trường văn bản được đổi để tổ hợp mới không trùng, các trường còn lại và khóa ngoại được giữ nguyên. `name` không unique vẫn giữ nguyên tên. Nếu trường unique có kiểu hoặc định dạng không thể tự tạo giá trị hợp lệ (số, ngày, enum, UUID, email, URL, liên kết…), form mở lại với dữ liệu đã sao chép và đánh dấu trường cần sửa.

Trước khi ghi, ứng dụng kiểm tra trùng trên toàn bảng và vẫn để database xác nhận ràng buộc khi lưu. Nếu khóa chính phải nhập tay hoặc lỗi unique từ database, form bản ghi mở lại với dữ liệu đã sao chép. Lỗi mạng giữ nguyên bản nháp và báo rõ; ứng dụng không tự thử lại thao tác ghi. Nút bị khóa trong lúc gửi để tránh tạo dòng trùng. Khi thành công, bảng được làm mới ngầm theo lọc và sắp xếp hiện tại, giữ vị trí cuộn và không tải lại trang.

## Nhân bản cột

Mở **Thiết lập cột → Nhân bản cột**, nhập tên mới rồi bấm **Nhân bản**. Máy chủ tạo cột cùng kiểu PostgreSQL và sao chép toàn bộ giá trị hiện có trong một transaction. Cột mới cho phép trống và sửa tay; không sao chép khóa, unique, identity, giá trị mặc định hoặc cấu hình lookup/formula. Nếu sao chép lỗi, cột mới được rollback và hộp nhập giữ tên để thử lại.

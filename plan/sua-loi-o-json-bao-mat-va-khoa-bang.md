# Sửa lỗi ô JSON, giới hạn đăng nhập Basic và khóa bảng khi đổi cột

Nguồn: đánh giá toàn dự án ngày 13/11/2026.

**Trạng thái:** chưa làm.

Đánh giá toàn bộ dự án trên `main` (`45d5746`): lint, typecheck, 95 unit test và 117 e2e đều đạt, CI xanh. Các việc dưới đây xếp theo mức ưu tiên. Mỗi việc một commit, kèm test.

## 1. Sửa ô JSON/mảng trên lưới luôn thất bại (lỗi, cao)

- Nguyên nhân: khi lưu ô, trình duyệt gửi `expected: { [cột]: giá trị cũ }` để chống ghi đè (`src/history.js` `commitCell`, sửa hàng loạt ở `src/grid/selection.js`). Với cột `json`, `jsonb` hoặc mảng, giá trị cũ là object.
- Máy chủ (`server/routes/table.mjs`, `writeTable`) chỉ nhận chuỗi, số, boolean hoặc `null` trong `expected`, nên trả "Điều kiện cập nhật không hợp lệ" và không gửi gì lên Supabase. Chỉ ô đang trống sửa được. Form sửa bản ghi không gửi `expected` nên không bị.
- Việc: phía trình duyệt bỏ cột không phải giá trị đơn khỏi `expected` (cả `commitCell`, `changeHistory` và sửa hàng loạt). Không nới kiểm tra ở máy chủ.
- Kiểm: unit test cho `writeTable` với cột `jsonb`; e2e sửa một ô JSON đã có giá trị và lưu được.

## 2. Đăng nhập Basic trên Vercel không bị giới hạn thử (bảo mật, trung bình)

- `server/session-auth.mjs` `authenticated()` nhận header `Authorization: Basic` ở mọi request; bộ đếm 10 lần sai chỉ áp cho `POST /auth/login`. Có thể dò mật khẩu qua Basic mà không bị chặn.
- Việc (đề xuất): bỏ Basic nếu không cần truy cập từ CLI; nếu cần, đếm lần sai của Basic bằng cùng `createLoginThrottle`.
- Kiểm: `tests/vercel.test.js` thêm trường hợp Basic sai nhiều lần.

## 3. Đổi cột có thể chặn cả bảng (vận hành, trung bình)

- `admin.mjs` `apply()` lấy `LOCK TABLE ... ACCESS EXCLUSIVE` nhưng chỉ đặt `lock_timeout`/`statement_timeout` cho thao tác nhân bản cột. Nếu có transaction dài đang chạy, lệnh chờ vô hạn và mọi lệnh đọc bảng đó xếp hàng sau nó.
- Việc: đặt `SET LOCAL lock_timeout = '5s'` và `statement_timeout = '60s'` cho mọi thao tác; ánh xạ lỗi `55P03` thành thông báo "Bảng đang được sử dụng; vui lòng thử lại."
- Kiểm: unit test trong `tests/admin-schema.test.js` kiểm tra hai lệnh `SET LOCAL` chạy trước `LOCK TABLE` với mọi `action`.

## 4. Đồng bộ cấu hình giao diện có thể mất thay đổi (thiết kế, thấp)

- Mỗi khóa (`views`, `tableFolders`…) được ghi đè nguyên khối, bản sau thắng; hai trình duyệt sửa hai view khác nhau thì một bên mất. Thời điểm local (`Date.now()`) được so trực tiếp với `updated_at` của máy chủ nên lệch đồng hồ có thể chọn sai bản.
- `promotionsDisplay` nằm trong danh sách khóa của máy chủ (`ui-settings-store.mjs`) nhưng thiếu trong `syncedKeys` (`src/storage.js`), nên không được đồng bộ.
- Việc: thêm `promotionsDisplay` vào `syncedKeys`; ghi giới hạn "bản ghi sau thắng" vào README. Chỉ làm gộp theo từng mục nếu có nhiều người dùng thật.

## 5. Việc nhỏ

- Không có đăng xuất: thêm `POST /auth/logout` xóa cookie trên Vercel (thu hồi hẳn vẫn cần đổi mật khẩu).
- `src/api.js` gọi thẳng `r.json()`; khi Vercel trả trang lỗi HTML (504) người dùng thấy lỗi parse. Đọc text, parse an toàn, báo "Máy chủ trả về lỗi {status}".
- `npm run format:check` lỗi ở 5 file (`filters.mjs`, `scripts/bench.mjs`, `src/lookup.js`, `tests/bench-cache.test.js`, `tests/e2e/paging.spec.ts`) và CI không chạy bước này. Chạy `npm run format` trong một commit riêng rồi thêm `npm run format:check` vào job `checks`.

## Không làm lúc này

- Tách tiếp frontend (`state` toàn cục, thứ tự `init*`, `column-dialog.js`, `render.js`, `style.css` lớn): làm dần khi sửa các file đó.

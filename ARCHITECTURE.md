# Kiến trúc Local Supabase Database Manager

## Nguyên tắc

Ứng dụng chạy cục bộ và Supabase là nguồn dữ liệu. Giao diện sử dụng các API cùng origin; máy chủ bind vào 127.0.0.1 và giữ credentials server-side trong `.env.local`. Không đưa database credentials, secret key hoặc management token vào trình duyệt.

## Hướng tích hợp

- Giao diện bảng hiện tại hỗ trợ sửa ô và sửa hàng loạt trực tiếp; các cấu hình hiển thị được lưu cục bộ theo bảng.
- Máy chủ Node chạy trên loopback, giới hạn origin và giữ key phía máy chủ. Các thao tác dữ liệu đi qua Data API với key được cấu hình và chịu quyền, RLS tương ứng với key đó. API quản trị cấu trúc đang khóa.
- Discovery đọc metadata thực của các schema được phép. Thông tin schema phải làm mới sau thay đổi; bảng không có khóa định danh an toàn ở chế độ chỉ đọc.
- Views và cấu hình field ảo lưu ở metadata tables có chính sách quyền riêng. Lookup, rollup và formula phải tuân theo quyền của key đã cấu hình; không chấp nhận SQL hay JavaScript tùy ý.
- Thay đổi schema cần preview, xác nhận theo thao tác, kiểm tra phụ thuộc, transaction và audit. Không áp dụng migrations lên production trong quá trình thử.

## Kiểm tra

Vitest kiểm tra logic và API; Playwright kiểm tra các luồng trên trình duyệt. Dùng mock cho kiểm thử ghi và chỉ đọc Supabase Cloud hiện tại khi kiểm tra tích hợp. Kết quả mock không được xem là nghiệm thu RLS, Storage, Realtime hay thao tác ghi thực tế.

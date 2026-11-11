# Triển khai Siris lên Vercel

Bản Vercel dùng cùng backend với bản local. Không cần triển khai Sites hoặc Supabase Edge Function.

`vercel.json` build giao diện bằng Vite rồi chuyển toàn bộ request tới `api/handler.mjs`. Function phục vụ giao diện từ `dist/` và xử lý API. `public/` để trống để các tài nguyên luôn đi qua kiểm tra đăng nhập.

## Cấu hình máy chủ

Trong Vercel Project → Settings → Environment Variables, đặt các biến cho Production và Preview:

| Biến | Nội dung |
| --- | --- |
| `SIRIS_LOGIN_USER` | Tên đăng nhập riêng cho ứng dụng |
| `SIRIS_LOGIN_PASSWORD` | Mật khẩu riêng, ít nhất 16 ký tự |
| `SUPABASE_URL` | URL dự án Supabase hiện tại |
| `SUPABASE_KEY` | Publishable/anon key hiện tại |
| `SUPABASE_DB_URL` | Kết nối PostgreSQL để quản lý cột, lookup và formula; dùng Supabase pooler tương thích mạng Vercel |

Giữ các giá trị này ở máy chủ, không thêm tiền tố `VITE_`. Không đưa `.env.local` lên Git hoặc gửi mật khẩu qua chat. Nếu thiếu tài khoản đăng nhập, ứng dụng trả về 503; thiếu kết nối PostgreSQL thì các chức năng quản trị cấu trúc không khả dụng.

## Triển khai

Sau khi đăng nhập Vercel, liên kết đúng dự án trong thư mục repo:

```sh
npx vercel link
npx vercel project inspect --non-interactive
npx vercel deploy --prod
```

Trình duyệt hỏi tên đăng nhập và mật khẩu khi mở trang. Toàn bộ giao diện, tài nguyên và API đều được bảo vệ; request ghi vẫn cần cùng nguồn và token phiên. Không có thao tác thay đổi dữ liệu Supabase tự động khi deploy.

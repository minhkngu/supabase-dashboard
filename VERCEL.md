# Triển khai Siris lên Vercel

Bản Vercel dùng cùng backend với bản local; chỉ cần deploy một function Vercel.

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

Trang `/auth/login` nhận tên đăng nhập và mật khẩu, báo rõ khi không đúng. Sau khi đăng nhập thành công, phiên được lưu trong cookie HttpOnly, Secure, SameSite=Strict trong 8 giờ; thay tên đăng nhập hoặc mật khẩu sẽ vô hiệu các phiên cũ. Không dùng hộp hỏi mật khẩu của trình duyệt. Toàn bộ giao diện, tài nguyên và API đều được bảo vệ; request ghi vẫn cần cùng nguồn và token phiên. Không có thao tác thay đổi dữ liệu Supabase tự động khi deploy.

Để thử luồng đăng nhập trên máy, chạy `npm run build` rồi `node scripts/preview-login.mjs`, mở `http://127.0.0.1:3002`. Bản thử chỉ lắng nghe loopback, đọc tài khoản từ `.env.vercel.local` và không bật cookie Secure trên HTTP local. Chế độ này bị vô hiệu trên môi trường Vercel.

## Đăng nhập và log

- Giới hạn đăng nhập sai: 10 lần sai trong 15 phút theo IP (`createLoginThrottle` trong `server/vercel.mjs`). Bộ đếm nằm trong bộ nhớ từng instance nên chỉ làm chậm kẻ dò mật khẩu, không chặn hẳn. Cần chặn chắc thì bật rate limit của Vercel Firewall cho `/auth/login`.
- Sự kiện log (JSON một dòng, không ghi mật khẩu): `login_failed` (đăng nhập sai), `login_blocked` (vượt ngưỡng), `schema_apply` (áp dụng thay đổi cấu trúc). Xem bằng `vercel logs <deployment-url>` hoặc trang Logs của dự án.
- Định dạng cookie phiên đã đổi: sau lần deploy đầu tiên, mọi phiên đăng nhập cũ mất hiệu lực và phải đăng nhập lại.

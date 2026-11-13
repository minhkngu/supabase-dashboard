# Đo hiệu năng định kỳ trên Vercel

**Trạng thái:** đã bật `Server-Timing` cho Preview, bổ sung ba mục thời gian và script đo; bản preview đã triển khai và đăng nhập. Header của một request chưa đăng nhập xác nhận function `icn1`; đã thử chạy phép đo trong Chrome sau khi người dùng cho phép dán, nhưng thao tác Console không thành công do cửa sổ đổi và chưa thu được kết quả. Còn đo đầy đủ khi đã đăng nhập và ghi kết quả.

Mục tiêu: có số thật trên Vercel (không chỉ mô phỏng bằng `npm run bench`), đo cùng một cách mỗi lần để so trước/sau, và biết khi nào chậm đi.

## Hiện trạng

- `SIRIS_PERF_TIMING=1` bật header `Server-Timing: app;dur=…` (`server/http.mjs`), nhưng chưa đặt cho Preview hay Production.
- `scripts/measure-console.js` đo `/api/meta` và một bảng (5 lần, trung vị), phải dán tay vào Console và đổi tên bảng.
- Không đọc vùng chạy function; lần đo 13/11/2026 phải tự đọc `x-vercel-id` mới biết function chạy ở `iad1`.
- Log runtime gói Hobby chỉ giữ 1 giờ.
- `plan/trien-khai-tong-the.md` mục 9.1 có số mô phỏng; giai đoạn G (đo trên Vercel) chưa làm.

## Số mốc (13/11/2026, preview `main` `49031bd`, function `iad1`, từ Việt Nam)

| Request | Thời gian |
|---|---:|
| API không tồn tại (mức sàn) | 304–363 ms |
| `/api/meta` (cache) | 293–322 ms |
| `/api/ui-settings` | khoảng 660 ms |
| `/api/table/<bảng>` 50 dòng, có đếm | 557–1.743 ms |
| `/api/table/<bảng>` 50 dòng, `count=none` | 571–1.102 ms |

## Ngưỡng chấp nhận (sau khi function ở `icn1`)

Trung vị 5 lần, đo từ Việt Nam, instance đã ấm:

| Request | Ngưỡng |
|---|---:|
| Mức sàn | ≤ 150 ms |
| `/api/meta` (cache) | ≤ 200 ms |
| `/api/table/<bảng>` 50 dòng | ≤ 400 ms |
| `Server-Timing` của `/api/table` | ≤ 150 ms |
| Lần đầu ở instance mới (bất kỳ request) | ≤ 1.500 ms |

Ngưỡng là đề xuất; chỉnh lại sau lần đo đầu tiên với `icn1`.

## Việc cần làm

### 1. Bật `Server-Timing` cho Preview

- Thêm `SIRIS_PERF_TIMING=1` cho môi trường Preview trên Vercel (không bật cho Production). Header chỉ chứa thời gian xử lý, không có dữ liệu.
- Mở rộng `Server-Timing` trong `server/http.mjs` thành nhiều mục: `meta` (chờ metadata), `upstream` (gọi Data API), `app` (tổng). Đo bằng `process.hrtime.bigint()` quanh `cachedMetadata()` và `upstream()` trong `server/context.mjs`.
- Kiểm: unit test kiểm header có ba mục khi bật, không có header khi tắt.

### 2. Script đo một lệnh

- Viết lại `scripts/measure-console.js` thành script chạy trong trang đã đăng nhập (dán vào Console hoặc chạy qua công cụ trình duyệt), không cần sửa tay:
  - Lấy danh sách bảng từ `/api/meta`; đo mức sàn (`/api/khong-co`), `/api/meta`, `formula-config`, `lookup-config`, `ui-settings`, và 3 bảng đầu (có đếm, `count=none`), mỗi request 5 lần.
  - In bảng: trung vị, min/max, các mục `Server-Timing`, vùng function (phần thứ hai của `x-vercel-id`).
  - So với bảng ngưỡng ở trên, đánh dấu dòng vượt ngưỡng.
- Chỉ dùng GET; ghi rõ điều này ở đầu script.

### 3. Lần đo đầu và ghi kết quả

- Sau khi `vercel.json` có `regions: ["icn1"]`: deploy preview, đợi 15 phút cho nguội, đo một lần lạnh và một lần ấm.
- Ghi vào mục "Kết quả" của file này: ngày, commit, vùng, bảng số. Cập nhật giai đoạn G trong `plan/trien-khai-tong-the.md` trỏ về đây.

### 4. Đo định kỳ

- Đo lại khi: đổi vùng hoặc gói Vercel, đổi cách đọc metadata/cache, thêm route nặng, hoặc người dùng báo chậm.
- Mỗi lần thêm một dòng vào bảng kết quả; nếu vượt ngưỡng thì mở plan sửa riêng.
- Cân nhắc sau: dùng Vercel Speed Insights hoặc Observability để có số từ người dùng thật thay vì đo tay.

## Kết quả

| Ngày | Commit | Vùng | Mức sàn | `/api/meta` | Bảng 50 dòng | Ghi chú |
|---|---|---|---:|---:|---:|---|
| 13/11/2026 | `49031bd` | `iad1` | 304–363 ms | 293–322 ms | 557–1.743 ms | Số mốc, chưa có `Server-Timing` |

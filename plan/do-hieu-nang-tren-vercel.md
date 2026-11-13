# Đo hiệu năng định kỳ trên Vercel

**Trạng thái:** bước 1–3 xong. Lần đo đầu với `icn1` (13/11/2026, preview `b60e27d`, đã đăng nhập) đạt mọi ngưỡng đo được, trừ `Server-Timing` của `branches` có đếm (151 ms, vượt 1 ms). Còn đo ngưỡng "lần đầu ở instance mới" (cần đợi instance nguội khoảng 15 phút) và bước 4 (đo định kỳ).

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
| 13/11/2026 | `b60e27d` | `icn1` | 129 ms | 135 ms | 154–317 ms | Trung vị 5 lần, instance ấm; chi tiết bên dưới |

### Chi tiết lần đo 13/11/2026 (`b60e27d`, `icn1`)

Đo trong trang đã đăng nhập, chỉ request GET, mỗi request 5 lần liên tiếp; mọi response có `x-vercel-id: hkg1::icn1::…`. Cột `Server-Timing` là trung vị các mục `app` / `upstream` (`meta` luôn khoảng 0,01 ms: metadata lấy từ cache).

| Request | Trung vị | Các lần (ms) | `app` / `upstream` (ms) |
|---|---:|---|---:|
| Mức sàn (`/api/khong-co`) | 129 ms | 221, 128, 128, 129, 138 | 0,15 / 0 |
| `/api/meta` | 135 ms | 134, 124, 135, 135, 147 | 0,12 / 0 |
| `/api/formula-config` | 148 ms | 166, 203, 140, 148, 140 | 0,14 / 0 |
| `/api/lookup-config` | 146 ms | 146, 136, 150, 193, 139 | 0,11 / 0 |
| `/api/ui-settings` | 156 ms | 143, 245, 156, 142, 223 | 9,28 / 0 |
| `branches`, có đếm | 317 ms | 526, 364, 317, 192, 209 | 150,86 / 150,59 |
| `branches`, `count=none` | 198 ms | 198, 182, 226, 178, 234 | 44,66 / 44,42 |
| `room_types`, có đếm | 187 ms | 184, 173, 187, 208, 295 | 51,95 / 50,88 |
| `room_types`, `count=none` | 188 ms | 186, 193, 194, 161, 188 | 43,00 / 42,71 |
| `items`, có đếm | 187 ms | 190, 187, 277, 159, 165 | 23,84 / 23,68 |
| `items`, `count=none` | 154 ms | 195, 150, 154, 220, 154 | 24,51 / 24,37 |
| `promotions`, có đếm | 178 ms | 192, 178, 162, 178, 191 | 43,58 / 42,97 |
| `promotions`, `count=none` | 169 ms | 160, 179, 180, 169, 162 | 28,29 / 28,07 |

So với ngưỡng: mức sàn, `/api/meta`, bảng 50 dòng đạt; `Server-Timing` của `/api/table` đạt trừ `branches` có đếm (151 ms so với 150 ms). Chưa đo "lần đầu ở instance mới" vì instance đã ấm. Thời gian còn lại ngoài `app` (khoảng 130 ms) là mạng Việt Nam ↔ Seoul.

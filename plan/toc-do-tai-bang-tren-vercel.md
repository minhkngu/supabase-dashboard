# Tăng tốc tải bảng trên Vercel

**Trạng thái:** xong (13/11/2026) trên nhánh `codex/hoan-thanh-plan`. Đo có đăng nhập trên preview `b60e27d` (function `icn1`): tải bảng 50 dòng 154–317 ms (trước 557–1.743 ms ở `iad1`), metadata lấy từ cache (`Server-Timing` `meta` khoảng 0,01 ms). Số chi tiết trong `plan/do-hieu-nang-tren-vercel.md`.

Nguồn: đo trên bản preview `main` (`49031bd`) và đo trực tiếp từ máy cá nhân ngày 13/11/2026. Mọi phép đo chỉ dùng request đọc.

## Hiện trạng

### Vùng chạy

- Function Vercel chạy ở **`iad1` (Washington, Mỹ)**: mọi response đều có header `x-vercel-id: hkg1::iad1::…`. `vercel.json` chưa đặt `regions`, nên Vercel dùng vùng mặc định.
- Database Supabase ở **Seoul** (`aws-1-ap-northeast-2.pooler.supabase.com`).
- Người dùng ở Việt Nam, vào mạng Vercel qua Hồng Kông (`hkg1`).

### Số đo trên Vercel (từ trình duyệt, đã đăng nhập)

| Request | Thời gian |
|---|---:|
| Đường dẫn API không tồn tại (function gần như không làm gì) | 304–363 ms |
| `/api/meta` (metadata trong cache) | 293–322 ms |
| `/api/formula-config`, `/api/lookup-config` | khoảng 300 ms, lần đầu 700 ms |
| `/api/ui-settings` | khoảng 660 ms |
| `/api/table/<bảng>` 50 dòng, có đếm | 557–1.743 ms |
| `/api/table/<bảng>` 50 dòng, `count=none` | 571–1.102 ms |

- Khoảng 300 ms là mức sàn: Việt Nam → Hồng Kông → Mỹ rồi về.
- Phần còn lại (300–1.400 ms) là các lượt function ở Mỹ gọi sang Supabase ở Seoul. Bỏ đếm (`count=none`) gần như không đỡ vì thời gian chủ yếu là mạng.

### Số đo từ máy cá nhân (gọi thẳng Supabase, cùng mã máy chủ ở chế độ Vercel)

| Phần | Thời gian |
|---|---:|
| Một lần gọi Data API, đã có kết nối | 200–550 ms |
| Lần gọi Data API đầu tiên (mở kết nối HTTPS mới) | khoảng 1,1–1,7 s |
| Kết nối mới tới Postgres pooler | khoảng 620–710 ms |
| Một truy vấn Postgres đã có kết nối | khoảng 88 ms |
| `/api/table` qua app khi đã ấm | 150–450 ms |

Lỗi bảng đứng ở "Đang tải dữ liệu" có plan riêng: `plan/sua-loi-treo-dang-tai-du-lieu.md`.

## Việc cần làm

Mỗi bước một commit, trên một nhánh mới.

### 1. Chạy function ở Seoul (cao)

- `vercel.json`: thêm `"regions": ["icn1"]`.
- Kiểm tra mục Settings → Functions → Function Region của project trên Vercel không ghi đè thành vùng khác.
- Kiểm: deploy preview, header `x-vercel-id` có dạng `…::icn1::…`; đo lại bảng ở trên. Ước tính (chưa đo): mức sàn khoảng 80–120 ms, tải bảng khoảng 150–300 ms.
- Cập nhật mục Triển khai lên Vercel trong `README.md`: function phải cùng vùng với database.

### 2. Làm mới metadata ở nền (trung bình)

- `server/context.mjs` `cachedMetadata()`: khi cache quá 60 giây, trả ngay bản cũ và đọc lại ở nền; chỉ chờ khi chưa có bản nào. Giữ `invalidateCaches()` để thay đổi cấu trúc vẫn có hiệu lực ngay.
- `server/app.mjs` (`liveMetadataEachRequest`): không để request API chờ việc đọc lại metadata khi đã có bản cũ.
- Kiểm: unit test cho `cachedMetadata` với đồng hồ giả (hết hạn → trả bản cũ ngay, một lượt đọc nền; `invalidateCaches()` → lần sau phải chờ bản mới).

### 3. Đo lại trên Vercel (sau bước 1–2)

- Đo theo `plan/do-hieu-nang-tren-vercel.md` và ghi kết quả vào đó; cập nhật trạng thái file này.

## Không làm lúc này

- Bỏ đếm tổng (`count=exact`): đo cho thấy chỉ đỡ 100–300 ms, không phải nguyên nhân chính.
- Phân trang theo khóa, chỉ lấy cột đang hiển thị: dữ liệu hiện nhỏ (50 dòng `branches` khoảng 2 KB).

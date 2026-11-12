# Kế hoạch triển khai Siris

Cập nhật 12/11/2026 sau khi đối chiếu PR #3 với kế hoạch này (chạy lại lint, test, build, e2e và đọc mã từng bước). Bản online nay chạy trên **Vercel**; `chatgpt-site/` (Sites) và Supabase Edge Function không còn dùng.

Mục lục:
1. Hướng đi
2. Các quyết định đã chốt
2b. Đánh giá PR #3 so với kế hoạch
3. Hiện trạng và số đo
4. Kiến trúc đích
5. Quy tắc làm việc
6. Các giai đoạn (từng bước)
7. Rủi ro và cách giảm
8. Bảng trạng thái

---

## 1. Hướng đi

Siris là công cụ quản lý dữ liệu Supabase cho một người dùng, chạy trên máy cá nhân và có thêm một bản online. Năm nguyên tắc dẫn đường:

1. **Supabase là nguồn sự thật duy nhất.** Dữ liệu đi qua Data API với key anon nên luôn chịu RLS. Chỉ thay đổi cấu trúc và cấu hình mới dùng kết nối Postgres trực tiếp.
2. **Một lõi backend, hai lớp vỏ.** Bản cục bộ (Node, `server.mjs`) và bản online (Vercel function, `api/handler.mjs`) cùng chạy một bộ mã xử lý request. Không còn bản sao sinh ra bằng thay chuỗi.
3. **JS thuần, chia module, không framework.** Gỡ React, Glide, Tailwind đã cài nhưng không dùng. Giữ nguyên 64 test e2e làm lưới an toàn.
4. **Giao diện suy ra từ trạng thái.** Nút nào hiện, ẩn, khóa là kết quả của một hàm đọc `state`, không gán rời rạc ở từng tính năng.
5. **Đo trước, sửa sau.** Mọi thay đổi về tốc độ có số đo trước và sau bằng cùng một script.

Thứ tự ưu tiên: sửa thứ người dùng đang thấy sai → làm nhanh → dọn và tách cấu trúc → thêm tiện ích thao tác → trau chuốt giao diện.

---

## 2. Các quyết định đã chốt

| Chủ đề | Quyết định |
|---|---|
| Chế độ mở mặc định | Lưới dữ liệu cho mọi bảng, kể cả `promotions` |
| Dashboard | Thêm và sửa được bản ghi; xóa chỉ ở lưới |
| Thanh chọn dòng | Nổi ở đáy lưới, không đẩy nội dung |
| Frontend | JS thuần, tách module |
| Bản online | **Vercel.** Không dùng `chatgpt-site/`, Sites hay Supabase Edge Function nữa. Mọi thay đổi phải giữ bản Vercel chạy được |

Lưu ý vận hành: thay đổi chỉ lên bản online sau khi deploy lên Vercel (`vercel deploy --prod`). Cache trong bộ nhớ của server chỉ sống theo từng instance serverless, không được coi là nguồn dữ liệu.

---

## 2b. Đánh giá PR #3 so với kế hoạch

PR #3: 4 commit, 24 file, +1.230 / −96, nhánh `claude/hopeful-gates-00krjq`.

### Kết quả kiểm tra thực tế (chạy lại 12/11/2026)

| Lệnh | Kết quả |
|---|---|
| `npm run lint` | Đạt |
| `npm run typecheck` | Đạt |
| `npm run build` | Đạt |
| `npm test` | 72 đạt, 2 bỏ qua. Chạy khi chưa `npm run build` thì `tests/server.test.js` lỗi (`/` trả 404); build xong thì đạt 3/3 lần |
| `npm run test:e2e` | 77 đạt, **1 lỗi**: `auth.spec.ts:44` `/.env.local` trả 200 thay vì ≥ 400 (dev server trả `index.html`) |
| `npm run bench` | Không chạy lại được (môi trường không có PostgreSQL 16); các số là số PR tự ghi |

### Giai đoạn 1 — Lưới an toàn

| Bước | Đánh giá |
|---|---|
| 1.1 Lưới mặc định | Tốt; e2e Dashboard bấm tab trước khi kiểm tra |
| 1.2 Ghim cột checkbox | Tốt; có test cuộn ngang (`delete-records.spec.ts`) |
| 1.3 Lint | Tốt; hết lỗi |
| 1.4 e2e không treo | Tốt (`timeout: 15_000`, README có `PLAYWRIGHT_CHROMIUM_EXECUTABLE`) |
| 1.5 Chốt chặn edge | Làm xong nhưng **hết giá trị** vì bản online chuyển sang Vercel |
| "Xong khi e2e đạt" | **Chưa đủ**: còn 1 lỗi `/.env.local` |

### Giai đoạn 2 — Nút bấm và Dashboard

Tốt, mỗi hành vi có test: cụm chuyển chế độ giữ vị trí, thêm và sửa bản ghi từ Dashboard (PATCH đúng khóa, không có nút xóa), chọn dòng không làm lưới nhảy, ô chọn tất cả thẳng hàng, tiêu đề vừa 390px, ảnh đối chiếu desktop và điện thoại. Điểm yếu: `syncChrome()` (2.2) chưa kiểm chứng là hàm riêng; `app.js` vẫn là file dài, mỗi dòng gom nhiều lệnh, khó đọc và khó review.

### Giai đoạn 3 — Tốc độ dữ liệu

| Bước | Đánh giá |
|---|---|
| 3.0 `scripts/bench.mjs` | **Tốt.** PostgreSQL thật, proxy chèn độ trễ, API giả lập, in bảng số, ghi rõ giả định |
| 3.1 Cache cấu hình ở đường ghi | Tốt; có test hai PATCH liên tiếp giữ cache |
| 3.2 Xóa cache đúng lúc | Tốt: ghi dữ liệu không xóa; formula, lookup, schema xóa đúng mục. Metadata sau khi ghi 91 → 1 ms |
| 3.3 Một pool, giữ kết nối | **Một phần**: `server.mjs` đặt `max:4`, giữ rảnh 5 phút, `keepAlive`, nhưng `admin.mjs` vẫn có cấu hình pool `max:4` riêng; chưa xác nhận chỉ còn một pool |
| 3.4 Không tải lại trang sau khi lưu | Tốt; có e2e. Lưu 1 ô 275 → 65 ms |
| 3.5 Ghi hàng loạt | Tốt: tối đa 50, 5 lượt song song, lỗi theo dòng, chống trùng khóa, kiểm tra khóa chính và cột bảo vệ. 13,9 s → 0,64 s. Server vẫn gọi 50 lượt tới Data API |
| 3.6 `limit` ≤ 1.000 | Tốt; có unit test. Tổng quan 658 → 67 ms |
| 3.7 `count=none` | Tốt; có unit test và e2e "chuyển trang dùng lại tổng" |
| 3.10 Mở ứng dụng không chờ metadata | **Một phần.** Phía trình duyệt (`localStorage`) tốt, có e2e. Phía server ghi snapshot `.siris-metadata-cache.json` xuống đĩa: tắt trên Deno, **vô ích trên Vercel** (đĩa chỉ đọc, instance không giữ trạng thái), lỗi ghi bị nuốt im lặng. Chưa có số đo cho mục tiêu 428 → ~80 ms |
| 3.11 Dùng lại trang, tải trước | Tốt về thiết kế (`epoch` bỏ kết quả cũ, cache tối đa 100 mục, tải trước trang kế và bảng khi rê chuột); có e2e. Chưa có số đo |
| 3.12 Cache lookup 60 giây | Tốt; xóa khi ghi bảng nguồn. Chưa có số đo |
| 3.13 Tìm kiếm | Tốt: bỏ từ khóa dưới 2 ký tự, đếm sau khi dừng gõ, chọn cột; có e2e |
| 3.8 Đo lại | **Chưa xong dù bảng trạng thái ghi "xong"**: chỉ 6 dòng trước → sau, thiếu 3.10–3.12; chỉ một lần đọc trên Supabase, không có số gốc; chưa đo trên Vercel |

### Vấn đề chung chưa tốt

1. **Số đo là mô phỏng**, chưa đo trên Vercel (cold start, khoảng cách vùng Vercel ↔ Supabase, pooler). Không dùng số tuyệt đối để quyết định.
2. **Test cache với PostgreSQL bị bỏ qua mặc định** (`SIRIS_BENCH_PG_BIN`): hồi quy cache không bị bắt.
3. **`npm test` cần `npm run build` trước**, trái với "đạt trên bản clone mới" ở bước 1.5.
4. **Mã edge là gánh nặng**: `to-edge-backend.mjs`, `edge-backend.test.js`, sửa `prepare-chatgpt-site.mjs`, `skipIf` ở `sites-bridge.test.js`.
5. `app.js` tiếp tục phình (thêm prefetch, cache lookup, batch) trong khi giai đoạn 6 định tách file này.

Kết luận: giai đoạn 2 và các bước 3.0–3.2, 3.4–3.7, 3.11–3.13 đạt yêu cầu; 3.3, 3.8, 3.10 chỉ đạt một phần; 1.5 hết giá trị. Việc tiếp theo nằm ở giai đoạn 3b, 4.1 và 5.5.

---

## 3. Hiện trạng và số đo

### 3.1 Kiểm tra tự động

| Lệnh | Kết quả |
|---|---|
| `npm run build` | Đạt |
| `npm run typecheck` | Đạt nhưng không kiểm `app.js` và các `.mjs` |
| `npm run lint` | 3 lỗi trong `tests/e2e/table-overview.spec.ts` |
| `npm test` | 65 đạt, 2 lỗi (`tests/sites-bridge.test.js` cần thư mục `chatgpt-site/` bị `.gitignore`) |
| `npm run test:e2e` | Phần lớn test cũ timeout vì mọi bảng mở mặc định ở Dashboard |

Đây là đường cơ sở trước giai đoạn 1; kết quả hiện tại ở mục 2b.

### 3.2 Lỗi giao diện đã xác nhận

| Hiện tượng | Nguyên nhân |
|---|---|
| Tick chọn dòng thì lưới nhảy xuống 74px | `#rowSelectionBar` là khối riêng nằm trên lưới (`index.html:208`) |
| Ô chọn tất cả lệch 8px so với ô chọn từng dòng | `style.css:3178-3179` |
| Bấm Dashboard ↔ Bảng dữ liệu thì cụm nút đó nhảy ngang 236px | Cụm chuyển chế độ nằm chung hàng căn phải với ba nút bị ẩn ở Dashboard (`index.html:73-84`) |
| Ở Dashboard mất "Thêm bản ghi" | `syncPromotionsView` ẩn `#add` (`app.js:27`) |
| Cuộn ngang thì cột checkbox trôi mất | `style.css:1898` đặt `position: relative` đè `sticky` |
| Điện thoại: "Thêm bản ghi" bị cắt, nút menu 30×20 px | Hàng nút không co ở 390px |
| Trạng thái `#add` được gán ở 7 chỗ | `app.js` dòng 27, 43, 71, 92, 877, 1026… |

### 3.3 Tốc độ phản hồi dữ liệu

Đo bằng server thật của dự án, Postgres 16 cục bộ có đúng 9 bảng trong `schema.json`, Data API giả lập, chèn độ trễ mạng giả định. Con số tuyệt đối trên Supabase thật sẽ khác; số lượt gọi thì chính xác.

| Thao tác | Mạng gần (API 60 ms, Postgres 40 ms/lượt) | Mạng xa (150 / 100 ms) | Lượt gọi |
|---|---|---|---|
| Mở trang lần đầu | 428 ms | 934 ms | metadata, cấu hình, 1 API |
| Tải 1 trang 50 dòng | 65 ms | 155 ms | 1 API |
| Lưu 1 ô (PATCH) | 273 ms | 665 ms | 5 Postgres + 1 API |
| Sửa 1 ô trọn vẹn (PATCH + tải lại trang) | 338 ms | 818 ms | 5 Postgres + 2 API |
| Lưu 1 ô sau 11 giây không thao tác | 531 ms | 1.282 ms | thêm 2 kết nối Postgres mới |
| Dán / sửa hàng loạt 50 dòng | 13,6 giây | 33,4 giây | 50 × (5 Postgres + 1 API) |
| Dashboard đọc 500 dòng | 641 ms | 1.552 ms | 10 API nối tiếp |
| `/api/meta` khi cache còn | 2 ms | 2 ms | 0 |
| `/api/meta` ngay sau một lần ghi | 90 ms | 211 ms | 12–15 Postgres |

Server không chèn độ trễ: lưu một ô 8 ms, tải một trang 6 ms. Trình duyệt vẽ 22 cột × 50 dòng mất 47–68 ms. Vậy thời gian chờ nằm ở số lượt gọi ra mạng, không nằm ở mã xử lý hay phần vẽ.

### Số gốc từ `scripts/bench.mjs` (12/11/2026)

Đo lại bằng PostgreSQL 16.15 cục bộ và API giả lập. Proxy thêm độ trễ cho các gói phản hồi PostgreSQL; số gói không đồng nhất với số truy vấn SQL. Hai cấu hình lần lượt là 60/40 ms và 150/100 ms (API/PostgreSQL). Các số này là đường cơ sở cho chính script này và có thể khác số đo ở bảng trước.

| Thao tác | Mạng gần | Mạng xa |
|---|---:|---:|
| Metadata lần đầu | 152 ms | 347 ms |
| Metadata trong cache | 2 ms | 4 ms |
| Đọc 50 dòng | 83 ms | 236 ms |
| Lưu một ô | 275 ms | 673 ms |
| Metadata sau khi ghi | 91 ms | 220 ms |
| Sửa ô và tải lại | 353 ms | 830 ms |
| Lưu ô sau 11 giây | 383 ms | 902 ms |
| Ghi 50 dòng nối tiếp | 13.863 ms | 33.429 ms |
| Tổng quan 500 dòng | 658 ms | 1.566 ms |

### Đo lại sau tối ưu (12/11/2026)

Cùng phép giả lập và PostgreSQL 16.15 như bảng số gốc; số đo là một lần chạy, không phải cam kết thời gian trên mạng thật. Từ bước 3.4, giao diện không tải lại trang sau khi sửa ô nếu bảng không có formula hoặc lookup đồng bộ. Cột “sửa và tải lại” bên dưới vẫn đo hai yêu cầu để dễ so sánh.

| Thao tác | Gần: trước → sau | Xa: trước → sau |
|---|---:|---:|
| Lưu một ô | 275 → 65 ms | 673 → 162 ms |
| Sửa ô và tải lại | 353 → 129 ms | 830 → 314 ms |
| Lưu ô sau 11 giây | 383 → 73 ms | 902 → 158 ms |
| Metadata sau khi ghi | 91 → 1 ms | 220 → 2 ms |
| Ghi 50 dòng | 13.863 → 640 ms | 33.429 → 1.535 ms |
| Tổng quan 500 dòng | 658 → 67 ms | 1.566 → 154 ms |

Lô 50 dòng vẫn gửi 50 yêu cầu tới Data API, tối đa 5 yêu cầu song song; từ trình duyệt chỉ gửi một yêu cầu lô. Các số cho Tổng quan giả định dữ liệu nằm vừa trong một trang 1.000 dòng.

Đo chỉ đọc một lần trên Supabase đã cấu hình: metadata 918 ms; trang đầu của 11 bảng thành công trong khoảng 194–1.069 ms; bảng lớn nhất có 36 dòng. Không ghi dữ liệu thật. Số liệu này không có đường cơ sở thật tương ứng và không đủ để kết luận hiệu quả theo cột hay font.

Bước 3.9 chưa thực hiện vì chưa có số đo chứng minh số cột hoặc font là nút thắt. Bước 3.14 chưa thực hiện vì bảng lớn nhất đo được còn dưới ngưỡng 50.000 dòng.

### 3.3b Tốc độ đọc

Đường đọc hiện tại: mỗi lần mở bảng, chuyển trang, tìm kiếm, lọc hay sắp xếp là đúng 1 lượt gọi Data API (65 ms ở mạng gần), cộng thêm 1 lượt cho mỗi cột lookup ảo và mỗi cột liên kết có hiện tên. Với các bảng nhỏ hiện có (vài chục tới vài trăm dòng), thời gian trong database gần bằng 0; thứ người dùng phải chờ là số lượt gọi và việc không dùng lại dữ liệu đã tải.

Điểm chậm theo luồng (đọc từ mã, kèm số đã đo ở bảng trên):

| Luồng | Vì sao chậm |
|---|---|
| Mở ứng dụng | `/api/meta` phải chạy 7 truy vấn cấu trúc và mở kết nối Postgres (342 ms gần, 759 ms xa) rồi giao diện mới biết có bảng nào để tải |
| Chuyển trang, tìm, lọc, sắp xếp | Các lần tải "im lặng" không bao giờ dùng cache trang (`load` trong `app.js:879`), nên quay lại trang vừa xem vẫn chờ mạng |
| Quay lại bảng đã mở | Cache trang chỉ được dùng trong 15 giây, sau đó xóa lưới và hiện "Đang tải dữ liệu…" |
| Bảng có lookup hoặc cột liên kết | Mỗi lần tải lại trang (kể cả sau khi sửa một ô) gọi lại toàn bộ lookup, không nhớ kết quả cũ |
| Dashboard | Đọc toàn bộ bảng, 50 dòng mỗi lượt, nối tiếp nhau |

Thời gian trong database khi bảng lớn lên (đo trên Postgres cục bộ, bảng mẫu 300.000 dòng, 16 cột, 147 MB, chưa tính mạng):

| Truy vấn | Thời gian |
|---|---|
| Trang đầu, 50 dòng | 0,2 ms |
| Trang thứ 5.001 (`OFFSET 250000`) | 200 ms |
| Cùng vị trí bằng "khóa lớn hơn giá trị cuối" thay cho OFFSET | 0,3 ms |
| Đếm tổng (`count=exact`), không lọc | 27 ms |
| Tìm kiếm trên 10 cột text, có kết quả sớm | 145 ms |
| Tìm kiếm trên 10 cột text, không có kết quả (quét hết bảng) | 1.600 ms |
| Đếm kết quả tìm kiếm | 429 ms |
| Tìm trên 1 cột | 52 ms |
| Sắp xếp theo cột không có index | 34 ms |

Kích thước phản hồi: một trang 50 dòng với đủ 16 cột là khoảng 33 KB; chỉ 6 cột đang hiển thị là khoảng 8 KB.

Kết luận: với dữ liệu hiện tại, ưu tiên là bớt lượt gọi và dùng lại dữ liệu đã tải. Phân trang sâu, đếm tổng và tìm kiếm chỉ thành vấn đề từ vài chục nghìn dòng trở lên. Thử với index trigram cho tìm kiếm chưa cho kết quả ổn định nên chưa đưa vào kế hoạch.

### 3.4 Vấn đề kiến trúc

1. Giao diện không có một nguồn sự thật cho trạng thái nút.
2. Hai kiến trúc frontend cùng tồn tại: JS thuần đang chạy, React + Glide + Tailwind đã cài nhưng bỏ dở.
3. Bản edge sinh ra bằng chuỗi `String.replace` trên `server.mjs` (`scripts/prepare-chatgpt-site.mjs`); thay không khớp thì im lặng bỏ qua. (Vấn đề này biến mất khi bỏ bản edge ở bước 4.1.)
4. `server.mjs` là một hàm xử lý mọi route trên một dòng khoảng 12.000 ký tự; biến `tables` toàn cục bị ghi đè giữa các request; mọi lần ghi xóa hết cache.
5. `app.js` 153 KB, 131 hàm, khoảng 55 biến trạng thái toàn cục.
6. Cấu hình rải rác: hai bảng trong `siris_admin`, sáu khóa `localStorage`, một bảng `siris_admin.columns` đã chết.
7. Mã chết: nhóm hàm "definition/links" trong `admin.mjs`, luồng "managed column" trong `app.js`, 25 class CSS, 15 dependency.
8. Nghiệp vụ khách sạn hardcode trong công cụ tổng quát (`table-overview.mjs`, `recordFieldHint`).
9. Test e2e dồn vào một file 82 KB (`tests/e2e/auth.spec.ts`), mỗi file tự viết lại phần giả lập API.

---

## 4. Kiến trúc đích

### 4.1 Tổng thể

```
Trình duyệt (src/)
   │  fetch cùng origin, JSON, header x-siris-token
   ▼
Lớp vỏ ──────────────┬──────────────────────────────┐
 server.mjs (Node)   │  api/handler.mjs (Vercel)
 loopback, CSRF ngẫu │  xác thực phiên đăng nhập
 nhiên, phục vụ dist │
   └─────────┬───────┴──────────────────────────────┘
             ▼
        core/app.mjs  →  router  →  routes/*
             │                         │
             ├── services/data-api ────┼──► Supabase Data API (key anon, chịu RLS)
             ├── services/cache        │
             └── db/* ─────────────────┴──► Postgres trực tiếp (metadata, DDL, cấu hình, trigger)
```

Quy tắc phân vai:
- **Đọc và ghi dữ liệu bảng**: chỉ qua Data API.
- **Metadata, thay đổi schema, cấu hình formula/lookup, trigger**: chỉ qua Postgres trực tiếp, luôn trong transaction có khóa và chữ ký xem trước.
- **Lớp vỏ** chỉ lo: đọc môi trường, xác thực nguồn gọi, chuyển request thành dạng chung, phục vụ file tĩnh.

### 4.2 Backend

```
core/
  app.mjs               createApp({ env, schema, trust }) → handle(request)
  router.mjs            bảng định tuyến: method + đường dẫn → hàm xử lý
  http.mjs              đọc body (giới hạn 1 MB), tạo phản hồi JSON, chuẩn hóa lỗi
  guard.mjs             kiểm tra Host, Origin, token theo cấu hình trust
  routes/
    meta.mjs            GET /api/meta
    table.mjs           GET/POST/PATCH/DELETE /api/table/:name, POST /api/table/:name/batch
    lookup.mjs          POST /api/lookup/:name
    formula.mjs         GET/POST /api/formula-config
    lookup-config.mjs   /api/lookup-config, /api/lookup-sync/*
    schema.mjs          /api/admin/schema/preview, /apply
  services/
    data-api.mjs        gọi Data API (hàm upstream hiện tại)
    cache.mjs           cache có TTL, xóa theo tên: metadata | formula | lookup
    metadata.mjs        đọc và cache cấu trúc bảng
    pool.mjs            một pool Postgres dùng chung
  db/
    admin.mjs  formula-sync.mjs  formula-parser.mjs
    lookup-sync.mjs  lookup-store.mjs  filters.mjs  materialized-lookup.mjs
server.mjs              lớp vỏ Node (cục bộ)
api/handler.mjs         lớp vỏ Vercel, gọi createApp từ core/
vercel.json             build giao diện, chuyển mọi request tới api/handler.mjs
```

Dạng request chung giữa hai lớp vỏ:

```
request  = { method, path, query, headers, readJson() }
response = { status, headers, body }
trust    = { csrfToken, allowedHosts, allowedOrigins }
```

Quy tắc cache:

| Sự kiện | Xóa cache |
|---|---|
| Ghi dữ liệu bảng (POST/PATCH/DELETE/batch) | Không xóa gì |
| Lưu formula | `formula` |
| Lưu, xóa, đổi tên lookup | `lookup` |
| Áp dụng thay đổi schema, đổi tên cột | `metadata`, `formula`, `lookup` |
| Hết 60 giây | Mục tương ứng |

Vì bản cục bộ và bản online có thể cùng chạy, cấu hình trong cache có thể cũ tối đa 60 giây. Điều này an toàn: trigger trong database vẫn tính lại cột formula và cột lookup khi có ghi, nên giá trị sai không lọt vào dữ liệu.

Pool Postgres: một pool duy nhất (tối đa 4 kết nối), giữ kết nối rảnh 5 phút, bật keep-alive.

### 4.3 Frontend

```
index.html
src/
  main.js               khởi động
  state.js              một đối tượng state, hàm update(), các selector
  api.js                fetch, token, cache trang
  storage.js            mọi khóa localStorage, có phiên bản, đọc/ghi an toàn
  chrome.js             syncChrome(): tiêu đề, thanh công cụ, thanh chọn dòng
  format.js             định dạng số, chuyển giá trị nhập theo kiểu cột
  schema-utils.js       kiểu số, biểu tượng kiểu, cột ghi được
  sidebar.js
  grid/
    render.js  sync.js  frozen.js  selection.js
    cell-edit.js  clipboard.js  keyboard.js
  view/
    menus.js  rules.js  columns.js
  components/
    custom-select.js  dialog.js  toast.js  icons.js
  records/
    editor.js  deletion.js  history.js
  columns/
    dialog.js  formula.js  lookup-sync.js  duplicate.js
  lookup/
    dialog.js  loader.js  link-picker.js
  overview/
    table.js  promotions.js  read-all.js
  domain/
    tables.config.js    nhãn, trường tổng quan, gợi ý nhập của từng bảng
styles/
  tokens.css  base.css  layout.css  sidebar.css  grid.css
  menus.css  dialogs.css  overview.css  responsive.css
```

Luồng dữ liệu trong giao diện:

```
sự kiện người dùng → hành động (hàm trong module) → update(state)
                                                    → render lưới / syncChrome() / render menu
```

Quy tắc:
- Một module chỉ đụng DOM của vùng mình quản lý.
- Không module nào tự gán `hidden` hay `disabled` cho nút ở thanh tiêu đề, thanh công cụ, thanh chọn dòng; chỉ `chrome.js` làm việc đó.
- Selector trong `state.js` trả lời các câu hỏi dùng chung: đang ở Dashboard không, có được ghi không, có được thêm không, đang bận gì.
- Mọi truy cập `localStorage` đi qua `storage.js`.
- Nghiệp vụ riêng của bảng chỉ nằm trong `domain/tables.config.js`.

### 4.4 Kiểm thử

```
tests/
  unit/                 logic thuần và API (Vitest)
  e2e/
    helpers/mock-api.ts một hàm giả lập API dùng chung
    grid.spec.ts  selection.spec.ts  chrome.spec.ts  cell-edit.spec.ts
    view-menus.spec.ts  columns.spec.ts  lookup.spec.ts  formula.spec.ts
    overview.spec.ts  promotions.spec.ts  deletion.spec.ts  startup.spec.ts
scripts/bench.mjs       đo độ trễ theo từng thao tác
```

---

## 5. Quy tắc làm việc

- Nhánh: `claude/hopeful-gates-00krjq`. Mỗi bước một commit.
- Sau mỗi bước chạy đủ:

  ```sh
  npm run lint
  npm test
  npm run build
  PLAYWRIGHT_CHROMIUM_EXECUTABLE=<đường dẫn chromium> npm run test:e2e
  ```

- Không gộp thay đổi hành vi với thay đổi định dạng hay di chuyển file trong cùng một commit.
- Không sửa test để che lỗi; chỉ sửa test khi hành vi mong muốn thay đổi theo mục 2.
- Không chạy gì lên Supabase thật khi thử. Kiểm thử ghi dùng API giả lập.
- Bước nào sửa backend thì kiểm tra thêm bản Vercel xem trước (preview deploy) trước khi merge.

---

## 6. Các giai đoạn

### Giai đoạn 1 — Lưới an toàn

Mục tiêu: bốn lệnh kiểm tra đều đạt trước khi đổi bất cứ thứ gì lớn.

**1.1 Lưới dữ liệu là mặc định**
- File: `app.js:10` (`savedPromotionsMode`).
- Việc: trả về chế độ bảng khi chưa có lựa chọn đã lưu, cho mọi bảng.
- Test: `tests/e2e/table-overview.spec.ts`, `tests/e2e/promotions-overview.spec.ts` bấm tab Dashboard trước khi kiểm tra Dashboard.
- Xong khi: các file `auth`, `startup`, `duplicate-column`, `delete-records` đạt mà không sửa nội dung.

**1.2 Ghim cột checkbox**
- File: `style.css:1898`.
- Việc: bỏ `position: relative` khỏi `#grid td.record-detail`.
- Test mới: cuộn ngang 600px, tọa độ x của ô checkbox dòng đầu không đổi.

**1.3 Lint**
- File: `tests/e2e/table-overview.spec.ts`.
- Việc: thay ba chỗ `any` bằng kiểu cụ thể.

**1.4 Test e2e không treo**
- File: `playwright.config.ts`, `README.md`.
- Việc: timeout 15 giây mỗi test; ghi cách dùng `PLAYWRIGHT_CHROMIUM_EXECUTABLE`.

**1.5 ~~Chốt chặn cho bản edge~~ (hủy)**
- Đã làm (`scripts/to-edge-backend.mjs`, `tests/edge-backend.test.js`) nhưng bản online chuyển sang Vercel nên không còn cần; xóa ở bước 4.1.

### Giai đoạn 2 — Nút bấm và Dashboard

Mục tiêu: hết hiện tượng nút nhảy, Dashboard thêm và sửa được.

**2.1 Thanh tiêu đề cố định**
- File: `index.html:61-85`, `style.css` (khối `.heading`, `.promotions-view-switch`).
- Việc: chuyển `#promotionsViewSwitch` sang nhóm trái, ngay sau tên bảng. Nhóm phải còn Hoàn tác, Làm lại, Thêm bản ghi; nút Thêm luôn ở mép phải.
- Xong khi: chuyển chế độ thì tọa độ của cụm chuyển chế độ và của nút Thêm không đổi.

**2.2 Một hàm quyết định trạng thái nút**
- File: `app.js`.
- Việc: thêm `syncChrome()`:
  - `#add` luôn hiện; khóa khi đang xóa, chưa tải xong cấu hình, hoặc bảng không có khóa chính;
  - Hoàn tác, Làm lại, thanh công cụ ẩn ở Dashboard;
  - thanh chọn dòng hiện khi đang xóa, có dòng được chọn hoặc có thông báo kết quả, và không ở Dashboard.
- Thay các lệnh gán rời rạc trong `syncPromotionsView`, `updateRowSelection`, `deleteRecords`, `choose`, `loadConfigs` bằng lời gọi `syncChrome()`.

**2.3 Dashboard thêm bản ghi**
- Việc: `#add` ở Dashboard mở form như ở lưới. Sau khi lưu, `refreshAfterWrite()` gọi `load()`, và `load()` ở Dashboard đã tự tải lại Dashboard.
- Test: ở Dashboard bấm Thêm → có request POST → danh sách có bản ghi mới.

**2.4 Dashboard sửa bản ghi**
- File: `table-overview.mjs`, `promotions-overview.mjs`, `app.js`.
- Việc: hai module nhận thêm `onEdit(row)`; hộp "Chi tiết" có nút "Sửa bản ghi", bấm thì đóng hộp chi tiết rồi gọi `onEdit`. `app.js` truyền `row => openEditor(row)`. `openEditor` ẩn nút "Xóa bản ghi" khi đang ở Dashboard.
- Test: Chi tiết → Sửa → PATCH đúng khóa; form không có nút xóa.

**2.5 Thanh chọn dòng nổi ở đáy lưới**
- File: `index.html`, `style.css`, `app.js:38-52`.
- Việc:
  - chuyển `#rowSelectionBar` vào trong `.grid-shell`, giữ nguyên id;
  - `.grid-shell` thành mốc định vị; thanh đặt tuyệt đối, căn giữa, nằm trên chân lưới, cao hơn ô ghim;
  - khi có dòng được chọn, thêm khoảng đệm dưới cho vùng cuộn để dòng cuối không bị che;
  - nhãn: "9 dòng đã chọn", "Bỏ chọn", "Xóa"; chọn hết trang mà bảng còn trang khác thì ghi "trên trang này";
  - kết quả xóa có lỗi vẫn hiện trong thanh, thanh nở lên trên.
- Test: tick một dòng và tick tất cả, tọa độ y của dòng đầu không đổi.

**2.6 Canh ô chọn**
- File: `style.css:3178-3179`.
- Việc: ô chọn ở tiêu đề thẳng hàng với ô chọn ở thân.

**2.7 Điện thoại**
- File: `style.css` (khối responsive).
- Việc: từ 520px trở xuống nút Thêm chỉ còn biểu tượng; `#openNav`, `#closeNav` có vùng bấm tối thiểu 36×36; ẩn hai nút thu gọn sidebar.
- Test: khung 390px, `#add` nằm trọn trong màn hình.

**2.8 Ảnh đối chiếu**
- Chụp lại desktop và điện thoại ở các trạng thái: lưới, chọn tất cả, Dashboard, form sửa từ Dashboard.

### Giai đoạn 3 — Tốc độ dữ liệu (ghi: 3.1–3.5, đọc: 3.6–3.7 và 3.10–3.14)

Mục tiêu theo mức "mạng gần":

| Thao tác | Hiện tại | Mục tiêu |
|---|---|---|
| Lưu 1 ô | 273 ms | khoảng 65 ms |
| Sửa 1 ô trọn vẹn | 338 ms | khoảng 65 ms |
| Lưu 1 ô sau khi dừng tay | 531 ms | khoảng 65 ms |
| Dán 50 dòng | 13,6 giây | dưới 1 giây |
| Dashboard 500 dòng | 641 ms | khoảng 70 ms |
| `/api/meta` sau một lần ghi | 90 ms | khoảng 2 ms |
| Mở ứng dụng tới lúc thấy dữ liệu | 428 ms | khoảng 80 ms |
| Quay lại trang hoặc bảng đã xem | 65 ms | tức thì, làm mới ở nền |
| Tải lại trang có lookup sau khi sửa ô | 1 + số cột lookup lượt gọi | 0–1 lượt gọi |

**3.0 Đưa script đo vào repo**
- File: `scripts/bench.mjs`, `package.json` (script `bench`), `README.md`.
- Việc: script dựng Data API giả lập và proxy chèn độ trễ trước Postgres, chạy `server.mjs`, in bảng số đo. Ghi lại số đo gốc ở mục 3.3.

**3.1 Cache cấu hình ở đường ghi**
- File: `server.mjs` (nhánh `/api/table/*` POST/PATCH).
- Việc: đọc formula và lookup qua `cachedConfig` có sẵn thay vì truy vấn mỗi lần.
- Test: hai lần PATCH liên tiếp, lần hai không phát sinh truy vấn Postgres.

**3.2 Xóa cache đúng lúc**
- File: `server.mjs`.
- Việc: bỏ lệnh xóa toàn bộ cache ở mọi request ghi; xóa theo bảng quy tắc ở mục 4.2.
- Test: sau PATCH dữ liệu, `/api/meta` không truy vấn lại; sau lưu formula, `/api/formula-config` trả giá trị mới.

**3.3 Một pool Postgres, giữ kết nối**
- File: `server.mjs`, `admin.mjs`.
- Việc: `createLookupStore` dùng chung pool của `createAdmin`; đặt thời gian giữ kết nối rảnh 5 phút và bật keep-alive.

**3.4 Không tải lại trang sau khi lưu ô**
- File: `app.js` (`startCellEdit`).
- Việc: sau khi lưu, chỉ tải lại trang nếu bảng có formula đang bật hoặc lookup đồng bộ; trường hợp còn lại chỉ nạp lại cột lookup ảo.
- Test: lưu một ô ở bảng không có formula thì không có request GET bảng theo sau.

**3.5 Ghi hàng loạt**
- File: `server.mjs`, `app.js` (`pasteCells`).
- Việc:
  - thêm `POST /api/table/:name/batch` nhận tối đa 50 thay đổi `{key, values, expected}`, server gửi tới Data API 5 lượt cùng lúc, trả kết quả theo từng dòng;
  - `pasteCells` gửi một request, giữ nguyên báo lỗi theo dòng và hoàn nguyên giá trị dòng lỗi.
- Test: 50 dòng trong một request; một dòng lỗi không chặn các dòng khác; kiểm tra khóa chính và cột chỉ đọc như PATCH đơn.

**3.6 Dashboard đọc trang lớn**
- File: `server.mjs` (GET bảng), `table-overview.mjs`, `promotions-overview.mjs`.
- Việc: thêm tham số `limit` (tối đa 1.000, mặc định 50); hai hàm đọc toàn bộ dùng 1.000.

**3.7 Đếm tổng ít hơn**
- File: `server.mjs`, `app.js` (`load`).
- Việc: thêm tham số bỏ đếm; giao diện chỉ yêu cầu đếm khi bảng, bộ lọc hoặc tìm kiếm đổi, và dùng lại tổng khi chuyển trang.

**3.10 Mở ứng dụng không chờ metadata**
- File: `server.mjs` (`/api/meta`), `app.js` (`initialize`).
- Việc:
  - ~~server lưu snapshot metadata xuống đĩa~~ — **bỏ** vì Vercel không có đĩa ghi được và instance không giữ trạng thái; gỡ mã đã thêm ở bước 3b.1;
  - giao diện lưu metadata lần trước vào `localStorage`, dựng sidebar và tải bảng ngay từ bản này, rồi đối chiếu khi `/api/meta` trả về; nếu cấu trúc bảng đang mở đã đổi thì vẽ lại.
- Mục tiêu: thấy dữ liệu sau 1 lượt gọi API (khoảng 70–90 ms ở mạng gần, hiện là 428 ms).
- Test: mở lần hai, lưới hiện trước khi `/api/meta` trả lời; cột bị xóa ở phía server thì biến mất sau khi đối chiếu.

**3.11 Dùng lại trang đã tải**
- File: `app.js` (`load`, `choose`, `pageCache`).
- Việc:
  - mọi lần tải (kể cả chuyển trang, tìm, lọc, sắp xếp) hiện ngay bản trong cache nếu có, bất kể tuổi, rồi làm mới ở nền và chỉ vẽ lại phần khác;
  - quay lại bảng đã mở: hiện ngay trang đã xem, không xóa lưới;
  - sau khi một trang tải xong, tải trước trang kế tiếp;
  - rê chuột lên tên bảng ở sidebar quá 150 ms thì tải trước trang đầu của bảng đó.
- Giữ quy tắc hiện có: mọi lần ghi xóa cache trang.
- Test: chuyển trang 1 → 2 → 1 thì lần quay lại không chờ mạng; dữ liệu đổi ở server thì lưới cập nhật sau lượt làm mới nền.

**3.12 Nhớ kết quả lookup**
- File: `app.js` (`loadLookups`, `loadNativeDisplays`).
- Việc: cache theo bảng nguồn, cột đối chiếu và giá trị, sống 60 giây; mỗi lần tải trang chỉ gọi cho các giá trị chưa có; xóa cache khi có ghi vào bảng nguồn.
- Test: sửa một ô không liên quan thì không phát sinh request lookup.

**3.13 Tìm kiếm nhẹ hơn**
- File: `app.js` (ô tìm kiếm), `filters.mjs`.
- Việc: trong lúc gõ không yêu cầu đếm tổng, chỉ đếm khi dừng gõ; từ khóa dưới 2 ký tự không gửi; thêm lựa chọn "tìm trong cột…" để tìm trên một cột thay vì mọi cột text.

**3.14 (Khi có bảng trên 50.000 dòng) Phân trang theo khóa**
- Việc: thay `OFFSET` bằng điều kiện "khóa lớn hơn giá trị cuối của trang trước" khi sắp xếp theo khóa chính; đếm tổng bằng ước lượng của Postgres thay cho đếm chính xác.
- Chỉ làm khi số đo trên dữ liệu thật cho thấy cần.

**3.8 Đo lại và ghi số**
- Chạy `npm run bench`, điền cột "sau khi sửa" vào bảng mục tiêu.
- Đo thêm trên Supabase thật bằng `SIRIS_PERF_TIMING=1` nếu có `.env.local`.

**3.9 (Sau khi đo trên dữ liệu thật) Chỉ lấy cột đang hiển thị, tự host font**
- Chỉ làm nếu số đo thật cho thấy bảng nhiều cột hoặc tải font là điểm chậm.

### Giai đoạn 3b — Hoàn tất giai đoạn 3 (sau đánh giá PR #3)

**3b.1** Gỡ snapshot metadata ghi xuống đĩa khỏi `server.mjs` (`snapshotPath`, `saveMetadataSnapshot`, cờ `metadataStale`, `?fresh=1`, mục `.siris-metadata-cache.json*` trong `.gitignore`) và test liên quan; giữ phần `localStorage`.
**3b.2** Gộp pool của `admin.mjs` vào pool dùng chung (làm xong 3.3 thật sự). Test: một lần khởi động chỉ mở một pool.
**3b.3** Sửa lỗi e2e `/.env.local`: dev server trả 404 cho đường dẫn bắt đầu bằng dấu chấm.
**3b.4** Cho `npm test` không phụ thuộc `dist/` (test tự dựng `dist` giả hoặc thêm `pretest`).
**3b.5** Chạy test cache với PostgreSQL trong CI để hai test bị bỏ qua chạy thật.
**3b.6** Đo bổ sung bằng `scripts/bench.mjs` cho 3.10–3.12: mở ứng dụng tới lúc thấy dữ liệu, quay lại trang đã xem, tải lại trang có lookup sau khi sửa ô. Điền vào bảng mục 3.3.
**3b.7** Đo trên bản Vercel đã deploy (không ghi dữ liệu thật): mở lúc nguội và ấm, tải trang, Tổng quan, bằng `SIRIS_PERF_TIMING=1` / `Server-Timing`. Ghi vùng Vercel và vùng Supabase; kiểm `SUPABASE_DB_URL` dùng pooler.
Xong khi: bốn lệnh kiểm tra đạt trên bản clone mới, bảng đo có cột "sau" cho mọi dòng mục tiêu, và có một bộ số trên Vercel.

### Giai đoạn 4 — Dọn dẹp

**4.1 Gỡ bản edge / Sites**
- Xóa `supabase/functions/siris-manager/`, `scripts/prepare-chatgpt-site.mjs`, `scripts/check-sites-backend.mjs`, `scripts/to-edge-backend.mjs`, `tests/edge-backend.test.js`, `tests/sites-bridge.test.js`, dòng `chatgpt-site/` trong `.gitignore`.
- Trước khi xóa: `grep` xác nhận không còn import tới các file này.
- Xong khi: không còn tham chiếu `chatgpt-site`, `siris-manager`, Edge Function trong mã và tài liệu.

**4.1b Mã chết ở backend**
- File: `admin.mjs`.
- Việc: xóa `createDefinition`, `updateDefinition`, `deleteDefinition`, `readLinks`, `readNativeLinks`, `writeLinks`, `importLegacy` và các hàm phụ chỉ chúng dùng. Gộp năm câu SQL metadata viết hai lần (`admin.mjs:18-25`). Xóa `/api/lookup-column/preview` và `buildSyncStatements` nếu xác nhận không dùng.

**4.2 Mã chết ở frontend**
- File: `app.js`, `index.html`, `style.css`.
- Việc: xóa luồng "managed column", relation picker, các lời gọi `/api/admin/definition/*` và `/api/admin/links/*`, dialog `#relationPicker`, các trường ẩn của form cột, 25 class CSS không dùng.

**4.3 Dependency thừa**
- File: `package.json`, `vite.config.ts`.
- Việc: gỡ `react`, `react-dom`, `@glideapps/glide-data-grid`, `@tanstack/react-query`, `@radix-ui/react-slot`, `class-variance-authority`, `clsx`, `tailwind-merge`, `lucide-react`, `@supabase/supabase-js`, `tailwindcss`, `@tailwindcss/vite`, `@vitejs/plugin-react`, `@types/react`, `@types/react-dom`; bỏ hai plugin khỏi cấu hình Vite.

**4.4 Tài liệu**
- File: `README.md`, `ARCHITECTURE.md`.
- Việc: bỏ câu "API quản trị cấu trúc đang tạm khóa" và tham chiếu file không tồn tại; mô tả kiến trúc theo mục 4; ghi quy trình deploy bản online lên Vercel (biến `SUPABASE_URL`, `SUPABASE_KEY`, `SUPABASE_DB_URL` dùng pooler, `vercel deploy --prod`).

### Giai đoạn 5 — Tách backend thành lõi và lớp vỏ

Mục tiêu: một lõi backend dùng chung cho `server.mjs` và `api/handler.mjs`, không sinh mã bằng thay chuỗi.

**5.1 Tạo `core/` và dạng request chung**
- Việc: thêm `core/http.mjs`, `core/guard.mjs`, `core/router.mjs`, `core/app.mjs` theo mục 4.2. Chưa chuyển route nào.

**5.2 Chuyển từng nhóm route**
- Thứ tự: `meta` → `table` → `lookup` → `formula` → `lookup-config` → `schema`. Mỗi nhóm một commit, không đổi hành vi.
- Sau mỗi nhóm: `tests/unit/server.test.js` và e2e đạt.

**5.3 Chuyển dịch vụ và mã database**
- Việc: `services/data-api.mjs`, `services/cache.mjs`, `services/metadata.mjs`, `services/pool.mjs`; chuyển bảy file `.mjs` ở gốc vào `core/db/`. Bỏ biến `tables` toàn cục, thay bằng `metadata.current()`.
- Việc kèm: dùng `safeError` cho mọi lỗi Postgres trước khi trả về trình duyệt.

**5.4 Lớp vỏ Node**
- File: `server.mjs`.
- Việc: chỉ còn đọc `.env.local`, tạo `trust` với token ngẫu nhiên, gọi `createApp`, phục vụ `dist/`.

**5.5 Lớp vỏ Vercel**
- File: `api/handler.mjs`, `vercel.json`.
- Việc: `api/handler.mjs` xác thực phiên đăng nhập rồi gọi `createApp` từ `core/`; `vercel.json` build bằng `npm run build` và đưa `dist/`, `schema.json` vào function. Không còn bước sao chép hay biến đổi mã.
- Test: gọi `handle()` qua lớp vỏ giả lập trả đúng `/api/meta`; ghi dữ liệu cần phiên và token.
- Xong khi: không còn mã dành riêng cho Deno hay Sites.

**5.6 Định dạng backend**
- Việc: thêm Prettier, chạy cho `core/`, `server.mjs`, `scripts/`, `tests/unit/`. Một commit riêng.

### Giai đoạn 6 — Tách frontend thành module

**6.1 Định dạng frontend**
- Việc: Prettier cho `app.js`, `index.html`, `style.css`, `tests/e2e/`. Một commit riêng.

**6.2 Nền móng**
- Việc: tạo `src/state.js`, `src/api.js`, `src/storage.js`, `src/format.js`, `src/schema-utils.js`, `src/components/toast.js`. `app.js` import từ đó. Gom sáu khóa `localStorage` vào `storage.js`.

**6.3 Tách theo vùng, mỗi vùng một commit**
1. `components/custom-select.js`
2. `sidebar.js`
3. `chrome.js` (hàm `syncChrome` từ bước 2.2)
4. `view/` (menu lọc, nhóm, sắp xếp, hiển thị cột)
5. `grid/render.js`, `grid/sync.js`, `grid/frozen.js`
6. `grid/selection.js`, `grid/clipboard.js`
7. `grid/cell-edit.js`, `records/history.js`
8. `records/editor.js`, `records/deletion.js`
9. `columns/` (form cột, formula, lookup đồng bộ, nhân bản)
10. `lookup/` (dialog, nạp dữ liệu, chọn bản ghi liên kết)
11. `overview/` (chuyển hai file `.mjs` hiện có)
12. `main.js` thay `app.js`

**6.4 Gom nghiệp vụ và hằng số**
- Việc: `domain/tables.config.js` chứa nhãn, trường tổng quan, gợi ý nhập. Cỡ trang thành một hằng số. Đổi tên `promotionsMode` thành `overviewMode`.

**6.5 Tách CSS**
- Việc: chia `style.css` thành các file ở mục 4.3; gộp hai khối custom select; bỏ các khối "reset the earlier…"; đưa mã màu rời vào token.

**6.6 Tách test e2e**
- Việc: thêm `tests/e2e/helpers/mock-api.ts`; chia `auth.spec.ts` theo tính năng như mục 4.4. Không đổi nội dung kiểm tra.

**6.7 Kiểm tra kiểu cho JS**
- File: `tsconfig.json`, `eslint.config.js`.
- Việc: bật `allowJs`, `checkJs`, sửa `include`; thêm quy tắc ESLint cho `.js` và `.mjs`.

### Giai đoạn 7 — Thao tác nhanh hơn

**7.1 Điều hướng bàn phím** (`grid/keyboard.js`): mũi tên di chuyển giữa các ô; gõ ký tự là vào sửa; Enter lưu và xuống dòng; Tab lưu và sang phải; Escape hủy.

**7.2 Bỏ lần bấm bị nuốt** (`grid/cell-edit.js`): đang sửa ô mà bấm ô khác thì lưu ô cũ và chọn ô mới trong một lần bấm.

**7.3 Menu trên tiêu đề cột** (`grid/render.js`, `view/`): sắp xếp, lọc, nhóm theo cột này, ẩn, ghim, thiết lập cột.

**7.4 Phím tắt toàn cục**: `/` vào ô tìm kiếm; Ctrl/⌘+K mở hộp chuyển bảng.

**7.5 Cỡ trang linh hoạt**: 50 / 100 / 200, lưu theo bảng (dùng tham số `limit` từ bước 3.6).

**7.6 Lưu nhiều thay đổi cột một lần** (`columns/dialog.js`): chạy lần lượt tên → kiểu → thuộc tính → formula/lookup, báo rõ bước nào xong, bước nào lỗi.

Mỗi mục có test e2e riêng.

### Giai đoạn 8 — Giao diện trực quan hơn

**8.1 Hiện tên thay cho mã**: cột khóa ngoại mặc định hiện trường `name` của bản ghi liên kết; cột `id` uuid xếp cuối.

**8.2 Form bản ghi**: hai cột trên màn hình rộng; text ngắn một dòng; boolean dùng công tắc; khóa ngoại dùng ô chọn; trường chỉ đọc gom xuống cuối.

**8.3 Thẻ bộ lọc**: lọc, nhóm, sắp xếp đang bật hiện thành thẻ dưới thanh công cụ.

**8.4 Phản hồi tại chỗ**: ô đang lưu có trạng thái riêng; toast "Đã lưu" kèm nút "Hoàn tác".

**8.5 Bỏ hộp thoại gốc của trình duyệt** (`components/dialog.js`): thư mục có menu Đổi tên / Xóa; xác nhận xóa dùng dialog của ứng dụng.

**8.6 Biểu tượng và nhãn** (`components/icons.js`): một bộ SVG; thêm biểu tượng cho uuid, enum, khóa ngoại; "Dashboard" đổi thành "Tổng quan"; cho đặt tên hiển thị cho bảng.

**8.7 Tổng quan**: bỏ chỉ số trùng; nhóm tính trên toàn bộ dữ liệu.

### Giai đoạn 9 — Bản Vercel an toàn hơn

**9.1** Giới hạn số lần đăng nhập sai theo IP; ghi log thử thất bại (không ghi mật khẩu).
**9.2** Xem lại quyền thay đổi schema trên bản online: cần bạn quyết định giữ hay chặn `/api/admin/*` trên Vercel khi tới bước này. Đề xuất: giữ, bắt buộc xem trước + chữ ký như hiện nay, và ghi log.
**9.3** Token CSRF là giá trị theo phiên, không phải hằng số.
(Chống phát lại chữ ký không còn cần vì không còn cầu nối Sites.)

---

## 7. Rủi ro và cách giảm

| Rủi ro | Cách giảm |
|---|---|
| Sửa `server.mjs` làm hỏng bản Vercel mà không biết | Chạy preview deploy trước khi merge; sau giai đoạn 5 hai bản dùng chung lõi |
| Tách module làm đổi hành vi | Mỗi vùng một commit, không đổi logic, e2e chạy sau từng commit |
| Cache cấu hình cũ khi nhiều instance cùng chạy | TTL 60 giây; cache chỉ sống theo instance; trigger trong database vẫn bảo vệ dữ liệu |
| Ghi hàng loạt thành công một phần | Trả kết quả theo từng dòng, hoàn nguyên dòng lỗi, không tự gửi lại |
| Số đo giả lập khác thực tế | Bước 3b.7 đo trên Vercel; bảng mục 3.3 chỉ là đường cơ sở |
| Commit định dạng làm khó đọc lịch sử | Commit riêng, ghi vào `.git-blame-ignore-revs` |

---

## 8. Bảng trạng thái

| Giai đoạn | Nội dung | Trạng thái |
|---|---|---|
| 1 | Lưới an toàn | Xong, trừ 1 lỗi e2e `/.env.local` (3b.3); 1.5 hủy |
| 2 | Nút bấm và Dashboard | Xong |
| 3 | Tốc độ dữ liệu | Xong 3.0–3.2, 3.4–3.7, 3.11–3.13; **một phần** 3.3, 3.8, 3.10; 3.9 và 3.14 chưa đủ điều kiện |
| 3b | Hoàn tất giai đoạn 3 | Chưa bắt đầu |
| 4 | Dọn dẹp (gồm 4.1 gỡ edge / Sites) | Chưa bắt đầu |
| 5 | Tách backend | Chưa bắt đầu |
| 6 | Tách frontend | Chưa bắt đầu |
| 7 | Thao tác nhanh | Chưa bắt đầu |
| 8 | Giao diện | Chưa bắt đầu |
| 9 | Bản Vercel an toàn hơn | Chưa bắt đầu; bước 9.2 chờ quyết định |

# Kế hoạch triển khai Siris

Cập nhật 12/11/2026, sau khi đánh giá PR #3 (chạy lại lint, typecheck, build, test, e2e và đọc mã từng bước). Bản online chạy trên **Vercel**; `chatgpt-site/` (Sites) và Supabase Edge Function không còn dùng.

Mục lục:
1. Tình hình hiện tại
2. Quyết định đã chốt
3. Đã xong (kết quả đạt được)
4. Cần sửa (tóm tắt, theo thứ tự)
5. Các bước chi tiết
6. Quy tắc làm việc
7. Rủi ro
8. Bảng trạng thái
9. Phụ lục: số đo, kiến trúc đích

---

## 1. Tình hình hiện tại

Phần tốc độ dữ liệu của PR #3 hoạt động tốt. Còn thiếu: snapshot metadata ghi xuống đĩa vô ích trên Vercel, một lỗi e2e, chưa đo các mục 3.10–3.12, chưa đo trên Vercel, chưa có CI. Phần edge/Sites không còn dùng và cần gỡ.

Kết quả kiểm tra hiện tại (nhánh `claude/hopeful-gates-00krjq`):

| Lệnh | Kết quả |
|---|---|
| `npm run lint` | Đạt |
| `npm run typecheck` | Đạt |
| `npm run build` | Đạt |
| `npm test` | 72 đạt, 2 bỏ qua. Lỗi `tests/server.test.js` (404) nếu chưa `npm run build` |
| `npm run test:e2e` | 77 đạt, 1 lỗi: `auth.spec.ts:44` `/.env.local` trả 200 thay vì ≥ 400 |
| `npm run bench` | Chưa chạy lại được trong môi trường đánh giá (thiếu PostgreSQL 16); số liệu là số PR tự ghi |

---

## 2. Quyết định đã chốt

| Chủ đề | Quyết định |
|---|---|
| Chế độ mở mặc định | Lưới dữ liệu cho mọi bảng, kể cả `promotions` |
| Dashboard | Thêm và sửa được bản ghi; xóa chỉ ở lưới |
| Thanh chọn dòng | Nổi ở đáy lưới, không đẩy nội dung |
| Frontend | JS thuần, tách module |
| Bản online | **Vercel.** Không dùng `chatgpt-site/`, Sites, Edge Function |
| `/api/admin/*` (đổi schema, formula, lookup) trên Vercel | **Giữ**, bắt buộc xem trước + chữ ký như hiện nay, và ghi log (bước E6) |
| Cache trong bộ nhớ của server | Chỉ sống theo từng instance serverless; không coi là nguồn dữ liệu |

---

## 3. Đã xong (kết quả đạt được)

| Hạng mục | Kết quả | Bằng chứng |
|---|---|---|
| 1.1 Lưới là chế độ mặc định | Mọi bảng mở ở lưới | e2e đạt |
| 1.2 Cột checkbox không trôi khi cuộn ngang | Ghim đúng | `delete-records.spec.ts` |
| 1.3–1.4 Lint, timeout e2e 15 s | `lint` hết lỗi; README có `PLAYWRIGHT_CHROMIUM_EXECUTABLE` | `lint` đạt |
| 2.1–2.4 Dashboard thêm/sửa, nút không nhảy | PATCH đúng khóa; form không có nút xóa | `table-overview.spec.ts` |
| 2.5–2.7 Thanh chọn nổi, ô chọn thẳng hàng, 390px | Có test từng hành vi | e2e đạt |
| 3.0 `scripts/bench.mjs` | Đo lặp lại được (PostgreSQL thật + proxy trễ + API giả lập) | `npm run bench` |
| 3.1–3.2 Cache cấu hình ở đường ghi, xóa cache đúng lúc | Metadata sau khi ghi 91 → 1 ms | unit test |
| 3.3 Một pool Postgres dùng chung | `server.mjs:19` tạo một pool `max:4`, giữ rảnh 5 phút, `keepAlive`, truyền cho `createAdmin` và `createLookupStore`. Pool trong `admin.mjs:15` chỉ là dự phòng khi không truyền pool | đọc mã |
| 3.4 Không tải lại trang sau khi lưu ô | Lưu 1 ô 275 → 65 ms | e2e |
| 3.5 Ghi hàng loạt 50 dòng | 13,9 s → 0,64 s; lỗi theo dòng, chống trùng khóa | unit test |
| 3.6–3.7 `limit` ≤ 1.000, `count=none` | Tổng quan 500 dòng 658 → 67 ms | unit test, e2e |
| 3.10 (phần trình duyệt) Metadata lần trước trong `localStorage` | Dựng sidebar và tải bảng ngay | e2e |
| 3.11 Dùng lại trang đã tải, tải trước trang kế | Quay lại trang không chờ mạng | e2e |
| 3.12 Cache lookup 60 giây | Sửa ô không liên quan thì không gọi lookup | e2e |
| 3.13 Tìm kiếm nhẹ hơn | Từ khóa ≥ 2 ký tự, đếm sau khi dừng gõ, chọn cột | e2e |

---

## 4. Cần sửa (tóm tắt, theo thứ tự làm)

| # | Việc | Vấn đề | Xong khi |
|---|---|---|---|
| A1 | Sửa e2e `/.env.local` | Vite dev server không chặn dotfile | e2e 78/78 |
| A2 | Gỡ snapshot metadata trên đĩa | `server.mjs` ghi `.siris-metadata-cache.json`; vô ích trên Vercel, lỗi ghi bị nuốt | Không còn ghi file |
| A3 | `npm test` không cần `build` trước | Thiếu `dist/` thì test lỗi 404 | Bản clone mới chạy `npm test` đạt |
| A4 | Bỏ plugin React/Tailwind khỏi `vite.config.ts` | Còn sót, không dùng | `build` và e2e đạt |
| B1–B3 | Đo nốt 3.10–3.12 bằng `bench.mjs` | Mục tiêu "mở ứng dụng 428 → ~80 ms", "quay lại trang tức thì", "lookup 0–1 lượt" chưa có số | Bảng đo không còn ô "chưa đo" |
| B4 | Đo trên Vercel | Mọi số hiện nay là mô phỏng | Có một bộ số thật |
| **Dừng** | **Dừng sau B4 để bạn kiểm tra** | | Bạn đồng ý mới làm tiếp |
| C1–C3 | Gỡ bản edge/Sites, sửa tài liệu | Còn file và test thừa | Không còn `chatgpt-site`, `siris-manager` |
| D1 | Tạo CI | Chưa có `.github/`; 2 test cache với PostgreSQL bị skip | Cả job xanh, 2 test chạy thật |
| E1–E6 | Dọn mã chết, tách module, thao tác nhanh, giao diện, bảo mật Vercel | Xem mục 5 | Theo từng bước |

---

## 5. Các bước chi tiết

Mỗi bước một commit; sau mỗi bước chạy `npm run lint`, `npm run typecheck`, `npm run build`, `npm test` và e2e.

### Giai đoạn A — Làm xanh và làm sạch nhánh

**A1. Sửa lỗi e2e `/.env.local`**
- Nguyên nhân: `vite.config.ts` không chặn dotfile, Vite trả `index.html` với mã 200.
- Việc: trong `vite.config.ts` thêm plugin có `configureServer(server)` đăng ký middleware chạy trước các middleware khác; trả 404 khi đường dẫn có đoạn bắt đầu bằng dấu chấm (`/\/\.[^/]/`), ví dụ `/.env.local`, `/.git/config`.
- Kiểm: `npx playwright test tests/e2e/auth.spec.ts:44`, rồi toàn bộ e2e. Kỳ vọng 78/78.
- Commit: "Chặn dotfile ở dev server".

**A2. Gỡ snapshot metadata ghi xuống đĩa**
- `server.mjs`: xóa `snapshotPath` (dòng 21), `snapshotIdentity` (22), `metadataSnapshot` và `snapshotWrite` (23), `saveMetadataSnapshot` (25) và các chỗ gọi ở dòng 24, 27, 30; ở dòng 53 bỏ nhánh trả snapshot kèm cờ `metadataStale`, `/api/meta` chỉ dùng `cachedMetadata()`.
- `app.js` (dòng 1076): giữ phần đọc `localStorage` (`siris-metadata-v1`); xóa nhánh `if(data.metadataStale){… '/api/meta?fresh=1' …}`.
- `.gitignore`: xóa 2 dòng `.siris-metadata-cache.json*`.
- Test: xóa unit test và e2e chỉ kiểm snapshot trên đĩa; giữ e2e "hiện cấu trúc đã lưu trước metadata" (kiểm `localStorage`).
- Kiểm: `grep -rn "snapshot\|metadataStale\|fresh=1" server.mjs app.js tests` không còn kết quả; e2e đạt.
- Commit: "Bỏ snapshot metadata trên đĩa, giữ bản trong localStorage".

**A3. `npm test` không phụ thuộc `build`**
- Nguyên nhân: `tests/server.test.js` chạy `server.mjs`, server trả 404 khi thiếu `dist/index.html`.
- Việc (chọn một, đề xuất cách 1): (1) thêm `"pretest": "vite build"`; hoặc (2) cho `server.mjs` đọc thư mục tĩnh từ biến `SIRIS_DIST_DIR`, test tự tạo thư mục tạm có `index.html` và asset giả.
- Kiểm: `rm -rf dist && npm test` đạt 72.
- Commit: "npm test tự dựng giao diện".

**A4. Bỏ plugin React và Tailwind khỏi Vite**
- Việc: bỏ `import react`, `import tailwindcss` và hai plugin khỏi `vite.config.ts`.
- Kiểm: `npm run build` ra `dist/`; e2e đạt.
- Commit: "Bỏ plugin React/Tailwind khỏi Vite".

### Giai đoạn B — Đo cho đủ

**B1. Chuẩn bị môi trường đo**
- Cài PostgreSQL 16, đặt `SIRIS_BENCH_PG_BIN=/đường/dẫn/postgresql/16/bin`, chạy `npm run bench`; lưu bảng làm số gốc mới (sai khác ±20% so với bảng ở phụ lục là bình thường).

**B2. Thêm 3 phép đo vào `scripts/bench.mjs`** (cần Chromium qua `PLAYWRIGHT_CHROMIUM_EXECUTABLE`)
1. "Mở ứng dụng tới khi thấy dữ liệu": Playwright mở trang, đo từ `goto` đến khi dòng đầu của lưới xuất hiện; chạy hai lần, lần 1 `localStorage` trống, lần 2 đã có `siris-metadata-v1`.
2. "Quay lại trang đã xem": chuyển trang 1 → 2 → 1, đo thời gian đến khi lưới trang 1 hiển thị lại.
3. "Số lượt lookup sau khi sửa 1 ô": đếm request `/api/lookup/*` sau một lần sửa ô trên bảng có cột lookup.
- Kiểm: bảng in ra có đủ 3 dòng mới ở cả mạng gần và mạng xa.
- Commit: "Đo mở ứng dụng, quay lại trang và lookup".

**B3. Cập nhật bảng số trong plan**
- Ghi "trước → sau" cho 3 dòng mới, so với mục tiêu 428 → ~80 ms, tức thì, 0–1 lượt. Dòng nào không đạt thì ghi lý do và mở bước sửa riêng.

**B4. Đo trên Vercel** (cần bạn thao tác hoặc cấp quyền Vercel)
1. Bật `SIRIS_PERF_TIMING=1` ở bản Preview (header `Server-Timing`).
2. Đo từ trình duyệt, không ghi dữ liệu thật: mở lúc nguội (đợi vài phút) và lúc ấm; tải trang 50 dòng; Tổng quan; chuyển bảng.
3. Ghi vùng Vercel Function và vùng project Supabase.
4. Kiểm `SUPABASE_DB_URL` dùng pooler (xem `VERCEL.md`).
- Xong khi: có bảng số thật cạnh bảng số mô phỏng.

> **Điểm dừng.** Sau B4 dừng lại để bạn kiểm tra kết quả. Không làm giai đoạn C trở đi khi bạn chưa đồng ý.

### Giai đoạn C — Gỡ edge/Sites

**C1. Xác nhận không còn phụ thuộc**
- `grep -rn "siris-manager\|chatgpt-site\|to-edge-backend\|prepare-chatgpt-site\|check-sites-backend\|auth.mjs"` trên `*.js`, `*.mjs`, `*.ts`, `*.json`, `*.md` (bỏ `node_modules`). Mọi kết quả phải nằm trong danh sách xóa ở C2.
- Xác nhận bản Vercel đang xác thực bằng đường nào; nếu `api/handler.mjs` import file trong danh sách thì dừng và hỏi.

**C2. Xóa**
- `supabase/functions/siris-manager/`, `scripts/prepare-chatgpt-site.mjs`, `scripts/check-sites-backend.mjs`, `scripts/to-edge-backend.mjs`, `tests/edge-backend.test.js`, `tests/sites-bridge.test.js`, dòng `chatgpt-site/` trong `.gitignore`.
- Kiểm: `npm run lint && npm test && npm run build`, rồi e2e.
- Commit: "Gỡ bản edge/Sites".

**C3. Sửa tài liệu**
- `README.md`, `ARCHITECTURE.md`: bỏ mọi chỗ nhắc edge, Sites, script chuẩn bị; ghi quy trình deploy `npm run build` rồi `vercel deploy --prod` với `SUPABASE_URL`, `SUPABASE_KEY`, `SUPABASE_DB_URL`.
- Kiểm: `grep -ri "chatgpt-site\|siris-manager\|Edge Function"` trả về rỗng.

### Giai đoạn D — CI

**D1. Tạo `.github/workflows/ci.yml`**
- Job 1 (không cần PostgreSQL): `npm ci`, `lint`, `typecheck`, `build`, `test`.
- Job 2 (có PostgreSQL 16): cài `postgresql-16`, đặt `SIRIS_BENCH_PG_BIN=/usr/lib/postgresql/16/bin`, chạy `npm test`; hai test đang bị skip sẽ chạy thật.
- Job 3: `npx playwright install chromium` và `npm run test:e2e`.
- Kiểm: đẩy nhánh, cả 3 job xanh.
- Commit: "Thêm CI cho lint, test và e2e".

### Giai đoạn E — Việc kế tiếp theo kế hoạch cũ

**E1. Dọn mã chết**
1. Backend `admin.mjs`: xóa `createDefinition`, `updateDefinition`, `deleteDefinition`, `readLinks`, `readNativeLinks`, `writeLinks`, `importLegacy` và hàm phụ chỉ chúng dùng; gộp 5 câu SQL metadata viết hai lần. Trước mỗi lần xóa `grep` tên hàm trong `server.mjs`, `app.js`, `tests/`; chạy `npm test` sau từng hàm.
2. Frontend: xóa luồng "managed column", `#relationPicker`, các lời gọi `/api/admin/definition/*` và `/api/admin/links/*`, 25 class CSS không dùng (liệt kê bằng script rồi rà tay); chạy e2e sau từng nhóm.
3. `package.json`: gỡ các gói thừa (`react`, `react-dom`, `@glideapps/glide-data-grid`, `@tanstack/react-query`, `@radix-ui/react-slot`, `class-variance-authority`, `clsx`, `tailwind-merge`, `lucide-react`, `@supabase/supabase-js`, `tailwindcss`, `@tailwindcss/vite`, `@vitejs/plugin-react`, `@types/react`, `@types/react-dom`).
4. Tài liệu: bỏ câu "API quản trị cấu trúc đang tạm khóa" và tham chiếu file không tồn tại.

**E2. Tách backend** (kiến trúc ở phụ lục)
1. Tạo `core/http.mjs`, `guard.mjs`, `router.mjs`, `app.mjs`, chưa chuyển route nào.
2. Chuyển từng nhóm route theo thứ tự `meta` → `table` → `lookup` → `formula` → `lookup-config` → `schema`; mỗi nhóm một commit, không đổi hành vi.
3. Chuyển `services/` (`data-api`, `cache`, `metadata`, `pool`) và 7 file `.mjs` ở gốc vào `core/db/`; bỏ biến `tables` toàn cục; dùng `safeError` cho mọi lỗi Postgres.
4. Thu gọn `server.mjs` thành lớp vỏ Node; `api/handler.mjs` là lớp vỏ Vercel dùng chung `createApp`.
5. Prettier cho backend, một commit riêng.

**E3. Tách frontend**
1. Prettier cho `app.js`, `index.html`, `style.css`, `tests/e2e/`, một commit riêng, ghi vào `.git-blame-ignore-revs`.
2. Tạo `src/state.js`, `api.js`, `storage.js`, `format.js`, `schema-utils.js`, `components/toast.js`; gom các khóa `localStorage` vào `storage.js`.
3. Tách theo vùng, mỗi vùng một commit: `custom-select`, `sidebar`, `chrome` (gồm `syncChrome`), `view/`, `grid/render`, `grid/selection` + `clipboard`, `grid/cell-edit` + `history`, `records/`, `columns/`, `lookup/`, `overview/`, rồi `main.js` thay `app.js`.
4. Gom hằng số và nghiệp vụ theo bảng vào `domain/tables.config.js`; đổi `promotionsMode` thành `overviewMode`.
5. Tách `style.css`; tách `auth.spec.ts` theo tính năng kèm `helpers/mock-api.ts`.
6. Bật `checkJs` cho JS.

**E4. Thao tác nhanh** (mỗi mục một test e2e)
1. Mũi tên di chuyển ô; gõ ký tự là vào sửa; Enter lưu và xuống dòng; Tab lưu và sang phải; Escape hủy.
2. Bấm ô khác khi đang sửa thì lưu ô cũ và chọn ô mới trong một lần bấm.
3. Menu trên tiêu đề cột (sắp xếp, lọc, nhóm, ẩn, ghim).
4. Phím tắt `/` và Ctrl/⌘+K.
5. Cỡ trang 50/100/200 theo bảng (dùng `limit` đã có).
6. Lưu nhiều thay đổi cột một lần.

**E5. Giao diện**
- Hiện tên thay mã cho khóa ngoại; form bản ghi gọn; thẻ bộ lọc; trạng thái lưu từng ô kèm Hoàn tác; thay hộp thoại gốc; bộ icon SVG; đổi "Dashboard" thành "Tổng quan"; bỏ chỉ số trùng.

**E6. Bản Vercel an toàn hơn**
1. Giới hạn đăng nhập sai theo IP; ghi log lần thất bại (không ghi mật khẩu).
2. Token CSRF theo phiên, không phải hằng số.
3. `/api/admin/*`: giữ, bắt buộc xem trước và chữ ký như hiện nay, thêm ghi log mỗi lần áp dụng thay đổi schema.

Chỉ làm khi có số đo chứng minh cần: phân trang theo khóa (bảng > 50.000 dòng), chỉ lấy cột đang hiển thị, tự host font, ghi một lượt cho lô lớn hơn 50.

---

## 6. Quy tắc làm việc

- Nhánh `claude/hopeful-gates-00krjq`; mỗi bước một commit.
- Không gộp thay đổi hành vi với thay đổi định dạng hay di chuyển file trong cùng một commit.
- Không sửa test để che lỗi.
- Không chạy ghi lên Supabase thật khi thử; kiểm thử ghi dùng API giả lập.
- Dừng ở B4 để người dùng kiểm tra trước khi làm tiếp.

## 7. Rủi ro

| Rủi ro | Cách giảm |
|---|---|
| Số đo giả lập khác thực tế | B4 đo trên Vercel; bảng ở phụ lục chỉ là đường cơ sở |
| Cache trong bộ nhớ lệch giữa các instance serverless | TTL 60 giây; trigger trong database vẫn bảo vệ dữ liệu |
| Xóa phần edge làm hỏng bản Vercel | C1 kiểm bằng `grep`; chạy preview deploy trước khi merge |
| Cache trình duyệt hiển thị cấu trúc cũ | Đối chiếu khi `/api/meta` trả về, vẽ lại nếu cấu trúc bảng đang mở đổi |
| Ghi hàng loạt thành công một phần | Kết quả theo từng dòng, hoàn nguyên dòng lỗi, không tự gửi lại |
| Tách module làm đổi hành vi | Mỗi vùng một commit, e2e chạy sau từng commit |

## 8. Bảng trạng thái

| Giai đoạn | Nội dung | Trạng thái |
|---|---|---|
| Đã xong | Mục 3 (1.1–1.4, 2.1–2.7, 3.0–3.7, 3.10 phần trình duyệt, 3.11–3.13) | Xong |
| A | Làm xanh và làm sạch nhánh | Chưa bắt đầu |
| B | Đo (B1–B3 mô phỏng, B4 trên Vercel) | Chưa bắt đầu; **dừng sau B4 để kiểm tra** |
| C | Gỡ edge/Sites | Chưa bắt đầu (sau điểm dừng) |
| D | CI | Chưa bắt đầu |
| E | Dọn mã chết, tách module, thao tác nhanh, giao diện, bảo mật Vercel | Chưa bắt đầu; `/api/admin/*` đã chốt giữ |

---

## 9. Phụ lục

### 9.1 Số đo tốc độ

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

#### Số gốc từ `scripts/bench.mjs` (12/11/2026)

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

#### Đo lại sau tối ưu (12/11/2026)

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

### 9.2 Tốc độ đọc

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

Bổ sung mục 9.1: ba dòng mục tiêu chưa có số (mở ứng dụng ~80 ms, quay lại trang tức thì, lookup 0–1 lượt) sẽ được đo ở B2–B3.

### 9.3 Kiến trúc đích

#### 9.3.1 Tổng thể

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

#### 9.3.2 Backend

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

#### 9.3.3 Frontend

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

#### 9.3.4 Kiểm thử

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

# Kế hoạch triển khai Siris

Cập nhật 12/11/2026, sau khi đánh giá PR #3 (chạy lại lint, typecheck, build, test, e2e và đọc mã từng bước). Bản online chạy trên **Vercel**; `chatgpt-site/` (Sites) và Supabase Edge Function không còn dùng.

Mục lục:
1. Tình hình hiện tại
2. Quyết định đã chốt
3. Hiện trạng chi tiết
4. Thứ tự công việc
5. Các bước chi tiết
6. Quy tắc làm việc
7. Rủi ro
8. Bảng trạng thái
9. Phụ lục: số đo tốc độ

---

## 1. Tình hình hiện tại

Nhánh `claude/hopeful-gates-00krjq` đã được merge với `main` (cả 20 file xung đột đã giải quyết) để PR #3 là PR duy nhất, trên một nhánh duy nhất. Cách giải quyết: **lấy code và test của `main`** cho mọi file xung đột, vì `main` đã tách `server.mjs` thành `server/` và `app.js` thành `src/`; giữ plan này, `scripts/bench.mjs`, script `bench` và mục README về đo hiệu năng.

Các thay đổi tốc độ viết trên nền cũ của PR #3 (commit `d21eac0`) đã được chuyển sang cấu trúc `server/` và `src/` (giai đoạn P). Bản edge/Sites đã gỡ (C), đã có CI (D), đã gom `localStorage`, tách e2e và tăng bảo mật Vercel (E). **Còn lại: sửa CI đang đỏ (H1) và các việc dọn trong giai đoạn H, rồi đo một lần trên Vercel (G).**

Kết quả kiểm tra sau merge:

| Lệnh | Kết quả |
|---|---|
| `npm run lint` | Đạt |
| `npm run typecheck` | Đạt (TypeScript và `checkJs`) |
| `npm run build` | Đạt |
| `npm test` | 88 đạt, 1 bỏ qua (test benchmark cần `SIRIS_BENCH_PG_BIN`); `pretest` tự build giao diện trước khi chạy |
| `npm run test:e2e` | **108/108 đạt** |
| `npm run bench` | Đạt với PostgreSQL 16.15 và Chromium; số đo ở mục 9.1 (người đánh giá chưa chạy lại được vì thiếu PostgreSQL) |
| CI GitHub (commit `53a56a0`) | **Đỏ**: `checks` đạt; `bench-cache` lỗi `Unable to locate package postgresql-16`; `e2e` lỗi `Playwright does not support chromium on ubuntu26.04-x64` (vì `ubuntu-latest` nay là Ubuntu 26.04) |

---

## 2. Quyết định đã chốt

| Chủ đề | Quyết định |
|---|---|
| Chế độ mở mặc định | Lưới dữ liệu cho mọi bảng, kể cả `promotions` |
| Tổng quan | Thêm và sửa được bản ghi; xóa chỉ ở lưới |
| Thanh chọn dòng | Nổi ở đáy lưới |
| Frontend | JS thuần, module trong `src/` |
| Bản online | **Vercel** (`vercel.json`, `api/handler.mjs`, `server/vercel.mjs`, đăng nhập phiên ký). Không dùng `chatgpt-site/`, Sites, Edge Function |
| `/api/admin/*` trên Vercel | **Giữ**, bắt buộc xem trước + chữ ký, thêm ghi log (E6) |
| Cache trong bộ nhớ của server | Chỉ sống theo instance serverless; không coi là nguồn dữ liệu |
| Một PR, một nhánh | PR #3 trên `claude/hopeful-gates-00krjq`; không mở PR hay nhánh khác |

---

## 3. Hiện trạng chi tiết

### 3.1 Đã có trên nhánh (từ `main`, e2e đạt)

| Hạng mục | Ghi chú |
|---|---|
| Nút bấm, Tổng quan thêm/sửa, thanh chọn nổi, 390px | `src/chrome.js` (`syncChrome`), e2e `chrome`, `table-overview`, `delete-records` |
| Cấu trúc | Backend ở `server/` (`app.mjs`, `routes/*`, `context.mjs`), frontend ở `src/`; đã gỡ React/Glide/Tailwind; Prettier; `checkJs` |
| Cache server | `server-cache.mjs` (TTL, xóa theo sự kiện); ghi dữ liệu không xóa cache cấu hình |
| Đọc/ghi | Không tải lại trang sau khi lưu ô (`cell-save.spec`), `limit` ≤ 1.000 cho Tổng quan, `group-counts`, `pageCache`, làm mới nền (`background-refresh.spec`), cỡ trang 50/100/200 (`paging.spec`) |
| Thao tác | Bàn phím, menu tiêu đề cột, `/` và Ctrl/⌘+K, thẻ bộ lọc, hoàn tác sau lưu |
| Dev server | Chặn dotfile (`denyDotfiles` trong `vite.config.ts`) |
| Bản online | `vercel.json`, `api/handler.mjs`, `VERCEL.md`, đăng nhập phiên ký, `tests/vercel.test.js` |

### 3.2 Phần tốc độ đã chuyển từ `d21eac0` (giai đoạn P — xong)

| Mã | Tính năng | Commit |
|---|---|---|
| P1 | Pool Postgres dùng chung, giữ kết nối rảnh 5 phút, `keepAlive` | `afb7ffa` |
| P2 | `count=none`, dùng lại tổng khi chuyển trang | `d5d766e` |
| P3 | `POST /api/table/:name/batch` (≤ 50 dòng, 5 lượt song song, lỗi theo dòng, chống trùng khóa) và `pasteCells` gửi một request | `c2c5ee4` |
| P4 | Cache lookup phía trình duyệt 60 giây | `cba5541` |
| P5 | Hiện trang đã tải rồi làm mới nền; tải trước trang kế và bảng khi rê chuột | `07529fd` |
| P6 | Metadata lần trước trong `localStorage` | `1e33d98` |
| P7 | Tìm kiếm: từ khóa ≥ 2 ký tự, `searchColumn`, đếm sau khi dừng gõ | `a8473df`, `bcf6eac` |

Không chuyển: snapshot metadata ghi xuống đĩa (vô ích trên Vercel).

### 3.3 Lỗi và điểm yếu còn lại (xử lý ở giai đoạn H)

| Mã | Vấn đề | Mức |
|---|---|---|
| H1 | **CI đỏ**: job `bench-cache` và `e2e` lỗi do runner Ubuntu 26.04 (không có `postgresql-16`, Playwright 1.55.1 không hỗ trợ). Test `bench-cache` chưa từng chạy xanh ở đâu | Cao |
| H2 | Phiên bản Node không đồng bộ: CI dùng 22, project Vercel dùng 26.x, `engines` ghi `>=20`; cảnh báo `actions/checkout@v4`, `setup-node@v4` chạy Node 20 sắp bị bỏ | Thấp |
| H3 | `VERCEL.md` chưa ghi: giới hạn đăng nhập sai nằm trong bộ nhớ từng instance (chỉ làm chậm, không chặn hẳn), các sự kiện log (`login_failed`, `login_blocked`, `schema_apply`), và việc đổi định dạng cookie làm mất mọi phiên đăng nhập cũ khi deploy lần đầu | Trung bình |
| H4 | Giới hạn đăng nhập sai chưa dùng kho dùng chung | Quyết định |
| H5 | `ARCHITECTURE.md` chưa mô tả `src/storage.js`, `scripts/bench.mjs`, bộ test e2e đã tách | Thấp |
| H6 | Mô tả PR #3 lỗi thời (vẫn nói "grid-first", "overview editing", số liệu cũ) | Trung bình |
| H7 | Hai mục tiêu tốc độ chưa đạt: mở ứng dụng ≈ 146–202 ms (mục tiêu 80 ms), ghi 50 dòng nối tiếp 3.175 ms (mục tiêu < 1 s) | Chấp nhận / ghi rõ |
| H8 | Số đo mới chỉ là mô phỏng; chưa đo trên Vercel | Làm ở G |

---

## 4. Thứ tự công việc

| # | Việc | Xong khi |
|---|---|---|
| A3 | `npm test` không cần `build` trước | Xong |
| P1–P7 | Chuyển phần tốc độ từ `d21eac0` sang cấu trúc mới | Xong |
| B1–B3 | Chạy `bench`, đo mở ứng dụng, quay lại trang, lookup | Xong (xem F cho các điểm yếu của phép đo) |
| F | Sửa điểm yếu của phép đo và test cache | Phép đo "quay lại trang" đếm request thay vì `waitFor`; test cache PostgreSQL chạy được; mục tiêu "mở ứng dụng" ghi lại theo giới hạn thật |
| C1–C3 | Gỡ edge/Sites, sửa tài liệu | Không còn `chatgpt-site`, `siris-manager` |
| D1 | Tạo CI | Cả ba job được định nghĩa; test cache chạy thật khi có PostgreSQL |
| E1–E4 | Rà mã chết, `storage`, tách e2e, bảo mật Vercel | Từng bước xong, mỗi bước một commit |
| H1–H6 | Sửa các lỗi còn lại (mục 3.3) | CI xanh cả ba job, tài liệu và mô tả PR khớp thực tế |
| **G (B4)** | **Đo một lần trên Vercel sau khi xong hết** | Có bộ số thật cho bản cũ và bản mới |

Không còn điểm dừng giữa chừng: F → C → D → E đã xong; làm tiếp H rồi mới đo G một lần.

Đã hủy so với bản plan trước, vì `main` đã làm: A1 (dotfile, có `denyDotfiles`), A2 (snapshot đĩa, mã đã không còn), A4 (plugin React/Tailwind đã gỡ), tách backend/frontend thành module, thao tác nhanh và giao diện (giai đoạn 5–8 cũ).

---

## 5. Các bước chi tiết

Mỗi bước một commit; sau mỗi bước chạy `npm run lint`, `npm run typecheck`, `npm run build`, `npm test` và e2e. Nguồn mã để chuyển: `git show d21eac0:<file>` và `git diff e98c485 d21eac0 -- <file>`.

### A3. `npm test` không phụ thuộc `build`
- Nguyên nhân: `tests/server.test.js` chạy `server.mjs`, server trả 404 khi thiếu `dist/index.html`.
- Việc (đề xuất): thêm `"pretest": "vite build"` vào `package.json`; hoặc cho server đọc thư mục tĩnh từ biến `SIRIS_DIST_DIR` và để test tự tạo thư mục tạm.
- Kiểm: `rm -rf dist && npm test`.
- Commit: "npm test tự dựng giao diện".

### Giai đoạn P — Chuyển phần tốc độ sang cấu trúc mới

**P1. Pool giữ kết nối**
- File: `server/context.mjs` (nơi tạo pool). Đặt `idleTimeoutMillis: 300000`, `keepAlive: true`; đảm bảo `createAdmin` và `createLookupStore` dùng chung một pool (như `server.mjs:19` ở `d21eac0`).
- Test: unit test kiểm cấu hình pool.

**P2. `count=none`**
- File: `server/routes/table.mjs` (đọc `count`; khi `none` không gửi `Prefer: count=exact`, trả `total: null`); `src/grid/render.js` (chỉ yêu cầu đếm khi bảng, bộ lọc hoặc tìm kiếm đổi; dùng lại tổng khi chuyển trang).
- Test: unit `tests/server.test.js` (lấy từ `d21eac0`); e2e "chuyển trang dùng lại tổng, tìm kiếm đếm lại".

**P3. Ghi hàng loạt**
- File: `server/routes/table.mjs` thêm `POST /api/table/:name/batch`: tối đa 50 thay đổi `{key, values, expected}`; 5 lượt song song tới Data API; kết quả theo từng dòng; từ chối trùng khóa trong lô; kiểm tra khóa chính và cột bảo vệ như PATCH đơn. `src/grid/selection.js` (`pasteCells`) gửi một request, hoàn nguyên dòng lỗi.
- Test: unit "ghi lô tối đa 50 dòng, báo lỗi từng dòng" (từ `d21eac0`); e2e dán nhiều dòng giữ nguyên giá trị bigint.

**P4. Cache lookup**
- File: `src/lookup.js`. Cache theo (bảng nguồn, cột đối chiếu, giá trị), sống 60 giây; mỗi lần tải chỉ gọi giá trị chưa có; xóa khi ghi bảng nguồn.
- Test: e2e "sửa một ô không liên quan thì không có request lookup".

**P5. Dùng lại trang và tải trước**
- File: `src/grid/render.js`, `src/sidebar.js`. Mọi lần tải hiện ngay trang trong cache bất kể tuổi rồi làm mới nền; dùng `epoch` bỏ kết quả cũ; giới hạn cache 100 mục; tải trước trang kế; rê chuột lên tên bảng quá 150 ms thì tải trước trang đầu.
- Test: e2e "quay lại trang đã xem hiện ngay và cập nhật sau làm mới nền".

**P6. Metadata lần trước trong `localStorage`**
- File: `src/main.js`. Khóa `siris-metadata-v1`; dựng sidebar và tải bảng ngay; đối chiếu khi `/api/meta` trả về, vẽ lại nếu cấu trúc bảng đang mở đổi.
- Test: e2e "hiện cấu trúc đã lưu trước metadata và cập nhật cột thay đổi".

**P7. Tìm kiếm**
- File: `src/grid/render.js`, `filters.mjs`. Từ khóa < 2 ký tự không gửi; `searchColumn` tìm trên một cột; chỉ đếm sau khi dừng gõ.
- Test: unit `tests/filters.test.js`; e2e "tìm từ hai ký tự, đếm sau khi dừng và chọn cột".

Xong giai đoạn P khi: e2e và unit test của từng mục (lấy từ `d21eac0`) đều đạt trên cấu trúc mới.

### Giai đoạn B — Đo

**B1.** Cài PostgreSQL 16, đặt `SIRIS_BENCH_PG_BIN`, chạy `npm run bench`. Nếu `bench.mjs` không khởi động được với `server.mjs` mới (biến môi trường, đăng nhập) thì sửa trước; lưu bảng làm số gốc mới.
**B2.** Thêm 3 phép đo vào `scripts/bench.mjs` (cần Chromium qua `PLAYWRIGHT_CHROMIUM_EXECUTABLE`): (1) mở ứng dụng tới khi thấy dữ liệu, hai lần (`localStorage` trống và đã có `siris-metadata-v1`); (2) quay lại trang đã xem (1 → 2 → 1); (3) số request `/api/lookup/*` sau khi sửa 1 ô.
**B3.** Ghi "trước → sau" vào mục 9.1; dòng nào không đạt mục tiêu (428 → ~80 ms, tức thì, 0–1 lượt) thì ghi lý do và mở bước sửa.
### Giai đoạn F — Sửa điểm yếu của phép đo (sau đánh giá push `cd1d7a7`)

**F1.** `scripts/bench.mjs`: đo "quay lại trang đã xem" bằng số request mạng phải chờ và thời điểm lưới hiển thị đo trong trang (`performance.now()`), thay cho `waitFor`.
**F2.** Test cache PostgreSQL: thêm `tests/bench-cache.test.js` gọi `node scripts/bench.mjs --verify-cache`, `describe.skipIf(!process.env.SIRIS_BENCH_PG_BIN)`.
**F3.** Mục tiêu "mở ứng dụng": ghi lại thành "≈ một lượt API + tải trang" (đo được 146 ms đã lưu cấu trúc, 202 ms lần đầu), vì số 428 ms cũ là đo phía server, không so trực tiếp với đo bằng trình duyệt.
**F4.** Sửa số test trong plan thành 90 đạt + 1 bỏ qua (test benchmark), hoặc 91 đạt khi chạy với `SIRIS_BENCH_PG_BIN`.

### Giai đoạn C — Gỡ edge/Sites

**C1.** `grep -rn "siris-manager\|chatgpt-site\|prepare-chatgpt-site\|check-sites-backend\|edge-files\|server/edge\|sites-bridge"` ngoài `node_modules`; mọi kết quả phải nằm trong danh sách xóa. Xác nhận `api/handler.mjs` và `server/vercel.mjs` không import file nào trong danh sách; `server/session-auth.mjs` là đường đăng nhập của Vercel, giữ.
**C2.** Xóa: `supabase/functions/siris-manager/`, `server/edge.mjs`, `scripts/prepare-chatgpt-site.mjs`, `scripts/check-sites-backend.mjs`, `scripts/edge-files.mjs`, `tests/sites-bridge.test.js`, `tests/edge-backend.test.js`, dòng `chatgpt-site/` trong `.gitignore`. Kiểm lint, test, build, e2e, `tests/vercel.test.js`.
**C3.** Sửa `README.md`, `ARCHITECTURE.md`, `VERCEL.md`: bỏ mọi chỗ nhắc edge, Sites; một quy trình deploy `vercel deploy --prod`. Kiểm: `grep -ri "chatgpt-site\|siris-manager\|Edge Function"` rỗng.

### Giai đoạn D — CI

**D1.** Tạo `.github/workflows/ci.yml`: job 1 `npm ci`, `lint`, `typecheck`, `build`, `test`; job 2 có PostgreSQL 16 và `SIRIS_BENCH_PG_BIN=/usr/lib/postgresql/16/bin` để hai test cache chạy thật; job 3 `npx playwright install chromium` và `npm run test:e2e`.

### Giai đoạn E — Phần còn lại

**E1. Rà soát mã chết** (nhiều thứ đã xong ở `main`: không còn `managedColumns`, `createDefinition`, `relationPicker`, 15 dependency đã gỡ). Việc còn: xác nhận không còn code đọc bảng `siris_admin.columns`; `grep` các class CSS không dùng; bỏ câu lỗi thời trong README.
**E2. `storage` cho `localStorage`:** gom mọi khóa (kể cả `siris-metadata-v1` và khóa cache) vào một module có phiên bản, đọc/ghi an toàn; bỏ đường lưu lookup trên trình duyệt.
**E3. Tách `tests/e2e/auth.spec.ts`** theo tính năng; gom giả lập API vào `tests/e2e/helpers/mock-api.ts`.
**E4. Vercel an toàn hơn:** giới hạn đăng nhập sai theo IP và ghi log lần thất bại (không ghi mật khẩu); token CSRF theo phiên; `/api/admin/*` giữ, bắt buộc xem trước và chữ ký, ghi log mỗi lần áp dụng thay đổi schema.

### Giai đoạn H — Sửa các lỗi còn lại

Mỗi bước một commit; bước H1 phải xong và CI xanh trước khi sang các bước khác.

**H1. Sửa CI đỏ**
- File: `.github/workflows/ci.yml`.
- Việc: đổi `runs-on: ubuntu-latest` thành `runs-on: ubuntu-24.04` cho cả ba job (`checks`, `bench-cache`, `e2e`) để mọi job chạy trên cùng một hệ điều hành mà Playwright 1.55.1 và gói `postgresql-16` hỗ trợ. (Cách khác, chỉ dùng nếu muốn runner mới nhất: nâng Playwright lên phiên bản hỗ trợ Ubuntu 26.04 và cài PostgreSQL 16 từ kho `apt.postgresql.org`; không khuyên vì tốn công hơn.)
- Kiểm: đẩy nhánh, xem `actions_list` / trang Actions: ba job đều xanh; log job `bench-cache` phải có `bench-cache.test.js` **đạt** (không phải `skipped`) và dòng `Kiểm tra cache và pool sau hai lần ghi: đạt`; job `e2e` chạy đủ 108 test.
- Commit: "CI chạy trên Ubuntu 24.04".

**H2. Đồng bộ phiên bản Node và actions**
- Việc: chạy `checks` với Node 22 và 24 bằng `matrix`; ghi phiên bản Node được hỗ trợ trong `README.md` và `engines`; nâng `actions/checkout`, `actions/setup-node` lên bản chạy Node 24 khi có (hoặc đặt `FORCE_JAVASCRIPT_ACTIONS_TO_NODE24`) để hết cảnh báo.
- Kiểm: CI xanh, không còn cảnh báo Node 20 deprecated.

**H3. Ghi tài liệu bảo mật Vercel**
- File: `VERCEL.md`.
- Việc: thêm mục "Đăng nhập và log" gồm: ngưỡng 10 lần sai trong 15 phút theo IP, chỉ nằm trong bộ nhớ từng instance (chỉ làm chậm); tên các sự kiện log `login_failed`, `login_blocked`, `schema_apply` và cách xem bằng `vercel logs`; việc đổi định dạng cookie phiên làm mọi người phải đăng nhập lại sau lần deploy đầu.
- Kiểm: đọc lại cùng mã `server/vercel.mjs`, `server/routes/schema.mjs` để tên sự kiện và ngưỡng khớp.

**H4. (Cần bạn quyết) Giới hạn đăng nhập sai dùng kho chung**
- Phương án mặc định: **không làm**, chấp nhận rủi ro vì app một người dùng, phiên 8 giờ, mật khẩu ≥ 16 ký tự và chặn thêm ở Vercel Firewall nếu cần.
- Nếu muốn chặn chắc: dùng Vercel Firewall rate limit cho `/auth/login` (cấu hình trên Vercel, không sửa mã) hoặc kho dùng chung (Marketplace Redis, hoặc bảng trong `siris_admin`).

**H5. Cập nhật `ARCHITECTURE.md`**
- Việc: mô tả `src/storage.js` (mọi khóa `localStorage`, có phiên bản), `scripts/bench.mjs` và `npm run bench`, bộ test e2e theo tính năng (`cell-edit`, `columns`, `grid`, `lookup`, `records`, `relations`, `perf`...), CI ba job.
- Kiểm: mọi tên file trong tài liệu có trong repo (`git ls-files`).

**H6. Viết lại mô tả PR #3**
- Nội dung: (1) chuyển phần tốc độ sang `server/` và `src/` (P1–P7) kèm số đo mô phỏng và ghi rõ là mô phỏng; (2) gỡ edge/Sites; (3) CI; (4) gom `localStorage`, tách e2e; (5) giới hạn đăng nhập, CSRF theo phiên, log schema; (6) hai mục tiêu tốc độ chưa đạt (H7) và việc đo Vercel còn lại; (7) phần "Merge Danger" cập nhật: phiên đăng nhập cũ mất khi deploy.
- Bỏ các câu về "grid-first" và "overview editing" vì đã có từ trước.

**H7. Ghi nhận hai mục tiêu chưa đạt (không sửa mã)**
- Mở ứng dụng: giữ ghi chú "≈ một lượt API + tải trang"; chỉ thử giảm tiếp nếu số đo ở G cho thấy chờ lâu hơn bảng mô phỏng.
- Ghi 50 dòng nối tiếp: đường dán/sửa hàng loạt đã dùng lô (630 ms); chỉ làm nếu có luồng thật gửi nối tiếp nhiều dòng.

Xong giai đoạn H khi: CI xanh cả ba job trên commit mới nhất, `grep -ri "ubuntu-latest" .github` rỗng, và mô tả PR đã cập nhật.

### Giai đoạn G (B4) — Đo một lần trên Vercel

Làm sau cùng, khi F, C, D, E, H đã xong, CI xanh và đã push. Người dùng thao tác (sandbox không truy cập được `vercel.app`, và biến môi trường của app là bí mật).

1. Clone sạch nhánh vào thư mục riêng, `npx vercel link --project siris-supabase-manager --scope lucas-projects-5f5d0170`.
2. Thêm 6 biến Preview: `SUPABASE_URL`, `SUPABASE_KEY`, `SUPABASE_DB_URL`, `SIRIS_LOGIN_USER`, `SIRIS_LOGIN_PASSWORD` (giá trị giống production) và `SIRIS_PERF_TIMING=1`; `npx vercel deploy` (không `--prod`).
3. Đăng nhập cả bản production cũ (`a189b16`) và Preview mới, chờ ≥ 15 phút để nguội.
4. Chạy script đo ở tab Console của từng bản (`/api/meta`, trang 1, `count=none`, trang 2, `limit=1000`, mỗi phép 5 lần; ghi cả `Server-Timing`) và hai lần tải lại để đo "mở ứng dụng" (xóa và giữ `siris-metadata-v1`).
5. Ghi vùng Vercel (`iad1`) và vùng Supabase; kiểm `SUPABASE_DB_URL` dùng pooler.
6. Dán kết quả vào mục 9.1; dọn biến Preview.
Xong khi: có bảng số thật cho cả hai bản cạnh bảng mô phỏng.

Chỉ làm khi có số đo chứng minh: phân trang theo khóa (bảng > 50.000 dòng), chỉ lấy cột đang hiển thị, ghi một lượt cho lô lớn hơn 50.

---

## 6. Quy tắc làm việc

- Một PR (#3), một nhánh `claude/hopeful-gates-00krjq`; mỗi bước một commit.
- Không gộp thay đổi hành vi với thay đổi định dạng hay di chuyển file trong cùng một commit.
- Không sửa test để che lỗi.
- Không chạy ghi lên Supabase thật khi thử.
- Làm hết F → C → D → E → H rồi mới đo G một lần; không dừng giữa chừng.

## 7. Rủi ro

| Rủi ro | Cách giảm |
|---|---|
| Chuyển P1–P7 làm đổi hành vi | Mỗi mục một commit, mang theo test từ `d21eac0`, e2e sau mỗi commit |
| Số đo giả lập khác thực tế | B4 đo trên Vercel |
| Cache trong bộ nhớ lệch giữa các instance serverless | TTL 60 giây; trigger trong database vẫn bảo vệ dữ liệu |
| Xóa phần edge làm hỏng bản Vercel | C1 kiểm `grep`; chạy `tests/vercel.test.js` và preview deploy |
| Ghi hàng loạt thành công một phần | Kết quả theo từng dòng, hoàn nguyên dòng lỗi, không tự gửi lại |
| `bench.mjs` viết cho `server.mjs` cũ | B1 kiểm trước khi tin số đo |

## 8. Bảng trạng thái

| Giai đoạn | Nội dung | Trạng thái |
|---|---|---|
| Merge `main` | Giải quyết 20 file xung đột; lint, typecheck, build, test, e2e 105/105 đạt | **Xong** |
| A3 | `npm test` tự dựng giao diện | **Xong** (`pretest: vite build`) |
| P1–P7 | Chuyển phần tốc độ từ `d21eac0` | **Xong**; mỗi mục có test unit/e2e tương ứng |
| B1–B3 | Đo mô phỏng (PostgreSQL 16.15, Chromium) | **Xong** |
| F | Sửa điểm yếu của phép đo, test cache PostgreSQL | **Xong** (F1–F4) |
| C | Gỡ edge/Sites | **Xong** (C1–C3) |
| D | CI | File `.github/workflows/ci.yml` đã có nhưng **CI đang đỏ** (xem H1) |
| E | Rà mã chết, `storage`, tách e2e, bảo mật Vercel | **Xong** (E1–E4); tài liệu và giới hạn đăng nhập xem H3–H4 |
| H | Sửa các lỗi còn lại: CI đỏ (H1), Node (H2), tài liệu (H3, H5), mô tả PR (H6) | **Chưa làm**; H4 chờ quyết định |
| G (B4) | Đo một lần trên Vercel | Sau H, do người dùng thao tác |

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

#### Đo lại trên nhánh sau merge (12/11/2026)

Cùng PostgreSQL 16.15 và API giả lập, hai mức trễ 60/40 ms và 150/100 ms. Ba dòng cuối dùng Chromium thật qua Playwright. Đây là một lần chạy, không phải cam kết thời gian trên mạng thật.

| Thao tác | Mạng gần | Mạng xa |
|---|---:|---:|
| Metadata lần đầu | 152 ms | 339 ms |
| Metadata trong cache | 3 ms | 4 ms |
| Đọc 50 dòng | 81 ms | 165 ms |
| Lưu một ô | 67 ms | 156 ms |
| Lưu ô liên tiếp | 64 ms | 154 ms |
| Metadata sau khi ghi | 1 ms | 1 ms |
| Sửa ô và tải lại | 127 ms | 307 ms |
| Lưu ô sau 11 giây | 66 ms | 158 ms |
| Ghi 50 dòng nối tiếp | 3.175 ms | 7.669 ms |
| Ghi lô 50 dòng | 630 ms | 1.526 ms |
| Tổng quan 500 dòng | 64 ms | 154 ms |
| Mở ứng dụng tới khi thấy dữ liệu (lần đầu) | 202 ms | 386 ms |
| Mở ứng dụng tới khi thấy dữ liệu (đã lưu cấu trúc) | 146 ms | 243 ms |
| Quay lại trang đã xem | 5 ms | 6 ms |
| Yêu cầu lookup sau khi sửa một ô | 0 | 0 |

Nhận xét:

- Mục tiêu đạt: metadata sau khi ghi ~2 ms (đo được 1 ms), ghi lô 50 dòng dưới 1 giây ở mạng gần (630 ms), Tổng quan 500 dòng ~70 ms (64 ms), lưu ô và lưu sau 11 giây ~65 ms (67/66 ms), lookup 0–1 lượt.
- Mục tiêu "mở ứng dụng" ghi lại thành "≈ một lượt API + tải trang": đo được 149 ms khi đã lưu cấu trúc và 223 ms lần đầu (mạng gần). Số 428 ms cũ đo phía server, không so trực tiếp với phép đo bằng trình duyệt. Phần còn lại là metadata lần đầu ~153 ms và trang đầu ~82 ms.
- Quay lại trang đã xem: lưới vẽ lại sau 5 ms (gần) và 6 ms (xa); **0 request mạng hoàn tất trước khi vẽ**, 1 request làm mới nền vẫn chạy. Phép đo cũ dùng `waitFor` nên ghi 73/82 ms và không chứng minh được điều này.
- Ghi 50 dòng nối tiếp vẫn gửi 50 yêu cầu tới Data API nên chưa đạt mục tiêu dưới 1 giây; đường dán/sửa hàng loạt đã dùng lô (630 ms).
- Bảng bench không cấu hình cột lookup, nên phép đo lookup xác nhận "không phát sinh yêu cầu" chứ chưa đo trường hợp có lookup.

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

Lưu ý: bảng "Đo lại sau tối ưu" phía trên đo trên mã PR #3 cũ (`d21eac0`). Bảng "Đo lại trên nhánh sau merge" là số hiện tại của nhánh này; các mục tiêu chưa đạt được ghi lý do ngay dưới bảng đó.

Kiến trúc hiện tại của mã (thư mục `server/`, `src/`) xem `ARCHITECTURE.md`.

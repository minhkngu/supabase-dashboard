# AGENTS.md

Hướng dẫn cho agent làm việc trong repo này. Tổng quan, cấu hình và tính năng xem `README.md`; việc đang dở xem `plan/`.

## Lệnh

```sh
npm run dev            # Vite :3000 + máy chủ Node :3001 (Vite chuyển /api sang)
npm run lint
npm run format:check   # Prettier; npm run format để sửa. *.md không qua Prettier
npm run typecheck      # tsc cho *.ts và checkJs (tsconfig.js.json) cho *.js/*.mjs
npm test               # pretest chạy vite build trước
npm run test:e2e       # Playwright tự chạy npm run dev; cổng 3000 phải trống
```

Chạy một test:

```sh
npx vitest run tests/filters.test.js
npx vitest run -t "tên test"
npx playwright test tests/e2e/grid.spec.ts
npx playwright test -g "tên test"
```

`npx vitest` không chạy `pretest`: `tests/server.test.js` cần `dist/`, nên `npm run build` trước nếu chưa có. `tests/bench-cache.test.js` bị bỏ qua khi thiếu `SIRIS_BENCH_PG_BIN`.

## Kiến trúc tổng thể

- Một bộ xử lý request (`server/app.mjs`) dùng cho cả hai đường: `server.mjs` (cục bộ, bind 127.0.0.1, token CSRF ngẫu nhiên mỗi lần chạy) và `api/handler.mjs` → `server/vercel.mjs` (đăng nhập cookie ký, CSRF suy từ phiên, đổi Host/Origin thành loopback trước khi chuyển vào app, `liveMetadataEachRequest`). Sửa hành vi API ở `server/`, không ở adapter.
- Dữ liệu bảng đi qua Supabase Data API (PostgREST) bằng key ở máy chủ, nên chịu RLS. Kết nối PostgreSQL trực tiếp (`SUPABASE_DB_URL`, một pool trong `server/context.mjs`) chỉ dùng cho metadata, thay đổi cột, lookup, formula và `ui_settings`. Thiếu nó thì metadata lấy từ `schema.json`.
- Metadata trực tiếp lọc theo quyền của role `anon` (`admin.visibleMetadata('anon')`). `ctx.meta(name)` là danh sách trắng bảng: mọi route nhận tên bảng phải gọi nó trước.
- Lookup đồng bộ và formula là trigger PL/pgSQL tạo trong schema `siris_admin`; cấu hình lưu ở `siris_admin.lookup_configs` / `formula_configs`. Lookup và formula kiểm tra chéo lẫn nhau (không vòng, không dùng cột của nhau) ở cả `lookup-sync.mjs`, `formula-sync.mjs` và `server/context.mjs` (`assertNotUsedByFormula`).
- Frontend là JS thuần, trạng thái chung trong `src/state.js`. `app.js` gọi các `init*` theo thứ tự cố định; thứ tự này có ý nghĩa (`initSidebar2`, `initViewMenus2` chạy sau các module khác).

## Quy ước bắt buộc

- **SQL**: tên bảng/cột phải qua regex `^[a-zA-Z_][a-zA-Z0-9_]{0,62}$` rồi đặt trong `"…"` (các hàm `validName`/`ident`/`quote`); giá trị truyền bằng tham số `$1`. Không nối giá trị người dùng vào SQL.
- **Thay đổi cấu trúc**: luôn theo `preview` → chữ ký SHA-256 → `apply` (khóa bảng, preview lại, so chữ ký, một transaction) trong `admin.mjs`. Lookup cũng theo mẫu này (`lookup-sync.mjs`).
- **Route mới**: thêm vào mảng `routes` trong `server/app.mjs`. Request khác GET tự động bị kiểm Origin và `x-siris-token` (`server/http.mjs`); phía trình duyệt `api()` trong `src/api.js` tự gửi token khi có `method`. Route thay đổi cấu hình phải thêm vào `invalidatesCaches` (`server-cache.mjs`).
- **Cột chỉ đọc**: `writable-column.mjs` dùng chung cho máy chủ và trình duyệt; sửa luật ở đó, máy chủ vẫn kiểm lại trong `server/routes/table.mjs`.
- **localStorage**: mọi khóa khai báo trong `src/storage.js`. Muốn đồng bộ lên Supabase thì thêm vào cả `syncedKeys` (`src/storage.js`) và `UI_SETTING_KEYS` (`ui-settings-store.mjs`).
- **Hiện/ẩn thanh tiêu đề và thanh công cụ**: chỉ suy ra trong `syncChrome()` (`src/chrome.js`).
- **HTML động**: dùng `textContent`/`el()`; nếu phải dùng `innerHTML` thì escape mọi giá trị. CSP chặn script inline.
- **Giao diện**: theo `.claude/skills/siris-web-design/SKILL.md`; tái dùng class và component có sẵn (custom select, dialog), giữ id và aria-label vì e2e dựa vào chúng.
- Chữ trên giao diện, thông báo lỗi, tài liệu và commit message viết bằng tiếng Việt.

## Kiểm thử

- E2E không có backend thật: mỗi spec chặn `/api/*` bằng `page.route`; `tests/e2e/helpers/mock-api.ts` trả sẵn `formula-config`, `lookup-config`, `ui-settings` và token CSRF giả.
- Không chạy thao tác ghi lên Supabase thật khi thử; kết quả mock không phải nghiệm thu RLS.
- Không sửa test để che lỗi. Mỗi bước một commit; không gộp thay đổi hành vi với định dạng hay di chuyển file.

## Kế hoạch

Plan viết trong `plan/` (tiếng Việt, một file mỗi chủ đề, có dòng **Trạng thái** ở đầu) và liệt kê trong mục Kế hoạch của `README.md`. Cập nhật trạng thái khi xong việc.

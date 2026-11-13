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

- **Unit test đi cùng thay đổi.** Thêm hoặc đổi hành vi một hàm trong module máy chủ (gốc repo, `server/`, `api/`) thì viết hoặc cập nhật test trong `tests/<tên module>.test.js` ngay trong bước đó, cùng commit. Sửa lỗi thì viết test tái hiện lỗi trước. Chỉ đổi tên, di chuyển hay định dạng thì không cần test mới.
- Sau mỗi lần sửa một hàm, chạy lại unit test liên quan: `npx vitest related <file> --run` (khoảng 2 giây). Không chạy cả bộ sau từng lần sửa.
- `src/` không có unit test (mã gắn với DOM): hành vi giao diện kiểm bằng spec e2e. Logic thuần cần dùng ở trình duyệt thì tách thành module `.mjs` ở gốc repo như `writable-column.mjs` để Vitest phủ được.
- E2E không có backend thật: mỗi spec chặn `/api/*` bằng `page.route`; `tests/e2e/helpers/mock-api.ts` trả sẵn `formula-config`, `lookup-config`, `ui-settings` và token CSRF giả.
- Không chạy thao tác ghi lên Supabase thật khi thử; kết quả mock không phải nghiệm thu RLS.
- Không sửa test để che lỗi. Mỗi bước một commit; không gộp thay đổi hành vi với định dạng hay di chuyển file.

## Tiết kiệm token

- **Kiểm tra hẹp trước.** Sau mỗi lần sửa chỉ chạy thứ gần chỗ sửa nhất; đủ bộ (`lint`, `format:check`, `typecheck`, `npm test`, `test:e2e`) chỉ một lần trước khi commit. Chỉ sửa `*.md`, `plan/`, `.claude/` thì không chạy test.
- **E2E**: thử một thay đổi bằng `npx playwright test tests/e2e/<tên>.spec.ts` hoặc `-g "tên test"` (khoảng 7 giây; cả bộ gần 1 phút). Tên spec là tên tính năng; không chắc thì Grep id hoặc aria-label trong `tests/e2e/`. Thêm `--reporter=dot` nếu agent không phải Claude Code.
- Test e2e đỏ: chạy `npx playwright test --last-failed` một lần trước khi tìm lỗi; qua thì đó là nhiễu do máy bận. Đọc thông báo lỗi trước; chỉ mở `error-context.md` hay ảnh trong `test-results/` khi chưa đủ.
- E2E giả lập toàn bộ `/api/*`: thay đổi chỉ ở máy chủ không cần e2e, trừ `login.spec.ts` và `security.spec.ts`.
- Thiếu trình duyệt của Playwright thì đặt `PLAYWRIGHT_CHROMIUM_EXECUTABLE`, không chạy `npx playwright install`.
- **Đọc file**: Grep trước rồi Read có `offset`/`limit`; không đọc nguyên file trên 20 KB. Không đọc `.agents/`, `.taste-skill/`, `package-lock.json`, `dist/`, `screenshots/`. Chỉ mở `README.md` hoặc `plan/` khi việc đang làm liên quan trực tiếp.
- Hook của Claude Code nằm ở `.claude/settings.json` và `.claude/hooks/`: chặn Read nguyên file lớn; sau mỗi lần sửa tự chạy Prettier và unit test liên quan (im lặng khi qua).

## Kế hoạch

Plan viết trong `plan/` (tiếng Việt, một file mỗi chủ đề, có dòng **Trạng thái** ở đầu) và liệt kê trong mục Kế hoạch của `README.md`. Cập nhật trạng thái khi xong việc.

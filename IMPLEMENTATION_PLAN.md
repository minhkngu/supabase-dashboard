# Kế hoạch cải thiện Siris

Kế hoạch này gom kết quả đánh giá toàn bộ mã nguồn và giao diện (11/11/2026) thành các bước làm tuần tự. Mục tiêu: thao tác nhanh hơn, giao diện trực quan hơn, mã dễ bảo trì hơn.

## Quy tắc chung

- Mỗi bước là một commit riêng trên nhánh `claude/hopeful-gates-00krjq`.
- Sau mỗi bước chạy đủ bốn lệnh và chỉ đi tiếp khi tất cả đạt:

  ```sh
  npm run lint
  npm test
  npm run build
  PLAYWRIGHT_CHROMIUM_EXECUTABLE=<đường dẫn chromium> npm run test:e2e
  ```

- Không gộp thay đổi hành vi với thay đổi định dạng trong cùng một commit.
- Không áp dụng gì lên Supabase thật khi thử; kiểm thử ghi dùng API giả lập như hiện tại.

## Hiện trạng (đường cơ sở)

| Lệnh | Kết quả |
|---|---|
| `npm run build` | Đạt |
| `npm run typecheck` | Đạt nhưng không kiểm `app.js` và các `.mjs` |
| `npm run lint` | 3 lỗi trong `tests/e2e/table-overview.spec.ts` |
| `npm test` | 65 đạt, 2 lỗi (`tests/sites-bridge.test.js`) |
| `npm run test:e2e` | Phần lớn test cũ timeout vì mọi bảng mở mặc định ở Dashboard |

## Việc cần bạn quyết định trước

1. **Bản edge function / Sites** (`supabase/functions/siris-manager/`, `scripts/`): bỏ hẳn hay giữ? Đề xuất: bỏ, vì nó trái với kiến trúc "chỉ chạy cục bộ" và đang không khởi động được. Quyết định này ảnh hưởng bước 2.1.
2. **Bảng `promotions`** có mở mặc định ở lưới như các bảng khác không? Đề xuất: có, để hành vi thống nhất.

---

## Giai đoạn 1 — Khôi phục lưới an toàn

Mục đích: có bộ test xanh trước khi sửa bất cứ thứ gì lớn.

**1.1 Lưới dữ liệu là chế độ mặc định**
- Sửa `savedPromotionsMode` ở `app.js:10` để trả về chế độ bảng khi chưa có lựa chọn đã lưu.
- Cập nhật `tests/e2e/table-overview.spec.ts` và `tests/e2e/promotions-overview.spec.ts`: bấm tab Dashboard trước khi kiểm tra Dashboard.
- Xong khi: các file `auth`, `startup`, `duplicate-column`, `delete-records` chạy đạt mà không sửa nội dung test.

**1.2 Sửa lỗi ghim cột checkbox**
- `style.css:1898`: bỏ `position: relative` khỏi `#grid td.record-detail` (hoặc giới hạn cho ô không có `.frozen-cell`).
- Thêm một test e2e: cuộn ngang `.table-scroll`, kiểm tra ô checkbox của dòng đầu vẫn ở nguyên vị trí.

**1.3 Sửa lint**
- Thay ba chỗ `any` trong `tests/e2e/table-overview.spec.ts` bằng kiểu cụ thể.

**1.4 Test e2e không treo**
- `playwright.config.ts`: đặt `timeout` mỗi test 15 giây.
- README: ghi cách dùng `PLAYWRIGHT_CHROMIUM_EXECUTABLE` khi đã có sẵn Chromium.

Kết quả giai đoạn: lint đạt, e2e đạt, `npm test` chỉ còn 2 lỗi của `sites-bridge` (xử lý ở 2.1).

---

## Giai đoạn 2 — Dọn dẹp và định dạng

**2.1 Xử lý bản edge / Sites** (theo quyết định ở trên)
- Nếu bỏ: xóa `supabase/functions/siris-manager/`, `scripts/prepare-chatgpt-site.mjs`, `scripts/check-sites-backend.mjs`, `tests/sites-bridge.test.js`, dòng `chatgpt-site/` trong `.gitignore`.
- Nếu giữ:
  - sinh các file edge lúc build thay vì commit bản sao;
  - sửa `bridge-public.json` và `deno.json` đang rỗng;
  - lưu nonce để chống phát lại;
  - chặn `/api/admin/*` trên bản edge;
  - chuyển test bridge sang repo `chatgpt-site`.

**2.2 Xóa mã chết ở backend**
- `admin.mjs`: `createDefinition`, `updateDefinition`, `deleteDefinition`, `readLinks`, `readNativeLinks`, `writeLinks`, `importLegacy` và các hàm phụ chỉ chúng dùng (`ensureStore`, `junction`, `keyType`, `validateKeys`, `requirePK`, `checkLabel`).
- Giữ nguyên phần `preview` kiểm tra phụ thuộc; đơn giản hóa nhánh `definitions` sau khi chắc chắn bảng `siris_admin.columns` không còn dùng.
- Kiểm tra `/api/lookup-column/preview` và `buildSyncStatements` trong `materialized-lookup.mjs`: giao diện không gọi; xóa nếu không có kế hoạch dùng.
- Gộp năm câu SQL metadata bị viết hai lần ở `admin.mjs:18-25` thành một bộ.

**2.3 Xóa mã chết ở frontend**
- `app.js`: `managedColumns`, `loadManaged`, `managedCell`, toàn bộ relation picker, nhánh `relation`/`lookup` trong form cột, các lời gọi `/api/admin/definition/*` và `/api/admin/links/*`.
- `index.html`: dialog `#relationPicker`, các trường ẩn `#columnKind`, `#columnTargetWrap`, `#columnDisplayWrap`, `#columnMultipleWrap`, `#columnRelationWrap`, `#columnLookupFieldWrap`.
- `style.css`: 25 class không còn dùng (`brand-badge`, `bulk-edit`, `virtual-grid-*`, `dropdown-menu`, `rule-select`…).

**2.4 Xóa dependency thừa**
- Gỡ: `react`, `react-dom`, `@glideapps/glide-data-grid`, `@tanstack/react-query`, `@radix-ui/react-slot`, `class-variance-authority`, `clsx`, `tailwind-merge`, `lucide-react`, `@supabase/supabase-js`, `tailwindcss`, `@tailwindcss/vite`, `@vitejs/plugin-react`, `@types/react`, `@types/react-dom`.
- Bỏ hai plugin khỏi `vite.config.ts`.

**2.5 Định dạng toàn bộ mã**
- Thêm Prettier, chạy cho `*.mjs`, `*.js`, `*.ts`, `*.css`, `*.html`.
- Một commit riêng, không kèm thay đổi nào khác.
- Thêm script `format` và `format:check` vào `package.json`.

**2.6 Cập nhật tài liệu**
- README: bỏ câu "API quản trị cấu trúc đang tạm khóa", bỏ tham chiếu `CODEX_LOCAL_SUPABASE_MANAGER.md`, trỏ tới file kế hoạch này.
- `ARCHITECTURE.md`: mô tả đúng trạng thái hiện tại.

Kết quả giai đoạn: cả bốn lệnh kiểm tra đều đạt; mã đọc được theo dòng.

---

## Giai đoạn 3 — Hệ thống phản hồi nhanh hơn

Đo trước và sau bằng `SIRIS_PERF_TIMING=1` (header `Server-Timing` đã có sẵn).

**3.1 Cache cấu hình ở đường ghi**
- `server.mjs`: trong nhánh `/api/table/*` POST/PATCH, đọc formula và lookup qua `cachedConfig` thay vì truy vấn Postgres mỗi lần.
- Chỉ xóa cache metadata và cấu hình ở các endpoint thay đổi cấu hình hoặc schema (`/api/formula-config`, `/api/lookup-config`, `/api/lookup-sync/*`, `/api/admin/schema/apply`), không xóa khi ghi dữ liệu bảng.
- Thêm test trong `tests/server.test.js`: hai lần PATCH liên tiếp không làm mất cache.

**3.2 Không tải lại trang sau mỗi lần lưu ô**
- `app.js` (`startCellEdit`): sau khi lưu, chỉ gọi `load({silent:true})` nếu bảng có formula đang bật hoặc lookup đồng bộ; trường hợp còn lại chỉ gọi `loadLookups()`.

**3.3 Dán và sửa hàng loạt chạy song song**
- `pasteCells`: gửi tối đa 5 request cùng lúc; giữ nguyên báo lỗi theo từng dòng.

**3.4 Đếm tổng ít hơn**
- `GET /api/table/:name`: thêm tham số bỏ đếm; giao diện chỉ yêu cầu đếm khi bộ lọc, tìm kiếm hoặc bảng thay đổi, và dùng lại tổng khi chuyển trang.

**3.5 Dashboard đọc trang lớn**
- Cho phép tham số `limit` (tối đa 1.000) ở `GET /api/table/:name`; `readAllTableRows` và `readAllPromotions` dùng 1.000.

**3.6 Tự host font**
- Đưa Plus Jakarta Sans và JetBrains Mono vào repo, bỏ link Google Fonts trong `index.html`, siết lại CSP trong `server.mjs`.

**3.7 (Tùy chọn, sau khi đo) Chỉ lấy cột đang hiển thị**
- Thêm tham số `columns` đã kiểm tra hợp lệ; luôn kèm khóa chính và cột nhóm/sắp xếp; form bản ghi tải đủ bản ghi khi mở.
- Chỉ làm nếu số đo cho thấy bảng nhiều cột thật sự chậm.

---

## Giai đoạn 4 — Tách cấu trúc mã

Làm sau giai đoạn 2 để diff đọc được, trước giai đoạn 5–6 để tính năng mới viết vào module nhỏ.

**4.1 Tách server**
- `server/` gồm: `config.mjs` (env, kết nối), `http.mjs` (body, response, kiểm tra Host/Origin/CSRF), `routes/meta.mjs`, `routes/table.mjs`, `routes/lookup.mjs`, `routes/formula.mjs`, `routes/schema.mjs`, `static.mjs`.
- `server.mjs` chỉ còn khởi tạo và bảng định tuyến.
- Dùng `safeError` của `admin.mjs` cho lỗi Postgres trước khi trả về trình duyệt.

**4.2 Tách frontend**
- `src/` gồm: `state.js`, `api.js`, `sidebar.js`, `grid/render.js`, `grid/selection.js`, `grid/cell-edit.js`, `view-menus.js`, `custom-select.js`, `record-editor.js`, `column-dialog.js`, `lookup.js`, `history.js`, `deletion.js`, `overview/`.
- Di chuyển từng module một, mỗi module một commit, không đổi hành vi.

**4.3 Gom hằng số và nghiệp vụ**
- Cỡ trang thành một hằng số dùng chung.
- Nhãn và cấu hình riêng của các bảng (`room_types`, `branches`, `promotions`…) gom vào một file cấu hình duy nhất.
- Đổi tên `promotionsMode` thành `overviewMode`.

**4.4 Bật kiểm tra kiểu cho JS**
- `tsconfig.json`: thêm `allowJs`, `checkJs`, sửa `include` cho đúng thư mục thật.
- ESLint: thêm quy tắc cho `.js`/`.mjs` (biến không dùng, `catch` rỗng có chủ đích).

---

## Giai đoạn 5 — Thao tác nhanh hơn

**5.1 Điều hướng bàn phím trong lưới**
- Mũi tên di chuyển giữa các ô; gõ ký tự là vào sửa; Enter lưu và xuống dòng dưới; Tab lưu và sang ô phải; Escape hủy.
- Test e2e cho từng phím.

**5.2 Bỏ lần bấm bị nuốt**
- Khi đang sửa ô mà bấm sang ô khác: lưu ô cũ và chọn ô mới trong cùng một lần bấm (sửa trình xử lý `pointerdown` hiện ở `app.js:129`).

**5.3 Menu trên tiêu đề cột**
- Bấm tiêu đề cột mở menu: sắp xếp tăng/giảm, lọc theo cột này, nhóm theo cột này, ẩn, ghim, thiết lập cột.

**5.4 Phím tắt toàn cục**
- `/` vào ô tìm kiếm; Ctrl/⌘+K mở hộp chuyển bảng nhanh có tìm kiếm.

**5.5 Cỡ trang linh hoạt**
- Chọn 50/100/200 ở chân lưới, lưu theo bảng.

**5.6 Lưu nhiều thay đổi cột một lần**
- Form thiết lập cột tự chạy lần lượt các thay đổi (tên → kiểu → thuộc tính → formula/lookup), báo rõ bước nào xong, bước nào lỗi, thay cho thông báo "hãy lưu trong hai lần riêng".

---

## Giai đoạn 6 — Giao diện trực quan hơn

**6.1 Hiện tên thay cho mã**
- Cột khóa ngoại mặc định hiện trường `name` (hoặc cột text đầu tiên) của bản ghi liên kết; nút "Aa" chỉ để đổi lựa chọn.
- Cột `id` kiểu uuid mặc định xếp cuối và thu hẹp.

**6.2 Form bản ghi gọn lại**
- Hai cột trên màn hình rộng.
- Text ngắn dùng ô một dòng; chỉ dùng textarea khi giá trị dài hoặc có xuống dòng.
- Boolean dùng công tắc; khóa ngoại dùng ô chọn bản ghi.
- Trường chỉ đọc gom xuống cuối; bỏ gợi ý "để trống để dùng giá trị mặc định" ở trường không sửa được.

**6.3 Thẻ bộ lọc**
- Bộ lọc, nhóm, sắp xếp đang bật hiện thành thẻ dưới thanh công cụ; bấm × để gỡ.

**6.4 Phản hồi tại chỗ**
- Ô đang lưu có trạng thái riêng.
- Toast "Đã lưu" kèm nút "Hoàn tác".

**6.5 Bỏ hộp thoại gốc của trình duyệt**
- Thư mục: menu "Đổi tên" / "Xóa" thay cho `prompt()` với lệnh `/xoa`.
- Xác nhận xóa bản ghi, xóa cột: dùng `<dialog>` cùng kiểu với phần còn lại, thay cho `confirm()` và `alert()`.

**6.6 Biểu tượng và nhãn**
- Một bộ SVG cho ghim, menu, kiểu dữ liệu; thêm icon cho uuid, enum, khóa ngoại.
- "Dashboard" đổi thành "Tổng quan".
- Cho đặt tên hiển thị cho bảng (lưu cục bộ cùng cấu hình sidebar).

**6.7 Điện thoại**
- Nút "Thêm bản ghi" không bị cắt ở 390px.
- Ẩn nút thu gọn sidebar; chỉ giữ nút đóng.
- Hàng trong Tổng quan xếp dọc thay vì cắt chữ.

**6.8 Tổng quan có ích hơn**
- Bỏ chỉ số "Trong kết quả" khi chưa tìm kiếm.
- Nhóm theo cột tính trên toàn bộ dữ liệu, không chỉ trang hiện tại.

**6.9 Dọn CSS**
- Gộp hai khối custom select chồng nhau, bỏ các khối "reset the earlier…", đưa mã màu hex rời vào token, giảm `!important`.
- Sau bước này mới cân nhắc dark mode (ngoài phạm vi kế hoạch).

---

## Thứ tự và phụ thuộc

```
1 (lưới an toàn) → 2 (dọn dẹp, định dạng) → 3 (tốc độ hệ thống)
                                           → 4 (tách cấu trúc) → 5 (thao tác) → 6 (giao diện)
```

- Giai đoạn 3 và 4 độc lập nhau, có thể đổi thứ tự.
- Giai đoạn 5 và 6 nên làm sau 4 để không phải viết tính năng mới vào file 150 KB.
- Người dùng thấy cải thiện ngay từ 1.1, 1.2, 3.1, 3.2 và 5.1.

## Trạng thái

Cập nhật 11/11/2026, nhánh `claude/funny-cannon-1auhaq`.

| Giai đoạn | Trạng thái |
|---|---|
| 1 — Lưới an toàn | Xong |
| 2 — Dọn dẹp và định dạng | Xong (2.1: ban đầu bỏ bản edge, sau đó khôi phục — xem đợt 2) |
| 3 — Tốc độ hệ thống | Xong 3.1–3.6; 3.7 chưa làm vì cần số đo trên dữ liệu thật |
| 4 — Tách cấu trúc | Xong |
| 5 — Thao tác | Xong |
| 6 — Giao diện | Xong |

Quyết định đã áp dụng:

- 2.1: **giữ** bản edge / Sites vì bản online đang được dùng (đợt 1 đã xóa, đợt 2 khôi phục).
- Bảng `promotions` mở mặc định ở lưới như mọi bảng khác.

Khác với kế hoạch ban đầu:

- 1.3 (sửa `any`) được làm cùng commit 1.1; 5.1 và 5.2 chung một commit.
- 4.4: `checkJs` chạy ở chế độ không strict trong `tsconfig.js.json` (strict cần chú thích kiểu cho gần như mọi hàm); file TypeScript vẫn strict. `npm run typecheck` chạy cả hai.
- 6.8: "nhóm theo cột tính trên toàn bộ dữ liệu" được làm cho tiêu đề nhóm của lưới qua endpoint chỉ đọc `GET /api/table/:name/group-counts`.
- 6.9: còn 15 `!important`, phần lớn để thắng các selector theo id của lưới; dark mode vẫn ngoài phạm vi.
- Dev server trả 404 cho đường dẫn dotfile (`/.env.local`) — sửa thêm khi khôi phục bộ e2e.

---

## Đợt 2 — nút bấm, Dashboard thêm/sửa được, chốt kiến trúc

### Nguyên nhân đã xác nhận

| Hiện tượng | Nguyên nhân | Đã sửa |
|---|---|---|
| Tick chọn dòng thì lưới nhảy xuống | `#rowSelectionBar` là khối riêng phía trên lưới | Thanh chọn nổi ở đáy lưới |
| Ô chọn tất cả lệch so với ô chọn dòng | Tiêu đề căn giữa, thân căn trái kèm số thứ tự | Cùng căn trái, cùng lề |
| Nhãn lặp, nút xóa xa cột checkbox | `updateRowSelection` | "9 dòng đã chọn" · Bỏ chọn · Xóa; "trên trang này" khi bảng còn trang khác |
| Bấm Tổng quan ↔ Bảng dữ liệu thì cụm nút nhảy, "Thêm bản ghi" hiện dưới con trỏ | Cụm chuyển chế độ chung hàng với Hoàn tác/Làm lại/Thêm | Cụm chuyển chế độ đứng cạnh tên bảng |
| Ở Tổng quan không có "Thêm bản ghi" | Ẩn có chủ đích | Thêm và sửa được ở Tổng quan; xóa vẫn chỉ ở lưới |
| Trạng thái nút dễ sai lệch | `#add` gán rời rạc ở 7 chỗ | `syncChrome()` trong `src/chrome.js` |
| Điện thoại: nút Thêm bị cắt, nút menu quá nhỏ | Hàng nút không co ở 390px | Nút Thêm chỉ còn biểu tượng; nút menu 36×36 |

### Lựa chọn đã chốt

- Tổng quan: thêm và sửa được; xóa chỉ ở lưới.
- Thanh chọn dòng nổi ở đáy lưới.
- Frontend giữ JS thuần, tách module; đã gỡ React/Glide/Tailwind.
- Giữ bản edge / Sites.

### Kiến trúc

Giữ nguyên: server chỉ nghe loopback, kiểm tra Host/Origin/CSRF, key ở phía server; dữ liệu qua Data API nên chịu RLS; đổi schema theo xem trước → chữ ký → khóa → kiểm lại trong transaction; formula và lookup đồng bộ bằng trigger.

Đã xử lý:

1. **Một nguồn sự thật cho trạng thái nút**: `syncChrome()`.
2. **Một kiến trúc frontend**: JS thuần trong `src/`.
3. **Một bản backend**: phần xử lý request nằm ở `server/app.mjs`; `server.mjs` (cục bộ) và `server/edge.mjs` (edge) cùng dùng. `scripts/prepare-chatgpt-site.mjs` chỉ chép các file trong `scripts/edge-files.mjs`, dừng nếu thiếu file được import, không còn thay chuỗi. `tests/edge-backend.test.js` kiểm tra danh sách file và gọi handler như `index.ts`.
4. **State và cache server**: `tables` nằm trong context; cache chỉ xóa khi cấu hình/schema đổi.
5. **Nghiệp vụ theo bảng** gom vào `table-config.mjs`.
6. **Kiểm thử**: thêm file theo tính năng (`chrome`, `keyboard`, `column-menu`, …).

Còn lại cho đợt sau:

- Gom các khóa `localStorage` về một module `storage`; bỏ đường lưu lookup trên trình duyệt; xóa mã đọc `siris_admin.columns` khi chắc bảng không còn dùng.
- Bản edge: chống phát lại chữ ký (lưu nonce) và xem lại việc mở API đổi schema trên bản online.
- Tách tiếp `tests/e2e/auth.spec.ts` theo tính năng.

### Vận hành bản online

Giao diện và backend mới chỉ lên bản online sau khi chạy trên máy có `chatgpt-site/`:

```sh
npm run build
node scripts/prepare-chatgpt-site.mjs
```

rồi deploy **cả hai**: edge function (`supabase functions deploy siris-manager`) và Sites worker. Giao diện mới gửi `limit=1000` cho Tổng quan; nếu chỉ deploy giao diện mà giữ edge function cũ, Tổng quan sẽ báo "Máy chủ trả về ít dòng hơn dự kiến".

Thư mục `supabase/functions/siris-manager/` trong git vẫn là bản sinh ra lần trước; nó chỉ đổi khi chạy lại script.

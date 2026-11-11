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

| Giai đoạn | Trạng thái |
|---|---|
| 1 — Lưới an toàn | Chưa bắt đầu |
| 2 — Dọn dẹp và định dạng | Chưa bắt đầu (chờ quyết định 2.1) |
| 3 — Tốc độ hệ thống | Chưa bắt đầu |
| 4 — Tách cấu trúc | Chưa bắt đầu |
| 5 — Thao tác | Chưa bắt đầu |
| 6 — Giao diện | Chưa bắt đầu |

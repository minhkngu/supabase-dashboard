# Sửa giao diện: kéo thả, bố trí nút, lưu cấu hình lên Supabase

## Context
Bạn chưa hài lòng ở 4 điểm: kéo thả cột trên lưới, kéo thả bảng ở sidebar, bố trí nút đầu trang, và cấu hình giao diện không được giữ khi mở trên Vercel hoặc máy khác. Tôi đã chạy app (1440 / 1024 / 390px), giả lập kéo thả và đọc mã. Kết quả:

- **Cấu hình không theo người dùng sang máy khác**: mọi thứ (`views`, thư mục, thứ tự bảng, tên hiển thị…) chỉ nằm trong `localStorage` (`src/storage.js`). Trên cùng một trình duyệt và cùng địa chỉ thì vẫn giữ (đã thử: đổi thứ tự cột rồi tải lại, thứ tự còn nguyên). Nhưng mỗi origin lưu riêng: link Vercel, mỗi link preview, máy khác và localhost với 127.0.0.1 đều không thấy cấu hình của nhau.
- **Kéo cột (lưới)** `src/grid/render.js:388-422`:
  - Vạch báo luôn hiện ở **mép trái** (`th.column-drop { box-shadow: inset 2px 0 }`), trong khi thả ở nửa phải lại chèn **sau** cột. Báo một đằng, làm một nẻo.
  - `dragleave` bắn ra khi chuột đi qua phần tử con, nên vạch báo nhấp nháy.
  - Kéo qua ranh giới cột ghim không có dấu hiệu gì, chỉ hiện toast sau khi đã thả.
  - Không tự cuộn ngang khi kéo tới mép lưới, mà bảng có 14 cột.
- **Kéo bảng (sidebar)** `src/sidebar.js:143-276`:
  - `drop-before/after` dùng `border` 2px nên các dòng bị nhảy khi kéo.
  - Khi mọi bảng đã vào thư mục thì không còn vùng nào để kéo bảng ra ngoài.
  - Thư mục đang thu gọn không tự mở khi rê bảng qua.
- **Bố trí nút** (`index.html:199-530`, `style.css` ~823, ~944):
  - Nhóm Cột/Lọc/Nhóm/Sắp xếp/Tải lại dừng ở x=1155, không thẳng mép phải với nút "Thêm bản ghi" (x=1412).
  - Ở 1024px với sidebar mở, thanh công cụ gãy thành 2–3 dòng.
  - Trên điện thoại 390px, phần đầu trang chiếm 6 dòng trước khi tới lưới.
- **Chọn nhiều ô bị nhảy**: thanh sửa hàng loạt chèn vào phía trên lưới, đẩy lưới xuống 70px; `focus()` không có `preventScroll` (mục E).
- `.claude/launch.json` ghi cổng 5173, nhưng Vite chạy ở cổng **3000**.

## A. Lưu cấu hình giao diện lên Supabase
Làm theo đúng mẫu `lookup-store.mjs` / `lookup-store.sql` / `server/routes/lookup.mjs`.

1. **`ui-settings.sql`** (mới; bạn tự chạy trên Supabase): bảng `siris_admin.ui_settings(key text PRIMARY KEY, value jsonb NOT NULL, updated_at timestamptz DEFAULT now())`, `REVOKE` quyền giống `lookup_configs`.
2. **`ui-settings-store.mjs`** (mới): `createUiSettingsStore(pool)` với các hàm `available()` (dùng `to_regclass`), `list()` và `save(key, value)`.
   - Chỉ nhận các khóa trong danh sách cho phép: `views`, `namedViews`, `tableFolders`, `tableOrder`, `relationDisplay`, `tableDisplay`, `promotionsDisplay`.
   - Giới hạn kích thước khoảng 256 KB mỗi khóa.
   - Ghi bằng `INSERT … ON CONFLICT DO UPDATE`.
3. **`server/routes/ui-settings.mjs`** (mới):
   - `GET /api/ui-settings` trả `{available, items:{key:{value,updatedAt}}}`. Nếu chưa có bảng thì trả `available:false`, không báo lỗi.
   - `POST /api/ui-settings` nhận `{key, value}`, đi qua kiểm tra token sẵn có.
   - Đăng ký route ở `server/app.mjs:14` và nối store vào `server/context.mjs` (cạnh `lookupStore`). Kiểm tra `server/vercel.mjs` và `server/session-auth.mjs` để chắc route chạy được trên Vercel.
4. **Client: `src/ui-sync.js`** (mới).
   - `src/storage.js` đánh dấu các khóa đồng bộ. `setJSON` với các khóa này lưu cả local lẫn ghi chú thời điểm, rồi hẹn gửi lên server sau khoảng 600 ms (gộp nhiều lần thay đổi). Khi rời trang (`pagehide`) thì gửi nốt bằng `fetch keepalive`.
   - Lúc khởi động (`src/main.js` `initialize`), tải `/api/ui-settings` song song với formula/lookup config:
     - Khóa nào trên server mới hơn bản local thì ghi đè local, rồi gọi lại `restoreViews()`, `restoreSidebar()`, `nav()` và áp lại view của bảng đang mở.
     - Server trống mà local có dữ liệu thì tự đẩy bản local lên. Nhờ vậy cấu hình đang có trên trình duyệt chính của bạn không bị mất.
   - Các khóa theo từng máy giữ nguyên trong `localStorage`: `currentTable`, `metadata`, `sidebarCollapsed`.
   - Nếu chưa có bảng `ui_settings` thì app vẫn chạy bằng `localStorage` và báo một lần: "Cấu hình chỉ lưu trên trình duyệt này".
5. Cập nhật `ARCHITECTURE.md` (dòng nói "lưu trong localStorage") và README (bước chạy SQL).

Lưu ý: app dùng một phiên đăng nhập chung, nên cấu hình là **chung cho mọi người** dùng app, không tách theo từng người.

## B. Kéo cột trên lưới (`src/grid/render.js`, `style.css` ~1835)
- Tính vị trí trước/sau ngay trong `dragover` và đặt class `column-drop-before` hoặc `column-drop-after`, vạch 2px ở đúng mép sẽ chèn. Xóa class ở các cột khác. `drop` dùng đúng phép tính đó.
- `dragleave` chỉ xóa vạch khi `!th.contains(e.relatedTarget)`, để hết nhấp nháy.
- Kéo qua ranh giới cột ghim / không ghim: đặt `dropEffect = 'none'`, đổi con trỏ thành not-allowed và không vẽ vạch. Bỏ toast sau khi thả.
- Đặt `draggable=false` cho các nút ghim, "Aa" và ⋯ trong tiêu đề, để bấm nút không vô tình bắt đầu kéo.
- Tự cuộn ngang khi rê gần mép (khoảng 40px) của vùng cuộn lưới. Dùng chung một hàm `autoScrollWhileDragging(container, e)` cho cả sidebar (dọc).
- Danh sách cột trong popover "Cột" (`src/view-menus.js:146-174`) đã đúng trước/sau. Chỉ đổi cách vẽ vạch sang pseudo-element để không xô lệch các dòng.

## C. Kéo bảng ở sidebar (`src/sidebar.js`, `style.css` ~490-600)
- `.nav-item.drop-before/after`: thay `border` bằng `::before` / `::after` đặt `position:absolute` (cần `position:relative` trên item), để không nhảy dòng.
- Trong lúc kéo, thêm class `sidebar-dragging` vào `#tables`. Khi đó luôn hiện vùng thả "Ngoài thư mục" ở cuối danh sách, kể cả khi mọi bảng đã nằm trong thư mục. Bỏ điều kiện ẩn ở `sidebar.js:258`.
- Rê qua đầu một thư mục đang thu gọn khoảng 600 ms thì tự mở thư mục đó. Thả lên đầu thư mục thì bảng vào cuối thư mục (giữ `reorderTable` hiện có).
- Khi rê một bảng vào trong thư mục, viền vùng thư mục được làm nổi để biết đang thả vào đâu.
- Tự cuộn dọc danh sách khi rê gần mép trên hoặc dưới.

## D. Bố trí nút (`index.html`, `style.css`)
- **Thanh công cụ**:
  - Gộp ô tìm kiếm và chọn cột "Mọi cột văn bản" thành một khối liền: ô chọn gắn bên phải ô tìm, chung viền.
  - Nhóm Cột/Lọc/Nhóm/Sắp xếp đẩy sang mép phải (`margin-left:auto`), thẳng hàng với "Thêm bản ghi". Nút Tải lại đứng cuối, cách nhóm bằng một vạch chia.
- **Đầu trang**: Hoàn tác và Làm lại gộp thành một cặp nút liền (segmented), rồi một vạch chia, rồi "Thêm bản ghi".
- **Màn hình hẹp**: dùng container query thay cho để nút gãy dòng.
  - Dưới khoảng 820px: các nút xem chỉ còn biểu tượng, có title/aria-label. Số bộ lọc/nhóm/sắp xếp đang bật hiện dạng badge.
  - Dưới khoảng 520px (điện thoại): khối tìm kiếm chiếm 1 dòng, các nút xem 1 dòng.
  - Mục tiêu: header trên điện thoại còn khoảng 3 dòng thay vì 6.
- Không đổi id hay aria-label, để `src/chrome.js` (`syncChrome`) và e2e vẫn chạy được.
- Sửa `.claude/launch.json`: đổi port thành 3000.

## E. Chọn nhiều ô làm bảng bị nhảy (`src/grid/selection.js`, `index.html:546`, `style.css` ~2924, ~3266)
Đã đo lại: kéo chọn 2 ô cùng cột rồi thả chuột, `#bulkBar` (`position: static`, nằm trên lưới) hiện ra và đẩy `.grid-shell` từ y=138 xuống y=208. Bỏ chọn thì lưới nhảy ngược lên.
- Chuyển form `#bulkBar` vào trong `.grid-shell`, nổi ở đáy lưới giống `#rowSelectionBar` (dùng chung style `.row-selection-bar`). Như vậy thanh hiện hay ẩn đều không làm lưới xê dịch. Giữ nguyên id để e2e vẫn chạy.
- Mọi `cell.focus()` / `td.focus()` khi chọn ô (`selection.js:63,160,176,182,214`, `render.js:621,637`, `keyboard.js:50`) đổi thành `focus({ preventScroll: true })`. Riêng phím mũi tên thì cuộn tối thiểu bằng `scrollIntoView({ block:'nearest', inline:'nearest' })`, để click vào ô không kéo lưới đi đâu.
- Kéo chọn tới gần mép vùng cuộn thì tự cuộn, dùng chung hàm auto-scroll ở mục B.
- Khoảng trống phía trên lưới ổn định: `#ruleChips` và `#configStatus` cũng không đẩy lưới khi đang chọn ô.
- E2E (`grid.spec.ts`): đo `boundingBox` của `.grid-shell` trước và sau khi kéo chọn nhiều ô, sai lệch phải bằng 0; `scrollLeft` không đổi khi click vào ô đã nhìn thấy.

## Kiểm thử
- Unit test (`tests/`): store `ui_settings` kiểm tra khóa sai, giá trị quá lớn, `available=false`. Route trả `available:false` khi chưa có bảng.
- E2E (`tests/e2e/`):
  - Cập nhật `columns.spec.ts`: vạch trước/sau phải khớp vị trí thả; kéo qua ranh giới ghim bị chặn.
  - Cập nhật `folders.spec.ts`: kéo bảng ra ngoài khi mọi bảng đã vào thư mục; tự mở thư mục đang thu gọn.
  - Cập nhật `chrome.spec.ts`: vị trí nút ở 1440, 1024 và 390px.
  - Thêm spec đồng bộ: đổi cấu hình, xóa `localStorage`, tải lại thì cấu hình về lại từ server. Dùng backend giả lập sẵn có của e2e.
- Chạy `npm run lint`, `npm run typecheck`, `npm test`, `npm run test:e2e`.
- Kiểm tra thủ công qua preview (cổng 3000):
  - Chụp ảnh ở 1440, 1024 và 390px.
  - Giả lập kéo thả bằng `DragEvent` như lần kiểm tra trước.
  - Đổi cấu hình trên `127.0.0.1:3000`, mở `localhost:3000` (origin khác) và thấy cùng cấu hình. Chỉ làm sau khi bạn đã chạy `ui-settings.sql`.

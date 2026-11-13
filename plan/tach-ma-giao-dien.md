# Tách dần mã giao diện

**Trạng thái:** đã thêm kiểm tra 18 cặp import vòng vào lint (bước 1); còn bước 2–5. Làm dần, giữ nguyên hành vi.

Nguồn: đánh giá ngày 13/11/2026 trên `main` (`49031bd`).

## Hiện trạng

- **Trạng thái toàn cục**: một đối tượng `state` trong `src/state.js` (hơn 30 trường) và các biến `export let` đổi qua hàm `set…` (`deletionBusy`, `cacheEpoch`, `countedKey`, `loadController`…). Số lần đọc/ghi `state.` nhiều nhất: `src/grid/render.js` 80, `src/column-dialog.js` 74, `src/lookup.js` 43.
- **Import vòng**: 18 cặp module import lẫn nhau trực tiếp. `src/grid/render.js` nằm trong phần lớn các cặp (với `history`, `lookup`, `main`, `record-editor`, `relation-display`, `sidebar`, `deletion`, `column-dialog`…). Chạy được nhờ ES module cho phép vòng, nhưng thứ tự khởi tạo dễ vỡ.
- **Thứ tự `init*`**: `app.js` gọi 19 hàm `init*` theo thứ tự cố định, có hai hàm "phần 2" (`initSidebar2`, `initViewMenus2`) chỉ để giữ thứ tự của `app.js` nguyên khối cũ.
- **File lớn**: `style.css` 4.631 dòng, `index.html` 1.044, `src/column-dialog.js` 786, `src/grid/render.js` 695, `src/lookup.js` 671, `src/view-menus.js` 573. `src/grid/render.js` import 21 module.
- **Lỗi đã gặp do cấu trúc này**: `src/api.js` tự xóa cache trang cho mọi request ghi, `load()` tự bỏ kết quả khi cache đổi; hai module không biết nhau dẫn tới lỗi treo (xem `plan/sua-loi-treo-dang-tai-du-lieu.md`).

## Nguyên tắc

- Không đổi giao diện, id, aria-label hay hành vi; e2e hiện có phải đạt sau mỗi bước.
- Một bước một commit; không gộp di chuyển mã với thay đổi hành vi hay định dạng.
- Không thêm framework. Vẫn JS thuần, ES module, `checkJs`.

## Việc cần làm

### 1. Đo và chặn tăng thêm

- Thêm script nhỏ `scripts/check-imports.mjs` liệt kê import vòng trong `src/` (đếm cặp như cách đã đo). Chạy trong `npm run lint` hoặc CI, cho phép tối đa số hiện tại (18) để không tăng thêm; hạ ngưỡng sau mỗi bước.

### 2. Tách sự kiện khỏi lời gọi trực tiếp

- Thêm `src/events.js`: một `EventTarget` dùng chung với vài sự kiện có tên rõ (`data-changed` kèm bảng, `view-changed`, `table-chosen`).
- Thay các lời gọi ngược về `render.js` (`load`, `render`) từ `history`, `lookup`, `deletion`, `record-editor`, `column-dialog` bằng phát sự kiện; `render.js` nghe và tự quyết định tải lại.
- Chuyển việc xóa cache khỏi `src/api.js`: nơi ghi dữ liệu phát `data-changed`, `state.js` nghe và xóa cache. Sau bước này `api()` chỉ còn gọi mạng.
- Kiểm: số import vòng giảm; e2e `cell-save`, `delete-records`, `background-refresh`, `lookup` đạt.

### 3. Gom trạng thái theo vùng

- Tách `state` thành vài đối tượng nhỏ, mỗi cái do một module sở hữu và chỉ module đó ghi: lưới (`rows`, `page`, `total`, `view`), cấu hình (`formulas`, `lookups`, `configReady`), metadata (`tables`, `table`, `enumTypes`), lịch sử. Module khác đọc qua hàm `get…`.
- Bỏ các biến `export let` + `set…` trong `src/state.js`, chuyển về module sở hữu.
- Kiểm: typecheck đạt; e2e đạt.

### 4. Bỏ thứ tự `init*` ngầm

- Gộp `initSidebar2` vào `initSidebar`, `initViewMenus2` vào `initViewMenus` sau khi bước 2 bỏ phụ thuộc thứ tự.
- Mỗi `init*` chỉ gắn sự kiện cho phần tử của chính nó; ghi chú thứ tự còn bắt buộc (nếu có) ngay trong `app.js`.

### 5. Chia file lớn

- `src/grid/render.js`: tách tiêu đề cột (`columnHeader`, kéo cột) và tải dữ liệu (`load`, `prefetchPage`, `pageCache`) ra file riêng trong `src/grid/`.
- `src/column-dialog.js`: tách phần lookup và phần formula của hộp thoại thành hai file.
- `style.css`: chia theo vùng (`base`, `sidebar`, `grid`, `dialogs`, `overview`, `responsive`) và `@import` trong một file gốc; Vite gộp lại khi build. Kiểm bằng ảnh chụp 1440/1024/390px trước và sau (giống nhau).
- `index.html`: chưa tách; chỉ làm nếu cần template cho hộp thoại.

## Không làm lúc này

- Chuyển sang React/Vue/Svelte hay TypeScript toàn phần.
- Viết lại `style.css` theo hệ thống mới; chỉ chia file, không đổi quy tắc.

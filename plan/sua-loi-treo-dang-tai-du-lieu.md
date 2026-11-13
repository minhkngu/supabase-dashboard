# Sửa lỗi bảng đứng ở "Đang tải dữ liệu"

**Trạng thái:** bước 1–3 xong ở commit `d60c697` (merge qua PR #5): `api()` không xóa cache cho `/api/ui-settings`, `load()` tải lại khi `cacheEpoch` đổi, có e2e trong `tests/e2e/ui-sync.spec.ts`. Còn bước 4 (kiểm trên Vercel) và việc nhỏ: `/api/lookup-config/cleanup-disabled` vẫn xóa cache trang.

Nguồn: tái hiện ngày 13/11/2026 trên bản preview `main` (`49031bd`) và bằng máy chủ cục bộ chỉ đọc nối dữ liệu thật. Lỗi có từ PR #4 (đồng bộ cấu hình giao diện).

## Triệu chứng

Mở một bảng: giao diện hiện "Đang tải dữ liệu…", 0 bản ghi, và đứng mãi. Máy chủ vẫn trả dữ liệu đúng (`GET /api/table/branches` → 200 sau 1,4 s). Không có lỗi trong console.

## Nguyên nhân

1. Mở bảng: `choose()` gọi `persistView()` (`src/view-menus.js`), ghi khóa `views` bằng `setJSON`.
2. `views` là khóa đồng bộ, nên `src/ui-sync.js` hẹn `PUSH_DELAY = 600` ms sau gửi `POST /api/ui-settings`.
3. `api()` (`src/api.js`) coi mọi request khác GET (trừ `/api/lookup/`) là ghi dữ liệu: gọi `clearPageCache()` (tăng `cacheEpoch`) và `invalidateLookupCache()`.
4. Khi response bảng về, `load()` (`src/grid/render.js`) thấy `epoch !== cacheEpoch` nên `return`: không vẽ, không báo lỗi, không tải lại.

Lỗi xảy ra khi request bảng lâu hơn 600 ms. Trên Vercel hiện nay request bảng mất 0,6–1,7 s (xem `plan/toc-do-tai-bang-tren-vercel.md`), nên gần như lần nào cũng dính. Chạy cục bộ nhanh nên e2e không bắt được.

## Việc cần làm

Mỗi bước một commit.

### 1. Lưu cấu hình giao diện không xóa cache dữ liệu

- `src/api.js`: chỉ xóa cache trang và cache lookup với request thật sự đổi dữ liệu hoặc cấu trúc: `/api/table/…`, `/api/admin/…`, `/api/lookup-config` (lưu, xóa), `/api/lookup-sync/…`, `/api/formula-config`. Bỏ qua `/api/ui-settings` và `/api/lookup-config/cleanup-disabled`.
- Viết thành một hàm nhỏ (ví dụ `changesData(url)`) để danh sách nằm một chỗ.

### 2. `load()` không bỏ kết quả im lặng

- Khi `cacheEpoch` đổi trong lúc chờ mà `version === state.loadVersion` và `table === state.table`: không cất kết quả vào `pageCache`, gọi lại `load({ silent: true })` để lấy dữ liệu mới sau lần ghi.
- Giữ nguyên nhánh bỏ qua khi người dùng đã chuyển bảng hoặc có lần tải mới hơn.
- Kiểm tra `prefetchPage()` (cùng file) vẫn bỏ kết quả khi epoch đổi; prefetch không cần tải lại.

### 3. Test

- E2E mới (trong `tests/e2e/ui-sync.spec.ts` hoặc `background-refresh.spec.ts`):
  - `/api/ui-settings` trả `available: true`; `GET /api/table/…` giả lập chậm 1,5 s.
  - Mở trang: phải thấy dòng dữ liệu, không còn "Đang tải dữ liệu…"; có đúng một `POST /api/ui-settings`.
- E2E: sửa một ô trong lúc request bảng đang chờ → bảng tải lại và hiện giá trị mới (bước 2).
- Chạy lại toàn bộ `npm test` và `npm run test:e2e`.

### 4. Kiểm trên Vercel

- Deploy preview, mở 3–4 bảng liên tiếp; bảng nào cũng hiện dữ liệu.
- Cập nhật trạng thái file này và dòng tương ứng trong mục Kế hoạch của `README.md`.

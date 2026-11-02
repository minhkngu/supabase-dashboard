---
name: siris-web-design
description: Thiết kế và mở rộng giao diện Siris Supabase Manager theo hệ thống hiện tại; áp dụng cho bảng dữ liệu, menu, biểu mẫu và thiết lập cột.
---

# Siris — Quy tắc thiết kế web

## Mục tiêu

Tạo không gian làm việc dữ liệu giống thao tác bảng tính của Lark Base: gọn, dễ quét, sửa ngay tại ô, phản hồi tức thì. Dữ liệu là nội dung chính. Mọi tính năng mới, kể cả tính năng phát sinh từ backend, phải dùng cùng ngôn ngữ giao diện.

Đây là hướng dẫn duy trì thiết kế của project hiện tại, không phải yêu cầu thiết kế lại toàn bộ web. Không tự đổi nhận diện hoặc mở rộng phạm vi tính năng.

## Nguồn chuẩn trong project

- `style.css`: token màu, chữ, kích thước, trạng thái và responsive.
- `index.html`: app shell, toolbar, dialog và cấu trúc biểu mẫu.
- `app.js`: custom select, sửa ô, chọn vùng, nhóm, ghim và cập nhật nền.
- `tests/e2e/`: kiểm tra hành vi giao diện đang có.

Trước khi sửa, đọc component và các CSS override liên quan. Tái sử dụng class và hàm hiện có; không tạo thêm một bộ dropdown hoặc dialog riêng cho tính năng mới. Những thông số dưới đây được đối chiếu với mã nguồn tại thời điểm viết; nếu mã thay đổi, kiểm tra computed style trước khi quyết định.

## Màu sắc và bề mặt

| Vai trò | Token / Giá trị hiện tại |
| --- | --- |
| Nền ứng dụng, sidebar | `--bg-app`, `--bg-sidebar`: `#f8fafc` |
| Bề mặt bảng, form, menu | `--bg-surface`: `#ffffff` |
| Nền phụ / header | `--bg-subtle`: `#f1f5f9` |
| Viền thông thường | `--border-default`: `#e2e8f0` |
| Viền nhẹ trong bảng | `--border-subtle`: `#f1f5f9` |
| Chữ chính | `--text-primary`: `#0f172a` |
| Chữ nội dung | `--text-secondary`: `#334155` |
| Chữ phụ | `--text-muted`: `#64748b` |
| Accent / hành động chính | `--accent`: `#4f46e5` |
| Accent hover | `--accent-hover`: `#4338ca` |
| Nền đang chọn | `--accent-soft`: `#eef2ff` |
| Viền đang chọn | `--accent-border`: `#c7d2fe` |
| Focus | `--border-focus`: `#6366f1`, ring `--accent-ring` |

Dùng token thay cho mã màu lặp lại. Màu đỏ dành cho lỗi và thao tác xóa; xanh lá cho thành công/đúng; vàng cho cảnh báo có tác động cụ thể. Không thêm gradient, glow hoặc màu trang trí cho panel mới. Giữ nhãn màu của bảng hiện có nhất quán.

## Chữ, khoảng cách và hình dạng

- Font giao diện: `--font-sans`, hiện là Plus Jakarta Sans với system fallback. Cỡ thân bài và control cơ bản 13px, line-height 1.5.
- Số và dữ liệu kỹ thuật: `--font-mono`, hiện là JetBrains Mono với monospace fallback. Cột số căn phải.
- Tiêu đề dialog hiện 17px, đậm 700. Chữ hướng dẫn nhỏ và nhạt hơn nội dung, vẫn phải dễ đọc.
- Dùng nhịp khoảng cách 4 / 8 / 12 / 16 / 20 / 24px; tái sử dụng khoảng cách của vùng lân cận.
- Bo góc: nhỏ 6px, control 8px, khung bảng 12px, dialog 16px; pill dùng `--radius-full`.
- Bóng đổ nhẹ cho bảng; menu và dialog dùng token shadow riêng. Không thêm bóng đổ cho mọi control.

## Bố cục

Sidebar trái chứa tên Siris, tìm bảng, tạo folder, các bảng theo folder và nút thu gọn. Không thêm lại logo trang trí hoặc badge “Base”. Giữ thứ tự bảng, folder và trạng thái đóng/mở đã lưu.

Vùng chính gồm tên bảng và hành động bản ghi; toolbar tìm kiếm, Cột, Lọc, Nhóm, Sắp xếp và làm mới; sau đó là bảng và phân trang. Hạn chế chữ mô tả lặp. Một hành động chính nổi bật trong mỗi vùng.

Toolbar căn giữa theo chiều dọc, khoảng cách đều, control cùng chiều cao trong cùng hàng. Cho phép xuống hàng theo nhóm khi thiếu chỗ; không ép chữ hoặc icon chồng nhau. Giữ bảng cuộn ngang trong vùng bảng thay vì làm toàn trang tràn ngang.

## Icon và nút

- Dùng SVG nét đồng nhất, thường 14–18px, `currentColor`, nét khoảng 1.8–2px. Tránh trộn emoji, ký tự Unicode và SVG cho cùng nhóm hành động.
- Nút icon dùng `inline-flex`, căn giữa hai trục; SVG `display: block`, không co. Không căn bằng dấu cách hoặc margin sửa lệch từng nút.
- Nút đóng dialog hiện có vùng bấm 28×28px; căn cùng trục với tiêu đề. Kiểm tra vị trí thật, không chỉ nhìn hộp bao.
- Nút chỉ icon phải có `aria-label` và tooltip rõ nghĩa.
- Primary nền indigo, chữ trắng; secondary nền trắng, viền nhẹ; destructive đỏ. Trạng thái disabled khác rõ nhưng không làm bố cục dịch chuyển.

## Dropdown toàn web

Dùng custom select hiện có cho kiểu dữ liệu, boolean, enum, bảng nguồn, cột nguồn và các lựa chọn trong dialog. Cùng hình dạng nút, khoảng đệm, hover, focus, dấu chọn và shadow ở mọi vị trí.

- Select gốc chỉ giữ vai trò dữ liệu khi được bọc bằng giao diện tùy chỉnh. Không để cả select gốc lẫn nút tùy chỉnh cùng hiện; bảo đảm `[hidden]` không bị `display` khác ghi đè.
- Menu cách nút một khoảng rõ ràng, đề xuất 6–8px. Hai dropdown xếp dọc phải có khoảng cách; không xóa một control chỉ vì chúng đang dính nhau.
- Menu không bị cắt bởi overflow của ô hoặc dialog. Dùng cơ chế định vị/portal hiện có, đổi hướng mở khi thiếu chỗ.
- Bảng nguồn sắp xếp theo folder và thứ tự sidebar; không tự chuyển sang thứ tự alphabet.
- Hỗ trợ bàn phím, Escape, focus và đóng khi bấm ngoài. Chọn một mục không được vô tình lưu hai lần.
- Không thêm icon mũi tên thứ hai khi component đã có chỉ báo. Giữ quy ước chỉ báo đang dùng của từng nhóm control.

## Bảng dữ liệu

Hàng dữ liệu hiện cao 40px, padding ngang 12px. Cột số thứ tự hiện rộng 48px. Văn bản dài cắt ellipsis, có cách xem/sửa đầy đủ. Giá trị trống hiển thị nhẹ, không dùng chuỗi “null” như nội dung người dùng.

- Ô mặc định dùng con trỏ phù hợp chọn/kéo vùng; khi nhập văn bản mới dùng con trỏ nhập.
- Kéo chọn nhiều ô không mở editor giữa thao tác. Phân biệt chọn ô, kéo vùng và vào chế độ sửa.
- Vùng chọn có nền/viền rõ; hỗ trợ copy, paste nhiều dòng và Delete theo hành vi đã triển khai.
- Số hiển thị dấu phẩy phân tách hàng nghìn, ví dụ `9,500,000`; khi nhập phải giữ vị trí con trỏ hợp lý và gửi giá trị số hợp lệ về backend.
- Cột chỉ đọc vẫn chọn và copy được. Formula/lookup đang tự tính phải thể hiện trạng thái chỉ đọc, không chặn thao tác chọn vùng.
- Giữ thứ tự, độ rộng, ẩn và ghim cột khi cập nhật dữ liệu. Ẩn hoặc di chuyển cột cập nhật ngay cả header và body.

### Freeze và nhóm

Header và dữ liệu của cùng cột phải ghim ở cùng vị trí. Tính lại offset khi resize, reorder, hide hoặc đổi cấu trúc; tránh để lớp khác che mất viền.

Mỗi cột freeze có đường phân chia 1px. Mép ngoài vùng freeze hiện dùng đường 2px `#94a3b8` và shadow nhẹ. Viền phải còn thấy khi cuộn ngang, hover và chọn ô; nền sticky phải đặc.

Tiêu đề nhóm hiển thị giá trị người dùng nhìn thấy trong ô liên kết, ví dụ “Mia”; không thêm tiền tố “branchid:”. Tiêu đề nhóm chỉ ghim khi cuộn ngang, không ghim theo chiều dọc. Giữ nút đóng/mở nhóm và số lượng.

## Dialog và biểu mẫu

Giữ header, nội dung và footer thành ba vùng rõ. Chỉ một vùng nội dung cuộn; không xuất hiện hai thanh cuộn dọc cạnh nhau. Footer giữ nút xóa ở trái, Hủy/Lưu ở phải, có khoảng cách khi xuống hàng.

Mỗi trường có label rõ, hướng dẫn ngắn về cần nhập gì và trạng thái bắt buộc/tự sinh/chỉ đọc. Tái sử dụng kiểu input theo metadata Supabase. Không mô tả UUID là tên hiển thị; trường liên kết phải giúp chọn bản ghi bằng nhãn dễ hiểu.

Trong thiết lập cột, lookup và formula nằm trong chính dialog dưới toggle. Bật toggle mới mở phần cấu hình liên quan. Không tạo bước chọn cột trung gian khi người dùng đang cấu hình trực tiếp cột thật. Chặn cấu hình không hợp lệ bằng lỗi tại vị trí liên quan.

Nút thêm cột mở thẳng giao diện tạo cột mới; không khôi phục bước lựa chọn “Tạo liên kết / Tạo cột mới” đã bỏ. Nhân bản cột dùng cùng hệ thống dialog và control.

## Phản hồi tức thì và lưu nền

- Cập nhật UI tại chỗ, giữ scroll, focus và vùng chọn. Không reload trang để phản ánh thay đổi dữ liệu hoặc schema.
- Sau khi kiểm tra hợp lệ phía client, bấm Lưu thiết lập cột thì đóng dialog ngay và lưu nền. Không chèn popup xác nhận lưu lặp lại. Giữ các xác nhận xóa có chủ đích đang áp dụng.
- Có trạng thái đang lưu/thành công/lỗi vừa đủ. Khi thất bại, rollback phần lạc quan cần thiết, khôi phục nội dung đã nhập và cho sửa/lưu lại.
- Không hiển thị thành công trước kết quả backend. Không dùng spinner toàn trang cho một thay đổi nhỏ.
- Font hoặc dữ liệu phụ chưa sẵn sàng không được làm màn hình trống hay khiến control nhảy vị trí.

## Responsive và accessibility

Ở màn hình hẹp, dùng sidebar thu gọn hoặc drawer theo cơ chế hiện có; toolbar xuống hàng và form chuyển một cột khi cần. Dialog vừa viewport, phần nội dung cuộn, footer không che trường cuối.

Giữ focus-visible, label cho input, tên truy cập cho icon và trạng thái mở/đóng cho menu. Không dùng màu làm tín hiệu duy nhất. Tôn trọng `prefers-reduced-motion`; chuyển trạng thái nhẹ khoảng 100–150ms, không animation lại cả bảng.

## Quy trình áp dụng và kiểm chứng

1. Xác minh component, token, dữ liệu và hành vi thực tế của vùng cần sửa; đọc yêu cầu mới nhất trước khi áp dụng quy tắc cũ.
2. Chọn thay đổi nhỏ có thể kiểm chứng, tái sử dụng component sẵn có. Nếu cần component mới, dùng cùng token và interaction.
3. Kiểm tra trên trình duyệt ở desktop và màn hình hẹp: default, hover, focus, chọn, đang lưu, lỗi; với menu kiểm tra cả gần mép viewport.
4. Với bảng, kiểm tra cuộn ngang, freeze, group, chọn nhiều ô và editor; với dialog kiểm tra một thanh cuộn và footer.
5. Chạy các kiểm tra phù hợp mà project hỗ trợ. Báo kết quả đã thực sự quan sát; không suy ra giao diện đúng chỉ từ build thành công.

Viết hoặc chỉnh hướng dẫn này không đồng nghĩa cho phép thay đổi dữ liệu Supabase hay xuất bản Site. Chỉ cập nhật Site khi người dùng yêu cầu; giữ nguyên phạm vi truy cập hiện có.

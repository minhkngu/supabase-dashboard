// Labels and behaviour that depend on specific tables live here, so the
// rest of the code stays generic.

export const PROMOTIONS_TABLE = 'public.promotions';

// Field labels shown in table dashboards.
export const FIELD_LABELS = {
  name: 'Tên',
  item_name: 'Vật phẩm',
  address: 'Địa chỉ',
  is_hidden: 'Hiển thị',
  branchid: 'Chi nhánh',
  sqm: 'Diện tích',
  weekdayprice: 'Giá ngày thường',
  weekendprice: 'Giá cuối tuần',
  monthly_under_3: 'Giá tháng dưới 3 tháng',
  monthly_over_3: 'Giá tháng từ 3 tháng',
  monthly_under: 'Giá tháng ngắn hạn',
  monthly_over: 'Giá tháng dài hạn',
  minContractMonths: 'Hợp đồng tối thiểu',
  date: 'Ngày',
  type: 'Loại',
  amount: 'Mức điều chỉnh',
  note: 'Ghi chú',
  kind: 'Loại',
  quantity: 'Số lượng',
  unit_price: 'Đơn giá',
  minnights: 'Số đêm tối thiểu',
  discountamount: 'Mức giảm',
  code: 'Mã',
  category: 'Nhóm',
  amount_type: 'Kiểu tính',
  calculation_base: 'Cơ sở tính',
  is_active: 'Trạng thái',
  key: 'Khóa',
  value: 'Giá trị',
  description: 'Mô tả',
};

// Dashboard title and the fields shown for known tables.
export const OVERVIEW_CONFIGS = {
  branches: { title: 'Tổng quan chi nhánh', fields: ['name', 'address', 'is_hidden'] },
  longterm_branches: { title: 'Tổng quan chi nhánh dài hạn', fields: ['name', 'address', 'is_hidden'] },
  room_types: {
    title: 'Tổng quan loại phòng',
    fields: [
      'name',
      'branchid',
      'sqm',
      'weekdayprice',
      'weekendprice',
      'monthly_under_3',
      'monthly_over_3',
      'is_hidden',
    ],
  },
  longterm_room_types: {
    title: 'Tổng quan loại phòng dài hạn',
    fields: ['name', 'branchid', 'sqm', 'monthly_under', 'monthly_over', 'minContractMonths', 'is_hidden'],
  },
  date_adjustments: { title: 'Tổng quan điều chỉnh theo ngày', fields: ['date', 'type', 'amount', 'note'] },
  items: { title: 'Tổng quan vật phẩm', fields: ['item_name', 'kind', 'quantity', 'unit_price', '__total'] },
  stay_discounts: { title: 'Tổng quan giảm giá lưu trú', fields: ['name', 'minnights', 'discountamount'] },
  settings: { title: 'Tổng quan cấu hình', fields: ['key', 'value', 'description'] },
  longterm_settings: { title: 'Tổng quan cấu hình dài hạn', fields: ['key', 'value', 'description'] },
  service_rules: {
    title: 'Tổng quan quy tắc dịch vụ',
    fields: ['name', 'category', 'amount', 'amount_type', 'is_active'],
  },
};

// Room type tables show the branch name from their branch table.
export const BRANCH_TABLE_FOR = {
  room_types: 'branches',
  longterm_room_types: 'longterm_branches',
};

// Tables whose dashboard counts visible rows from an is_hidden flag.
export const HIDDEN_FLAG_TABLES = ['branches', 'longterm_branches'];

// Tables whose dashboard sums the quantity column.
export const QUANTITY_TABLES = ['items'];

// Hint shown under a record field, by column name.
export function fieldHints(tableName) {
  return {
    name: tableName.includes('room_types') ? 'Tên loại phòng.' : 'Tên hiển thị.',
    name_en: 'Tên hiển thị bằng tiếng Anh.',
    description: 'Nội dung mô tả.',
    description_en: 'Nội dung mô tả bằng tiếng Anh.',
    branchid: 'Mã chi nhánh mà bản ghi này thuộc về.',
    tag: 'Nhãn dùng để phân loại.',
    address: 'Địa chỉ chi nhánh.',
    address_en: 'Địa chỉ bằng tiếng Anh.',
    amenities: 'Danh sách tiện nghi, ngăn cách bằng dấu phẩy.',
    amenities_en: 'Danh sách tiện nghi bằng tiếng Anh.',
    excluded_amenities: 'Danh sách tiện nghi không bao gồm, ngăn cách bằng dấu phẩy.',
    excluded_amenities_en: 'Danh sách tiện nghi không bao gồm bằng tiếng Anh.',
    weekdayprice: 'Giá vào ngày thường (VND).',
    weekendprice: 'Giá vào cuối tuần (VND).',
    monthly_under_3: 'Giá thuê theo tháng dưới 3 tháng (VND).',
    monthly_over_3: 'Giá thuê theo tháng từ 3 tháng trở lên (VND).',
    sqm: 'Diện tích phòng tính bằng mét vuông.',
    is_hidden: 'Bật true để ẩn mục khỏi giao diện.',
    fees: 'Các khoản phí và cách tính.',
    policies: 'Chính sách dạng JSON.',
    excluded_amenities_en: 'Danh sách tiện nghi không bao gồm bằng tiếng Anh.',
    amount: 'Số tiền điều chỉnh.',
    note: 'Ghi chú bổ sung.',
    date: 'Ngày áp dụng.',
  };
}

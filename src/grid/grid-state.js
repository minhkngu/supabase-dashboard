// Dữ liệu và phân trang của lưới được thay đổi qua module này.
const grid = { rows: [], page: 0, total: 0 };
export const getRows = () => grid.rows;
export const getPage = () => grid.page;
export const getTotal = () => grid.total;
export function setRows(rows) {
  grid.rows = rows;
}
export function setPage(page) {
  grid.page = page;
}
export function setTotal(total) {
  grid.total = total;
}

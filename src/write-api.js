import { api } from './api.js';
import { dataChanged } from './events.js';

// Thông báo trước khi gửi: phản hồi tải đang chạy phải được xem là cũ.
export function writeApi(url, options) {
  const match = url.match(/^\/api\/table\/([^/?]+)/);
  dataChanged(match ? decodeURIComponent(match[1]) : null);
  return api(url, options);
}

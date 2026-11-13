// Sự kiện nội bộ: nơi gửi không cần import module lưới.
const events = new EventTarget();

export function onGridAction(handler) {
  events.addEventListener('grid-action', event => {
    const detail = /** @type {CustomEvent} */ (event).detail;
    try {
      detail.result = handler(detail.action, detail.value);
    } catch (error) {
      detail.error = error;
    }
  });
}

export function gridAction(action, value) {
  const detail = { action, value, result: undefined, error: undefined };
  events.dispatchEvent(new CustomEvent('grid-action', { detail }));
  if (detail.error) throw detail.error;
  return detail.result;
}

export function onDataChanged(handler) {
  events.addEventListener('data-changed', event => handler(/** @type {CustomEvent} */ (event).detail));
}

export function dataChanged(table = null) {
  events.dispatchEvent(new CustomEvent('data-changed', { detail: table }));
}

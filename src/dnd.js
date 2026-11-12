// Shared by every drag interaction: scroll a container while the pointer is
// held near its edge. dragover fires repeatedly, so one small step per event
// gives a steady scroll.
const EDGE = 40;
const STEP = 18;

/**
 * @param {HTMLElement | null} container
 * @param {{ clientX: number, clientY: number }} e
 * @param {'x' | 'y'} axis
 */
export function autoScrollWhileDragging(container, e, axis = 'y') {
  if (!container) return;
  const rect = container.getBoundingClientRect();
  const [pos, start, end] = axis === 'x' ? [e.clientX, rect.left, rect.right] : [e.clientY, rect.top, rect.bottom];
  let delta = 0;
  if (pos < start + EDGE) delta = -Math.ceil((STEP * (start + EDGE - pos)) / EDGE);
  else if (pos > end - EDGE) delta = Math.ceil((STEP * (pos - (end - EDGE))) / EDGE);
  if (!delta) return;
  if (axis === 'x') container.scrollLeft += delta;
  else container.scrollTop += delta;
}

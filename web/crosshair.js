// The AutoCAD-style cursor over the drawing canvas (TODO 155o): a full crosshair and a pick box, drawn as a small element that is only moved,
// so it follows the pointer through pan / zoom without repainting the drawing. AutoCAD values (his AutoCAD 2027): CURSORSIZE 5, PICKBOX 3.
import { h } from './dom.js';

export const CURSORSIZE = 5;                       // % of the canvas, each arm from the centre
export const PICKBOX = 3;                          // AutoCAD's size is the half side: the box is 2 * 3 + 1 px (the same reading as grips and snap markers)
export const pickBoxSide = (n = PICKBOX) => 2 * n + 1;

/** One arm length in CSS px, centre to tip, the same on both axes (AutoCAD's crosshair is square): CURSORSIZE % of the screen height. */
export const crosshairArm = (screenH, pct = CURSORSIZE) => Math.round(screenH * pct / 100);

/** The crosshair for `canvas`: visible only where the OS cursor is hidden (cursor: none), so panels, buttons and the pan / text cursors keep theirs. */
export function attachCrosshair(canvas) {
  const el = h('div', { class: 'xhair', hidden: true, 'aria-hidden': 'true', 'data-testid': 'crosshair' }, h('i', { class: 'xh-h' }), h('i', { class: 'xh-v' }), h('i', { class: 'xh-box' }));
  el.style.setProperty('--pb', pickBoxSide() + 'px');
  let rect = null, target = null, x = 0, y = 0;            // the cached canvas rect, the element last under the pointer, the pointer in client px
  const arm = () => el.style.setProperty('--arm', crosshairArm(screen.height) + 'px');
  const place = () => { const r = rect ||= canvas.getBoundingClientRect(); el.style.transform = `translate(${Math.round(x - r.left)}px, ${Math.round(y - r.top)}px)`; };
  // The cursor is read when the element under the pointer or the canvas class / style changes (Space-pan, tool switch), not on every move.
  const show = () => { el.hidden = !(target instanceof Element && getComputedStyle(target).cursor === 'none'); if (!el.hidden) place(); };
  const stale = () => { rect = null; };
  arm();
  new ResizeObserver(stale).observe(canvas);
  addEventListener('scroll', stale, true);
  addEventListener('resize', () => { stale(); arm(); });
  new MutationObserver(() => { if (target) show(); }).observe(canvas, { attributes: true, attributeFilter: ['class', 'style'] });
  canvas.addEventListener('pointermove', (e) => {
    if (e.pointerType === 'touch') return;
    x = e.clientX; y = e.clientY;
    if (e.target !== target) { target = e.target; show(); } else if (!el.hidden) place();
  });
  canvas.addEventListener('pointerleave', () => { target = null; el.hidden = true; });
  return el;
}

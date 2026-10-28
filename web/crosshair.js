// The AutoCAD-style cursor over the drawing canvas (TODO 155o): a full crosshair and a pick box, drawn as a small element that is only moved,
// so it follows the pointer through pan / zoom without repainting the drawing. AutoCAD values (his AutoCAD 2027): CURSORSIZE 5, PICKBOX 3.
import { h } from './dom.js';

export const CURSORSIZE = 5;                       // % of the canvas, each arm from the centre
export const PICKBOX = 3;                          // AutoCAD's size is the half side: the box is 2 * 3 + 1 px (the same reading as grips and snap markers)
export const pickBoxSide = (n = PICKBOX) => 2 * n + 1;

/** The arm lengths in px for a canvas of w by h px: each arm is CURSORSIZE % of the canvas size along its own axis. */
export const crosshairArms = (w, hh, pct = CURSORSIZE) => [Math.round(w * pct / 100), Math.round(hh * pct / 100)];

/** The crosshair for `canvas`: visible only where the OS cursor is hidden (cursor: none), so panels, buttons and the pan / text cursors keep theirs. */
export function attachCrosshair(canvas) {
  const el = h('div', { class: 'xhair', hidden: true, 'aria-hidden': 'true', 'data-testid': 'crosshair' }, h('i', { class: 'xh-h' }), h('i', { class: 'xh-v' }), h('i', { class: 'xh-box' }));
  el.style.setProperty('--pb', pickBoxSide() + 'px');
  let size = '';
  canvas.addEventListener('pointermove', (e) => {
    if (e.pointerType === 'touch') return;
    const on = e.target instanceof Element && getComputedStyle(e.target).cursor === 'none';
    el.hidden = !on;
    if (!on) return;
    const r = canvas.getBoundingClientRect(), key = r.width + 'x' + r.height;
    if (key !== size) { size = key; const [ax, ay] = crosshairArms(r.width, r.height); el.style.setProperty('--ax', ax + 'px'); el.style.setProperty('--ay', ay + 'px'); }
    el.style.transform = `translate(${Math.round(e.clientX - r.left)}px, ${Math.round(e.clientY - r.top)}px)`;
  });
  canvas.addEventListener('pointerleave', () => { el.hidden = true; });
  return el;
}

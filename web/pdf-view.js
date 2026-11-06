// pdf-view.js — the maths of the full-screen print preview (pure): where the page sits when fitted, and zoom / pan on top of it.
// A view is { z, tx, ty }: the screen position is tx,ty + z × the fitted position, z from 1 (Fit) to 32.
export const MIN_ZOOM = 1, MAX_ZOOM = 32;
export const FIT = Object.freeze({ z: 1, tx: 0, ty: 0 });

/** The page fitted and centred in a W × H box with a pad: px per mm and the page's top-left. */
export function fitBase(W, H, pageW, pageH, pad = 14) {
  const k = Math.min((W - 2 * pad) / pageW, (H - 2 * pad) / pageH);
  return { k, ox: (W - pageW * k) / 2, oy: (H - pageH * k) / 2 };
}

/** Zoom by `factor` keeping the point under (cx, cy) (box px) where it is; clamped to 1×..32×. */
export function zoomAt(view, cx, cy, factor) {
  const z = Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, view.z * factor)), r = z / view.z;
  if (z === MIN_ZOOM) return FIT; // 100% always means fitted and centred
  return { z, tx: cx - r * (cx - view.tx), ty: cy - r * (cy - view.ty) };
}

export const panBy = (view, dx, dy) => ({ ...view, tx: view.tx + dx, ty: view.ty + dy });

/** The view as paintPage wants it: { s (px per mm), ox, oy } from the fitted base. */
export const paintView = (base, view) => ({ s: base.k * view.z, ox: base.ox * view.z + view.tx, oy: base.oy * view.z + view.ty });

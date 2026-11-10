// Compare artwork in drawing mm, with the same visibility, placement and tint as its canvas.
import { mmul, unionBox } from './drawing.js';
import { shownItems, itemVisible } from './doc.js';
import { partSource } from './pdf-export.js';

export function compareSource(drawings, tint) {
  const visible = drawings.filter((x) => x.visible);
  const fl = { items: [], mats: [], layers: [], boxes: { model: null } };
  for (const item of visible) {
    const { factor: f, offset, off } = item, mi = fl.mats.length, li = fl.layers.length;
    for (const m of item.fl.mats) fl.mats.push(mmul([f, 0, 0, f, ...offset], m));
    fl.layers = fl.layers.concat(item.fl.layers);
    for (const it of shownItems(item.fl)) {
      if (!itemVisible(it, off)) continue;
      const b = it.b.map((v, i) => v * f + offset[i % 2]);
      fl.items.push({ ...it, ps: 0, m: it.m + mi, L: it.L.map((l) => l + li), b, css: tint(item.colour) });
      fl.boxes.model = unionBox(fl.boxes.model, b);
    }
  }
  return partSource({ name: 'Compare ' + visible.map((x) => x.name).join(' vs '), fl, factor: 1, off: new Set(), hide: [] });
}

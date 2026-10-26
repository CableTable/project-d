import { h } from './dom.js';
import { idbStore } from './idbstore.js';
import { parseHex, rgbHex, rgbHsb, hsbRgb, rgbCmyk, cmykRgb } from './colour.js';

const swatches = idbStore('project-d-swatches', 'swatches', 'swatches');

/** A draft colour: only OK returns a colour to the caller. Swatches belong to this PC. */
export function pickColour(current) {
  if (document.querySelector('.colour-picker')) return Promise.resolve(null);
  return new Promise((resolve) => {
    const previous = document.activeElement;
    let rgb = current.slice(), hsb = rgbHsb(rgb), saving = false, picking = false;
    const fields = {};
    const finish = (value = null) => {
      document.removeEventListener('keydown', key, true);
      dialog.close(); dialog.remove();
      if (previous?.isConnected) previous.focus();
      resolve(value && value.every((n, i) => n === current[i]) ? null : value);
    };
    const key = (e) => {
      if (picking) return;
      // Enter is OK only from a text field; on a button (OK included) it presses that button.
      if (e.key === 'Enter' && !e.target.matches?.('input[type=text]')) return;
      if (e.key === 'Escape' || e.key === 'Enter') {
        e.preventDefault(); e.stopImmediatePropagation();
        if (e.key === 'Escape') finish();
        else if (!ok.disabled) finish(rgb);
      }
    };
    const valid = () => {
      const bad = Object.values(fields).flat().some((el) => el.getAttribute('aria-invalid') === 'true');
      ok.disabled = bad; add.disabled = bad || saving;
    };
    const mark = (input, bad) => { input.classList.toggle('invalid', bad); input.setAttribute('aria-invalid', String(bad)); };
    const sync = (source = '') => {
      const values = { hsb, rgb, cmyk: rgbCmyk(rgb), hex: [rgbHex(rgb)] };
      for (const [group, inputs] of Object.entries(fields)) if (group !== source) inputs.forEach((el, i) => {
        el.value = group === 'hex' ? values[group][i] : String(+values[group][i].toFixed(2)); mark(el, false);
      });
      fresh.style.background = rgbHex(rgb);
      square.style.backgroundColor = rgbHex(hsbRgb([hsb[0], 100, 100]));
      cursor.style.left = hsb[1] + '%'; cursor.style.top = (100 - hsb[2]) + '%';
      hue.value = hsb[0]; hue.setAttribute('aria-valuetext', `${Math.round(hsb[0])} degrees`);
      valid();
    };
    const group = (id, labels, limits) => {
      fields[id] = labels.map((label, i) => h('input', { class: 'fld mono', type: 'text', inputmode: 'decimal',
        'aria-label': `${id.toUpperCase()} ${label}`, 'data-testid': `colour-${id}-${i}`, autocomplete: 'off', spellcheck: 'false',
        oninput: () => {
          const values = fields[id].map((el, j) => {
            const n = Number(el.value), bad = !/^\d+(\.\d*)?$/.test(el.value) || !Number.isFinite(n) || n > limits[j] || (id === 'rgb' && !Number.isInteger(n));
            mark(el, bad); return n;
          });
          valid();
          if (fields[id].some((el) => el.getAttribute('aria-invalid') === 'true')) return;
          if (id === 'hsb') { hsb = values; rgb = hsbRgb(hsb); }
          else { rgb = id === 'rgb' ? values : cmykRgb(values); hsb = rgbHsb(rgb); }
          sync(id);
        }
      }));
      return h('fieldset', {}, h('legend', {}, id.toUpperCase()), labels.map((label, i) =>
        h('label', {}, h('span', {}, label), fields[id][i], h('span', { class: 'lbl' }, limits[i] === 100 ? '%' : limits[i] === 360 ? '°' : ''))));
    };
    const cursor = h('i', { class: 'colour-cursor' });
    const square = h('div', { class: 'colour-square', 'data-testid': 'colour-square', 'aria-label': 'Saturation and brightness; also editable in HSB fields' }, cursor);
    const drag = (e) => {
      const box = square.getBoundingClientRect();
      hsb[1] = Math.max(0, Math.min(100, (e.clientX - box.left) / box.width * 100));
      hsb[2] = 100 - Math.max(0, Math.min(100, (e.clientY - box.top) / box.height * 100));
      rgb = hsbRgb(hsb); sync();
    };
    square.addEventListener('pointerdown', (e) => { if (e.button !== 0) return; square.setPointerCapture(e.pointerId); drag(e); });
    square.addEventListener('pointermove', (e) => { if (square.hasPointerCapture(e.pointerId)) drag(e); });
    const hue = h('input', { type: 'range', min: 0, max: 360, step: 'any', class: 'colour-hue',
      'aria-label': 'Hue', orient: 'vertical', 'data-testid': 'colour-hue', oninput: () => { hsb[0] = Number(hue.value); rgb = hsbRgb(hsb); sync(); } });
    const fresh = h('div', { class: 'colour-preview', 'data-testid': 'colour-new' });
    const preview = h('div', { class: 'colour-previews' }, h('span', {}, 'New'), fresh,
      h('div', { class: 'colour-preview', style: `background:${rgbHex(current)}`, 'data-testid': 'colour-current' }), h('span', {}, 'Current'));
    const ok = h('button', { class: 'btn primary', type: 'button', 'data-testid': 'colour-ok', onclick: () => finish(rgb) }, 'OK');
    const cancel = h('button', { class: 'btn', type: 'button', 'data-testid': 'colour-cancel', onclick: () => finish() }, 'Cancel');
    const status = h('div', { class: 'lbl colour-status', role: 'status', 'data-testid': 'colour-status' });
    const add = h('button', { class: 'btn', type: 'button', 'data-testid': 'colour-add', onclick: async () => {
      saving = true; valid();
      try { await swatches.put({ id: rgbHex(rgb), rgb: rgb.slice() }); status.textContent = 'Added to Swatches'; }
      catch { status.textContent = 'Could not save the swatch on this PC. Try again.'; }
      finally { saving = false; valid(); }
    } }, 'Add to Swatches');
    const screen = h('button', { class: 'btn', type: 'button', hidden: typeof window.EyeDropper !== 'function', 'data-testid': 'colour-screen', onclick: async () => {
      picking = true; screen.disabled = true;
      try { const result = await new window.EyeDropper().open(); const picked = parseHex(result.sRGBHex);
        if (picked) { rgb = picked; hsb = rgbHsb(rgb); sync(); }
      } catch (e) { if (e.name !== 'AbortError') status.textContent = 'Could not pick from screen. Try again.'; }
      finally { picking = false; screen.disabled = false; }
    } }, 'Pick from screen');
    const groups = h('div', { class: 'colour-fields' }, group('hsb', ['H', 'S', 'B'], [360, 100, 100]),
      group('rgb', ['R', 'G', 'B'], [255, 255, 255]), group('cmyk', ['C', 'M', 'Y', 'K'], [100, 100, 100, 100]));
    const hex = h('input', { class: 'fld mono', type: 'text', 'aria-label': 'Hex', 'data-testid': 'colour-hex', autocomplete: 'off', spellcheck: 'false', oninput: () => {
      const parsed = parseHex(hex.value); mark(hex, !parsed); valid();
      if (parsed) { rgb = parsed; hsb = rgbHsb(rgb); sync('hex'); }
    } });
    fields.hex = [hex];
    const dialog = h('dialog', { class: 'pop-dialog colour-picker', 'aria-label': 'Colour picker', 'data-testid': 'colour-dialog', oncancel: (e) => { e.preventDefault(); finish(); } },
      h('h2', {}, 'Colour picker'), h('div', { class: 'colour-body' }, h('div', { class: 'colour-controls' },
        h('div', { class: 'colour-gradient' }, square, hue), h('label', { class: 'colour-hex' }, 'Hex', hex), screen),
      h('div', { class: 'colour-values' }, h('div', { class: 'colour-summary' }, preview, h('div', { class: 'colour-actions' }, ok, cancel, add)), groups)), status);
    document.body.append(dialog); sync(); dialog.showModal(); hex.focus(); hex.select();
    document.addEventListener('keydown', key, true);
  });
}

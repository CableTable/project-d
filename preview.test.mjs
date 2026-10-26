import assert from 'node:assert/strict';
import { drawingPreviewBox, overlayBox, screenBox } from './web/preview.js';

assert.equal(screenBox(null, [1, 0, 0, 1, 0, 0]), null);
assert.deepEqual(screenBox([0, 0, 10, 20], [0, 2, -2, 0, 50, 60]), [10, 60, 50, 80], 'all four corners of a rotated and scaled box');
const options = { fl: { boxes: { model: [10, 20, 30, 40] } }, factor: 2, sheetH: 200, ox: 5, oy: 10, scale: 3, dpr: 1.25 };
assert.deepEqual(drawingPreviewBox(options), [45, 330, 165, 450], 'drawing units and Y flip become CSS pixels, independent of DPR');
assert.deepEqual(drawingPreviewBox({ ...options, slots: [[0, 2, 2, 0, 50, 60]] }), [255, 210, 375, 330], 'Rotate / Scale use the same slot matrix as the renderer');
assert.deepEqual(drawingPreviewBox({ ...options, slots: [[0, 2, 2, 0, 50, 60], [1, 0, 0, -1, 100, 200]] }), [255, 210, 375, 510], 'all preview slots contribute to the shared bounds');
assert.equal(drawingPreviewBox({ ...options, fl: { boxes: { model: null, paper: null } } }), null);
const T = [2, 0, 0, 2, 10, 20];
assert.equal(overlayBox({}, T, 1), null);
assert.deepEqual(overlayBox({ dim: { lines: [[0, 0, 10, 5]], arrows: [[[0, 0], [1, 1], [1, -1]]] } }, T, 2), [5, 9, 15, 15], 'a dimension: points through T, then divided by dpr');
assert.deepEqual(overlayBox({ marks: [[10, 10]] }, T, 1), [18, 28, 42, 52], 'a placed mark is padded by its cross');
assert.deepEqual(overlayBox({ marks: [[10, 10, '', true]] }, T, 1), [18, 28, 42, 52], 'an unnamed hover mark needs no label bounds');
assert.deepEqual(overlayBox({ marks: [[10, 10, 'end', true]] }, T, 2), [3, 4, 95, 32], 'a named hover mark includes its label right and above in CSS pixels');
assert.deepEqual(overlayBox({ contour: [[[0, 0], [5, 0], [5, 5]]] }, T, 1), [10, 20, 20, 30]);
console.log('ok shared canvas preview bounds');

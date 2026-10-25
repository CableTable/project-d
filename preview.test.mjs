import assert from 'node:assert/strict';
import { drawingPreviewBox, screenBox } from './web/preview.js';

assert.equal(screenBox(null, [1, 0, 0, 1, 0, 0]), null);
assert.deepEqual(screenBox([0, 0, 10, 20], [0, 2, -2, 0, 50, 60]), [10, 60, 50, 80], 'all four corners of a rotated and scaled box');
const options = { fl: { boxes: { model: [10, 20, 30, 40] } }, factor: 2, sheetH: 200, ox: 5, oy: 10, scale: 3, dpr: 1.25 };
assert.deepEqual(drawingPreviewBox(options), [45, 330, 165, 450], 'drawing units and Y flip become CSS pixels, independent of DPR');
assert.deepEqual(drawingPreviewBox({ ...options, slots: [[0, 2, 2, 0, 50, 60]] }), [255, 210, 375, 330], 'Rotate / Scale use the same slot matrix as the renderer');
assert.deepEqual(drawingPreviewBox({ ...options, slots: [[0, 2, 2, 0, 50, 60], [1, 0, 0, -1, 100, 200]] }), [255, 210, 375, 510], 'all preview slots contribute to the shared bounds');
assert.equal(drawingPreviewBox({ ...options, fl: { boxes: { model: null, paper: null } } }), null);
console.log('ok shared canvas preview bounds');

// Makes fixtures/vector.pdf with our own PDF writer: a 160 × 80 mm rounded plate (lines and circular Béziers), a dial,
// a leader line across the plate and a text.   node tools/make-pdf-fixture.mjs
import { writeFileSync } from 'node:fs';
import { Page, writePdf, winAnsi } from '../web/pdf-write.js';

const pg = new Page(200, 120);
const K = 0.5522847498, r = 10;
pg.strokeColor([0, 0, 0]); pg.lineWidth(0.25);
// the plate, 20..180 × 20..100, corner radius 10, anticlockwise from the bottom edge
pg.moveTo(30, 20); pg.lineTo(170, 20);
pg.curveTo(170 + K * r, 20, 180, 30 - K * r, 180, 30); pg.lineTo(180, 90);
pg.curveTo(180, 90 + K * r, 170 + K * r, 100, 170, 100); pg.lineTo(30, 100);
pg.curveTo(30 - K * r, 100, 20, 90 + K * r, 20, 90); pg.lineTo(20, 30);
pg.curveTo(20, 30 - K * r, 30 - K * r, 20, 30, 20); pg.close(); pg.stroke();
// a dial: a circle of four Béziers
const cx = 60, cy = 60, R = 15;
pg.moveTo(cx + R, cy);
pg.curveTo(cx + R, cy + K * R, cx + K * R, cy + R, cx, cy + R); pg.curveTo(cx - K * R, cy + R, cx - R, cy + K * R, cx - R, cy);
pg.curveTo(cx - R, cy - K * R, cx - K * R, cy - R, cx, cy - R); pg.curveTo(cx + K * R, cy - R, cx + R, cy - K * R, cx + R, cy); pg.stroke();
// a screen box and a leader line that crosses the plate and touches nothing
pg.rect(100, 40, 50, 30); pg.stroke();
pg.moveTo(5, 60); pg.lineTo(40, 60); pg.stroke();
pg.text([6, 0, 0, 6, 105, 80], winAnsi('HELLO'));
writeFileSync('fixtures/vector.pdf', writePdf([pg], { title: 'vector fixture' }));
writeFileSync('fixtures/three-sheets.pdf', writePdf([pg, pg, pg], { title: 'three PDF sheets' }));
// fixtures/text-only.pdf: no vector lines at all, just a text (it opens as a background picture)
const tp = new Page(200, 120);
tp.text([10, 0, 0, 10, 20, 60], winAnsi('NO LINES HERE'));
writeFileSync('fixtures/text-only.pdf', writePdf([tp], { title: 'text only' }));

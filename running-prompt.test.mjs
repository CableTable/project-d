import { test } from 'node:test';
import assert from 'node:assert/strict';
import { RUNNING_PROMPT } from './tools/running-prompt.mjs';

// Real prompt strings from web/ (app.js, draw.js, move.js); r158d.txt lists none, so they were read from web/.
const RUNNING = [
  'Specify first point (x,y):',
  'Next point or length [Close / Undo]:',
  'Click inside a closed outline (Esc ends):',
  'Click each target (Esc ends):',
  'Click a source object (Esc ends):',
  'Hover for the colour, click copies its hex (Esc ends):',
  'Drag a box with the left button to zoom into it (Esc cancels):',
  'Select destination object (Esc ends):',
  'Type the text. Enter ends, Shift+Enter starts a new line:',
  'Specify base point or [Displacement/mOde] <Displacement>:',
  'Specify next fence point or [Undo]:',
  'Specify dimension line location [Horizontal/Vertical]:',
  'Specify leader arrowhead location:',
];
const IDLE = [
  '',
  'Click an object; right-click → Select connected for its outline. [Extract / Keep only / Measure]:',
  '3 selected. [Extract / Keep only / Measure]:',
  'Command [Group / Ungroup / Lock / Unlock]:',
  'Option [Inside / Outside / Distance / Steps / Sharp / Rounded / Apply]:',
  'Measure: click the first point (it snaps to ends and centres)',
];

test('a running-command prompt matches', () => { for (const p of RUNNING) assert.match(p, RUNNING_PROMPT, p); });
test('an idle prompt does not match', () => { for (const p of IDLE) assert.doesNotMatch(p, RUNNING_PROMPT, p); });

# Project D: to do

Ideas agreed but not built, in the order planned. Move an item to HISTORY.md and DECISIONS.md when it ships.

## Rakshith's list (2026-10-17, session 3): one at a time, each started only when he says

Lettered tickets are separate fresh builder runs, each targeting peak context under 150k tokens and usually 1–3 implementation files plus focused tests; read only the relevant modules and decision rows, and split further if a run exceeds the cap.

1. ✅ (built, PR #6) **Layout view doesn't show the part.** The slots on the sheet are empty rectangles, and the part is still drawn
   at its own position off the sheet (top right). Each slot should show the part itself.
2. ✅ (built, PR #9) **No way to move the part** around on the layout.
3. ✅ (built, PR #6) **Dimensions fix**: a kept dimension reads `300.0002018326812`; round it, with a setting for the number of decimal
   places (0, 1, 2, 3 …).
4. ✅ (built, PR #6) **Many parts, layout on its own page**: several parts from one drawing and from several drawings. Layout moves out
   of each file's Part | Layout switch and becomes its own page, where he picks which parts to use.
5. ✅ (built, PR #6) **Name parts** when he extracts them from a drawing.
6. ✅ (built, PR #6) **Scaling per drawing** (his pick, 2026-10-17): make the drawing 1:1 once (W × H or Set length), then every part
   extracted from it is true size. No per-part scaling.
7. ✅ (built, PR #6) **Grid fit as an option**: today rows and columns are worked out from the sheet size; make that a switch.
8. ✅ (built, PR #6) **Rows and columns by hand**: type the count of rows and columns.
9. ✅ (built, PR #9) **Rotate a part**, CorelDRAW style: on screen, with a pivot point he sets on the part, or by typing an angle.
10. ✅ (built, PR #9) **Custom grids by hand**: on the layout sheet, duplicate a part and place the copy wherever he wants.
11. ✅ (built, PR #9) **Duplicate along X / Y**: pick the direction, the distance between copies and the number of copies.
12. ✅ (built, PR #9) **Mirror** a part in X or Y.
13. ✅ (built, PR #9) **Nudge with the arrow keys**: the step (mm) is set in the top toolbar.
14. ✅ (built, PR #6) **Dimensions AutoCAD style**: click 1 = first point, the callout follows the mouse; click 2 = second point; then the
    callout moves with the mouse (up / down, its offset); click 3 fixes it at that height.
15. ✅ (built, PR #6) **Shift = straight along X or Y** when picking points (Measure, dimensions, Set length, moving parts): the second
    point locks to the horizontal or vertical through the first, whichever is closer to the cursor.
16. ✅ (built, PR #9) **Ctrl while dragging a part = copy** (the original stays, a copy drops where released); **Ctrl + Shift = copy
    and keep it straight** along X or Y, as in 15.
17. ✅ (built, PR #10) **Text**: add text, and resize it.
18. ✅ (built, PR #6) **Dimension callouts**: move and resize them after they're placed.
19. ✅ (built, PR #6) **Save extracted parts** so they can be used again later (his pick, 2026-10-17): saved inside the app by default
    (a Parts library panel to pick from, each part with a preview thumbnail, its name and W × H); **Export** writes a
    part to a .dxf when he asks.
20. ✅ (built, PR #6) **A saved layout reopens with its settings**: sheet, grippers, gaps, extra gaps, rotate, align, marks and the parts
    used, kept inside the .dxf (hidden from other CAD apps), so opening it brings the Layout panel back as it was. Goes
    with 4.

AutoCAD-style additions (his picks, 2026-10-17):

21. ✅ (built, PR #12) **Polar tracking and object-snap tracking**: dotted guides at 15°, 30°, 45° … and lining up with points already in
    the drawing.
22. ✅ (built, PR #10) **Grips**: select something, drag its blue end or middle points to stretch or move it.
23. ✅ (built, PR #10) **Resize the sheet on a layout**: the sheet can be selected and a side dragged to make it bigger or smaller.
24. ✅ (built, PR #10) **Properties panel** for what is selected: layer, colour, line type, length, radius.
25. ✅ (built, PR #10) **Select similar** (same layer or colour) and **Match properties**.
26. ✅ (built, PR #12) **More dimension types**: radius, Ø, angle, and linear (horizontal / vertical).
27. ✅ (built, PR #12) **Dimension styles**: arrow size, text height, decimals and units, saved as presets.
28. ✅ (built, PR #12) **Leaders**: a note with an arrow pointing at something.
29. ✅ (built, PR #12; manual only) **Inspection ballooning**: numbered balloons on a drawing's dimensions and notes, with a list (balloon no. →
    dimension → tolerance); a drawing can have several sheets. Now: placed by hand, on vector PDFs and on PDFs or
    pictures that are only images. Later: automatic (vector PDFs: find the dimension texts; image-only: OCR).
30. ✅ (built, PR #9) **Undo history list**: jump back several steps at once.
31. ✅ (built, PR #8; in the selection bar) **Area and perimeter** of a closed shape (for ink and cost).
32. ✅ (built, PR #9) **Autosave and recovery** after a crash.
33. ✅ (built, PR #8; DXFs and layouts, in the app) **Recent files** on the File menu.
34. ✅ (built, session 10, R12 option 2) **Own keyboard shortcuts**: Tools → Shortcuts…, typed aliases and keys, clash swaps, per-PC storage and .pgp import / export.
35. ✅ (built, PR #9) **Contour**, CorelDRAW style: pick an outline, inside or outside, a distance and a number of steps; corners sharp
    or rounded (his choice per use).

CorelDRAW-style additions (his picks, 2026-10-17):

36. ✅ (built, PR #9) **Align and Distribute**: line up left edges, centres or tops; space parts evenly.
37. ✅ (built, PR #9) **Group / Ungroup and Lock**: move several parts as one; lock things so they can't be bumped.
38. ✅ (built, PR #9) **Rulers and guidelines**: drag guides out of the rulers and snap to them.
39. ✅ (built, session 8, Option A of mock-up R11) **Object Manager**: a tree of everything in the file, layer by layer, with show, hide and lock.
40. ✅ (built, session 12, R14 section 05 option A; see DECISIONS) **Trace a bitmap** (CorelDRAW's PowerTRACE): a photo or scan of artwork → vector outlines. Outline only; Centreline comes later.
41. ✅ (built, PR #10) **Compare parts by colour**: give each part's outline its own colour (e.g. one red, one blue) and lay them over each
    other to see where they differ, e.g. two revisions of the same part. A button lines them up (same corner, or
    centres, using Align from 36), and an option highlights where the outlines differ by more than a set tolerance
    (e.g. 0.1 mm).

From the exe review (2026-10-17, session 3):

42. ✅ (built, PR #8) **Ctrl+0 = Fit** the drawing or sheet to the window.
43. ✅ (built, PR #8, without the click) **"Saved to <folder>"**: after a save, the command line names the folder (and a click opens it).
44. ✅ (built, PR #8, in the status bar) **Active tool chip**: a small label by the cursor or in the status bar saying which tool is on.
45. ✅ (built, PR #9) **New parts snap to the grid** when added to a sheet, with a hint that Shift places them straight.
46. ✅ (built, PR #9) **Fix tiny gaps** in a vector file (his ask, 2026-10-17): find ends that almost meet (within a tolerance he sets,
    e.g. 0.05 mm), mark them on the drawing, and a button joins them (moves the ends together) so outlines close
    properly for area, offset / contour and cutting. Today Area closes a loop across a tiny gap and says so.
47. ✅ (built, session 8, Option B of mock-up R12b: the floating command bar; see DECISIONS) **Full command line, AutoCAD style** (his ask, 2026-10-18; after the two Round 5 builds): every tool and action can be
    typed by name or alias (draw, edit, layout, view, file); Enter or Space repeats the last command; ↑ / ↓ go through
    the command history; autocomplete suggestions as you type; options in [brackets] that can be clicked or typed by
    their capital letter; typed coordinates (absolute, `@x,y`, `@len<angle`); Esc cancels; F2 opens the full command
    history. Mock-up first. TODO 34 (own aliases) builds on it.
48. ✅ (built, session 11, R14 option A) **Line width, CorelDRAW style** (his ask, 2026-10-19): an outline-width picker for the selected objects (preset
    widths plus a typed value, in the drawing's units), shown on screen at true width and kept on Save (DXF lineweight /
    polyline width) and in PDF / Print. Mock-up first. Note: the second-pass review found Mirror / Offset / Trim drop a
    polyline's width; that fix lands first.

From the AutoCAD / CorelDRAW pain-point research (his ask, 2026-10-19: "add all"; S/M/L = size; mock-up first where UI is new):
49. ✅ (built, session 11, R14 option A) **Remove duplicate / overlapping lines** (S–M): stops double cuts and double ink. Builds on Fix tiny gaps (46): report the count, then remove.
50. ✅ (built, session 11, R14 option A) **Preflight check before PDF / film / DXF** (M): one list of duplicates, open paths on a cut layer, tiny gaps, parts off
    the sheet, lines wider than a hairline, text not outlined; each row selects the offenders.
51. ✅ (built, session 11, R14 option A) **One-click unit fix, ×25.4 / ÷25.4** (S), next to Set length: the commonest "my file is the wrong size" cause.
52. ✅ (built, session 11, R14 option B) **Cutter-safe DXF save** (S–M): lines, arcs and polylines only, curves flattened to a typed tolerance. First check what dxf-write.js writes today.
53. ✅ (built, session 13) **Text to outlines** (L): TEXT and MTEXT → closed polylines for film and cut files, using font outlines without a build step.
    - 53a ✅ (built, session 12) TXO / Modify menu: single-line TEXT → closed polylines (holes kept), one undo.
    - 53b ✅ (built, session 13) composite / accented glyphs keep their components, holes and placement; missing glyphs skipped with advance kept and named in the result; DXF TEXT escapes covered.
    - 53c ✅ (built, session 12) rotation, alignment, width factor, mirroring kept; SHX → Arial named in the message.
    - 53d ✅ (built, session 13) MTEXT paragraphs, word wrap, attachment, rotation, height and line spacing; scoped height / width / oblique and bold runs; named formatting simplifications; one undo.
54. ✅ (built, session 12) **Wireframe (outline-only) view** (S): View → Wireframe, status-bar chip and F9; thin outlines without fills or background pictures, remembered across all tabs. PDF / Print and exports keep their fills.
55. ✅ (built, session 17: pan / zoom / open; 55c open) **Big-file performance** (M): open a 100k-entity DXF, measure pan / zoom, add culling or an index if it lags. Headless Chromium, 100k generated entities (`node tools/perf-big.mjs`), before → after: open 1.7 s → 1.7 s; zoom 46 fps (whole drawing in view) / 20 fps (at Fit) → 60 / 60; pan 60 fps (zoomed in) / 20 fps (all 100k in view) → 60 / 60 (60 = the screen's refresh rate). Full repaint at Fit is still about 100 ms, done once when the view settles.
    55a. ✅ Open a reproducible generated 100k-entity DXF and record open, pan and zoom timings in a browser performance check, keeping correctness assertions separate from machine-dependent timings. (`tools/gen-big-dxf.mjs`, `tools/perf-big.mjs`; the browser step uses 20k and a generous fps bound.)
    55b. ✅ (after 55a) If rendering lags, skip off-screen drawing items using their existing bounds, with conservative-bound unit tests and browser checks that panning and zooming reveal every object. (Bounds culling was already there; `web/perf.js` holds the cull test and the bitmap reuse, `perf.test.mjs` tests them.)
    55c. (after 55a) If picking or snapping lags, index their candidates while preserving hit order and rebuilding after edits / undo, with indexed-versus-current-result unit tests and a large-file browser check.
56. ✅ (built, session 17) **Font note on open** (S): one status-bar note per DXF open names unavailable fonts and their substitutes; shared with Text to outlines, no repeat on tab switches.

From the v0.1.30 exe test (Pip-test, 2026-10-20):
57. ✅ (fixed, session 9: the tab strip shrinks and scrolls on its own; tabs and + New layout stay on one line) **Many tabs push the whole window sideways** (bug, S): at 1024 px with ~17 tabs, clicking the last tab shifts the menu bar ~470 px left and cuts off the toolbar; it stays shifted after widening (−169 px at 1440); at 1440 with 14 tabs "+ New layout" wraps. The tab strip should scroll on its own. Screenshots: shots/exe/91-last-tab-1024.png, 66-light1024-layout.png.
58. ✅ (fixed, session 9: the second click's `detail === 2` does it, in `objClick`) **Double-click a layer row in the Objects tab does not make it current** (bug, S): the first click rebuilds the rows, so no dblclick arrives. The Layers panel click works.
59. ✅ (fixed, session 9: counts come from the file's entities, an IMAGE that draws nothing counts; see DECISIONS) **Layer counts disagree** (bug, S): sample.dxf: Layers panel NOTES 6, Objects tab NOTES 7 and 20 in total, status bar 19 entities. Find which count is right.
60. ✅ (tested, session 9, v0.1.30: Save, Save As, PDF / Print and the close prompt all pass; Pip-test drives the dialogs with shots/exe/uia.ps1) **Exe test of the native dialogs** (test, S): Save, Save As, PDF / Print save, the close prompt (Save / Don't save / Cancel; after Don't save a restart offers no recovery). Pip-test drives the Windows dialogs itself with UI Automation (PowerShell, by window title); a key press only after it has checked Project D is the foreground window (his call: he leaves the PC alone during the test). Not reached in the v0.1.30 test: the boxes piled up and he cancelled them by hand.
61. ✅ (fixed, session 9: `flatten` now registers every top-level entity's layer after the walk, so a cut-off file keeps all its layers; test in doc.test.mjs) **Counts on files past the draw limit** (bug, S): when a file hits the 400,000-piece draw limit, `flatten` stops before later layers reach `fl.layers`, so `layerCounts` skips their entities while `entityCount` and the Objects tree still count them (and that tree layer's eye / lock get idx -1). Fix: register every top-level entity's layer before the cut (or build the list from `raw.layers` too), plus a test with a cut-off file. From the Pip-review of 58 / 59.
62. ✅ (fixed, session 9: the new tab's dirty setter clears `empty` on any edit or save; browser coverage keeps drawn, edited and saved tabs and still replaces untouched ones) **Opening a file replaces a saved drawn tab** (bug, S): `+`, draw a line, Save it, then Open another file: the drawn tab disappears (the file stays on disk). `web/app.js:521` replaces an "untouched empty tab" and the `empty` flag (`web/app.js:178`) is never cleared by drawing. From the TODO 60 exe test.
63. ✅ (fixed, session 10: Save As reuses first Save's suggestion in the opened file's folder, as "<name>-edited.dxf"; new drawings keep the last-used folder) **Save As starts in the last-used folder** (question, S): from the TODO 60 exe test; decided 2026-10-20 (see DECISIONS).
64. ✅ (fixed, session 9: importing a background into a drawing marks it dirty and clears `empty`; browser coverage keeps the fresh tab and its picture on Open) **Import background on a fresh tab is lost on Open** (bug, S): new tab, pick a tool without drawing, Import background, then Open a file: the tab is replaced and the picture lost. `web/app.js:3447`: set `d.dirty = true` in that `else` branch. From the Pip-review of 62 (older than 62).
65. **Contour: colour and line style** (his ask, 2026-10-20, S–M): the Contour panel picks the new outlines' colour and line style (solid, dashed, dotted). Today they always go on the layer "Contour" with its colour, solid. Saved to DXF as the entity's colour and linetype.
    65a. Verify the already-built colour picker against the completed 65 below, fixing only missing preview / Apply / undo behaviour and its unit and browser coverage.
    65b. Verify the already-built Solid / Dashed / Dotted choices against the completed 65 below, fixing only missing DXF round-trip / PDF behaviour and its unit and browser coverage.

65. ✅ (built, session 10) **Contour colour and line style**: R13 swatches and Solid / Dashed / Dotted, both previews, Properties, DXF round trip and PDF; one-step undo.

From the UI research (Pip, 2026-10-20, ranked; page https://claude.ai/artifact/VPxPFSo6u1vonP7QdBetXE; his ask: all of it):
66. **More Modify tools** (S–L): Move and Copy (base point, then target or typed distance) first, then Rotate and Scale, then Fillet and Extend; in the Modify menu and the command bar (AutoCAD M, CO, RO, SC, F, EX).
    66a. Move selected drawing objects from a base point to a clicked or typed target through Modify and M, respecting layer locks and supporting preview, Esc and one-step undo, with unit and browser tests.
    66b. (after 66a) Copy selected drawing objects using the same base-point / target flow through Modify and CO, preserving the originals and properties with unit and browser undo tests.
    66c. (after 66a) Rotate selected drawing objects about a chosen pivot by a clicked or typed angle through Modify and RO, with preview, Esc, undo and unit / browser tests.
    66d. (after 66a) Scale selected drawing objects about a base point by a positive typed factor through Modify and SC, preserving widths and refusing unsupported transforms with unit and browser tests.
    66e. (after 66d) Fillet two drawing lines with a typed radius through Modify and F, trimming them and inserting a tangent arc as one undo step, with preview, invalid-case unit tests and a browser flow.
    66f. (after 66e) Fillet line / arc and arc / arc pairs through the same tool, with side selection, impossible-radius feedback and geometry / browser tests.
    66g. (after 66f) Fillet adjacent polyline segments while preserving bulges, closure and widths through the same tool, with geometry and browser undo / Save tests.
    66h. (after 66d) Extend a line to a picked boundary through Modify and EX, keeping the opposite end fixed and supporting repeat, Esc and undo with unit and browser tests.
    66i. (after 66h) Extend arcs and open polylines to boundaries through the same tool, preserving sweep, bulges and widths with unit and browser undo / Save tests.
67. **Guide lines when placing parts** (M): dragging a part on a layout snaps its edges and centre to other parts and the sheet, with a thin line and the gap in mm (CorelDRAW Dynamic Guides, Illustrator Smart Guides).
    67a. Snap a dragged part's edges and centre to the sheet's edges and centre with a thin alignment guide, reusing guide tolerances and testing placement, Esc and undo in unit and browser tests.
    67b. (after 67a) Snap dragged parts to other visible parts' edges and centres with alignment guides, deterministic candidate choice and unit / browser checks for rotated parts and existing guide interactions.
    67c. (after 67b) Show the relevant edge-to-edge gap in mm beside the active placement guide, with unit tests for gap calculations and browser checks for cleanup on drop or Esc.
68. **Snap per type** (M): a popover on the SNAP chip with a tick box per type; add intersection and quadrant (perpendicular, tangent later); the type's name beside the marker (AutoCAD Object Snap).
    68a. Filter the existing snap types through tick boxes on the SNAP chip and show the winning type beside its marker, preserving the master toggle with unit and keyboard / browser tests.
    68b. (after 68a) Add intersection snaps for line / polyline segments to the picker and marker, with crossing / parallel / visibility unit cases and a browser drawing flow.
    68c. (after 68b) Add line / arc and arc / arc intersection snaps, including circle and bulged-polyline segments, with tangent / finite-sweep unit cases and browser checks.
    68d. (after 68a) Add quadrant snaps for circles, arcs and ellipses to the picker and marker, with transformed-geometry unit cases and browser checks.
69. **Live numbers at the cursor** (M): a tag by the cursor with length, angle, Δx, Δy; typing fills the first field, Tab the next (AutoCAD Dynamic Input, F12).
    69a. Show length, angle, Δx and Δy beside the cursor during Line's next-point prompt, with F12 toggling it, tested calculations and a browser check that the tag stays on screen.
    69b. (after 69a) Let typing and Tab edit Line's cursor fields and commit a validated next point through the existing point-input path, with unit and browser checks for invalid input, Enter and Esc.
    69c. (after 69b) Reuse the cursor fields in Polyline and Rectangle / Rounded rectangle point prompts, with focused browser cases per caller and unit tests for their different anchors.
    69d. (after 69b) Reuse the cursor fields in Measure, dimension and Set length point prompts, with focused browser cases per caller and unit tests for their different anchors.
    69e. (after 69b, 66a) Reuse the cursor fields in Modify base-point / target prompts, with unit and browser checks for command-bar focus, typed displacement, F12 and cancellation.
    69f. (after 69b) Reuse the cursor fields in Circle, Ellipse and Arc point prompts, with focused browser cases per caller and unit tests for centre / axis anchors and tool-specific scalar prompts.
70. **Relative and polar typed input** (S): `@dx,dy` and `len<angle` in every point prompt; Enter on an empty command bar repeats the last command (check first what already works).
71. **Selection feedback** (S–M): left-to-right box = window (solid blue, fully inside), right-to-left = crossing (dashed green, touching); Alt + click cycles overlapping objects (doubled DXF lines). Check first what exists.
    71a. Check existing drawing box selection and complete solid-blue window / dashed-green crossing feedback with matching inside / touching logic, plus unit and browser cases for direction, modifiers and locks.
    71b. (after 71a) Apply the same window / crossing feedback to layout parts without selecting hidden or locked parts, with unit and browser checks for rotated parts and additive selection.
    71c. Cycle overlapping drawing objects with repeated Alt + click using stable hit order, highlighting the current candidate and resetting on a new location or edit, with unit and browser tests on duplicate lines.
72. **Right-click while drawing** (S): during a tool, right-click finishes (Enter); a menu with Cancel, Close, Undo last point and the snap list.
73. **Tooltips and F-keys** (S): tooltip = name + alias + key; add F3 snap, F8 ortho, F9 grid; optional "show labels" on the rail.
74. **More zooms** (S): Zoom Window, Zoom Selection, Zoom Previous (Z W, Z S, Z P).
75. **Array on a drawing** (M): rows / columns / spacing, plus polar (holes in a ring); step and repeat today is layouts only.
    75a. Add a rectangular array of selected drawing objects with validated rows, columns and spacing, preview, Apply / Cancel and one-step undo, with geometry and browser Save / reopen tests.
    75b. (after 75a) Add a polar array using a picked centre, count and angular spacing in the same flow, with rotated-copy geometry tests and browser Apply / Cancel / undo checks.
76. **Dimensions drive the drawing** (L, later): double-click a dimension, type a value, the line stretches; no full constraints.
    76a. Associate a newly placed linear dimension with one picked LINE and let double-clicking its value stretch that line's second end, with positive-value validation, undo and unit / browser tests.
    76b. (after 76a) Support horizontal and vertical driving dimensions on a LINE while preserving its other coordinate, with unit and browser checks for unchanged unrelated geometry and layer locks.
    76c. (after 76b) Keep driving-dimension associations through Save / reopen and recovery using stable references, disabling the edit with a clear message if the source was deleted or detached, with round-trip unit and browser tests.
    76d. (after 76c, T22) A dimension across a rectangle's two sides drives its size: the right or top side moves, the left and bottom stay fixed. Moved after the session 17 features: needs 76a–c, and T22 is covered by 105a / 105b meanwhile.

From the CAD forums research (Pip, 2026-10-20; page https://claude.ai/artifact/Sp3eoq15FKgsVFQpxmpPd7; his picks):
77. **Layer search box** (S): a small search box above the Layers list and the Objects tree; matches show, the rest hide (QCAD forum, 7 Oct 2026).
78. **Trim preview** (M): while the pointer is over a segment in Trim, draw the part that would go in faint red; the preview must match the result (LibreCAD #2632, #2647).
    78a. Preview the portion of a hovered LINE that Trim would remove in faint red by sharing the trim calculation, with unit and browser checks for selected edges, all edges, no cut and locked layers.
    78b. (after 78a) Preview removed portions of arcs, circles and polylines through that same calculation, with geometry and browser checks for bulges, multiple intersections and click-to-result agreement.
    78c. (after 78b) Clear or recompute Trim's preview on pointer leave, Esc, boundary changes, pan / zoom and undo, with focused browser cases that prevent stale red geometry.
79. ✅ (built, session 13) **Grips on big selections** (S): after Text to outlines, every vertex of the new outlines shows a grip, so the letters look blocky (Pip-look, session 12). Hide or thin grips when a selection has many vertices.
80. ✅ (built, session 13: could not be reproduced, no CSS change, a browser step pins the stacking) **Menus above tool hints** (S): the Text tool's hint box overlaps the bottom edge of an open menu by a few pixels (Pip-look, session 12). Give menus a higher z-index or hide the hint while a menu is open.
81. ✅ (built, session 13) **Test hygiene from the session 12 retro** (S): the Shortcuts browser step reads the command count from the COMMANDS table instead of a fixed number; browser steps that check colours set their theme first.
82. ✅ (fixed, session 14; exe check after merge) **Balloon file "forbidden path" in the exe** (M, bug, PC test v0.1.46): every open says "sample.pdballoons.json: could not be read (forbidden path …)" though none exists; saving a drawing with balloons raises a second Save As for the .pdballoons.json and the tab stays dirty until it is answered. A missing balloon file is silent; it is written beside the drawing with no second dialog (Tauri fs scope?).
83. ✅ (fixed, session 14; exe check after merge) **Text to outlines uses the fallback font in the exe** (M, bug, PC test v0.1.46): "Font file not found, used the fallback" and blocky letters for Standard text. The released exe must find the font (bundled or Windows\Fonts).
84. ✅ (built, session 15) **Ellipse menu hint says E, but E is Extract part** (S, PC test): the menu hint must match the alias (EL).
86. ✅ (built, session 15) **Fit to sheet ignores parts already placed** (S, PC test): Fit placed 72 copies on top of a placed part with no warning; skip or warn about overlaps.
87. ✅ (built, session 15) **Auto-nest counts an unapplied grid preview as taken** (S, PC test): "0 of 10 placed" while a Fit preview shows; ignore the preview or say it blocks.
85. ✅ (built, session 15) **Preflight panel: Esc and tabs** (S, PC test): Esc closes it; it belongs to its tab (not floating over every tab); its Close button stays reachable when the Balloons dock is open.
88. ✅ (built, session 15) **1024×768: Balloons dock and toasts eat the canvas** (S, PC test): smaller default dock height, toasts fade sooner. Also uia.ps1 should match SplitButton (local helper). Seen once, not reproduced: a dirty tab closed by × without a prompt.
89. ✅ (built, session 14) **Nearest snap; a snap beats ORTHO in Dimension** (S–M, his ask 2026-10-21): with ORTHO on, the Dimension tool forces the 2nd point onto the X/Y line from the 1st, so it can't land on a curve elsewhere (there is no Nearest snap, only ends / middles / centres). AutoCAD way: add a Nearest snap (closest point on the curve under the pointer); a snap wins over ORTHO; with ORTHO on the dimension is linear (horizontal or vertical, measuring only that distance), picked by where the dimension line is dragged.
91. **Explode (X)** ✅ (built, session 17) (S–M, his ask 2026-10-21): an outline and a square inside it select as one object (one polyline or a block) and there is no way to split them. AutoCAD way: Explode turns a polyline into lines / arcs and a block into its members (layer kept), one undo step; Modify menu + X / EXPLODE.
92. ✅ (built, session 15) **Tiny gaps rings clutter imported drawings** (S, his report 2026-10-21): an imported drawing shows hundreds of orange Tiny-gaps rings on letters, scale marks and arrows. Check whether they show without pressing Show; skip text, dimensions and annotation layers; consider a cap or a count-only summary when there are many.
90. ✅ (built, session 14) **Pure black drawing area in dark theme** (S, his ask 2026-10-21): the canvas background in the dark theme is #000; selection / highlight colours still read clearly on it.
93. ✅ (built, session 17) **Open a .dxf from Explorer** (S–M, bug, T12): with Project D as the default app, double-clicking a .dxf starts the app with no file. Read the launch path and open it in its own tab (as File → Open, fs scope granted as in 82); decide the already-running case (single-instance → new tab).
94. **Tidy the layout Drawing tab, CorelDRAW way** (M, ask, T13): the right panel is one long scroll; Parts on this layout and Step and repeat sit below the fold. First Knight researches how CorelDRAW really does page setup, rulers, guidelines and docker sections (official docs); then Rook picks the split (sheet setup in a bar or folded section, rulers / guides as View toggles, panel keeps parts + step and repeat). As-built board update.
95. ✅ (built, session 15) **Usage page: Usage | TODO | Tickets tabs, new look** (M, ask, T14): Project R look (his call 2026-10-21, no mock-up), phone bottom tabs / desktop segmented tabs, remembered last tab; whole TODO; Tickets from support/tickets.md with status chips, tag filters and expandable notes. Usage keeps its existing content and adds the three-agent daily token chart (14 days, IST; cache reads excluded).
96. ✅ (built, session 15) **Work area light / dark toggle** (S, ask, T15): canvas background light or dark independent of the app theme (plus "follow app theme"), remembered; selection / layer colours still read on both. As-built board update.
97. **Group / Ungroup on drawing tabs, and more edit tools** (L, ask, T16): Group (G, Ctrl+G) / Ungroup are layout-only now; make them work on drawing tabs, one undo step, saved in the DXF. Then ask him which extra tools first: Stretch, Break, Join, Chamfer, Lengthen, Align / Distribute, Weld / Intersect / Trim shapes, Reverse, Divide / Measure (66a–i, 75, 91 already listed).
98. ✅ (built, session 15) **Usage page "Refresh failed" dumps a stack trace** (S, bug, T17): one short failure / limit-reached line, last good numbers retained, full diagnostics only in the agent's local log; Rook probe retries once.
99. **Fix round for 92 / 88 (session 15 review)** ✅ (built, session 16) (S): (a) Medium: web/edit.js ~291 drops gaps on layers whose names hold "text", "dim" or "arrow" (e.g. "Text-cut", "DIM-OUTLINE"; Text to outlines keeps the text layer), so real cut outlines lose Tiny gaps / Join / the Preflight gap check. Drop the layer pattern, keep the entity-type check, add a test. (b) Low: web/cmdui.js ~127 error lines fade after 3 s like the rest; keep 9 s for errors.
100. ✅ (built, session 15) **Usage page: token chart as cumulative lines** (S, his pick 2026-10-21): replace the grouped daily bars with one running-total line per agent (Rook, Bishop, Knight) over the 14 IST days, dd-mmm labels, legend, end value labelled; same token definition (cache reads excluded).
101. ✅ (built, session 17) **Edit the footnote / title block text that prints on the PDF** (S–M, ask, T18): per-file Title block switch and five editable fields, Reset to automatic text; off frees the 22 mm strip and removes the warning. Saved with the document; untyped date stays today (2026-10-23 answers).
102. ✅ (built, session 16) **PDF save: start in the drawing's own folder, like Save As** (S, ask, T19): see T19 in support/tickets.md. Grill first.
103. ✅ (built, session 16) **Allow much more zoom (now max 40 px per mm)** (S, ask, T20): see T20 in support/tickets.md. Grill first.
104. ✅ (built, session 17) **Join gaps leaves ~half the gaps: micro-arcs shorter than the tolerance block it** (M, bug, T21): guarded micro-piece removal before the existing average-point join; count reported, one Undo restores everything. Synthetic fixture checks closure and <= 0.1% total length change.
105. (a built, session 16: W / H padlock; b built, session 17: rectangle edge drag; 76d later, see 76) **Can't set a rectangle to an exact W × H: Width / Height always scale in proportion** (M, bug, T22): see T22 in support/tickets.md.
105c. Circle radius grip and ellipse axis grips resize them (later, T22).
106. **Build dynamic input (TODO 69) now, for every drawing tool** (L, ask, T23): see T23 in support/tickets.md. Grill first.
107. ✅ (built, session 17) **Usage page TODO: show the sub-steps (66a, 66b...) of big items as a list** (S, ask, T24): “N of M done”, folded sub-step lists with done ticks, remembered on this browser. Knight role comes from the usage data; its forecast uses fresh window data immediately, or says “no data yet”.
108. ✅ (built, session 16) **Knight shows 100% for the 5-hour window after it has already reset** (S, bug, T25): see T25 in support/tickets.md. Grill first.
109. **In-depth export system like AutoCAD (formats, options, batch)** (L, ask, T26): see T26 in support/tickets.md. Grill first.
110. **Ribbon on top like AutoCAD** (L, ask, T27): see T27 in support/tickets.md. Grill first.
111. **Copy and paste between files, and from other programs (photos)** (L, ask, T28): see T28 in support/tickets.md. Grill first.
112. ✅ (built, session 16) **Compare, manual mode: no snapping** (S, bug, T29): see T29 in support/tickets.md. Grill first.
113. ✅ (built, session 16) **Compare runs constantly: make it a toggle or a run-once button** (S, bug, T30): see T30 in support/tickets.md. Grill first.
114. ✅ (built, session 17) **Compare: choose which drawings, more than two, from Parts library or drawing tabs** (M, ask, T31): up to five snapshots from tabs, the Parts library or disk; first ticked reference, visibility, per-item differences and measurement table.
115. ✅ (built, session 17) **Text in the YEB Sport drawing is converted to both curves and text** (M, bug, T32): PDF import excludes invisible searchable text (rendering modes 3 / 7), keeping the already drawn curves once. Visible text still becomes outlines in one Undo step.
116. **Open a Parts library part in a drawing tab** (S, ask, T33): see T33 in support/tickets.md. Grill first.
117. **Delete sheets, and why a sheet change warns that edits will be gone** (S, ask, T34): see T34 in support/tickets.md. Grill first.
118. **Alt+W closes the tab, Ctrl+Tab cycles tabs** (S, ask, T35): see T35 in support/tickets.md. Grill first.
119. ✅ (built, session 16) **View menu: Theme items uneven spacing, corner-only highlight, no tick** (S, bug, T36): see T36 in support/tickets.md. Grilled by support.
120. ✅ (built, session 17) **PDF drawing: dragging a selection does nothing** (S–M, bug, T37): selected drawing entities now drag together, with preview, one Undo and Escape / pointer-cancel. PDF drawing imports open unlocked, without a background picture.
121. ✅ (built, session 17) **Join gaps: CorelDRAW-style join methods (Average point, Extend, Chamfer, Fillet, Bezier)** (M, ask, T21 follow-up): Join today moves ends to their average point; add Corel's Join Curves methods (research in support/tickets.md, T21). After the bugs. Grill first.
122. ~~**Shaping tools like CorelDRAW: Weld, Trim, Intersect, Simplify, Front minus back, Back minus front, Create boundary**~~ (built, session 17: a = Weld / Trim / Intersect; b = Simplify / Front minus back / Back minus front / Create boundary). Boolean operations on closed outlines; Modify menu and command bar, one Undo.
123. **Shaping: keep originals (S)**: a switch (like CorelDRAW's "Leave original source / target object") so Weld,
     Trim, Intersect and the other Shaping tools can keep the shapes they started from. His ask, 2026-10-23; grill first.
124. **Break Apart (Ctrl+K) (S)**: split one outline that has several closed paths (e.g. a Weld result with holes)
     into separate outlines, one per path, the CorelDRAW way. Not the same as Explode (91), which splits into single
     lines and arcs. His ask, 2026-10-23; grill first.
125. ✅ (built, session 17) **Drag a part from the Parts library onto Compare** (S, ask, T49): a drop on the Compare canvas or panel adds it like Add from library (five at most); a hint follows the pointer.

## Next sessions (2D, for screen-printing layouts; screen A is built)

1. ✅ (built, PR #10) Drawing tools: line, polyline, rectangle, rounded rectangle, circle, ellipse, arc, text and dimension, with snaps, ortho and polar tracking, and typed coordinates. (Text: TODO 17. Polar tracking: TODO 21, built in PR #12.)
2. Edit tools: offset, trim, mirror, move, copy, rotate, scale, and undo and redo.
3. ✅ (built, session 6, option B of mock-up R10) Auto-nest of mixed parts.
4. Place by hand.
5. Import parts from DXF, DWG, CorelDRAW and PDF (mock-up "Import parts").
6. **Before starting: switch the repo back to private and bring back the CI diet (DECISIONS 2026-10-19).** DWG open through LibreDWG, in its own module.
7. .cdr open through libcdr. For now (his call, 2026-10-17): CorelDRAW → Export PDF, then open the PDF. He'll send a few .cdr files with their exported PDFs after PR #5; test libcdr on them first, and if it can't read them, write our own .cdr reader for what his files use (outlines, curves, text), checked against the PDFs.
8. Layers panel editing.
9. Title block with the revision table.
10. The 3D viewer ported from Project R (mock-up "3D viewer").

## Later (scope §5)

1. Sketcher with constraints, solved by PlaneGCS.
2. 3D parts on OpenCascade: extrude, revolve, cut, hole, fillet and chamfer, with a feature history.
3. Drawings from the model, saved as DXF and PDF.
4. Assemblies, sheet metal and a bill of materials.

## Small things noticed

1. IBM Plex fonts are not bundled, so the system font is used. Bundle them locally if he wants the mock-up's look.
2. A per-user .dxf file association, with no admin rights.
3. A "keep settings next to the exe" switch.
4. Drawing selection drag refuses HATCH and DIMENSION entities (`moveEntities`); add their move support.

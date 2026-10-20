# Project D: history

**2026-10-16**: The idea came up at the end of a Project R session, right after Project R's
drawing viewer (DXF) and 3D viewer were built and file uploads for CAD were raised to 100 MB. He asked
for "a 2D and 3D engineering drawings and modeling software". He chose to start with 2D drawings and
only a 3D viewer, for himself alone, as a Windows desktop app that needs no admin rights and is
ideally a portable exe with no install. Drawings stay as files on the laptop. Files: DXF open and save,
PDF print and conversion, DWG open, and maybe CorelDRAW .cdr. The plan is Tauri 2 (one small exe on
WebView2), reusing Project R's DXF reader and 3D viewer. The cloud session couldn't create the repo
(GitHub 403), so he'll create CableTable/project-d and carry on from his PC. Full record:
Project-D-scope.md.

**2026-10-17**: Session 1 (a cloud session). The repo exists. He moved Project D onto Project R's house
rules (CLAUDE.md, plus a new DECISIONS.md). He'll mainly use it for **simple screen-printing layouts**:
parts fitted onto a given sheet, by step and repeat, auto-nest or by hand, with parts drawn here or
imported (DXF, DWG, CorelDRAW, PDF), and output as PDF at 1:1, DXF or a check print. The first
mock-ups (artifact "Project D Mockups") offer two main screens, A (drawing-first, CAD style) and B
(parts-first, job sheet), plus Import, PDF export (one layout or a folder) and the 3D viewer.

**2026-10-17**: He picked mock-up A (drawing-first, CAD style) over B (parts-first) and said go ahead. The first build went up as the session's pull request, set to auto-merge when green: a Tauri 2 shell that makes a portable `ProjectD.exe`, CI that runs the tests, builds on Windows and publishes to Releases, and screen A with live step and repeat. A few things differ from the mock-up on purpose (Rotate defaults to 0°, the zoom is true size and so on); they are rows in DECISIONS.md.

**2026-10-17 (session 2)**: Opening a DXF is built: File → Open, the Open button or drag and drop puts it in its own tab,
drawn on a canvas over the sheet at true size. The file's layers are listed with show/hide, and the Layers list scrolls on
its own when a file has many. Inch files are converted to mm. The cursor X/Y now reads from the sheet's bottom-left with Y
up. Tests: doc.test.mjs and new browser steps; the Tauri file dialog and the window drop are only checked in the real exe.

**2026-10-17 (session 2, second PR)**: PR #2 (open a DXF) merged. Then Save and Save As are built, with our own DXF
writer (R2000, `web/dxf-write.js`), tested by round trips and by an independent parse with dxf-parser. A file with
things the writer can't keep is never overwritten; it is saved as a copy. Non-ASCII text is written as \U+XXXX. Step and
repeat → Apply is built too: the open drawing is the part, and Apply makes a new "<name> layout.dxf" tab with the part as
a block plus one INSERT per position on layer Parts, the sheet outline on Sheet and the marks on Marks (`web/apply.js`,
with tests). While wiring it I found a writer bug: rounded rectangles had their bulges on the wrong vertices; fixed, with
a test. The Tauri save dialog and the file write are only checked in the real exe.

**2026-10-17 (session 2, third PR)**: PDF export and print are built from the "PDF export" mock-up: File → PDF / Print… or
the tab row's button opens the dialog on the active tab. Our own PDF writer (`web/pdf-write.js`, PDF 1.4, vector,
Helvetica text, deterministic bytes) and the page planner (`web/pdf-export.js`) give 1:1 sheet-size pages, tiles on A3 / A4
with overlap and labels, a check print fitted to A4 / A3 with a title block and scale, mirror, negative, one page per
layer (print colour), crop / registration marks and a job strip; the live preview replays the page's own commands.
"A folder at once" converts every .dxf in a chosen folder. Print… saves the PDF to Downloads and says to open it (no new
Rust plugin; opening it from the app is in TODO.md). Tests: `pdf-write.test.mjs` (structure and xref offsets, exact page
sizes, mirror, separations, tiling, text escaping, no NaN, and an independent parse with pdfjs-dist) and new browser steps;
the Tauri save dialog, the file write and the folder scan are only checked in the real exe. Also: Rakshith found the
mock-up's demo data (tabs overlays-oct.dxf and front-panel.dwg, the Overlay-A part, "Print · Red / Grey") in the exe and
couldn't remove it, so the app now starts with one empty "Drawing 1", × closes any tab, + makes a new one, and Step and
repeat has no part until a DXF is open.

**2026-10-17 (PR #5): part prep and layout.** Rakshith's drawings (an instrument-cluster panel: one layer, dials, labels,
leaders, four views) need only the part's outer outline, true size. Built without mock-ups (his call): a file opens on a
**Part** view (click an edge → its whole connected chain, Keep only this / Delete, undo; W × H mm fields and Set length
for 1:1; Measure with a SNAP toggle; a measure kept as a dimension on layer "Dimensions"; a photo or PDF page as a dimmed,
never-saved background; PDF / Print of just the part: cut to size 1:1, tiled A4 / A3, or scaled to fit), and **Use for
layout →** goes to the **Layout** view (a gripper per side, margin removed; extra gaps between picked rows or columns).
A vector PDF opens as a drawing through pdf.js (vendored, `npm run vendor`): his CATIA A0 PDF opens in 1.2 s and one click
picks the cluster outline. On his real DXF one click picked a 78-piece outline in ~35 ms. CorelDRAW for now goes through
Corel's PDF export; .cdr itself is next (TODO.md). Progress was pushed after each feature, his ask in case his usage limit
ran out, so automerge was off until the last push. One CI failure on the way: a test counted pixels before the view
repainted.

**2026-10-17 (session 3, on his PC, PR #6)**: Rakshith listed what he wants next, as numbered items in TODO.md ("Rakshith's
list", 41 items, including AutoCAD and CorelDRAW-style picks). Built and ticked: the Layout preview draws the part in every
slot (it was empty boxes); a dimension-decimals picker in the status bar; Save never overwrites the opened file (the first
Save is a Save As, "<name>-edited.dxf"); Shift keeps a picked point straight along X or Y; the Dimension tool the AutoCAD
way (three clicks, then drag to move its line, text height in the panel). Mock-up Round 3 (layout page) was drawn and he
picked L1, "everything looks good". Then Build A: a layout is its own kind of tab (+ New layout), drawing tabs lose the
Part | Layout switch; Extract part… names a selected outline and saves it to a Parts library kept inside the app
(IndexedDB, thumbnails, Export .dxf); step and repeat per layout with a Fit to sheet switch or typed rows and columns; a
saved layout keeps its settings and placed parts in a hidden PD_LAYOUT block and reopens as a layout tab. Kept
dimensions no longer count toward a part's size. Building was split: Sonnet agents built the Dimension tool, the mock-ups
and Build A; the lead reviewed and ran the tests. A local-only "TODO pane" mod (Claude desktop app) shows TODO.md live
on his PC. Not checked here: the exe itself (Tauri save dialog, IndexedDB in WebView2), which CI builds.

**2026-10-17 (session 3, PR #7): the exe tested on his PC, and the review fixes.** The CI exe was driven on his PC
through WebView2's debugging port: Save through the real Save dialog, the opened file left alone, a layout saved with
its settings and reopened as a layout tab, and the Parts library kept across a restart all worked. A walk through every
screen gave 24 fixes, now built: crop and registration marks off by default, Rows / Columns lined up, ORTHO as a sticky
Shift, GRID and POLAR and every unbuilt tool or menu greyed, real status bar values, dimensions left out of all sizes,
Undo / Redo / Delete in the Edit menu, a sticky Apply footer, the tool rail in two columns on a small window, clearer
labels and messages. Four smaller ideas went to TODO.md (42–45).

**2026-10-18 (session 4, overnight, PR #9): Build B and four small items.** While Rakshith slept (his go-ahead and
answers at 00:20 IST), Build B was built from mock-up R3d: parts on a layout move by drag (Shift straight, Ctrl-drag
copy, Ctrl+Shift copy straight), arrow-key nudge with a step, typed X / Y / Angle, rotate by hand about a pivot,
Mirror X / Y, Duplicate in a row, Copy once (Ctrl+D), Delete, and undo for layouts. Then: tiny gaps found, ringed and
joined (0.01 mm default, his pick), new parts snap to a 5 mm grid, an undo history list, and autosave every 2 minutes
(his pick) with recovery at start-up. Open questions are in the PR body.
**2026-10-18 (session 4, PR #9, morning): Round 4.** His picks from the R4 mock-ups (B, B, A) were built: several parts can be selected, with Align / Distribute in the right panel; Group / Lock (locked parts can't be deleted, his call); mm rulers and guides in a panel list, with parts snapping to guides; and a floating Contour panel (inside / outside, steps, sharp / rounded, remembered) that adds snappable outlines on a Contour layer. New parts now snap to whole mm, and Duplicate goes all four ways.

**2026-10-18 (session 4b, PR #10): exe fixes, Round 5, theme.** Five fixes from testing v0.1.53 on his PC. Then his Round 5 picks: drawing tools (line, polyline, rectangle, rounded rectangle, circle, ellipse, arc; typed input, snaps, Draw menu), Text (R5a Option A, TEXT / MTEXT, bold, in-place editing), Grips (R5c), Properties (R5b Option B, View → Properties / Ctrl+1, Select similar, Match), sheet resize (parts stay put, 0,0 stays bottom-left, his call), and Compare two drawings (R5d Option B, its own tab, glow differences at 0.10 mm). Round 6: theme Option A "Modern SaaS" (his pick). A full AutoCAD-style command line went to TODO 47. Project agents builder (Sonnet, Ponytail) and checker (Haiku) were added under .claude/agents.


**2026-10-19 (session 5, PR #12): merged on local tests.** CI could not run: the free Actions minutes for October were used up (1,443 Linux + 334 Windows min, 2,111 of 2,000 counted). His call: merge on the local run (npm test, 190 of 190 browser steps on 101b70d) rather than wait for the reset on 1 Nov or make the repo public. The merge-to-main exe build will not run until then either. The last CI fix: the in-place note editor gives up focus as it closes (two Leader steps failed on the slow runner).

**2026-10-19 (session 6, PR #1): Auto-nest and drawing edits.** Release v0.1.16: Auto-nest of mixed parts (mock-up R10 option B: true-shape bottom-left packer in a worker, rotations, Stop keeps the partial result, Apply as one undo step), Offset / Trim / Mirror, Line the AutoCAD way, Select all, and theme fixes. The tester ran v0.1.16 on his PC and found 4 bugs, fixed in session 7.

**2026-10-19 (session 7, PR #2): the 4 bugs from the v0.1.16 test.** Closing the window with unsaved tabs now asks Save / Don't save / Cancel (the exe's close request; beforeunload in a browser), and F5 / Ctrl+R are off in the exe while a tab is unsaved. Layers + Add works the AutoCAD way (Layer1, Layer2…, becomes current, name and colour editable until something is drawn on it, one undo step, saved in the DXF). Invalid numbers show a message naming the allowed range and mark the field before resetting it. PDF / Print in the exe asks where to save (<drawing>.pdf) instead of writing to Downloads. Built by a Sonnet builder session on the 2nd account; reviewed by the lead and a Haiku checker.

**2026-10-19/20 (session 8, PR #3): Objects tab, command bar, audit, and the agent workflow.** Built TODO 39 (Objects tab, mock-up R11a Option A) and 47 (floating command bar, R12b Option B), each reviewed by Pip-review (Opus) and fixed in a fresh Pip-build session. Three review rounds over the session's code (pure modules, export / PDF / Tauri, geometry, storage, layout) and a whole-repo ponytail audit led to: recovery copies deleted on close, the layer No plot flag kept on Save, big PDFs open, autosave notices layer changes, one storage helper that waits for the commit, a second window leaves the first window's recovery alone, unused Rust crates removed. The As-built boards AB8 / AB9 are in the Mockups canvas. Workflow: the lead is **Rook**, everything on the 2nd account is **Pip** (build / review / lookups / exe test), **Rowan** (Codex, his ChatGPT Go plan) researches, **Scout** (Antigravity) does quick lookups; a Stop hook, a read-only reviewer agent in its own worktree, budget caps per run, Pip at most 14% of its weekly limit a day, and a usage report after every merge. Rowan was tried as a second reviewer and dropped: in a blind test on 39 it missed both bugs Pip-review found. CI caught a status-bar overflow at 1024 px that only shows with Linux fonts.

**2026-10-20: v0.1.30 released and tested on his PC.** PR #3 merged; CI published v0.1.30. Pip-test drove the real exe (isolated WebView2 profile, Playwright over the debug port): opening, the Objects tab, the command bar, drawing and modify tools, layouts, step and repeat, Auto-nest, balloons, dimensions and crash recovery all work. Found: many tabs push the window sideways, a double-click on an Objects layer row does not make it current, two layer counts disagree (TODO 57-59). The native Save / close dialogs could not be driven and piled up on his screen; next time Pip-test drives them with UI Automation (TODO 60).

**2026-10-20 (session 9, PR #4): fixes from the v0.1.30 test, Rowan becomes the default builder.** Fixed TODO 57 (many tabs pushed the window sideways; the strip scrolls on its own), 58 (Objects double-click), 59 (counts agree), 61 (counts on files past the draw limit) and 62 (Open replaced a saved drawn tab), and tested the exe's native dialogs (TODO 60: Save, Save As, PDF / Print, close prompt all pass). Two blind builder comparisons (Rowan / Codex gpt-6.1-sol vs Pip / Sonnet) on 57 and 61 came out one win each; after Codex's elevated sandbox (his one-time admin setup) and a clone with its git folder outside `.git` let Rowan commit and run Chromium, he made Rowan the default builder. Added the "Project D usage" page (limits, week forecast, runs, analysis) and `tools/rook.mjs`; the forecast showed Rook hitting its week limit two days early, so Rook now starts fresh after every merge.

**2026-10-20 (session 10, TODO 34): own shortcuts.** R12 option 2 adds Tools → Shortcuts… for typed aliases and key shortcuts, scoped alias checks, global key clashes with Swap / Cancel, protected keys, and PGP import / export (keys in `;KEY` comments). Save stores only differences through the shared IndexedDB helper and applies them at once. Pure tests and the browser flow cover capture, clashes, persistence, a failed storage write and native-dialog PGP round trips; light / dark screenshots are in shots/R12-built-*.png. The native executable was not built here (no Rust toolchain).
**2026-10-20 (session 10): Contour colour and line style (TODO 65, R13).** Added the five Properties colours and Solid / Dashed / Dotted below Corners, remembered with the other Contour fields. Both previews show the chosen style at 65% opacity; Apply keeps colour and linetype through Properties, DXF save / reopen and PDF, with one-step undo. The DASHED / DOT the app adds for Contour keep visible dashes at low zoom; a file's own tiny patterns still draw solid (Pip-review fix). Unit and browser coverage includes DXF colour / linetype round trips, PDF dash patterns and a selected applied edge; light and dark screenshots are in shots/R13-built-*.png.

**2026-10-20, session 10 (PR #5).** Rook led, Rowan built everything (63, 64, 34, 65, plus the R12 and R13 mock-ups, as Pip was near its daily budget), Pip reviewed each build. New rule (his call): Rook writes no code; review findings, however small, go to Rowan, because a 14-call Rook fix of three tiny findings cost more of Rook's weekly limit than a Rowan round. Mock-ups R12 Shortcuts and R13 Contour style are published as claude.ai artifacts for his pick.

**2026-10-20 (session 11): Line width (TODO 48, R14 option A).** Added Outline width below Line type in Properties: ByLayer, Hairline (0.05 mm), five numeric presets and Custom in drawing units. A mixed selection shows varies and one undo restores the whole selection. Screen strokes scale with zoom; DXF lineweight and constant polyline width reopen, and PDF / Print keep the physical width. Unit coverage includes line / arc / circle and legacy / light polyline round trips, inches, PDF widths and screen zoom; browser steps cover presets, Custom, invalid input, cancel, mixed selection, undo and reopening. Light / dark captures: shots/s11-48-light.png and shots/s11-48-dark.png. Native exe build and physical printing were not checked.

**2026-10-20 (session 11): Cleanup and Preflight (TODO 49 / 50, R14 section 02 option A).** Added Remove duplicates… below Tiny gaps with a redundant-entity count and one undo for exact duplicates and overlapping line / arc geometry on the same layer. Partial overlaps keep their uncovered portions. Tools → Preflight… shows the six warning checks, row selection, Remove / Join / Hairline fixes, Recheck and Close; warnings never block output. Cut layers are identified by name; Hairline is 0.05 mm. Pure unit coverage includes reversals, splits, layers, arcs across zero, polylines, hidden objects, connectivity, physical units and block-width isolation. Browser coverage includes Remove / undo and Preflight open / Select / Fix / Recheck / output. Light / dark captures: shots/s11-50-light.png and shots/s11-50-dark.png. Native exe and physical printing were not checked.

**2026-10-20 (session 11): R14 screenshot polish.** Moved recent command toasts to bottom-centre and removed older rows' opacity reduction so all three use readable theme panel / text colours and borders. Selected wide strokes retain their own ink with a thin accent centre line. Added a renderer check and an independent mm-deviation check through the app's inch cutter export at default and edited tolerances. Browser coverage checks toast position and colours in both themes and retakes shots/s11-48-*.png and shots/s11-51-*.png. Native exe and physical printing were not checked.

**2026-10-20, session 11.** Rook led; Rowan built, Pip reviewed, looked and built 51 / 52 and the As-built board. Mock-up R14 (local) and his picks: 48 Line width in Properties (always mm, Hairline, 1.2 px screen minimum), 49 Remove duplicates and overlaps (same layer) + 50 Tools → Preflight (warns only), 51 ×25.4 / ÷25.4 beside Set length, 52 File → Export for cutter (lines, arcs, polylines; curves flattened to a tolerance in mm). Mirror / Offset / Trim now keep polyline widths. WORKFLOW gained the session-end flow. Lessons: Rowan's sandbox has no git credentials, and it hit its 5-hour limit mid-build once (Rook saved the staged work as a WIP commit). 40 Trace (imagetracerjs, Outline only) is next, in session 12.

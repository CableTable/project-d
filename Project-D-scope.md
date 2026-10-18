# Project D: scope (draft, 2026-10-16)

A Windows desktop app for **2D engineering drawings** plus a **3D viewer**, for Rakshith alone.
Later, maybe 3D modelling. Unrelated to Projects B, P, R and WF, but run by the same house rules
(see CLAUDE.md).

Everything here was decided in chat on 2026-10-16 (a Project R cloud session). Rakshith's own words
are in quotes. **Nothing is built yet, and there are no mock-ups yet.**

## 1. What was decided

| Question | His answer | Notes |
|---|---|---|
| What it is | "a 2D and 3D engineering drawings and modeling software" | |
| Where to start | "start with 2D drawings and only 3D viewer first" | Modelling comes later (§5) |
| Who uses it | Just him | One user: no accounts, no sign-in, no cloud |
| Platform | "desktop app it is" | Windows laptop |
| Install | "make sure it has no admin rights while install"; a portable file, no installing | One `.exe`, double-click to run (§3) |
| Where drawings live | Files on the laptop | No Firebase, nothing costs money |
| Files | DXF open and save · PDF print · convert 2D files to PDF · DWG open · "maybe even .cdr" | §4 |
| Repo | New private repo **CableTable/project-d** | He creates it; the cloud session couldn't (GitHub 403) |

Not answered yet: **what he'll mostly draw** (sheet metal, machined parts, frames, layouts). Ask in
session 1, because it decides what goes in the first toolbar.

## 2. Stage 1: what gets built first

**2D drafting**
- Draw: line, polyline, rectangle, circle, arc, ellipse, spline, point, text and multiline text,
  hatch (solid and patterns), dimensions (linear, aligned, angular, radius, Ø), leaders.
- Snaps (end, mid, centre, intersection, perpendicular, tangent, nearest), ortho and polar
  tracking, a grid, and typed coordinates and lengths (e.g. `@100<30`).
- Edit: select (window and crossing), move, copy, rotate, scale, mirror, offset, trim, extend,
  fillet, chamfer, array, explode, undo and redo.
- Layers (colour, line type, weight, on, off, lock), blocks (insert, title block with fields).
- Paper sheets A4 to A0 with a title block; scale 1:1, 1:2, 1:5, 1:10 …
- Measure (as in Project R's viewer: Ø, R, length, gap, angle).
- Units: mm by default (confirm with him).

**Files**
- **DXF**: open and save. The DXF file is the drawing's own format, with no private format next
  to it (confirm with him).
- **DWG**: open (read only at first), saving as DXF.
- **PDF**: print to scale on A4 to A0, and convert any 2D file (DXF, DWG) to PDF, one at a time or
  a folder at once.
- **.cdr** (CorelDRAW): last, and the riskiest (§4).

**3D viewer**
- Project R's viewer, as is: STEP, STP, IGES, IGS, BREP, STL, OBJ, PLY, GLB and 3MF. It has Fit,
  Views and Ortho, Edges, X-ray, Section, Measure, Parts and Smooth.
- Open from disk, with no size limit beyond the laptop's memory.

## 3. The app: portable, no admin

- **Tauri 2** (MIT/Apache): the app's UI is web code (HTML, CSS, JS, as in Project R) in a native
  window, with a small Rust core for files and dialogs.
- **Portable**: the build gives one `ProjectD.exe` of about 10–15 MB. You double-click it, with no
  installer and no admin, and it runs from any folder or a USB stick. Settings go in
  `%LOCALAPPDATA%` (Tauri's default); a "keep settings next to the exe" switch is possible
  for a truly portable stick.
- **WebView2** draws the window. It comes with Windows 10 and 11. If a PC lacks it, the
  "fixed version" runtime can be bundled beside the exe (about 180 MB), still without admin.
- **SmartScreen**: an unsigned exe shows "Windows protected your PC" the first time. Click
  More info → Run anyway. A code-signing certificate would end that, but it costs money every
  year (his call, billing).
- **Managed PCs** can block unknown exes (AppLocker or Intune). If one does, the fallback is the same code as a browser app installed from Edge (also no admin).
- Files are opened and saved through Windows' own Open and Save dialogs (Tauri's dialog and fs
  plugins); Ctrl+S saves back to the same file. Later, double-clicking a .dxf could open it in
  Project D. That needs a per-user file association, which still needs no admin.
- **Building**: GitHub Actions on `windows-latest` builds the exe on every merge to main and
  puts it on the repo's **Releases** page. He needs no Rust or build tools on his PC.
  Locally, a build needs Rust (rustup, per-user, no admin) and the MSVC build tools (these
  usually need admin), so building on GitHub is the plan.
  Private repo: Actions is free for 2,000 minutes a month, and Windows minutes count double.

## 4. File formats: how each is read and written

| Format | How | Licence | Risk |
|---|---|---|---|
| DXF read | Project R's `drawing.js` (our own reader: layers, line types, blocks, hatches, leaders, attributes, the sheet) | ours | low |
| DXF write | New: our own writer (R2013+ ASCII), round-trip tested against the reader | ours | medium |
| DWG read | **LibreDWG** built to wasm, or as a small native helper, converting DWG → DXF | **GPL-3** | medium |
| PDF write | `pdf-lib` or `jsPDF` (MIT), vector lines at true scale, TrueType fonts | MIT | low |
| SHX fonts | Drawings name AutoCAD's SHX fonts: swap them for a similar TTF; reading .shx is possible later | — | low |
| .cdr | **libcdr** (MPL-2, used by Inkscape and LibreOffice), never yet built for the web; a native helper is likelier | MPL-2 | high |
| 3D | Project R's `occt-worker.js` + occt-import-js 0.0.23 (OpenCascade, LGPL-2.1) and three.js 0.186.1 | LGPL / MIT | low |

**GPL (DWG)**: the GPL only obliges sharing the source when the app is given to others. For his
own use that's fine. If Project D is ever given away or sold, the DWG reader must be swapped
(e.g. the commercial ODA SDK) or the app open-sourced. Keep it in its own module so it can be
swapped. Until .cdr is in, Inkscape (free) converts .cdr → .dxf or .pdf by hand.

## 5. Later stages (agreed as the direction, not to build yet)

1. **Sketcher with constraints**: horizontal, parallel, tangent, fixed length or Ø, and a sketch
   that changes when a number does. FreeCAD's PlaneGCS solver (LGPL) runs in the browser.
2. **3D parts**: extrude, revolve, cut, hole, fillet and chamfer on sketches, with an editable
   feature history. Built on OpenCascade (opencascade.js), saving STEP and STL.
3. **Drawings from the model**: front, top, side and iso views, sections, dimensions and a title
   block, saved as DXF and PDF, and updated when the model changes.
4. Assemblies, sheet metal (bends, flat pattern) and a bill of materials.

Other routes he heard and didn't pick: building on FreeCAD (more features on day one, but someone
else's app and Python), and 2D only.

## 6. Carried over from Project R

Copy these, then keep them in step by hand:
- `web/drawing.js` (the pure DXF reader and Measure) + `drawing.test.mjs` (14 tests),
  `web/dxf-worker.js`
- `web/viewers.js`: the `dxf` and `model3d` sections (canvas drawing, Layers, Sheet, Paper,
  Measure, Section …)
- `web/geom.js` + `geom.test.mjs`, `web/occt-worker.js`
- `tools/vendor.mjs` → `web/vendor/occt.js`, `occt-import-js.wasm`, `three-view.js`
- `tools/make-fixtures.mjs` → `fixtures/sample.dxf`
- Leave behind: Firebase and the device cache (IndexedDB), which a desktop app doesn't need for
  local files.

## 7. Session 1 (on his PC)

1. He creates **CableTable/project-d** (private, with a README) and gives the Claude GitHub app
   access to it.
2. Clone it next to Project R (`E:\Project D\…`, his choice) and copy this file and CLAUDE.md in.
3. Ask: what he'll mostly draw; mm by default; is DXF the drawing's own format; A-size sheets
   and the title block's fields.
4. **Mock-ups first** (an artifact "Project D Mockups"): the drawing screen (toolbar, layers,
   command line, status bar), the 3D viewer, Open and Save, PDF export (single and batch).
5. Once he picks: the Tauri skeleton (portable exe, CI build to Releases), then the viewer
   ported from Project R, then drafting.

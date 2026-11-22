# Whiteboard project notes

## Scope and workflow

- `docs/PLAN.md` records the approved phases and acceptance criteria. Keep changes within the current milestone, run the app and milestone tests, and record gaps before moving on.
- Use Brazilian Portuguese for interface text and English for code, comments, and identifiers.
- The application is a client-only React and TypeScript project. Keep runtime packages and bundled assets within the license policy in the plan, and update the README inventory when dependencies change.
- Write measured performance results in `docs/PERF.md` with the browser, hardware, viewport, device pixel ratio, fixture and limitations. Keep raw benchmark output in `test-results/` outside version control.

## Milestone 1 decisions

- `src/core` owns scene data, coordinates, spatial queries, and stroke geometry. Keep the model serializable. Canvas contexts, `Path2D` objects and index entries are derived state.
- Use world coordinates with Y increasing downwards, an affine transform per stroke, and a camera defined by the world point at the center of the viewport. Convert pointer positions in CSS pixels, then apply device pixel ratio when rendering.
- The input controller consumes Pointer Events and batches ink work into animation frames. React and Zustand own the visible controls and settings. During writing, use the live canvas for the preview and commit the completed stroke to the confirmed canvas.
- Use One Euro filtering in CSS-pixel space and `perfect-freehand` for the filled outline. Store the brush settings with each stroke for reproducible geometry. Mouse input uses simulated pressure.
- Query RBush for visible strokes, then apply drawing order. Cache confirmed paths per immutable stroke and redraw at the requested zoom. Start with `Path2D` and culling. If the 10,000-stroke benchmark misses the target, report measurements to the user before implementing tiles with `OffscreenCanvas`.
- Build with esbuild and run unit tests with the Node test runner. Browser tests use Node and the Chrome DevTools Protocol to launch installed Chrome or Edge with a temporary profile and a loopback debugging endpoint. Vite and Playwright were evaluated and excluded because their published bundles include code under licenses outside the approved list.
- The dense 10,000-stroke benchmark missed 60 FPS. Record the original measurements in `docs/PERF.md`. The user approved proceeding to Milestone 2 with that limitation.

## Milestone 2 decisions

- `src/documents/store.ts` owns the document and history. Store a confirmed pointer gesture as one history operation and queue edits in IndexedDB. Mark a revision as saved only after its transaction completes. Recovery reads the committed scene and history. Importing a portable snapshot resets local history.
- `src/documents/archive.ts` defines the ZIP contract. Keep `manifest.json` and `scene.json` versioned, serialize model state and keep browser handles and caches outside the archive. Validate ZIP limits and the manifest before replacing the active board. Run compression and validation in the archive worker.
- Keep native file pickers tied to the user gesture. Browser upload and download use the same `.board` parser and writer. Cancelled or invalid imports preserve the current scene.
- Keep offline files scoped to the app URL, with a precache list generated from the production build. Activate a waiting worker after document writes finish and the user chooses to update. GitHub Pages serves the static `dist/` directory.
- Record classroom problems only when reported. Include the build, browser, steps, impact and follow-up. PDF prototypes and library selection belong to Milestone 3. KaTeX and MathJax prototypes belong to Milestone 4. Multi-tab detection, asset SHA-256 and history checkpoints remain deferred until after Milestone 5.

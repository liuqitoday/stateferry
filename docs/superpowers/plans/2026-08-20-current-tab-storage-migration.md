# Current Tab Storage Migration Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a loadable Manifest V3 Chrome extension that backs up and restores Cookie, `localStorage`, and `sessionStorage` for the current active tab, with preview-first migration and automatic English/Chinese localization.

**Architecture:** A Vite/TypeScript/React multi-entry extension has a Popup for current-tab summaries and a full migration page for export/import workflows. A Manifest V3 service worker is the only layer that calls `chrome.cookies`, `chrome.downloads`, and `chrome.scripting`; pure core modules own schema validation, diffing, cookie rules, and locale normalization. Page storage is read/written by serializable functions injected into the current tab through `chrome.scripting.executeScript`.

**Tech Stack:** TypeScript 5, Vite 6, React 19, Vitest, jsdom, Chrome Extensions Manifest V3 APIs.

**Spec:** `docs/superpowers/specs/2026-08-20-current-tab-storage-migration-design.md`

## Global Constraints

- Scope is only the current active tab and its current site; no cross-site inventory or background scanning.
- `sessionStorage` is bound to the current tab and current Origin; never merge it across tabs or invent an empty result after failure.
- Default language is English; Chinese browser locales use simplified or traditional Chinese; all other locales fall back to English.
- Import is always `parse → preview → resolve → apply → report`; default strategy is Merge, with optional overwrite of matching items; no clear-then-import.
- Sensitive values are masked by default and never written to logs, `chrome.storage`, or automatic history.
- Backup field names, schema versions, and error codes are fixed English machine fields, independent of UI locale.
- Do not declare broad `host_permissions`; use `activeTab`, `scripting`, `cookies`, and `downloads`, and show a clear fallback error if a target Chrome version rejects Cookie API access without a host grant.
- No remote scripts, remote configuration, cloud sync, automatic snapshots, iframe traversal, DevTools panel, or regex bulk edits in this version.
- Core modules accept plain data objects and must not import DOM or Chrome APIs.
- Every new behavior gets a failing test before its implementation; run the focused test and then the full suite after each task.

## File Map

### Project and packaging

- `package.json`: scripts and pinned development/runtime dependencies.
- `tsconfig.json`, `vite.config.ts`, `vitest.config.ts`: TypeScript, multi-entry build, and test setup.
- `public/manifest.json`: Manifest V3 metadata, permissions, action popup, migration page, and service worker.
- `public/_locales/{en,zh_CN,zh_TW}/messages.json`: Chrome-native localized messages.
- `.gitignore`: dependency/build/generated visual-workshop exclusions.

### Core and runtime

- `src/core/types.ts`: serializable domain types and message/result discriminated unions.
- `src/core/backup-schema.ts`: backup parser/serializer and schema validation.
- `src/core/diff-engine.ts`: deterministic Add/Update/Skip/Error planning.
- `src/core/cookie-rules.ts`: Cookie identity, target mapping, and constraint validation.
- `src/core/locale.ts`: browser locale normalization and `Intl` helpers.
- `src/background/service-worker.ts`: message router, active-tab context, injected storage bridge, Cookie API, download helpers.
- `src/background/runtime-client.ts`: typed UI-side message client.

### UI

- `src/popup.html`, `src/popup/main.tsx`, `src/popup/styles.css`: current-tab summary and quick actions.
- `src/migration.html`, `src/migration/main.tsx`, `src/migration/styles.css`: file selection, preview, apply, and report workflow.
- `src/ui/i18n.ts`: UI translation helper with Chrome i18n and locale fallback.
- `src/ui/format.ts`: masked values, counts, dates, and file-size formatting.

### Tests and docs

- `src/core/*.test.ts`: unit tests for schema, diffing, cookie rules, and locale.
- `src/background/service-worker.test.ts`: message protocol tests with a minimal Chrome API stub.
- `README.md`: install/build/load instructions, permission explanation, and manual acceptance checklist.

### Task 1: Project scaffold and extension packaging

**Files:**
- Create: `package.json`, `tsconfig.json`, `vite.config.ts`, `vitest.config.ts`, `.gitignore`, `public/manifest.json`.
- Create: `public/_locales/en/messages.json`, `public/_locales/zh_CN/messages.json`, `public/_locales/zh_TW/messages.json`.
- Create: `src/popup.html`, `src/migration.html`, `src/background/service-worker.ts` (minimal message listener only).
- Test: `src/smoke.test.ts`.

**Interfaces:**
- Produces a build where `dist/manifest.json` points to `background.js`, `popup.html`, and `migration.html`.
- Produces the npm scripts `test`, `test:watch`, `build`, and `typecheck`.

- [ ] **Step 1: Initialize the local repository baseline and ignore generated files.**

  Run `git init` in the user-provided workspace, create `.gitignore` entries for `node_modules/`, `dist/`, `.superpowers/`, and coverage output, then commit only the empty-project baseline files. This workspace has no existing Git checkout, so the ruling is to work in place rather than invent a second worktree; the cost if wrong is that the user would need to move the branch later.

- [ ] **Step 2: Write the failing packaging smoke test.**

  Add a test that reads `public/manifest.json` and asserts Manifest V3, `default_locale: "en"`, permissions `activeTab`, `scripting`, `cookies`, `downloads`, no `host_permissions`, action popup `popup.html`, and service worker `background.js`.

- [ ] **Step 3: Run the smoke test and verify it fails for the missing scaffold.**

  Run `npm test -- src/smoke.test.ts`; expected failure is missing `package.json`/manifest, not a test-runner configuration error.

- [ ] **Step 4: Add the Vite/TypeScript/Vitest scaffold and manifest.**

  Use Vite multi-entry inputs named `popup`, `migration`, and `background`, emit stable entry names, copy `public/` unchanged, and configure React JSX plus jsdom tests. The manifest must use `action.default_popup: "popup.html"`, `background.service_worker: "background.js"`, and the four permissions above.

- [ ] **Step 5: Add the three locale message catalogs.**

  Include all initial shell labels (`appName`, `popupTitle`, `cookies`, `localStorage`, `sessionStorage`, `export`, `import`, `openWorkspace`, `unsupportedPage`, `securityWarning`, `merge`, `overwrite`, `add`, `update`, `skip`, `error`, `apply`, `cancel`, `downloadReport`) with matching message keys in English, simplified Chinese, and traditional Chinese. Keep placeholders syntactically identical across catalogs.

- [ ] **Step 6: Implement the minimal service-worker entry and run green checks.**

  Register a no-op `chrome.runtime.onMessage` listener that returns `{ok: true}` for a `PING` message so later tasks have a stable entry. Run `npm test`, `npm run typecheck`, and `npm run build`; expected result is a loadable `dist/` with all manifest targets.

### Task 2: Core serializable domain and TDD-tested migration rules

**Files:**
- Create: `src/core/types.ts`, `src/core/backup-schema.ts`, `src/core/diff-engine.ts`, `src/core/cookie-rules.ts`, `src/core/locale.ts`.
- Test first, then implement: `src/core/backup-schema.test.ts`, `src/core/diff-engine.test.ts`, `src/core/cookie-rules.test.ts`, `src/core/locale.test.ts`.

**Interfaces:**
- `parseBackup(input: unknown): ParseBackupResult` returns `{ok: true, backup}` or `{ok: false, error}`.
- `serializeBackup(backup: BackupDocument): string` returns stable pretty JSON.
- `buildDiff(backup: BackupDocument, current: CurrentSnapshot, options: DiffOptions): DiffPlan` returns ordered `items` and aggregate counts.
- `cookieIdentity(cookie: CookieRecord): string` and `mapCookieToTarget(cookie: CookieRecord, target: TabContext): CookieMappingResult`.
- `normalizeLocale(uiLanguage: string | undefined): SupportedLocale` returns `en`, `zh-CN`, or `zh-TW`.

- [ ] **Step 1: Write failing schema tests.**

  Cover valid version 1 documents, malformed JSON/object input, missing arrays, invalid storage item types, future schema versions, and `redacted: true` documents. Assert exact error codes `INVALID_BACKUP_JSON` and `UNSUPPORTED_SCHEMA_VERSION`.

- [ ] **Step 2: Run schema tests and confirm the expected missing-function failures.**

  Run `npm test -- src/core/backup-schema.test.ts`; confirm failures name the absent parser/serializer behavior.

- [ ] **Step 3: Implement types, schema validation, and stable serialization.**

  Define `TabContext`, `CookieRecord`, `StorageItem`, `BackupDocument`, `CurrentSnapshot`, `DiffItem`, `DiffPlan`, `ImportStrategy`, and fixed `ErrorCode` unions. Reject unknown future versions, preserve `redacted`, and serialize with two-space indentation and a terminal newline.

- [ ] **Step 4: Write failing diff-engine tests.**

  Test Add for absent keys, Skip for equal keys under Merge, Update for changed keys under Overwrite, Error for redacted values, deterministic type/key ordering, and current-tab session matching.

- [ ] **Step 5: Implement `buildDiff`.**

  Use Cookie identity `name + domain + path + partitionKey`, storage identity `origin + key`, and session identity `tabId + origin + key`; never compare session entries without the current tab context. Return aggregate `{total, add, update, skip, error}`.

- [ ] **Step 6: Write failing Cookie-rule tests.**

  Cover domain/path mapping, host-only cookies, `__Host-` and `__Secure-` constraints, Secure on HTTP targets, SameSite values, session cookies without expiration, and partition key preservation.

- [ ] **Step 7: Implement Cookie identity and target mapping.**

  Expose `cookieIdentity`, `mapCookieToTarget`, and `validateCookieForTarget`; map ordinary domain cookies to the current host only when valid, preserve path when possible, and return `COOKIE_CONSTRAINT_INVALID` with a reason instead of silently dropping invalid entries.

- [ ] **Step 8: Write failing locale tests and implement locale helpers.**

  Assert `zh-CN`/`zh-SG`/generic `zh` normalize to `zh-CN`, `zh-TW`/`zh-HK`/`zh-MO` normalize to `zh-TW`, all other values and undefined normalize to `en`, and number/date formatting uses the normalized locale.

- [ ] **Step 9: Run focused and full core tests.**

  Run `npm test -- src/core`, then `npm test` and `npm run typecheck`; all tests must pass before runtime work begins.

### Task 3: Service-worker runtime, page bridge, and typed message protocol

**Files:**
- Modify: `src/background/service-worker.ts`.
- Create: `src/background/runtime-client.ts`, `src/background/service-worker.test.ts`.
- Modify: `src/core/types.ts` if protocol types need to be shared.

**Interfaces:**
- `runtime-client.ts` exports `getCurrentSnapshot()`, `applyStorageChanges(changes)`, `applyCookieChanges(changes)`, `downloadText(filename, text, mimeType)`, and `openMigrationPage(context)`.
- Service worker handles message types `GET_CONTEXT`, `GET_SNAPSHOT`, `APPLY_PLAN`, `DOWNLOAD_TEXT`, and `PING`, always returning `{ok: boolean, data?: T, error?: RuntimeError}`.

- [ ] **Step 1: Write failing protocol tests with a minimal Chrome stub.**

  Cover `GET_CONTEXT`, `GET_SNAPSHOT` successful read, unsupported-page rejection, tab navigation detection, `APPLY_PLAN` partial results, and `DOWNLOAD_TEXT` URL revocation scheduling. Assert that no plaintext value is logged or stored.

- [ ] **Step 2: Run protocol tests and verify they fail before runtime implementation.**

  Run `npm test -- src/background/service-worker.test.ts`; expected failures must be missing handlers, not broken test setup.

- [ ] **Step 3: Implement serializable page functions.**

  Add top-level functions passed to `chrome.scripting.executeScript`: one returns arrays from `Object.keys(localStorage)` and `Object.keys(sessionStorage)`, and one applies set/remove operations. Catch access errors and return structured `STORAGE_READ_FAILED` or `SESSION_TAB_UNAVAILABLE` results.

- [ ] **Step 4: Implement current-tab context validation.**

  Query the active tab, reject missing/unsupported URLs, derive `origin`, record `tabId`/`pageUrl`, and re-query before writes to abort on navigation with `TAB_NAVIGATED`.

- [ ] **Step 5: Implement Cookie snapshot and apply operations.**

  Use `chrome.cookies.getAll({url: pageUrl})` and `chrome.cookies.set`/`remove` only in the service worker. Translate core Cookie mappings into API details and convert API rejection into `COOKIE_PERMISSION_DENIED`, `COOKIE_CONSTRAINT_INVALID`, or a per-item failure.

- [ ] **Step 6: Implement downloads and migration-page handoff.**

  Create an in-memory Blob data URL for JSON/error reports, call `chrome.downloads.download`, and open `migration.html` with a non-sensitive context query (`tabId`, `pageUrl`, `origin`). Do not put snapshot values in query parameters or persistent extension storage.

- [ ] **Step 7: Run runtime tests, full tests, typecheck, and build.**

  Run `npm test`, `npm run typecheck`, and `npm run build`; fix all failures before UI tasks.

### Task 4: Popup current-tab UI and localization

**Files:**
- Create: `src/popup/main.tsx`, `src/popup/styles.css`, `src/ui/i18n.ts`, `src/ui/format.ts`.
- Modify: `src/popup.html`, locale catalogs as needed.
- Test: `src/popup/popup.test.tsx`.

**Interfaces:**
- Popup calls `getCurrentSnapshot()` and displays `CurrentSnapshot` only; it sends export/import/open-workspace actions through `runtime-client.ts`.
- UI translation uses `getMessage(key, substitutions?)`, which first calls `chrome.i18n.getMessage` and falls back to an in-memory English map in unit tests.

- [ ] **Step 1: Write failing Popup tests.**

  Cover hostname/context rendering, three tab counts, masked values, unsupported-page state, export button action, import button action, and Chinese label rendering when the locale helper returns `zh-CN`.

- [ ] **Step 2: Run Popup tests and verify red.**

  Run `npm test -- src/popup/popup.test.tsx`; confirm failures are missing UI behavior.

- [ ] **Step 3: Implement the Popup component and action wiring.**

  Build the confirmed quiet-instrument-panel layout: site header, Cookies/Local/Session tabs, search, rows, reveal/copy controls, selection toolbar, Export selected, Import backup, and Open full migration workspace. Keep all values masked until explicit reveal.

- [ ] **Step 4: Implement responsive/accessibility styling.**

  Add visible keyboard focus, semantic buttons, `aria-label`s, reduced-motion handling, compact 400–440px layout, and the approved teal/navy/orange palette without remote fonts/assets.

- [ ] **Step 5: Run Popup tests, full suite, typecheck, and build.**

  Run `npm test`, `npm run typecheck`, and `npm run build`; inspect generated `dist/popup.html` references.

### Task 5: Migration page workflow and result reporting

**Files:**
- Create: `src/migration/main.tsx`, `src/migration/styles.css`, `src/migration/migration.test.tsx`.
- Modify: `src/migration.html`, `src/ui/format.ts`, locale catalogs as needed.

**Interfaces:**
- Migration page reads the non-sensitive tab context from its query string, calls `getCurrentSnapshot`, `parseBackup`, `buildDiff`, `applyStorageChanges`, `applyCookieChanges`, and `downloadText`.
- Component state is `{step: 'file'|'review'|'apply'|'report', backup?, plan?, selectedIds, strategy, report?}` and is never persisted.

- [ ] **Step 1: Write failing migration workflow tests.**

  Cover file parse failure, valid file moving to Review, Add/Update/Skip/Error summary, Merge vs Overwrite selection, deselecting an error item, apply result counts, partial failure report, download error report action, and Chinese security warning.

- [ ] **Step 2: Run migration tests and verify red.**

  Run `npm test -- src/migration/migration.test.tsx`; expected failures must be absent workflow behavior.

- [ ] **Step 3: Implement File and Review steps.**

  Use a file input with size guard, parse asynchronously, show source/target context, display the security warning, render filterable diff rows, and require an explicit strategy and item selection before Apply is enabled.

- [ ] **Step 4: Implement Apply and Report steps.**

  Revalidate target context, apply selected compatible items, render succeeded/skipped/failed counts and per-item fixed error codes, and offer a fixed-English JSON error-report download.

- [ ] **Step 5: Add approved visual system and accessibility.**

  Reuse the Popup palette and instrument-panel hierarchy: paper background, navy chrome, teal success, orange risk, masked values, visible focus, reduced motion, and responsive layout for narrow extension windows.

- [ ] **Step 6: Run migration tests, full suite, typecheck, and build.**

  Run `npm test`, `npm run typecheck`, and `npm run build`; verify `dist/migration.html` is self-contained and the manifest target exists.

### Task 6: Integration documentation, fixtures, and release verification

**Files:**
- Create: `README.md`, `tests/fixtures/valid-backup.json`, `tests/fixtures/redacted-backup.json`.
- Modify: `.gitignore` if build/test artifacts are missing.

- [ ] **Step 1: Add fixture files and README instructions.**

  Document `npm install`, `npm run build`, loading `dist/` via `chrome://extensions` with Developer mode, how `activeTab` works, why session storage is current-tab only, language fallback rules, and the manual acceptance matrix from the spec.

- [ ] **Step 2: Run the complete automated verification.**

  Run `npm test -- --coverage`, `npm run typecheck`, and `npm run build`; require zero test failures and a generated `dist/manifest.json`, `dist/background.js`, `dist/popup.html`, `dist/migration.html`, and all three locale directories.

- [ ] **Step 3: Perform static manifest and bundle checks.**

  Parse `dist/manifest.json`, verify no `host_permissions`, verify every referenced file exists, scan built JavaScript for remote `http://`/`https://` script imports, and ensure no test fixture or source file logs raw storage values.

- [ ] **Step 4: Record a concise manual Chrome verification checklist.**

  Include HTTPS, HTTP, localhost, empty data, special characters, large values, restricted pages, tab navigation/close during operations, import into another environment, and English/Simplified Chinese/Traditional Chinese/other browser locales.

- [ ] **Step 5: Commit the completed implementation and report exact verification output.**

  Commit source, tests, docs, and package lock; do not commit `dist/`, `.superpowers/`, or sensitive backup files.

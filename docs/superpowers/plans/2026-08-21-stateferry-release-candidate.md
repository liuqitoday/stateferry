# StateFerry Chrome Web Store Release Candidate Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans. Steps use checkbox syntax.

**Goal:** Convert the current-tab storage extension into a StateFerry release candidate that is functionally complete, manually verified in Chrome, documented for Chrome Web Store submission, and pushed to the user's GitHub repository.

**Architecture:** Keep the existing Manifest V3 + Vite + React split. Add a typed mutation protocol for current-tab Cookie and Web Storage CRUD, keep Chrome API access in the service worker, and use a temporary local test site plus a real Chrome profile for end-to-end verification. Add release assets/docs without committing generated dist/ or sensitive backups.

**Tech Stack:** TypeScript, React, Vite, Vitest, Chrome Extensions Manifest V3, GitHub remote.

**Spec:** docs/superpowers/specs/2026-08-20-current-tab-storage-migration-design.md

## Global Constraints

- Scope remains current active tab and current site only.
- sessionStorage remains bound to the current tab and exact origin.
- English is default; Simplified/Traditional Chinese follow browser locale normalization.
- Import remains parse → preview → apply → report, Merge by default.
- Sensitive values remain masked by default and never logged or persisted.
- No broad host_permissions, remote scripts, cloud sync, or background site inventory.
- Real Chrome verification must not use real user credentials or production data.
- User must confirm immediately before loading the unpacked extension into Chrome.
- Generated dist/, Chrome profile data, and test backups stay untracked.

---

### Task 1: Brand and release metadata

**Files:** package.json, public/manifest.json, locale catalogs, UI titles, README.md, docs/release/.

- [ ] Write failing tests for the StateFerry app name and version metadata.
- [ ] Run the focused tests and verify they fail for the old Storage Relay name.
- [ ] Change package/display branding to StateFerry, keeping the package slug stateferry.
- [ ] Add release metadata and Chrome Web Store copy in docs/release/store-listing.md.
- [ ] Add a public privacy policy in docs/release/privacy-policy.md describing no collection, local-only processing, permissions, and backup responsibility.
- [ ] Add 16/32/48/128 icon assets and screenshots without remote assets.
- [ ] Run focused tests, typecheck, build, and verify all manifest references.

### Task 2: Current-tab CRUD

**Files:** src/core/types.ts, src/page-bridge/storage.ts, src/background/service-worker.ts, src/background/runtime-client.ts, src/popup/main.tsx, src/popup/styles.css, tests.

- [ ] Add failing tests for add/edit/delete mutations across localStorage, sessionStorage, and Cookie.
- [ ] Run focused tests and confirm expected failures.
- [ ] Add typed MUTATE_ITEM runtime message with set/remove operations.
- [ ] Implement page-storage mutation and Cookie set/remove with current-tab revalidation.
- [ ] Add Popup Add/Edit/Delete controls, explicit confirmation for destructive deletion, masked value editing, and refresh after mutation.
- [ ] Run full automated suite.

### Task 3: Real Chrome E2E harness

**Files:** tests/e2e/test-page.html, tests/e2e/server.mjs, docs/release/manual-test-report.md.

- [ ] Add a local HTTP test page with deterministic Cookie, localStorage, and sessionStorage fixtures.
- [ ] Add a local server command and manual test script/checklist.
- [ ] Build the extension and start the fixture server.
- [ ] Ask for user confirmation immediately before loading dist/ into Chrome.
- [ ] Load unpacked extension in Chrome and test Popup snapshot, reveal/copy, CRUD, export, import preview/apply, language switching, restricted page, and tab navigation behavior.
- [ ] Record exact results and any Chrome-version permission caveats.

### Task 4: Release packaging and static audit

**Files:** scripts/package-release.mjs, .gitignore, docs/release/release-checklist.md, README.md.

- [ ] Add a release packaging script that builds a clean zip from dist/ and excludes secrets/source maps.
- [ ] Add a static audit for Manifest V3, no host_permissions, no remote scripts, localized catalogs, icons, and required files.
- [ ] Run tests, typecheck, build, static audit, and release zip generation.
- [ ] Include Chrome Web Store upload steps and known caveats.

### Task 5: GitHub delivery

**Files:** Git metadata only, plus source/docs/assets.

- [x] Inspect and preserve all user changes; do not commit test backups, profile data, or dist/.
- [ ] Add remote https://github.com/liuqitoday/stateferry.git.
- [ ] Commit the release candidate with a descriptive message.
- [ ] Push the current branch to origin.
- [ ] Verify remote branch and commit hash.

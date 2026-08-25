# StateFerry Release Checklist

## Automated gates

- [x] `npm test`
- [x] `npm run typecheck`
- [x] `npm run build`
- [x] `npm run release:audit`
- [x] `git diff --check`
- [x] `npm run release:package`
- [x] Inspect the ZIP and confirm `manifest.json` is at its root.

## Chrome Web Store dashboard

- [ ] Upload `release/stateferry-<version>.zip`.
- [ ] Confirm the manifest name, description, version, permissions, and icon.
- [ ] Add at least one 1280x800 or 640x400 real-use screenshot.
- [ ] Add the public HTTPS privacy-policy URL.
- [ ] Complete the User Data / Limited Use disclosure form.
- [ ] Explain the single purpose and each permission in the dashboard.
- [ ] Declare that data is processed locally and not sold or transferred.

## Before submission

- [x] Test only with fictional local fixture data.
- [ ] Remove test profiles, exported backups, and `dist/` from Git history/status.
- [ ] Verify the GitHub repository contains source and docs, not secrets.

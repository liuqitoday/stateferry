# StateFerry Release Checklist

## Automated gates

- [ ] `npm test`
- [ ] `npm run typecheck`
- [ ] `npm run build`
- [ ] `npm run release:audit`
- [ ] `git diff --check`
- [ ] `npm run release:package`
- [ ] Inspect the ZIP and confirm `manifest.json` is at its root.

## Chrome Web Store dashboard

- [ ] Upload `release/stateferry-<version>.zip`.
- [ ] Confirm the manifest name, description, version, permissions, and icon.
- [ ] Add at least one 1280x800 or 640x400 real-use screenshot.
- [ ] Add the public HTTPS privacy-policy URL.
- [ ] Complete the User Data / Limited Use disclosure form.
- [ ] Explain the single purpose and each permission in the dashboard.
- [ ] Declare that data is processed locally and not sold or transferred.

## Before submission

- [ ] Test only with fictional local fixture data.
- [ ] Remove test profiles, exported backups, and `dist/` from Git history/status.
- [ ] Verify the GitHub repository contains source and docs, not secrets.

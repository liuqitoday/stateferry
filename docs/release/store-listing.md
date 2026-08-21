# StateFerry Chrome Web Store Listing

## Short description

Manage Cookie, localStorage, and sessionStorage for the current tab. Export a local backup or review and apply it on another site.

## Detailed description

StateFerry is a focused current-tab storage workbench for frontend developers and QA engineers.

Use it to:

- Inspect the current page's Cookies, localStorage, and sessionStorage.
- Add, edit, delete, reveal, copy, and search individual items.
- Export a complete or redacted JSON backup locally.
- Review an import before applying it with Merge or Overwrite.
- See item-level success, skip, and failure results.

StateFerry only works with the active tab and current site. sessionStorage stays bound to the current tab. Values are masked by default, and StateFerry does not upload, sync, sell, or log storage data.

## Single purpose

StateFerry manages and migrates browser storage for the current active tab. All requested permissions support this user-facing purpose.

## Permission justification

- `activeTab`: access the page after the user opens StateFerry.
- `scripting`: read and write Web Storage in the current tab's page context.
- `cookies`: read and write Cookies matching the current page URL.
- `downloads`: save a backup or error report chosen by the user.

No broad `host_permissions` are requested.

## Privacy disclosure

StateFerry handles Cookies and Web Storage locally to provide its storage-management feature. It does not transmit this data to a developer-controlled server or third party. Users may intentionally export a file containing session tokens; exported files remain under the user's control.

Privacy policy: publish [`docs/release/privacy-policy.md`](./privacy-policy.md) at a stable HTTPS URL before submitting the item.

## Required listing images

- Extension icon: `public/icons/icon128.png` (128x128).
- At least one screenshot: 1280x800 or 640x400. Capture the real Popup and migration workspace after the local Chrome test; do not use production credentials.
- Optional promotional artwork can use the approved StateFerry navy, teal route, and orange beacon identity.

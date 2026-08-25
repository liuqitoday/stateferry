# StateFerry Manual Chrome Test Report

## Environment

- Chrome version: Chrome connected through the local Chrome test session (version not exposed by the test bridge)
- OS: macOS
- Extension build: `dist/` rebuilt after the per-site Cookie permission fix
- Fixture URL: `http://127.0.0.1:4177/test-page.html`
- Data: fictional local fixture values only

## Test cases

| Case | Expected result | Result | Notes |
| --- | --- | --- | --- |
| Popup on fixture page | Shows host and three storage counts | Passed | `127.0.0.1`; fixture values were fictional. |
| Cookie site permission | Cookie list is empty until current-site access is granted | Passed | Granted only for `127.0.0.1`; `sf_test_cookie` then appeared. |
| Mask and reveal | Values masked initially, reveal is explicit | Passed | Reveal was confirmed in Popup. |
| Copy value | Clipboard receives selected value | Passed | Fictional fixture value copied. |
| Add localStorage | New key appears after save and refresh | Passed | `testkey=testvalue` was written. |
| Edit sessionStorage | Current tab value changes | Passed | `sf_session=edited-by-stateferry` was verified in the page. |
| Delete Cookie | Confirmation appears, Cookie is removed | Passed | `sf_test_cookie` became `(missing)` after confirmation. |
| Full export | JSON backup downloads locally | Passed | Backup schema, scope, and keys were verified locally. |
| Import preview | Parse/review/apply flow is explicit | Passed | Review showed 4 items and required an explicit strategy. |
| Merge/Overwrite | Strategy changes diff and apply behavior | Passed | Merge: `add 0 / update 0 / skip 4 / error 0`; Overwrite with a real conflict: `add 0 / update 1 / skip 3 / error 0`. |
| Import apply | Selected update changes the current tab | Passed | Result: `success 1 / skip 4 / error 0`; page value was verified. |
| Language | English / Simplified Chinese / Traditional Chinese copy appears | Automated | Locale unit and UI tests passed; Chinese Review screenshot was captured. |
| Restricted page | Clear unsupported-page message appears | Automated | Popup test covers protected pages. |
| Tab navigation | Writes stop with navigation error | Automated | Service-worker test covers navigation protection. |

## Caveats

Chrome requires a host permission for `chrome.cookies`; StateFerry requests optional access only for the current site after the user clicks the Cookie access button. The browser automation bridge adds an internal `__imt_handshake_page_id` sessionStorage item; it is test-tool state and is not part of StateFerry's product behavior. Never paste real Cookie values or tokens into this report.

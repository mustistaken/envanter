Security notes for Teknikel Akıllı Envanter

Current protections
- Google ID tokens are verified by the Apps Script API using Google's tokeninfo endpoint.
- The API checks aud, exp and email_verified before returning inventory data.
- Inventory access is enforced server-side with an allowlist; grantAccess and addProduct also require the administrator account.
- The browser keeps the short-lived Google ID token in sessionStorage, not localStorage. Signing out removes it.
- User-specific baskets, favorites and offer data are namespaced by signed-in email.
- Inline HTML event handlers and dynamic executable code are not used.
- Spreadsheet-bound text entered through addProduct is escaped when it begins with a formula marker.
- The service worker caches only the static app shell; authenticated API responses are not cached.

Publishing checklist
- [x] Server verifies Google token aud/exp/email_verified.
- [x] Server enforces inventory allowlist and administrator-only mutations.
- [x] Token storage is limited to the browser session.
- [x] Inline onclick handlers were replaced with addEventListener.
- [x] User-entered product text is protected from spreadsheet formula injection.
- [x] Run scripts\security-check.ps1 before publishing.
- [ ] Consider moving authentication to an httpOnly, Secure server session if the site later moves away from static GitHub Pages hosting.
- [ ] Add a tested Content-Security-Policy when the Google Identity, Apps Script, exchange-rate, barcode and print dependencies have been fully enumerated.

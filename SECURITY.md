Security recommendations for Teknikel Akıllı Envanter

Summary
- Verify all Google idTokens (ID tokens / OAuth tokens) on the server side by checking the token signature and audience (client_id). Do NOT treat client-side JWT decoding as proof of authenticity.
- Prefer httpOnly, Secure cookies or short-lived server-side sessions instead of storing long-lived tokens in localStorage.
- Avoid inline JavaScript (onclick attributes). Use addEventListener and enable a strict Content-Security-Policy (no-unsafe-inline) where possible.
- Sanitize any user-controlled HTML. Use escapeHtml() when inserting content via innerHTML. Prefer textContent when possible.
- Keep service worker caching limited to app shell; do not cache sensitive API responses unless explicitly designed.

Quick checklist
- [ ] Server verifies idToken signatures (Google public keys) and checks aud/exp/email_verified.
- [x] Move token storage to server session or httpOnly cookie. (Client now uses sessionStorage; prefer httpOnly cookies in production.)
- [ ] Add CSP headers (report-uri) in hosting configuration.
- [ ] Replace remaining inline onclick handlers with addEventListener.
- [ ] Run security-check script (scripts\security-check.ps1) before publishing.

If you want, I can prepare server-side verification sample code (Node/Express, Python/Flask) — tell me your preferred language and I'll add an example.
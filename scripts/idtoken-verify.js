// Example: verify Google ID token on server (Node.js + express)
// Usage: npm install express google-auth-library

const express = require('express');
const {OAuth2Client} = require('google-auth-library');
const client = new OAuth2Client(process.env.GOOGLE_CLIENT_ID);

const app = express();
app.use(express.json());

// Protect this endpoint: client sends idToken from client, server verifies
app.post('/verify-token', async (req, res) => {
  const idToken = req.body.idToken;
  if (!idToken) return res.status(400).json({ error: 'missing idToken' });
  try {
    const ticket = await client.verifyIdToken({ idToken, audience: process.env.GOOGLE_CLIENT_ID });
    const payload = ticket.getPayload();
    // payload.sub, payload.email, payload.email_verified, payload.aud, payload.exp
    if (!payload.email_verified) return res.status(403).json({ error: 'email not verified' });
    // Additional checks: ensure aud matches, check expiry etc — verifyIdToken covers that

    // Example: check admin role
    const adminEmail = process.env.ADMIN_EMAIL;
    const isAdmin = adminEmail && String(payload.email || '').toLowerCase() === String(adminEmail).toLowerCase();

    // Create your own session / issue httpOnly cookie and return session id
    // For demo, just return payload (DO NOT send idToken back)
    return res.json({ ok: true, email: payload.email, isAdmin });
  } catch (err) {
    console.error('token verify failed', err);
    return res.status(401).json({ error: 'invalid token' });
  }
});

const port = process.env.PORT || 3000;
app.listen(port, () => console.log('idtoken-verify demo listening on', port));

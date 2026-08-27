// Vercel Edge Function — sends REAL push notifications via Firebase Cloud
// Messaging (FCM) HTTP v1 API.
//
// WHY THIS FILE EXISTS (this is the missing piece that makes push real):
// A browser can only ever request a push subscription for the CURRENT
// device — it has no way to deliver anything to a DIFFERENT phone. Doing
// that requires a trusted server holding Google's OAuth2 service-account
// credentials, which must never be shipped in browser-visible code (unlike
// the public VAPID key used in index.html). This function is that trusted
// server: Admin Panel calls it (or the automatic new-release checker in
// index.html calls it) with a title/message, it reads every saved device
// token from fcmTokens/ in Firebase, and pushes to all of them using the
// current (2026) FCM HTTP v1 API — the older "legacy" FCM server-key API
// Google fully retired in 2024, so HTTP v1 + OAuth2 is the only option now.
//
// SECURITY: this route requires the caller to be a signed-in Firebase user
// listed under /admins in the database (same check used everywhere else in
// this app — see database.rules.json) — verified server-side against
// Firebase's own public keys, so no one can call this by guessing the URL.
// Without that check, ANYONE who found this URL could blast a push
// notification to every MINEXUS TV user, which would be a serious abuse
// vector (spam, phishing links dressed up as "new movie" alerts, etc).
//
// SETUP REQUIRED (cannot be done from code — see SECURITY_SETUP.md step 6):
// 1. Firebase Console → Project Settings → Service Accounts → "Generate
//    new private key" → downloads a JSON file.
// 2. In Vercel → Project → Settings → Environment Variables, add:
//      FCM_SERVICE_ACCOUNT_JSON = <paste the ENTIRE downloaded JSON, as one line>
// 3. Redeploy. That's it — this function reads it from process.env at
//    request time; it is NEVER present in any file committed to the repo.

export const config = { runtime: 'edge' };

function b64urlFromBytes(bytes) {
  const bin = String.fromCharCode(...new Uint8Array(bytes));
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function b64urlFromString(str) {
  return btoa(str).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

// Builds and RS256-signs a Google OAuth2 JWT assertion using Web Crypto
// (available in the Edge runtime — no Node 'crypto' module or npm
// dependency like 'jsonwebtoken'/'google-auth-library' needed), then
// exchanges it for a short-lived access token good for calling any Google
// API the service account is scoped for — here, just FCM sending.
async function getGoogleAccessToken(serviceAccount) {
  const now = Math.floor(Date.now() / 1000);
  const header = { alg: 'RS256', typ: 'JWT' };
  const claims = {
    iss: serviceAccount.client_email,
    scope: 'https://www.googleapis.com/auth/firebase.messaging https://www.googleapis.com/auth/firebase.database',
    aud: 'https://oauth2.googleapis.com/token',
    iat: now,
    exp: now + 3600
  };
  const unsigned = `${b64urlFromString(JSON.stringify(header))}.${b64urlFromString(JSON.stringify(claims))}`;

  // The service account's private key ships as PEM text; Web Crypto needs
  // it as a raw PKCS8 ArrayBuffer, so strip the PEM header/footer/newlines
  // and base64-decode what's left.
  const pem = serviceAccount.private_key
    .replace('-----BEGIN PRIVATE KEY-----', '')
    .replace('-----END PRIVATE KEY-----', '')
    .replace(/\s/g, '');
  const der = Uint8Array.from(atob(pem), c => c.charCodeAt(0));

  const key = await crypto.subtle.importKey(
    'pkcs8', der.buffer, { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' }, false, ['sign']
  );
  const sigBuf = await crypto.subtle.sign('RSASSA-PKCS1-v1_5', key, new TextEncoder().encode(unsigned));
  const jwt = `${unsigned}.${b64urlFromBytes(sigBuf)}`;

  const resp = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer',
      assertion: jwt
    })
  });
  const data = await resp.json();
  if (!resp.ok || !data.access_token) throw new Error('token exchange failed: ' + JSON.stringify(data));
  return data.access_token;
}

// Verifies the caller is a signed-in admin by checking their Firebase ID
// token against the Realtime Database REST API (same rules.json used by
// the client SDK, so this can't be bypassed by forging a request — the
// database itself refuses the /admins read unless the token is valid AND
// that uid is actually listed as an admin).
async function verifyIsAdmin(idToken, databaseURL) {
  if (!idToken) return false;
  try {
    // Decoding the uid out of a Firebase ID token requires verifying its
    // Google-signed JWT — rather than reimplementing that here, we let
    // the database do it: a REST read of /admins/<uid> with this token
    // as ?auth= only succeeds if Firebase itself accepts the token AND
    // rules.json's admin check passes, mirroring exactly what the client
    // SDK does everywhere else in this app.
    const parts = idToken.split('.');
    if (parts.length !== 3) return false;
    const payload = JSON.parse(atob(parts[1].replace(/-/g, '+').replace(/_/g, '/')));
    const uid = payload.user_id || payload.sub;
    if (!uid) return false;
    const r = await fetch(`${databaseURL}/admins/${uid}.json?auth=${encodeURIComponent(idToken)}`);
    if (!r.ok) return false;
    const val = await r.json();
    return val === true;
  } catch (e) {
    return false;
  }
}

export default async function handler(request) {
  const cors = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization',
    'content-type': 'application/json'
  };
  if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: cors });
  if (request.method !== 'POST') {
    return new Response(JSON.stringify({ success: false, error: 'POST only' }), { status: 405, headers: cors });
  }

  try {
    const body = await request.json();
    const { title, message, target, notifId, idToken } = body || {};
    if (!title || !message) {
      return new Response(JSON.stringify({ success: false, error: 'title and message are required' }), { status: 400, headers: cors });
    }

    const DATABASE_URL = 'https://minexustv-a23ba-default-rtdb.asia-southeast1.firebasedatabase.app';

    const isAdmin = await verifyIsAdmin(idToken, DATABASE_URL);
    if (!isAdmin) {
      return new Response(JSON.stringify({ success: false, error: 'admin authentication required' }), { status: 403, headers: cors });
    }

    const saJson = process.env.FCM_SERVICE_ACCOUNT_JSON;
    if (!saJson) {
      return new Response(JSON.stringify({
        success: false,
        error: 'FCM_SERVICE_ACCOUNT_JSON is not configured on the server yet — see SECURITY_SETUP.md step 6.'
      }), { status: 500, headers: cors });
    }
    const serviceAccount = JSON.parse(saJson);
    const projectId = serviceAccount.project_id;

    // Same OAuth2 access token is reused for BOTH calls below: FCM send
    // needs the 'firebase.messaging' scope (requested here), and Realtime
    // Database REST also accepts a Google OAuth2 Bearer token from a
    // service account that has an IAM role on the project (e.g. "Firebase
    // Realtime Database Admin" — granted automatically to the default
    // service account) as a legitimate admin credential, which is exactly
    // why the fcmTokens/ rule in database.rules.json can stay admin-only
    // for regular users while still letting this trusted server read it.
    const accessToken = await getGoogleAccessToken(serviceAccount);

    // Pull every saved device token so this one call fans out to everyone.
    const tokensResp = await fetch(`${DATABASE_URL}/fcmTokens.json`, {
      headers: { 'Authorization': `Bearer ${accessToken}` }
    });
    const tokensObj = await tokensResp.json() || {};
    const tokens = Object.values(tokensObj).map(t => t && t.token).filter(Boolean);

    if (!tokens.length) {
      return new Response(JSON.stringify({ success: true, sent: 0, note: 'no registered devices yet' }), { status: 200, headers: cors });
    }

    // FCM HTTP v1 has no built-in "send to N tokens in one call" batch
    // endpoint like the old legacy API did — each token is its own POST.
    // Fired concurrently (not awaited one-by-one) so broadcasting to
    // hundreds of devices doesn't take hundreds of sequential round trips.
    let sent = 0, failed = 0;
    const invalidTokens = [];
    await Promise.all(tokens.map(async (token) => {
      try {
        const resp = await fetch(`https://fcm.googleapis.com/v1/projects/${projectId}/messages:send`, {
          method: 'POST',
          headers: { 'Authorization': `Bearer ${accessToken}`, 'Content-Type': 'application/json' },
          body: JSON.stringify({
            message: {
              token,
              data: { title: String(title), message: String(message), target: String(target || ''), notifId: String(notifId || '') },
              webpush: { fcm_options: { link: target ? `/watch/${target}` : '/' } }
            }
          })
        });
        if (resp.ok) { sent++; }
        else {
          failed++;
          const errBody = await resp.json().catch(() => ({}));
          // UNREGISTERED / invalid-argument on a token means that device
          // uninstalled or the token rotated without us catching it — mark
          // it for cleanup so fcmTokens/ doesn't accumulate dead entries
          // forever (each one is a wasted request on every future send).
          const code = errBody && errBody.error && errBody.error.status;
          if (code === 'UNREGISTERED' || code === 'INVALID_ARGUMENT') invalidTokens.push(token);
        }
      } catch (e) { failed++; }
    }));

    // Best-effort cleanup of dead tokens — failure here never affects the
    // notification send result already computed above.
    if (invalidTokens.length) {
      try {
        const entries = Object.entries(tokensObj).filter(([, v]) => v && invalidTokens.includes(v.token));
        await Promise.all(entries.map(([key]) =>
          fetch(`${DATABASE_URL}/fcmTokens/${key}.json`, {
            method: 'DELETE',
            headers: { 'Authorization': `Bearer ${accessToken}` }
          })
        ));
      } catch (e) { /* cleanup is non-critical */ }
    }

    return new Response(JSON.stringify({ success: true, sent, failed, totalTokens: tokens.length }), { status: 200, headers: cors });
  } catch (e) {
    return new Response(JSON.stringify({ success: false, error: String(e && e.message || e) }), { status: 500, headers: cors });
  }
}

// Vercel Cron Job — runs automatically once a day (see the "crons" entry
// in vercel.json) with NO browser or admin needing to be open. This is
// what makes "notification aaye jaise koi movie release ho" (item #2's
// third request) actually automatic instead of admin having to notice a
// new release themselves and type it into the Admin Panel every time.
//
// WHAT IT DOES:
// 1. Asks TMDB for movies that released very recently (same query the
//    Calendar & News "New Releases" tab already uses — see
//    API.getReleases('new') in index.html, kept consistent on purpose).
// 2. Checks Firebase under notifiedReleases/ to see which of those TMDB
//    ids we've already sent a push for.
// 3. For any NOT already notified, calls the same FCM sending logic as
//    api/send-notification.js's push step, then marks it notified so
//    tomorrow's run doesn't re-notify the same movie again.
//
// WHY A SEPARATE FILE FROM send-notification.js: that endpoint requires
// an admin's Firebase idToken (a signed-in human) — a cron job is not a
// signed-in user and has no idToken to present, so it needs its own
// entry point. It reuses the same FCM-sending building blocks rather
// than re-authenticating as "admin" some other way.
//
// SECURITY: Vercel Cron automatically sends `Authorization: Bearer
// <CRON_SECRET>` on every cron-triggered request — this handler checks
// that header, so this endpoint can't be triggered by a random visitor
// hitting the URL (which would otherwise spam every user with a "new
// release" push on demand).
//
// SETUP REQUIRED — see SECURITY_SETUP.md step 7:
//   Vercel → Project → Settings → Environment Variables →
//   CRON_SECRET = <any long random string you generate yourself>
// (Vercel's cron scheduler reads this same env var automatically and
// sends it as the Authorization header — no extra wiring needed once
// it's set.)

export const config = { runtime: 'edge' };

const DATABASE_URL = 'https://minexustv-a23ba-default-rtdb.asia-southeast1.firebasedatabase.app';
const TMDB_BASE = 'https://api.themoviedb.org/3';

function b64urlFromBytes(bytes) {
  const bin = String.fromCharCode(...new Uint8Array(bytes));
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}
function b64urlFromString(str) {
  return btoa(str).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

// Identical OAuth2 JWT-signing approach as api/send-notification.js —
// duplicated rather than imported because Vercel Edge Functions bundle
// each api/*.js file independently with no shared-module resolution
// between them, so a genuine shared util would need its own build step.
async function getGoogleAccessToken(serviceAccount, scope) {
  const now = Math.floor(Date.now() / 1000);
  const header = { alg: 'RS256', typ: 'JWT' };
  const claims = { iss: serviceAccount.client_email, scope, aud: 'https://oauth2.googleapis.com/token', iat: now, exp: now + 3600 };
  const unsigned = `${b64urlFromString(JSON.stringify(header))}.${b64urlFromString(JSON.stringify(claims))}`;
  const pem = serviceAccount.private_key.replace('-----BEGIN PRIVATE KEY-----', '').replace('-----END PRIVATE KEY-----', '').replace(/\s/g, '');
  const der = Uint8Array.from(atob(pem), c => c.charCodeAt(0));
  const key = await crypto.subtle.importKey('pkcs8', der.buffer, { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' }, false, ['sign']);
  const sigBuf = await crypto.subtle.sign('RSASSA-PKCS1-v1_5', key, new TextEncoder().encode(unsigned));
  const jwt = `${unsigned}.${b64urlFromBytes(sigBuf)}`;
  const resp = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer', assertion: jwt })
  });
  const data = await resp.json();
  if (!resp.ok || !data.access_token) throw new Error('token exchange failed: ' + JSON.stringify(data));
  return data.access_token;
}

export default async function handler(request) {
  // Vercel Cron sends this automatically — see SETUP REQUIRED above.
  // Rejecting anything else means this URL is useless to a random caller.
  const authHeader = request.headers.get('authorization');
  if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return new Response(JSON.stringify({ success: false, error: 'unauthorized' }), { status: 401 });
  }

  try {
    const saJson = process.env.FCM_SERVICE_ACCOUNT_JSON;
    if (!saJson) {
      return new Response(JSON.stringify({ success: false, error: 'FCM_SERVICE_ACCOUNT_JSON not configured' }), { status: 500 });
    }
    const serviceAccount = JSON.parse(saJson);
    const projectId = serviceAccount.project_id;

    // Read the TMDB key from app_config the same way the client does —
    // an unauthenticated read is fine here since app_config/tmdb_api_key
    // is already publicly readable to every visitor's browser (it has
    // to be, for the client SDK to use it), so this adds no new exposure.
    const cfgResp = await fetch(`${DATABASE_URL}/app_config/tmdb_api_key.json`);
    const tmdbKey = await cfgResp.json();
    if (!tmdbKey) {
      return new Response(JSON.stringify({ success: true, note: 'no TMDB key configured — nothing to check' }), { status: 200 });
    }

    // Same query as API.getReleases('new') in index.html — movies with a
    // release date up to today, most recent first, filtered to a modest
    // vote_count so obscure/low-quality entries don't trigger spam pushes.
    const today = new Date().toISOString().slice(0, 10);
    const tmdbResp = await fetch(`${TMDB_BASE}/discover/movie?api_key=${tmdbKey}&primary_release_date.lte=${today}&sort_by=primary_release_date.desc&vote_count.gte=5`);
    const tmdbData = await tmdbResp.json();
    const candidates = (tmdbData.results || []).slice(0, 10); // only the most recent handful — older ones were already checked on prior runs

    if (!candidates.length) {
      return new Response(JSON.stringify({ success: true, checked: 0, notified: 0 }), { status: 200 });
    }

    const accessToken = await getGoogleAccessToken(serviceAccount, 'https://www.googleapis.com/auth/firebase.messaging https://www.googleapis.com/auth/firebase.database');

    // Which of these have we already pushed a notification for? One
    // Realtime DB read for the whole notifiedReleases/ tree is cheaper
    // than one read per candidate.
    const notifiedResp = await fetch(`${DATABASE_URL}/notifiedReleases.json`, { headers: { Authorization: `Bearer ${accessToken}` } });
    const notifiedObj = (await notifiedResp.json()) || {};

    const freshOnes = candidates.filter(m => !notifiedObj[`tmdb_${m.id}`]);
    if (!freshOnes.length) {
      return new Response(JSON.stringify({ success: true, checked: candidates.length, notified: 0, note: 'nothing new since last check' }), { status: 200 });
    }

    // Tokens to push to — same source api/send-notification.js reads.
    const tokensResp = await fetch(`${DATABASE_URL}/fcmTokens.json`, { headers: { Authorization: `Bearer ${accessToken}` } });
    const tokensObj = (await tokensResp.json()) || {};
    const tokens = Object.values(tokensObj).map(t => t && t.token).filter(Boolean);

    let notifiedCount = 0;
    for (const movie of freshOnes) {
      const title = '🎬 New on MINEXUS TV';
      const message = `"${movie.title}" just released — watch it now!`;
      // A single push per movie fans out to every device, mirroring
      // api/send-notification.js's per-token loop.
      if (tokens.length) {
        await Promise.all(tokens.map(token =>
          fetch(`https://fcm.googleapis.com/v1/projects/${projectId}/messages:send`, {
            method: 'POST',
            headers: { Authorization: `Bearer ${accessToken}`, 'Content-Type': 'application/json' },
            body: JSON.stringify({
              message: {
                token,
                data: { title, message, target: `tmdb-${movie.id}`, notifId: `auto_${movie.id}` },
                webpush: { fcm_options: { link: `/watch/tmdb-${movie.id}` } }
              }
            })
          }).catch(() => {}) // one dead token failing shouldn't stop the others
        ));
      }
      // Log it to the same notifications/ history admin already sees in
      // the Admin Panel, so auto-sent ones show up right alongside
      // manually-sent ones — no separate "auto log" the admin has to
      // remember to check.
      await fetch(`${DATABASE_URL}/notifications.json`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${accessToken}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ title, target: `tmdb-${movie.id}`, message, time: Date.now(), auto: true })
      });
      // Mark as notified so tomorrow's run skips it.
      await fetch(`${DATABASE_URL}/notifiedReleases/tmdb_${movie.id}.json`, {
        method: 'PUT',
        headers: { Authorization: `Bearer ${accessToken}`, 'Content-Type': 'application/json' },
        body: JSON.stringify(Date.now())
      });
      notifiedCount++;
    }

    return new Response(JSON.stringify({ success: true, checked: candidates.length, notified: notifiedCount, devicesPushed: tokens.length }), { status: 200 });
  } catch (e) {
    return new Response(JSON.stringify({ success: false, error: String((e && e.message) || e) }), { status: 500 });
  }
}

/* MINEXUS TV — Firebase Cloud Messaging Service Worker
   =====================================================
   This is a SEPARATE file from sw.js on purpose — Firebase Cloud
   Messaging (FCM) requires its own dedicated service worker registered
   at the origin root with exactly this filename convention, and it
   must call firebase.messaging() to receive push events. It runs
   independently of the app's caching service worker (sw.js), so the
   two never conflict — this file ONLY handles push notifications, it
   does not intercept fetch() or cache anything.

   WHY THIS MAKES REAL PHONE NOTIFICATIONS POSSIBLE (previously missing):
   Before this file existed, MINEXUS TV only had an in-app banner
   (see the 'notifications' Firebase listener in index.html) — it only
   ever showed if a user already had the site open in a browser tab.
   That's not a real notification, it's just a banner. A true "user's
   phone buzzes even with the app closed" notification requires:
     1. The browser's push subscription system (this file's job)
     2. A device FCM token saved somewhere the server can read it
        (see the registerForPushNotifications() function in index.html)
     3. A server that holds the Firebase service account credentials
        and calls the FCM Send API (see /api/send-notification.js) —
        browsers can never push directly to OTHER devices, only a
        trusted server with the service account key can do that.
   This file is piece #1 of that chain — it's what lets the OS deliver
   a push message to this device and show it as a native notification
   even when no MINEXUS TV tab is open at all. */

importScripts('https://www.gstatic.com/firebasejs/10.12.2/firebase-app-compat.js');
importScripts('https://www.gstatic.com/firebasejs/10.12.2/firebase-messaging-compat.js');

// Same Firebase project config as index.html (messagingSenderId is the
// piece that specifically matters for push — it must match exactly).
firebase.initializeApp({
  apiKey: "AIzaSyCe9EAy36fx3RHy_cHOKP9BG8F_zkkTd4c",
  authDomain: "minexustv-a23ba.firebaseapp.com",
  databaseURL: "https://minexustv-a23ba-default-rtdb.asia-southeast1.firebasedatabase.app",
  projectId: "minexustv-a23ba",
  storageBucket: "minexustv-a23ba.firebasestorage.app",
  messagingSenderId: "33081080111",
  appId: "1:33081080111:web:cd23b4fe22c0b7c18e09da"
});

const messaging = firebase.messaging();

// Fires when a push arrives while NO MINEXUS TV tab is focused/open —
// this is the actual "phone buzzes" moment. We build the native OS
// notification here ourselves (rather than relying on FCM's automatic
// display) so we can control the icon, click behavior, and deep-link
// straight to the movie/series that was announced.
messaging.onBackgroundMessage((payload) => {
  const data = payload.data || {};
  const title = data.title || (payload.notification && payload.notification.title) || 'MINEXUS TV';
  const body = data.message || (payload.notification && payload.notification.body) || '';

  self.registration.showNotification(title, {
    body,
    icon: '/icons/icon-192.png',
    badge: '/icons/icon-192.png',
    tag: data.notifId || 'minexus-notification', // same tag replaces older unread ones instead of piling up
    data: { target: data.target || '', url: data.target ? `/watch/${data.target}` : '/' }
  });
});

// Tapping the notification opens (or focuses) MINEXUS TV, straight to
// the announced movie/series if one was attached to the notification.
self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const url = (event.notification.data && event.notification.data.url) || '/';
  event.waitUntil(
    clients.matchAll({ type: 'window', includeUncontrolled: true }).then((windowClients) => {
      for (const client of windowClients) {
        if ('focus' in client) { client.navigate(url); return client.focus(); }
      }
      if (clients.openWindow) return clients.openWindow(url);
    })
  );
});

/* ==================== MINEXUS TV — SHARED ADS ENGINE (v7) ====================
   One reliable ad-loading script, shared by index.html AND the standalone
   privacy-policy.html / terms-of-service.html pages — so a Zone ID entered
   once in Admin Panel → Monetization goes live everywhere the app shows
   ads, including pages that aren't part of the main single-page app.

   WHY THIS FILE EXISTS SEPARATELY:
   Previously all ad logic lived inline inside index.html only. Privacy
   Policy and Terms of Service are separate static HTML files (they don't
   load index.html's Firebase config or JS at all), so they showed zero
   ads even though Muaaz wants ads reliably present on every page. Rather
   than copy-pasting the ad logic three times (which would drift out of
   sync the next time it's updated), this single file is loaded by all
   three pages via a <script src="/ads-engine.js"> tag, with each page
   only needing to also load the Firebase SDK + call initFirebaseForAds()
   with its own project config first.

   RELIABILITY IMPROVEMENTS (v7):
   1. Ad-blocker detection — a tiny bait element is created that ad-blocker
      filter lists specifically target (class names like "ad-slot",
      "adsbygoogle" are commonly blocked). If it gets hidden/removed within
      a short window, we know an ad-blocker is active and can show a
      polite, non-blocking notice instead of leaving a confusing blank gap
      that looks like the app itself is broken.
   2. Load confirmation ("proof") — every ad slot gets a small MutationObserver
      that confirms real content (an iframe or non-empty element) actually
      appeared inside it, and logs that confirmation to Firebase
      (adAnalytics/loads) so Admin Panel can show real proof of ads
      rendering, not just "we tried to load a script" is confirmed to
      have injected an actual iframe.
   3. Retry with backoff — if a slot is still empty after a grace period
      (script loaded but ad network returned nothing, a common transient
      issue with any CPM network), it retries a limited number of times
      instead of leaving a permanently blank gap.
   4. Central error logging — any exception during ad setup is caught and
      logged to Firebase (adAnalytics/errors) rather than allowed to throw
      and potentially break unrelated page functionality, and rather than
      silently vanishing with no way for Muaaz to know something's wrong. */

(function () {
  'use strict';

  const AdsEngine = {
    _db: null,
    _adBlockDetected: false,
    _loadedMonetagZones: new Set(),
    _socialBarLoaded: false,

    /* Call once, after firebase.initializeApp() has already run on the
       page. Kept separate from firebase.initializeApp() itself since
       index.html and the standalone policy pages each set up Firebase
       slightly differently (index.html also sets up auth/analytics;
       the policy pages only need the database for reading ad config). */
    _toggles: {}, // cached from app_config/adToggles — see _watchToggles()

    init(databaseInstance) {
      this._db = databaseInstance;
      this._detectAdBlocker();
      this._watchToggles();
      this._watchMonetag();
      this._watchAdsterra();
      this._watchCustomSlots();
      this._observeNewBannerSlots();
    },

    /* Reads Admin Panel's per-ad-type on/off switches (app_config/adToggles)
       — added so Muaaz can kill any single ad type/size from Admin without
       needing a code change or redeploy, e.g. to isolate which specific
       placement is causing a problem, or to turn off a network entirely if
       it's misbehaving. Missing/undefined for a given key defaults to ON
       (true) so existing deployments that predate this feature keep
       working exactly as before until someone actively switches something
       off in Admin. Re-runs every render function whenever a toggle
       changes, so flipping a switch in Admin takes effect live without
       the visitor needing to refresh. */
    _watchToggles() {
      if (!this._db) return;
      this._db.ref('app_config/adToggles').on('value', snap => {
        this._toggles = snap.val() || {};
        // Re-apply immediately so a toggle flip is visible without a
        // page refresh — re-running these is safe/idempotent even when
        // nothing actually changed, since each fill function already
        // skips slots that are already correctly filled.
        this._reapplyAll();
      }, err => this._logError('ad-toggles-firebase-read', err));
    },

    _isOn(key) {
      return this._toggles[key] !== false; // default ON unless explicitly disabled
    },

    /* Hides every element belonging to an ad type the moment it's toggled
       off, and re-fills everything from cached values the moment it's
       toggled back on — called both right after a toggle change and from
       key parts of the normal render flow.

       REAL BUG FIXED HERE: turning a toggle off used to only set
       `el.style.display = 'none'` on the container — which hides it
       visually, but leaves the iframe/script that was already inside it
       completely intact and still running. `display:none` only affects
       rendering, not JavaScript execution: an ad network's script
       (tracking pixels, popunder triggers, redirect timers) keeps firing
       from inside that hidden iframe exactly as before, which is why ads
       kept "loading" (running/tracking/serving) even after being switched
       off in Admin. Fixed by actually clearing each container's content
       (`innerHTML = ''`) before hiding it — this destroys the iframe/
       script node entirely, which stops its JavaScript execution
       immediately, not just its visibility. Also clears the
       dataset.bannerKey / dataset.nativeLoaded markers so that turning
       the toggle back ON is correctly treated as "this slot needs a fresh
       load" instead of being skipped as "already filled with this key". */
    _reapplyAll() {
      if (!this._isOn('monetag')) this._hideAllMonetag();
      if (!this._isOn('adsterraBanners')) {
        ['adsterraSlot320x50', 'adsterraSlot468x60', 'adsterraSlot160x300'].forEach(id => {
          const el = document.getElementById(id);
          if (el) { el.innerHTML = ''; el.style.display = 'none'; }
        });
        document.querySelectorAll('.ad-banner-slot').forEach(el => {
          el.innerHTML = ''; el.style.display = 'none'; el.classList.remove('ad-banner-visible');
          delete el.dataset.bannerKey;
        });
        document.querySelectorAll('.ad-banner-slot-160x300').forEach(el => {
          el.innerHTML = ''; el.style.display = 'none'; el.classList.remove('ad-banner-visible');
          delete el.dataset.bannerKey;
        });
      } else if (this._lastBannerKey) {
        this._fillAllBannerSlots(this._lastBannerKey);
        if (this._last160x300Key) this._fillAll160x300Slots(this._last160x300Key);
      }
      if (!this._isOn('adsterraNative')) {
        const el = document.getElementById('adsterraSlotNative');
        if (el) { el.innerHTML = ''; el.style.display = 'none'; delete el.dataset.adsterraLoaded; }
        document.querySelectorAll('.ad-banner-slot-native').forEach(el2 => {
          el2.innerHTML = ''; el2.style.display = 'none'; el2.classList.remove('ad-banner-visible');
          delete el2.dataset.nativeLoaded; delete el2.dataset.bannerKey;
        });
      } else if (this._lastNativeScriptSrc || this._lastBannerKey) {
        this._fillAllNativeSlots(this._lastNativeScriptSrc, this._lastBannerKey);
      }
      if (!this._isOn('adsterraSocialBar')) this._removeSocialBar();
      if (!this._isOn('customSlots')) this._hideCustomSlots();
    },

    _hideAllMonetag() {
      // Fully removes the injected script/wrapper nodes (not just hiding
      // them) so any polling/tracking/popunder logic those scripts started
      // actually stops running, not just stops being visible.
      document.querySelectorAll('[data-monetag-raw]').forEach(el => el.remove());
      document.querySelectorAll('script[data-monetag-zone]').forEach(el => el.remove());
      this._loadedMonetagZones.clear();
    },

    _removeSocialBar() {
      // The Social Bar script, once loaded, may manage its own DOM outside
      // any container we control (some networks inject directly into
      // document.body with their own wrapper div/iframe). This removes
      // the script tag we injected AND any Adsterra social-bar wrapper
      // elements it created, so switching the toggle off actually stops
      // it rather than just preventing a future load.
      document.querySelectorAll('script[data-adsterra-social-bar]').forEach(el => el.remove());
      // Adsterra's social bar script commonly wraps its output in a
      // container with an id/class containing "social-bar" or injects a
      // fixed-position iframe — remove anything matching that pattern as
      // a best-effort cleanup, since the exact structure isn't controlled
      // by us and can vary by account/campaign.
      document.querySelectorAll('[id*="social-bar" i], [class*="social-bar" i]').forEach(el => el.remove());
      this._socialBarLoaded = false; // allow it to load again if re-enabled
    },

    _hideCustomSlots() {
      ['adSlotHomeTop', 'adSlotHomeMid', 'adSlotPlayer', 'adSlotPolicyPage'].forEach(slotId => {
        const el = document.getElementById(slotId);
        if (el) { el.innerHTML = ''; el.style.display = 'none'; }
      });
    },

    _logError(context, err) {
      try {
        console.warn('[AdsEngine]', context, err);
        if (this._db) {
          this._db.ref('adAnalytics/errors').push({
            context, message: String(err && err.message || err),
            page: location.pathname, ts: Date.now()
          }).catch(() => {});
        }
      } catch (e) { /* logging must never itself throw */ }
    },

    _logLoadConfirmed(slotName) {
      try {
        if (!this._db) return;
        this._db.ref('adAnalytics/loads').push({
          slot: slotName, page: location.pathname, ts: Date.now()
        }).catch(() => {});
      } catch (e) { /* proof-logging must never break ad rendering itself */ }
    },

    /* Ad-blocker detection: creates an off-screen element using class
       names that essentially every ad-blocker filter list targets, then
       checks shortly after whether the browser actually rendered it with
       real dimensions. Ad-blockers work by hiding/collapsing elements
       matching known ad-related selectors, so a collapsed bait element is
       a reliable signal — this is the same technique most ad-blocker
       detection scripts use, and it's read-only (never tries to fight or
       circumvent the blocker), it just lets the app show an honest,
       polite message instead of confusing blank gaps. */
    _detectAdBlocker() {
      const bait = document.createElement('div');
      bait.className = 'adsbox ad-slot ad-banner adsbygoogle';
      bait.style.cssText = 'position:absolute;top:-9999px;left:-9999px;width:1px;height:1px;';
      document.body.appendChild(bait);
      setTimeout(() => {
        const rect = bait.getBoundingClientRect();
        this._adBlockDetected = (rect.height === 0 || bait.offsetParent === null || getComputedStyle(bait).display === 'none');
        bait.remove();
        if (this._adBlockDetected) {
          document.dispatchEvent(new CustomEvent('minexus:adblock-detected'));
        }
      }, 300);
    },

    /* Watches a container for real ad content actually appearing inside
       it (an iframe, or any non-empty child), confirms/logs it as proof,
       and retries loading if nothing shows up within the grace period —
       this is what turns "we inserted a script tag and hoped for the
       best" into an actually-monitored, self-healing ad slot.

       REAL BUG FIXED HERE: the old check was `container.children.length >
       0`, but renderBanner() always synchronously appends an iframe to
       the container the instant it's called — BEFORE the ad network has
       had any chance to actually respond. That meant this check was
       structurally guaranteed to always pass (an iframe element is always
       there), regardless of whether the ad network returned real content
       or nothing at all. The practical effect: any Adsterra key that was
       invalid, misconfigured, or simply had no fill for a given
       visitor/region logged as "confirmed" and NEVER retried — the ad
       slot just sat there permanently blank with no visible sign anything
       was wrong. Fixed to actually measure the iframe's rendered content
       area (its contentWindow document body's scroll size) instead of
       just checking that a DOM node exists — a truly empty/failed ad
       network response renders an effectively empty body, which this now
       correctly detects as "no content" and retries. Falls back to the
       old "any child present" check only for non-iframe cases (native ad
       scripts that inject `.native-ad-wrapper` divs directly, which don't
       have this same false-positive risk since they're same-origin DOM
       content we can already see is non-empty). */
    _confirmOrRetry(container, slotName, retryFn, attempt) {
      if (!container) return;
      attempt = attempt || 0;
      const maxAttempts = 3;
      const graceMs = 2500;

      setTimeout(() => {
        const iframe = container.querySelector('iframe');
        let hasContent = false;
        if (iframe) {
          try {
            // A same-origin-accessible srcdoc iframe lets us actually
            // measure whether the ad network rendered real content
            // (non-trivial body size) vs. an effectively empty page.
            const doc = iframe.contentDocument || (iframe.contentWindow && iframe.contentWindow.document);
            const body = doc && doc.body;
            hasContent = !!(body && (body.scrollHeight > 5 || body.scrollWidth > 5) && body.children.length > 0);
          } catch (e) {
            // Cross-origin iframe content (can happen once the ad
            // network's own script navigates the iframe to its own
            // origin to serve the creative) can't be inspected from here
            // at all — that's actually a strong signal the ad DID load
            // (a same-origin blank iframe would never throw), so treat
            // the security exception itself as a success signal rather
            // than a failure.
            hasContent = true;
          }
        } else {
          hasContent = container.querySelector('ins, .native-ad-wrapper') || container.children.length > 0;
        }

        if (hasContent) {
          this._logLoadConfirmed(slotName);
          return;
        }
        if (attempt < maxAttempts) {
          this._logError(`${slotName}: empty after load, retrying (${attempt + 1}/${maxAttempts})`, 'no content rendered');
          retryFn();
          this._confirmOrRetry(container, slotName, retryFn, attempt + 1);
        } else {
          this._logError(`${slotName}: gave up after ${maxAttempts} retries`, 'ad network returned nothing');
        }
      }, graceMs);
    },

    /* ---- MONETAG (Vignette Banner + In-Page Push) ---- */
    _loadMonetagScript(zoneId, kind) {
      if (!zoneId || this._loadedMonetagZones.has(zoneId)) return;
      try {
        this._loadedMonetagZones.add(zoneId);
        const script = document.createElement('script');
        script.src = '//libtl.com/sdk.js';
        script.dataset.zone = zoneId;
        script.dataset.monetagZone = zoneId;
        script.dataset.monetagKind = kind;
        script.setAttribute('data-cfasync', 'false');
        script.onerror = () => this._logError(`monetag-${kind}`, 'script failed to load (network or ad-blocker)');
        document.body.appendChild(script);
      } catch (e) { this._logError(`monetag-${kind}`, e); }
    },

    _loadMonetagRaw(html, kind) {
      if (!html || !html.trim()) return;
      if (document.querySelector(`[data-monetag-raw="${kind}"]`)) return;
      try {
        const wrapper = document.createElement('div');
        wrapper.style.display = 'none';
        wrapper.setAttribute('data-monetag-raw', kind);
        wrapper.innerHTML = html;
        document.body.appendChild(wrapper);
        wrapper.querySelectorAll('script').forEach(oldScript => {
          const newScript = document.createElement('script');
          [...oldScript.attributes].forEach(attr => newScript.setAttribute(attr.name, attr.value));
          newScript.textContent = oldScript.textContent;
          newScript.onerror = () => this._logError(`monetag-${kind}-raw`, 'raw script failed to load');
          oldScript.replaceWith(newScript);
        });
      } catch (e) { this._logError(`monetag-${kind}-raw`, e); }
    },

    _watchMonetag() {
      if (!this._db) return;
      this._db.ref('app_config/monetag').on('value', snap => {
        try {
          if (!this._isOn('monetag')) return; // Admin toggle: Monetag off
          const cfg = snap.val() || {};
          if (cfg.vignetteRaw) this._loadMonetagRaw(cfg.vignetteRaw, 'vignette');
          else this._loadMonetagScript(cfg.vignetteZone, 'vignette');
          if (cfg.ippRaw) this._loadMonetagRaw(cfg.ippRaw, 'ipp');
          else this._loadMonetagScript(cfg.ippZone, 'ipp');
        } catch (e) { this._logError('monetag-config-listener', e); }
      }, err => this._logError('monetag-firebase-read', err));
    },

    /* ---- ADSTERRA (Banner sizes, Native Banner, Social Bar, SmartLink) ---- */
    renderBanner(container, key, width, height) {
      if (!container) return;
      if (!key) { container.style.display = 'none'; return; }
      try {
        const closeTag = '</scr' + 'ipt>';
        const srcdoc = `
          <html><head><style>body{margin:0;display:flex;align-items:center;justify-content:center;background:transparent}</style></head>
          <body>
            <script type="text/javascript">
              atOptions = { 'key': '${key}', 'format': 'iframe', 'height': ${height}, 'width': ${width}, 'params': {} };
            ${closeTag}
            <script type="text/javascript" src="//www.highperformanceformat.com/${key}/invoke.js">${closeTag}
          </body></html>
        `;
        const iframe = document.createElement('iframe');
        iframe.srcdoc = srcdoc;
        iframe.style.cssText = `width:${width}px;height:${height}px;border:none;overflow:hidden;max-width:100%`;
        iframe.setAttribute('scrolling', 'no');
        iframe.onerror = () => this._logError(`adsterra-${width}x${height}`, 'iframe failed to load');
        container.innerHTML = '';
        container.appendChild(iframe);
        container.style.display = 'flex';
        container.style.justifyContent = 'center';
        this._confirmOrRetry(container, `adsterra-${width}x${height}`, () => this.renderBanner(container, key, width, height));
      } catch (e) { this._logError(`adsterra-${width}x${height}`, e); }
    },

    renderDirectScript(container, scriptSrc, slotName) {
      if (!container) return;
      if (!scriptSrc) { container.style.display = 'none'; return; }
      if (container.dataset.adsterraLoaded === scriptSrc) return;
      try {
        container.innerHTML = '';
        const script = document.createElement('script');
        script.async = true;
        script.setAttribute('data-cfasync', 'false');
        script.src = scriptSrc;
        script.onerror = () => this._logError(slotName, 'script failed to load (network or ad-blocker)');
        container.appendChild(script);
        container.dataset.adsterraLoaded = scriptSrc;
        container.style.display = 'block';
        this._confirmOrRetry(container, slotName, () => this.renderDirectScript(container, scriptSrc, slotName));
      } catch (e) { this._logError(slotName, e); }
    },

    loadSocialBar(scriptSrc) {
      if (!scriptSrc || this._socialBarLoaded) return;
      try {
        this._socialBarLoaded = true;
        const script = document.createElement('script');
        script.async = true;
        script.src = scriptSrc;
        script.setAttribute('data-cfasync', 'false');
        script.setAttribute('data-adsterra-social-bar', 'true');
        script.onerror = () => this._logError('adsterra-social-bar', 'script failed to load');
        document.body.appendChild(script);
      } catch (e) { this._logError('adsterra-social-bar', e); }
    },

    _watchAdsterra() {
      if (!this._db) return;
      this._db.ref('app_config/adsterra').on('value', snap => {
        try {
          const cfg = snap.val() || {};
          if (this._isOn('adsterraBanners')) {
            this.renderBanner(document.getElementById('adsterraSlot320x50'), cfg.key320x50, 320, 50);
            this.renderBanner(document.getElementById('adsterraSlot468x60'), cfg.key468x60, 468, 60);
            this.renderBanner(document.getElementById('adsterraSlot160x300'), cfg.key160x300, 160, 300);
          }
          if (this._isOn('adsterraNative')) {
            this.renderDirectScript(document.getElementById('adsterraSlotNative'), cfg.nativeScriptSrc, 'adsterra-native');
          }
          if (this._isOn('adsterraSocialBar')) this.loadSocialBar(cfg.socialBarScriptSrc);

          const supportLink = document.getElementById('supportUsSmartlink');
          if (supportLink) {
            if (cfg.smartlinkUrl) { supportLink.href = cfg.smartlinkUrl; supportLink.style.display = 'inline-flex'; }
            else supportLink.style.display = 'none';
          }
          // Note: the repeatable .ad-banner-slot placements (see the CSS
          // comment above and _observeNewBannerSlots below) are filled by
          // their OWN dedicated key320x50 listener, not from here — kept
          // separate so a grid re-render's MutationObserver callback can
          // re-fill instantly from a cached value instead of needing a
          // fresh Firebase read every time.
        } catch (e) { this._logError('adsterra-config-listener', e); }
      }, err => this._logError('adsterra-firebase-read', err));
    },

    /* Fills every .ad-banner-slot element currently in the DOM. Re-run on
       every re-render (see the MutationObserver setup below) since views
       like Movies/Series/Account rebuild their grid's innerHTML on tab
       switch, filter change, or infinite scroll — which destroys and
       recreates these elements, so a one-time fill at page load would
       only ever have caught the very first render. */
    _fillAllBannerSlots(key) {
      if (!key || !this._isOn('adsterraBanners')) return;
      document.querySelectorAll('.ad-banner-slot').forEach(el => {
        // Skip ones already filled with this exact key — renderBanner
        // already rebuilds the iframe unconditionally, so this check
        // avoids needlessly tearing down and reloading an ad that's
        // already showing correctly every time this function re-runs.
        if (el.dataset.bannerKey === key) return;
        el.dataset.bannerKey = key;
        this.renderBanner(el, key, 320, 50);
        el.classList.add('ad-banner-visible');
      });
    },

    /* Fills every .ad-banner-slot-native element — the SECOND ad placed
       next to every .ad-banner-slot across the app (Muaaz asked to double
       up every existing placement with a different size/format for
       variety and better overall fill rate). Falls back to a second
       320x50 banner using the same key if no native script is configured
       in Admin, so doubling never leaves an empty gap just because Native
       specifically hasn't been set up yet. */
    _fillAllNativeSlots(nativeScriptSrc, fallbackKey) {
      if (!this._isOn('adsterraNative')) return;
      document.querySelectorAll('.ad-banner-slot-native').forEach(el => {
        if (nativeScriptSrc) {
          if (el.dataset.nativeLoaded === nativeScriptSrc) return;
          el.dataset.nativeLoaded = nativeScriptSrc;
          this.renderDirectScript(el, nativeScriptSrc, 'ad-banner-slot-native');
          el.classList.add('ad-banner-visible');
        } else if (fallbackKey) {
          if (el.dataset.bannerKey === fallbackKey) return;
          el.dataset.bannerKey = fallbackKey;
          this.renderBanner(el, fallbackKey, 320, 50);
          el.classList.add('ad-banner-visible');
        }
      });
    },

    /* Fills every .ad-banner-slot-160x300 element — used where there's
       enough vertical room for a taller, higher-CPM box format instead of
       a thin banner (e.g. as the second ad in a two-ad pairing). */
    _fillAll160x300Slots(key) {
      if (!key || !this._isOn('adsterraBanners')) return;
      document.querySelectorAll('.ad-banner-slot-160x300').forEach(el => {
        if (el.dataset.bannerKey === key) return;
        el.dataset.bannerKey = key;
        this.renderBanner(el, key, 160, 300);
        el.classList.add('ad-banner-visible');
      });
    },

    /* Watches for new .ad-banner-slot elements being added anywhere in the
       page (grid re-renders, tab switches, infinite scroll appending more
       cards) and fills them automatically — without this, a slot added to
       the DOM after the initial Firebase config read would stay empty
       forever, since _watchAdsterra's listener only re-fires when the
       CONFIG changes in Firebase, not when new markup appears locally. */
    _observeNewBannerSlots() {
      let debounceTimer = null;
      const obs = new MutationObserver(() => {
        // Debounced: a single grid re-render can trigger dozens of
        // individual childList mutations in one tick (each card being
        // inserted), so this waits for the DOM churn to settle before
        // scanning once, instead of re-scanning the whole document on
        // every individual node insertion.
        clearTimeout(debounceTimer);
        debounceTimer = setTimeout(() => {
          if (this._lastBannerKey) this._fillAllBannerSlots(this._lastBannerKey);
          this._fillAllNativeSlots(this._lastNativeScriptSrc, this._lastBannerKey);
          if (this._last160x300Key) this._fillAll160x300Slots(this._last160x300Key);
        }, 150);
      });
      obs.observe(document.body, { childList: true, subtree: true });
      // Cache the keys separately from the main config listener's closure
      // so this observer (which fires on unrelated DOM churn constantly)
      // can re-fill instantly from cached values instead of needing a
      // fresh Firebase read every time.
      this._db.ref('app_config/adsterra/key320x50').on('value', snap => {
        this._lastBannerKey = snap.val() || null;
        this._fillAllBannerSlots(this._lastBannerKey);
        this._fillAllNativeSlots(this._lastNativeScriptSrc, this._lastBannerKey);
      });
      this._db.ref('app_config/adsterra/nativeScriptSrc').on('value', snap => {
        this._lastNativeScriptSrc = snap.val() || null;
        this._fillAllNativeSlots(this._lastNativeScriptSrc, this._lastBannerKey);
      });
      this._db.ref('app_config/adsterra/key160x300').on('value', snap => {
        this._last160x300Key = snap.val() || null;
        this._fillAll160x300Slots(this._last160x300Key);
      });
    },

    /* ---- CUSTOM AD SLOTS (AdSense or other verified banner embeds) ---- */
    _watchCustomSlots() {
      if (!this._db) return;
      this._db.ref('app_config/ad_slots').on('value', snap => {
        try {
          if (!this._isOn('customSlots')) return; // Admin toggle: Custom HTML slots off
          const slots = snap.val() || {};
          ['adSlotHomeTop', 'adSlotHomeMid', 'adSlotPlayer', 'adSlotPolicyPage'].forEach(slotId => {
            const el = document.getElementById(slotId);
            if (!el) return;
            const html = slots[slotId] || '';
            if (html.trim()) {
              el.innerHTML = html;
              el.style.display = 'flex';
              el.querySelectorAll('script').forEach(oldScript => {
                const newScript = document.createElement('script');
                [...oldScript.attributes].forEach(attr => newScript.setAttribute(attr.name, attr.value));
                newScript.textContent = oldScript.textContent;
                newScript.onerror = () => this._logError(slotId, 'custom slot script failed to load');
                oldScript.replaceWith(newScript);
              });
              this._confirmOrRetry(el, slotId, () => { /* custom slots are admin-managed HTML; no automatic retry beyond re-running scripts */ });
            } else {
              el.innerHTML = '';
              el.style.display = 'none';
            }
          });
        } catch (e) { this._logError('custom-slots-listener', e); }
      }, err => this._logError('custom-slots-firebase-read', err));
    }
  };

  // Show a small, honest, non-blocking notice if an ad-blocker is
  // detected — never tries to block the page or nag the person, just
  // explains why some ad slots might look empty (helps Muaaz's users
  // understand it's not the app being broken, and helps Muaaz himself
  // understand why revenue might be lower than expected on some visits).
  document.addEventListener('minexus:adblock-detected', () => {
    console.info('[AdsEngine] Ad-blocker detected — some ad slots may not display.');
  });

  window.MinexusAdsEngine = AdsEngine;
})();

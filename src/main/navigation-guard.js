'use strict';

const { shell } = require('electron');

const { classifyNavigation } = require('./policy');

/** Window in which a repeated verdict for the same URL is treated as one event. */
const DEDUPE_MS = 2000;

/**
 * Loops are the hazard here. A blocked hop in a redirect chain often makes the
 * far side retry with a fresh token, so the URL differs every time and per-URL
 * de-duplication never fires. Without a hard ceiling that turns into a stream of
 * dialogs or, worse, a stream of browser windows.
 */
const EXTERNAL_OPEN_LIMIT = { max: 3, windowMs: 10000 };
const NOTICE_LIMIT = { max: 2, windowMs: 10000 };

/**
 * Keeps the app pinned to the YouTube surface.
 *
 * Enforcement happens twice on purpose:
 *   - `will-frame-navigate` / `setWindowOpenHandler` catch navigations early,
 *     which is where the UI (open externally, explain the block) belongs.
 *   - a `webRequest` backstop cancels anything the events do not see, such as
 *     server-side redirects or a `loadURL` from the main process.
 *
 * @param {object} options
 * @param {(info: {url: string, verdict: string}) => void} [options.onNotice]
 *   Called for a blocked Google service, for UI. Omit for headless runs.
 * @param {(text: string) => void} [options.log]
 */
function createNavigationGuard({ onNotice, log, childWindowOptions } = {}) {
  const recent = new Map();
  const allowExternalOpen = createRateLimiter(EXTERNAL_OPEN_LIMIT);
  const allowNotice = createRateLimiter(NOTICE_LIMIT);
  /** @type {{url: string, verdict: string, at: number}[]} */
  const blocked = [];

  function isDuplicate(url, verdict) {
    const key = `${verdict}:${url}`;
    const now = Date.now();
    const last = recent.get(key);
    recent.set(key, now);
    if (recent.size > 64) {
      for (const [k, at] of recent) if (now - at > DEDUPE_MS) recent.delete(k);
    }
    return last !== undefined && now - last < DEDUPE_MS;
  }

  /**
   * @param {'user'|'redirect'|'backstop'} source Where the navigation came from.
   *   Only a navigation the user actually drove may open the default browser —
   *   a redirect chain must never be able to launch windows on its own.
   */
  function handleBlocked(url, verdict, source) {
    blocked.push({ url, verdict, at: Date.now() });
    log?.(`blocked ${verdict} (${source}) ${url}`);
    if (isDuplicate(url, verdict)) return;

    if (verdict === 'external') {
      if (source !== 'user') return;
      if (!allowExternalOpen()) {
        log?.('external open suppressed: rate limit');
        return;
      }
      openExternally(url);
      return;
    }
    if (verdict === 'block-google') {
      if (!allowNotice()) {
        log?.('notice suppressed: rate limit');
        return;
      }
      onNotice?.({ url, verdict });
    }
  }

  /** Attach the guard to a webContents (main window, popups, webviews). */
  function attach(contents) {
    contents.setWindowOpenHandler(({ url }) => {
      const verdict = classifyNavigation(url, { isMainFrame: true });
      if (verdict === 'allow') {
        // Popups need the options spelled out — notably the session partition,
        // which they do not inherit from the opener.
        return { action: 'allow', overrideBrowserWindowOptions: childWindowOptions?.() };
      }
      handleBlocked(url, verdict, 'user');
      return { action: 'deny' };
    });

    // Fires for the main frame and every sub-frame, script- or user-initiated.
    contents.on('will-frame-navigate', (event) => {
      const verdict = classifyNavigation(event.url, { isMainFrame: event.isMainFrame });
      if (verdict === 'allow') return;
      event.preventDefault();
      handleBlocked(event.url, verdict, 'user');
    });

    // A navigation we allowed can still be redirected somewhere we would not.
    // `isMainFrame` matters here: an ad frame redirecting between third parties
    // is normal, and must not be mistaken for the app leaving YouTube.
    contents.on('will-redirect', (event, legacyUrl) => {
      const url = event.url ?? legacyUrl;
      const verdict = classifyNavigation(url, { isMainFrame: event.isMainFrame !== false });
      if (verdict === 'allow') return;
      event.preventDefault();
      handleBlocked(url, verdict, 'redirect');
    });
  }

  /** Last line of defence, at the network layer. */
  function installRequestBackstop(ytSession) {
    ytSession.webRequest.onBeforeRequest(
      { urls: ['<all_urls>'], types: ['mainFrame', 'subFrame'] },
      (details, callback) => {
        const verdict = classifyNavigation(details.url, {
          isMainFrame: details.resourceType === 'mainFrame',
        });
        if (verdict === 'allow') {
          callback({});
          return;
        }
        handleBlocked(details.url, verdict, 'backstop');
        callback({ cancel: true });
      },
    );
  }

  return { attach, installRequestBackstop, blocked };
}

/** Allow at most `max` events per `windowMs`. */
function createRateLimiter({ max, windowMs }) {
  const hits = [];
  return () => {
    const now = Date.now();
    while (hits.length > 0 && now - hits[0] > windowMs) hits.shift();
    if (hits.length >= max) return false;
    hits.push(now);
    return true;
  };
}

/** Hand a URL to the default browser, where the app's session does not exist. */
function openExternally(url) {
  let parsed;
  try {
    parsed = new URL(url);
  } catch {
    return false;
  }
  if (!['https:', 'http:', 'mailto:'].includes(parsed.protocol)) return false;
  shell.openExternal(url);
  return true;
}

module.exports = { createNavigationGuard, openExternally, createRateLimiter };

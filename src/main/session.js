'use strict';

const { app, session } = require('electron');

const { shouldStripCredentials, isGoogleOwned } = require('./policy');
const { createIdentity } = require('./identity');

/**
 * Request kinds that carry no identity signal worth rewriting. Video playback is
 * thousands of media segments; running each through main-process JS to restate a
 * User-Agent the session already sets is pure latency.
 */
const BULK_RESOURCE_TYPES = new Set(['media', 'image', 'font', 'stylesheet']);

/**
 * A named `persist:` partition keeps cookies, IndexedDB and — importantly for
 * passkeys — the WebAuthn credential state on disk under the app's userData
 * directory, so signing in once is enough.
 */
const PARTITION = 'persist:youtube';

/**
 * Permissions the YouTube UI legitimately asks for. Everything else is refused;
 * a video player has no business reading the user's location or devices.
 *
 * WebAuthn is deliberately absent: passkey requests do not go through the
 * permission handler at all, they are handed to the OS authenticator (Windows
 * Hello / Touch ID / security key) by Chromium directly.
 */
const ALLOWED_PERMISSIONS = new Set([
  'fullscreen',
  'clipboard-sanitized-write',
  'pointerLock',
]);

/**
 * Configure the shared session: identity, credential fencing and permissions.
 * @param {{ profileId?: string, signInIdentity?: 'electron'|'chrome' }} [options]
 * @returns {{ session: Electron.Session, identity: ReturnType<typeof createIdentity> }}
 */
function createYouTubeSession(options = {}) {
  const ytSession = session.fromPartition(PARTITION);

  // Capture Electron's real UA before anything overwrites it — the sign-in flow
  // needs it back.
  const identity = createIdentity({
    electronUserAgent: app.userAgentFallback,
    chromeVersion: process.versions.chrome,
    profileId: options.profileId,
    signInIdentity: options.signInIdentity,
  });

  app.userAgentFallback = identity.browsingUserAgent;
  ytSession.setUserAgent(identity.browsingUserAgent);

  ytSession.webRequest.onBeforeSendHeaders((details, callback) => {
    const stripCredentials = shouldStripCredentials(details.url);

    // Leave everything else alone, and say so as cheaply as possible: an empty
    // response means "unchanged". Third-party requests and bulk media never need
    // touching, and they are the overwhelming majority.
    if (!stripCredentials && (!isGoogleOwned(details.url) || BULK_RESOURCE_TYPES.has(details.resourceType))) {
      callback({});
      return;
    }

    let headers = identity.rewriteHeaders(
      details.url,
      details.requestHeaders,
      documentUrlOf(details),
    );

    // Defence in depth behind the navigation guard: if a request to a Google
    // account host outside the allowlist ever escapes, it goes out signed-out.
    if (stripCredentials) {
      headers = Object.fromEntries(
        Object.entries(headers).filter(([name]) => {
          const lower = name.toLowerCase();
          return lower !== 'cookie' && lower !== 'authorization' && lower !== 'x-goog-authuser';
        }),
      );
    }

    callback({ requestHeaders: headers });
  });

  ytSession.setPermissionRequestHandler((_contents, permission, callback) => {
    callback(ALLOWED_PERMISSIONS.has(permission));
  });
  ytSession.setPermissionCheckHandler((_contents, permission) =>
    ALLOWED_PERMISSIONS.has(permission),
  );

  // No WebUSB/HID/Serial. Hardware security keys do not need these — Chromium
  // talks to them through the platform WebAuthn stack.
  ytSession.setDevicePermissionHandler(() => false);
  ytSession.setBluetoothPairingHandler((_details, callback) => callback({ confirmed: false }));

  return { session: ytSession, identity };
}

/**
 * URL of the frame a request came from, so identity can be decided per document.
 * The frame may already be gone by the time the request is inspected.
 */
function documentUrlOf(details) {
  try {
    return details.frame?.url || undefined;
  } catch {
    return undefined;
  }
}

/** Sign out by dropping every trace of the session from disk. */
async function clearSessionData() {
  const ytSession = session.fromPartition(PARTITION);
  await ytSession.clearStorageData();
  await ytSession.clearCache();
  await ytSession.clearAuthCache();
}

module.exports = { PARTITION, ALLOWED_PERMISSIONS, createYouTubeSession, clearSessionData };

'use strict';

/**
 * Domain policy for the app.
 *
 * Two goals:
 *   1. The Google sign-in flow (including passkeys) must run inside the app so the
 *      session sticks around.
 *   2. That signed-in session must never reach a non-YouTube Google service —
 *      Gmail, Photos, Drive, My Account and friends.
 *
 * The policy is an allowlist: anything not named here is not part of the YouTube
 * surface. Pure functions only, so `npm test` can exercise them without Electron.
 */

/** Domains that make up YouTube itself (host or any subdomain). */
const YOUTUBE_DOMAINS = Object.freeze([
  'youtube.com',
  'youtu.be',
  'youtube-nocookie.com',
  'youtubekids.com',
  'ytimg.com',
  'ggpht.com',
  'googlevideo.com',
]);

/**
 * Google hosts the sign-in flow navigates to. Kept as tight as possible:
 * account *authentication* only, never account *management*.
 */
const SIGN_IN_RULES = Object.freeze([
  { host: 'accounts.google.com' },
  { host: 'consent.google.com' },
]);

/**
 * Google hosts allowed as embedded frames only — never as a top-level page.
 * These back real YouTube features (captcha during login, paid memberships).
 */
const EMBED_RULES = Object.freeze([
  { host: 'www.google.com', pathPrefix: '/recaptcha/' },
  { host: 'apis.google.com' },
  { host: 'pay.google.com' },
  { host: 'play.google.com' },
  { host: 'www.gstatic.com' },
  { host: 'content.googleapis.com' },
]);

/**
 * Google hosts that may receive the account cookies. Everything else on a Google
 * account domain gets its `Cookie`/`Authorization` headers stripped, so even a
 * request we failed to block cannot act as the signed-in user.
 */
const CREDENTIALED_RULES = Object.freeze([...SIGN_IN_RULES, ...EMBED_RULES]);

/**
 * Domains whose cookie jar carries the Google account session. Matches
 * `google.com`, country domains like `google.co.kr`, and the Gmail domains —
 * but deliberately not `googlevideo.com` / `googleusercontent.com`, which are
 * plain asset hosts.
 */
const GOOGLE_ACCOUNT_DOMAIN = /(?:^|\.)google(?:\.[a-z]{2,3}){1,2}$/;
const EXTRA_GOOGLE_DOMAINS = Object.freeze(['gmail.com', 'googlemail.com']);

function parseUrl(url) {
  let parsed;
  try {
    parsed = new URL(url);
  } catch {
    return null;
  }

  // `mail.google.com.` resolves to the same server as `mail.google.com` but is a
  // different string, so a trailing dot would slip past every host check below.
  if (parsed.hostname.endsWith('.') && parsed.hostname.length > 1) {
    parsed.hostname = parsed.hostname.replace(/\.+$/, '');
  }
  return parsed;
}

function hostMatchesDomain(hostname, domain) {
  return hostname === domain || hostname.endsWith(`.${domain}`);
}

function matchesRules(parsed, rules) {
  return rules.some((rule) => {
    if (rule.host !== parsed.hostname) return false;
    if (rule.pathPrefix && !parsed.pathname.startsWith(rule.pathPrefix)) return false;
    return true;
  });
}

/** True for `https://...` and `http://...`; everything else is not web content. */
function isWebUrl(parsed) {
  return parsed.protocol === 'https:' || parsed.protocol === 'http:';
}

function isYouTube(parsed) {
  return YOUTUBE_DOMAINS.some((domain) => hostMatchesDomain(parsed.hostname, domain));
}

/** A host whose cookies are (or could be) the user's Google account session. */
function isGoogleAccountHost(parsed) {
  return (
    GOOGLE_ACCOUNT_DOMAIN.test(parsed.hostname) ||
    EXTRA_GOOGLE_DOMAINS.some((domain) => hostMatchesDomain(parsed.hostname, domain))
  );
}

/**
 * Hosts Google runs. Used as a cheap gate so the header rewriting never has to
 * look at the flood of third-party requests a YouTube page makes.
 */
const GOOGLE_OWNED_DOMAINS = Object.freeze([
  ...YOUTUBE_DOMAINS,
  'gstatic.com',
  'googleapis.com',
  'googleusercontent.com',
  'gmail.com',
  'googlemail.com',
]);

/** True for anything on a Google-run host. */
function isGoogleOwned(url) {
  const parsed = parseUrl(url);
  if (!parsed || !isWebUrl(parsed)) return false;
  if (GOOGLE_ACCOUNT_DOMAIN.test(parsed.hostname)) return true;
  return GOOGLE_OWNED_DOMAINS.some((domain) => hostMatchesDomain(parsed.hostname, domain));
}

/**
 * Google finishes a sign-in by bouncing through several of its domains to plant
 * the session cookie on each one — `www.google.com/accounts/SetSID`,
 * `accounts.youtube.com/accounts/SetSID` and so on. Blocking that chain leaves
 * the user authenticated but stranded on a dead page, which is exactly what
 * happens if only `accounts.google.com` is allowed.
 *
 * `/accounts/` is authentication plumbing, not a service, so opening just that
 * path keeps Gmail, Photos and Search shut.
 */
function isSessionHandoff(parsed) {
  return isGoogleAccountHost(parsed) && parsed.pathname.startsWith('/accounts/');
}

/**
 * True for Google's sign-in surface. The app presents a different identity here
 * than it does on YouTube — see `identity.js`.
 */
function isSignInSurface(url) {
  const parsed = parseUrl(url);
  if (!parsed || !isWebUrl(parsed)) return false;
  return matchesRules(parsed, SIGN_IN_RULES);
}

/**
 * Decide what to do with a navigation.
 *
 * @param {string} url
 * @param {{ isMainFrame?: boolean }} [options]
 * @returns {'allow'|'block-google'|'external'|'deny'}
 *   allow        - navigate inside the app
 *   block-google - a Google service outside the YouTube surface; refuse
 *   external     - an unrelated site; hand it to the default browser
 *   deny         - not web content; drop it
 */
function classifyNavigation(url, options = {}) {
  const isMainFrame = options.isMainFrame !== false;
  const parsed = parseUrl(url);
  if (!parsed) return 'deny';

  // about:blank and friends are how popups and ad frames bootstrap themselves.
  if (parsed.protocol === 'about:' || parsed.protocol === 'data:') return 'allow';
  if (!isWebUrl(parsed)) return parsed.protocol === 'mailto:' ? 'external' : 'deny';
  if (isSessionHandoff(parsed)) return 'allow';

  if (isYouTube(parsed) || matchesRules(parsed, SIGN_IN_RULES)) return 'allow';

  if (!isMainFrame) {
    // Sub-frames: only Google account surfaces are policed. Third-party frames
    // (ads, embeds) are left alone — blocking them would just break the page
    // without protecting the session.
    if (matchesRules(parsed, EMBED_RULES)) return 'allow';
    return isGoogleAccountHost(parsed) ? 'block-google' : 'allow';
  }

  return isGoogleAccountHost(parsed) ? 'block-google' : 'external';
}

/** Convenience wrapper: may this URL be shown in the app at all? */
function isNavigationAllowed(url, options) {
  return classifyNavigation(url, options) === 'allow';
}

/**
 * True when the request must not carry the account session. Applies to Google
 * account domains that are not on the credentialed allowlist.
 */
function shouldStripCredentials(url) {
  const parsed = parseUrl(url);
  if (!parsed || !isWebUrl(parsed)) return false;
  if (isYouTube(parsed)) return false;
  if (!isGoogleAccountHost(parsed)) return false;
  // The hand-off exists precisely to carry the session cookie; stripping it
  // there would break sign-in just as surely as blocking the request.
  if (isSessionHandoff(parsed)) return false;
  return !matchesRules(parsed, CREDENTIALED_RULES);
}

module.exports = {
  YOUTUBE_DOMAINS,
  SIGN_IN_RULES,
  EMBED_RULES,
  classifyNavigation,
  isNavigationAllowed,
  isSignInSurface,
  isGoogleOwned,
  shouldStripCredentials,
};

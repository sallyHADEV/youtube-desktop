'use strict';

const { isSignInSurface } = require('./policy');
const { userAgentFor, rewriteClientHints } = require('./ua-profiles');

/**
 * Which browser the app claims to be — and it claims different things in
 * different places, on purpose.
 *
 * On YouTube it presents a stock Chrome identity, which is what the site expects
 * from a Chromium engine.
 *
 * On Google's sign-in pages it presents Electron's *real* identity instead.
 * That is counter-intuitive but it is what actually works: Google's "this
 * browser or app may not be secure" wall is not triggered by the word Electron,
 * it is triggered by a client that claims to be Chrome and then fails Chrome's
 * integrity checks. The mismatch is the signal. Telling the truth there passes;
 * the disguise is what gets rejected. (Same approach as th-ch/youtube-music,
 * which restores the original UA for accounts.google.com requests.)
 *
 * Override with `--sign-in-identity=chrome` if Google ever flips this around.
 */

/** @typedef {'electron'|'chrome'} SignInIdentity */

function createIdentity({ electronUserAgent, chromeVersion, profileId = 'chrome', signInIdentity = 'electron' }) {
  const browsingUserAgent = userAgentFor(profileId, electronUserAgent, chromeVersion);

  /**
   * Should this request present Electron's real identity rather than the disguise?
   *
   * Keyed on the *document*, not the request URL. A sign-in page pulls scripts
   * from gstatic and posts to other endpoints; if those went out claiming Chrome
   * while the page claimed Electron, the page would be contradicting itself
   * request by request — the same class of inconsistency that gets sign-in
   * rejected in the first place.
   */
  const isHonestSurface = (url, documentUrl) => {
    if (signInIdentity !== 'electron') return false;
    return isSignInSurface(documentUrl ?? url) || isSignInSurface(url);
  };

  return {
    browsingUserAgent,
    electronUserAgent,
    profileId,
    signInIdentity,

    /** The UA string a given URL should be fetched with. */
    userAgentFor: (url, documentUrl) =>
      isHonestSurface(url, documentUrl) ? electronUserAgent : browsingUserAgent,

    /**
     * Adjust an outgoing request's identity headers.
     * On the sign-in surface every hint is left exactly as Chromium built it, so
     * the UA string and the client hints agree with each other.
     *
     * @param {string} [documentUrl] URL of the frame the request came from.
     */
    rewriteHeaders(url, headers, documentUrl) {
      if (isHonestSurface(url, documentUrl)) {
        return setHeader(headers, 'User-Agent', electronUserAgent);
      }
      return setHeader(
        rewriteClientHints(headers, profileId, chromeVersion),
        'User-Agent',
        browsingUserAgent,
      );
    },

  };
}

/**
 * Set a header, replacing any existing spelling of it. Chromium is not obliged
 * to hand us a particular casing, and `{ ...headers, 'User-Agent': x }` would
 * leave a stray `user-agent` behind — two conflicting UA headers on the wire.
 */
function setHeader(headers, name, value) {
  const result = {};
  for (const [key, existing] of Object.entries(headers)) {
    if (key.toLowerCase() !== name.toLowerCase()) result[key] = existing;
  }
  result[name] = value;
  return result;
}

module.exports = { createIdentity, setHeader };

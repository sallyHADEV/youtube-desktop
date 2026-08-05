'use strict';

/**
 * Identity profiles for the embedded browser.
 *
 * Google refuses to sign users in from anything it recognises as an embedded
 * browser, and which disguise it accepts changes over time. Rather than baking
 * one guess in, the app carries a few coherent profiles and lets the user switch
 * (menu → 계정 → 로그인 호환 모드). `npm run probe` reports which ones currently
 * reach a real sign-in form.
 *
 * A profile must be internally consistent: the UA string, the `Sec-CH-UA-*`
 * request headers and `navigator.userAgentData` all have to tell the same story,
 * otherwise the mismatch is itself a detection signal.
 */

const GREASE_BRAND = 'Not_A Brand';
const GREASE_VERSION = '99';

const FIREFOX_VERSION = '145.0';

/** @typedef {'chrome'|'edge'|'none'} HintStyle */

const PROFILES = Object.freeze({
  /** Stock Chrome. The obvious choice, and what Chromium actually is. */
  chrome: {
    id: 'chrome',
    label: 'Chrome',
    hintStyle: 'chrome',
    userAgent: (platform, major) =>
      `Mozilla/5.0 (${platform}) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/${major}.0.0.0 Safari/537.36`,
    brands: (major) => [
      { brand: 'Chromium', version: major },
      { brand: 'Google Chrome', version: major },
      { brand: GREASE_BRAND, version: GREASE_VERSION },
    ],
  },

  /** Edge is Chromium too, and is not on the embedded-browser blocklist. */
  edge: {
    id: 'edge',
    label: 'Microsoft Edge',
    hintStyle: 'edge',
    userAgent: (platform, major) =>
      `Mozilla/5.0 (${platform}) AppleWebKit/537.36 (KHTML, like Gecko) ` +
      `Chrome/${major}.0.0.0 Safari/537.36 Edg/${major}.0.0.0`,
    brands: (major) => [
      { brand: 'Chromium', version: major },
      { brand: 'Microsoft Edge', version: major },
      { brand: GREASE_BRAND, version: GREASE_VERSION },
    ],
  },

  /**
   * Firefox sends no client hints and exposes no `navigator.userAgentData`, so
   * there is nothing left to contradict the UA string. Chromium-specific checks
   * do not apply to it either.
   */
  firefox: {
    id: 'firefox',
    label: 'Firefox',
    hintStyle: 'none',
    userAgent: (platform) =>
      `Mozilla/5.0 (${platform}; rv:${FIREFOX_VERSION}) Gecko/20100101 Firefox/${FIREFOX_VERSION}`,
    brands: () => null,
  },

  /** Electron's own identity. Kept for the probe, as the known-bad control. */
  electron: {
    id: 'electron',
    label: 'Electron (기본값, 차단됨)',
    hintStyle: 'chrome',
    userAgent: null, // means "leave Electron's default alone"
    brands: () => null,
  },
});

const DEFAULT_PROFILE = 'chrome';

function getProfile(id) {
  return PROFILES[id] ?? PROFILES[DEFAULT_PROFILE];
}

function majorVersion(version) {
  return String(version).split('.')[0];
}

/** The `(Windows NT 10.0; Win64; x64)` part of whatever UA Electron built. */
function platformToken(defaultUserAgent) {
  return (
    /^Mozilla\/5\.0 \(([^)]*)\)/.exec(defaultUserAgent)?.[1] ?? 'Windows NT 10.0; Win64; x64'
  );
}

function userAgentFor(id, defaultUserAgent, chromeVersion) {
  const profile = getProfile(id);
  if (!profile.userAgent) return defaultUserAgent;
  return profile.userAgent(platformToken(defaultUserAgent), majorVersion(chromeVersion));
}

function brandListHeader(brands) {
  return brands.map(({ brand, version }) => `"${brand}";v="${version}"`).join(', ');
}

/**
 * Bring a request's client hints in line with the profile.
 * Chromium only sends hints it decided to send; we rewrite or drop, never add.
 */
function rewriteClientHints(headers, id, chromeVersion) {
  const profile = getProfile(id);
  const major = majorVersion(chromeVersion);
  const brands = profile.brands(major);
  const result = {};

  for (const [name, value] of Object.entries(headers)) {
    const lower = name.toLowerCase();
    if (!lower.startsWith('sec-ch-ua')) {
      result[name] = value;
      continue;
    }
    // Firefox sends no client hints at all — dropping them keeps the story straight.
    if (profile.hintStyle === 'none') continue;
    if (!brands) {
      result[name] = value;
      continue;
    }

    if (lower === 'sec-ch-ua') result[name] = brandListHeader(brands);
    else if (lower === 'sec-ch-ua-full-version-list') {
      result[name] = brandListHeader(
        brands.map(({ brand, version }) => ({ brand, version: `${version}.0.0.0` })),
      );
    } else if (lower === 'sec-ch-ua-full-version') result[name] = `"${major}.0.0.0"`;
    else result[name] = value;
  }
  return result;
}

module.exports = {
  PROFILES,
  DEFAULT_PROFILE,
  getProfile,
  userAgentFor,
  rewriteClientHints,
  brandListHeader,
  majorVersion,
};

'use strict';

const YOUTUBE_URL = 'https://www.youtube.com/';
const MUSIC_URL = 'https://music.youtube.com/';

const MODES = Object.freeze({
  YOUTUBE: 'youtube',
  MUSIC: 'music',
});

const STARTUP_MODES = Object.freeze({
  YOUTUBE: 'youtube',
  MUSIC: 'music',
  LAST: 'last',
});

/**
 * Detect whether a given URL belongs to YouTube Music or standard YouTube.
 * @param {string} url
 * @returns {'youtube'|'music'}
 */
function detectMode(url) {
  if (!url || typeof url !== 'string') return MODES.YOUTUBE;
  try {
    const parsed = new URL(url);
    if (parsed.hostname === 'music.youtube.com' || parsed.hostname.endsWith('.music.youtube.com')) {
      return MODES.MUSIC;
    }
  } catch {
    // not a valid URL
  }
  return MODES.YOUTUBE;
}

/**
 * Get home URL for the given mode.
 * @param {'youtube'|'music'} mode
 * @returns {string}
 */
function getHomeUrl(mode) {
  return mode === MODES.MUSIC ? MUSIC_URL : YOUTUBE_URL;
}

/**
 * Get window title for the given mode.
 * @param {'youtube'|'music'} mode
 * @returns {string}
 */
function getTitleForMode(mode) {
  return mode === MODES.MUSIC ? 'YouTube Music' : 'YouTube';
}

/**
 * Map a current URL to the target mode's corresponding URL.
 * Preserves video IDs, playlists, and search queries where applicable.
 * @param {'youtube'|'music'} targetMode
 * @param {string} [currentUrl]
 * @returns {string}
 */
function targetUrlForMode(targetMode, currentUrl) {
  if (targetMode !== MODES.YOUTUBE && targetMode !== MODES.MUSIC) {
    targetMode = MODES.YOUTUBE;
  }

  if (!currentUrl || typeof currentUrl !== 'string') {
    return getHomeUrl(targetMode);
  }

  let parsed;
  try {
    parsed = new URL(currentUrl);
  } catch {
    return getHomeUrl(targetMode);
  }

  // If already in target mode, keep current url
  const currentMode = detectMode(currentUrl);
  if (currentMode === targetMode) {
    return currentUrl;
  }

  // Watch page mapping
  if (parsed.pathname === '/watch') {
    const videoId = parsed.searchParams.get('v');
    if (videoId) {
      const base = targetMode === MODES.MUSIC ? 'https://music.youtube.com/watch' : 'https://www.youtube.com/watch';
      const newUrl = new URL(base);
      newUrl.searchParams.set('v', videoId);
      const list = parsed.searchParams.get('list');
      if (list) newUrl.searchParams.set('list', list);
      return newUrl.toString();
    }
  }

  // Shorts mapping: /shorts/VIDEO_ID -> /watch?v=VIDEO_ID on Music
  if (parsed.pathname.startsWith('/shorts/') && targetMode === MODES.MUSIC) {
    const videoId = parsed.pathname.split('/')[2];
    if (videoId) {
      const newUrl = new URL('https://music.youtube.com/watch');
      newUrl.searchParams.set('v', videoId);
      return newUrl.toString();
    }
  }

  // Playlist page mapping
  if (parsed.pathname === '/playlist') {
    const list = parsed.searchParams.get('list');
    if (list) {
      const base = targetMode === MODES.MUSIC ? 'https://music.youtube.com/playlist' : 'https://www.youtube.com/playlist';
      const newUrl = new URL(base);
      newUrl.searchParams.set('list', list);
      return newUrl.toString();
    }
  }

  // Search mapping: YouTube uses search_query, Music uses q
  if (parsed.pathname === '/results' && targetMode === MODES.MUSIC) {
    const query = parsed.searchParams.get('search_query');
    if (query) {
      const newUrl = new URL('https://music.youtube.com/search');
      newUrl.searchParams.set('q', query);
      return newUrl.toString();
    }
  } else if (parsed.pathname === '/search' && targetMode === MODES.YOUTUBE) {
    const query = parsed.searchParams.get('q');
    if (query) {
      const newUrl = new URL('https://www.youtube.com/results');
      newUrl.searchParams.set('search_query', query);
      return newUrl.toString();
    }
  }

  return getHomeUrl(targetMode);
}

/**
 * Determine the initial mode at app startup based on CLI arguments and saved preferences.
 * CLI options take highest priority.
 *
 * @param {string[]} [argv]
 * @param {{ startupMode?: string, lastMode?: string }} [settings]
 * @returns {'youtube'|'music'}
 */
function resolveStartupMode(argv = [], settings = {}) {
  // Command-line flag priority: --music or --mode=music
  if (argv.includes('--music') || argv.some((arg) => arg.startsWith('--mode=') && arg.split('=')[1] === 'music')) {
    return MODES.MUSIC;
  }
  if (argv.includes('--youtube') || argv.some((arg) => arg.startsWith('--mode=') && arg.split('=')[1] === 'youtube')) {
    return MODES.YOUTUBE;
  }

  // Settings preference
  const preference = settings.startupMode ?? STARTUP_MODES.YOUTUBE;
  if (preference === STARTUP_MODES.MUSIC) {
    return MODES.MUSIC;
  }
  if (preference === STARTUP_MODES.LAST && settings.lastMode === MODES.MUSIC) {
    return MODES.MUSIC;
  }

  return MODES.YOUTUBE;
}

module.exports = {
  YOUTUBE_URL,
  MUSIC_URL,
  MODES,
  STARTUP_MODES,
  detectMode,
  getHomeUrl,
  getTitleForMode,
  targetUrlForMode,
  resolveStartupMode,
};

'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const {
  YOUTUBE_URL,
  MUSIC_URL,
  MODES,
  STARTUP_MODES,
  detectMode,
  getHomeUrl,
  getTitleForMode,
  targetUrlForMode,
  resolveStartupMode,
} = require('../src/main/mode');

test('URL에서 모드를 감지한다', () => {
  assert.equal(detectMode('https://www.youtube.com/'), MODES.YOUTUBE);
  assert.equal(detectMode('https://youtube.com/watch?v=dQw4w9WgXcQ'), MODES.YOUTUBE);
  assert.equal(detectMode('https://music.youtube.com/'), MODES.MUSIC);
  assert.equal(detectMode('https://music.youtube.com/watch?v=dQw4w9WgXcQ'), MODES.MUSIC);
  assert.equal(detectMode('https://music.youtube.com/explore'), MODES.MUSIC);
  assert.equal(detectMode('invalid-url'), MODES.YOUTUBE);
  assert.equal(detectMode(null), MODES.YOUTUBE);
});

test('모드별 홈 URL과 창 제목을 제공한다', () => {
  assert.equal(getHomeUrl(MODES.YOUTUBE), YOUTUBE_URL);
  assert.equal(getHomeUrl(MODES.MUSIC), MUSIC_URL);
  assert.equal(getTitleForMode(MODES.YOUTUBE), 'YouTube');
  assert.equal(getTitleForMode(MODES.MUSIC), 'YouTube Music');
});

test('영상 시청 중 모드 전환 시 비디오 ID와 재생목록을 유지한다', () => {
  const ytWatch = 'https://www.youtube.com/watch?v=dQw4w9WgXcQ';
  const musicWatch = targetUrlForMode(MODES.MUSIC, ytWatch);
  assert.equal(musicWatch, 'https://music.youtube.com/watch?v=dQw4w9WgXcQ');

  const backToYt = targetUrlForMode(MODES.YOUTUBE, musicWatch);
  assert.equal(backToYt, 'https://www.youtube.com/watch?v=dQw4w9WgXcQ');

  const ytWithList = 'https://www.youtube.com/watch?v=dQw4w9WgXcQ&list=PL12345';
  assert.equal(
    targetUrlForMode(MODES.MUSIC, ytWithList),
    'https://music.youtube.com/watch?v=dQw4w9WgXcQ&list=PL12345',
  );

  const ytShorts = 'https://www.youtube.com/shorts/dQw4w9WgXcQ';
  assert.equal(
    targetUrlForMode(MODES.MUSIC, ytShorts),
    'https://music.youtube.com/watch?v=dQw4w9WgXcQ',
  );
});

test('재생목록 페이지 전환 시 목록 ID를 유지한다', () => {
  const ytPlaylist = 'https://www.youtube.com/playlist?list=PL12345';
  assert.equal(
    targetUrlForMode(MODES.MUSIC, ytPlaylist),
    'https://music.youtube.com/playlist?list=PL12345',
  );

  const musicPlaylist = 'https://music.youtube.com/playlist?list=PL12345';
  assert.equal(
    targetUrlForMode(MODES.YOUTUBE, musicPlaylist),
    'https://www.youtube.com/playlist?list=PL12345',
  );
});

test('검색 페이지 전환 시 검색 쿼리를 유지한다', () => {
  const ytSearch = 'https://www.youtube.com/results?search_query=iu+celebrity';
  assert.equal(
    targetUrlForMode(MODES.MUSIC, ytSearch),
    'https://music.youtube.com/search?q=iu+celebrity',
  );

  const musicSearch = 'https://music.youtube.com/search?q=iu+celebrity';
  assert.equal(
    targetUrlForMode(MODES.YOUTUBE, musicSearch),
    'https://www.youtube.com/results?search_query=iu+celebrity',
  );
});

test('같은 모드로 전환 요청 시 현재 URL을 그대로 유지한다', () => {
  const ytUrl = 'https://www.youtube.com/feed/subscriptions';
  assert.equal(targetUrlForMode(MODES.YOUTUBE, ytUrl), ytUrl);

  const musicUrl = 'https://music.youtube.com/explore';
  assert.equal(targetUrlForMode(MODES.MUSIC, musicUrl), musicUrl);
});

test('특수 페이지나 알 수 없는 페이지는 각 모드의 홈으로 안내한다', () => {
  assert.equal(
    targetUrlForMode(MODES.MUSIC, 'https://www.youtube.com/@channelname'),
    MUSIC_URL,
  );
  assert.equal(targetUrlForMode(MODES.MUSIC, ''), MUSIC_URL);
  assert.equal(targetUrlForMode(MODES.YOUTUBE, null), YOUTUBE_URL);
});

test('시작 모드 결정: CLI 옵션이 최우선', () => {
  // --music 플래그
  assert.equal(resolveStartupMode(['--music'], { startupMode: 'youtube' }), MODES.MUSIC);
  assert.equal(resolveStartupMode(['--mode=music'], { startupMode: 'youtube' }), MODES.MUSIC);

  // --youtube 플래그
  assert.equal(resolveStartupMode(['--youtube'], { startupMode: 'music' }), MODES.YOUTUBE);
  assert.equal(resolveStartupMode(['--mode=youtube'], { startupMode: 'music' }), MODES.YOUTUBE);
});

test('시작 모드 결정: 저장된 설정 반영', () => {
  // 항상 Music으로 시작 설정
  assert.equal(
    resolveStartupMode([], { startupMode: STARTUP_MODES.MUSIC }),
    MODES.MUSIC,
  );

  // 항상 YouTube로 시작 설정
  assert.equal(
    resolveStartupMode([], { startupMode: STARTUP_MODES.YOUTUBE, lastMode: MODES.MUSIC }),
    MODES.YOUTUBE,
  );

  // 마지막 사용 모드로 시작 설정
  assert.equal(
    resolveStartupMode([], { startupMode: STARTUP_MODES.LAST, lastMode: MODES.MUSIC }),
    MODES.MUSIC,
  );
  assert.equal(
    resolveStartupMode([], { startupMode: STARTUP_MODES.LAST, lastMode: MODES.YOUTUBE }),
    MODES.YOUTUBE,
  );

  // 기본값은 YouTube
  assert.equal(resolveStartupMode([], {}), MODES.YOUTUBE);
});

'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const {
  classifyNavigation,
  isNavigationAllowed,
  isSignInSurface,
  shouldStripCredentials,
} = require('../src/main/policy');
const { createIdentity } = require('../src/main/identity');

const ELECTRON_UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) ' +
  'YouTube Desktop/1.0.0 Chrome/150.0.7871.129 Electron/43.2.0 Safari/537.36';

const identity = () =>
  createIdentity({ electronUserAgent: ELECTRON_UA, chromeVersion: '150.0.7871.129' });

test('YouTube 영역은 앱 안에서 열린다', () => {
  const urls = [
    'https://www.youtube.com/',
    'https://www.youtube.com/watch?v=dQw4w9WgXcQ',
    'https://m.youtube.com/',
    'https://music.youtube.com/',
    'https://studio.youtube.com/',
    'https://tv.youtube.com/',
    'https://youtu.be/dQw4w9WgXcQ',
    'https://i.ytimg.com/vi/abc/hq720.jpg',
    'https://rr3---sn-x.googlevideo.com/videoplayback?x=1',
    'https://yt3.ggpht.com/avatar',
  ];
  for (const url of urls) assert.equal(classifyNavigation(url), 'allow', url);
});

test('로그인 화면은 앱 안에서 열린다 (세션 유지에 필요)', () => {
  assert.equal(
    classifyNavigation(
      'https://accounts.google.com/ServiceLogin?service=youtube&continue=https%3A%2F%2Fwww.youtube.com%2F',
    ),
    'allow',
  );
  assert.equal(classifyNavigation('https://accounts.google.com/v3/signin/challenge/pk/presend'), 'allow');
  assert.equal(classifyNavigation('https://accounts.youtube.com/accounts/SetSID'), 'allow');
  assert.equal(classifyNavigation('https://consent.youtube.com/m?continue=x'), 'allow');
  assert.equal(classifyNavigation('https://consent.google.com/m?continue=x'), 'allow');
});

test('유튜브 밖 Google 서비스는 최상위 이동이 차단된다', () => {
  const blocked = [
    'https://mail.google.com/mail/u/0/',
    'https://photos.google.com/',
    'https://drive.google.com/drive/my-drive',
    'https://docs.google.com/document/d/x/edit',
    'https://myaccount.google.com/',
    'https://calendar.google.com/',
    'https://contacts.google.com/',
    'https://keep.google.com/',
    'https://meet.google.com/abc-defg-hij',
    'https://chat.google.com/',
    'https://takeout.google.com/',
    'https://one.google.com/',
    'https://pay.google.com/gp/w/home',
    'https://play.google.com/store',
    'https://news.google.com/',
    'https://groups.google.com/',
    'https://gemini.google.com/app',
    'https://console.cloud.google.com/',
    'https://www.google.com/search?q=test',
    'https://www.google.co.kr/maps',
    'https://mail.google.co.kr/',
    'https://www.gmail.com/',
    'https://apis.google.com/u/0/_/widget',
  ];
  for (const url of blocked) {
    assert.equal(classifyNavigation(url), 'block-google', url);
    assert.equal(isNavigationAllowed(url), false, url);
  }
});

test('로그인 완료 후 세션 핸드오프 체인은 통과시킨다', () => {
  // Google plants the session cookie on each domain in turn after sign-in.
  // Blocking any hop leaves the user authenticated but stuck on a dead page.
  const handoffs = [
    'https://www.google.com/accounts/SetSID?ssdc=1&sidt=abc',
    'https://accounts.google.com/accounts/SetSID',
    'https://accounts.youtube.com/accounts/SetSID',
    'https://www.google.co.kr/accounts/SetSID',
    'https://accounts.google.com/CheckCookie?continue=x',
  ];
  for (const url of handoffs) {
    assert.equal(classifyNavigation(url), 'allow', url);
    // The hop exists to carry the cookie; stripping it breaks sign-in too.
    assert.equal(shouldStripCredentials(url), false, url);
  }

  // Opening `/accounts/` must not open the rest of the host.
  assert.equal(classifyNavigation('https://www.google.com/search?q=x'), 'block-google');
  assert.equal(classifyNavigation('https://mail.google.com/mail/u/0/'), 'block-google');
});

test('유튜브와 무관한 사이트는 기본 브라우저로 넘어간다', () => {
  assert.equal(classifyNavigation('https://example.com/'), 'external');
  assert.equal(classifyNavigation('https://github.com/electron/electron'), 'external');
  assert.equal(classifyNavigation('mailto:someone@example.com'), 'external');
});

test('웹이 아닌 스킴은 그냥 버린다', () => {
  assert.equal(classifyNavigation('file:///C:/Windows/System32/'), 'deny');
  assert.equal(classifyNavigation('ms-settings:privacy'), 'deny');
  assert.equal(classifyNavigation('javascript:alert(1)'), 'deny');
  assert.equal(classifyNavigation('not a url'), 'deny');
});

test('호스트 이름 속임수를 정규화해서 막는다', () => {
  // A trailing dot resolves to the same server but is a different string, so it
  // would slip past every host comparison if left alone.
  assert.equal(classifyNavigation('https://mail.google.com./'), 'block-google');
  assert.equal(shouldStripCredentials('https://mail.google.com./sync'), true);
  assert.equal(classifyNavigation('https://www.youtube.com./'), 'allow');

  // Credentials in the URL must not be mistaken for the host.
  assert.equal(classifyNavigation('https://accounts.google.com@evil.example/'), 'external');
  assert.equal(classifyNavigation('https://www.youtube.com@evil.example/'), 'external');

  // Case and port are not part of the decision.
  assert.equal(classifyNavigation('https://MAIL.GOOGLE.COM/'), 'block-google');
  assert.equal(classifyNavigation('https://mail.google.com:8443/'), 'block-google');
});

test('구글 계정 도메인과 이름만 비슷한 CDN을 혼동하지 않는다', () => {
  // *.googlevideo.com / *.googleusercontent.com are asset hosts, not account hosts.
  assert.equal(classifyNavigation('https://rr1---sn-a.googlevideo.com/x'), 'allow');
  assert.equal(classifyNavigation('https://lh3.googleusercontent.com/a/x'), 'external');
  assert.equal(classifyNavigation('https://www.googletagmanager.com/gtag/js'), 'external');
  // A lookalike domain must not be treated as YouTube.
  assert.equal(classifyNavigation('https://youtube.com.evil.example/'), 'external');
  assert.equal(classifyNavigation('https://notyoutube.com/'), 'external');
  assert.equal(classifyNavigation('https://evil-google.com/'), 'external');
});

test('iframe: 구글 계정 서비스만 막고 나머지 서드파티는 살려둔다', () => {
  const asFrame = { isMainFrame: false };
  // Login needs these embedded.
  assert.equal(classifyNavigation('https://www.google.com/recaptcha/api2/anchor', asFrame), 'allow');
  assert.equal(classifyNavigation('https://apis.google.com/u/0/_/widget', asFrame), 'allow');
  assert.equal(classifyNavigation('https://pay.google.com/gp/w/embed', asFrame), 'allow');
  // Ads and third-party embeds must keep working.
  assert.equal(classifyNavigation('https://googleads.g.doubleclick.net/pagead/x', asFrame), 'allow');
  assert.equal(classifyNavigation('https://example.com/embed', asFrame), 'allow');
  // Account services stay blocked even as a frame.
  assert.equal(classifyNavigation('https://mail.google.com/', asFrame), 'block-google');
  assert.equal(classifyNavigation('https://photos.google.com/', asFrame), 'block-google');
  // www.google.com is only allowed for reCAPTCHA, not for anything else.
  assert.equal(classifyNavigation('https://www.google.com/search?q=x', asFrame), 'block-google');
});

test('허용 목록 밖 Google 호스트로는 계정 쿠키가 나가지 않는다', () => {
  for (const url of [
    'https://mail.google.com/sync',
    'https://photos.google.com/_/api',
    'https://myaccount.google.com/x',
    'https://www.google.com/search?q=x',
    'https://clients6.google.com/batch',
  ]) {
    assert.equal(shouldStripCredentials(url), true, url);
  }

  for (const url of [
    'https://www.youtube.com/youtubei/v1/player',
    'https://accounts.google.com/CheckCookie',
    'https://www.google.com/recaptcha/api2/reload',
    'https://apis.google.com/u/0/_/widget',
    'https://rr1---sn-a.googlevideo.com/videoplayback',
    'https://example.com/anything',
  ]) {
    assert.equal(shouldStripCredentials(url), false, url);
  }
});

test('로그인 화면인지 판별한다', () => {
  assert.equal(isSignInSurface('https://accounts.google.com/v3/signin/identifier'), true);
  assert.equal(isSignInSurface('https://consent.google.com/m'), true);
  assert.equal(isSignInSurface('https://www.youtube.com/'), false);
  assert.equal(isSignInSurface('https://mail.google.com/'), false);
  assert.equal(isSignInSurface('not a url'), false);
});

test('YouTube에서는 Electron 흔적 없는 Chrome UA를 쓴다', () => {
  const ua = identity().userAgentFor('https://www.youtube.com/');

  assert.equal(
    ua,
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) ' +
      'Chrome/150.0.0.0 Safari/537.36',
  );
  assert.doesNotMatch(ua, /Electron|YouTube Desktop/i);
});

test('로그인 화면에서는 위장을 벗고 진짜 Electron UA를 보낸다', () => {
  // Google blocks clients that claim to be Chrome and then fail Chrome's
  // integrity checks. Telling the truth here is what gets sign-in through.
  const id = identity();
  assert.equal(id.userAgentFor('https://accounts.google.com/v3/signin/identifier'), ELECTRON_UA);
});

test('로그인 페이지가 부르는 하위 리소스도 같은 신원으로 나간다', () => {
  // Decided per document: a sign-in page whose scripts claimed to be Chrome
  // while the page claimed Electron would contradict itself request by request.
  const headers = identity().rewriteHeaders(
    'https://www.gstatic.com/_/mss/boq-identity/_/js/k=boq.min.js',
    { 'User-Agent': 'x' },
    'https://accounts.google.com/v3/signin/challenge/pk',
  );
  assert.equal(headers['User-Agent'], ELECTRON_UA);
});

test('헤더 재작성은 구글 소유 호스트에만 적용된다', () => {
  const { isGoogleOwned } = require('../src/main/policy');

  for (const url of [
    'https://www.youtube.com/',
    'https://rr1---sn-a.googlevideo.com/videoplayback',
    'https://accounts.google.com/x',
    'https://www.gstatic.com/x.js',
    'https://lh3.googleusercontent.com/a',
  ]) {
    assert.equal(isGoogleOwned(url), true, url);
  }

  // Third-party requests are the bulk of a YouTube page and must be skipped.
  for (const url of [
    'https://googleads.g.doubleclick.net/pagead/x',
    'https://example.com/',
    'https://www.googletagmanager.com/gtag/js',
  ]) {
    assert.equal(isGoogleOwned(url), false, url);
  }
});

test('로그인 화면 요청은 클라이언트 힌트도 손대지 않는다', () => {
  const original = {
    'sec-ch-ua': '"Chromium";v="150", "Electron";v="43", "Not_A Brand";v="24"',
    'Sec-CH-UA-Mobile': '?0',
    'User-Agent': 'whatever',
  };
  const headers = identity().rewriteHeaders('https://accounts.google.com/x', original);

  // UA and hints must agree; leaving Chromium's own hints alone keeps them honest.
  assert.equal(headers['User-Agent'], ELECTRON_UA);
  assert.equal(headers['sec-ch-ua'], original['sec-ch-ua']);
});

test('YouTube 요청은 UA와 클라이언트 힌트를 함께 Chrome으로 맞춘다', () => {
  const headers = identity().rewriteHeaders('https://www.youtube.com/', {
    'sec-ch-ua': '"Chromium";v="150", "Electron";v="43", "Not_A Brand";v="24"',
    'Sec-CH-UA-Mobile': '?0',
    Accept: '*/*',
  });

  assert.doesNotMatch(headers['sec-ch-ua'], /Electron/);
  assert.match(headers['sec-ch-ua'], /"Google Chrome";v="150"/);
  assert.doesNotMatch(headers['User-Agent'], /Electron/);
  // Untouched headers survive, and no hint is invented that Chromium did not send.
  assert.equal(headers['Sec-CH-UA-Mobile'], '?0');
  assert.equal(headers.Accept, '*/*');
  assert.equal('sec-ch-ua-full-version-list' in headers, false);
});

test('--sign-in-identity=chrome 로 강제하면 로그인 화면에서도 위장한다', () => {
  const forced = createIdentity({
    electronUserAgent: ELECTRON_UA,
    chromeVersion: '150.0.7871.129',
    signInIdentity: 'chrome',
  });
  assert.doesNotMatch(forced.userAgentFor('https://accounts.google.com/x'), /Electron/);
});

test('User-Agent 헤더가 대소문자 차이로 중복되지 않는다', () => {
  // Chromium may hand us any casing; leaving the original behind would put two
  // conflicting UA headers on the wire.
  const headers = identity().rewriteHeaders('https://accounts.google.com/x', {
    'user-agent': 'lowercase original',
    Accept: '*/*',
  });

  const uaKeys = Object.keys(headers).filter((k) => k.toLowerCase() === 'user-agent');
  assert.equal(uaKeys.length, 1);
  assert.equal(headers[uaKeys[0]], ELECTRON_UA);
});

test('Firefox 프로파일은 클라이언트 힌트를 아예 보내지 않는다', () => {
  const firefox = createIdentity({
    electronUserAgent: ELECTRON_UA,
    chromeVersion: '150.0.7871.129',
    profileId: 'firefox',
  });
  const headers = firefox.rewriteHeaders('https://www.youtube.com/', {
    'sec-ch-ua': '"Chromium";v="150"',
    'sec-ch-ua-platform': '"Windows"',
    Accept: '*/*',
  });

  assert.match(headers['User-Agent'], /Firefox\/\d/);
  assert.equal('sec-ch-ua' in headers, false);
  assert.equal('sec-ch-ua-platform' in headers, false);
  assert.equal(headers.Accept, '*/*');
});

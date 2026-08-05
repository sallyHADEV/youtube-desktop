'use strict';

const { app, session, nativeTheme } = require('electron');

const { PARTITION } = require('./session');
const { HOME_URL, SIGN_IN_URL } = require('./menu');

/**
 * Headless self-check for the two things this app promises: a real, persistent,
 * passkey-capable Google login, and no route from that login to any other Google
 * service. Run with `npm run smoke`.
 */
async function runSmokeTest({ win, guard, identity }) {
  const userAgent = identity.browsingUserAgent;
  const checks = [];
  const record = (name, pass, detail) => {
    checks.push({ name, pass, detail });
    console.log(`${pass ? 'PASS' : 'FAIL'}  ${name}${detail ? ` — ${detail}` : ''}`);
  };

  console.log(`Electron ${process.versions.electron} / Chromium ${process.versions.chrome}`);
  console.log(`userData: ${app.getPath('userData')}\n`);

  // --- identity ------------------------------------------------------------
  record('User-Agent에 Electron/앱 토큰 없음', !/Electron|YTD/i.test(userAgent), userAgent);

  // --- YouTube loads -------------------------------------------------------
  const home = await navigate(win, HOME_URL);
  record('youtube.com 로드', home.ok, home.ok ? win.webContents.getTitle() : home.detail);
  if (!home.ok) return finish(checks);

  // --- appearance -----------------------------------------------------------
  const prefersDark = await win.webContents.executeJavaScript(
    "matchMedia('(prefers-color-scheme: dark)').matches",
  );
  record('다크 모드 적용', nativeTheme.shouldUseDarkColors && prefersDark, `prefers-color-scheme: dark = ${prefersDark}`);

  // Only proves the call path works (koffi loads, DWM accepts the attribute) —
  // whether the caption actually turns dark depends on the window being on
  // screen, which a headless run never is. Verified visually instead.
  const titleBar = require('./windows-titlebar').applyDarkTitleBar(win);
  record('타이틀바 DWM 호출 가능', titleBar.applied, titleBar.reason ?? 'DwmSetWindowAttribute S_OK');

  // --- what the page sees --------------------------------------------------
  const pageUserAgent = await win.webContents.executeJavaScript('navigator.userAgent');
  record('페이지가 보는 UA가 Chrome', !/Electron/i.test(pageUserAgent), pageUserAgent);

  const brands = await win.webContents.executeJavaScript(
    'JSON.stringify((navigator.userAgentData && navigator.userAgentData.brands) || [])',
  );
  record('navigator.userAgentData 브랜드에 Electron 없음', !/Electron/i.test(brands), brands);

  // --- passkeys ------------------------------------------------------------
  const webauthn = await win.webContents.executeJavaScript(
    `(async () => {
       if (!window.PublicKeyCredential) return { api: false };
       const uvpaa = await PublicKeyCredential.isUserVerifyingPlatformAuthenticatorAvailable()
         .catch((e) => 'error: ' + e);
       const conditional = PublicKeyCredential.isConditionalMediationAvailable
         ? await PublicKeyCredential.isConditionalMediationAvailable().catch(() => false)
         : false;
       return { api: true, uvpaa, conditional };
     })()`,
    true,
  );
  record('WebAuthn API 사용 가능', webauthn.api === true, JSON.stringify(webauthn));
  record(
    '플랫폼 인증기(Windows Hello 등) 감지',
    webauthn.uvpaa === true,
    `isUserVerifyingPlatformAuthenticatorAvailable = ${webauthn.uvpaa}`,
  );

  // --- session persistence -------------------------------------------------
  const ytSession = session.fromPartition(PARTITION);
  const cookies = await ytSession.cookies.get({});
  record(
    '영속 파티션에 쿠키 저장됨',
    cookies.some((cookie) => cookie.domain.includes('youtube.com')),
    `${cookies.length}개`,
  );

  // `LOGIN_INFO` on .youtube.com and `SID` on .google.com are the cookies that
  // actually carry a signed-in session.
  const hasCookie = (name, domain) =>
    cookies.some((cookie) => cookie.name === name && cookie.domain.includes(domain));
  const signedInGoogle = hasCookie('SID', 'google.com');
  const signedInYouTube = hasCookie('LOGIN_INFO', 'youtube.com');
  console.log(
    `\n로그인 상태: Google=${signedInGoogle ? '있음' : '없음'}, ` +
      `YouTube=${signedInYouTube ? '있음' : '없음'}\n`,
  );

  // --- what YouTube itself thinks -------------------------------------------
  // YouTube publishes its own view of the session in `ytcfg` — far more reliable
  // than guessing at the DOM.
  const ytcfg = await win.webContents.executeJavaScript(`(() => {
    try {
      if (!window.ytcfg || !ytcfg.get) return { available: false };
      return { available: true, loggedIn: ytcfg.get('LOGGED_IN'), pageId: ytcfg.get('PAGE_ID') || null };
    } catch (e) { return { available: false, error: String(e) }; }
  })()`);
  // Informational, not a pass/fail: being signed out is a perfectly valid state
  // for a fresh profile, and the smoke test checks the app, not the account.
  console.log(`YouTube 로그인 인식: ${ytcfg.loggedIn === true ? '예' : '아니오'}`);
  const signedIn = ytcfg.loggedIn === true;

  // --- sign-in surface drops the disguise ----------------------------------
  const blockedBeforeSignIn = guard.blocked.length;
  const signIn = await navigate(win, SIGN_IN_URL);
  if (!signIn.ok) {
    record('로그인 페이지 로드', false, signIn.detail);
  } else {
    await delay(1200);
    const page = await win.webContents.executeJavaScript(`({
      ua: navigator.userAgent,
      host: location.hostname,
      hasEmailInput: !!document.querySelector('input[type=email], input[name=identifier]'),
      text: (document.body ? document.body.innerText : '').replace(/\\s+/g, ' ').slice(0, 200),
    })`);

    if (page.host.endsWith('youtube.com')) {
      // Signed in already: Google bounces ServiceLogin straight back to YouTube,
      // so there is no sign-in page left to inspect.
      record('ServiceLogin이 YouTube로 통과 (로그인 상태)', signedIn, page.host);
    } else {
      // The Electron identity rides on the request headers, not on
      // `navigator.userAgent` — switching that per navigation aborts redirects.
      record(
        '로그인 요청이 Electron 신원으로 나감',
        /Electron/.test(identity.userAgentFor(SIGN_IN_URL)),
        identity.userAgentFor(SIGN_IN_URL),
      );
      record(
        '로그인 폼 도달 (차단 문구 없음)',
        page.hasEmailInput && !/안전하지 않|not secure|browser or app/i.test(page.text),
        page.text.slice(0, 120),
      );
    }
  }
  const duringSignIn = guard.blocked.slice(blockedBeforeSignIn);
  console.log(
    duringSignIn.length
      ? `\n로그인 중 차단된 홉:\n${duringSignIn.map((b) => `  ${b.verdict}  ${b.url}`).join('\n')}\n`
      : '\n로그인 중 차단된 홉 없음\n',
  );

  const afterCookies = await ytSession.cookies.get({});
  console.log(
    `로그인 후 쿠키: ${afterCookies.length}개, ` +
      `LOGIN_INFO=${afterCookies.some((c) => c.name === 'LOGIN_INFO')}\n`,
  );

  await navigate(win, HOME_URL);

  // --- mouse gestures -------------------------------------------------------
  await navigate(win, HOME_URL);
  await navigate(win, 'https://www.youtube.com/feed/trending');

  // Judge by the history index, not the URL: YouTube redirects several paths
  // back to `/`, so two different destinations can share one address and a
  // successful navigation would look like nothing happened.
  const history = win.webContents.navigationHistory;
  const startIndex = history.getActiveIndex();

  // Injected input is only routed to a window that is actually on screen, so the
  // otherwise headless run has to put it up briefly.
  win.showInactive();
  await delay(500);

  await performRightDrag(win, -180);
  const backIndex = await waitForIndexChange(win, startIndex);
  record(
    '오른쪽 드래그 ← 뒤로 가기',
    backIndex === startIndex - 1,
    `history ${startIndex} → ${backIndex}`,
  );

  // The back navigation loads a fresh document; its preload has to be in place
  // before the next drag can be seen.
  await delay(2000);

  await performRightDrag(win, 180);
  const forwardIndex = await waitForIndexChange(win, backIndex);
  record(
    '오른쪽 드래그 → 앞으로 가기',
    forwardIndex === backIndex + 1,
    `history ${backIndex} → ${forwardIndex}`,
  );

  // A right-click that barely moves must still be a plain right-click.
  const beforeTwitch = history.getActiveIndex();
  await performRightDrag(win, -8);
  await delay(700);
  record(
    '짧은 우클릭은 이동하지 않는다',
    history.getActiveIndex() === beforeTwitch,
    `history ${beforeTwitch} → ${history.getActiveIndex()}`,
  );
  win.hide();

  // --- popups share the session --------------------------------------------
  await navigate(win, HOME_URL);
  const popup = await openPopup(win, HOME_URL);
  if (!popup) {
    record('새 창이 로그인 세션을 이어받음', false, '팝업이 열리지 않음');
  } else {
    const popupSession = popup.webContents.session;
    const popupCookies = await popupSession.cookies.get({ domain: '.youtube.com' });
    record(
      '새 창이 로그인 세션을 이어받음',
      popupSession === ytSession && popupCookies.length > 0,
      `같은 파티션=${popupSession === ytSession}, 쿠키 ${popupCookies.length}개`,
    );

    // Draw an L in the popup rather than the main window — the gesture is
    // supposed to close whatever window it is drawn in.
    popup.showInactive();
    await delay(600);
    await performLShapeDrag(popup);
    await delay(1500);
    record('ㄴ 제스처로 창 닫기', popup.isDestroyed(), popup.isDestroyed() ? '닫힘' : '열린 채');
    if (!popup.isDestroyed()) popup.destroy();
  }

  // --- the fence -----------------------------------------------------------
  for (const url of [
    'https://mail.google.com/',
    'https://photos.google.com/',
    'https://myaccount.google.com/',
    'https://drive.google.com/',
  ]) {
    const before = guard.blocked.length;
    const result = await navigate(win, url, { timeoutMs: 8000 });
    const verdicts = guard.blocked.slice(before).map((entry) => entry.verdict);
    // ERR_BLOCKED_BY_CLIENT means the request never left the app, which is the
    // proof we want. (`getURL()` still reports the blocked address afterwards —
    // that is the error page's own URL, not loaded content.)
    const pass =
      !result.ok &&
      /ERR_BLOCKED_BY_CLIENT/.test(result.detail ?? '') &&
      verdicts.includes('block-google');
    record(
      `${new URL(url).host} 차단`,
      pass,
      `${result.detail ?? 'no error'} / verdicts=${JSON.stringify(verdicts)}`,
    );
    // Let the error page finish committing before the next navigation, otherwise
    // Chromium drops it on the floor.
    await delay(500);
  }

  return finish(checks);
}

/**
 * Navigate and wait for the outcome.
 *
 * `loadURL`'s promise is not usable here: it rejects with ERR_ABORTED whenever a
 * page replaces its own navigation (YouTube does exactly that on a cold profile),
 * so we watch the webContents events instead and ignore aborts.
 */
function navigate(win, url, { timeoutMs = 30000 } = {}) {
  const contents = win.webContents;
  return new Promise((resolve) => {
    const settle = (result) => {
      clearTimeout(timer);
      contents.off('did-finish-load', onFinish);
      contents.off('did-fail-load', onFail);
      resolve(result);
    };
    const onFinish = () => settle({ ok: true });
    const onFail = (_event, code, description, _failedUrl, isMainFrame) => {
      if (!isMainFrame || code === -3 /* ERR_ABORTED */) return;
      settle({ ok: false, detail: `${description} (${code})` });
    };
    const timer = setTimeout(() => settle({ ok: false, detail: '시간 초과' }), timeoutMs);

    contents.on('did-finish-load', onFinish);
    contents.on('did-fail-load', onFail);
    contents.loadURL(url).catch(() => {
      /* handled through the events above */
    });
  });
}

/** Open a popup the way ctrl/shift-click does, and hand back the new window. */
async function openPopup(win, url, timeoutMs = 8000) {
  const { BrowserWindow } = require('electron');
  const opened = new Promise((resolve) => {
    const onCreated = (_event, created) => resolve(created);
    require('electron').app.once('browser-window-created', onCreated);
    setTimeout(() => resolve(null), timeoutMs);
  });

  await win.webContents.executeJavaScript(
    `window.open(${JSON.stringify(url)}, '_blank'); true`,
    true, // user gesture, or the popup is suppressed
  );
  const popup = await opened;
  if (popup && !popup.isDestroyed()) await delay(1500);
  return popup instanceof BrowserWindow ? popup : null;
}

/** Draw an L: straight down, then right — the close gesture. */
async function performLShapeDrag(win, size = 200) {
  const contents = win.webContents;
  const startX = 250;
  const startY = 150;
  const button = 'right';

  contents.sendInputEvent({ type: 'mouseDown', x: startX, y: startY, button, clickCount: 1 });
  for (let step = 1; step <= 6; step += 1) {
    contents.sendInputEvent({ type: 'mouseMove', x: startX, y: startY + (size * step) / 6, button });
    await delay(25);
  }
  for (let step = 1; step <= 6; step += 1) {
    contents.sendInputEvent({
      type: 'mouseMove',
      x: startX + (size * step) / 6,
      y: startY + size,
      button,
    });
    await delay(25);
  }
  contents.sendInputEvent({
    type: 'mouseUp',
    x: startX + size,
    y: startY + size,
    button,
    clickCount: 1,
  });
}

/** Inject a real right-button drag, the way the gesture handler expects to see it. */
async function performRightDrag(win, dx) {
  const contents = win.webContents;
  const startX = 400;
  const y = 300;
  const button = 'right';

  contents.sendInputEvent({ type: 'mouseDown', x: startX, y, button, clickCount: 1 });
  // Move in steps: a single jump can be dropped as an unrealistic input.
  for (let step = 1; step <= 4; step += 1) {
    contents.sendInputEvent({ type: 'mouseMove', x: startX + (dx * step) / 4, y, button });
    await delay(30);
  }
  contents.sendInputEvent({ type: 'mouseUp', x: startX + dx, y, button, clickCount: 1 });
}

async function waitForIndexChange(win, from, timeoutMs = 5000) {
  const history = win.webContents.navigationHistory;
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (history.getActiveIndex() !== from) return history.getActiveIndex();
    await delay(100);
  }
  return history.getActiveIndex();
}

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function finish(checks) {
  const failed = checks.filter((check) => !check.pass);
  console.log(`\n${checks.length - failed.length}/${checks.length} passed`);
  return failed.length === 0;
}

module.exports = { runSmokeTest };

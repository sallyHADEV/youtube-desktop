'use strict';

const path = require('node:path');

const { BrowserWindow, session } = require('electron');

const { userAgentFor, rewriteClientHints, getProfile } = require('./ua-profiles');
const { SIGN_IN_URL } = require('./menu');

/**
 * Loads the Google sign-in page once per identity profile and reports whether it
 * reaches a real sign-in form or Google's "this browser may not be secure" wall.
 *
 * Read-only: no credentials are entered, and each profile gets a throwaway
 * in-memory session so nothing touches the real login.
 */
const PROFILE_IDS = ['chrome', 'edge', 'firefox', 'electron'];

const BLOCK_PATTERNS =
  /may not be secure|not secure|안전하지 않|보안 요건|couldn't sign you in|로그인할 수 없|disallowed_useragent|browser or app/i;

async function runLoginProbe() {
  console.log(`Electron ${process.versions.electron} / Chromium ${process.versions.chrome}`);
  console.log(`probe: ${SIGN_IN_URL}\n`);

  const results = [];
  for (const id of PROFILE_IDS) {
    // eslint-disable-next-line no-await-in-loop
    const result = await probeProfile(id);
    results.push(result);
    console.log(`--- ${getProfile(id).label} (${id}) ---`);
    console.log(`  판정      : ${result.verdict}`);
    console.log(`  최종 URL  : ${result.url}`);
    console.log(`  제목      : ${result.title}`);
    console.log(`  이메일 입력: ${result.hasEmailInput}`);
    console.log(`  본문      : ${JSON.stringify(result.text)}\n`);
  }

  const usable = results.filter((r) => r.verdict === 'OK').map((r) => r.id);
  console.log(usable.length ? `사용 가능한 프로파일: ${usable.join(', ')}` : '모든 프로파일 차단됨');
  return usable.length > 0;
}

async function probeProfile(id) {
  const partition = `probe-${id}-${Date.now()}`; // no `persist:` → in-memory
  const probeSession = session.fromPartition(partition);
  const chromeVersion = process.versions.chrome;
  const userAgent = userAgentFor(id, probeSession.getUserAgent(), chromeVersion);

  probeSession.setUserAgent(userAgent);
  probeSession.webRequest.onBeforeSendHeaders((details, callback) => {
    callback({ requestHeaders: rewriteClientHints(details.requestHeaders, id, chromeVersion) });
  });

  const win = new BrowserWindow({
    show: false,
    webPreferences: {
      partition,
      preload: path.join(__dirname, '..', 'preload', 'index.js'),
      // Google's sign-in page fires a conditional-UI passkey request on load,
      // which would pop a Windows Hello dialog on the user's desktop for a
      // throwaway session. Diagnostics must not do that.
      additionalArguments: [`--ua-profile=${id}`, '--disable-webauthn'],
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });

  try {
    const loaded = await navigate(win, SIGN_IN_URL);
    if (!loaded.ok) return { id, verdict: `로드 실패: ${loaded.detail}`, url: '', title: '', text: '', hasEmailInput: false };

    // Google renders the wall client-side; give it a moment to settle.
    await delay(1500);

    const page = await win.webContents.executeJavaScript(`({
      url: location.href,
      title: document.title,
      hasEmailInput: !!document.querySelector('input[type=email], input[name=identifier]'),
      text: (document.body ? document.body.innerText : '').replace(/\\s+/g, ' ').slice(0, 300),
    })`);

    const blocked = BLOCK_PATTERNS.test(`${page.text} ${page.title}`) || /rejected/i.test(page.url);
    const verdict = blocked ? '차단됨' : page.hasEmailInput ? 'OK' : '불명확';
    return { id, verdict, ...page };
  } finally {
    win.destroy();
  }
}

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
      if (!isMainFrame || code === -3) return;
      settle({ ok: false, detail: `${description} (${code})` });
    };
    const timer = setTimeout(() => settle({ ok: false, detail: '시간 초과' }), timeoutMs);
    contents.on('did-finish-load', onFinish);
    contents.on('did-fail-load', onFail);
    contents.loadURL(url).catch(() => {});
  });
}

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

module.exports = { runLoginProbe };

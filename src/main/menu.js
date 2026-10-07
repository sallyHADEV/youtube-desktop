'use strict';

const { Menu, dialog, shell, app } = require('electron');

const { clearSessionData } = require('./session');
const { MODES, STARTUP_MODES, getHomeUrl, getTitleForMode } = require('./mode');

const HOME_URL = 'https://www.youtube.com/';
const SIGN_IN_URL =
  'https://accounts.google.com/ServiceLogin?service=youtube&continue=https%3A%2F%2Fwww.youtube.com%2F';

/**
 * Build the application menu bar with navigation, mode switching, and session management.
 *
 * @param {import('electron').BrowserWindow} win
 * @param {object} [options]
 * @param {() => 'youtube'|'music'} [options.getMode]
 * @param {() => 'youtube'|'music'|'last'} [options.getStartupMode]
 * @param {(mode: 'youtube'|'music') => void} [options.onSwitchMode]
 * @param {() => void} [options.onToggleMode]
 * @param {(mode: 'youtube'|'music'|'last') => void} [options.onSetStartupMode]
 * @param {() => void} [options.onToggleSwitcher]
 */
function buildMenu(win, options = {}) {
  const contents = win.webContents;
  const currentMode = options.getMode ? options.getMode() : MODES.YOUTUBE;
  const currentStartupMode = options.getStartupMode ? options.getStartupMode() : STARTUP_MODES.YOUTUBE;
  const currentHomeUrl = getHomeUrl(currentMode);

  const template = [
    {
      label: '파일',
      submenu: [
        {
          label: '홈',
          accelerator: 'Alt+Home',
          click: () => contents.loadURL(getHomeUrl(options.getMode ? options.getMode() : MODES.YOUTUBE)),
        },
        { type: 'separator' },
        { role: 'quit', label: '종료' },
      ],
    },
    {
      label: '모드',
      submenu: [
        {
          label: 'YouTube',
          type: 'radio',
          checked: currentMode === MODES.YOUTUBE,
          accelerator: 'CmdOrCtrl+1',
          click: () => options.onSwitchMode?.(MODES.YOUTUBE),
        },
        {
          label: 'YouTube Music',
          type: 'radio',
          checked: currentMode === MODES.MUSIC,
          accelerator: 'CmdOrCtrl+2',
          click: () => options.onSwitchMode?.(MODES.MUSIC),
        },
        { type: 'separator' },
        {
          label: '모드 전환 (YouTube ⟷ Music)',
          accelerator: 'CmdOrCtrl+M',
          click: () => options.onToggleMode?.(),
        },
        { type: 'separator' },
        {
          label: '시작 모드',
          submenu: [
            {
              label: '항상 YouTube로 시작',
              type: 'radio',
              checked: currentStartupMode === STARTUP_MODES.YOUTUBE,
              click: () => options.onSetStartupMode?.(STARTUP_MODES.YOUTUBE),
            },
            {
              label: '항상 YouTube Music으로 시작',
              type: 'radio',
              checked: currentStartupMode === STARTUP_MODES.MUSIC,
              click: () => options.onSetStartupMode?.(STARTUP_MODES.MUSIC),
            },
            {
              label: '마지막 사용 모드로 시작',
              type: 'radio',
              checked: currentStartupMode === STARTUP_MODES.LAST,
              click: () => options.onSetStartupMode?.(STARTUP_MODES.LAST),
            },
          ],
        },
      ],
    },
    {
      label: '탐색',
      submenu: [
        {
          label: '뒤로',
          accelerator: 'Alt+Left',
          click: () => contents.navigationHistory.canGoBack() && contents.navigationHistory.goBack(),
        },
        {
          label: '앞으로',
          accelerator: 'Alt+Right',
          click: () =>
            contents.navigationHistory.canGoForward() && contents.navigationHistory.goForward(),
        },
        { role: 'reload', label: '새로고침' },
        { role: 'forceReload', label: '캐시 무시하고 새로고침' },
      ],
    },
    {
      label: '보기',
      submenu: [
        { role: 'resetZoom', label: '기본 크기' },
        { role: 'zoomIn', label: '확대' },
        { role: 'zoomOut', label: '축소' },
        { type: 'separator' },
        {
          label: '모드 전환 버튼 표시/숨김',
          accelerator: 'CmdOrCtrl+Shift+M',
          click: () => options.onToggleSwitcher?.(),
        },
        { type: 'separator' },
        { role: 'togglefullscreen', label: '전체 화면' },
        { role: 'toggleDevTools', label: '개발자 도구' },
      ],
    },
    {
      label: '계정',
      submenu: [
        { label: 'Google 계정으로 로그인', click: () => contents.loadURL(SIGN_IN_URL) },
        {
          label: '로그아웃 (세션 삭제)',
          click: () => confirmSignOut(win, currentHomeUrl),
        },
      ],
    },
    {
      label: '도움말',
      submenu: [
        { label: '접근 정책', click: () => showPolicyInfo(win) },
        {
          label: '기본 브라우저에서 열기',
          click: () => shell.openExternal(contents.getURL() || currentHomeUrl),
        },
      ],
    },
  ];

  Menu.setApplicationMenu(Menu.buildFromTemplate(template));
}

async function confirmSignOut(win, fallbackUrl = HOME_URL) {
  const { response } = await dialog.showMessageBox(win, {
    type: 'warning',
    buttons: ['로그아웃', '취소'],
    defaultId: 1,
    cancelId: 1,
    title: '로그아웃',
    message: '저장된 Google 세션을 삭제할까요?',
    detail: '쿠키·캐시·저장소가 모두 지워지고 다시 로그인해야 합니다.',
  });
  if (response !== 0) return;
  await clearSessionData();
  win.webContents.loadURL(fallbackUrl);
}

function showPolicyInfo(win) {
  dialog.showMessageBox(win, {
    type: 'info',
    title: '접근 정책',
    message: '이 앱은 YouTube 및 YouTube Music 영역 밖으로 나가지 않습니다.',
    detail:
      [
        '허용: youtube.com, music.youtube.com, youtu.be, YouTube CDN, 로그인 화면(accounts.google.com)',
        '차단: Gmail, Google 포토, 드라이브, 내 Google 계정 등 모든 다른 Google 서비스',
        '기타 사이트 링크: 앱이 아닌 기본 브라우저에서 열립니다.',
        '',
        `세션 저장 위치: ${app.getPath('userData')}`,
      ].join('\n'),
  });
}

module.exports = { buildMenu, HOME_URL, SIGN_IN_URL };

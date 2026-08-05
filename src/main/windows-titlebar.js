'use strict';

/**
 * Paint the window's title bar dark on Windows.
 *
 * `nativeTheme.themeSource = 'dark'` handles everything Electron draws — menu
 * bar, dialogs, scrollbars — but the title bar belongs to the desktop window
 * manager. When "제목 표시줄 및 창 테두리에 강조색 표시" is on
 * (`HKCU\Software\Microsoft\Windows\DWM\ColorPrevalence = 1`), Windows paints the
 * *focused* window's caption in the accent colour and ignores the app's dark
 * mode. That is why the frame turned blue only while focused.
 *
 * Electron exposes no option for this, so we set the DWM attribute directly.
 * Cosmetic only: every failure path leaves the app running with the default
 * caption.
 */

const DWMWA_BORDER_COLOR = 34;
const DWMWA_CAPTION_COLOR = 35;
const DWMWA_TEXT_COLOR = 36;

/** Windows 11 build 22000 introduced these attributes. */
const MIN_BUILD = 22000;

let cachedApi;

/** `#RRGGBB` → COLORREF, which orders the bytes as `0x00BBGGRR`. */
function toColorRef(hex) {
  const value = Number.parseInt(String(hex).replace('#', ''), 16);
  const r = (value >> 16) & 0xff;
  const g = (value >> 8) & 0xff;
  const b = value & 0xff;
  return ((b << 16) | (g << 8) | r) >>> 0;
}

function loadApi() {
  if (cachedApi !== undefined) return cachedApi;
  try {
    const koffi = require('koffi');
    // Absolute path on purpose. A bare name goes through the DLL search order,
    // which checks the application directory before System32 — so anything that
    // can drop a file next to the executable could get code loaded here.
    const dwmapi = koffi.load(
      require('node:path').join(process.env.SystemRoot ?? 'C:\\Windows', 'System32', 'dwmapi.dll'),
    );
    // On 64-bit Windows an HWND is a 64-bit value; declaring it as an integer
    // passes it in the same register a pointer would use.
    const handleType = process.arch === 'ia32' ? 'uint32' : 'uint64';
    cachedApi = {
      handleType,
      setAttribute: dwmapi.func(
        `int DwmSetWindowAttribute(${handleType} hwnd, uint32 attribute, void *value, uint32 size)`,
      ),
    };
  } catch (error) {
    cachedApi = { error: String(error.message ?? error) };
  }
  return cachedApi;
}

function windowsBuild() {
  return Number.parseInt(require('node:os').release().split('.')[2] ?? '0', 10);
}

/**
 * @param {import('electron').BrowserWindow} win
 * @param {{ caption?: string, text?: string }} [colors]
 * @returns {{ applied: boolean, reason?: string }}
 */
function applyDarkTitleBar(win, colors = {}) {
  if (process.platform !== 'win32') return { applied: false, reason: 'not windows' };
  if (windowsBuild() < MIN_BUILD) return { applied: false, reason: 'needs Windows 11' };

  const api = loadApi();
  if (api.error) return { applied: false, reason: api.error };

  const caption = toColorRef(colors.caption ?? '#0f0f0f');
  const text = toColorRef(colors.text ?? '#f1f1f1');

  try {
    const handleBuffer = win.getNativeWindowHandle();
    const hwnd =
      api.handleType === 'uint32' ? handleBuffer.readUInt32LE(0) : handleBuffer.readBigUInt64LE(0);

    const set = (attribute, colorRef) => {
      const value = Buffer.alloc(4);
      value.writeUInt32LE(colorRef);
      return api.setAttribute(hwnd, attribute, value, 4); // 0 = S_OK
    };

    const results = [
      set(DWMWA_CAPTION_COLOR, caption),
      set(DWMWA_BORDER_COLOR, caption),
      set(DWMWA_TEXT_COLOR, text),
    ];
    const failed = results.find((code) => code !== 0);
    return failed === undefined
      ? { applied: true }
      : { applied: false, reason: `DwmSetWindowAttribute returned 0x${(failed >>> 0).toString(16)}` };
  } catch (error) {
    return { applied: false, reason: String(error.message ?? error) };
  }
}

module.exports = { applyDarkTitleBar, toColorRef };

# YouTube Desktop

A desktop app for YouTube — and nothing else.

Sign in with your Google account so your subscriptions and history are there, but **that session cannot reach any Google service outside YouTube.** Gmail, Photos, Drive and Google Account are all blocked.

> [한국어 문서](README.ko.md) · [Development notes](DEVELOPMENT.md)

## Why

Watching YouTube in a browser tab means the rest of Google is one click away, sharing the same signed-in session. This app exists to make YouTube a plain desktop app: log in once, watch, and have the account stay fenced inside YouTube.

- Passkey (Windows Hello) sign-in
- Session survives restarts — sign in once
- Dark window, title bar included
- Mouse gestures for back / forward / close, and `R` to rotate a video

## Install

Grab one of the two files from `dist`:

| File | What it is |
| --- | --- |
| `YouTube Desktop Setup 1.1.0.exe` | Installer. Adds Start menu and desktop shortcuts |
| `YouTube Desktop 1.1.0.exe` | Portable. Just double-click it |

The builds are unsigned, so Windows SmartScreen will warn on first run. Choose **More info → Run anyway**.

Built for Windows 11. It runs on Windows 10, but the title bar follows the system colour there.

## Signing in

Menu → **계정 (Account) → Sign in with Google**.

If your account has a passkey, Windows Hello appears and a fingerprint, PIN or face is all it takes. Passwords work too.

The session is stored under `%APPDATA%\YouTube Desktop` and survives restarts.

**Signing out**: menu → **Account → Sign out**. Cookies, cache and storage are all cleared.

## Mouse gestures

Hold the **right mouse button** and drag.

| Gesture | Action |
| --- | --- |
| ← drag left | Back |
| → drag right | Forward |
| ↓ then → (an **L** shape) | Close the window |

A drag has to travel at least 60 pixels. Straight gestures are ignored if they move further vertically than horizontally, and a right-click that stays put still opens the normal menu.

The L gesture closes **the window it was drawn in**. Draw it in a popup and only the popup closes; draw it in the main window and the app quits.

`Alt+←` / `Alt+→` and the **탐색 (Navigate)** menu do the same thing.

## Rotating a video

Press **`R`** to turn the video a quarter turn clockwise. Four presses bring it back upright. Useful for phone footage that was uploaded sideways.

Only the video rotates — the player controls and the page stay where they are — and it is scaled to stay inside the player. The rotation resets when a different video starts, and `R` is ignored while you are typing in the search box.

## What is blocked

| | |
| --- | --- |
| Opens in the app | All of YouTube, YouTube Music, YouTube Studio, the sign-in page |
| **Blocked** | Gmail, Google Photos, Drive, Docs, Calendar, Google Account, Google Search, … |
| Opens in your default browser | Links that have nothing to do with YouTube (external links in video descriptions and so on) |

Asking for a blocked Google service brings up a dialog with an **open in default browser** option. That browser does not share this app's session.

## Troubleshooting

### Sign-in stalls or keeps repeating

An interrupted sign-in can leave a half-established session, and Google then treats you as already signed in and never re-runs the flow. Menu → **Account → Sign out**, then sign in again.

### The app does not start

If a window is already open, launching again just brings that window forward. Check the taskbar and your other virtual desktops.

### The icon looks like the old one

That is the Windows icon cache. Press `F5` in Explorer, or restart Explorer:

```bash
taskkill /f /im explorer.exe && start explorer.exe
```

### Logs

Navigation and blocking are recorded here:

```
%APPDATA%\YouTube Desktop\ytd.log
```

Query strings are stripped before writing, since they carry account tokens.

## Limitations

- "Manage your Google Account" in the YouTube avatar menu is blocked by design. The dialog offers to open it in your default browser.
- Memberships and Super Thanks work only where the payment sheet stays inside the app. Flows that take over the whole page are blocked.
- No ad blocking.
- Passkeys do not work on macOS or Linux — Electron cannot present the WebAuthn UI on those platforms ([electron#24573](https://github.com/electron/electron/issues/24573)).

## Running from source

```bash
npm install
npm start
```

> **If PowerShell refuses `npm`** (`... npm.ps1 cannot be loaded because running scripts is disabled`)
> use `npm.cmd` instead. PowerShell resolves `npm` to the `npm.ps1` script, which the
> execution policy blocks; there is no need to change that policy.
>
> ```bash
> npm.cmd start
> ```

To build the installer yourself: `npm run dist` — output lands in `dist`.

## Disclaimer

An unofficial personal client. Not affiliated with, endorsed by, or sponsored by Google or YouTube. YouTube is a trademark of Google LLC. The app icon is a plain play button, deliberately not the YouTube logo.

## License

[MIT](LICENSE)

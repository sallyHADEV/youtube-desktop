# Development notes

User-facing docs are in [README.md](README.md). This is about how it works and why it was built this way.

The traps below were mostly walked into for real. They are easy to reintroduce, so they are written down.

> [한국어 문서](DEVELOPMENT.ko.md) — for the chronological story of how each feature was built (in Korean), see [HISTORY.md](HISTORY.md)

## Commands

| Command | What it does |
| --- | --- |
| `npm start` | Run the app |
| `npm run music` | Run the app directly in YouTube Music mode |
| `npm test` | Unit tests (domain policy, identity, gestures, icon format, mode switching) |
| `npm run smoke` | Launch the app and self-check sign-in, blocking, gestures, dark mode |
| `npm run probe` | Diagnose sign-in blocking per UA profile |
| `npm run signout` | Clear the session |
| `npm run icon` | Regenerate `build/icon.ico` |
| `npm run dist` | Windows installer (NSIS) + portable build |

On PowerShell use `npm.cmd` rather than `npm` (see README).

## Layout

```
src/main/mode.js              Mode manager and URL mapping (pure, under test)
src/main/policy.js            Domain policy (pure functions, under test)
src/main/identity.js          Which browser to claim to be, per URL
src/main/ua-profiles.js       Chrome/Edge/Firefox UA and client hints
src/main/session.js           Persistent partition, header rewriting, permissions
src/main/navigation-guard.js  Three-layer blocking + external link handoff
src/main/windows-titlebar.js  DWM title bar colour (koffi FFI)
src/main/gesture.js           Mouse gesture recognition (pure)
src/main/rotation.js          Video rotation geometry (pure)
src/main/window-state.js      Window position, size, and startup mode preferences
src/main/menu.js              Menu (navigate, mode selection, sign in, sign out)
src/main/logger.js            Navigation, blocking and server responses
src/main/smoke-test.js        Runtime self-check
src/main/login-probe.js       Sign-in blocking diagnosis
src/preload/index.js          Floating mode switcher UI, userAgentData patch, gesture capture
tools/make-icon.js            Icon generation (no dependencies)
```

## 1. Signing in

The session lives in a `persist:youtube` partition. That holds cookies *and* WebAuthn credential state, which is why signing in once is enough.

### Passkeys

No library needed. Chromium hands the WebAuthn request to the OS authenticator and Windows presents the dialog itself. Measured during a real sign-in:

```
[ytd-webauthn] get called {"rpId":"google.com","userVerification":"preferred","allowCredentials":13}
[ytd-webauthn] get resolved in 8633ms true
```

macOS and Linux do not work — Electron cannot present the WebAuthn UI there ([electron#24573](https://github.com/electron/electron/issues/24573)).

### Identity strategy

The app **claims to be a different browser depending on where it is** ([`identity.js`](src/main/identity.js)).

| Destination | Identity |
| --- | --- |
| YouTube | Stock Chrome (UA, `Sec-CH-UA` and `navigator.userAgentData` all agreeing) |
| `accounts.google.com`, `consent.google.com` | **Electron's own, unchanged** |

Dropping the disguise on the sign-in page is the whole trick. It is counter-intuitive, but what triggers Google's "this browser or app may not be secure" wall is not the word Electron — it is **a client that claims to be Chrome and then fails Chrome's integrity checks**. The contradiction is the signal. Disguised as Chrome, sign-in is refused even when the passkey ceremony succeeds; telling the truth gets through. (`th-ch/youtube-music` restores the original UA for `accounts.google.com` requests for the same reason.)

Identity is decided **per document**, not per request URL. If the gstatic scripts a sign-in page loads claimed to be Chrome, the page would be contradicting itself request by request.

If Google ever flips this around:

```bash
npx electron . --sign-in-identity=chrome
```

### ⚠️ Change identity in headers only — never touch `webContents.userAgent`

Identity is applied **exclusively in `onBeforeSendHeaders`**. Assigning to `webContents.userAgent` is not a style choice to revisit; it breaks sign-in.

The last step of sign-in is a redirect from `accounts.google.com` to `accounts.youtube.com` — exactly across the identity boundary. **Changing the UA while a redirect is in flight makes Chromium cancel that navigation with `ERR_ABORTED`.** Google has already accepted the passkey by then (15 cookies issued); only the final hop dies, and the page falls back to `challenge/pk` and spins forever.

It presents as "I authenticated and the window froze and flickered", and **nothing appears in the blocking log** — because nothing was blocked. That makes it very easy to look for the cause in the wrong place.

The real failure:

```
http 302 POST .../challenge/pk -> .../CheckCookie              set-cookie=15   ← passkey accepted
http 302 GET  .../CheckCookie  -> accounts.youtube.com/SetSID  set-cookie=7
neterr net::ERR_ABORTED GET .../CheckCookie                                    ← the UA switch killed it
```

Header rewriting touches one request and cannot disturb a navigation.

The cost is that `navigator.userAgent` reports Chrome on every page: the server sees Electron in the headers, page JS sees Chrome. `navigator.userAgentData` is patched to Chrome brands everywhere too, so **at least what the page can read about itself is self-consistent**.

## 2. Blocking

An allowlist. Anything not named does not get through ([`policy.js`](src/main/policy.js)).

| | |
| --- | --- |
| Opens in-app | `youtube.com`, `youtu.be`, `ytimg.com`, `ggpht.com`, `googlevideo.com`, `youtube-nocookie.com`, `youtubekids.com` |
| Sign-in exception | `accounts.google.com`, `consent.google.com` |
| Session hand-off | The **`/accounts/` path only**, on any Google domain |
| Frame-only exception | `www.google.com/recaptcha/`, `apis.google.com`, `pay.google.com`, `play.google.com` |
| **Blocked** | Every other Google service |
| Default browser | Links unrelated to Google |

Three layers:

1. `will-frame-navigate` / `setWindowOpenHandler` — stop top-level, iframe and popup navigations early, and explain the block in a dialog.
2. `will-redirect` — an allowed page being redirected somewhere it should not go.
3. `webRequest.onBeforeRequest` backstop — anything that got past the events is cut at the network layer with `ERR_BLOCKED_BY_CLIENT`.

On top of that, requests to Google account hosts outside the allowlist have their `Cookie` and `Authorization` headers stripped. Even a request that escapes the fence goes out signed-out.

### Why the session hand-off exception exists

After authentication Google bounces through several of its domains to plant the session cookie on each:

```
accounts.google.com  →  www.google.com/accounts/SetSID  →  accounts.youtube.com/accounts/SetSID  →  youtube.com
```

Block `www.google.com` wholesale and **the passkey succeeds but the YouTube session is never planted.** The cookie jar shows `SID` on `.google.com` and no `LOGIN_INFO` on `.youtube.com`.

`/accounts/` is authentication plumbing rather than a service, so opening just that path completes the chain while Gmail, Photos and Search stay shut.

### ⚠️ Popups inherit nothing

A window opened by ctrl/shift-click or `window.open` **does not inherit the opener's `webPreferences`.** Return a bare `{ action: 'allow' }` from `setWindowOpenHandler` and the new window gets Electron's default session, which has no login cookies — so the user appears **signed out in the new window only**. It also misses the preload, taking gestures and the userAgentData patch with it.

Every window is therefore built from `sharedWebPreferences()`, passed to popups through `overrideBrowserWindowOptions`. Route any new window creation through it.

The smoke test opens a real popup and checks the session object and its cookies.

### Loop defence

When a blocked hop is retried with a fresh token the URL differs every time, so per-URL de-duplication never fires. Hence:

- Anything caught by a redirect or the network backstop **never opens the default browser** (only a navigation the user drove may)
- Ceilings on external opens and dialogs (3 and 2 per 10 seconds)
- One dialog at a time

### Performance

`onBeforeSendHeaders` with no filter puts **every video segment through main-process JS.** Requests that are not Google-owned, or that are media/image/font, take an immediate `callback({})`.

A webRequest listener of any kind routes requests through the main process — that is structural in Electron, so this will not match Chrome exactly.

### Editing the policy

Change the lists at the top of `src/main/policy.js`. `npm test` covers look-alike domains (`youtube.com.evil.example`), CDN false positives (`googlevideo.com`), host spoofing and the frame exceptions.

## 3. Dark theme

**`nativeTheme.themeSource = 'dark'`** covers what Electron draws — menu bar, dialogs, scrollbars — and sets `prefers-color-scheme`, so YouTube's own theme follows.

**The title bar needs more.** It is drawn by the Windows DWM, not Electron. If the user has enabled accent colours on title bars (`HKCU\Software\Microsoft\Windows\DWM\ColorPrevalence = 1`), Windows paints the **focused** window's caption in the accent colour and ignores the app's dark mode. It presents as "blue only when I click the window".

Electron has no option to undo that, so [`windows-titlebar.js`](src/main/windows-titlebar.js) calls `DwmSetWindowAttribute` directly (`DWMWA_CAPTION_COLOR` / `BORDER_COLOR` / `TEXT_COLOR`, Windows 11 22000+). System settings are left alone, so no other app is affected.

Two traps:

**`COLORREF` is BGR, not RGB** (`0x00BBGGRR`). Reverse it and you paint red while trying to remove blue. The conversion is pinned by a unit test.

**Calling it once is not enough.** `S_OK` means the call was accepted, not that the colour was applied. Windows discards it if the window is not on screen yet, and discards it again every time it repaints the frame. So it is re-asserted on `show`, `restore`, `focus`, `maximize` and `unmaximize`.

The smoke test cannot verify this (a headless window is never on screen, so only the call succeeds). Verification was done by sampling screen pixels:

```
after launch, focused    : #0F0F0F
minimise → restore → focus: #0F0F0F
```

Purely cosmetic, so every failure path (non-Windows, Windows 10, koffi unavailable) quietly leaves the default caption and the app runs on.

## 4. Mouse gestures

Right-button drag: `←` back, `→` forward, `↓` then `→` (an L) close the window.

The preload **only records the path**; [`gesture.js`](src/main/gesture.js) decides what it means. Keeping the decision in the main process makes it testable without a renderer and gives the thresholds one definition (the preload receives them as launch arguments).

### Stroke recognition

`toStrokes()` reduces a path to a direction string (`L`/`R`/`U`/`D`), discarding segments under 45px and collapsing consecutive strokes in the same direction. Hand-drawn straight lines wobble; without both rules an `L` becomes a staircase like `LDLUL`.

With more than one stroke, only an exact match in the `GESTURES` table counts. With a single stroke the **overall displacement** decides — straight drags are by far the common case, and endpoints are steadier than path samples.

New gestures are one line in `GESTURES`. `UR`, `RD` and `DL` are deliberately unassigned: nothing happening is better than a window closing by accident.

### Threshold

Both context-menu suppression and gesture recognition use **the furthest the pointer travelled in any direction** (`maxTravel`). Measuring horizontal displacement alone would reject the L shape, whose endpoints can be close together on one axis.

### ⚠️ Do not use `screenX` / `screenY`

They look right but are not always populated — injected input reports them as `0`. This is why gestures did not work at all at first: the events arrived, but the distance always computed to zero.

```
mousedown button=2 screenX=0 clientX=400
mousemove button=0 screenX=0 clientX=355
mouseup   button=2 screenX=0 clientX=220
```

`clientX` / `clientY` are used instead. The page does not scroll during a right-button drag, so viewport coordinates lose nothing.

### Verification

The smoke test injects real drags with `sendInputEvent` and checks the history index. Two things to know:

- **Do not judge by URL.** YouTube redirects several paths back to `/`, so two different destinations can share one address and a successful navigation looks like nothing happened. Use `navigationHistory.getActiveIndex()`.
- **Injected input only reaches a window that is on screen.** The otherwise headless run shows the window briefly for this check.

## 5. Video rotation

`R` turns the video a quarter turn. The geometry lives in [`rotation.js`](src/main/rotation.js); the preload measures and applies.

Rotating 90° swaps the width and height of the box the video occupies. `fitScale()` returns `min(containerW / boxH, containerH / boxW)` — the largest scale that still fits both ways round.

### ⚠️ The scale must be allowed to grow

An earlier version capped it at `1`, reasoning that a video which already fits should not be enlarged. That is wrong for exactly the case this feature exists for: on a **portrait monitor in fullscreen** a 16:9 video is laid out 1080×607, and turned on its side it occupies only 607×1080 of a 1080×1920 screen. Capped, it sits small in the middle of an empty display; uncapped it scales 1.78× and fills the height.

The video element is always laid out to fit the player, so scaling it back up to the container is restoring size, not inventing it.

### ⚠️ Serialise the rotations

Every rotation is a round trip to the main process, and a resize can land in the middle of a keypress. Overlapping calls each read `rotationAngle` before the other writes it back, and a quarter turn goes missing.

Adding the resize observer was enough to trigger this on its own, because `observe()` fires immediately — the first keypress and that initial callback raced, and three presses landed on 180° instead of 270°. Calls are queued through a promise chain.

### ⚠️ A sandboxed preload cannot `require` application files

Only `electron` and a handful of built-ins are available. `require('../main/rotation')` throws, and the exception takes down **every listener registered after it in the file** — the first attempt at this silently disabled the mouse gestures too, with the userAgentData patch above it still working, which is what pointed at the failing line.

So the preload asks the main process over IPC (`ytd:rotate`) instead. Slightly indirect, but there is one tested implementation rather than a copy in the preload that drifts.

### ⚠️ Measure with layout sizes, not `getBoundingClientRect()`

A bounding rect **includes the transform already applied.** Measuring a rotated video returns the rotated, scaled box; feed that back in — which happens on every resize while rotated — and the scaling compounds until the video shrinks away.

`offsetWidth` / `offsetHeight` on the video and `clientWidth` / `clientHeight` on the player are layout values and ignore transforms. (This is why the ImprovedTube extension uses `clientWidth` for the same feature.)

### Applied as a stylesheet rule

The transform goes into a `<style>` element, not `video.style.transform`. YouTube rewrites the video element's `style` attribute as the player resizes and replaces the element itself on navigation — either drops an inline transform, while a rule keeps applying.

### Verification

The smoke test injects a `<video>`, sends real `R` key presses, and checks the rule at 90°, 270° and back to none. It then resizes the player mid-rotation and asserts the scale is recomputed from the new dimensions — the check that fails if bounding rects creep back in.

## 6. Icon

[`tools/make-icon.js`](tools/make-icon.js) generates it with no image tooling: pixels are computed directly, encoded as PNG with `node:zlib`, and assembled into an ICO (which since Vista may hold PNG frames, so no BMP or AND mask is needed).

- 16 / 24 / 32 / 48 / 64 / 128 / 256px — taskbar, Explorer and alt-tab each pick a different size
- 4×4 supersampling for the rounded corners and the triangle

A red rounded square with a white play triangle. The YouTube logo is a trademark, so this is the generic play-button idiom instead.

**256 must be stored as `0` in the size field.** It is a single byte and 256 does not fit; writing 256 makes Windows read the largest icon as zero pixels. Pinned by a test.

To change it, edit the `RED` constant and the shape functions, then `npm run icon`.

## 7. Diagnostics

### Log

`%APPDATA%\YouTube Desktop\ytd.log` records navigation and blocked hops. Query strings are dropped — they carry tokens.

`did-start-navigation` **also fires for same-document navigations** (history updates). A page that polls emits these several times a second, and counting them turns a healthy wait into an apparent redirect loop. They are logged as `same-doc` and excluded from loop detection.

### Trace mode

```bash
npx electron . --trace
```

Records Google's server responses (status, redirect target, cookie count) and the start and outcome of passkey ceremonies. Header values are session tokens, so only counts are logged.

It wraps `navigator.credentials`, so enable it only while diagnosing — the sign-in page is the place most sensitive to that kind of tampering.

### Sign-in probe

```bash
npm run probe
```

Opens the sign-in page in a throwaway session under each of the Chrome / Edge / Firefox / Electron profiles and reports whether it is blocked. No credentials are entered, and passkey requests are disabled in probe windows so no Windows Hello dialog appears.

## 8. Security

### Keep these

| Setting | Value | Why |
| --- | --- | --- |
| `nodeIntegration` | `false` | Remote pages get no Node |
| `contextIsolation` | `true` | The page cannot reach preload objects |
| `sandbox` | `true` | OS-level renderer sandbox |
| `webviewTag` | `false` | No embedding that sidesteps the policy |
| `webSecurity` | default | **Do not turn this off** |
| Certificate validation | default | `certificate-error` is not overridden |
| Permission handler | deny by default | Only `fullscreen`, `clipboard-sanitized-write`, `pointerLock` |
| Device permissions | all denied | WebUSB/HID/Serial, Bluetooth |

### ⚠️ Anything from a renderer can be forged

The preload is injected into **every frame, ad iframes included.** A page can forge an entire gesture with `dispatchEvent(new MouseEvent('mousedown', { button: 2 }))`. This is not hypothetical — an early version could be driven that way.

Two defences:

- The preload checks `event.isTrusted`; script-generated events are `false`
- The `ipcMain` handler accepts messages **from the main frame only** (`event.senderFrame !== event.sender.mainFrame` is ignored)

`resolveGesture` also treats the IPC payload as untrusted and rejects non-numbers, `NaN` and `Infinity`. Keep those assumptions when adding IPC channels.

### Load DLLs by absolute path

`koffi.load('dwmapi.dll')` goes through the DLL search order, which checks **the executable's directory before System32** — so anything able to drop a file next to the app gains code execution. It is loaded from `%SystemRoot%\System32\dwmapi.dll`.

### Normalise hosts before comparing

`parseUrl()` strips trailing dots. `mail.google.com.` resolves to the same server but is a different string, and without normalisation it walks past every host check.

`URL.hostname` is used throughout, so credential tricks like `https://accounts.google.com@evil.example/` are handled — **never compare the raw URL string.**

### Logging

`safeUrl()` drops query strings (they carry auth tokens) and `--trace` counts headers rather than recording their values.

Page console messages are recorded up to 300 characters, though, and what a page logs is not under our control. Treat the log file as potentially sensitive.

### Residual risk

- **No code signing.** SmartScreen warns, and users cannot verify the build has not been tampered with.
- **No auto-update.** Chromium security patches do not arrive on their own; the Electron version has to be bumped and rebuilt.
- **The session hand-off exception is broad.** `/accounts/` on any Google host opens in-app with cookies. Narrow `isSessionHandoff` to the hosts actually used in the chain if that matters to you.
- **`pay.google.com` / `play.google.com` iframes carry the account session.** A deliberate exception for payment flows.

## 9. Packaging

Specifying `files` patterns makes electron-builder **exclude `node_modules`.** Without listing it, koffi is missing and the title bar fails silently in packaged builds only.

Native modules (`koffi.node`) cannot be loaded from inside an asar and must be extracted to `app.asar.unpacked`. electron-builder does this automatically, but it is worth confirming after a build:

```bash
ls "dist/win-unpacked/resources/app.asar.unpacked/node_modules/@koromix/koffi-win32-x64/win32_x64/"
```

The self-check can be run against the packaged executable too:

```bash
"./dist/win-unpacked/YouTube Desktop.exe" --smoke-test
```

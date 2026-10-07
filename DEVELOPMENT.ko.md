# 개발 문서

사용자용 안내는 [README.ko.md](README.ko.md)에 있습니다. 이 문서는 구조와, 왜 그렇게 만들었는지에 대한 기록입니다.

> [English](DEVELOPMENT.md) — 개발 과정을 시간순으로 정리한 재개용 문서는 [HISTORY.md](HISTORY.md)

여기 적힌 함정들은 대부분 **실제로 밟아본 것**입니다. 되돌리기 쉬운 형태라 표시를 남겨둡니다.

## 명령

| 명령 | 설명 |
| --- | --- |
| `npm start` | 앱 실행 |
| `npm run music` | YouTube Music 모드로 바로 실행 |
| `npm test` | 단위 테스트 (도메인 정책, 신원, 아이콘 포맷, 모드 전환) |
| `npm run smoke` | 앱을 실제로 띄워 로그인·차단·다크모드를 자가 점검 |
| `npm run probe` | UA 프로파일별 로그인 차단 진단 |
| `npm run signout` | 세션 초기화 |
| `npm run icon` | `build/icon.ico` 재생성 |
| `npm run dist` | Windows 설치본(NSIS) + 포터블 빌드 |

PowerShell에서는 `npm` 대신 `npm.cmd`를 쓰세요 (README 참고).

## 구조

```
src/main/mode.js              모드 관리 및 URL 매핑 (순수 함수, 테스트 대상)
src/main/policy.js            도메인 정책 (순수 함수, 테스트 대상)
src/main/identity.js          URL별 신원 선택 (YouTube=Chrome, 로그인=Electron)
src/main/ua-profiles.js       Chrome/Edge/Firefox UA·클라이언트 힌트 정의
src/main/session.js           persist 파티션, 헤더 재작성, 권한
src/main/navigation-guard.js  3중 차단 + 외부 링크 전달
src/main/windows-titlebar.js  DWM 타이틀바 색 (koffi FFI)
src/main/window-state.js      창 위치·크기 및 시작 모드 설정 저장
src/main/menu.js              메뉴 (탐색, 모드 선택, 로그인, 로그아웃)
src/main/gesture.js           마우스 제스처 판정 (순수 함수)
src/main/rotation.js          영상 회전 기하 (순수 함수)
src/main/logger.js            이동 경로·차단·서버 응답 기록
src/main/smoke-test.js        실행 자가 점검
src/main/login-probe.js       로그인 차단 진단
src/preload/index.js          플로팅 모드 스위처 UI, userAgentData 패치, 제스처 감지
tools/make-icon.js            아이콘 생성 (의존성 없음)
```

## 1. 로그인

세션은 `persist:youtube` 파티션에 저장됩니다. 쿠키뿐 아니라 WebAuthn 자격 상태도 여기 남으므로 한 번 로그인하면 유지됩니다.

### 패스키

별도 라이브러리가 필요 없습니다. Chromium이 WebAuthn 요청을 OS 인증기로 넘기고 다이얼로그는 Windows가 직접 띄웁니다. 실측:

```
[ytd-webauthn] get called {"rpId":"google.com","userVerification":"preferred","allowCredentials":13}
[ytd-webauthn] get resolved in 8633ms true
```

`npm run smoke`가 인증기 가용성을 확인합니다:

```
PASS  WebAuthn API 사용 가능 — {"api":true,"uvpaa":true,"conditional":true}
PASS  플랫폼 인증기(Windows Hello 등) 감지 — isUserVerifyingPlatformAuthenticatorAvailable = true
```

macOS·Linux는 Electron이 WebAuthn UI를 제공하지 못해 동작하지 않습니다 ([electron#24573](https://github.com/electron/electron/issues/24573)).

### 신원 전략

앱은 **장소에 따라 다른 신원을 제시**합니다 ([`identity.js`](src/main/identity.js)).

| 대상 | 신원 |
| --- | --- |
| YouTube | 순정 Chrome (UA + `Sec-CH-UA` + `navigator.userAgentData` 일치) |
| `accounts.google.com`, `consent.google.com` | **Electron 본래의 신원 그대로** |

로그인 화면에서 위장을 벗는 게 핵심입니다. 직관에 반하지만, Google의 "안전하지 않은 브라우저" 차단을 유발하는 건 "Electron"이라는 단어가 아니라 **Chrome이라고 주장하면서 Chrome 무결성 검사를 통과하지 못하는 클라이언트**입니다. 그 모순이 신호입니다. Chrome UA로 위장하면 패스키로 인증해도 차단되고, 정직하게 Electron이라고 밝히면 통과합니다. (`th-ch/youtube-music`도 같은 이유로 `accounts.google.com` 요청에 한해 원래 UA를 되돌립니다.)

신원은 요청 URL이 아니라 **문서 단위**로 정합니다. 로그인 페이지가 부르는 gstatic 스크립트가 Chrome이라고 주장하면, 한 페이지가 요청마다 다른 브라우저인 척하는 셈이 됩니다.

Google이 정책을 뒤집으면 강제 전환할 수 있습니다:

```bash
npx electron . --sign-in-identity=chrome
```

### ⚠️ 신원은 헤더로만 바꿀 것 — `webContents.userAgent`를 건드리지 말 것

신원은 **오직 `onBeforeSendHeaders`에서만** 적용합니다. `webContents.userAgent`에 대입하는 방식은 쓰지 않으며, 취향이 아니라 필수입니다.

로그인의 마지막 단계는 `accounts.google.com` → `accounts.youtube.com` 리다이렉트인데, 이게 정확히 신원 경계를 넘습니다. **진행 중인 리다이렉트 도중 UA를 바꾸면 Chromium이 그 내비게이션을 `ERR_ABORTED`로 취소합니다.** Google이 패스키를 이미 수락한 뒤(쿠키 15개 발급 완료) 로그인을 완성하는 마지막 홉만 죽고, 페이지는 `challenge/pk`로 되돌아가 무한 반복합니다.

증상은 "인증했는데 화면이 멈추고 깜박임"이고, **차단 로그에는 아무것도 남지 않습니다** — 우리가 막은 게 아니기 때문입니다. 그래서 원인을 엉뚱한 곳에서 찾기 쉽습니다.

실제 실패 로그:

```
http 302 POST .../challenge/pk -> .../CheckCookie              set-cookie=15   ← 패스키 수락됨
http 302 GET  .../CheckCookie  -> accounts.youtube.com/SetSID  set-cookie=7
neterr net::ERR_ABORTED GET .../CheckCookie                                    ← UA 전환이 끊음
```

헤더 재작성은 요청 하나에만 작용하므로 내비게이션을 방해하지 않습니다.

그 대가로 `navigator.userAgent`는 모든 페이지에서 Chrome을 보고합니다. 서버는 헤더로 Electron을, 페이지 JS는 Chrome을 봅니다. `navigator.userAgentData`도 전 페이지에서 Chrome 브랜드로 맞춰 **JS가 보는 자기 정체성만큼은 자기모순이 없게** 유지합니다.

## 2. 차단

허용 목록 방식입니다. 목록에 없으면 통과하지 못합니다 ([`policy.js`](src/main/policy.js)).

| | |
| --- | --- |
| 앱 안에서 열림 | `youtube.com`, `youtu.be`, `ytimg.com`, `ggpht.com`, `googlevideo.com`, `youtube-nocookie.com`, `youtubekids.com` |
| 로그인용 예외 | `accounts.google.com`, `consent.google.com` |
| 세션 핸드오프 | 모든 Google 도메인의 **`/accounts/` 경로만** |
| iframe 전용 예외 | `www.google.com/recaptcha/`, `apis.google.com`, `pay.google.com`, `play.google.com` |
| **차단** | 나머지 Google 서비스 전부 |
| 기본 브라우저로 | Google과 무관한 링크 |

세 겹으로 막습니다:

1. `will-frame-navigate` / `setWindowOpenHandler` — 최상위·iframe·팝업 이동을 사전 차단하고 안내 다이얼로그를 띄웁니다.
2. `will-redirect` — 허용된 페이지가 리다이렉트로 빠져나가는 경우.
3. `webRequest.onBeforeRequest` 백스톱 — 위를 우회한 요청을 네트워크 계층에서 `ERR_BLOCKED_BY_CLIENT`로 끊습니다.

여기에 더해 허용 목록 밖 Google 호스트로 나가는 요청에서는 `Cookie` / `Authorization` 헤더를 제거합니다. 차단을 뚫는 요청이 생기더라도 로그아웃 상태로 나갑니다.

### 세션 핸드오프 예외

Google은 인증 후 세션 쿠키를 도메인마다 심기 위해 리다이렉트 체인을 탑니다:

```
accounts.google.com  →  www.google.com/accounts/SetSID  →  accounts.youtube.com/accounts/SetSID  →  youtube.com
```

`www.google.com`을 통째로 막으면 **패스키 인증에는 성공했는데 YouTube 세션이 심어지기 직전에 멈춥니다.** 쿠키를 보면 `.google.com`에는 `SID`가 있는데 `.youtube.com`에는 `LOGIN_INFO`가 없습니다.

`/accounts/`는 서비스가 아니라 인증 배관이므로, 그 경로만 열면 체인은 완성되고 Gmail·포토·검색은 그대로 막힙니다.

### ⚠️ 팝업은 아무것도 물려받지 않는다

Ctrl·Shift 클릭이나 `window.open`으로 열린 창은 **여는 쪽의 `webPreferences`를 상속하지 않습니다.** `setWindowOpenHandler`에서 `{ action: 'allow' }`만 돌려주면 새 창은 Electron 기본 세션으로 열리고, 거기엔 로그인 쿠키가 없어 **새 창에서만 로그아웃 상태로 보입니다.** 프리로드도 빠져서 제스처와 `userAgentData` 패치까지 사라집니다.

그래서 모든 창은 `sharedWebPreferences()`로 만들고, 팝업에는 `overrideBrowserWindowOptions`로 명시해 넘깁니다. 새 창 생성 지점이 늘어나면 여기를 거치게 하세요.

스모크 테스트가 실제로 팝업을 띄워 세션 객체가 같은지, 쿠키가 실려 있는지 확인합니다.

### 루프 방어

차단된 홉을 상대편이 새 토큰으로 재시도하면 URL이 매번 달라져 URL 단위 중복 제거가 무력화됩니다. 그래서:

- 리다이렉트·네트워크 백스톱에서 걸린 건 **외부 브라우저를 열지 않습니다** (사용자가 직접 누른 이동만 허용)
- 외부 열기·안내창에 상한선 (10초당 3회 / 2회)
- 안내 다이얼로그는 동시에 하나만

### 성능

`onBeforeSendHeaders`는 필터 없이 걸면 **동영상 세그먼트까지 전부 메인 프로세스 JS를 거칩니다.** 구글 소유 호스트가 아니거나 미디어·이미지·폰트류면 즉시 `callback({})`로 빠집니다.

webRequest 리스너가 하나라도 있으면 요청이 메인 프로세스를 거치는 건 Electron의 구조적 비용이라, Chrome과 완전히 같아지지는 않습니다.

### 정책 수정

`src/main/policy.js` 상단의 목록만 고치면 됩니다. `npm test`가 룩얼라이크 도메인(`youtube.com.evil.example`), CDN 오탐(`googlevideo.com`), iframe 예외 범위까지 검증합니다.

## 3. 다크 테마

**`nativeTheme.themeSource = 'dark'`** 가 Electron이 그리는 것(메뉴바·다이얼로그·스크롤바)을 어둡게 하고, `prefers-color-scheme`도 dark로 만들어 YouTube 자체 테마까지 따라오게 합니다.

**타이틀바는 이걸로 부족합니다.** 타이틀바는 Electron이 아니라 Windows의 DWM이 그립니다. 사용자가 "제목 표시줄 및 창 테두리에 강조색 표시"를 켜두면(`HKCU\Software\Microsoft\Windows\DWM\ColorPrevalence = 1`) Windows가 **포커스된 창의** 타이틀바를 강조색으로 칠하고 앱의 다크 모드를 무시합니다. 증상은 "창을 클릭할 때만 파란색"입니다.

Electron에 되돌리는 옵션이 없어 [`windows-titlebar.js`](src/main/windows-titlebar.js)에서 `DwmSetWindowAttribute`를 직접 호출합니다 (`DWMWA_CAPTION_COLOR` / `BORDER_COLOR` / `TEXT_COLOR`, Windows 11 22000+). 시스템 설정은 건드리지 않으므로 다른 앱은 영향받지 않습니다.

함정 두 가지:

**`COLORREF`는 RGB가 아니라 BGR 순서**(`0x00BBGGRR`)입니다. 뒤집으면 파란색을 지우려다 빨간색을 칠하게 됩니다. 변환은 단위 테스트로 고정해 뒀습니다.

**한 번만 호출하면 안 됩니다.** `S_OK`는 "호출을 받았다"는 뜻이지 "적용됐다"가 아닙니다. Windows는 창이 아직 화면에 없으면 이 값을 버리고, 복원 등으로 프레임을 다시 그릴 때마다 또 버립니다. 그래서 `show`·`restore`·`focus`·`maximize`·`unmaximize` 때마다 다시 겁니다.

이 부분은 스모크 테스트로 검증할 수 없습니다 (헤드리스 창은 화면에 없어 호출 성공만 확인됨). 실제 검증은 화면 픽셀을 직접 샘플링했습니다:

```
실행 직후 + 포커스        : #0F0F0F
최소화 -> 복원 -> 포커스  : #0F0F0F
```

순수 장식이므로 모든 실패 경로(비 Windows, Windows 10, koffi 로드 실패)는 조용히 기본 타이틀바로 두고 앱은 그대로 동작합니다.

시스템 설정을 따르게 하려면 [`index.js`](src/main/index.js)의 `themeSource`를 `'system'`으로 바꾸고 `paintTitleBar` 호출을 지우면 됩니다.

## 4. 마우스 제스처

오른쪽 버튼 드래그: `←` 뒤로, `→` 앞으로, `↓`→`→`(ㄴ 모양) 창 닫기.

프리로드는 **경로만 기록해서 보내고**, 의미는 [`gesture.js`](src/main/gesture.js)가 정합니다.

### 획 인식

`toStrokes()`가 경로를 방향 문자열로 줄입니다 (`L`/`R`/`U`/`D`). 45px 미만 구간은 버리고, 연속된 같은 방향은 합칩니다. 손으로 그린 직선은 흔들리기 마련이라, 이 두 규칙이 없으면 `L`이 `LDLUL` 같은 계단이 됩니다.

획이 둘 이상이면 `GESTURES` 표에서 정확히 일치하는 것만 찾습니다. 획이 하나면 **전체 변위**로 판정합니다 — 직선 드래그가 압도적으로 흔한 경우이고, 시작·끝 좌표가 경로 샘플링보다 안정적이기 때문입니다.

새 제스처는 `GESTURES`에 한 줄 추가하면 됩니다. `UR`·`RD`·`DL` 등은 의도적으로 비워 두었습니다 — 실수로 그렸을 때 아무 일도 일어나지 않는 편이 낫습니다.

### 임계값 판단

컨텍스트 메뉴 억제와 제스처 인식 모두 **어느 방향으로든 이동한 최대 거리**(`maxTravel`)를 씁니다. 가로 변위만 보면 ㄴ 모양이 걸러집니다 — 시작점과 끝점이 한 축에서는 가까울 수 있기 때문입니다. 판정을 메인 프로세스에 두면 렌더러 없이 테스트할 수 있고, 임계값 정의가 한 곳에만 존재합니다 (프리로드는 `--gesture-threshold` 인자로 받습니다).

리스너는 **캡처 단계**에 붙입니다. YouTube 플레이어처럼 마우스 이벤트를 삼키는 페이지에서도 제스처가 잡혀야 하기 때문입니다. 프리로드는 격리된 월드에 있지만 DOM은 페이지와 공유하므로 메인 월드 주입이 필요 없습니다.

IPC로 넘어오는 값은 렌더러가 보낸 것이라 신뢰할 수 없으므로, `resolveGesture`는 숫자가 아니거나 `NaN`·`Infinity`면 조용히 무시합니다.

**`screenX`/`screenY`를 쓰지 마세요.** 그럴듯해 보이지만 항상 채워지지 않습니다 — 주입된 입력에서는 `0`으로 옵니다. 실제로 이것 때문에 제스처가 전혀 동작하지 않았고, 이벤트는 도착하는데 이동량이 늘 0으로 계산됐습니다:

```
mousedown button=2 screenX=0 clientX=400
mousemove button=0 screenX=0 clientX=355
mouseup   button=2 screenX=0 clientX=220
```

`clientX`/`clientY`를 씁니다. 오른쪽 버튼 드래그 중에는 페이지가 스크롤되지 않으므로 뷰포트 좌표로 충분합니다.

컨텍스트 메뉴는 제스처가 성립했을 때만 막습니다. Windows는 `contextmenu`를 `mouseup` 뒤에 보내지만 모든 플랫폼이 같지는 않아서, 진행 중인 드래그가 이미 임계값을 넘었는지도 함께 봅니다.

### 검증

스모크 테스트가 `sendInputEvent`로 실제 드래그를 주입해 히스토리 인덱스 변화를 확인합니다. 두 가지 주의점이 있습니다:

- **URL로 판정하면 안 됩니다.** YouTube는 여러 경로를 `/`로 되돌리기 때문에 서로 다른 두 목적지가 같은 주소를 가질 수 있고, 그러면 성공한 이동이 아무 일도 없던 것처럼 보입니다. `navigationHistory.getActiveIndex()`로 판정합니다.
- **주입 입력은 화면에 있는 창에만 전달됩니다.** 헤드리스 실행이라도 이 검사 동안에는 창을 잠깐 띄웁니다.

## 5. 영상 회전

`R` 키로 90도씩 돌립니다. 기하 계산은 [`rotation.js`](src/main/rotation.js)에 있고, 프리로드는 측정과 적용만 합니다.

90도로 돌리면 영상이 차지하는 박스의 가로·세로가 바뀝니다. `fitScale()`은 `min(컨테이너W / 박스H, 컨테이너H / 박스W)` — 양쪽에 다 들어가는 최대 배율을 돌려줍니다.

### ⚠️ 배율은 확대도 허용해야 한다

초기 버전은 "이미 들어맞는 영상을 확대하지 않는다"는 이유로 `1`을 상한으로 뒀습니다. 하필 이 기능이 필요한 바로 그 상황에서 틀린 판단이었습니다. **세로 모니터 전체화면**에서 16:9 영상은 1080×607로 배치되고, 눕히면 1080×1920 화면에서 607×1080만 차지합니다. 상한이 있으면 빈 화면 한가운데 작게 남고, 없으면 1.78배로 확대되어 세로를 꽉 채웁니다.

video 요소는 항상 플레이어에 맞춰 배치되므로, 컨테이너까지 다시 키우는 건 없던 크기를 만드는 게 아니라 원래 크기를 되돌리는 것입니다.

### ⚠️ 회전 요청을 직렬화할 것

회전 한 번은 메인 프로세스 왕복이고, 그 사이에 리사이즈가 끼어들 수 있습니다. 두 호출이 겹치면 서로 상대가 쓰기 전의 `rotationAngle`을 읽어 90도가 통째로 사라집니다.

리사이즈 관찰자를 추가한 것만으로 이 문제가 터졌습니다 — `observe()`가 즉시 한 번 발화하기 때문에 첫 키 입력과 경합했고, 세 번 눌렀는데 270도가 아니라 180도가 됐습니다. 프라미스 체인으로 순서를 보장합니다.

### ⚠️ 샌드박스 프리로드는 앱 파일을 `require`할 수 없다

`electron`과 소수의 내장 모듈만 쓸 수 있습니다. `require('../main/rotation')`은 예외를 던지고, **그 뒤에 등록되는 모든 리스너가 통째로 사라집니다.** 처음 시도에서 마우스 제스처까지 조용히 죽었고, 그 위의 userAgentData 패치는 멀쩡히 동작한 덕에 실패 지점을 특정할 수 있었습니다.

그래서 프리로드가 IPC(`ytd:rotate`)로 메인 프로세스에 계산을 요청합니다. 한 단계 우회하지만, 테스트된 구현 하나만 존재하고 프리로드 사본이 따로 놀 일이 없습니다.

### ⚠️ `getBoundingClientRect()` 대신 레이아웃 크기로 측정할 것

바운딩 렉트는 **이미 적용된 transform이 반영된 값**입니다. 회전된 영상을 측정하면 축소된 박스가 나오고, 그 값을 다시 넣으면 — 회전 상태에서 창 크기가 바뀔 때마다 그렇게 됩니다 — 축소가 누적되어 영상이 사라집니다.

영상은 `offsetWidth`/`offsetHeight`, 플레이어는 `clientWidth`/`clientHeight`를 씁니다. 둘 다 레이아웃 값이라 transform의 영향을 받지 않습니다. (ImprovedTube 확장이 같은 기능에서 `clientWidth`를 쓰는 이유이기도 합니다.)

### 스타일 규칙으로 적용

transform은 `video.style.transform`이 아니라 `<style>` 요소에 넣습니다. YouTube는 플레이어 크기가 바뀔 때 video의 `style` 속성을 다시 쓰고, 이동 시에는 요소 자체를 갈아끼웁니다. 어느 쪽이든 인라인 transform은 날아가지만 규칙은 계속 적용됩니다.

### 검증

스모크 테스트가 `<video>`를 넣고 실제 `R` 키를 보내 90도·270도·복귀를 확인합니다. 이어서 회전 상태에서 플레이어 크기를 바꿔 배율이 새 치수로 다시 계산되는지 검사합니다 — 바운딩 렉트가 다시 끼어들면 이 항목이 깨집니다.

## 6. 아이콘

이미지 도구 없이 [`tools/make-icon.js`](tools/make-icon.js)가 생성합니다. 픽셀을 직접 계산해 그리고, Node의 `zlib`만으로 PNG를 인코딩한 뒤 ICO 컨테이너로 조립합니다 (Vista 이후 ICO는 PNG 프레임을 그대로 담을 수 있어 BMP/AND 마스크가 필요 없습니다).

- 16 / 24 / 32 / 48 / 64 / 128 / 256px — 작업표시줄·탐색기·알트탭이 각기 다른 크기를 씁니다
- 4×4 슈퍼샘플링으로 라운드 모서리와 삼각형 안티앨리어싱

디자인은 빨간 라운드 사각형 + 흰 재생 삼각형입니다. YouTube 로고는 상표라 복제하지 않고 일반적인 재생 버튼 형태로 만들었습니다.

**256px는 크기 필드에 `0`으로 저장해야 합니다.** 그 필드가 1바이트라 256이 들어가지 않으며, 그냥 256을 쓰면 Windows가 가장 큰 아이콘을 0픽셀로 읽습니다. 테스트로 고정해 뒀습니다.

색이나 모양을 바꾸려면 `RED` 상수와 도형 함수를 고친 뒤 `npm run icon`으로 재생성합니다.

## 7. 진단

### 로그

`%APPDATA%\YouTube Desktop\ytd.log`에 이동 경로와 차단된 홉이 남습니다. 쿼리스트링은 토큰이 들어있어 기록하지 않습니다.

`did-start-navigation`은 **same-document 이동(히스토리 갱신)에서도 발생합니다.** 폴링하는 페이지는 이걸 초당 여러 번 뿜어내므로, 그대로 세면 정상적인 대기를 리다이렉트 루프로 오판하게 됩니다. 로그에서는 `same-doc`으로 따로 표시하고 루프 판정에서 제외합니다.

### 추적 모드

```bash
npx electron . --trace
```

Google 서버 응답(상태코드·리다이렉트 대상·쿠키 개수)과 패스키 호출의 시작·결과를 남깁니다. 헤더 값은 세션 토큰이라 개수만 셉니다.

`navigator.credentials`를 감싸므로 진단할 때만 켜세요 — 로그인 페이지는 그런 변형을 가장 민감하게 봅니다.

### 로그인 프로브

```bash
npm run probe
```

Chrome / Edge / Firefox / Electron 프로파일별로 임시 세션에서 로그인 페이지를 열어 차단 여부를 판정합니다. 자격 증명은 입력하지 않으며, 진단 창에서는 패스키 요청을 막아 Windows Hello 창이 뜨지 않게 합니다.

## 8. 보안

### 유지해야 할 것

| 설정 | 값 | 이유 |
| --- | --- | --- |
| `nodeIntegration` | `false` | 원격 페이지에 Node를 주지 않음 |
| `contextIsolation` | `true` | 페이지가 프리로드 객체를 만지지 못함 |
| `sandbox` | `true` | 렌더러 OS 샌드박스 |
| `webviewTag` | `false` | 정책을 우회하는 임베딩 차단 |
| `webSecurity` | 기본값 | **끄지 말 것** |
| 인증서 검증 | 기본값 | `certificate-error`를 재정의하지 않음 |
| 권한 핸들러 | 기본 거부 | `fullscreen`·`clipboard-sanitized-write`·`pointerLock`만 허용 |
| 장치 권한 | 전부 거부 | WebUSB/HID/시리얼·블루투스 |

### ⚠️ 렌더러에서 오는 것은 전부 위조 가능

프리로드는 **모든 프레임에 주입됩니다 — 광고 iframe 포함.** 페이지는 `dispatchEvent(new MouseEvent('mousedown', { button: 2 }))`로 제스처 전체를 위조할 수 있습니다. 실제로 초기 구현에서 이 방법으로 뒤로 가기가 발동했습니다.

두 겹으로 막습니다:

- 프리로드가 `event.isTrusted`를 확인합니다 — 스크립트가 만든 이벤트는 `false`
- `ipcMain` 핸들러가 **최상위 프레임에서 온 것만** 받습니다 (`event.senderFrame !== event.sender.mainFrame`이면 무시)

`resolveGesture`도 IPC 페이로드를 신뢰하지 않고 `NaN`·`Infinity`·비숫자를 걸러냅니다. IPC 채널을 추가할 때 같은 가정을 유지하세요.

### DLL 로드는 절대 경로로

`koffi.load('dwmapi.dll')`처럼 이름만 주면 DLL 검색 순서를 타는데, **실행 파일 디렉터리가 System32보다 먼저** 조회됩니다. 앱 폴더에 파일을 떨어뜨릴 수 있는 무언가가 코드 실행을 얻습니다. `%SystemRoot%\System32\dwmapi.dll` 절대 경로로 로드합니다.

### 호스트 비교 전 정규화

`parseUrl()`이 후행 점을 제거합니다. `mail.google.com.`은 같은 서버로 해석되지만 문자열이 달라, 정규화하지 않으면 모든 호스트 검사를 그냥 통과합니다.

`URL.hostname`을 쓰므로 `https://accounts.google.com@evil.example/` 같은 자격 증명 트릭은 자동으로 처리됩니다 — **원본 문자열을 직접 비교하지 마세요.**

### 로그

`safeUrl()`이 쿼리스트링을 버립니다 (인증 토큰이 들어있음). `--trace`도 헤더 값 대신 개수만 셉니다.

다만 페이지 콘솔 메시지는 300자까지 그대로 기록됩니다. 페이지가 무엇을 로깅할지 우리가 통제할 수 없으므로, 로그 파일은 민감할 수 있다고 가정하세요.

### 남은 위험

- **코드 서명 없음.** SmartScreen 경고가 뜨고, 배포본 위변조를 사용자가 검증할 방법이 없습니다.
- **자동 업데이트 없음.** Chromium 보안 패치가 자동으로 오지 않습니다. Electron을 올리고 다시 빌드해야 합니다.
- **세션 핸드오프 예외가 넓습니다.** 모든 Google 호스트의 `/accounts/` 경로가 쿠키와 함께 앱 안에서 열립니다. 좁히려면 `isSessionHandoff`를 실제 체인에 쓰이는 호스트로 제한하세요.
- **`pay.google.com` / `play.google.com` iframe**은 계정 세션을 갖습니다. 결제 기능을 위한 의도적 예외입니다.

## 9. 패키징

`files`에 패턴을 직접 지정하면 electron-builder가 `node_modules`를 **제외합니다.** 명시하지 않으면 koffi가 빠져 배포본에서만 타이틀바가 조용히 실패합니다.

네이티브 모듈(`koffi.node`)은 asar 안에서 로드할 수 없어 `app.asar.unpacked`로 추출되어야 합니다. electron-builder가 자동으로 처리하지만, 빌드 후 확인해 두면 좋습니다:

```bash
ls "dist/win-unpacked/resources/app.asar.unpacked/node_modules/@koromix/koffi-win32-x64/win32_x64/"
```

패키징된 실행 파일로도 자가 점검을 돌릴 수 있습니다:

```bash
"./dist/win-unpacked/YouTube Desktop.exe" --smoke-test
```

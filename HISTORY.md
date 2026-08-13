# 개발 히스토리 (로컬 재개용)

이 문서는 **다음에 이 프로젝트를 다시 열었을 때 빠르게 맥락을 되찾기 위한 것**입니다. GitHub에 코드와 릴리스는 이미 올라가 있으니, 여기서는 코드가 말해주지 않는 것 — 어떤 순서로 무엇을 시도했고, 왜 그 방향으로 갔고, 무엇이 남았는지 — 을 남깁니다.

`README.md`(사용자용), `DEVELOPMENT.md`(구조와 설계 이유)는 항상 최신 상태이니 먼저 그쪽을 보세요. 이 문서는 그 둘을 보완하는 타임라인입니다.

- 저장소: https://github.com/sallyHADEV/youtube-desktop
- 현재 버전: **1.1.1** (`package.json`)
- 최근 커밋: `0b067d2 Fill the screen when rotating on a portrait display`

## 한눈에 보는 흐름

```
목표 설정 (구글 로그인 + 세션 유지 + 패스키, 유튜브 외 구글 서비스 차단)
  → 기본 골격 (Electron, 도메인 정책, 세션, 네비게이션 가드, 스모크 테스트)
  → 로그인 실패: "안전하지 않은 브라우저" ─┐
      Chrome 위장 시도 → 틀림                │  여기가 가장 오래 걸린 구간
      UA 되돌리기(문서 단위 신원) → 부분 성공  │  (아래 "로그인 삽질기" 참고)
      리다이렉트 도중 UA 전환 → ERR_ABORTED    │
      webContents.userAgent 완전 제거 → 해결  ┘
  → UI 다듬기 (다크모드, 타이틀바, 아이콘)
  → 팝업이 세션을 안 물려받는 버그 발견/수정
  → 마우스 제스처 (뒤/앞/닫기)
  → 보안 검토 (isTrusted, DLL 경로, 호스트 정규화)
  → GitHub 공개 + 영문 문서 분리 + 릴리스 v1.0.0
  → 영상 회전 기능 (R 키) — 세로 모니터 버그 발견/수정 → v1.1.0 → v1.1.1
```

## 버전별 요약

| 버전 | 날짜 | 핵심 변경 | 커밋 |
| --- | --- | --- | --- |
| v1.0.0 | 2026-08-05 | 최초 공개: 로그인/세션/차단/다크모드/제스처/보안 하드닝 | `caf66c8` |
| v1.1.0 | 2026-08-06 | `R` 키 영상 회전 기능 | `76e4a61` |
| v1.1.1 | 2026-08-06 | 세로 모니터에서 회전 시 화면을 못 채우던 버그 수정 | `0b067d2` |

## 로그인 삽질기 (가장 중요한 배경지식)

**목표**: Google 계정으로 로그인(패스키 포함)하되, Electron이라는 게 티 나면 Google이 "이 브라우저는 안전하지 않을 수 있습니다"로 막는다.

**최종 결론**: Google이 실제로 차단하는 건 "Electron"이라는 단어가 아니라 **"Chrome이라 주장하면서 Chrome 무결성 검사를 통과 못 하는 클라이언트"**다. 그래서 로그인 페이지에서는 정직하게 Electron이라고 밝혀야 오히려 통과한다. (`th-ch/youtube-music`도 같은 이유로 `accounts.google.com`에서 원래 UA로 되돌림.)

**틀렸던 시도들** (순서대로):

1. **Chrome UA로 완전히 위장** → 패스키 인증까지는 되는데 최종 로그인이 거부됨. "Chrome이라 주장 + 무결성 검사 실패"가 원인이었음.
2. **URL 기준으로 로그인 페이지만 Electron UA로 전환** → 로그인 페이지가 부르는 하위 리소스(gstatic 등)는 여전히 Chrome이라 주장 → 한 문서 안에서 모순 발생. **문서 단위**(요청을 보낸 프레임의 URL 기준)로 판정하도록 수정해서 해결.
3. **`webContents.userAgent`를 직접 대입해서 전환** → 로그인의 마지막 단계는 `accounts.google.com → accounts.youtube.com` 리다이렉트인데, **리다이렉트 진행 중에 UA를 바꾸면 Chromium이 그 내비게이션을 `ERR_ABORTED`로 취소함**. Google은 패스키를 이미 수락한 뒤(쿠키 15개 발급)였는데 마지막 홉만 죽어서 `challenge/pk`로 되돌아가 무한 반복. 증상은 "인증은 됐는데 화면이 멈추고 깜빡임"이고, **차단 로그에는 아무것도 안 남아서 원인 찾기가 특히 어려웠음**.
4. **최종 해결**: 신원 전환을 **`onBeforeSendHeaders`(요청 헤더)에서만** 하고 `webContents.userAgent`는 절대 건드리지 않음. `navigator.userAgent`는 모든 페이지에서 Chrome으로 보이게 두고(JS 자기모순 방지를 위해 `userAgentData`도 항상 Chrome으로 패치), 서버로 나가는 실제 헤더만 문서별로 Electron/Chrome을 가름.

이 교훈은 `DEVELOPMENT.md`의 "⚠️ 신원은 헤더로만 바꿀 것" 절에 자세히 있음. **다시 로그인 관련 코드를 만질 일이 있으면 반드시 그 절부터 읽을 것** — 같은 함정에 또 빠지기 쉬움.

부수적으로 발견한 것: Google 로그인 완료 후 세션 쿠키를 여러 도메인에 심는 리다이렉트 체인(`accounts.google.com → www.google.com/accounts/SetSID → accounts.youtube.com/accounts/SetSID`)이 있어서, `www.google.com`을 통째로 막으면 패스키는 성공해도 YouTube 세션이 안 심어짐. `/accounts/` 경로만 예외로 열어서 해결.

## 진단 도구를 왜 이렇게 많이 만들었는가

로그인 문제가 "차단 로그에 흔적이 안 남는" 종류라, 일반적인 로깅으로는 원인을 못 찾았다. 그래서 순서대로 계측을 추가했다:

1. `src/main/logger.js` — 이동 경로/차단 기록 (쿼리스트링 제외)
2. `--trace` 모드 — Google 서버 응답(상태코드/리다이렉트/쿠키 개수)까지 기록
3. `--trace-webauthn` — 패스키 호출 자체의 시작/성공/실패를 계측
4. same-document 내비게이션(히스토리 갱신)과 진짜 페이지 이동을 구분하는 로직 — 폴링하는 페이지를 "루프"로 오판하는 걸 방지

이 도구들은 지금도 `npm run probe`, `npx electron . --trace` 등으로 살아있다. **다음에 로그인이 또 깨지면 새로 만들지 말고 이것부터 켤 것.**

## UI/제스처 개발에서 배운 것

- **다크 타이틀바**: `nativeTheme.themeSource = 'dark'`만으로는 부족함. Windows의 "제목 표시줄에 강조색 표시" 설정이 켜져 있으면 포커스된 창의 타이틀바를 강제로 파란색으로 칠함. `koffi`로 `DwmSetWindowAttribute`를 직접 호출해서 해결했는데, **`S_OK` 반환값이 "적용됐다"를 보장하지 않음** — 창이 화면에 없거나 프레임을 다시 그릴 때마다 재적용 필요. `show`/`restore`/`focus`/`maximize`/`unmaximize` 이벤트마다 다시 호출하도록 함.

- **마우스 제스처 위조 가능성**: 프리로드는 광고 iframe을 포함한 모든 프레임에 주입되므로, 페이지가 `dispatchEvent(new MouseEvent(...))`로 제스처를 위조할 수 있었음 (실제로 재현됨). `event.isTrusted` 확인 + IPC 핸들러에서 최상위 프레임만 수락하도록 이중 방어.

- **팝업이 로그인 세션을 안 물려받던 버그**: Ctrl/Shift 클릭으로 연 창은 `webPreferences`를 상속하지 않음. `setWindowOpenHandler`에서 `overrideBrowserWindowOptions`로 명시적으로 넘겨야 함. 이걸 놓치면 "새 창에서만 로그아웃 상태로 보임"이라는 헷갈리는 버그가 생김.

- **영상 회전 (v1.1.0 → v1.1.1)**:
  - 샌드박스 프리로드는 앱 파일을 `require`할 수 없음 → 회전 기하 계산은 메인 프로세스에 두고 IPC(`ytd:rotate`)로 받음. (처음엔 이걸 모르고 `require`했다가 마우스 제스처까지 통째로 죽는 버그를 만듦 — 프리로드에서 예외가 나면 그 뒤 리스너 등록이 전부 스킵됨.)
  - `getBoundingClientRect()`는 이미 적용된 transform이 반영된 값이라, 회전 중 리사이즈 시 배율이 누적으로 잘못됨 → `offsetWidth`/`clientWidth` 같은 레이아웃 값으로 측정하도록 수정.
  - **배율 상한(`min(..., 1)`)이 세로 모니터 전체화면에서 화면을 못 채우는 버그의 원인**이었음. "이미 맞는 영상은 확대 안 함"이라는 원칙이 하필 이 기능의 핵심 사용처(세로 화면에서 가로 영상 회전)에서는 틀렸음. 상한 제거로 해결 (v1.1.1).
  - `ResizeObserver` 등록이 `observe()` 즉시 발화와 겹쳐 키 입력 회전과 경합하는 버그도 있었음 → 회전 요청을 프라미스 체인으로 직렬화해서 해결.

## 보안 검토에서 고친 것 (커밋 `caf66c8`에 포함)

1. 마우스 제스처가 스크립트로 위조 가능했음 → `isTrusted` + 최상위 프레임 검사
2. `koffi.load('dwmapi.dll')`이 이름만 줘서 DLL 검색 순서를 탐 (실행 파일 폴더가 System32보다 먼저 조회됨) → 절대 경로로 변경
3. 호스트 이름 뒤에 점을 붙이면(`mail.google.com.`) 모든 호스트 검사를 우회 → `parseUrl()`에서 정규화

하드코딩된 크리덴셜, 의존성 취약점은 없었음 (`npm audit` 0건).

## 코드 서명 관련 결정

개인 개발자가 한국에서 저비용으로 서명하는 방법(Azure Trusted Signing)은 **미국/캐나다 개인만 가능**해서 막힘. Certum 오픈소스 인증서(연 €29~69)는 가능하지만 초반엔 SmartScreen 평판이 없어 효과가 제한적. **당장은 서명 없이 배포하기로 결정** — 대신 릴리스에 SHA-256 체크섬을 첨부해 최소한의 무결성 검증 수단을 제공. 사업자등록을 하게 되면 Azure Trusted Signing으로 전환 고려.

## 파일 지도 (빠른 재탐색용)

```
src/main/
  policy.js            도메인 허용목록 판정 (순수 함수) — 차단 규칙 수정은 여기
  identity.js           URL(문서 단위)별 UA 신원 선택 — 로그인 문제 생기면 여기부터
  session.js            persist 파티션, 헤더 재작성 — onBeforeSendHeaders 필터링 포함
  navigation-guard.js    3중 차단 + 루프 방어 + 팝업 옵션
  gesture.js             마우스 제스처 판정 (순수 함수, toStrokes로 ㄴ자 인식)
  rotation.js            영상 회전 기하 계산 (순수 함수)
  windows-titlebar.js    DWM 타이틀바 색 (koffi)
  logger.js / index.js   진단 로깅, --trace, --trace-webauthn
  smoke-test.js          npm run smoke — 실제 로그인/차단/제스처/회전 전부 실행 검증
src/preload/index.js     userAgentData 패치, 제스처 캡처, 회전 키 캡처 (IPC로 위임)
tools/make-icon.js        빨간 재생버튼 아이콘 생성 (외부 도구 없음)
test/*.test.js             단위 테스트 (46개, 순수 함수 위주)
```

## 다음에 이어서 할 만한 것

- [ ] 코드 서명 (사업자등록 여부에 따라 Azure Trusted Signing 또는 Certum)
- [ ] 자동 업데이트 (현재 없음 — Chromium 보안 패치가 새 빌드로만 전달됨)
- [ ] macOS/Linux 지원 검토 (패스키는 Electron 자체 한계로 불가 — electron#24573 추적)
- [ ] 세션 핸드오프 예외(`/accounts/` 전체 허용)를 실제 사용되는 호스트로 좁히기 (`DEVELOPMENT.md` "잔여 위험" 참고)
- [ ] GitHub Actions로 태그 푸시 시 자동 빌드+릴리스

## 재개 시 체크리스트

```bash
cd <프로젝트 폴더>
git pull
npm.cmd install
npm.cmd test              # 46개 통과해야 정상
npm.cmd run smoke          # 실제 로그인/차단/제스처/회전 검증 (수동 상호작용 없음)
```

로그인 관련 코드를 만지기 전에 **DEVELOPMENT.md의 "⚠️ 신원은 헤더로만 바꿀 것" 절**과 이 문서의 "로그인 삽질기"를 먼저 읽을 것.

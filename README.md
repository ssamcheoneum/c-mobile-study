# C 모바일 학습 웹앱

이동 중 휴대폰으로 C언어를 학습하는 정적 웹앱. 프레임워크·번들러·npm 의존성 없이
바닐라 HTML/CSS/JS(ES Modules)로만 만든다. 상세 명세는 [SPEC.md](SPEC.md).

## 로컬 실행

`file://` 로 열면 ES Modules와 `fetch()` 가 CORS로 막히므로 반드시 로컬 서버를 쓴다.

```bash
python3 -m http.server 8000
```

Windows에서는 `python -m http.server 8000`.

브라우저에서 <http://localhost:8000> 접속. 폰 화면으로 확인하려면 개발자도구의
디바이스 툴바를 **390 × 844** 로 맞춘다.

같은 와이파이의 실제 폰에서 열려면 PC의 로컬 IP를 확인해 `http://<PC_IP>:8000` 으로 접속한다.
단, 이 주소는 보안 컨텍스트가 아니라서 **서비스 워커(오프라인)와 클립보드 API가 동작하지 않는다.**
폰에서 오프라인 동작까지 확인하려면 아래 GitHub Pages 배포 후 https 주소로 접속해야 한다.

> ⚠ **개발 중 캐시 주의**
> `python -m http.server` 는 캐시 헤더를 보내지 않아 브라우저가 수정된 `.js`/`.css` 를
> 계속 재사용할 수 있다. 변경이 반영되지 않으면 개발자도구 Network 탭의
> **Disable cache** 를 켜거나 강제 새로고침(Ctrl+Shift+R)한다.
> 서비스 워커가 등록된 상태라면 **`sw.js` 의 `CACHE_VERSION` 을 올려야** 새 코드가 나간다.

## 콘텐츠 검증

콘텐츠를 추가·수정한 뒤에는 반드시 스키마 검증기를 돌린다. 실패하면 종료 코드 1.

```bash
node tools/validate.js
```

검사 항목: 필수 필드 누락, 미지원 블록/퀴즈 타입, `answer` 인덱스 범위 초과,
중복 `qid`·섹션 id, `tip.tone` 오탈자, 표의 열 수 불일치,
`status:"ready"` 인데 내용이 빈 단원.

PWA 아이콘을 다시 만들려면 `python tools/make-icons.py`.

## 배포 (GitHub Pages)

모든 경로가 상대경로(`./js/app.js`)라 서브디렉터리 배포에서도 깨지지 않는다.

1. GitHub에 저장소를 만들고 이 폴더 전체를 `main` 브랜치에 푸시한다.
2. 저장소 **Settings → Pages** 에서 Source를 **Deploy from a branch**,
   Branch를 **main / (root)** 로 지정한다.
3. 1~2분 뒤 `https://<사용자명>.github.io/<저장소명>/` 에서 열린다.

앱 코드를 수정해 다시 배포할 때는 **`sw.js` 의 `CACHE_VERSION` 을 올린다**
(`'v1'` → `'v2'`). 올리지 않으면 이미 설치된 기기에 예전 코드가 계속 남는다.

## 홈 화면에 추가 (앱처럼 쓰기)

배포한 https 주소를 폰에서 연 다음:

- **iPhone (Safari)** — 하단 공유 버튼 → **홈 화면에 추가** → 추가.
  ※ Chrome이 아니라 **Safari** 로 열어야 한다.
- **Android (Chrome)** — 우측 상단 ⋮ → **홈 화면에 추가** / **앱 설치**.

추가하면 주소창 없는 전체 화면으로 실행되고, 한 번 열어본 단원은
**비행기 모드에서도** 그대로 열린다. 아직 열어본 적 없는 단원은
오프라인에서 "오프라인 상태입니다" 안내와 재시도 버튼이 나온다.

## 캐시 전략

| 대상 | 정책 | 이유 |
|---|---|---|
| 앱 셸 (html/css/js/아이콘) | 캐시 우선 | 즉시 실행. 갱신은 `CACHE_VERSION` 으로 통제 |
| `content/*.json` | 네트워크 우선 → 실패 시 캐시 | 콘텐츠 수정이 바로 반영되면서 오프라인도 지원 |
| 화면 이동(navigate) | 네트워크 → 실패 시 `index.html` | 해시 라우팅이라 문서는 하나 |

## 폴더 구조

```
index.html              앱 셸 (단일 페이지, 해시 라우팅)
manifest.webmanifest    PWA 매니페스트
sw.js                   서비스 워커 (앱 셸 캐시 우선 / 콘텐츠 네트워크 우선)
css/style.css           디자인 토큰 + 전체 스타일
js/                     app / router / store / loader / render / quiz / review
content/                index.json, ch01~ch10.json, glossary.json, errors.json
icons/                  PWA 아이콘 192 / 512 / maskable
tools/                  validate.js (스키마 검증), make-icons.py (아이콘 생성)
```

## 콘텐츠 현황

10단원 전부 `ready`. 섹션 49개 · 블록 397개 · 퀴즈 158문항 ·
"자주 하는 실수" 팁 72개 · 용어 53개 · 컴파일 에러 사전 37개.

콘텐츠를 고친 뒤에는 `node tools/validate.js` 를 반드시 돌린다.

## 진행 상황

- [x] Stage 0 — 리포 골격 + 스키마 확정 (`ch01` 샘플 콘텐츠)
- [x] Stage 1 — 앱 셸 + 라우터 + 홈
- [x] Stage 2 — 단원 허브 + 요약 탭 + 콘텐츠 로더
- [x] Stage 3 — 개념 탭 + 블록 렌더러
- [x] Stage 4 — 퀴즈 엔진
- [x] Stage 5 — 오답노트 + 복습 큐
- [x] Stage 6 — 기타 탭 + 용어사전
- [x] Stage 7 — PWA (배포는 사용자 GitHub 계정 필요)
- [x] Stage 8 — 콘텐츠 채우기 (ch01~ch10 전 단원 `ready`)

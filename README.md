# C 모바일 학습 웹앱

**배포 주소 → https://ssamcheoneum.github.io/c-mobile-study/**

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

### 코드 정답 실행 검증

`predict` 블록과 `output` 문항에 적힌 "출력 결과"를 **실제로 컴파일·실행해** 대조한다.

```bash
node tools/verify-c.js
```

`gcc` / `clang` / Visual Studio(`cl.exe`) 중 찾은 것을 쓴다. 하나도 없으면 종료 코드 2.
불일치가 있으면 종료 코드 1. 상세 결과가 필요하면 `--report FILE`, 단원 하나만 보려면 `--only ch06`.

조각 코드라 그대로 실행할 수 없는 문항(파일이 필요하거나 가상의 주소를 전제하는 등)은
`tools/verify-fixtures.json` 에 보조 장치를 둔다. **콘텐츠(`content/*.json`)는 건드리지 않는다.**
픽스처가 없어 실행에 실패한 문항은 조용히 넘어가지 않고 실패로 드러난다.

PWA 아이콘을 다시 만들려면 `python tools/make-icons.py`.

## 배포 (GitHub Pages)

모든 경로가 상대경로(`./js/app.js`)라 서브디렉터리 배포에서도 깨지지 않는다.

배포 완료 상태다. 저장소는 `ssamcheoneum/c-mobile-study` (public),
Pages Source는 **main / (root)**.

수정한 내용을 다시 배포하려면:

```bash
git add -A
git commit -m "내용 수정"
git push
```

푸시하면 1~2분 뒤 자동으로 반영된다. 빌드 상태는
저장소 **Actions** 탭 또는 **Settings → Pages** 에서 확인한다.

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

## 복습 큐가 도는 방식

| 어떻게 들어오나 | streak | 첫 노출 | 정복까지 |
|---|---|---|---|
| 단원 퀴즈에서 **틀림** | 0 | 다음 날 | 1→3→7→17일, **5회** |
| 단원 퀴즈에서 **처음 만나 맞힘** | 3 | **7일 뒤** | 17일, **2회** |

이미 큐에 있거나 오답 이력이 있는 문항은 다시 진입시키지 않는다. 우연히 맞힌 것으로
진행 중인 간격이 앞당겨지거나, 정복한 문항이 되살아나는 것을 막기 위해서다.

간격 진행(streak 증가)은 **복습 화면에서만** 일어난다. 단원 퀴즈에서 맞힌 것은
큐에 처음 넣을 때만 쓰이고 이후 주기를 건너뛰지 않는다.

## 학습 데이터 백업 / 복원

진도·오답·복습 큐·설정은 **기기 안에만** 저장된다(localStorage). 기기를 바꾸거나
앱을 지웠다 다시 설치하면 사라지므로, 홈 화면 맨 아래 **설정 → 학습 데이터** 에서
백업해 둘 수 있다.

- **내보내기** — 공유 시트 → 파일 다운로드 → 클립보드 순으로 되는 방법을 쓴다.
  `cstudy-backup-YYYY-MM-DD.json` 파일 하나로 나온다(가장 커도 20KB 남짓).
- **가져오기** — 파일을 고르거나 백업 내용을 붙여넣는다. **현재 데이터를 덮어쓴다.**
  적용 전에 무엇이 들어오고 무엇이 사라지는지 확인 대화상자로 보여주고,
  적용 직후에는 **되돌리기** 버튼이 뜬다(새로고침하면 사라진다).

우리 형식이 아니거나 값의 모양이 깨진 파일은 **거부하고 기존 데이터를 건드리지 않는다.**

> 홈 화면에 추가한 PWA 는 Safari 의 7일 저장소 삭제 대상이 아니다
> ([WebKit 공지](https://webkit.org/blog/10218/full-third-party-cookie-blocking-and-more/)).
> 다만 기기 교체·앱 삭제·브라우저 데이터 지우기로는 사라지므로 가끔 백업해 두는 편이 좋다.

## 보안 · 접근성 기준

- **CSP** — 외부 리소스를 하나도 쓰지 않으므로 `default-src 'self'` 로 전부 잠갔다.
  GitHub Pages 는 HTTP 헤더를 붙일 수 없어 `index.html` 의 `<meta http-equiv>` 로 선언한다
  (meta 에서는 `frame-ancestors`·`sandbox` 가 무시되므로 넣지 않았다).
  스크립트·스타일은 전부 외부 파일이고, 인라인 `style` 속성도 쓰지 않는다.
  값을 바꾸는 곳은 `element.style` / `setProperty` 같은 CSSOM 이라 CSP 에 걸리지 않는다.
- **XSS** — `innerHTML` · `eval` · 외부 리소스 0건. 모든 콘텐츠는 `textContent` 로만 들어간다.
- **색 대비** — 본문·보조·강조·코드 전부 WCAG AA(4.5:1) 통과.
  입력칸과 버튼의 경계는 `--line-strong` 으로 배경 대비 3:1 이상을 지킨다(WCAG 1.4.11).
  장식용 구분선은 `--line` 을 그대로 쓴다.

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
"자주 하는 실수" 팁 72개 · 용어 113개 · 컴파일 에러 사전 37개.

콘텐츠를 고친 뒤에는 `node tools/validate.js` 와 `node tools/verify-c.js` 를 반드시 돌린다.
출력 결과가 적힌 문항 98건(predict 45 + output 53)은 전부 실행으로 검증된 상태다.

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

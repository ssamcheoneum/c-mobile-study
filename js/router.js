// router.js — 해시 라우팅. 알 수 없는 경로는 홈으로 되돌린다.
// §5.3: 스크롤 위치는 라우트별로 기억했다가 뒤로가기 시 복원한다.

export const TABS = ['summary', 'concept', 'quiz', 'extra'];

const CH_ID = /^ch\d{2}$/;

/**
 * 해시 문자열 → 라우트 객체. 해석할 수 없으면 null.
 * @returns {{name:string, params:object}|null}
 */
export function parseHash(hash) {
  const raw = String(hash || '').replace(/^#/, '');
  const parts = raw.split('/').filter(Boolean).map(decodeURIComponent);

  if (parts.length === 0) return { name: 'home', params: {} };

  if (parts[0] === 'ch' && CH_ID.test(parts[1] || '')) {
    const chId = parts[1];
    // #/ch/ch06
    if (parts.length === 2) return { name: 'chapter', params: { chId, tab: 'summary' } };
    // #/ch/ch06/quiz
    if (parts.length === 3 && TABS.includes(parts[2])) {
      return { name: 'chapter', params: { chId, tab: parts[2] } };
    }
    // #/ch/ch06/concept/6-1
    if (parts.length === 4 && parts[2] === 'concept') {
      return { name: 'section', params: { chId, tab: 'concept', sectionId: parts[3] } };
    }
    return null;
  }

  if (parts.length === 1 && ['review', 'wrong', 'glossary'].includes(parts[0])) {
    return { name: parts[0], params: {} };
  }

  return null;
}

/** 라우트 객체 → 해시 문자열. */
export function hashFor(name, params = {}) {
  switch (name) {
    case 'home': return '#/';
    case 'chapter': return `#/ch/${params.chId}${params.tab && params.tab !== 'summary' ? '/' + params.tab : ''}`;
    case 'section': return `#/ch/${params.chId}/concept/${encodeURIComponent(params.sectionId)}`;
    default: return `#/${name}`;
  }
}

export function navigate(hash, { replace = false } = {}) {
  const target = hash.startsWith('#') ? hash : '#' + hash;
  if (replace) location.replace(location.pathname + location.search + target);
  else location.hash = target;
}

/* ── 스크롤 기억/복원 ─────────────────────────────────── */

const scrollByEntry = new Map();
let seq = 0;
let currentIdx = null;

function stampEntry() {
  // 새 히스토리 항목에는 일련번호를 찍고, 이미 찍힌 항목이면 그 번호를 그대로 쓴다.
  const state = history.state;
  if (state && typeof state.cstudyIdx === 'number') return { idx: state.cstudyIdx, isNew: false };
  const idx = ++seq;
  try {
    history.replaceState({ ...(state || {}), cstudyIdx: idx }, '');
  } catch { /* 파일 프로토콜 등에서 실패할 수 있으나 라우팅 자체에는 지장 없다 */ }
  return { idx, isNew: true };
}

function saveScroll() {
  if (currentIdx !== null) scrollByEntry.set(currentIdx, window.scrollY);
}

/**
 * 라우팅을 시작한다. 경로가 바뀔 때마다 onRoute(route)가 호출된다.
 * onRoute가 Promise를 돌려주면 렌더가 끝난 뒤에 스크롤을 복원한다.
 */
export function start(onRoute) {
  if ('scrollRestoration' in history) history.scrollRestoration = 'manual';

  async function handle() {
    saveScroll();

    let route = parseHash(location.hash);
    if (!route) {
      console.warn('[router] 알 수 없는 경로 →  홈으로 이동:', location.hash);
      navigate('#/', { replace: true });
      route = { name: 'home', params: {} };
    }

    const { idx, isNew } = stampEntry();
    currentIdx = idx;

    await onRoute(route);

    // 새 화면은 맨 위에서, 되돌아온 화면은 원래 보던 위치에서 시작한다.
    const y = isNew ? 0 : (scrollByEntry.get(idx) || 0);
    window.scrollTo(0, y);
  }

  window.addEventListener('hashchange', handle);
  // 진입 시 해시가 없으면 홈으로 정규화
  if (!location.hash) navigate('#/', { replace: true });
  return handle();
}

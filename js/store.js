// store.js — localStorage 래퍼. §3.3의 4개 키만 다룬다.
// 규칙: 앱의 다른 곳에서는 localStorage를 직접 만지지 않는다.
//       JSON 파싱 실패·형식 오류 시 기본값으로 복구하고 절대 예외를 던지지 않는다.

export const KEYS = {
  progress: 'cstudy:progress',
  wrong: 'cstudy:wrong',
  queue: 'cstudy:queue',
  settings: 'cstudy:settings'
};

const THEMES = ['auto', 'light', 'dark'];
const FONT_SCALES = [0.9, 1, 1.15];

const isPlainObject = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);

// 키별 기본값 생성기 + 형식 검사기
const SHAPES = {
  [KEYS.progress]: { fallback: () => ({}), ok: isPlainObject },
  [KEYS.wrong]: { fallback: () => [], ok: Array.isArray },
  [KEYS.queue]: { fallback: () => ({}), ok: isPlainObject },
  [KEYS.settings]: { fallback: () => ({ theme: 'auto', fontScale: 1 }), ok: isPlainObject }
};

function read(key) {
  const shape = SHAPES[key];
  try {
    const raw = localStorage.getItem(key);
    if (raw === null) return shape.fallback();
    const parsed = JSON.parse(raw);
    if (!shape.ok(parsed)) throw new Error('형식 불일치');
    return parsed;
  } catch (err) {
    console.warn(`[store] ${key} 복구 — 기본값으로 되돌립니다.`, err);
    write(key, shape.fallback());
    return shape.fallback();
  }
}

function write(key, value) {
  try {
    localStorage.setItem(key, JSON.stringify(value));
    return true;
  } catch (err) {
    // 사파리 프라이빗 모드 / 용량 초과 등. 저장만 실패하고 앱은 계속 돈다.
    console.warn(`[store] ${key} 저장 실패`, err);
    return false;
  }
}

/* ── 진도 ─────────────────────────────────────────────── */

export const getProgress = () => read(KEYS.progress);

export function getChapterProgress(chId) {
  const rec = getProgress()[chId];
  if (!isPlainObject(rec)) return { sectionsRead: [], quizBest: null, lastAt: null };
  return {
    sectionsRead: Array.isArray(rec.sectionsRead) ? rec.sectionsRead : [],
    quizBest: typeof rec.quizBest === 'number' ? rec.quizBest : null,
    lastAt: typeof rec.lastAt === 'number' ? rec.lastAt : null
  };
}

export function updateChapterProgress(chId, patch) {
  const all = getProgress();
  const next = { ...getChapterProgress(chId), ...patch, lastAt: Date.now() };
  all[chId] = next;
  write(KEYS.progress, all);
  return next;
}

/* ── 오답 / 복습 큐 ───────────────────────────────────── */

export const getWrong = () => read(KEYS.wrong);
export const setWrong = (list) => write(KEYS.wrong, Array.isArray(list) ? list : []);

export const getQueue = () => read(KEYS.queue);
export const setQueue = (queue) => write(KEYS.queue, isPlainObject(queue) ? queue : {});

/* ── 설정 ─────────────────────────────────────────────── */

export function getSettings() {
  const raw = read(KEYS.settings);
  return {
    theme: THEMES.includes(raw.theme) ? raw.theme : 'auto',
    fontScale: FONT_SCALES.includes(raw.fontScale) ? raw.fontScale : 1
  };
}

export function setSettings(patch) {
  const next = { ...getSettings(), ...patch };
  const safe = {
    theme: THEMES.includes(next.theme) ? next.theme : 'auto',
    fontScale: FONT_SCALES.includes(next.fontScale) ? next.fontScale : 1
  };
  write(KEYS.settings, safe);
  return safe;
}

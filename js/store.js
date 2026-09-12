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

/* ── 내보내기 / 가져오기 (§9 "진도 데이터 JSON export/import") ──
   §3.3 의 4개 키를 그대로 묶었다 풀 뿐이다. 키가 늘거나 값의 모양이 바뀌지 않는다. */

export const EXPORT_FORMAT = 1;

/** 현재 학습 데이터 전체를 하나의 객체로 묶는다. */
export function exportAll() {
  return {
    app: 'cstudy',
    formatVersion: EXPORT_FORMAT,
    exportedAt: Date.now(),
    data: {
      [KEYS.progress]: read(KEYS.progress),
      [KEYS.wrong]: read(KEYS.wrong),
      [KEYS.queue]: read(KEYS.queue),
      [KEYS.settings]: getSettings()
    }
  };
}

/** 묶음이 우리 형식인지, 값의 모양이 맞는지 검사한다. 쓰기는 하지 않는다. */
export function inspectBundle(bundle) {
  if (!isPlainObject(bundle)) return { ok: false, error: '내용을 읽을 수 없습니다.' };
  if (bundle.app !== 'cstudy') return { ok: false, error: '이 앱의 백업 파일이 아닙니다.' };

  const ver = Number(bundle.formatVersion);
  if (!Number.isFinite(ver) || ver < 1) return { ok: false, error: '형식 번호가 없습니다.' };
  if (ver > EXPORT_FORMAT) {
    return { ok: false, error: `더 새로운 형식(v${ver})입니다. 앱을 새로고침해 주세요.` };
  }
  if (!isPlainObject(bundle.data)) return { ok: false, error: '데이터가 비어 있습니다.' };

  const found = {};
  for (const key of Object.values(KEYS)) {
    const value = bundle.data[key];
    if (value === undefined) continue;
    if (!SHAPES[key].ok(value)) return { ok: false, error: `${key} 의 형식이 올바르지 않습니다.` };
    found[key] = value;
  }
  if (!Object.keys(found).length) return { ok: false, error: '복원할 학습 데이터가 없습니다.' };

  const progress = found[KEYS.progress] || {};
  const wrong = found[KEYS.wrong] || [];
  const queue = found[KEYS.queue] || {};
  return {
    ok: true,
    values: found,
    exportedAt: typeof bundle.exportedAt === 'number' ? bundle.exportedAt : null,
    summary: {
      chapters: Object.keys(progress).length,
      wrong: wrong.filter((w) => w && w.cleared !== true).length,
      queue: Object.keys(queue).length
    }
  };
}

/**
 * 검사를 통과한 묶음으로 **덮어쓴다**. 되돌릴 수 있도록 직전 상태를 함께 돌려준다.
 * @returns {{ok:true, summary, undo:object}|{ok:false, error:string}}
 */
export function importAll(bundle) {
  const checked = inspectBundle(bundle);
  if (!checked.ok) return checked;

  const undo = exportAll(); // 덮어쓰기 직전 상태
  const written = [];

  for (const [key, value] of Object.entries(checked.values)) {
    if (write(key, value)) { written.push(key); continue; }

    // 일부만 써지면 진도와 오답이 어긋난 상태로 남는다. 되돌리고 실패를 알린다.
    // (프라이빗 브라우징·용량 초과처럼 저장 자체가 막힌 경우)
    for (const key2 of written) write(key2, undo.data[key2]);
    return {
      ok: false,
      error: '기기에 저장할 수 없어 복원을 취소했습니다. ' +
             '프라이빗 브라우징 중이거나 저장 공간이 부족한지 확인해 주세요.'
    };
  }
  return { ok: true, summary: checked.summary, exportedAt: checked.exportedAt, undo };
}

/** 지금 담고 있는 양(내보내기 버튼 옆에 보여줄 용도). */
export function dataSummary() {
  const progress = read(KEYS.progress);
  const wrong = read(KEYS.wrong);
  const queue = read(KEYS.queue);
  return {
    chapters: Object.keys(progress).length,
    wrong: wrong.filter((w) => w && w.cleared !== true).length,
    queue: Object.keys(queue).length
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

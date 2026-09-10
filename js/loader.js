// loader.js — 콘텐츠 JSON fetch + 메모리 캐시.
// 성공한 응답만 캐시한다. 같은 파일을 동시에 요청하면 진행 중인 요청을 재사용한다.

// GitHub Pages 서브디렉터리 배포에서도 깨지지 않도록 모듈 위치 기준 상대 경로만 쓴다.
const CONTENT_BASE = new URL('../content/', import.meta.url);

const cache = new Map();    // file -> data
const inflight = new Map(); // file -> Promise

/** 사용자에게 그대로 보여줄 수 있는 한국어 사유를 붙인 에러. */
function describe(err, file) {
  if (typeof navigator !== 'undefined' && navigator.onLine === false) {
    return new Error('오프라인 상태입니다. 연결을 확인한 뒤 다시 시도해 주세요.');
  }
  if (err instanceof SyntaxError) {
    return new Error(`${file} 형식이 올바르지 않습니다.`);
  }
  if (err && err.httpStatus) {
    return new Error(`${file} 을(를) 찾을 수 없습니다 (HTTP ${err.httpStatus}).`);
  }
  return new Error('콘텐츠를 불러오지 못했습니다. 잠시 후 다시 시도해 주세요.');
}

async function fetchJSON(file) {
  if (cache.has(file)) return cache.get(file);
  if (inflight.has(file)) return inflight.get(file);

  const task = (async () => {
    let res;
    try {
      res = await fetch(new URL(file, CONTENT_BASE));
    } catch (err) {
      throw describe(err, file);
    }
    if (!res.ok) {
      const err = new Error(`HTTP ${res.status}`);
      err.httpStatus = res.status;
      throw describe(err, file);
    }
    let data;
    try {
      data = await res.json();
    } catch (err) {
      throw describe(err, file);
    }
    cache.set(file, data);
    return data;
  })();

  inflight.set(file, task);
  try {
    return await task;
  } finally {
    inflight.delete(file); // 실패는 캐시하지 않는다 → 재시도가 실제로 다시 요청한다
  }
}

/** 단원 목록 메타(§3.1). */
export async function loadIndex() {
  const data = await fetchJSON('index.json');
  return {
    version: data.version || '0',
    chapters: Array.isArray(data.chapters) ? data.chapters : []
  };
}

/**
 * 단원 콘텐츠(§3.2). 스키마에서 벗어난 필드는 렌더러가 다루기 쉬운 형태로만 보정하고,
 * 값 자체는 바꾸지 않는다.
 */
export async function loadChapter(chId) {
  if (!/^ch\d{2}$/.test(chId)) throw new Error('올바르지 않은 단원 번호입니다.');
  const data = await fetchJSON(`${chId}.json`);
  const summary = data.summary && typeof data.summary === 'object' ? data.summary : {};
  return {
    id: data.id || chId,
    title: data.title || '',
    summary: {
      oneLiner: typeof summary.oneLiner === 'string' ? summary.oneLiner : '',
      bullets: Array.isArray(summary.bullets) ? summary.bullets : [],
      keywords: Array.isArray(summary.keywords) ? summary.keywords : []
    },
    preview: typeof data.preview === 'string' ? data.preview : '',
    sections: Array.isArray(data.sections) ? data.sections : [],
    quiz: Array.isArray(data.quiz) ? data.quiz : []
  };
}

/** 용어사전. 단원 콘텐츠와 독립된 보조 자료라 실패해도 앱 흐름을 막지 않는다. */
export async function loadGlossary() {
  const data = await fetchJSON('glossary.json');
  return Array.isArray(data.terms) ? data.terms : [];
}

/** 컴파일 에러 메시지 사전(§4.3-④). 없으면 빈 배열로 취급한다. */
export async function loadErrors() {
  try {
    const data = await fetchJSON('errors.json');
    return Array.isArray(data.errors) ? data.errors : [];
  } catch (err) {
    console.warn('[loader] errors.json 을 불러오지 못했습니다.', err);
    return [];
  }
}

/** 이미 받아둔 단원만 꺼낸다(네트워크 요청 없음). */
export const peekChapter = (chId) => cache.get(`${chId}.json`) || null;

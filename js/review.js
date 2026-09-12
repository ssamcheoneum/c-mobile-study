// review.js — 오답노트 레코드(cstudy:wrong) + 복습 큐(cstudy:queue) 규칙. §4.4
//
// 간격 규칙: 정답 시 다음 노출까지 streak 0→1일, 1→3일, 2→7일, 3→17일.
//            streak 4 이상에서 또 맞히면 큐에서 제거하고 오답노트를 cleared 처리한다.
//            오답이면 streak = 0, 다음 날 재등장.

import * as store from './store.js';

const DAY = 24 * 60 * 60 * 1000;

/** 현재 streak → 다음 노출까지의 일수 */
export const INTERVAL_DAYS = { 0: 1, 1: 3, 2: 7, 3: 17 };

/**
 * 처음 만난 문항을 단번에 맞혔을 때의 출발점.
 * 이미 세 번 맞힌 것과 동등하게 보아 앞쪽의 짧은 간격(1·3일)을 건너뛴다.
 * → 7일 뒤 한 번, 다시 17일 뒤 한 번 확인하고 정복 처리된다.
 */
export const FIRST_CORRECT_STREAK = 3;

/* ── 복습 큐 ──────────────────────────────────────────── */

/** 지금 복습할 차례가 된 항목들 */
export function dueEntries(now = Date.now()) {
  const queue = store.getQueue();
  return Object.entries(queue)
    .filter(([, e]) => e && typeof e.due === 'number' && e.due <= now)
    .map(([qid, e]) => ({ qid, due: e.due, streak: Number(e.streak) || 0 }))
    .sort((a, b) => a.due - b.due);
}

export const dueCount = (now = Date.now()) => dueEntries(now).length;

/** 큐 전체 크기(아직 때가 되지 않은 항목 포함) */
export const queueSize = () => Object.keys(store.getQueue()).length;

/* ── 오답노트 ─────────────────────────────────────────── */

/** 오답 기록 upsert (§3.3 cstudy:wrong) */
export function recordWrong(chId, qid) {
  const list = store.getWrong();
  const found = list.find((w) => w && w.qid === qid);
  if (found) {
    found.count = (Number(found.count) || 0) + 1;
    found.lastAt = Date.now();
    found.cleared = false;
    if (!found.chId) found.chId = chId;
  } else {
    list.push({ qid, chId, count: 1, lastAt: Date.now(), cleared: false });
  }
  store.setWrong(list);
}

/**
 * 정복 처리. 틀린 적 없이 정복한 문항(첫 시도 정답 → 확인 2회)은 기록이 없으므로
 * `count: 0` 인 표식을 남긴다. 이 표식이 있어야 단원 퀴즈를 다시 풀 때
 * 정복한 문항이 큐에 되살아나지 않는다.
 */
export function markCleared(qid) {
  const list = store.getWrong();
  const found = list.find((w) => w && w.qid === qid);
  if (found) {
    found.cleared = true;
  } else {
    const m = /^(ch\d{2})-/.exec(qid);
    list.push({ qid, chId: m ? m[1] : '', count: 0, lastAt: Date.now(), cleared: true });
  }
  store.setWrong(list);
}

// count 가 0 인 것은 "틀린 적 없이 정복함" 표식이라 오답노트의 어떤 집계에도 넣지 않는다.
const isRealWrong = (w) => w && (Number(w.count) || 0) > 0;

/** 아직 정복하지 못한 오답만 */
export const activeWrongs = () => store.getWrong().filter((w) => isRealWrong(w) && w.cleared !== true);
export const clearedCount = () => store.getWrong().filter((w) => isRealWrong(w) && w.cleared === true).length;

/* ── 채점 결과 반영 ───────────────────────────────────── */

/** 오답: 오답노트에 기록하고 다음 날 다시 나오도록 큐에 넣는다. */
export function registerWrong(chId, qid) {
  recordWrong(chId, qid);
  const queue = store.getQueue();
  queue[qid] = { due: Date.now() + DAY, streak: 0 };
  store.setQueue(queue);
}

/**
 * 단원 퀴즈에서 **처음 만난 문항**을 맞힌 경우 큐에 넣는다.
 * 복습 시스템이 이미 다루고 있는 문항(큐에 있거나 오답 이력이 있는 것)은 건드리지 않는다.
 * 그래야 우연히 맞힌 것으로 진행 중인 간격이 앞당겨지거나, 정복한 문항이 되살아나지 않는다.
 * @returns {{days:number, streak:number}|null} 넣지 않았으면 null
 */
export function registerFirstCorrect(qid) {
  const queue = store.getQueue();
  if (queue[qid]) return null;                                       // 이미 복습 진행 중
  if (store.getWrong().some((w) => w && w.qid === qid)) return null; // 오답 이력 있음(정복 포함)

  const days = INTERVAL_DAYS[FIRST_CORRECT_STREAK - 1];
  queue[qid] = { due: Date.now() + days * DAY, streak: FIRST_CORRECT_STREAK };
  store.setQueue(queue);
  return { days, streak: FIRST_CORRECT_STREAK };
}

/**
 * 복습에서 정답: streak을 올리고 다음 노출 시각을 잡는다.
 * streak이 이미 4 이상이면 큐에서 제거하고 오답노트를 cleared 처리한다.
 * @returns {{cleared:boolean, days?:number, streak?:number}|null} 큐에 없던 문항이면 null
 */
export function registerCorrect(qid) {
  const queue = store.getQueue();
  const entry = queue[qid];
  if (!entry) return null;

  const streak = Number(entry.streak) || 0;
  const days = INTERVAL_DAYS[streak];

  if (days === undefined) {
    delete queue[qid];
    store.setQueue(queue);
    markCleared(qid);
    return { cleared: true };
  }

  queue[qid] = { due: Date.now() + days * DAY, streak: streak + 1 };
  store.setQueue(queue);
  return { cleared: false, days, streak: streak + 1 };
}

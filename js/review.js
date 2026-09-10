// review.js — 오답노트 레코드(cstudy:wrong) + 복습 큐(cstudy:queue) 규칙. §4.4
//
// 간격 규칙: 정답 시 다음 노출까지 streak 0→1일, 1→3일, 2→7일, 3→17일.
//            streak 4 이상에서 또 맞히면 큐에서 제거하고 오답노트를 cleared 처리한다.
//            오답이면 streak = 0, 다음 날 재등장.

import * as store from './store.js';

const DAY = 24 * 60 * 60 * 1000;

/** 현재 streak → 다음 노출까지의 일수 */
export const INTERVAL_DAYS = { 0: 1, 1: 3, 2: 7, 3: 17 };

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

export function markCleared(qid) {
  const list = store.getWrong();
  const found = list.find((w) => w && w.qid === qid);
  if (!found) return;
  found.cleared = true;
  store.setWrong(list);
}

/** 아직 정복하지 못한 오답만 */
export const activeWrongs = () => store.getWrong().filter((w) => w && w.cleared !== true);
export const clearedCount = () => store.getWrong().filter((w) => w && w.cleared === true).length;

/* ── 채점 결과 반영 ───────────────────────────────────── */

/** 오답: 오답노트에 기록하고 다음 날 다시 나오도록 큐에 넣는다. */
export function registerWrong(chId, qid) {
  recordWrong(chId, qid);
  const queue = store.getQueue();
  queue[qid] = { due: Date.now() + DAY, streak: 0 };
  store.setQueue(queue);
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

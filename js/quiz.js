// quiz.js — 퀴즈 채점 엔진. DOM을 직접 만지지 않는 순수 로직 + 결과 기록.
// 지원 문항 타입 4종: mcq / ox / blank / output (§3.2)

import * as store from './store.js';
import * as review from './review.js';

export const SUPPORTED_TYPES = new Set(['mcq', 'ox', 'blank', 'output']);

/** blank 비교용 정규화: 공백 전부 제거 + 소문자 (§6 Stage 4-1) */
export const normalizeBlank = (s) => String(s ?? '').replace(/\s+/g, '').toLowerCase();

/** 선택지가 있는 타입인가 */
export const hasChoices = (q) => q.type === 'mcq' || q.type === 'output';

/**
 * 문항이 채점 가능한 형태인지 검사한다.
 * 미지원 타입·범위를 벗어난 answer·빈 선택지는 세션에서 제외하고 경고만 남긴다.
 */
export function isUsable(q) {
  if (!q || typeof q !== 'object' || !q.id) return false;
  if (!SUPPORTED_TYPES.has(q.type)) {
    console.warn('[quiz] 지원하지 않는 문항 타입 — 제외합니다:', q.type, q.id);
    return false;
  }
  if (hasChoices(q)) {
    if (!Array.isArray(q.choices) || q.choices.length < 2) {
      console.warn('[quiz] 선택지가 부족합니다 — 제외합니다:', q.id);
      return false;
    }
    if (!Number.isInteger(q.answer) || q.answer < 0 || q.answer >= q.choices.length) {
      console.warn('[quiz] answer 인덱스가 범위를 벗어났습니다 — 제외합니다:', q.id);
      return false;
    }
  }
  if (q.type === 'ox' && typeof q.answer !== 'boolean') {
    console.warn('[quiz] ox 문항의 answer가 boolean이 아닙니다 — 제외합니다:', q.id);
    return false;
  }
  if (q.type === 'blank') {
    const list = Array.isArray(q.answer) ? q.answer : [q.answer];
    if (!list.length || list.every((a) => normalizeBlank(a) === '')) {
      console.warn('[quiz] blank 문항의 정답이 비어 있습니다 — 제외합니다:', q.id);
      return false;
    }
  }
  return true;
}

export const usableQuestions = (quiz) => (Array.isArray(quiz) ? quiz : []).filter(isUsable);

/** 응답이 정답인가. response: 선택지 인덱스(number) / boolean / 문자열 */
export function isCorrect(q, response) {
  switch (q.type) {
    case 'mcq':
    case 'output':
      return Number(response) === Number(q.answer);
    case 'ox':
      return Boolean(response) === Boolean(q.answer);
    case 'blank': {
      const answers = Array.isArray(q.answer) ? q.answer : [q.answer];
      const got = normalizeBlank(response);
      return got !== '' && answers.some((a) => normalizeBlank(a) === got);
    }
    default:
      return false;
  }
}

/** 사람이 읽을 수 있는 정답 문자열 (결과·오답노트 표시용) */
export function answerText(q) {
  if (hasChoices(q)) return String(q.choices[q.answer]);
  if (q.type === 'ox') return q.answer ? 'O (맞다)' : 'X (아니다)';
  const list = Array.isArray(q.answer) ? q.answer : [q.answer];
  return list.map(String).join(' 또는 ');
}

/** Fisher–Yates 셔플 (원본을 바꾸지 않는다) */
export function shuffle(list) {
  const a = [...list];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

/* ── 세션 ─────────────────────────────────────────────── */

/** count: 숫자 또는 'all' */
export function createSession(chId, quiz, count) {
  const pool = shuffle(usableQuestions(quiz));
  const questions = count === 'all' ? pool : pool.slice(0, Math.max(1, Number(count) || pool.length));
  return { chId, questions, i: 0, results: [], done: false, mode: 'quiz' };
}

/** 미리 고른 문항들로 세션을 만든다("오답만 다시 풀기", 복습 세션). */
export function sessionFrom(chId, questions, { mode = 'quiz', chIdByQid = null } = {}) {
  return { chId, questions: shuffle(questions), i: 0, results: [], done: false, mode, chIdByQid };
}

/** 여러 단원이 섞인 세션에서도 문항이 속한 단원을 찾는다. */
const chapterOf = (session, q) =>
  (session.chIdByQid && session.chIdByQid[q.id]) || session.chId;

export const currentQuestion = (s) => s.questions[s.i] || null;
export const isLast = (s) => s.i >= s.questions.length - 1;
export const score = (s) => (s.questions.length ? s.results.filter((r) => r.correct).length / s.questions.length : 0);
export const wrongQuestions = (s) => s.results.filter((r) => !r.correct).map((r) => r.question);

/**
 * 현재 문항을 채점하고 결과를 세션에 담는다. 오답이면 오답노트·복습 큐에 기록한다.
 * @returns {{correct:boolean, question:object}}
 */
export function submit(session, response) {
  const q = currentQuestion(session);
  const correct = isCorrect(q, response);
  session.results.push({ qid: q.id, question: q, response, correct });

  if (!correct) {
    // 오답은 어느 세션에서든 오답노트에 남기고 다음 날 다시 나오게 한다 (§4.3-③)
    review.registerWrong(chapterOf(session, q), q.id);
  } else if (session.mode === 'review') {
    // 간격 반복 진행은 복습 세션에서만 적용한다 (§4.4)
    review.registerCorrect(q.id);
  }
  return { correct, question: q };
}

/** 다음 문항으로. 마지막이었다면 세션을 종료하고 quizBest를 갱신한다. */
export function advance(session) {
  if (isLast(session)) {
    session.done = true;
    // 여러 단원이 섞인 복습 세션은 단원 점수의 의미가 없으므로 기록하지 않는다.
    if (session.mode === 'quiz') updateQuizBest(session.chId, score(session));
    return false;
  }
  session.i += 1;
  return true;
}

/* ── 저장 ─────────────────────────────────────────────── */

/** 최고 정답률만 남긴다. */
export function updateQuizBest(chId, ratio) {
  const prev = store.getChapterProgress(chId).quizBest ?? 0;
  if (ratio > prev) store.updateChapterProgress(chId, { quizBest: ratio });
  else store.updateChapterProgress(chId, {}); // lastAt 만 갱신
}

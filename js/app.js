// app.js — 부트스트랩 + 화면 렌더링.
// 모든 텍스트는 textContent / append(string) 로만 넣는다. innerHTML 금지(§7 XSS).

import * as router from './router.js';
import * as store from './store.js';
import { loadIndex, loadChapter, loadGlossary, loadErrors, peekChapter } from './loader.js';
import { renderBlocks, renderInline, renderCodeBox, writeClipboard } from './render.js';
import * as quiz from './quiz.js';
import * as review from './review.js';

const view = document.getElementById('view');
const appTitle = document.getElementById('appTitle');
const btnBack = document.getElementById('btnBack');
const tabbar = document.getElementById('tabbar');
const tabbarDue = document.getElementById('tabbarDue');
const sheet = document.getElementById('sheet');
const sheetTitle = document.getElementById('sheetTitle');
const sheetDesc = document.getElementById('sheetDesc');

let index = { version: '0', chapters: [] };
let renderToken = 0; // 렌더 도중 라우트가 바뀌면 늦게 도착한 결과를 버리는 용도

/* ── DOM 헬퍼 ─────────────────────────────────────────── */

function el(tag, opts = {}, ...children) {
  const node = document.createElement(tag);
  for (const [key, value] of Object.entries(opts)) {
    if (value === null || value === undefined || value === false) continue;
    if (key === 'class') node.className = value;
    else if (key === 'text') node.textContent = value;
    else if (key === 'dataset') Object.assign(node.dataset, value);
    else if (key.startsWith('on') && typeof value === 'function') {
      node.addEventListener(key.slice(2).toLowerCase(), value);
    } else node.setAttribute(key, value === true ? '' : String(value));
  }
  for (const child of children.flat()) {
    if (child === null || child === undefined || child === false) continue;
    node.append(child); // 문자열은 텍스트 노드로 삽입된다
  }
  return node;
}

const clear = (node) => { while (node.firstChild) node.removeChild(node.firstChild); };

/* ── 진도 계산 ────────────────────────────────────────── */

// 단원의 전체 섹션 수는 chXX.json 에만 있다. 이미 받아둔 단원만 정확히 계산한다.
function chapterPercent(chId) {
  const read = store.getChapterProgress(chId).sectionsRead.length;
  if (read === 0) return 0;
  const cached = peekChapter(chId);
  const total = cached && Array.isArray(cached.sections) ? cached.sections.length : 0;
  if (!total) return 0; // 총 섹션 수를 모르면 추측하지 않는다
  return Math.min(100, Math.round((read / total) * 100));
}

// 완료 기준: 해당 단원 퀴즈 최고 정답률 80% 이상.
const isChapterDone = (chId) => (store.getChapterProgress(chId).quizBest ?? 0) >= 0.8;

const dueCount = (now = Date.now()) => review.dueCount(now);
const wrongCount = () => review.activeWrongs().length;

/** "3분 전" / "2일 전" / "2026. 9. 10." */
function timeAgo(ts) {
  if (typeof ts !== 'number' || !Number.isFinite(ts)) return '';
  const diff = Date.now() - ts;
  if (diff < 60e3) return '방금 전';
  if (diff < 3600e3) return `${Math.floor(diff / 60e3)}분 전`;
  if (diff < 86400e3) return `${Math.floor(diff / 3600e3)}시간 전`;
  if (diff < 7 * 86400e3) return `${Math.floor(diff / 86400e3)}일 전`;
  return new Date(ts).toLocaleDateString('ko-KR');
}

/* ── 공통 조각 ────────────────────────────────────────── */

function progressBar(percent, label) {
  const fill = el('span', { class: 'bar__fill' });
  fill.style.width = `${percent}%`;
  return el('div', { class: 'bar', role: 'img', 'aria-label': `${label} ${percent}%` }, fill);
}

function emptyState(message, actionLabel, actionHash) {
  return el('div', { class: 'empty' },
    el('p', { class: 'empty__msg', text: message }),
    actionLabel ? el('a', { class: 'btn btn--primary', href: actionHash, text: actionLabel }) : null
  );
}

function loadingState(label = '불러오는 중…') {
  return el('p', { class: 'loading', role: 'status', text: label });
}

function errorState(message, onRetry) {
  return el('div', { class: 'error-box', role: 'alert' },
    el('p', { class: 'error-box__icon', 'aria-hidden': 'true', text: '⚠' }),
    el('p', { class: 'error-box__msg', text: message }),
    el('button', { class: 'btn btn--primary', type: 'button', onclick: onRetry, text: '다시 시도' })
  );
}

/* ── 바텀시트 ─────────────────────────────────────────── */

function openSheet(title, desc) {
  sheetTitle.textContent = title;
  sheetDesc.textContent = desc || '설명이 아직 없습니다.';
  if (typeof sheet.showModal === 'function') sheet.showModal();
  else sheet.setAttribute('open', ''); // showModal 미지원 환경 대비
}

function initSheet() {
  document.getElementById('sheetClose').addEventListener('click', () => sheet.close());
  // 시트 바깥(백드롭) 탭으로 닫기
  sheet.addEventListener('click', (e) => { if (e.target === sheet) sheet.close(); });
}

/* ── 홈 ───────────────────────────────────────────────── */

function renderHome() {
  const frag = document.createDocumentFragment();
  const done = index.chapters.filter((c) => isChapterDone(c.id)).length;
  const due = dueCount();

  frag.append(el('p', {
    class: 'summary-line',
    text: `${index.chapters.length}단원 중 ${done}단원 완료 · 오답 ${wrongCount()}문항`
  }));

  if (due > 0) {
    frag.append(el('a', { class: 'banner', href: '#/review' },
      el('span', { class: 'banner__text', text: `오늘 복습 ${due}문항` }),
      el('span', { class: 'banner__go', 'aria-hidden': 'true', text: '›' })
    ));
  }

  const list = el('ul', { class: 'ch-list' });
  for (const ch of index.chapters) {
    const locked = ch.status === 'empty';
    const percent = locked ? 0 : chapterPercent(ch.id);
    const no = String(ch.order).padStart(2, '0');

    const head = el('div', { class: 'card__head' },
      el('span', { class: 'card__no', 'aria-hidden': 'true', text: no }),
      el('div', { class: 'card__headings' },
        el('h2', { class: 'card__title', text: ch.title },
          locked ? el('span', { class: 'chip chip--locked', text: '준비 중' }) : null),
        el('p', { class: 'card__sub', text: ch.subtitle || '' })
      )
    );

    const meta = el('p', { class: 'card__meta' },
      `약 ${ch.estMin}분`,
      locked ? '' : ` · 진도 ${percent}%`,
      !locked && isChapterDone(ch.id) ? ' · 완료 ✓' : ''
    );

    const inner = [head, locked ? null : progressBar(percent, `${ch.title} 진도`), meta];
    const card = locked
      ? el('div', { class: 'card card--locked', 'aria-disabled': 'true' }, inner)
      : el('a', { class: 'card', href: router.hashFor('chapter', { chId: ch.id }), dataset: { ch: ch.id } }, inner);

    list.append(el('li', {}, card));
  }
  frag.append(list);
  frag.append(renderSettings());
  return frag;
}

/**
 * 진도 막대에는 단원의 전체 섹션 수가 필요한데 그 값은 chXX.json 에만 있다.
 * 읽은 섹션이 있는데 아직 받아오지 않은 단원만 조용히 채운 뒤 막대를 갱신한다.
 */
async function hydrateHomeBars() {
  const pending = index.chapters.filter((ch) =>
    ch.status !== 'empty' &&
    !peekChapter(ch.id) &&
    store.getChapterProgress(ch.id).sectionsRead.length > 0
  );
  if (!pending.length) return;

  await Promise.allSettled(pending.map((ch) => loadChapter(ch.id)));
  if (currentRoute.name !== 'home') return;

  for (const ch of pending) {
    const card = view.querySelector(`.card[data-ch="${ch.id}"]`);
    if (!card) continue;
    const percent = chapterPercent(ch.id);
    const bar = card.querySelector('.bar');
    const fill = card.querySelector('.bar__fill');
    const meta = card.querySelector('.card__meta');
    if (fill) fill.style.width = `${percent}%`;
    if (bar) bar.setAttribute('aria-label', `${ch.title} 진도 ${percent}%`);
    if (meta) {
      meta.textContent = `약 ${ch.estMin}분 · 진도 ${percent}%` +
        (isChapterDone(ch.id) ? ' · 완료 ✓' : '');
    }
  }
}

/* ── 단원 허브 ────────────────────────────────────────── */

const TAB_LABELS = { summary: '요약', concept: '개념', quiz: '퀴즈', extra: '기타' };

function tabSegment(chId, activeTab) {
  const nav = el('nav', { class: 'seg', 'aria-label': '단원 탭' });
  for (const tab of router.TABS) {
    const active = tab === activeTab;
    nav.append(el('a', {
      class: `seg__item${active ? ' is-active' : ''}`,
      href: router.hashFor('chapter', { chId, tab }),
      'aria-current': active ? 'page' : null,
      text: TAB_LABELS[tab]
    }));
  }
  return nav;
}

/** ① 요약 탭 (§4.3-①) */
function renderSummaryTab(chapter) {
  const { oneLiner, bullets, keywords } = chapter.summary;
  const frag = document.createDocumentFragment();

  if (oneLiner) frag.append(el('p', { class: 'lead', text: oneLiner }));

  if (bullets.length) {
    frag.append(el('h3', { class: 'sec-title', text: '핵심' }));
    const ul = el('ul', { class: 'bullets' });
    for (const b of bullets) ul.append(el('li', { text: String(b) }));
    frag.append(ul);
  }

  if (keywords.length) {
    frag.append(el('h3', { class: 'sec-title', text: '키워드' }));
    frag.append(el('p', { class: 'hint', text: '칩을 탭하면 설명이 열립니다.' }));
    const chips = el('div', { class: 'chips' });
    for (const kw of keywords) {
      const term = String(kw && kw.term ? kw.term : '');
      if (!term) continue;
      chips.append(el('button', {
        class: 'chip chip--kw',
        type: 'button',
        text: term,
        onclick: () => openSheet(term, kw.desc)
      }));
    }
    frag.append(chips);
  }

  if (!oneLiner && !bullets.length && !keywords.length) {
    frag.append(el('div', { class: 'placeholder' }, el('p', { text: '요약이 아직 준비되지 않았습니다.' })));
  }
  return frag;
}

/** ② 개념 탭 — 섹션 목록 (§4.3-②) */
function renderConceptTab(chapter) {
  const frag = document.createDocumentFragment();
  const sections = chapter.sections;
  if (!sections.length) {
    frag.append(el('div', { class: 'placeholder' }, el('p', { text: '개념 내용이 아직 준비되지 않았습니다.' })));
    return frag;
  }

  const read = new Set(store.getChapterProgress(chapter.id).sectionsRead);
  frag.append(el('p', { class: 'hint', text: `섹션 ${sections.length}개 중 ${read.size}개 읽음` }));

  const list = el('ol', { class: 'sec-list' });
  sections.forEach((sec, i) => {
    const isRead = read.has(sec.id);
    list.append(el('li', {},
      el('a', { class: `sec-item${isRead ? ' is-read' : ''}`, href: router.hashFor('section', { chId: chapter.id, sectionId: sec.id }) },
        el('span', { class: 'sec-item__no', 'aria-hidden': 'true', text: String(i + 1) }),
        el('span', { class: 'sec-item__title', text: sec.title || sec.id }),
        el('span', { class: 'sec-item__state', text: isRead ? '읽음 ✓' : '' })
      )
    ));
  });
  frag.append(list);
  return frag;
}

/** 단원 말미 "다음 단원 예고" 박스 (§4.3-②) */
function previewBox(chapter) {
  if (!chapter.preview) return null;
  return el('aside', { class: 'preview-box' },
    el('p', { class: 'preview-box__head', text: '다음 단원 예고' }),
    el('p', { class: 'preview-box__body', text: chapter.preview })
  );
}

/** 개념 섹션 본문 (§4.1 #/ch/chXX/concept/S) */
function renderSectionView(chapter, sectionId) {
  const sections = chapter.sections;
  const i = sections.findIndex((s) => s.id === sectionId);
  if (i === -1) {
    return emptyState('그런 섹션이 없습니다.',
      '섹션 목록으로', router.hashFor('chapter', { chId: chapter.id, tab: 'concept' }));
  }

  const sec = sections[i];
  const isLast = i === sections.length - 1;
  const frag = document.createDocumentFragment();

  frag.append(el('p', { class: 'sec-head__meta', text: `섹션 ${i + 1} / ${sections.length}` }));
  frag.append(el('h2', { class: 'sec-head__title', text: sec.title || sec.id }));
  frag.append(renderBlocks(sec.body));

  if (isLast) {
    const box = previewBox(chapter);
    if (box) frag.append(box);
  }

  // 주요 액션은 화면 하단 (§5.3)
  const footer = el('div', { class: 'sec-foot' },
    isLast
      ? el('a', { class: 'btn btn--primary btn--block', href: router.hashFor('chapter', { chId: chapter.id, tab: 'quiz' }), text: '퀴즈 풀기' })
      : el('a', { class: 'btn btn--primary btn--block', href: router.hashFor('section', { chId: chapter.id, sectionId: sections[i + 1].id }), text: '다음 섹션 →' }),
    el('a', { class: 'btn btn--block', href: router.hashFor('chapter', { chId: chapter.id, tab: 'concept' }), text: '섹션 목록' })
  );
  frag.append(footer);

  // 섹션 끝(액션 영역)이 화면에 들어오면 읽음 처리한다.
  watchRead(footer, chapter.id, sec.id);
  return frag;
}

let readWatcher = null;

/** 섹션 끝(액션 영역)이 화면에 들어오면 읽음으로 기록한다. */
function watchRead(target, chId, sectionId) {
  const mark = () => {
    const cur = store.getChapterProgress(chId).sectionsRead;
    if (cur.includes(sectionId)) return;
    store.updateChapterProgress(chId, { sectionsRead: [...cur, sectionId] });
  };

  const check = () => {
    const r = target.getBoundingClientRect();
    if (r.top < window.innerHeight * 0.9 && r.bottom > 0) { mark(); stop(); }
  };

  const stop = () => {
    window.removeEventListener('scroll', check);
    window.removeEventListener('resize', check);
    if (readWatcher && readWatcher.stop === stop) readWatcher = null;
  };

  readWatcher = { stop };
  window.addEventListener('scroll', check, { passive: true });
  window.addEventListener('resize', check);
  // 내용이 짧아 처음부터 끝이 보이는 경우
  setTimeout(check, 0);

  // 하단 버튼을 눌러 넘어가는 경우도 확실히 읽음 처리한다.
  target.addEventListener('click', (e) => { if (e.target.closest('a')) mark(); });
}

/* ── ③ 퀴즈 탭 (§4.3-③) ──────────────────────────────── */

const LEVEL_LABEL = { 1: '암기', 2: '이해', 3: '적용' };

/** 진입 화면: 문항 수 선택 → 시작 */
function renderQuizIntro(body, chapter) {
  clear(body);
  const pool = quiz.usableQuestions(chapter.quiz);
  if (!pool.length) {
    body.append(el('div', { class: 'placeholder' }, el('p', { text: '퀴즈가 아직 준비되지 않았습니다.' })));
    return;
  }

  body.append(el('p', { class: 'lead', text: `준비된 문항 ${pool.length}개. 몇 문항 풀까요?` }));

  const ctx = {
    onRestart: () => renderQuizIntro(body, chapter),
    restartLabel: '처음부터 다시',
    back: { href: router.hashFor('chapter', { chId: chapter.id, tab: 'summary' }), label: '단원으로 돌아가기' }
  };

  const counts = [5, 10].filter((n) => n < pool.length);
  const options = el('div', { class: 'q-counts' });
  const start = (count) => renderQuizRunner(body, quiz.createSession(chapter.id, chapter.quiz, count), ctx);
  for (const n of counts) {
    options.append(el('button', { class: 'btn btn--block', type: 'button', text: `${n}문항`, onclick: () => start(n) }));
  }
  options.append(el('button', {
    class: 'btn btn--primary btn--block', type: 'button',
    text: `전체 ${pool.length}문항`, onclick: () => start('all')
  }));
  body.append(options);
}

/** 문항 1개씩 표시. 선택 즉시 채점하고 해설을 펼친다(제출 버튼 없음). 퀴즈·복습 공용. */
function renderQuizRunner(body, session, ctx) {
  clear(body);
  const q = quiz.currentQuestion(session);
  if (!q) { renderQuizResult(body, session, ctx); return; }

  const total = session.questions.length;
  const nth = session.i + 1;

  body.append(el('p', { class: 'q-progress', text: `${nth} / ${total}` }));
  body.append(progressBar(Math.round((nth / total) * 100), '퀴즈 진행'));

  const tags = Array.isArray(q.tags) ? q.tags : [];
  const metaBits = [LEVEL_LABEL[q.level], ...tags].filter(Boolean);
  if (metaBits.length) body.append(el('p', { class: 'q-meta', text: metaBits.join(' · ') }));

  body.append(el('h2', { class: 'q-stem' }, renderInline(q.stem)));
  if (q.code) body.append(el('div', { class: 'q-code' }, renderCodeBox(q.code, 'c')));

  const feedback = el('div', { class: 'q-feedback', role: 'status', hidden: true });
  const nextWrap = el('div', { class: 'q-next', hidden: true });

  const finish = (response) => {
    const { correct } = quiz.submit(session, response);
    showFeedback(feedback, q, correct);
    nextWrap.hidden = false;
    const label = quiz.isLast(session) ? '결과 보기' : '다음 문항 →';
    nextWrap.append(el('button', {
      class: 'btn btn--primary btn--block', type: 'button', text: label,
      onclick: () => {
        if (quiz.advance(session)) renderQuizRunner(body, session, ctx);
        else renderQuizResult(body, session, ctx);
      }
    }));
    nextWrap.querySelector('button').focus({ preventScroll: true });
  };

  body.append(buildAnswerArea(q, finish));
  body.append(feedback, nextWrap);
}

/** 타입별 응답 UI. 선택형은 탭 즉시 채점된다. */
function buildAnswerArea(q, finish) {
  if (quiz.hasChoices(q)) {
    const box = el('div', { class: 'q-choices' });
    q.choices.forEach((choice, idx) => {
      const btn = el('button', { class: 'q-choice', type: 'button' },
        el('span', { class: 'q-choice__no', 'aria-hidden': 'true', text: String(idx + 1) }),
        el('span', { class: 'q-choice__text' }, renderInline(choice))
      );
      btn.addEventListener('click', () => {
        markChoices(box, idx, q.answer);
        finish(idx);
      });
      box.append(btn);
    });
    return box;
  }

  if (q.type === 'ox') {
    const box = el('div', { class: 'q-ox' });
    [[true, 'O', '맞다'], [false, 'X', '아니다']].forEach(([value, mark, label]) => {
      const btn = el('button', { class: 'q-oxbtn', type: 'button' },
        el('span', { class: 'q-oxbtn__mark', 'aria-hidden': 'true', text: mark }),
        el('span', { class: 'q-oxbtn__label', text: label })
      );
      btn.addEventListener('click', () => {
        for (const b of box.querySelectorAll('button')) b.disabled = true;
        btn.classList.add('is-picked');
        box.querySelectorAll('button')[q.answer ? 0 : 1].classList.add('is-answer');
        finish(value);
      });
      box.append(btn);
    });
    return box;
  }

  // blank — 입력 후 확인 버튼
  const input = el('input', {
    class: 'q-blank', type: 'text', inputmode: 'text',
    autocapitalize: 'off', autocomplete: 'off', spellcheck: 'false',
    placeholder: '답을 입력하세요', 'aria-label': '빈칸 답 입력'
  });
  const submit = el('button', { class: 'btn btn--primary btn--block', type: 'button', text: '확인' });
  const box = el('div', { class: 'q-blankbox' }, input, submit);
  const go = () => {
    input.disabled = true;
    submit.disabled = true;
    finish(input.value);
  };
  submit.addEventListener('click', go);
  input.addEventListener('keydown', (e) => { if (e.key === 'Enter') go(); });
  return box;
}

function markChoices(box, picked, answer) {
  const buttons = [...box.querySelectorAll('button')];
  buttons.forEach((b, i) => {
    b.disabled = true;
    if (i === answer) b.classList.add('is-answer');
    if (i === picked && i !== answer) b.classList.add('is-picked-wrong');
  });
}

/** 색만으로 정답/오답을 구분하지 않는다: 아이콘 + 문구 병기 (§7) */
function showFeedback(node, q, correct) {
  clear(node);
  node.className = `q-feedback ${correct ? 'is-correct' : 'is-wrong'}`;
  node.append(el('p', { class: 'q-verdict' },
    el('span', { class: 'q-verdict__icon', 'aria-hidden': 'true', text: correct ? '✓' : '✕' }),
    correct ? '정답입니다' : '오답입니다'
  ));
  if (!correct) node.append(el('p', { class: 'q-answer', text: `정답: ${quiz.answerText(q)}` }));
  if (q.explain) node.append(el('p', { class: 'q-explain' }, renderInline(q.explain)));
  node.hidden = false;
}

/** 종료 화면: 점수 · 틀린 문항 목록 · "오답만 다시 풀기" */
function renderQuizResult(body, session, ctx) {
  clear(body);
  const total = session.questions.length;
  const right = session.results.filter((r) => r.correct).length;
  const percent = Math.round(quiz.score(session) * 100);
  const wrong = quiz.wrongQuestions(session);

  body.append(el('div', { class: 'q-result' },
    el('p', { class: 'q-result__score', text: `${percent}%` }),
    el('p', { class: 'q-result__detail', text: `${total}문항 중 ${right}문항 정답` })
  ));

  if (wrong.length) {
    body.append(el('h3', { class: 'sec-title', text: `틀린 문항 ${wrong.length}개` }));
    const list = el('ul', { class: 'q-wrongs' });
    for (const q of wrong) {
      list.append(el('li', { class: 'q-wrong' },
        el('p', { class: 'q-wrong__stem' }, renderInline(q.stem)),
        el('p', { class: 'q-wrong__answer', text: `정답: ${quiz.answerText(q)}` }),
        q.explain ? el('p', { class: 'q-wrong__explain' }, renderInline(q.explain)) : null
      ));
    }
    body.append(list);
  } else {
    body.append(el('p', { class: 'hint', text: '전부 맞혔습니다.' }));
  }

  const actions = el('div', { class: 'q-actions' });
  if (wrong.length) {
    actions.append(el('button', {
      class: 'btn btn--primary btn--block', type: 'button', text: `오답만 다시 풀기 (${wrong.length})`,
      onclick: () => renderQuizRunner(
        body,
        quiz.sessionFrom(session.chId, wrong, { mode: session.mode, chIdByQid: session.chIdByQid }),
        ctx
      )
    }));
  }
  if (ctx.onRestart) {
    actions.append(el('button', {
      class: 'btn btn--block', type: 'button', text: ctx.restartLabel, onclick: ctx.onRestart
    }));
  }
  actions.append(el('a', { class: 'btn btn--block', href: ctx.back.href, text: ctx.back.label }));
  body.append(actions);
}

/* ── 복습 큐 (§4.4) ───────────────────────────────────── */

/** 큐에서 due가 된 문항들을 단원 JSON에서 실제 문항 객체로 복원한다. */
async function collectDueQuestions() {
  const entries = review.dueEntries();
  if (!entries.length) return { questions: [], chIdByQid: {}, failed: [] };

  const wrongs = store.getWrong();
  const chIdOf = (qid) => {
    const rec = wrongs.find((w) => w && w.qid === qid);
    if (rec && rec.chId) return rec.chId;
    const m = /^(ch\d{2})-/.exec(qid); // 오답 레코드가 없으면 qid 접두사로 추정
    return m ? m[1] : null;
  };

  const byChapter = new Map();
  for (const e of entries) {
    const chId = chIdOf(e.qid);
    if (!chId) continue;
    if (!byChapter.has(chId)) byChapter.set(chId, []);
    byChapter.get(chId).push(e.qid);
  }

  const failed = [];
  const questions = [];
  const chIdByQid = {};
  const loaded = await Promise.allSettled([...byChapter.keys()].map((id) => loadChapter(id)));

  [...byChapter.keys()].forEach((chId, i) => {
    const res = loaded[i];
    if (res.status !== 'fulfilled') { failed.push(chId); return; }
    const pool = quiz.usableQuestions(res.value.quiz);
    for (const qid of byChapter.get(chId)) {
      const q = pool.find((x) => x.id === qid);
      if (!q) continue; // 콘텐츠에서 사라진 문항은 조용히 건너뛴다
      questions.push(q);
      chIdByQid[qid] = chId;
    }
  });

  return { questions, chIdByQid, failed };
}

async function renderReview(token) {
  const body = el('div', { class: 'tab-body' }, loadingState('복습 문항을 준비하는 중…'));
  view.append(body);

  let due;
  try {
    due = await collectDueQuestions();
  } catch (err) {
    if (token !== renderToken) return;
    console.warn('[cstudy] 복습 준비 실패', err);
    clear(body);
    body.append(errorState(err.message, () => renderRoute(currentRoute)));
    return;
  }
  if (token !== renderToken) return;

  clear(body);
  if (due.failed.length) {
    body.append(el('p', { class: 'hint', text: `불러오지 못한 단원 ${due.failed.length}개는 제외했습니다.` }));
  }

  if (!due.questions.length) {
    body.append(emptyState('지금 복습할 문항이 없습니다. 새 단원을 시작하세요.', '홈으로', '#/'));
    return;
  }

  const ctx = {
    onRestart: () => renderRoute(currentRoute),
    restartLabel: '남은 복습 다시 확인',
    back: { href: '#/', label: '홈으로' }
  };
  const session = quiz.sessionFrom(null, due.questions, { mode: 'review', chIdByQid: due.chIdByQid });
  renderQuizRunner(body, session, ctx);
}

/* ── 오답노트 (§4.5) ──────────────────────────────────── */

async function renderWrong(token) {
  const body = el('div', { class: 'tab-body' }, loadingState());
  view.append(body);

  const wrongs = review.activeWrongs();
  const clearedN = review.clearedCount();

  if (!wrongs.length) {
    if (token !== renderToken) return;
    clear(body);
    body.append(emptyState(
      clearedN ? `틀린 문항이 없습니다. 정복한 오답 ${clearedN}개.` : '아직 틀린 문항이 없습니다.',
      '홈으로', '#/'
    ));
    return;
  }

  const chIds = [...new Set(wrongs.map((w) => w.chId).filter(Boolean))];
  const loaded = await Promise.allSettled(chIds.map((id) => loadChapter(id)));
  if (token !== renderToken) return;

  const chapters = new Map();
  chIds.forEach((id, i) => { if (loaded[i].status === 'fulfilled') chapters.set(id, loaded[i].value); });

  clear(body);
  body.append(el('p', { class: 'summary-line', text: `틀린 문항 ${wrongs.length}개` +
    (clearedN ? ` · 정복 ${clearedN}개` : '') }));

  for (const chId of chIds) {
    const meta = index.chapters.find((c) => c.id === chId);
    const chapter = chapters.get(chId);
    const rows = wrongs.filter((w) => w.chId === chId)
      .sort((a, b) => (b.lastAt || 0) - (a.lastAt || 0));
    if (!rows.length) continue;

    const group = el('section', { class: 'wrong-group' });
    const countLabel = el('span', { class: 'wrong-group__count' });
    group.append(el('h2', { class: 'wrong-group__title' }, meta ? meta.title : chId, countLabel));

    if (!chapter) {
      countLabel.textContent = `${rows.length}문항`;
      group.append(el('p', { class: 'hint', text: '이 단원 내용을 불러오지 못해 해설을 표시할 수 없습니다.' }));
      body.append(group);
      continue;
    }

    const pool = quiz.usableQuestions(chapter.quiz);
    const questions = [];
    const list = el('ul', { class: 'wrong-list' });

    for (const row of rows) {
      const q = pool.find((x) => x.id === row.qid);
      if (!q) continue; // 콘텐츠에서 사라졌거나 아직 채워지지 않은 문항
      questions.push(q);

      const item = el('details', { class: 'wrong-item' });
      item.append(el('summary', { class: 'wrong-item__head' },
        el('span', { class: 'wrong-item__stem' }, renderInline(q.stem)),
        el('span', { class: 'wrong-item__meta', text: `${row.count}회 · ${timeAgo(row.lastAt)}` })
      ));
      const panel = el('div', { class: 'wrong-item__panel' });
      if (q.code) panel.append(renderCodeBox(q.code, 'c'));
      panel.append(el('p', { class: 'q-answer', text: `정답: ${quiz.answerText(q)}` }));
      if (q.explain) panel.append(el('p', { class: 'q-explain' }, renderInline(q.explain)));
      item.append(panel);
      list.append(el('li', {}, item));
    }

    // 헤더 개수는 실제로 보여줄 수 있는 문항 수와 일치시킨다.
    countLabel.textContent = `${questions.length}문항`;
    const missing = rows.length - questions.length;

    if (!questions.length) {
      group.append(el('p', { class: 'hint', text: '이 단원의 문항 정보를 찾을 수 없습니다.' }));
      body.append(group);
      continue;
    }

    group.append(list);
    if (missing > 0) {
      group.append(el('p', { class: 'hint', text: `문항 정보를 찾을 수 없는 오답 ${missing}개는 표시하지 않았습니다.` }));
    }

    {
      group.append(el('button', {
        class: 'btn btn--primary btn--block', type: 'button',
        text: `이 단원 오답만 풀기 (${questions.length})`,
        onclick: () => {
          // 이미 #/wrong 이라 링크로는 되돌아갈 수 없다 → 화면을 다시 그린다.
          const ctx = {
            onRestart: () => { renderRoute(currentRoute); window.scrollTo(0, 0); },
            restartLabel: '오답노트로 돌아가기',
            back: { href: '#/', label: '홈으로' }
          };
          clear(body);
          renderQuizRunner(body, quiz.sessionFrom(chId, questions), ctx);
          window.scrollTo(0, 0);
        }
      }));
    }
    body.append(group);
  }
}

/* ── ④ 기타 탭 (§4.3-④) ─────────────────────────────── */

function extraCard(title, ...children) {
  return el('section', { class: 'xcard' },
    el('h3', { class: 'xcard__title', text: title }),
    ...children
  );
}

/** 단원 전체에서 tone === "trap" 인 팁을 자동 수집한다. */
function collectTraps(chapter) {
  const traps = [];
  for (const sec of chapter.sections) {
    for (const block of (Array.isArray(sec.body) ? sec.body : [])) {
      if (block && block.type === 'tip' && block.tone === 'trap') {
        traps.push({ sectionId: sec.id, sectionTitle: sec.title || sec.id, text: block.text });
      }
    }
  }
  return traps;
}

function renderTrapChecklist(chapter) {
  const traps = collectTraps(chapter);
  if (!traps.length) {
    return el('p', { class: 'hint', text: '수집된 항목이 없습니다.' });
  }
  const list = el('ul', { class: 'checklist' });
  traps.forEach((trap, i) => {
    const id = `trap-${chapter.id}-${i}`;
    const box = el('input', { class: 'checklist__box', type: 'checkbox', id });
    list.append(el('li', { class: 'checklist__item' },
      box,
      el('label', { class: 'checklist__label', for: id },
        el('span', { class: 'checklist__text' }, renderInline(trap.text)),
        el('span', { class: 'checklist__src', text: trap.sectionTitle })
      )
    ));
  });
  return el('div', {},
    el('p', { class: 'hint', text: `${traps.length}개 · 체크 상태는 저장되지 않습니다.` }),
    list
  );
}

function renderErrorDict(errors) {
  if (!errors.length) {
    return el('p', { class: 'hint', text: '이 단원에 등록된 에러 메시지가 없습니다.' });
  }
  const list = el('ul', { class: 'errdict' });
  for (const e of errors) {
    const item = el('details', { class: 'errdict__item' });
    item.append(el('summary', { class: 'errdict__head' },
      el('code', { class: 'errdict__msg', text: e.message })
    ));
    const panel = el('div', { class: 'errdict__panel' });
    if (e.cause) {
      panel.append(el('p', { class: 'errdict__label', text: '원인' }));
      panel.append(el('p', { class: 'errdict__body' }, renderInline(e.cause)));
    }
    if (e.fix) {
      panel.append(el('p', { class: 'errdict__label', text: '조치' }));
      panel.append(el('p', { class: 'errdict__body' }, renderInline(e.fix)));
    }
    item.append(panel);
    list.append(el('li', {}, item));
  }
  return list;
}

function renderKeywordList(chapter) {
  const keywords = chapter.summary.keywords;
  if (!keywords.length) return el('p', { class: 'hint', text: '등록된 키워드가 없습니다.' });
  const chips = el('div', { class: 'chips' });
  for (const kw of keywords) {
    const term = String(kw && kw.term ? kw.term : '');
    if (!term) continue;
    chips.append(el('button', {
      class: 'chip chip--kw', type: 'button', text: term,
      onclick: () => openSheet(term, kw.desc)
    }));
  }
  return chips;
}

function renderResetCard(chapter, body) {
  const status = el('p', { class: 'hint', role: 'status' });
  const refresh = () => {
    const p = store.getChapterProgress(chapter.id);
    const best = p.quizBest === null ? '없음' : `${Math.round(p.quizBest * 100)}%`;
    status.textContent = `읽은 섹션 ${p.sectionsRead.length}/${chapter.sections.length} · 퀴즈 최고 ${best}`;
  };
  refresh();

  const btn = el('button', {
    class: 'btn btn--danger btn--block', type: 'button', text: '이 단원 진도 초기화',
    onclick: () => {
      const ok = window.confirm(
        `"${chapter.title}"의 읽은 섹션과 퀴즈 최고 점수를 지웁니다.\n오답노트와 복습 큐는 그대로 둡니다.\n\n계속할까요?`
      );
      if (!ok) return;
      store.updateChapterProgress(chapter.id, { sectionsRead: [], quizBest: null });
      refresh();
      status.textContent += ' — 초기화했습니다.';
    }
  });
  return el('div', {}, status, btn);
}

async function renderExtraTab(body, chapter) {
  clear(body);
  body.append(extraCard('자주 하는 실수 체크리스트', renderTrapChecklist(chapter)));

  const errCard = extraCard('컴파일 에러 메시지 사전', loadingState('불러오는 중…'));
  body.append(errCard);
  body.append(extraCard('이 단원 키워드', renderKeywordList(chapter)));
  body.append(extraCard('진도 초기화', renderResetCard(chapter, body)));

  const all = await loadErrors();
  if (!errCard.isConnected) return; // 그 사이 화면이 바뀌었다
  const slot = errCard.querySelector('.loading');
  if (slot) slot.replaceWith(renderErrorDict(all.filter((e) => e.chId === chapter.id)));
}

/* ── 용어사전 (§4.1 #/glossary) ──────────────────────── */

async function renderGlossary(token) {
  const body = el('div', { class: 'tab-body' }, loadingState());
  view.append(body);

  let terms;
  try {
    terms = await loadGlossary();
  } catch (err) {
    if (token !== renderToken) return;
    clear(body);
    body.append(errorState(err.message, () => renderRoute(currentRoute)));
    return;
  }
  if (token !== renderToken) return;

  clear(body);
  const input = el('input', {
    class: 'gl-search', type: 'search', inputmode: 'search',
    autocapitalize: 'off', autocomplete: 'off', spellcheck: 'false',
    placeholder: '용어 검색', 'aria-label': '용어 검색'
  });
  const count = el('p', { class: 'hint', role: 'status' });
  const list = el('ul', { class: 'gl-list' });

  const draw = () => {
    const q = input.value.trim().toLowerCase();
    // 단순 부분 문자열 필터
    const hits = q
      ? terms.filter((t) =>
          String(t.term || '').toLowerCase().includes(q) ||
          String(t.desc || '').toLowerCase().includes(q))
      : terms;

    clear(list);
    count.textContent = q ? `${hits.length}개 일치` : `전체 ${terms.length}개`;
    if (!hits.length) {
      list.append(el('li', { class: 'placeholder' }, el('p', { text: `"${input.value.trim()}" 에 해당하는 용어가 없습니다.` })));
      return;
    }
    for (const t of hits) {
      const meta = index.chapters.find((c) => c.id === t.chId);
      list.append(el('li', { class: 'gl-item' },
        el('p', { class: 'gl-item__term' },
          String(t.term || ''),
          meta ? el('span', { class: 'gl-item__ch', text: meta.title }) : null
        ),
        el('p', { class: 'gl-item__desc', text: String(t.desc || '') })
      ));
    }
  };

  input.addEventListener('input', draw);
  body.append(input, count, list);
  draw();
}

/* ── 설정 (§5.2 글자 크기 3단계 / 테마 3택) ──────────── */

function segmentedControl(label, options, current, onPick) {
  const group = el('div', { class: 'setting' });
  group.append(el('p', { class: 'setting__label', id: `set-${label}`, text: label }));
  const row = el('div', { class: 'setting__row', role: 'group', 'aria-labelledby': `set-${label}` });
  for (const [value, text] of options) {
    const active = value === current;
    row.append(el('button', {
      class: `setting__btn${active ? ' is-active' : ''}`, type: 'button', text,
      'aria-pressed': active ? 'true' : 'false',
      onclick: () => onPick(value)
    }));
  }
  group.append(row);
  return group;
}

function renderSettings() {
  const s = store.getSettings();
  const wrap = el('section', { class: 'settings' });
  wrap.append(el('h2', { class: 'settings__title', text: '설정' }));

  wrap.append(segmentedControl('테마',
    [['auto', '시스템'], ['light', '밝게'], ['dark', '어둡게']], s.theme,
    (v) => { store.setSettings({ theme: v }); applySettings(); renderRoute(currentRoute); }
  ));

  wrap.append(segmentedControl('글자 크기',
    [[0.9, '작게'], [1, '보통'], [1.15, '크게']], s.fontScale,
    (v) => { store.setSettings({ fontScale: v }); applySettings(); renderRoute(currentRoute); }
  ));

  wrap.append(renderDataSettings());
  return wrap;
}

/* ── 학습 데이터 백업 / 복원 (§9) ─────────────────────── */

const pad2 = (n) => String(n).padStart(2, '0');
function backupName() {
  const d = new Date();
  return `cstudy-backup-${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}.json`;
}

const summaryText = (s) => `단원 ${s.chapters}개 · 오답 ${s.wrong}문항 · 복습 ${s.queue}문항`;

/** 공유 시트 → 파일 다운로드 → 클립보드 순으로 되는 방법을 쓴다. */
async function shareBackup(json, name, status) {
  const file = (() => {
    try { return new File([json], name, { type: 'application/json' }); } catch { return null; }
  })();

  if (file && navigator.canShare && navigator.canShare({ files: [file] })) {
    try {
      await navigator.share({ files: [file], title: 'C 학습 백업' });
      status.textContent = '공유했습니다.';
      return;
    } catch (err) {
      if (err && err.name === 'AbortError') { status.textContent = '취소했습니다.'; return; }
      // 공유가 막히면 아래 다운로드로 물러난다
    }
  }

  try {
    const url = URL.createObjectURL(new Blob([json], { type: 'application/json' }));
    const a = el('a', { href: url, download: name });
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
    status.textContent = `${name} 으로 저장했습니다.`;
    return;
  } catch { /* 아래 클립보드로 */ }

  status.textContent = (await writeClipboard(json))
    ? '파일로 저장할 수 없어 클립보드에 복사했습니다. 메모앱에 붙여넣어 두세요.'
    : '내보내기에 실패했습니다.';
}

function renderDataSettings() {
  const group = el('div', { class: 'setting' });
  group.append(el('p', { class: 'setting__label', text: '학습 데이터' }));
  group.append(el('p', { class: 'hint', text: `지금 저장된 내용 — ${summaryText(store.dataSummary())}` }));

  const status = el('p', { class: 'data-status', role: 'status' });
  const panel = el('div', { class: 'data-import', hidden: true });

  const btnExport = el('button', {
    class: 'btn btn--block', type: 'button', text: '내보내기 (백업)',
    onclick: async () => {
      status.className = 'data-status';
      status.textContent = '준비 중…';
      const json = JSON.stringify(store.exportAll(), null, 2);
      await shareBackup(json, backupName(), status);
    }
  });

  const btnImport = el('button', {
    class: 'btn btn--block', type: 'button', text: '가져오기 (복원)',
    onclick: () => {
      panel.hidden = !panel.hidden;
      btnImport.setAttribute('aria-expanded', String(!panel.hidden));
    }
  });
  btnImport.setAttribute('aria-expanded', 'false');

  /* 복원 패널 */
  const fileInput = el('input', {
    class: 'data-file', type: 'file', accept: 'application/json,.json',
    'aria-label': '백업 파일 선택'
  });
  const pasteArea = el('textarea', {
    class: 'data-paste', rows: '4', spellcheck: 'false',
    autocapitalize: 'off', autocomplete: 'off',
    placeholder: '백업 내용을 여기에 붙여넣어도 됩니다',
    'aria-label': '백업 내용 붙여넣기'
  });

  const apply = (text) => {
    status.className = 'data-status';
    let bundle;
    try {
      bundle = JSON.parse(text);
    } catch {
      status.className = 'data-status is-error';
      status.textContent = '내용을 읽을 수 없습니다. 백업 파일이 맞는지 확인해 주세요.';
      return;
    }

    const checked = store.inspectBundle(bundle);
    if (!checked.ok) {
      status.className = 'data-status is-error';
      status.textContent = checked.error;
      return;
    }

    const when = checked.exportedAt ? new Date(checked.exportedAt).toLocaleString('ko-KR') : '시점 미상';
    const ok = window.confirm(
      `가져올 내용 (${when} 백업)\n${summaryText(checked.summary)}\n\n` +
      `지금 저장된 내용은 덮어쓰기됩니다.\n${summaryText(store.dataSummary())}\n\n계속할까요?`
    );
    if (!ok) { status.textContent = '취소했습니다.'; return; }

    const result = store.importAll(bundle);
    if (!result.ok) {
      status.className = 'data-status is-error';
      status.textContent = result.error;
      return;
    }
    lastUndo = result.undo;
    applySettings();   // 가져온 테마·글자 크기를 바로 반영한다
    renderRoute(currentRoute);
    window.scrollTo(0, document.documentElement.scrollHeight);
  };

  fileInput.addEventListener('change', () => {
    const f = fileInput.files && fileInput.files[0];
    if (!f) return;
    const reader = new FileReader();
    reader.onload = () => apply(String(reader.result));
    reader.onerror = () => {
      status.className = 'data-status is-error';
      status.textContent = '파일을 읽지 못했습니다.';
    };
    reader.readAsText(f);
  });

  panel.append(
    fileInput,
    pasteArea,
    el('button', {
      class: 'btn btn--block', type: 'button', text: '붙여넣은 내용 적용',
      onclick: () => {
        const t = pasteArea.value.trim();
        if (!t) {
          status.className = 'data-status is-error';
          status.textContent = '붙여넣은 내용이 없습니다.';
          return;
        }
        apply(t);
      }
    })
  );

  const actions = el('div', { class: 'data-actions' }, btnExport, btnImport);
  group.append(actions, panel, status);

  // 방금 덮어쓴 직후라면 되돌릴 기회를 준다(새로고침하면 사라진다).
  if (lastUndo) {
    const undone = el('div', { class: 'data-undo' },
      el('p', { class: 'data-undo__msg', text: '복원했습니다. 잘못 가져왔다면 되돌릴 수 있습니다.' }),
      el('button', {
        class: 'btn btn--block', type: 'button', text: '직전 상태로 되돌리기',
        onclick: () => {
          const result = store.importAll(lastUndo);
          if (!result.ok) {
            // 되돌리기도 실패했다면 기회를 없애지 않는다.
            status.className = 'data-status is-error';
            status.textContent = result.error;
            return;
          }
          lastUndo = null;
          applySettings();
          renderRoute(currentRoute);
          window.scrollTo(0, document.documentElement.scrollHeight);
        }
      })
    );
    group.append(undone);
  }
  return group;
}

// 가져오기 직전 상태. 메모리에만 둔다(§3.3 키를 늘리지 않기 위해).
let lastUndo = null;

const TAB_STUBS = {};

/** 단원 JSON을 확보한 뒤 본문을 그린다. 실패하면 재시도 버튼이 있는 에러 화면. */
async function withChapter(params, token, renderBody) {
  const meta = index.chapters.find((c) => c.id === params.chId);
  if (!meta) {
    view.append(emptyState('그런 단원이 없습니다.', '홈으로', '#/'));
    return;
  }
  if (meta.status === 'empty') {
    view.append(emptyState(`"${meta.title}" 단원은 아직 준비 중입니다.`, '홈으로', '#/'));
    return;
  }

  view.append(tabSegment(params.chId, params.tab));
  const body = el('div', { class: 'tab-body' }, loadingState());
  view.append(body);

  let chapter;
  try {
    chapter = await loadChapter(params.chId);
  } catch (err) {
    if (token !== renderToken) return; // 이미 다른 화면으로 넘어갔다
    console.warn('[cstudy] 단원 로드 실패', params.chId, err);
    clear(body);
    body.append(errorState(err.message, () => renderRoute(currentRoute)));
    return;
  }
  if (token !== renderToken) return;

  clear(body);
  renderBody(body, chapter);
}

const renderChapter = (params, token) => withChapter(params, token, (body, chapter) => {
  if (params.tab === 'summary') body.append(renderSummaryTab(chapter));
  else if (params.tab === 'concept') body.append(renderConceptTab(chapter));
  // 퀴즈는 세션을 해시에 담지 않는다 → 라우트를 벗어나면 진행 상태는 버려진다 (§4.1)
  else if (params.tab === 'quiz') renderQuizIntro(body, chapter);
  else if (params.tab === 'extra') renderExtraTab(body, chapter);
  else body.append(el('div', { class: 'placeholder' }, el('p', { text: TAB_STUBS[params.tab] || '' })));
});

const renderSection = (params, token) => withChapter(params, token, (body, chapter) => {
  body.append(renderSectionView(chapter, params.sectionId));
});

/* ── 아직 만들지 않은 화면 ────────────────────────────── */

const STUBS = {};

/* ── 셸 상태 ──────────────────────────────────────────── */

const TITLES = { home: 'C 학습', review: '복습', wrong: '오답노트', glossary: '용어사전' };

function updateShell(route) {
  const meta = route.params.chId ? index.chapters.find((c) => c.id === route.params.chId) : null;
  appTitle.textContent = meta ? meta.title : (TITLES[route.name] || 'C 학습');
  btnBack.hidden = route.name === 'home';

  for (const item of tabbar.querySelectorAll('.tabbar__item')) {
    const active = item.dataset.route === route.name;
    item.classList.toggle('is-active', active);
    if (active) item.setAttribute('aria-current', 'page');
    else item.removeAttribute('aria-current');
  }

  const due = dueCount();
  tabbarDue.hidden = due === 0;
  tabbarDue.textContent = due > 0 ? String(due) : '';
  document.title = route.name === 'home' ? 'C 학습' : `${appTitle.textContent} · C 학습`;
}

let currentRoute = { name: 'home', params: {} };

async function renderRoute(route) {
  currentRoute = route;
  const token = ++renderToken;

  updateShell(route);
  if (sheet.open) sheet.close();
  if (readWatcher) readWatcher.stop();
  clear(view);
  view.dataset.route = route.name;
  view.dataset.tab = route.params.tab || '';

  if (route.name === 'home') {
    view.append(renderHome());
    hydrateHomeBars();
  } else if (route.name === 'chapter') {
    await renderChapter(route.params, token);
  } else if (route.name === 'section') {
    await renderSection(route.params, token);
  } else if (route.name === 'review') {
    await renderReview(token);
  } else if (route.name === 'wrong') {
    await renderWrong(token);
  } else if (route.name === 'glossary') {
    await renderGlossary(token);
  } else {
    view.append(el('div', { class: 'placeholder' }, el('p', { text: STUBS[route.name] || '' })));
  }
}

/* ── 설정 적용 ────────────────────────────────────────── */

function applySettings() {
  const { theme, fontScale } = store.getSettings();
  const root = document.documentElement;
  if (theme === 'auto') root.removeAttribute('data-theme');
  else root.setAttribute('data-theme', theme);
  root.style.setProperty('--font-scale', String(fontScale));
}

/* ── 서비스 워커 ──────────────────────────────────────── */

function registerServiceWorker() {
  if (!('serviceWorker' in navigator)) return;
  // http://<LAN IP> 처럼 보안 컨텍스트가 아니면 어차피 불가능하다.
  // 시도조차 하지 않아야 브라우저가 콘솔에 등록 실패 오류를 찍지 않는다.
  if (!window.isSecureContext) return;
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('./sw.js')
      .catch((err) => console.warn('[cstudy] 서비스 워커 등록 실패', err));
  });
}

/* ── 부트 ─────────────────────────────────────────────── */

async function boot() {
  applySettings();
  initSheet();
  registerServiceWorker();
  btnBack.addEventListener('click', () => history.back());

  try {
    index = await loadIndex();
  } catch (err) {
    console.warn('[cstudy] 단원 목록을 불러오지 못했습니다.', err);
    clear(view);
    view.append(errorState(err.message, () => location.reload()));
    return;
  }

  await router.start(renderRoute);
}

boot();

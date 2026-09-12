// render.js — §3.2 블록 6종(p / code / tip / list / table / predict) → DOM.
//
// XSS 방어: 이 파일은 innerHTML / insertAdjacentHTML / outerHTML 을 절대 쓰지 않는다.
// 모든 콘텐츠 문자열은 createTextNode·textContent 로만 들어가므로 콘텐츠에 태그가 섞여
// 있어도 문자 그대로 표시될 뿐 파싱되지 않는다(= 이스케이프 후 조립과 동일한 결과).

const SUPPORTED = new Set(['p', 'code', 'tip', 'list', 'table', 'predict']);

/* ── 인라인 마크업 파서 ───────────────────────────────── */

// `코드` 가 **굵게** 보다 먼저 매칭되므로 코드 안의 별표는 문자 그대로 남는다.
const INLINE_RE = /`([^`\n]+)`|\*\*([^*\n]+)\*\*/g;

/** "본문 **굵게** 와 `코드`" → DocumentFragment */
export function renderInline(text) {
  const frag = document.createDocumentFragment();
  const src = String(text ?? '');
  let last = 0;
  let m;

  INLINE_RE.lastIndex = 0;
  while ((m = INLINE_RE.exec(src)) !== null) {
    if (m.index > last) frag.append(src.slice(last, m.index));
    if (m[1] !== undefined) {
      const code = document.createElement('code');
      code.className = 'inline-code';
      code.textContent = m[1];
      frag.append(code);
    } else {
      const strong = document.createElement('strong');
      strong.textContent = m[2];
      frag.append(strong);
    }
    last = m.index + m[0].length;
  }
  if (last < src.length) frag.append(src.slice(last));
  return frag;
}

/* ── 클립보드 ─────────────────────────────────────────── */

function legacyCopy(text) {
  const ta = document.createElement('textarea');
  ta.value = text;
  ta.setAttribute('readonly', '');
  ta.style.cssText = 'position:fixed;top:-1000px;opacity:0';
  document.body.appendChild(ta);
  ta.select();
  let ok = false;
  try { ok = document.execCommand('copy'); } catch { ok = false; }
  ta.remove();
  return ok;
}

/** 클립보드에 쓴다. 보안 컨텍스트가 아니면 예전 방식으로 물러난다. */
export async function writeClipboard(text) {
  try {
    if (navigator.clipboard && window.isSecureContext) {
      await navigator.clipboard.writeText(text);
      return true;
    }
  } catch { /* 아래 폴백 */ }
  return legacyCopy(text);                  // http://<LAN IP> 처럼 보안 컨텍스트가 아닐 때
}

async function copyText(text, btn) {
  const ok = await writeClipboard(text);
  btn.textContent = ok ? '복사됨' : '복사 실패';
  clearTimeout(btn._resetTimer);
  btn._resetTimer = setTimeout(() => { btn.textContent = '복사'; }, 1600);
}

/* ── 블록별 렌더러 ────────────────────────────────────── */

export function renderCodeBox(code, lang) { return makeCodeBox(code, lang); }

function makeCodeBox(code, lang) {
  const box = el('div', { class: 'codebox' });
  const bar = el('div', { class: 'codebox__bar' },
    el('span', { class: 'codebox__lang', text: lang || 'c' })
  );
  const btn = el('button', { class: 'codebox__copy', type: 'button', 'aria-live': 'polite', text: '복사' });
  btn.addEventListener('click', () => copyText(String(code ?? ''), btn));
  bar.append(btn);

  const pre = el('pre', { class: 'codebox__pre', tabindex: '0' },
    el('code', { text: String(code ?? '') })
  );
  box.append(bar, pre);
  return box;
}

const TIP_META = {
  info:    { icon: 'ℹ', label: '참고' },
  trap:    { icon: '⚠', label: '자주 하는 실수' },
  preview: { icon: '→', label: '앞으로 배울 내용' }
};

/** 출력 비교용 정규화: 줄 끝 공백·연속 공백·앞뒤 빈 줄만 무시한다(대소문자는 구분). */
const normOutput = (s) => String(s ?? '')
  .replace(/\r/g, '')
  .split('\n')
  .map((line) => line.trim().replace(/[ \t]+/g, ' '))
  .join('\n')
  .trim();

function renderPredict(block) {
  const wrap = el('section', { class: 'predict', 'aria-label': '출력 예측' });
  wrap.append(el('p', { class: 'predict__label', text: '출력 예측하기' }));
  wrap.append(makeCodeBox(block.code, 'c'));

  const field = el('textarea', {
    class: 'predict__input',
    rows: '2',
    spellcheck: 'false',
    autocapitalize: 'off',
    autocomplete: 'off',
    placeholder: '이 코드의 출력은?',
    'aria-label': '출력 예측 입력'
  });
  const submit = el('button', { class: 'btn btn--primary predict__submit', type: 'button', text: '확인' });
  const result = el('div', { class: 'predict__result', role: 'status', hidden: true });

  submit.addEventListener('click', () => {
    const typed = field.value;
    const correct = normOutput(typed) === normOutput(block.answer);
    const answered = typed.trim().length > 0;

    while (result.firstChild) result.removeChild(result.firstChild);
    result.className = 'predict__result' +
      (answered ? (correct ? ' is-correct' : ' is-wrong') : '');

    if (answered) {
      // 색만으로 구분하지 않는다: 아이콘 + 문구 병기 (§7)
      result.append(el('p', { class: 'predict__verdict' },
        el('span', { class: 'predict__icon', 'aria-hidden': 'true', text: correct ? '✓' : '✕' }),
        correct ? '맞았습니다' : '다시 확인해 보세요'
      ));
    }
    result.append(el('p', { class: 'predict__answer-label', text: '정답' }));
    result.append(el('pre', { class: 'predict__answer' }, el('code', { text: String(block.answer ?? '') })));
    if (block.explain) {
      result.append(el('p', { class: 'predict__explain' }, renderInline(block.explain)));
    }
    result.hidden = false;
    // 정답 여부는 채점만 하고 저장하지 않는다 (§4.3-②)
    submit.textContent = '다시 확인';
  });

  wrap.append(el('div', { class: 'predict__form' }, field, submit), result);
  return wrap;
}

const RENDERERS = {
  p: (b) => el('p', { class: 'blk-p' }, renderInline(b.text)),

  code: (b) => {
    const fig = el('figure', { class: 'blk-code' }, makeCodeBox(b.code, b.lang));
    if (b.caption) fig.append(el('figcaption', { class: 'blk-code__caption', text: b.caption }));
    return fig;
  },

  tip: (b) => {
    const tone = TIP_META[b.tone] ? b.tone : 'info';
    const meta = TIP_META[tone];
    return el('aside', { class: `blk-tip blk-tip--${tone}` },
      el('p', { class: 'blk-tip__head' },
        el('span', { class: 'blk-tip__icon', 'aria-hidden': 'true', text: meta.icon }),
        meta.label
      ),
      el('p', { class: 'blk-tip__body' }, renderInline(b.text))
    );
  },

  list: (b) => {
    const ul = el('ul', { class: 'blk-list' });
    for (const item of (Array.isArray(b.items) ? b.items : [])) {
      ul.append(el('li', {}, renderInline(item)));
    }
    return ul;
  },

  table: (b) => {
    const table = el('table', { class: 'blk-table__el' });
    if (Array.isArray(b.head) && b.head.length) {
      const tr = el('tr');
      for (const h of b.head) tr.append(el('th', { scope: 'col' }, renderInline(h)));
      table.append(el('thead', {}, tr));
    }
    const tbody = el('tbody');
    for (const row of (Array.isArray(b.rows) ? b.rows : [])) {
      const tr = el('tr');
      for (const cell of (Array.isArray(row) ? row : [row])) tr.append(el('td', {}, renderInline(cell)));
      tbody.append(tr);
    }
    table.append(tbody);
    // 표 내부에서만 가로 스크롤 (§5.3)
    return el('div', { class: 'blk-table', tabindex: '0', role: 'region', 'aria-label': '표' }, table);
  },

  predict: renderPredict
};

/** 블록 배열 → DocumentFragment. 미지원 타입은 콘솔 경고만 남기고 건너뛴다. */
export function renderBlocks(blocks) {
  const frag = document.createDocumentFragment();
  for (const block of (Array.isArray(blocks) ? blocks : [])) {
    if (!block || !SUPPORTED.has(block.type)) {
      console.warn('[render] 지원하지 않는 블록 타입 — 건너뜁니다:', block && block.type);
      continue;
    }
    frag.append(RENDERERS[block.type](block));
  }
  return frag;
}

/* ── 내부 DOM 헬퍼 ────────────────────────────────────── */

function el(tag, opts = {}, ...children) {
  const node = document.createElement(tag);
  for (const [key, value] of Object.entries(opts)) {
    if (value === null || value === undefined || value === false) continue;
    if (key === 'class') node.className = value;
    else if (key === 'text') node.textContent = value;
    else node.setAttribute(key, value === true ? '' : String(value));
  }
  for (const child of children.flat()) {
    if (child === null || child === undefined || child === false) continue;
    node.append(child);
  }
  return node;
}

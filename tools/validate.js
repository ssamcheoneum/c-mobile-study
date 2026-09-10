#!/usr/bin/env node
/**
 * validate.js — 콘텐츠 스키마 검증 (§7)
 * Node 표준 모듈만 사용. 문제가 하나라도 있으면 종료 코드 1.
 *
 *   node tools/validate.js
 */

'use strict';

const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const CONTENT = path.join(ROOT, 'content');

const BLOCK_TYPES = new Set(['p', 'code', 'tip', 'list', 'table', 'predict']);
const QUIZ_TYPES = new Set(['mcq', 'ox', 'blank', 'output']);
const TIP_TONES = new Set(['info', 'trap', 'preview']);
const STATUSES = new Set(['ready', 'draft', 'empty']);

const problems = [];
const fail = (where, msg) => problems.push(`${where}: ${msg}`);

function readJSON(file) {
  const full = path.join(CONTENT, file);
  if (!fs.existsSync(full)) return { missing: true };
  try {
    return { data: JSON.parse(fs.readFileSync(full, 'utf8')) };
  } catch (err) {
    return { parseError: err.message };
  }
}

/* ── index.json (§3.1) ────────────────────────────────── */

function validateIndex() {
  const { data, missing, parseError } = readJSON('index.json');
  if (missing) { fail('index.json', '파일이 없습니다'); return []; }
  if (parseError) { fail('index.json', `JSON 파싱 실패 — ${parseError}`); return []; }
  if (!Array.isArray(data.chapters)) { fail('index.json', 'chapters 배열이 없습니다'); return []; }

  const seen = new Set();
  for (const [i, ch] of data.chapters.entries()) {
    const at = `index.json[${i}]`;
    for (const key of ['id', 'order', 'title', 'status']) {
      if (ch[key] === undefined) fail(at, `필수 필드 누락: ${key}`);
    }
    if (ch.id && !/^ch\d{2}$/.test(ch.id)) fail(at, `id 형식이 chXX 가 아닙니다: ${ch.id}`);
    if (ch.id && seen.has(ch.id)) fail(at, `중복된 단원 id: ${ch.id}`);
    if (ch.id) seen.add(ch.id);
    if (ch.status && !STATUSES.has(ch.status)) fail(at, `알 수 없는 status: ${ch.status}`);
    if (ch.estMin !== undefined && typeof ch.estMin !== 'number') fail(at, 'estMin 은 숫자여야 합니다');
  }
  return data.chapters;
}

/* ── chXX.json (§3.2) ─────────────────────────────────── */

function validateBlock(block, at) {
  if (!block || typeof block !== 'object') { fail(at, '블록이 객체가 아닙니다'); return; }
  if (!BLOCK_TYPES.has(block.type)) {
    fail(at, `지원하지 않는 블록 타입: ${JSON.stringify(block.type)}`);
    return;
  }
  switch (block.type) {
    case 'p':
      if (typeof block.text !== 'string' || !block.text) fail(at, 'p 블록에 text 가 없습니다');
      break;
    case 'code':
      if (typeof block.code !== 'string' || !block.code) fail(at, 'code 블록에 code 가 없습니다');
      break;
    case 'tip':
      if (typeof block.text !== 'string' || !block.text) fail(at, 'tip 블록에 text 가 없습니다');
      if (!TIP_TONES.has(block.tone)) fail(at, `tip.tone 은 info/trap/preview 중 하나여야 합니다: ${block.tone}`);
      break;
    case 'list':
      if (!Array.isArray(block.items) || !block.items.length) fail(at, 'list 블록에 items 가 없습니다');
      break;
    case 'table': {
      if (!Array.isArray(block.rows) || !block.rows.length) { fail(at, 'table 블록에 rows 가 없습니다'); break; }
      const width = Array.isArray(block.head) ? block.head.length : null;
      block.rows.forEach((row, r) => {
        if (!Array.isArray(row)) fail(`${at}.rows[${r}]`, '행이 배열이 아닙니다');
        else if (width !== null && row.length !== width) {
          fail(`${at}.rows[${r}]`, `열 수가 head(${width})와 다릅니다: ${row.length}`);
        }
      });
      break;
    }
    case 'predict':
      if (typeof block.code !== 'string' || !block.code) fail(at, 'predict 블록에 code 가 없습니다');
      if (typeof block.answer !== 'string' || !block.answer) fail(at, 'predict 블록에 answer 가 없습니다');
      break;
  }
}

function validateQuestion(q, at, seenQids) {
  if (!q || typeof q !== 'object') { fail(at, '문항이 객체가 아닙니다'); return; }
  if (!q.id) fail(at, '필수 필드 누락: id');
  else if (seenQids.has(q.id)) fail(at, `중복된 qid: ${q.id}`);
  else seenQids.add(q.id);

  if (!QUIZ_TYPES.has(q.type)) { fail(at, `지원하지 않는 문항 타입: ${JSON.stringify(q.type)}`); return; }
  if (typeof q.stem !== 'string' || !q.stem) fail(at, 'stem 이 없습니다');
  if (q.level !== undefined && ![1, 2, 3].includes(q.level)) fail(at, `level 은 1/2/3 이어야 합니다: ${q.level}`);
  if (q.tags !== undefined && !Array.isArray(q.tags)) fail(at, 'tags 는 배열이어야 합니다');

  if (q.type === 'mcq' || q.type === 'output') {
    if (!Array.isArray(q.choices) || q.choices.length < 2) {
      fail(at, 'choices 가 2개 이상이어야 합니다');
    } else if (!Number.isInteger(q.answer) || q.answer < 0 || q.answer >= q.choices.length) {
      fail(at, `answer 인덱스가 범위를 벗어났습니다: ${q.answer} (choices ${q.choices.length}개)`);
    }
  } else if (q.type === 'ox') {
    if (typeof q.answer !== 'boolean') fail(at, `ox 의 answer 는 true/false 여야 합니다: ${JSON.stringify(q.answer)}`);
  } else if (q.type === 'blank') {
    if (!Array.isArray(q.answer) || !q.answer.length) fail(at, 'blank 의 answer 는 비어 있지 않은 배열이어야 합니다');
    else if (q.answer.some((a) => typeof a !== 'string' || !a.trim())) fail(at, 'blank 의 answer 에 빈 값이 있습니다');
  }

  if (typeof q.explain !== 'string' || !q.explain) fail(at, 'explain 이 없습니다');
}

function validateChapter(meta, seenQids) {
  const file = `${meta.id}.json`;
  const { data, missing, parseError } = readJSON(file);
  if (missing) { fail(file, '파일이 없습니다'); return; }
  if (parseError) { fail(file, `JSON 파싱 실패 — ${parseError}`); return; }

  if (data.id !== meta.id) fail(file, `id 가 index.json 과 다릅니다: ${data.id} ≠ ${meta.id}`);
  if (typeof data.title !== 'string' || !data.title) fail(file, 'title 이 없습니다');

  const summary = data.summary;
  if (!summary || typeof summary !== 'object') fail(file, 'summary 객체가 없습니다');
  else {
    if (typeof summary.oneLiner !== 'string') fail(file, 'summary.oneLiner 가 문자열이 아닙니다');
    if (!Array.isArray(summary.bullets)) fail(file, 'summary.bullets 가 배열이 아닙니다');
    if (!Array.isArray(summary.keywords)) fail(file, 'summary.keywords 가 배열이 아닙니다');
    else summary.keywords.forEach((kw, i) => {
      if (!kw || typeof kw.term !== 'string' || !kw.term) fail(`${file}.summary.keywords[${i}]`, 'term 이 없습니다');
      if (!kw || typeof kw.desc !== 'string' || !kw.desc) fail(`${file}.summary.keywords[${i}]`, 'desc 가 없습니다');
    });
  }

  if (!Array.isArray(data.sections)) fail(file, 'sections 가 배열이 아닙니다');
  else {
    const seenSections = new Set();
    data.sections.forEach((sec, s) => {
      const at = `${file}.sections[${s}]`;
      if (!sec || typeof sec !== 'object') { fail(at, '섹션이 객체가 아닙니다'); return; }
      if (!sec.id) fail(at, 'id 가 없습니다');
      else if (seenSections.has(sec.id)) fail(at, `중복된 섹션 id: ${sec.id}`);
      else seenSections.add(sec.id);
      if (typeof sec.title !== 'string' || !sec.title) fail(at, 'title 이 없습니다');
      if (!Array.isArray(sec.body)) fail(at, 'body 가 배열이 아닙니다');
      else sec.body.forEach((b, i) => validateBlock(b, `${at}.body[${i}] (${sec.id})`));
    });
  }

  if (!Array.isArray(data.quiz)) fail(file, 'quiz 가 배열이 아닙니다');
  else data.quiz.forEach((q, i) => validateQuestion(q, `${file}.quiz[${i}]`, seenQids));

  // status:"ready" 인데 알맹이가 없으면 배포 사고다.
  if (meta.status === 'ready') {
    if (!Array.isArray(data.sections) || !data.sections.length) fail(file, 'status 가 ready 인데 sections 가 비어 있습니다');
    if (!Array.isArray(data.quiz) || !data.quiz.length) fail(file, 'status 가 ready 인데 quiz 가 비어 있습니다');
  }
}

/* ── 보조 콘텐츠 ──────────────────────────────────────── */

function validateAux(chapterIds) {
  const gl = readJSON('glossary.json');
  if (gl.parseError) fail('glossary.json', `JSON 파싱 실패 — ${gl.parseError}`);
  else if (!gl.missing) {
    if (!Array.isArray(gl.data.terms)) fail('glossary.json', 'terms 가 배열이 아닙니다');
    else gl.data.terms.forEach((t, i) => {
      const at = `glossary.json.terms[${i}]`;
      if (!t || typeof t.term !== 'string' || !t.term) fail(at, 'term 이 없습니다');
      if (!t || typeof t.desc !== 'string' || !t.desc) fail(at, 'desc 가 없습니다');
      if (t && t.chId && !chapterIds.has(t.chId)) fail(at, `없는 단원을 가리킵니다: ${t.chId}`);
    });
  }

  const er = readJSON('errors.json');
  if (er.parseError) fail('errors.json', `JSON 파싱 실패 — ${er.parseError}`);
  else if (!er.missing) {
    if (!Array.isArray(er.data.errors)) fail('errors.json', 'errors 가 배열이 아닙니다');
    else er.data.errors.forEach((e, i) => {
      const at = `errors.json.errors[${i}]`;
      for (const key of ['message', 'cause', 'fix']) {
        if (!e || typeof e[key] !== 'string' || !e[key]) fail(at, `${key} 가 없습니다`);
      }
      if (e && e.chId && !chapterIds.has(e.chId)) fail(at, `없는 단원을 가리킵니다: ${e.chId}`);
    });
  }
}

/* ── 실행 ─────────────────────────────────────────────── */

function main() {
  const chapters = validateIndex();
  const seenQids = new Set();
  for (const meta of chapters) {
    if (meta && meta.id) validateChapter(meta, seenQids);
  }
  validateAux(new Set(chapters.map((c) => c && c.id)));

  const readyCount = chapters.filter((c) => c && c.status === 'ready').length;
  if (problems.length) {
    console.error(`\n✕ 문제 ${problems.length}건\n`);
    for (const p of problems) console.error(`  - ${p}`);
    console.error('');
    process.exit(1);
  }
  console.log(`✓ 검증 통과 — 단원 ${chapters.length}개(ready ${readyCount}개), 문항 ${seenQids.size}개`);
}

main();

#!/usr/bin/env node
/**
 * tools/verify-c.js — 콘텐츠에 적힌 "출력 결과"를 실제 컴파일·실행 결과와 대조한다.
 *
 * 검사 대상
 *   1. predict 블록          : code 를 실행한 표준출력이 answer 와 같은가
 *   2. output 타입 퀴즈      : code 를 실행한 표준출력이 choices[answer] 와 같은가
 *
 * 판정
 *   PASS   실행 결과가 정답과 일치
 *   FAIL   실행 결과가 정답과 다름  ← 콘텐츠 오류. 반드시 고쳐야 한다.
 *   MANUAL 실행으로 판정할 수 없음(컴파일 에러가 정답인 문항, 가상의 주소값 등)
 *
 * 사용법
 *   node tools/verify-c.js              전체 검사, 요약을 화면에
 *   node tools/verify-c.js --report FILE 상세 결과를 파일로 (한글 깨짐 없이 읽기용)
 *   node tools/verify-c.js --only ch06   특정 단원만
 *
 * 컴파일러는 gcc / clang / MSVC(cl.exe) 중 찾은 것을 쓴다.
 * Node 표준 모듈만 사용한다(§7).
 */

'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync, execSync } = require('child_process');

const ROOT = path.join(__dirname, '..');
const CONTENT = path.join(ROOT, 'content');

/* ── 인자 ─────────────────────────────────────────────── */

const argv = process.argv.slice(2);
const argOf = (name) => {
  const i = argv.indexOf(name);
  return i >= 0 ? argv[i + 1] : null;
};
const REPORT = argOf('--report');
const ONLY = argOf('--only');

/* ── 컴파일러 탐색 ────────────────────────────────────── */

function which(cmd) {
  try {
    const out = execSync(process.platform === 'win32' ? `where ${cmd}` : `which ${cmd}`,
      { stdio: ['ignore', 'pipe', 'ignore'] }).toString().trim();
    return out.split(/\r?\n/)[0] || null;
  } catch { return null; }
}

/** MSVC 는 헤더·라이브러리 경로가 환경변수로 들어와야 한다. vcvars 를 한 번만 실행해 캐시한다. */
function msvcEnv() {
  const globs = [
    'C:\\Program Files\\Microsoft Visual Studio',
    'C:\\Program Files (x86)\\Microsoft Visual Studio'
  ];
  for (const base of globs) {
    if (!fs.existsSync(base)) continue;
    for (const ver of fs.readdirSync(base)) {
      for (const ed of ['Community', 'Professional', 'Enterprise', 'BuildTools']) {
        const bat = path.join(base, ver, ed, 'VC', 'Auxiliary', 'Build', 'vcvars64.bat');
        if (!fs.existsSync(bat)) continue;
        try {
          const dump = execSync(`"${bat}" >nul 2>&1 && set`, { shell: 'cmd.exe', maxBuffer: 1 << 24 }).toString();
          const env = { ...process.env };
          for (const line of dump.split(/\r?\n/)) {
            const eq = line.indexOf('=');
            if (eq > 0) env[line.slice(0, eq)] = line.slice(eq + 1);
          }
          return env;
        } catch { /* 다음 후보 */ }
      }
    }
  }
  return null;
}

function findCompiler() {
  for (const cc of ['gcc', 'clang']) {
    const p = which(cc);
    if (p) return { kind: 'gcc', bin: p, env: process.env, name: cc };
  }
  const env = msvcEnv();
  if (env) return { kind: 'msvc', bin: 'cl.exe', env, name: 'MSVC cl.exe' };
  return null;
}

/* ── 코드 조각 → 완전한 프로그램 ──────────────────────── */

const HEADERS = '#include <stdio.h>\n#include <string.h>\n#include <stdlib.h>\n#include <math.h>\n#include <stddef.h>\n';

/** 조각을 그대로 컴파일할 수 있는 형태로 감싼다. fx 는 verify-fixtures.json 의 항목. */
function buildProgram(code, fx) {
  if (fx && fx.program) return fx.program;

  const pre = fx && fx.prepend ? '    ' + fx.prepend + '\n' : '';
  const post = fx && fx.append ? '\n    ' + fx.append : '';

  const hasMain = /\bint\s+main\s*\(/.test(code);
  if (hasMain && !pre && !post) {
    // 이미 완전한 프로그램. 헤더가 없으면 붙여준다.
    return /#include/.test(code) ? code : HEADERS + '\n' + code;
  }
  if (hasMain) {
    // 완전한 프로그램인데 보조 문장이 필요한 경우: return 0; 앞에 끼워 넣는다.
    const src = /#include/.test(code) ? code : HEADERS + '\n' + code;
    return src.replace(/(\n\s*)return\s+0\s*;/, `\n${pre}${post}$1return 0;`);
  }
  // 함수 정의가 섞인 조각(예: void f(int*) { ... } 뒤에 호출문)은 그대로 감싸면 깨진다.
  // 최상위 함수 정의를 앞으로 빼고 나머지를 main 안에 넣는다.
  const { defs, body } = splitTopLevelFunctions(code);
  return `${HEADERS}\n${defs}\nint main(void) {\n${pre}${body}${post}\n    return 0;\n}\n`;
}

/** 픽스처가 지정한 파일을 실행 디렉터리에 만든다. */
function writeFixtureFiles(dir, fx) {
  if (!fx || !fx.files) return;
  for (const [name, spec] of Object.entries(fx.files)) {
    const p = path.join(dir, name);
    if (typeof spec === 'string') fs.writeFileSync(p, spec, 'utf8');
    else fs.writeFileSync(p, Buffer.alloc(spec.size || 0, (spec.byte || 'x').charCodeAt(0)));
  }
}

/** 최상위 함수 정의와 나머지 문장을 분리한다. */
function splitTopLevelFunctions(code) {
  const lines = code.split('\n');
  const defs = [];
  const body = [];
  let depth = 0;
  let inDef = false;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (!inDef && depth === 0) {
      // "타입 이름(...) {" 또는 "타입 이름(...)" 다음 줄이 "{" 인 형태
      const looksLikeDef = /^\s*(?:static\s+|const\s+)*(?:void|int|char|double|float|long|short|unsigned|size_t|struct\s+\w+|[A-Z]\w*)\s*\**\s*\w+\s*\([^;]*\)\s*\{/.test(line);
      if (looksLikeDef) inDef = true;
    }
    if (inDef) {
      defs.push(line);
      depth += (line.match(/\{/g) || []).length;
      depth -= (line.match(/\}/g) || []).length;
      if (depth <= 0) { inDef = false; depth = 0; }
    } else {
      body.push('    ' + line);
    }
  }
  return { defs: defs.join('\n'), body: body.join('\n') };
}

/** 코드 주석의 "입력: 3 7" 을 표준입력으로 쓴다. */
function stdinFromCode(code) {
  const m = code.match(/입력\s*[:：]\s*([^\n*]*)/);
  if (!m) return null;
  const v = m[1].trim().replace(/\*\/\s*$/, '').trim();
  return v ? v + '\n' : null;
}

/* ── 비교용 정규화 ────────────────────────────────────── */

// 줄 끝 공백과 앞뒤 빈 줄만 무시한다. 줄 안의 공백은 의미가 있으므로 보존한다.
const norm = (s) => String(s ?? '')
  .replace(/\r\n?/g, '\n')
  .split('\n')
  .map((l) => l.replace(/[ \t]+$/, ''))
  .join('\n')
  .replace(/^\n+/, '')
  .replace(/\n+$/, '');

/** 실행으로 판정할 수 없는 정답인가 */
function isNonLiteral(text) {
  return /컴파일\s*에러|컴파일에러|에러|오류|아무것도|무한\s*반복|출력되지|주소값|쓰레기값|반복한다|^\d+번$|번$/.test(String(text).trim());
}

/* ── 컴파일 & 실행 ────────────────────────────────────── */

function runOne(cc, dir, source, input) {
  const src = path.join(dir, 'snippet.c');
  const exe = path.join(dir, process.platform === 'win32' ? 'snippet.exe' : 'snippet.out');
  fs.writeFileSync(src, source, 'utf8');
  for (const f of ['snippet.exe', 'snippet.out', 'snippet.obj']) {
    try { fs.unlinkSync(path.join(dir, f)); } catch {}
  }

  // 컴파일
  try {
    if (cc.kind === 'gcc') {
      execFileSync(cc.bin, ['-std=c11', '-w', src, '-o', exe, '-lm'],
        { cwd: dir, env: cc.env, stdio: ['ignore', 'pipe', 'pipe'], timeout: 30000 });
    } else {
      execFileSync(cc.bin, ['/nologo', '/utf-8', '/w', src, `/Fe:${exe}`, `/Fo:${dir}\\`],
        { cwd: dir, env: cc.env, stdio: ['ignore', 'pipe', 'pipe'], timeout: 30000 });
    }
  } catch (e) {
    const msg = [e.stdout, e.stderr].map((b) => (b ? b.toString() : '')).join('\n').trim();
    return { ok: false, stage: 'compile', detail: msg.split('\n').slice(0, 6).join('\n') };
  }

  // 실행
  try {
    const out = execFileSync(exe, [], {
      cwd: dir, input: input || '', timeout: 10000,
      stdio: ['pipe', 'pipe', 'pipe'], maxBuffer: 1 << 20
    });
    return { ok: true, stdout: out.toString('utf8') };
  } catch (e) {
    if (e.stdout !== undefined && e.status !== null && e.status !== undefined) {
      // 0이 아닌 종료 코드여도 출력은 유효할 수 있다
      return { ok: true, stdout: (e.stdout || Buffer.alloc(0)).toString('utf8'), exitCode: e.status };
    }
    return { ok: false, stage: 'run', detail: String(e.message).split('\n')[0] };
  }
}

/* ── 대상 수집 ────────────────────────────────────────── */

function loadFixtures() {
  const p = path.join(__dirname, 'verify-fixtures.json');
  if (!fs.existsSync(p)) return {};
  const raw = JSON.parse(fs.readFileSync(p, 'utf8'));
  delete raw._readme;
  return raw;
}

function collectCases() {
  const index = JSON.parse(fs.readFileSync(path.join(CONTENT, 'index.json'), 'utf8'));
  const cases = [];

  for (const ch of index.chapters) {
    if (ONLY && ch.id !== ONLY) continue;
    const file = path.join(CONTENT, `${ch.id}.json`);
    if (!fs.existsSync(file)) continue;
    const d = JSON.parse(fs.readFileSync(file, 'utf8'));

    for (const sec of d.sections || []) {
      (sec.body || []).forEach((b, i) => {
        if (b && b.type === 'predict') {
          cases.push({
            id: `${ch.id}/${sec.id}#${i}`, kind: 'predict',
            code: b.code, expected: b.answer, where: `${ch.id}.json sections[${sec.id}].body[${i}]`
          });
        }
      });
    }
    for (const q of d.quiz || []) {
      if (q && q.type === 'output' && q.code) {
        cases.push({
          id: q.id, kind: 'output',
          code: q.code, expected: (q.choices || [])[q.answer], where: `${ch.id}.json quiz ${q.id}`
        });
      }
    }
  }
  return cases;
}

/* ── 메인 ─────────────────────────────────────────────── */

function main() {
  const cc = findCompiler();
  if (!cc) {
    console.error('C 컴파일러를 찾지 못했습니다. gcc / clang / Visual Studio 중 하나가 필요합니다.');
    process.exit(2);
  }

  const fixtures = loadFixtures();
  const cases = collectCases();
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cverify-'));
  const results = [];

  for (const c of cases) {
    const fx = fixtures[c.id] || null;

    // 원리적으로 실행 검증이 불가능하다고 명시적으로 면제한 경우만 MANUAL
    if (fx && fx.waive) {
      results.push({ ...c, verdict: 'MANUAL', reason: fx.waive });
      continue;
    }

    // 정답이 문장형인데 픽스처가 없으면 그냥 넘기지 않고 FAIL 로 드러낸다.
    if (isNonLiteral(c.expected) && !fx) {
      results.push({
        ...c, verdict: 'FAIL',
        reason: '정답이 실행 출력 형태가 아닌데 검증 픽스처가 없습니다',
        want: String(c.expected), got: '(실행 안 함)'
      });
      continue;
    }

    writeFixtureFiles(dir, fx);
    const source = buildProgram(c.code, fx);
    const r = runOne(cc, dir, source, stdinFromCode(c.code));

    if (!r.ok) {
      results.push({
        ...c, verdict: 'FAIL',
        reason: `${r.stage} 실패 — 픽스처(tools/verify-fixtures.json)가 필요합니다`,
        detail: r.detail, source, want: String(c.expected), got: '(실행 실패)'
      });
      continue;
    }
    const got = norm(r.stdout);
    const want = norm(fx && fx.expect !== undefined ? fx.expect : c.expected);

    // 빈 기대값 == 빈 출력 은 "검증했다"고 볼 수 없다. 통과로 세지 않는다.
    if (want === '') {
      results.push({
        ...c, verdict: 'FAIL', reason: '기대 출력이 비어 있어 검증이 성립하지 않습니다',
        want, got, source
      });
      continue;
    }

    results.push({
      ...c, verdict: got === want ? 'PASS' : 'FAIL',
      got, want, source, exitCode: r.exitCode,
      viaFixture: !!fx, note: fx && fx.note
    });
  }

  try { fs.rmSync(dir, { recursive: true, force: true }); } catch {}

  const n = (v) => results.filter((r) => r.verdict === v).length;
  const summary = `컴파일러: ${cc.name}\n대상 ${results.length}건 — PASS ${n('PASS')} / FAIL ${n('FAIL')} / MANUAL ${n('MANUAL')}`;

  if (REPORT) {
    const lines = [summary, ''];
    for (const v of ['FAIL', 'MANUAL', 'PASS']) {
      const items = results.filter((r) => r.verdict === v);
      if (!items.length) continue;
      lines.push(`${'='.repeat(60)}`, `${v} — ${items.length}건`, '');
      for (const r of items) {
        lines.push(`[${r.verdict}] ${r.id}  (${r.kind})${r.viaFixture ? '  ※픽스처 사용' : ''}`);
        lines.push(`  위치: ${r.where}`);
        if (r.note) lines.push(`  픽스처 사유: ${r.note}`);
        if (v === 'FAIL') {
          if (r.reason) lines.push(`  사유: ${r.reason}`);
          lines.push(`  기대: ${JSON.stringify(r.want)}`);
          lines.push(`  실제: ${JSON.stringify(r.got)}`);
          if (r.detail) lines.push(`  컴파일러: ${r.detail.split('\n').map((l) => '        ' + l).join('\n').trim()}`);
          if (r.source) {
            lines.push('  --- 컴파일한 소스 ---');
            lines.push(r.source.split('\n').map((l) => '  | ' + l).join('\n'));
          }
        } else if (v === 'MANUAL') {
          lines.push(`  면제 사유: ${r.reason}`);
          lines.push(`  정답: ${JSON.stringify(r.expected)}`);
        }
        lines.push('');
      }
    }
    fs.writeFileSync(REPORT, lines.join('\n'), 'utf8');
    console.log(summary);
    console.log(`상세 보고서: ${REPORT}`);
  } else {
    console.log(summary);
    for (const r of results.filter((x) => x.verdict === 'FAIL')) {
      console.log(`  FAIL ${r.id}: 기대 ${JSON.stringify(r.want)} / 실제 ${JSON.stringify(r.got)}`);
    }
  }

  process.exit(n('FAIL') > 0 ? 1 : 0);
}

main();

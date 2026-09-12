// sw.js — 오프라인 캐시 (§6 Stage 7-2)
//
// 앱 셸: 캐시 우선 (빠른 실행)
// content/*.json: 네트워크 우선 → 실패 시 캐시 (콘텐츠 갱신을 바로 반영)
//
// ⚠ 앱 코드(js/css/html)를 고쳤으면 반드시 CACHE_VERSION 을 올린다.
//    올리지 않으면 캐시 우선 정책 때문에 기기에 예전 코드가 계속 남는다.

const CACHE_VERSION = 'v2';
const CACHE_NAME = `cstudy-${CACHE_VERSION}`;

// 서브디렉터리 배포(GitHub Pages)에서도 깨지지 않도록 전부 상대 경로.
const SHELL = [
  './',
  './index.html',
  './manifest.webmanifest',
  './css/style.css',
  './js/app.js',
  './js/router.js',
  './js/store.js',
  './js/loader.js',
  './js/render.js',
  './js/quiz.js',
  './js/review.js',
  './icons/icon-192.png',
  './icons/icon-512.png',
  './icons/icon-maskable-512.png',
  './content/index.json'
];

self.addEventListener('install', (event) => {
  event.waitUntil((async () => {
    const cache = await caches.open(CACHE_NAME);
    // 하나가 실패해도 설치 자체는 끝내도록 개별 처리한다.
    await Promise.allSettled(SHELL.map((url) => cache.add(new Request(url, { cache: 'reload' }))));
    await self.skipWaiting();
  })());
});

self.addEventListener('activate', (event) => {
  event.waitUntil((async () => {
    const keys = await caches.keys();
    await Promise.all(keys.filter((k) => k !== CACHE_NAME).map((k) => caches.delete(k)));
    await self.clients.claim();
  })());
});

const isContent = (url) => url.pathname.includes('/content/') && url.pathname.endsWith('.json');

/** 네트워크 우선 → 실패하면 캐시 (콘텐츠용) */
async function networkFirst(request) {
  const cache = await caches.open(CACHE_NAME);
  try {
    const res = await fetch(request);
    if (res && res.ok) cache.put(request, res.clone());
    return res;
  } catch (err) {
    const hit = await cache.match(request);
    if (hit) return hit;
    throw err;
  }
}

/** 캐시 우선 → 없으면 네트워크 (앱 셸용) */
async function cacheFirst(request) {
  const cache = await caches.open(CACHE_NAME);
  const hit = await cache.match(request);
  if (hit) return hit;
  const res = await fetch(request);
  if (res && res.ok && new URL(request.url).origin === self.location.origin) {
    cache.put(request, res.clone());
  }
  return res;
}

self.addEventListener('fetch', (event) => {
  const { request } = event;
  if (request.method !== 'GET') return;

  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return; // 외부 요청은 손대지 않는다

  // 해시 라우팅이라 모든 화면 이동은 같은 문서를 연다.
  if (request.mode === 'navigate') {
    event.respondWith((async () => {
      const cache = await caches.open(CACHE_NAME);
      try {
        return await fetch(request);
      } catch (err) {
        return (await cache.match('./index.html')) || (await cache.match('./')) || Response.error();
      }
    })());
    return;
  }

  event.respondWith(isContent(url) ? networkFirst(request) : cacheFirst(request));
});

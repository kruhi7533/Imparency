/*
 * Offline support for the field capture app (/ngo/field) — Week 7.
 *
 * Registered with scope "/ngo/field" only, so it never touches the rest of
 * the site. It does NOT queue uploads (the page does that in IndexedDB, where
 * it can show the queue and retry); its only job is to let the page and its
 * assets load with no network:
 *   - page navigations: network first, cached copy when offline;
 *   - Next.js static assets: cache first (they are content-hashed);
 *   - the task list API: network first, cached copy when offline.
 * Everything else, and every non-GET, goes straight to the network.
 */
const CACHE = "field-app-v1";
const SHELL = "/ngo/field";

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches
      .open(CACHE)
      .then((cache) => cache.add(new Request(SHELL, { credentials: "same-origin" })))
      .catch(() => {})
      .then(() => self.skipWaiting()),
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((k) => k.startsWith("field-app-") && k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
});

async function networkFirst(request, cacheKey) {
  const cache = await caches.open(CACHE);
  try {
    const response = await fetch(request);
    if (response.ok) cache.put(cacheKey || request, response.clone());
    return response;
  } catch (err) {
    const cached = await cache.match(cacheKey || request);
    if (cached) return cached;
    throw err;
  }
}

async function cacheFirst(request) {
  const cache = await caches.open(CACHE);
  const cached = await cache.match(request);
  if (cached) return cached;
  const response = await fetch(request);
  if (response.ok) cache.put(request, response.clone());
  return response;
}

self.addEventListener("fetch", (event) => {
  const { request } = event;
  if (request.method !== "GET") return;
  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;

  if (request.mode === "navigate" && url.pathname.startsWith(SHELL)) {
    event.respondWith(networkFirst(request, SHELL));
  } else if (url.pathname.startsWith("/_next/static/")) {
    event.respondWith(cacheFirst(request));
  } else if (url.pathname === "/api/ngo/field-tasks") {
    event.respondWith(networkFirst(request));
  }
});

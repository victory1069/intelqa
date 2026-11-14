/* IntelQA service worker.
 *
 * - App shell: the student routes below are precached (HTML + the JS/CSS chunks they load),
 *   so the app opens and runs a downloaded paper with no connection.
 * - Pages and RSC payloads: network first, falling back to the cached copy for the same path.
 *   Detail screens use query strings (/session?id=…), so one cached shell serves them all.
 * - /_next/static and fonts: cache first (file names are content-hashed).
 * - Question images: cache first, so a figure loaded once works offline.
 * - /api: never cached here. The app keeps its own offline copies in IndexedDB.
 */
const VERSION = "iq-v2";
const SHELL = `${VERSION}-shell`;
const STATIC = `${VERSION}-static`;
const IMAGES = `${VERSION}-images`;

const ROUTES = ["/home", "/practise", "/ranks", "/me", "/me/downloads", "/course", "/session", "/play", "/result", "/review", "/welcome"];

async function precache() {
  const shell = await caches.open(SHELL);
  const stat = await caches.open(STATIC);
  const assets = new Set();
  for (const route of ROUTES) {
    try {
      const res = await fetch(route, { credentials: "same-origin" });
      if (!res.ok) continue;
      const html = await res.clone().text();
      await shell.put(route, res);
      for (const m of html.matchAll(/(?:src|href)="(\/_next\/static\/[^"]+)"/g)) assets.add(m[1]);
    } catch {
      /* offline during install: try again next visit */
    }
  }
  await Promise.all([...assets].map((a) => stat.add(a).catch(() => {})));
}

self.addEventListener("install", (event) => {
  // First install takes over straight away. An update waits until the student taps "Reload"
  // (never mid-exam), so a new version can't swap code under a running session.
  event.waitUntil(precache().then(() => (self.registration.active ? undefined : self.skipWaiting())));
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((k) => !k.startsWith(VERSION)).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
});

self.addEventListener("message", (event) => {
  if (event.data === "refresh-shell") event.waitUntil(precache());
  if (event.data === "skip-waiting") self.skipWaiting();
});

/* ── Push (streak reminders, new papers, corrected scores, challenges) ── */

self.addEventListener("push", (event) => {
  let data = { title: "IntelQA", body: "", url: "/home", tag: "general" };
  try {
    data = { ...data, ...event.data.json() };
  } catch {
    if (event.data) data.body = event.data.text();
  }
  event.waitUntil(
    self.registration.showNotification(data.title, {
      body: data.body,
      tag: data.tag,
      icon: "/icons/icon-192.png",
      badge: "/icons/monochrome-512.png",
      data: { url: data.url },
    }),
  );
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const url = new URL(event.notification.data?.url || "/home", self.location.origin).href;
  event.waitUntil(
    self.clients.matchAll({ type: "window", includeUncontrolled: true }).then((wins) => {
      const open = wins.find((w) => w.url.startsWith(self.location.origin));
      if (open) return open.navigate(url).then((w) => (w || open).focus());
      return self.clients.openWindow(url);
    }),
  );
});

function pathKey(url) {
  return url.pathname;
}

async function networkFirst(request, cacheName, key, fallback) {
  const cache = await caches.open(cacheName);
  try {
    const res = await fetch(request);
    if (res.ok && res.type === "basic") cache.put(key, res.clone());
    return res;
  } catch {
    const hit = (await cache.match(key)) || (fallback ? await cache.match(fallback) : undefined);
    return hit || Response.error();
  }
}

async function cacheFirst(request, cacheName) {
  const cache = await caches.open(cacheName);
  const hit = await cache.match(request);
  if (hit) return hit;
  const res = await fetch(request);
  if (res.ok || res.type === "opaque") cache.put(request, res.clone());
  return res;
}

self.addEventListener("fetch", (event) => {
  const { request } = event;
  if (request.method !== "GET") return;
  const url = new URL(request.url);

  if (url.origin === self.location.origin) {
    if (url.pathname.startsWith("/api/")) return;
    if (url.pathname.startsWith("/_next/static/") || url.pathname.startsWith("/icons/")) {
      event.respondWith(cacheFirst(request, STATIC));
      return;
    }
    const isRsc = request.headers.get("RSC") === "1" || url.searchParams.has("_rsc");
    if (request.mode === "navigate") {
      event.respondWith(networkFirst(request, SHELL, pathKey(url), "/home"));
      return;
    }
    if (isRsc) {
      // RSC payloads are keyed separately from the HTML for the same path.
      event.respondWith(networkFirst(request, SHELL, `${pathKey(url)}?__rsc`));
      return;
    }
    return;
  }

  // Supabase public storage: question figures.
  if (url.pathname.includes("/storage/v1/object/public/")) {
    event.respondWith(cacheFirst(request, IMAGES));
    return;
  }
  // Google fonts are self-hosted by next/font, so nothing else to handle.
});

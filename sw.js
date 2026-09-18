// Caminhos da Estrela - funcionamento sem rede
const V = 'ce-v1';
const NUCLEO = [
  './', 'index.html', 'manifest.json',
  'lib/leaflet.js', 'lib/pmtiles.js', 'lib/maplibre-gl-csp.js', 'lib/maplibre-gl-csp-worker.js',
  'dados/rede.json', 'dados/osm.json', 'dados/dem.webp', 'dados/fundo.jpg',
  'icons/icon-192.png', 'icons/icon-512.png', 'icons/favicon.png',
];
const GLIFOS = [];
for (const fonte of ['Sans', 'Sans Bold'])
  for (const r of [0, 256, 512, 768, 1024, 1280, 1536, 1792, 2048, 2304, 8192, 8448, 8704, 9216, 9472, 9728])
    GLIFOS.push(`glifos/${encodeURIComponent(fonte)}/${r}-${r + 255}.pbf`);

// ---- guardar o ficheiro do mapa topografico inteiro (IndexedDB) ----
const BD = 'ce-mapa', LOJA = 'ficheiros';
function abreBD() {
  return new Promise((ok, ko) => {
    const r = indexedDB.open(BD, 1);
    r.onupgradeneeded = () => { if (!r.result.objectStoreNames.contains(LOJA)) r.result.createObjectStore(LOJA); };
    r.onsuccess = () => ok(r.result); r.onerror = () => ko(r.error);
  });
}
function poe(chave, valor) {
  return abreBD().then((db) => new Promise((ok, ko) => {
    const t = db.transaction(LOJA, 'readwrite'); t.objectStore(LOJA).put(valor, chave);
    t.oncomplete = () => ok(); t.onerror = () => ko(t.error);
  }));
}
function tira(chave) {
  return abreBD().then((db) => new Promise((ok, ko) => {
    const t = db.transaction(LOJA, 'readonly'); const q = t.objectStore(LOJA).get(chave);
    q.onsuccess = () => ok(q.result); q.onerror = () => ko(q.error);
  })).catch(() => null);
}

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(V).then((c) => c.addAll(NUCLEO.concat(GLIFOS)).catch(() => {})).then(() => self.skipWaiting()));
});
self.addEventListener('activate', (e) => {
  e.waitUntil(caches.keys().then((ks) => Promise.all(ks.filter((k) => k !== V).map((k) => caches.delete(k)))).then(() => self.clients.claim()));
});

function avisa(msg) { self.clients.matchAll().then((cs) => cs.forEach((c) => c.postMessage(msg))); }

self.addEventListener('message', (e) => {
  const d = e.data || {};
  if (d.tipo === 'guardar-topo') e.waitUntil(guardaTopo());
  if (d.tipo === 'guardar-fotos') e.waitUntil(guardaFotos(d.urls || []));
  if (d.tipo === 'estado') e.waitUntil(estado());
  if (d.tipo === 'quantos') e.waitUntil(jaTenho(d.urls || []).then((f) => avisa({ tipo: 'quantos', faltam: f.length, total: (d.urls || []).length })));
  if (d.tipo === 'cobertura') e.waitUntil(indice().then((q) => avisa({ tipo: 'cobertura', quadrados: q })));
  if (d.tipo === 'apagar') e.waitUntil(apagaTudo());
});

async function indice() { return (await tira('quadrados')) || []; }
async function guardaIndice(lista) { await poe('quadrados', lista); }

async function estado() {
  const b = await tira('topo.pmtiles');
  const c = await caches.open(V);
  const n = (await c.keys()).length;
  const idx = await indice();
  let uso = 0, quota = 0;
  try { const q = await navigator.storage.estimate(); uso = q.usage || 0; quota = q.quota || 0; } catch (err) {}
  avisa({ tipo: 'estado', topo: !!b, topoMB: b ? Math.round(b.size / 1e6) : 0, ficheiros: n, uso, quota, quadrados: idx.length });
}

async function guardaTopo() {
  try {
    avisa({ tipo: 'progresso', fase: 'topo', pct: 0 });
    const r = await fetch('dados/topo.pmtiles');
    if (!r.ok) throw new Error('resposta ' + r.status);
    const total = +(r.headers.get('Content-Length') || 0);
    const leitor = r.body.getReader();
    const pedacos = []; let lido = 0;
    for (;;) {
      const { done, value } = await leitor.read();
      if (done) break;
      pedacos.push(value); lido += value.length;
      if (total) avisa({ tipo: 'progresso', fase: 'topo', pct: Math.round(lido / total * 100) });
    }
    await poe('topo.pmtiles', new Blob(pedacos, { type: 'application/octet-stream' }));
    avisa({ tipo: 'pronto', fase: 'topo' });
    estado();
  } catch (err) { avisa({ tipo: 'erro', fase: 'topo', msg: String(err && err.message || err) }); }
}

// chave do quadrado a partir do endereco, para o mapa poder mostrar o que ja esta guardado
function chaveQuadrado(u) {
  const m = /bbox=(-?[\d.]+),(-?[\d.]+),(-?[\d.]+),(-?[\d.]+)/.exec(u);
  if (!m) return null;
  const R = 20037508.342789244, x0 = +m[1], y0 = +m[2], x1 = +m[3];
  const s = x1 - x0; if (!(s > 0)) return null;
  const z = Math.round(Math.log2(2 * R / s));
  const n = 2 ** z;
  return z + '/' + Math.round((x0 + R) / (2 * R) * n) + '/' + Math.round((R - (y0 + s)) / (2 * R) * n);
}

async function jaTenho(urls) {
  const c = await caches.open(V);
  const faltam = [];
  for (const u of urls) { if (!(await c.match(u))) faltam.push(u); }
  return faltam;
}

async function guardaFotos(urls) {
  const c = await caches.open(V);
  const faltam = await jaTenho(urls);
  const jaLa = urls.length - faltam.length;
  if (!faltam.length) { avisa({ tipo: 'pronto', fase: 'fotos', novas: 0, jaLa }); estado(); return; }
  const idx = new Set(await indice());
  let n = 0, guardadas = 0, i = 0;
  const passo = Math.max(1, Math.round(faltam.length / 80));
  // quatro ao mesmo tempo: rapido para quem espera, sem martelar o servidor
  async function trabalhador() {
    while (i < faltam.length) {
      const u = faltam[i++];
      try {
        const r = await fetch(u);
        if (r.ok) {
          await c.put(u, r.clone());
          guardadas++;
          const k = chaveQuadrado(u); if (k) idx.add(k);
        }
      } catch (err) {}
      n++;
      if (n % passo === 0 || n === faltam.length) {
        avisa({ tipo: 'progresso', fase: 'fotos', pct: Math.round(n / faltam.length * 100), feito: n, total: faltam.length });
        if (n % (passo * 10) === 0) await guardaIndice([...idx]);
      }
      await new Promise((ok) => setTimeout(ok, 40));
    }
  }
  await Promise.all([trabalhador(), trabalhador(), trabalhador(), trabalhador()]);
  await guardaIndice([...idx]);
  avisa({ tipo: 'pronto', fase: 'fotos', novas: guardadas, jaLa });
  estado();
}

async function apagaTudo() {
  await caches.delete(V);
  try { await poe('quadrados', []); } catch (err) {}
  try { const db = await abreBD(); const t = db.transaction(LOJA, 'readwrite'); t.objectStore(LOJA).clear(); } catch (err) {}
  avisa({ tipo: 'apagado' });
}

// ---- responder aos pedidos ----
self.addEventListener('fetch', (e) => {
  const req = e.request;
  if (req.method !== 'GET') return;
  const u = new URL(req.url);
  if (u.origin !== location.origin) {
    // satelite online: serve-se da cache quando existir (guardado por zona)
    if (/arcgisonline\.com$/.test(u.hostname) || /dgterritorio\.gov\.pt$/.test(u.hostname)) {
      e.respondWith(caches.match(req).then((hit) => hit || fetch(req).catch(() => hit || Response.error())));
    }
    return;
  }

  if (u.pathname.endsWith('topo.pmtiles')) { e.respondWith(serveTopo(req)); return; }

  if (/\/(dados|orto|sat|lib|glifos|icons)\//.test(u.pathname) || u.pathname.endsWith('/') || u.pathname.endsWith('index.html') || u.pathname.endsWith('manifest.json')) {
    e.respondWith(caches.match(req, { ignoreSearch: true }).then((hit) => hit || fetch(req).then((r) => {
      if (r.ok && r.status === 200) { const cp = r.clone(); caches.open(V).then((c) => c.put(req, cp)); }
      return r;
    }).catch(() => hit || Response.error())));
  }
});

async function serveTopo(req) {
  const blob = await tira('topo.pmtiles');
  if (!blob) return fetch(req);
  const rng = req.headers.get('Range');
  if (!rng) return new Response(blob, { status: 200, headers: { 'Content-Type': 'application/octet-stream', 'Accept-Ranges': 'bytes', 'Content-Length': String(blob.size) } });
  const m = /bytes=(\d*)-(\d*)/.exec(rng);
  const a = m && m[1] ? +m[1] : 0;
  const b = m && m[2] ? Math.min(+m[2], blob.size - 1) : blob.size - 1;
  if (a > b || a >= blob.size) return new Response(null, { status: 416, headers: { 'Content-Range': `bytes */${blob.size}` } });
  const parte = blob.slice(a, b + 1);
  return new Response(parte, { status: 206, headers: {
    'Content-Type': 'application/octet-stream',
    'Content-Range': `bytes ${a}-${b}/${blob.size}`,
    'Content-Length': String(b - a + 1),
    'Accept-Ranges': 'bytes',
  } });
}

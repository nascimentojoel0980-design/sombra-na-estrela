const D = window.__DATA__;
const smallScreen = () => { try { return matchMedia('(max-width:520px)').matches; } catch (e) { return false; } };
const geo = (r) => r._g || (r._g = (r.geoe || []).map((s) => decodePoly(s)));
const segPts = (s) => s._p || (s._p = decodePoly(s[1]));
const $ = (id) => document.getElementById(id);
const css = (v) => getComputedStyle(document.documentElement).getPropertyValue(v).trim();
const shadeCol = (p) => p >= 70 ? css('--s-hi') : p >= 40 ? css('--s-mid') : css('--s-lo');
const fmt = (v, d = 0) => v == null || isNaN(v) ? '—' : Number(v).toLocaleString('pt-PT', { maximumFractionDigits: d, minimumFractionDigits: d });
const score = (r) => r.lidar ? r.lidar.sombra : (r.arv ?? -1);
const BOUNDS = [[40.0, -8.10], [40.70, -7.15]];

const map = L.map('map', { zoomControl: false, attributionControl: false, maxBounds: [[39.55, -8.85], [41.15, -6.45]], maxBoundsViscosity: 0.8, minZoom: 9, maxZoom: 20, preferCanvas: false, tap: false });
L.control.zoom({ position: 'topright' }).addTo(map);
[['satP', 380], ['ortoP', 390], ['detP', 395], ['onlineP', 397]].forEach(([n, z]) => { map.createPane(n).style.zIndex = z; map.getPane(n).style.pointerEvents = 'none'; });
const base = L.imageOverlay('/_blob/bbb0be3a812c34296b0abe310453249c', BOUNDS, { interactive: false, pane: 'satP' }).addTo(map);
map.fitBounds(BOUNDS, { padding: [0, 0] });
function enquadraInicio() {
  if (selected || document.body.classList.contains('building')) return;
  map.invalidateSize();
  const largo = matchMedia('(min-width:900px)').matches;
  const sh = largo ? 0 : Math.min(innerHeight * 0.55, (document.getElementById('sheet') || {}).offsetHeight || innerHeight * 0.40);
  if (largo) { map.fitBounds(BOUNDS, { paddingTopLeft: [400, 0] }); return; }
  // no telemovel o painel tapa a parte de baixo: abrir sobre a serra, com a area util em cima
  const cen = BOUNDS.getCenter ? BOUNDS.getCenter() : L.latLngBounds(BOUNDS).getCenter();
  const desv = (sh / 2) / 256 * 0.6;
  map.setView([cen.lat - desv * 0.55, cen.lng], 10, { animate: false });
}
addEventListener('load', () => setTimeout(enquadraInicio, 60));
addEventListener('resize', () => { clearTimeout(window.__rq); window.__rq = setTimeout(enquadraInicio, 200); if (topoAberto) { ajustaTopo(); if (mapT) mapT.resize(); } });
document.addEventListener('fullscreenchange', () => { if (topoAberto) { setTimeout(() => { ajustaTopo(); if (mapT) mapT.resize(); }, 120); } });
const CHUNKS = window.__CHUNKS__; const loaded = new Set();
function loadChunks() {
  if (map.getZoom() < 11) return;
  const vb = map.getBounds().pad(0.3);
  CHUNKS.forEach(([src, b], i) => {
    if (loaded.has(i) || !vb.intersects(L.latLngBounds(b))) return;
    loaded.add(i);
    const ov = L.imageOverlay(src, b, { interactive: false, className: 'hires', pane: 'satP' });
    ov.addTo(map); ov.bringToBack(); base.bringToBack();
  });
}
map.on('moveend zoomend', loadChunks);
// Ortofotos DGT 2025 (antes dos fogos de agosto de 2025), faixa de 400 m à volta dos percursos
const ORTHO = window.__ORTHO__ || []; const oLoaded = new Set(); const orthoGroup = L.layerGroup().addTo(map);
function loadOrtho() {
  if (map.getZoom() < 12) { orthoGroup.eachLayer(l => l.setOpacity(0)); return; }
  orthoGroup.eachLayer(l => l.setOpacity(1));
  const vb = map.getBounds().pad(0.2);
  ORTHO.forEach(([src, b], i) => {
    if (oLoaded.has(i) || !vb.intersects(L.latLngBounds(b))) return;
    oLoaded.add(i); L.imageOverlay(src, b, { interactive: false, pane: 'ortoP' }).addTo(orthoGroup);
  });
  const note = document.getElementById('ortho-note'); if (note && note.hidden) { note.hidden = false; setTimeout(() => note.classList.add('gone'), 8000); }
}
map.on('moveend zoomend', loadOrtho);
// Detalhe 0,6 m/px: ortofotos DGT 2025 numa faixa de ~75 m de cada lado dos percursos (zoom >= 15)
const DET = window.__DET__ || []; const dLoaded = new Set(); const detGroup = L.layerGroup().addTo(map);
function loadDet() {
  const z = map.getZoom(); detGroup.eachLayer((l) => l.setOpacity(z >= 15 ? 1 : 0));
  if (z < 15) return;
  const vb = map.getBounds();
  DET.forEach(([url, bbs], i) => {
    if (dLoaded.has(i) || !bbs.some((b) => vb.intersects(L.latLngBounds(b)))) return;
    dLoaded.add(i);
    fetch(url).then((r) => r.json()).then((j) => j.t.forEach(([s, w, n, e, d]) => {
      L.imageOverlay('data:image/webp;base64,' + d, [[s, w], [n, e]], { interactive: false, pane: 'detP', opacity: map.getZoom() >= 15 ? 1 : 0 }).addTo(detGroup);
    })).catch(() => dLoaded.delete(i));
  });
}
map.on('moveend zoomend', loadDet);



L.polygon(D.pnse, { color: '#F4F1E6', weight: 2, dashArray: '6 6', fill: false, interactive: false }).addTo(map);
L.polygon(D.ard25, { color: css('--fogo'), weight: 1, opacity: .7, fillColor: css('--fogo'), fillOpacity: .22, interactive: false }).addTo(map);

// OSM: todos os caminhos pedestres e estradões (canvas, só com zoom)
function decodePoly(s){const pts=[];let i=0,la=0,lo=0;while(i<s.length){let r=0,sh=0,b;do{b=s.charCodeAt(i++)-63;r|=(b&31)<<sh;sh+=5}while(b>=32);la+=(r&1)?~(r>>1):(r>>1);r=0;sh=0;do{b=s.charCodeAt(i++)-63;r|=(b&31)<<sh;sh+=5}while(b>=32);lo+=(r&1)?~(r>>1):(r>>1);pts.push([la/1e5,lo/1e5])}return pts}
const cv = L.canvas({ padding: 0.3 });
const OSM_URL = '/_blob/c297698b506811ad317814ae35dd2998';
const OSM_KINDS = ['trilho', 'estradao', 'estrada'];
const osmGroups = { trilho: L.layerGroup(), estradao: L.layerGroup(), estrada: L.layerGroup() };
let osmP = null, osmReady = false;
// Só se desenham as linhas que estão no ecrã: numa serra inteira são 45 000 e o telemóvel não aguenta todas
const OSMD = { trilho: [], estradao: [], estrada: [] };
function osmIndex(list) { const gi = new Map(); list.forEach((pts, i) => { const k = new Set(); pts.forEach((p) => k.add(Math.round(p[0] * 50) + ':' + Math.round(p[1] * 50))); k.forEach((kk) => { let a = gi.get(kk); if (!a) gi.set(kk, a = []); a.push(i); }); }); return gi; }
let osmGI = { trilho: null, estradao: null, estrada: null };
function loadOSM() {
  if (!osmP) osmP = fetch(OSM_URL).then((r) => r.json()).then((j) => {
    OSM_KINDS.forEach((k) => { OSMD[k] = (j[k] || '').split('\n').filter(Boolean).map(decodePoly); osmGI[k] = osmIndex(OSMD[k]); });
    osmReady = true; osmByZoom();
  }).catch(() => { osmP = null; });
  return osmP;
}
const osmShown = { trilho: new Map(), estradao: new Map(), estrada: new Map() };
// cada tipo de caminho tem cor propria e traco fino, para nao tapar a fotografia
const OSM_STYLE = {
  trilho:   { color: '#6FE0C8', weight: 1.3, opacity: .95 },
  estradao: { color: '#F0B24A', weight: 1.2, opacity: .85 },
  estrada:  { color: '#CBD6E4', weight: 1.1, opacity: .7 },
};
const OSM_NOME = { trilho: 'Trilho a pé', estradao: 'Estradão', estrada: 'Caminho / estrada' };
function osmRender(kind, group) {
  if (!osmReady) return;
  const vb = map.getBounds().pad(0.25), want = new Set();
  const gi = osmGI[kind];
  for (let a = Math.floor(vb.getSouth() * 50); a <= Math.ceil(vb.getNorth() * 50); a++)
    for (let b = Math.floor(vb.getWest() * 50); b <= Math.ceil(vb.getEast() * 50); b++) {
      const arr = gi.get(a + ':' + b); if (arr) arr.forEach((i) => want.add(i));
    }
  // ou se desenha a area toda ou nenhuma: desenhar metade dava a ideia falsa de que so ali ha caminhos
  const LIM = smallScreen() ? 3000 : 9000;
  if (want.size > LIM) { osmClear(kind, group); return false; }
  const shown = osmShown[kind];
  shown.forEach((l, i) => { if (!want.has(i)) { group.removeLayer(l); shown.delete(i); } });
  for (const i of want) {
    if (shown.has(i)) continue;
    const l = L.polyline(OSMD[kind][i], Object.assign({ renderer: cv, interactive: false }, OSM_STYLE[kind]));
    shown.set(i, l); group.addLayer(l);
  }
  return true;
}
function osmClear(kind, group) { osmShown[kind].forEach((l) => group.removeLayer(l)); osmShown[kind].clear(); }
function osmByZoom() {
  const z = map.getZoom(), ZT = smallScreen() ? 12 : 11, ZE = smallScreen() ? 13 : 12;
  if (z >= ZT && !osmReady) { loadOSM(); return; }
  const min = { trilho: ZT, estradao: ZE, estrada: ZE };
  let cortado = false, algum = false;
  OSM_KINDS.forEach((k) => {
    const g = osmGroups[k];
    if (z < min[k]) { g.remove(); osmClear(k, g); if (z >= ZT - 1) cortado = true; }
    else { g.addTo(map); if (osmRender(k, g) === false) cortado = true; else algum = true; }
  });
  const nota = document.getElementById('cam-note');
  if (nota) nota.hidden = !(cortado && !algum);
}
// Percurso selecionado: só esse percurso + todos os caminhos OSM num raio de 8 km do centro (alternativas de recurso)
let focusGroup = null; const RAIO = 8000;
function nearLines(kind, c, style) {
  const k = Math.cos(c.lat * Math.PI / 180), out = [], list = OSMD[kind] || [], CAP = 3500;
  for (let j = 0; j < list.length && out.length < CAP; j++) {
    const pts = list[j];
    for (let i = 0; i < pts.length; i += 3) {
      const dy = (pts[i][0] - c.lat) * 111320, dx = (pts[i][1] - c.lng) * 111320 * k;
      if (dx * dx + dy * dy < RAIO * RAIO) { out.push(L.polyline(pts, Object.assign({ renderer: cv, interactive: false }, style))); break; }
    }
  }
  return out;
}
function focusOn(r) {
  unfocus();
  const c = L.latLngBounds(r.el ? decodePoly(r.el.p) : geo(r).flat()).getCenter();
  focusGroup = L.layerGroup([
    L.circle(c, { radius: RAIO, color: '#F6F2DA', weight: 1.5, opacity: .7, dashArray: '6 6', fill: false, interactive: false }),
  ]).addTo(map);
  loadOSM();
  layers.forEach((g, id) => { if (id !== r.id) g.remove(); else g.addTo(map); });
  osmByZoom();
  routePoi = new Set(poisAlong(r).map((o) => o.i)); refreshPoi();
  drawAlt(r);
}
function unfocus() {
  if (!focusGroup) return;
  focusGroup.remove(); focusGroup = null; altGroup.clearLayers();
  layers.forEach((g) => g.addTo(map));
  osmByZoom();
  routePoi = new Set(); refreshPoi();
}
map.on('moveend zoomend', osmByZoom); osmByZoom();

// ---------------- Satelite online de alta resolucao (ESRI World Imagery) ----------------
// mais nitido que as nossas ortofotos, mas vem de fora e precisa de rede
const SAT_URL = 'https://services.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}';
const DGT_WMS = 'https://cartografia.dgterritorio.gov.pt/wms/ortos2025';
const R38 = 20037508.342789244;
// endereco fixo por quadrado: e o que permite ao telemovel guarda-los para usar sem rede
function dgtUrl(z, x, y, px) {
  const n = 2 ** z, s = 2 * R38 / n;
  const x0 = -R38 + x * s, y1 = R38 - y * s, x1 = x0 + s, y0 = y1 - s;
  return DGT_WMS + '?service=WMS&version=1.3.0&request=GetMap&layers=Ortos2025-RGB&styles='
    + '&crs=EPSG:3857&format=image/jpeg&width=' + (px || 256) + '&height=' + (px || 256)
    + '&bbox=' + x0.toFixed(1) + ',' + y0.toFixed(1) + ',' + x1.toFixed(1) + ',' + y1.toFixed(1);
}
const PX_DGT = 2048;
// QUANTOS PIXELS PEDIR. Pedir 2048 da um pixel de imagem por pixel CSS -- e
// num telemovel com DPR 2,75 isso e esticar a imagem 2,75x. E por isso que a
// DGT parecia igual ou pior do que o detalhe que ja vem no ficheiro: medido a
// 18/09/2026, no zoom 16 ela entregava 1,82 m/px contra os 0,48 m/px de
// dados/det. Pede-se agora o que o ECRA mostra, com dois tectos: o detalhe da
// fonte (25 cm -- abaixo disso a DGT interpola e nao ha nada a ganhar) e o
// que o servidor aceita por pedido.
// TECTO A 2048 ATE HAVER MEDICAO. Subi-o para 4096 a 18/09 e o download
// parou em "0 de 3" no telemovel dele: ou a DGT recusa esse tamanho, ou
// demora mais do que os 30 s de limite por pedido. Nao se advinha - mede-se
// primeiro (ver as duas ligacoes de prova na conversa de 18/09) e so depois
// se sobe. O resto do mecanismo fica como esta: mudar este numero chega.
const M_FONTE = 0.25;
// O TECTO DESCOBRE-SE, NAO SE ADIVINHA. Nao consigo testar a DGT do sitio
// onde corro (bloqueada a saida), e quando subi isto para 4096 as cegas parti
// a descarga no telemovel dele -- ficou em "0 de 3". Agora tenta-se o maior,
// e ao primeiro quadrado recusado desce-se para 2048 e fica escrito no
// telemovel. Pior caso: uma imagem falhada e depois tudo como antes.
let PX_MAX = 4096;
try { const v = +localStorage.getItem('sne-pxdgt'); if (v >= 1024 && v <= 8192) PX_MAX = v; } catch (e) {}
function baixaTecto() {
  if (PX_MAX <= PX_DGT) return false;
  PX_MAX = PX_DGT;
  try { localStorage.setItem('sne-pxdgt', String(PX_MAX)); } catch (e) {}
  toast('A DGT recusou imagens de 4096 px. Voltei a 2048.');
  if (camDGT && satModo === 1) { camDGT.remove(); camDGT.addTo(map); }
  return true;
}
function pxDGT(z, lat) {
  const dpr = Math.min(3, window.devicePixelRatio || 1);
  const ladoM = 2 * R38 / 2 ** z * Math.cos((lat || 40.3) * Math.PI / 180);
  const porFonte = Math.ceil(ladoM / M_FONTE);
  return Math.max(PX_DGT, Math.min(PX_MAX, porFonte, Math.round(PX_DGT * dpr)));
}
// bytes aproximados de um bloco, para as contas de MB: 0,73 MB aos 2048 px
const mbDGT = (px) => 0.73 * (px / PX_DGT) ** 2;
const CamadaDGT = L.TileLayer.extend({
  getTileUrl: function (c) {
    const z = this._getZoomForUrl();
    return dgtUrl(z, c.x, c.y, pxDGT(z, map.getCenter().lat));
  },
});
// A DGT desenha cada pedido de raiz e demora o mesmo por pedido, grande ou pequeno.
// Por isso pedimos blocos de 1024 px (z17) em vez de 256 px (z19): mesma nitidez
// (22,8 cm por pixel), 16 vezes menos pedidos.
const Z_DGT = 16;
const DGT_CAP = 900;
// quantos quadrados a 25 cm cabem na vista; se for demais, fica-se pelo centro
function dgtCaixa(vb, zAlvo) {
  const z = zAlvo == null ? Z_DGT : zAlvo, n = 2 ** z;
  let x0 = Math.floor((vb.getWest() + 180) / 360 * n), x1 = Math.floor((vb.getEast() + 180) / 360 * n);
  const ly = (l) => { const r = l * Math.PI / 180; return Math.floor((1 - Math.log(Math.tan(r) + 1 / Math.cos(r)) / Math.PI) / 2 * n); };
  let y0 = ly(vb.getNorth()), y1 = ly(vb.getSouth());
  const lw = x1 - x0 + 1, lh = y1 - y0 + 1, tot = lw * lh;
  let cortado = false;
  if (tot > DGT_CAP) {
    cortado = true;
    const k = Math.sqrt(DGT_CAP / tot);
    const nw = Math.max(1, Math.floor(lw * k)), nh = Math.max(1, Math.floor(lh * k));
    const cx = Math.floor((x0 + x1) / 2), cy = Math.floor((y0 + y1) / 2);
    x0 = cx - (nw >> 1); x1 = x0 + nw - 1;
    y0 = cy - (nh >> 1); y1 = y0 + nh - 1;
  }
  return { z: z, x0: x0, x1: x1, y0: y0, y1: y1, cortado: cortado, total: tot };
}
// area em km2 de um quadrado z19 a esta latitude
function dgtKm2(z, y, n) {
  const lat = Math.atan(Math.sinh(Math.PI * (1 - 2 * y / n))) * 180 / Math.PI;
  const m = 40075017 * Math.cos(lat * Math.PI / 180) / n;
  return m * m / 1e6;
}
// guarda o nivel maximo (19) e tambem o 18 e o 17, para funcionar sem rede em qualquer zoom
// O NIVEL TEM DE SAIR DO ZOOM, NAO DE UMA CONSTANTE.
// A camada DGT tem tileSize 2048 com zoomOffset -3, por isso pede sempre o
// nivel (zoom do mapa - 3) -- confirmado no proprio objecto: mapa em 18 da
// _getZoomForUrl() 15. A descarga usava Z_DGT fixo e guardava 14/15/16, que
// so servem os zooms 17-19. Medido a 18/09/2026, pedido a pedido: nos zooms
// 14, 15 e 16 -- aqueles em que se anda a olhar para o mapa -- ZERO dos
// quadrados guardados era aproveitado, e sem rede a camada ficava vazia.
// O satTiles, do Esri, ja fazia isto bem; e dele que vem a forma.
function zDGT() { return Math.min(16, Math.max(6, Math.round(map.getZoom()) - 3)); }
function dgtTiles(vb, zAlvo) {
  const c = dgtCaixa(vb, zAlvo == null ? zDGT() : zAlvo), out = [];
  for (let d = 2; d >= 0; d--) {
    const z = c.z - d;
    if (z < 6) continue;
    const x0 = c.x0 >> d, x1 = c.x1 >> d, y0 = c.y0 >> d, y1 = c.y1 >> d;
    // O MESMO NUMERO DE PIXELS QUE A CAMADA VAI PEDIR. Se a descarga guardar
    // com outro tamanho, o endereco e outro e nada e aproveitado.
    const px = pxDGT(z, vb.getCenter().lat);
    for (let x = x0; x <= x1; x++) for (let y = y0; y <= y1; y++) out.push(dgtUrl(z, x, y, px));
  }
  return out;
}
// avisa quando se passa o detalhe que a foto tem (25 cm = nivel 19)
function notaLimite() {
  const n = document.getElementById('sat-lim');
  if (!n) return;
  if (satModo === 1 && map.getZoom() > 19) n.innerHTML = '<br><strong>Estás acima do detalhe da foto.</strong> A 25 cm não há mais nada para ver — isto é ampliação, não nitidez.';
  else n.innerHTML = '';
}
const VERSAO = '__VERSAO__';
let camDGT = null, camEsri = null, satModo = 0;   // 0 = nossas, 1 = DGT 25 cm, 2 = Esri
const SAT_NOME = ['Ortofotos guardadas (63 cm, sem rede)', 'DGT 2025 em directo — 25 cm, o máximo que existe', 'Esri/Maxar — melhor nas vilas, pior na serra'];
// a caixa de informacao do satelite desaparece sozinha; toca no botao do satelite para a ver outra vez
let notaT = null;
function escondeNota() {
  clearTimeout(notaT);
  const n = document.getElementById('sat-note');
  if (!n || satModo === 0) return;
  n.style.opacity = '1'; n.style.pointerEvents = 'auto';
  n.onclick = () => { n.hidden = true; };
  notaT = setTimeout(() => {
    n.style.transition = 'opacity .6s'; n.style.opacity = '0'; n.style.pointerEvents = 'none';
    setTimeout(() => { if (n.style.opacity === '0') n.hidden = true; }, 700);
  }, 7000);
}
function camadaAtiva() { return satModo === 1 ? camDGT : satModo === 2 ? camEsri : null; }
function ligaSat(modo) {
  satModo = ((modo % 3) + 3) % 3;
  if (camDGT) camDGT.remove();
  if (camEsri) camEsri.remove();
  if (satModo === 1) {
    if (!camDGT) {
      // ATENCAO: L.TileLayer recebe (url, opcoes). Sem a string vazia a frente, as
      // opcoes iam parar ao lugar do url e NENHUMA era aplicada — foi assim durante horas.
      camDGT = new CamadaDGT('', { pane: 'onlineP', tileSize: PX_DGT, zoomOffset: -3, maxZoom: 21, maxNativeZoom: 19, attribution: 'Ortofotos DGT 2025' });
      camDGT.__ok = 0; camDGT.__erro = 0;
      const marca = () => {
        const n = document.getElementById('sat-diag');
        if (n) n.textContent = camDGT.__ok + ' imagens carregadas, ' + camDGT.__erro + ' falhadas';
        notaLimite();
      };
      camDGT.on('tileload', () => { camDGT.__ok++; marca(); });
      // a DGT recusa pedidos quando esta a ser martelada: tenta outra vez, com espera
      camDGT.on('tileerror', (e) => {
        camDGT.__erro++; marca();
        const t = e && e.tile;
        // Pedido grande recusado? Baixa o tecto e recomeca a camada inteira --
        // repetir o mesmo tamanho so repetiria a recusa.
        const m = t && /[?&]width=(\d+)/.exec(t.src || '');
        if (m && +m[1] > PX_DGT) { if (baixaTecto()) return; }
        if (t && !t.__retry) {
          t.__retry = 1;
          const src = t.src;
          // SEM REDE, MUDAR O ENDERECO E PERDER O QUADRADO. O '&r=1' existe para
          // fugir ao estrangulamento da DGT quando ha rede; sem rede, esse
          // endereco nao esta na cache -- e por isso ate os quadrados JA
          // GUARDADOS ficavam em branco. Medido a 18/09/2026: dos pedidos de
          // uma vista, os limpos estavam 100% na descarga e os '&r=1' 0%.
          // Offline repete-se o MESMO endereco (tirar e repor o src, senao o
          // browser nao recarrega), para o service worker o poder servir.
          setTimeout(() => {
            try {
              if (navigator.onLine) { t.src = src + '&r=1'; }
              else { t.removeAttribute('src'); t.src = src; }
            } catch (err) {}
          }, 1500 + Math.random() * 2000);
        }
      });
    }
    camDGT.addTo(map);
  } else if (satModo === 2) {
    if (!camEsri) camEsri = L.tileLayer(SAT_URL, { pane: 'onlineP', maxZoom: 21, maxNativeZoom: 19, crossOrigin: true, attribution: 'Esri, Maxar, Earthstar Geographics' });
    camEsri.addTo(map);
  }
  const n = document.getElementById('sat-note');
  if (n) {
    n.hidden = satModo === 0;
    escondeNota();
    n.innerHTML = satModo === 1
      ? '<strong>DGT 2025 em directo</strong><br>Ortofoto oficial a 25 cm. <span id="sat-diag">a pedir…</span><span id="sat-lim"></span>'
      : '<strong>Esri / Maxar</strong><br>Boa nas vilas, muitas vezes pior do que a nossa na serra. Precisa de rede.';
  }
  document.getElementById('btn-sat').setAttribute('aria-pressed', satModo ? 'true' : 'false');
  document.getElementById('btn-sat').title = SAT_NOME[satModo];
  if (satModo) toast(SAT_NOME[satModo]);
  if (typeof actualizaContagem === 'function') actualizaContagem();
  try { localStorage.setItem('sne-sat', String(satModo)); } catch (e) {}
}
document.getElementById('btn-sat').onclick = () => ligaSat(satModo + 1);
try { const m = +(localStorage.getItem('sne-sat') || 0); if (m) ligaSat(m); } catch (e) {}

// ---------------- Mapa topografico (vetorial, MapLibre + PMTiles) ----------------
const TOPO_URL = 'dados/topo.pmtiles';
// o contentor vive no corpo da pagina, nao dentro do <main>: dentro do main o navegador
// nao compoe o canvas do MapLibre e o mapa sai em branco
let caixaTopo = null;
function garanteCaixa() {
  if (caixaTopo) return caixaTopo;
  const d = document.createElement('div');
  d.id = 'mapt'; d.setAttribute('aria-label', 'Mapa topográfico');
  document.body.appendChild(d);
  caixaTopo = d;
  return d;
}
function ajustaTopo() {
  // ecra inteiro: e o unico feitio em que o navegador compoe o canvas de forma fiavel,
  // seja qual for o tamanho da janela
  if (!caixaTopo) return;
  caixaTopo.style.left = '0px'; caixaTopo.style.top = '0px';
  caixaTopo.style.width = innerWidth + 'px'; caixaTopo.style.height = innerHeight + 'px';
}
let mapT = null, topoAberto = false, topoRelevo = false, pmProto = null, topoMarks = [];
const CS = {
  papel: '#F7F4EC', floresta: '#C5D7B8', matos: '#DFD9BC', rocha: '#E6E3DC',
  agricola: '#F0E9D2', urbano: '#E6DCD4', agua: '#A8C9E0', outro: '#EDE9DE',
};
function estiloTopo() {
  return {
    version: 8,
    glyphs: 'glifos/{fontstack}/{range}.pbf',
    sources: {
      topo: { type: 'vector', url: 'pmtiles://' + new URL(TOPO_URL, location.href).href, attribution: '' },
      dem: { type: 'raster-dem', tiles: ['dem://{z}/{x}/{y}'], tileSize: 256, encoding: 'terrarium', maxzoom: 12 },
    },
    layers: [
      { id: 'fundo', type: 'background', paint: { 'background-color': CS.papel } },
      { id: 'solo', type: 'fill', source: 'topo', 'source-layer': 'solo',
        paint: { 'fill-color': ['match', ['get', 'g'], 'floresta', CS.floresta, 'matos', CS.matos, 'rocha', CS.rocha, 'agricola', CS.agricola, 'urbano', CS.urbano, 'agua', CS.agua, CS.outro], 'fill-opacity': 0.9 } },
      { id: 'relevo', type: 'hillshade', source: 'dem',
        paint: { 'hillshade-exaggeration': 0.38, 'hillshade-shadow-color': '#7C6F55', 'hillshade-highlight-color': '#FFFDF4', 'hillshade-accent-color': '#9C8E70' } },
      { id: 'curva', type: 'line', source: 'topo', 'source-layer': 'curvas', minzoom: 12.5,
        filter: ['all', ['==', ['get', 'g'], 0], ['==', ['get', 'm'], 0]],
        paint: { 'line-color': '#B39A72', 'line-width': 0.5, 'line-opacity': 0.75 } },
      { id: 'curva-m', type: 'line', source: 'topo', 'source-layer': 'curvas', minzoom: 11,
        filter: ['==', ['get', 'm'], 1],
        paint: { 'line-color': '#A88C5E', 'line-width': 0.8, 'line-opacity': 0.8 } },
      { id: 'curva-g', type: 'line', source: 'topo', 'source-layer': 'curvas', minzoom: 9.5,
        filter: ['==', ['get', 'g'], 1],
        paint: { 'line-color': '#8E7346', 'line-width': ['interpolate', ['linear'], ['zoom'], 10, 0.7, 14, 1.4], 'line-opacity': 0.9 } },
      { id: 'curva-txt', type: 'symbol', source: 'topo', 'source-layer': 'curvas', minzoom: 13,
        filter: ['==', ['get', 'g'], 1],
        layout: { 'symbol-placement': 'line', 'text-field': ['concat', ['to-string', ['get', 'alt']], ' m'], 'text-font': ['Sans Bold'], 'text-size': 10, 'symbol-spacing': 320, 'text-max-angle': 25, 'text-padding': 4 },
        paint: { 'text-color': '#7A6139', 'text-halo-color': CS.papel, 'text-halo-width': 1.4 } },
      { id: 'agua-a', type: 'fill', source: 'topo', 'source-layer': 'aguaA',
        paint: { 'fill-color': '#9CC3DD', 'fill-outline-color': '#5E93B8' } },
      { id: 'agua-l', type: 'line', source: 'topo', 'source-layer': 'aguaL', minzoom: 10,
        paint: { 'line-color': '#5E93B8', 'line-width': ['match', ['get', 'w'], 'river', 2.2, 'stream', 1.1, 0.8] } },
      { id: 'casas', type: 'fill', source: 'topo', 'source-layer': 'casas', minzoom: 13.5,
        paint: { 'fill-color': '#CBB9A4', 'fill-outline-color': '#9A836A' } },
      { id: 'nac-c', type: 'line', source: 'topo', 'source-layer': 'caminhos', minzoom: 8,
        filter: ['==', ['get', 't'], 'nacional'],
        paint: { 'line-color': '#A34C1C', 'line-width': ['interpolate', ['linear'], ['zoom'], 8, 2.4, 15, 6] }, layout: { 'line-join': 'round', 'line-cap': 'round' } },
      { id: 'nac', type: 'line', source: 'topo', 'source-layer': 'caminhos', minzoom: 8,
        filter: ['==', ['get', 't'], 'nacional'],
        paint: { 'line-color': '#E8813F', 'line-width': ['interpolate', ['linear'], ['zoom'], 8, 1.2, 15, 3.6] }, layout: { 'line-join': 'round', 'line-cap': 'round' } },
      { id: 'estr-c', type: 'line', source: 'topo', 'source-layer': 'caminhos', minzoom: 9.5,
        filter: ['==', ['get', 't'], 'estrada'],
        paint: { 'line-color': '#A87418', 'line-width': ['interpolate', ['linear'], ['zoom'], 10, 1.8, 15, 4.6] }, layout: { 'line-join': 'round', 'line-cap': 'round' } },
      { id: 'estr', type: 'line', source: 'topo', 'source-layer': 'caminhos', minzoom: 9.5,
        filter: ['==', ['get', 't'], 'estrada'],
        paint: { 'line-color': '#F0BC63', 'line-width': ['interpolate', ['linear'], ['zoom'], 10, 0.9, 15, 2.8] }, layout: { 'line-join': 'round', 'line-cap': 'round' } },
      { id: 'cam', type: 'line', source: 'topo', 'source-layer': 'caminhos', minzoom: 11.5,
        filter: ['==', ['get', 't'], 'caminho'],
        paint: { 'line-color': '#9E9A90', 'line-width': ['interpolate', ['linear'], ['zoom'], 12, 0.7, 16, 2] } },
      { id: 'estradao', type: 'line', source: 'topo', 'source-layer': 'caminhos', minzoom: 11.5,
        filter: ['==', ['get', 't'], 'estradao'],
        paint: { 'line-color': '#8A6A3A', 'line-width': ['interpolate', ['linear'], ['zoom'], 12, 0.8, 16, 2.2], 'line-dasharray': [5, 2.5] } },
      { id: 'trilho', type: 'line', source: 'topo', 'source-layer': 'caminhos', minzoom: 11.5,
        filter: ['==', ['get', 't'], 'trilho'],
        paint: { 'line-color': '#B23A2E', 'line-width': ['interpolate', ['linear'], ['zoom'], 12, 0.9, 16, 2.4], 'line-dasharray': [2.5, 1.6] } },
      { id: 'rota-c', type: 'line', source: 'topo', 'source-layer': 'rotas', minzoom: 8,
        paint: { 'line-color': '#FFFFFF', 'line-width': ['interpolate', ['linear'], ['zoom'], 9, 2.6, 16, 7], 'line-opacity': 0.85 }, layout: { 'line-join': 'round', 'line-cap': 'round' } },
      { id: 'rota', type: 'line', source: 'topo', 'source-layer': 'rotas', minzoom: 8,
        paint: { 'line-color': ['case', ['<', ['get', 'sombra'], 0], '#5C5A94',
                   ['interpolate', ['linear'], ['get', 'sombra'], 0, '#E4572E', 40, '#E8A33D', 70, '#8FBF5A', 100, '#2E7D4F']],
                 'line-width': ['interpolate', ['linear'], ['zoom'], 9, 1.4, 16, 4] }, layout: { 'line-join': 'round', 'line-cap': 'round' } },
      { id: 'cam-txt', type: 'symbol', source: 'topo', 'source-layer': 'caminhos', minzoom: 14.5,
        filter: ['has', 'n'],
        layout: { 'symbol-placement': 'line', 'text-field': ['get', 'n'], 'text-font': ['Sans'], 'text-size': 10.5, 'symbol-spacing': 260, 'text-max-angle': 30 },
        paint: { 'text-color': '#4A4236', 'text-halo-color': CS.papel, 'text-halo-width': 1.6 } },
      { id: 'agua-txt', type: 'symbol', source: 'topo', 'source-layer': 'aguaL', minzoom: 13,
        filter: ['has', 'n'],
        layout: { 'symbol-placement': 'line', 'text-field': ['get', 'n'], 'text-font': ['Sans'], 'text-size': 10.5, 'symbol-spacing': 300 },
        paint: { 'text-color': '#3C6C8E', 'text-halo-color': CS.papel, 'text-halo-width': 1.5 } },
      { id: 'rota-txt', type: 'symbol', source: 'topo', 'source-layer': 'rotas', minzoom: 12.5,
        filter: ['all', ['has', 'ref'], ['!=', ['get', 'ref'], '']],
        layout: { 'symbol-placement': 'line', 'text-field': ['get', 'ref'], 'text-font': ['Sans Bold'], 'text-size': 11, 'symbol-spacing': 400 },
        paint: { 'text-color': '#1C2118', 'text-halo-color': '#FFFFFF', 'text-halo-width': 2 } },
      { id: 'cume-p', type: 'symbol', source: 'topo', 'source-layer': 'pontos', minzoom: 10,
        filter: ['==', ['get', 'k'], 'cume'],
        layout: { 'text-field': '▲', 'text-font': ['Sans'], 'text-size': 11, 'text-allow-overlap': true },
        paint: { 'text-color': '#6B5233', 'text-halo-color': CS.papel, 'text-halo-width': 1.2 } },
      { id: 'cume-t', type: 'symbol', source: 'topo', 'source-layer': 'pontos', minzoom: 11.5,
        filter: ['==', ['get', 'k'], 'cume'],
        layout: { 'text-field': ['case', ['has', 'ele'], ['concat', ['get', 'n'], '\n', ['to-string', ['get', 'ele']], ' m'], ['get', 'n']],
                  'text-font': ['Sans Bold'], 'text-size': 10.5, 'text-offset': [0, 0.9], 'text-anchor': 'top' },
        paint: { 'text-color': '#584427', 'text-halo-color': CS.papel, 'text-halo-width': 1.6 } },
      { id: 'servico', type: 'circle', source: 'topo', 'source-layer': 'pontos', minzoom: 13,
        filter: ['all', ['!=', ['get', 'k'], 'cume'], ['!=', ['get', 'k'], 'povoacao']],
        paint: { 'circle-radius': 3.4, 'circle-color': '#2E7D4F', 'circle-stroke-color': '#FFFFFF', 'circle-stroke-width': 1.4 } },
      { id: 'servico-t', type: 'symbol', source: 'topo', 'source-layer': 'pontos', minzoom: 14.5,
        filter: ['all', ['!=', ['get', 'k'], 'cume'], ['!=', ['get', 'k'], 'povoacao'], ['has', 'n']],
        layout: { 'text-field': ['get', 'n'], 'text-font': ['Sans'], 'text-size': 10, 'text-offset': [0, 0.8], 'text-anchor': 'top' },
        paint: { 'text-color': '#2A4A36', 'text-halo-color': CS.papel, 'text-halo-width': 1.5 } },
      { id: 'povoacao', type: 'symbol', source: 'topo', 'source-layer': 'pontos',
        filter: ['==', ['get', 'k'], 'povoacao'],
        minzoom: 8,
        layout: { 'text-field': ['get', 'n'], 'text-font': ['Sans Bold'],
          'text-size': ['interpolate', ['linear'], ['get', 'c'], 1, 16, 2, 13.5, 3, 11.5, 4, 10.5, 5, 9.5],
          'text-transform': ['case', ['<=', ['get', 'c'], 2], 'uppercase', 'none'],
          'text-letter-spacing': ['case', ['<=', ['get', 'c'], 2], 0.06, 0],
          'text-padding': 6 },
        paint: { 'text-color': '#33291C', 'text-halo-color': CS.papel, 'text-halo-width': 2 } },
    ],
  };
}
async function abreTopo() {
  const cx = garanteCaixa();
  try { await ensureML(); } catch (e) { toast('Não foi possível carregar o mapa topográfico.'); return; }
  if (!pmProto) {
    try {
      await loadScript('lib/pmtiles.js');
      pmProto = new pmtiles.Protocol();
      maplibregl.addProtocol('pmtiles', pmProto.tile);
    } catch (e) { toast('Falta a biblioteca do mapa topográfico.'); return; }
  }
  const c = map.getCenter(), z = map.getZoom();
  cx.style.display = 'block';
  ajustaTopo();
  document.getElementById('map').classList.add('escondido');
  if (!mapT) {
    mapT = new maplibregl.Map({ container: 'mapt', attributionControl: false, style: estiloTopo(),
      center: [c.lng, c.lat], zoom: z, maxPitch: 80, minZoom: 8, maxZoom: 21 });
    // O TRAVAO ESTAVA EM 17,5 E NAO POUPAVA NADA. Um mapa vectorial e
    // desenhado no telemovel a resolucao do ecra: nao borra, seja qual for o
    // zoom. Os dados sao os mesmos (Z6-Z15 no pmtiles) -- passar dos 17,5 nao
    // pede um byte a mais, so deixa de cortar o zoom. E a resposta ao "quero
    // nitidez em grande zoom e leve": 91 MB para a serra toda, contra 1,4 GB
    // de fotografia para 321 km2.
    mapT.on('click', (e) => topoClique(e));
    mapT.on('error', (e) => { if (e && e.error && /pmtiles|topo/i.test(String(e.error.message || ''))) toast('Mapa topográfico indisponível.'); });
  } else { mapT.jumpTo({ center: [c.lng, c.lat], zoom: z }); }
  mapT.resize();
  requestAnimationFrame(() => { if (mapT && topoAberto) { ajustaTopo(); mapT.resize(); } });
  setTimeout(() => { if (mapT && topoAberto) mapT.resize(); }, 250);
  topoAberto = true;
  document.getElementById('btn-topo').setAttribute('aria-pressed', 'true');
  document.getElementById('btn-relevo').hidden = false;
  if (meLast) meTopo(meLast);
}
function fechaTopo() {
  if (!topoAberto) return;
  if (mapT) { const c = mapT.getCenter(); map.setView([c.lat, c.lng], Math.round(mapT.getZoom()), { animate: false }); }
  if (caixaTopo) caixaTopo.style.display = 'none';
  document.getElementById('map').classList.remove('escondido');
  topoAberto = false;
  document.getElementById('btn-topo').setAttribute('aria-pressed', 'false');
  document.getElementById('btn-relevo').hidden = true;
}
function topoClique(e) {
  if (!mapT) return;
  const fs = mapT.queryRenderedFeatures(e.point, { layers: ['rota', 'trilho', 'estradao', 'cam', 'estr', 'nac'] });
  if (!fs.length) return;
  const rota = fs.find((f) => f.layer.id === 'rota');
  if (rota) { const r = D.routes.find((x) => x.id === rota.properties.id); if (r) { fechaTopo(); select(r, true); return; } }
  const f = fs[0], p = f.properties || {};
  const nome = { trilho: 'Trilho a pé', estradao: 'Estradão', cam: 'Caminho', estr: 'Estrada', nac: 'Estrada nacional' }[f.layer.id] || 'Caminho';
  const linhas = [`<strong>${nome}</strong>`];
  if (p.n) linhas.push(esc(p.n));
  if (p.s) linhas.push('Piso: ' + esc(p.s));
  new maplibregl.Popup({ closeButton: true, maxWidth: '240px' }).setLngLat(e.lngLat).setHTML(linhas.join('<br>')).addTo(mapT);
}
function meTopo(p) {
  if (!mapT) return;
  const ll = [p.coords.longitude, p.coords.latitude];
  if (!mapT.__me) { const el = document.createElement('div'); el.className = 'me'; el.innerHTML = '<span class="me-dot"></span>'; mapT.__me = new maplibregl.Marker({ element: el }).setLngLat(ll).addTo(mapT); }
  else mapT.__me.setLngLat(ll);
}
document.getElementById('btn-topo').onclick = () => { if (topoAberto) fechaTopo(); else abreTopo(); };

// ---------------- Usar sem rede ----------------
let SW = null, offEstado = { topo: false, topoMB: 0, uso: 0, quota: 0 };
if ('serviceWorker' in navigator) {
  navigator.serviceWorker.register('sw.js').then((reg) => {
    SW = reg.active || reg.waiting || reg.installing;
    navigator.serviceWorker.ready.then((r) => { SW = r.active; pedeEstado(); retomaFundo(); protegeArmazenamento(); });
  }).catch(() => {});
  navigator.serviceWorker.addEventListener('message', (e) => {
    const d = e.data || {};
    if (d.tipo === 'estado') { offEstado = d; pintaOffline(); }
    if (d.tipo === 'progresso') {
      const b = document.getElementById('off-barra-' + d.fase);
      if (b) b.firstElementChild.style.width = d.pct + '%';
      const bt = document.getElementById(d.fase === 'topo' ? 'off-topo' : 'off-fotos');
      if (bt) bt.textContent = (d.fase === 'topo' ? 'A guardar o mapa… ' : 'A guardar as imagens… ')
        + (d.feito != null && d.total != null ? d.feito + ' de ' + d.total : d.pct + '%');
    }
    if (d.tipo === 'pronto') {
      const b = document.getElementById('off-barra-' + d.fase);
      if (b) { b.firstElementChild.style.width = '100%'; b.classList.add('feito'); }
      const bt = document.getElementById(d.fase === 'topo' ? 'off-topo' : 'off-fotos');
      if (bt) { bt.textContent = d.fase === 'topo' ? '✓ Mapa topográfico guardado' : '✓ Zona guardada'; bt.classList.add('on'); }
      if (d.fase === 'fotos') { limpaZona(); largaEcra(); aDescarregar = false; }
      if (d.fase === 'fotos') toast(d.novas ? ('Guardadas ' + fmt(d.novas) + ' imagens novas' + (d.jaLa ? ' (' + fmt(d.jaLa) + ' já tinhas)' : '') + '.') : 'Esta zona já estava toda guardada.');
      else toast('Mapa topográfico guardado.');
      pedeCobertura();
      setTimeout(pedeEstado, 2000);
    }
    if (d.tipo === 'faltam') arrancaDescarga(d.urls || [], d.jaLa || 0);
    if (d.tipo === 'quantos') {
      const b = document.getElementById('off-fotos');
      if (b && !aDescarregar && !/A guardar|A preparar|✓/.test(b.textContent)) {
        const q = satModo === 1 ? ' a 25 cm' : '';
        const mb = satModo === 1 ? Math.round(d.faltam * mbDGT(pxDGT(zDGT(), map.getCenter().lat))) : 0;
        b.textContent = d.faltam
          ? 'Guardar esta zona' + q + ' (' + fmt(d.faltam) + ' novas de ' + fmt(d.total) + (mb ? ', ~' + fmt(mb) + ' MB' : '') + ')'
          : 'Esta zona já está toda guardada' + q;
      }
    }
    if (d.tipo === 'cobertura') { COB = d.quadrados || []; desenhaCobertura(); }
    if (d.tipo === 'erro') toast('Não consegui guardar: ' + d.msg);
    if (d.tipo === 'apagado') { toast('Apaguei o que estava guardado.'); pedeEstado(); }
  });
}
function pedeEstado() { if (navigator.serviceWorker && navigator.serviceWorker.controller) navigator.serviceWorker.controller.postMessage({ tipo: 'estado' }); }
function mandaSW(msg) {
  if (!navigator.serviceWorker || !navigator.serviceWorker.controller) { toast('Ainda a preparar. Tenta daqui a uns segundos.'); return; }
  navigator.serviceWorker.controller.postMessage(msg);
}
const MB = (n) => n >= 1000e6 ? (n / 1e9).toFixed(1).replace('.', ',') + ' GB' : Math.round(n / 1e6) + ' MB';
function fotosDaVista() {
  const vb = vistaUtil(), urls = new Set();
  DET.forEach((t) => { if (vb.intersects(L.latLngBounds([t[0], t[1]], [t[2], t[3]]))) urls.add('dados/det/' + t[4]); });
  ORTHO.forEach(([u, bb]) => { if (vb.intersects(L.latLngBounds(bb))) urls.add(u); });
  (CHUNKS || []).forEach(([u, bb]) => { if (vb.intersects(L.latLngBounds(bb))) urls.add(u); });
  if (satModo === 1) dgtTiles(vb).forEach((u) => urls.add(u));
  if (satModo === 2) satTiles(vb).forEach((u) => urls.add(u));
  return [...urls];
}
// quadrados do satelite online que cobrem a vista, do zoom actual ate ao maximo
function satTiles(vb, ate) {
  const out = [], zMax = Math.min(19, Math.round(map.getZoom()) + (ate == null ? 1 : ate));
  const zMin = Math.max(12, Math.round(map.getZoom()));
  for (let z = zMin; z <= zMax; z++) {
    const n = 2 ** z;
    const x0 = Math.floor((vb.getWest() + 180) / 360 * n), x1 = Math.floor((vb.getEast() + 180) / 360 * n);
    const la = (l) => { const r = l * Math.PI / 180; return Math.floor((1 - Math.log(Math.tan(r) + 1 / Math.cos(r)) / Math.PI) / 2 * n); };
    const y0 = la(vb.getNorth()), y1 = la(vb.getSouth());
    for (let x = x0; x <= x1; x++) for (let y = y0; y <= y1; y++) {
      out.push(SAT_URL.replace('{z}', z).replace('{x}', x).replace('{y}', y));
      if (out.length > 1200) return out;
    }
  }
  return out;
}
function blocoOffline() {
  const e = offEstado;
  const nFotos = fotosDaVista().length;
  return `<div class="off">
    <h3>Usar sem rede</h3>
    <p class="est">Na serra não há rede. O que guardares aqui fica no telemóvel e funciona sem sinal — o GPS não precisa de rede nenhuma.</p>
    <div class="lin">
      <button class="bt ${e.topo ? 'on' : ''}" id="off-topo">${e.topo ? '✓ Mapa topográfico guardado (' + e.topoMB + ' MB)' : 'Guardar mapa topográfico (91 MB)'}</button>
    </div>
    <div class="barra" id="off-barra-topo"><i></i></div>
    <div class="lin">
      <button class="bt" id="off-fotos">Guardar esta zona (${nFotos} imagens)</button>
      <button class="bt ${cobLigada ? 'on' : ''}" id="off-ver">${cobLigada ? '✓ A mostrar a alta resolução' : 'Ver o que já guardei a 25 cm'}</button>
    </div>
    <div class="barra" id="off-barra-fotos"><i></i></div>
    <p class="est" id="off-aviso" style="display:none"></p>
    <p class="est">Guardas por zonas, quantas vezes quiseres: ele traz só o que ainda não tens e junta ao resto, sem repetir nada.
      ${e.quadrados ? 'Já tens <strong>' + fmt(Math.round(KM2(e.quadrados))) + ' km²</strong> a 25 cm.' : 'Para guardar a 25 cm, liga primeiro o satélite da DGT (o botão do meio, na coluna à direita).'}</p>
    <p class="est">Guardado: ${MB(e.uso || 0)}${e.quota ? ' de ' + MB(e.quota) + ' disponíveis' : ''}.
      ${e.topo ? 'Com o topográfico guardado tens curvas de nível, caminhos, água e os percursos todos sem rede.' : ''}</p>
    <div class="lin"><button class="bt" id="off-apagar">Apagar o que está guardado</button></div>
    <p class="est" style="font-size:12.5px">${persistente === true
      ? '🔒 O Android está proibido de apagar isto.'
      : persistente === false
        ? '⚠️ <strong>O Android pode apagar isto sozinho</strong> quando faltar espaço — foi o que aconteceu. Para travar de vez: menu do browser → <strong>Adicionar ao ecrã principal</strong>. Depois abre pelo ícone.'
        : ''}</p>
    <p class="est" style="opacity:.55;font-size:12px">Versão ${VERSAO}</p>
  </div>`;
}
function actualizaContagem() {
  const b = document.getElementById('off-fotos');
  if (!b || aDescarregar || /A guardar|A preparar/i.test(b.textContent)) return;
  const u = fotosDaVista();
  if (!u.length) { b.textContent = 'Aproxima o mapa da zona a guardar'; return; }
  const mb = satModo === 1 ? Math.round(u.length * mbDGT(pxDGT(zDGT(), map.getCenter().lat))) : 0;
  b.textContent = 'Guardar esta zona' + (satModo === 1 ? ' a 25 cm' : '') + ' (' + fmt(u.length) + ' blocos' + (mb ? ', ~' + fmt(mb) + ' MB' : '') + ')';
  const av = document.getElementById('off-aviso');
  if (av) {
    if (satModo === 1) {
      const c = dgtCaixa(vistaUtil(), zDGT());
      if (c.cortado) {
        const km = Math.round((c.x1 - c.x0 + 1) * (c.y1 - c.y0 + 1) * dgtKm2(c.z, c.y0, 2 ** c.z));
        const kmT = Math.round(c.total * dgtKm2(c.z, c.y0, 2 ** c.z));
        av.innerHTML = '<strong>A vista é grande demais para os 25 cm.</strong> Guarda só os <strong>' + fmt(km) + ' km²</strong> do centro; a vista toda seriam ' + fmt(kmT) + ' km² (~' + fmt(Math.round(kmT * 3.4 / 1000)) + ' GB). Aproxima mais para escolheres bem a zona.';
        av.style.display = '';
      } else { av.style.display = 'none'; }
    } else { av.style.display = 'none'; }
  }
  if (navigator.serviceWorker && navigator.serviceWorker.controller) navigator.serviceWorker.controller.postMessage({ tipo: 'quantos', urls: u });
}
// ---- o que ja esta guardado, desenhado no mapa ----
let COB = [], cobGrupo = null, cobLigada = false;
function pedeCobertura() { if (navigator.serviceWorker && navigator.serviceWorker.controller) navigator.serviceWorker.controller.postMessage({ tipo: 'cobertura' }); }
const KM2 = (n) => n * (2 * 20037508.342789244 / 2 ** 16) ** 2 / 1e6;   // area de um bloco z16
function desenhaCobertura() {
  if (!cobLigada) { if (cobGrupo) { cobGrupo.remove(); cobGrupo = null; } return; }
  if (!cobGrupo) cobGrupo = L.layerGroup().addTo(map);
  cobGrupo.clearLayers();
  const vb = map.getBounds();
  let n = 0;
  for (const k of COB) {
    const [z, x, y] = k.split('/').map(Number);
    const nn = 2 ** z;
    const lo0 = x / nn * 360 - 180, lo1 = (x + 1) / nn * 360 - 180;
    const la1 = Math.atan(Math.sinh(Math.PI * (1 - 2 * y / nn))) * 180 / Math.PI;
    const la0 = Math.atan(Math.sinh(Math.PI * (1 - 2 * (y + 1) / nn))) * 180 / Math.PI;
    const b = L.latLngBounds([la0, lo0], [la1, lo1]);
    if (!vb.intersects(b)) continue;
    if (++n > 3000) break;
    L.rectangle(b, { color: '#2E7D4F', weight: 0, fillColor: '#2E7D4F', fillOpacity: 0.22, interactive: false }).addTo(cobGrupo);
  }
}
map.on('moveend zoomend', () => { if (cobLigada) desenhaCobertura(); });
let contaT = null;
map.on('moveend zoomend', () => { clearTimeout(contaT); contaT = setTimeout(actualizaContagem, 400); });
// ---- rectangulo que marca a zona a descarregar ----
let zonaDesc = null;
function tileLL(z, x, y) {
  const n = 2 ** z;
  const lo = x / n * 360 - 180;
  const la = Math.atan(Math.sinh(Math.PI * (1 - 2 * y / n))) * 180 / Math.PI;
  return [la, lo];
}
// so conta a parte do mapa que esta mesmo a ver: o painel de baixo tapa o resto
function vistaUtil() {
  try {
    const el = document.getElementById('sheet');
    const t = map.getSize();
    let corte = 0;
    if (el && !el.hidden && innerWidth < 900) corte = Math.min(el.offsetHeight, t.y - 80);
    const nw = map.containerPointToLatLng([0, 0]);
    const se = map.containerPointToLatLng([t.x, t.y - corte]);
    return L.latLngBounds(nw, se);
  } catch (err) { return map.getBounds(); }
}
function caixaDescarga() {
  if (satModo === 1) {
    const c = dgtCaixa(vistaUtil());
    const a = tileLL(c.z, c.x0, c.y1 + 1), b = tileLL(c.z, c.x1 + 1, c.y0);
    const km = Math.round((c.x1 - c.x0 + 1) * (c.y1 - c.y0 + 1) * dgtKm2(c.z, c.y0, 2 ** c.z));
    return { b: L.latLngBounds(a, b), km: km, tipo: '25 cm' };
  }
  const vb = vistaUtil();
  const la = (vb.getNorth() - vb.getSouth()) * 111, lo = (vb.getEast() - vb.getWest()) * 111 * Math.cos(vb.getCenter().lat * Math.PI / 180);
  return { b: vb, km: Math.round(la * lo), tipo: '63 cm' };
}
// o rectangulo esta sempre a mostrar o que vai ser guardado, antes e durante
function marcaZona() { desenhaZona(); }
function desenhaZona() {
  const painelAberto = !!document.querySelector('#sheet .off');
  if (!painelAberto && !aDescarregar) { limpaZona(); return; }
  const c = caixaDescarga();
  limpaZona();
  zonaDesc = L.layerGroup().addTo(map);
  L.rectangle(c.b, {
    color: '#F0B24A', weight: aDescarregar ? 3 : 2, dashArray: aDescarregar ? null : '8 5',
    fill: true, fillColor: '#F0B24A', fillOpacity: aDescarregar ? .12 : .06, interactive: false,
  }).addTo(zonaDesc);
  const txt = (aDescarregar ? 'a descarregar · ' : 'vai guardar · ') + fmt(c.km) + ' km² a ' + c.tipo;
  L.marker(L.latLng(c.b.getSouth(), c.b.getCenter().lng), {
    interactive: false,
    icon: L.divIcon({ className: 'zrot', html: '<span>' + txt + '</span>', iconSize: [0, 0] }),
  }).addTo(zonaDesc);
}
function limpaZona() { if (zonaDesc) { zonaDesc.remove(); zonaDesc = null; } }
// ---- manter o ecra aceso e continuar com a app fechada ----
let trava = null;
async function aguentaEcra() {
  try { if (navigator.wakeLock && !trava) { trava = await navigator.wakeLock.request('screen'); trava.addEventListener('release', () => { trava = null; }); } } catch (err) {}
}
function largaEcra() { try { if (trava) { trava.release(); trava = null; } } catch (err) {} }
document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible' && aDescarregar) aguentaEcra(); });
let aDescarregar = false;
async function arrancaDescarga(faltam, jaLa) {
  const b = document.getElementById('off-fotos');
  if (!faltam.length) {
    aDescarregar = false; limpaZona(); largaEcra();
    if (b) { b.textContent = '\u2713 Zona guardada'; b.classList.add('on'); }
    toast('Esta zona j\u00e1 estava toda guardada.');
    return;
  }
  // o Background Fetch do Android nao deu resultado com blocos grandes: fica de fora
  try {
    const reg = await navigator.serviceWorker.ready;
    if (reg && reg.backgroundFetch) {
      const antigo = await reg.backgroundFetch.get('fotos');
      if (antigo) await antigo.abort();
    }
  } catch (err) {}
  if (b) b.textContent = 'A guardar\u2026 0 de ' + faltam.length + ' (deixa o ecr\u00e3 ligado)';
  mandaSW({ tipo: 'guardar-fotos', urls: faltam });
}
function segueFundo(bf) {
  aDescarregar = true;
  const pinta = () => {
    const barra = document.getElementById('off-barra-fotos');
    const b = document.getElementById('off-fotos');
    const tot = bf.downloadTotal || 1;
    const pct = Math.max(0, Math.min(100, Math.round(bf.downloaded / tot * 100)));
    if (barra) barra.firstElementChild.style.width = pct + '%';
    if (b && !bf.result) b.textContent = 'A guardar\u2026 ' + pct + '% (podes sair da app)';
  };
  try { bf.addEventListener('progress', pinta); } catch (err) {}
  pinta();
}
function retomaFundo() {
  navigator.serviceWorker.ready.then((r) => {
    if (!r.backgroundFetch) return;
    r.backgroundFetch.get('fotos').then((bf) => { if (bf) segueFundo(bf); }).catch(() => {});
  }).catch(() => {});
}
// ---- pedir ao Android para nao apagar o que esta guardado ----
let persistente = null;
async function protegeArmazenamento() {
  try {
    if (!navigator.storage || !navigator.storage.persist) return;
    persistente = await navigator.storage.persisted();
    if (!persistente) persistente = await navigator.storage.persist();
    if (typeof pintaOffline === 'function' && document.querySelector('#sheet .off')) pintaOffline();
  } catch (err) {}
}
function pintaOffline() {
  const alvo = document.querySelector('#sheet .off');
  if (!alvo) return;
  alvo.outerHTML = blocoOffline();
  ligaOffline();
}
function ligaOffline() {
  const a = document.getElementById('off-topo');
  if (a) a.onclick = () => { if (offEstado.topo) { toast('Já está guardado.'); return; } toast('A guardar o mapa topográfico…'); mandaSW({ tipo: 'guardar-topo' }); };
  const b = document.getElementById('off-fotos');
  if (b) b.onclick = () => {
    const u = fotosDaVista();
    if (!u.length) { toast('Aproxima o mapa da zona que queres guardar.'); return; }
    if (satModo === 1 && u.length > 700 && !confirm('São ' + fmt(u.length) + ' blocos, cerca de ' + fmt(Math.round(u.length * 0.73)) + ' MB, e pode demorar bastante.\n\nQueres mesmo guardar esta área toda? Aproximar o mapa reduz o trabalho.')) return;
    b.textContent = 'A preparar…';
    aDescarregar = true;
    marcaZona();
    aguentaEcra();
    mandaSW({ tipo: 'faltam', urls: u });
  };
  actualizaContagem();
  desenhaZona();
  const v = document.getElementById('off-ver');
  if (v) v.onclick = () => {
    cobLigada = !cobLigada;
    v.textContent = cobLigada ? '✓ A mostrar a alta resolução' : 'Ver o que já guardei a 25 cm';
    v.classList.toggle('on', cobLigada);
    if (cobLigada) { pedeCobertura(); if (!COB.length) toast('Ainda não guardaste nada a 25 cm. Liga o satélite da DGT e guarda uma zona.'); }
    else desenhaCobertura();
  };
  const c = document.getElementById('off-apagar');
  if (c) c.onclick = () => { if (confirm('Apagar o mapa e as imagens guardadas no telemóvel?')) mandaSW({ tipo: 'apagar' }); };
}
document.getElementById('btn-relevo').onclick = () => {
  if (!mapT) return;
  topoRelevo = !topoRelevo;
  document.getElementById('btn-relevo').setAttribute('aria-pressed', topoRelevo);
  if (topoRelevo) { mapT.setTerrain({ source: 'dem', exaggeration: 1.25 }); mapT.easeTo({ pitch: 58, duration: 600 }); }
  else { mapT.setTerrain(null); mapT.easeTo({ pitch: 0, bearing: 0, duration: 600 }); }
};

const layers = new Map();
let selected = null;
function styleFor(r, hi) {
  if (r.lidar) return null;
  const base = r.fonte === 'oficial' ? { weight: 2.2, opacity: 1 } : { weight: 1.7, opacity: .85, dashArray: r.fonte === 'osm' ? null : '5 4' };
  return Object.assign({ color: hi ? css('--pr-y') : '#FFFFFF' }, base, hi ? { weight: 3.2, opacity: 1 } : {});
}
D.routes.forEach((r) => {
  const g = L.layerGroup();
  if (r.lidar && r.segs) {
    r.segs.forEach((s) => L.polyline(segPts(s), { color: '#0B120D', weight: 5, opacity: .5, interactive: false, casing: true }).addTo(g));
    r.segs.forEach((s) => L.polyline(segPts(s), { color: shadeCol(s[0]), weight: 2.8, opacity: 1, interactive: false }).addTo(g));
  } else {
    L.polyline(geo(r), Object.assign({ interactive: false }, styleFor(r))).addTo(g);
    L.polyline(geo(r), { color: '#0B120D', weight: r.fonte === 'oficial' ? 4 : 3.4, opacity: .35, interactive: false }).addTo(g).bringToBack();
  }
  g.addTo(map); layers.set(r.id, g);
});
layers.forEach((g, id) => { const r = D.routes.find((x) => x.id === id); if (r.lidar) g.eachLayer((l) => l.bringToFront && l.bringToFront()); });

function prBadge(r) {
  const code = (r.ref || '').toUpperCase();
  if (/^GR/.test(code)) return '<span class="pr gr" aria-hidden="true"><i></i><i></i></span>';
  if (/^PR/.test(code)) return '<span class="pr" aria-hidden="true"><i></i><i></i></span>';
  return '<span class="pr none" aria-hidden="true"><i></i><i></i></span>';
}
const fonteTxt = { oficial: 'GPX oficial', osm: 'OpenStreetMap (não oficial)', gravacao: 'Gravação de caminhante' };
const esc = (s) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

function sheetIdle() {
  setTimeout(() => { if (typeof desenhaZona === 'function') desenhaZona(); }, 30);
  const n = D.routes.length, km = D.routes.reduce((s, r) => s + (r.km || 0), 0);
  $('sheet').innerHTML = `<div class="grab"></div>
    <p class="hint">Toca num percurso marcado ou em qualquer caminho do mapa para ver o que é. Para procurar, filtrar e ordenar, abre a <strong>Lista</strong>. Em <strong>Criar</strong> montas o teu próprio trilho.</p>
    <div class="stats">
      <div class="stat"><div class="v">${fmt(n)}</div><div class="l">percursos marcados</div></div>
      <div class="stat"><div class="v">${fmt(km)} km</div><div class="l">de traçado</div></div>
      <div class="stat"><div class="v">20 358 km</div><div class="l">de caminhos na rede</div></div>
    </div>
    <div class="kchips">${OSM_KINDS.map((k) => `<span class="kc"><i style="border-top-color:${OSM_STYLE[k].color}"></i>${OSM_NOME[k]}</span>`).join('')}</div>
    <p class="note">Os caminhos aparecem a partir do zoom médio. A cor dos percursos marcados mostra a sombra medida por LiDAR, onde existe.</p>
    ${blocoOffline()}`;
  ligaOffline(); pedeEstado(); pedeCobertura();
}
function select(r, fly = false) {
  if (selected) restyle(selected, false); if (elMarker) elMarker.remove();
  selected = r; focusOn(r); restyle(r, true);
  const tags = [];
  tags.push(`<span class="tag">${fonteTxt[r.fonte]}</span>`);
  if (r.pnse >= 50) tags.push('<span class="tag">Parque Natural</span>');
  if (r.a25 > 0) tags.push(`<span class="tag warn">Ardido em 2025: ${fmt(r.a25)}%</span>`);
  else if (r.a25 === 0) tags.push('<span class="tag ok">Sem fogo em 2025</span>');
  let shade = '';
  if (r.lidar) {
    const segs = r.segs || [];
    shade = `<div class="stats">
      <div class="stat"><div class="v" style="color:${shadeCol(r.lidar.sombra)}">${fmt(r.lidar.sombra)}%</div><div class="l">trilho com árvore &gt; 3 m ao lado</div></div>
      <div class="stat"><div class="v">${fmt(r.lidar.copa)}%</div><div class="l">copa por cima do caminho</div></div>
      <div class="stat"><div class="v">${fmt(r.lidar.alt)} m</div><div class="l">altura mediana das árvores</div></div>
      <div class="stat"><div class="v">${fmt(r.lidar.sol)} m</div><div class="l">maior troço seguido ao sol</div></div></div>
      <div class="shadebar" role="img" aria-label="Sombra ao longo do percurso, troços de 100 m">${segs.map(([p]) => `<span style="flex:1;background:${shadeCol(p)}"></span>`).join('')}</div>
      <p class="note">Barra = sombra de 100 em 100 m, do início ao fim do traçado. LiDAR DGT 2024.</p>`;
  } else {
    shade = `<div class="stats">
      <div class="stat"><div class="v">${fmt(r.arv)}%</div><div class="l">traçado em árvores (COSc, estimativa baixa)</div></div>
      <div class="stat"><div class="v">${fmt(r.semveg)}%</div><div class="l">sem vegetação</div></div></div>
      <p class="note">Sem LiDAR neste percurso: a sombra real costuma ser bastante maior do que a COSc indica.</p>`;
  }
  $('sheet').innerHTML = `<div class="grab"></div><button class="close" id="x" aria-label="Fechar">×</button>
    <div class="t-meta">${prBadge(r)}<strong style="color:var(--ink)">${esc(r.ref) || 'Sem código'}</strong></div>
    <h2 class="t-name">${esc(r.nome)}</h2>
    <div class="t-meta">${tags.join('')}</div>
    ${wikiHead(r)}${profileSVG(r)}
    <div class="gpxrow"><button class="btn" id="gpx">Descarregar GPX</button><button class="btn alt" id="b3d">Ver em 3D</button><span class="note" id="gpx-msg" aria-live="polite"></span></div>
    ${altBlock(r)}${weatherBlock(r)}${poiList(r)}${wikiStats(r)}
    <h3 class="sec">Sombra</h3>${shade}`;
  bindProfile(r); bindGpx(r); bindAlt(r); document.getElementById('b3d').onclick = () => open3D(r);
  document.querySelectorAll('.wpb').forEach((b) => b.onclick = () => { showMap(); map.setView([+b.dataset.la, +b.dataset.lo], Math.max(map.getZoom(), 16)); });
  $('x').onclick = () => { const fb2 = document.getElementById('fabs'); if (fb2) fb2.hidden = true; restyle(r, false); selected = null; if (elMarker) elMarker.remove(); unfocus(); sheetIdle(); };
  if (fly) { showMap(); map.fitBounds(L.polyline(geo(r)).getBounds(), { padding: [30, 30], maxZoom: 15 }); }
  $('sheet').scrollTop = 0; $('sheet').classList.remove('peek');
  const fb = document.getElementById('fabs'); if (fb) fb.hidden = true;
}
// Perfil de elevação (Copernicus DEM 30 m, amostras ao longo do traçado)
let elMarker = null;
function profileSVG(r) {
  const e = r.el; if (!e) return '';
  const W = 360, H = 130, pl = 34, pr = 8, pt = 10, pb = 20, z = e.z, n = z.length;
  let lo = Math.min(...z), hi = Math.max(...z); const span = Math.max(hi - lo, 40); const pad = span * 0.08;
  lo = lo - pad; hi = lo + span + 2 * pad;
  const X = (i) => pl + (W - pl - pr) * i / (n - 1), Y = (v) => pt + (H - pt - pb) * (1 - (v - lo) / (hi - lo));
  const line = z.map((v, i) => `${i ? 'L' : 'M'}${X(i).toFixed(1)},${Y(v).toFixed(1)}`).join('');
  const area = `${line}L${X(n - 1).toFixed(1)},${H - pb}L${pl},${H - pb}Z`;
  const stepZ = [10, 20, 25, 50, 100, 200, 250, 500].find((s) => (hi - lo) / s <= 4) || 1000;
  let grid = '';
  for (let v = Math.ceil(lo / stepZ) * stepZ; v <= hi; v += stepZ) grid += `<line x1="${pl}" x2="${W - pr}" y1="${Y(v).toFixed(1)}" y2="${Y(v).toFixed(1)}" class="pg"/><text x="${pl - 4}" y="${(Y(v) + 3.5).toFixed(1)}" text-anchor="end" class="pt">${v}</text>`;
  const km = e.L / 1000, stepK = [0.5, 1, 2, 5, 10, 20].find((s) => km / s <= 6) || 50;
  for (let k = 0; k <= km + 1e-6; k += stepK) { const x = pl + (W - pl - pr) * k / km; grid += `<text x="${x.toFixed(1)}" y="${H - 5}" text-anchor="middle" class="pt">${fmt(k, stepK < 1 ? 1 : 0)}</text>`; }
  return `<div class="prof"><div class="prof-h"><strong>Perfil de elevação</strong><span>↗ ${fmt(e.up)} m · ↘ ${fmt(e.dn)} m</span></div>
    <svg id="prof" viewBox="0 0 ${W} ${H}" role="img" aria-label="Perfil de elevação: de ${fmt(Math.min(...z))} a ${fmt(Math.max(...z))} m ao longo de ${fmt(km, 1)} km">
      <defs><linearGradient id="pgr" x1="0" y1="0" x2="0" y2="1"><stop offset="0" style="stop-color:var(--s-mid);stop-opacity:.75"/><stop offset="1" style="stop-color:var(--s-hi);stop-opacity:.55"/></linearGradient></defs>${grid}<path d="${area}" fill="url(#pgr)"/><path d="${line}" class="pl"/>
      ${poisAlong(r).map((o) => { const x = X(o.idx); return `<g transform="translate(${x.toFixed(1)},${(Y(z[o.idx]) - 9).toFixed(1)})"><circle r="5" fill="${PCAT[o.p[2]][1]}" stroke="#fff" stroke-width="1.5"/></g>`; }).join('')}<line id="prof-c" x1="0" x2="0" y1="${pt}" y2="${H - pb}" class="pc" visibility="hidden"/><circle id="prof-d" r="3.5" class="pd" visibility="hidden"/>
    </svg><div class="prof-r" id="prof-r">Passa o dedo no gráfico para ver o ponto no mapa · km</div></div>`;
}
function bindProfile(r) {
  const e = r.el, svg = document.getElementById('prof'); if (!e || !svg) return;
  const pts = decodePoly(e.p), W = 360, pl = 34, pr = 8, H = 130, pt = 10, pb = 20, z = e.z, n = z.length;
  let lo = Math.min(...z), hi = Math.max(...z); const span = Math.max(hi - lo, 40); const pad = span * 0.08; lo = lo - pad; hi = lo + span + 2 * pad;
  const move = (ev) => {
    const b = svg.getBoundingClientRect(); const x = (ev.clientX - b.left) / b.width * W;
    const i = Math.max(0, Math.min(n - 1, Math.round((x - pl) / (W - pl - pr) * (n - 1))));
    const X = pl + (W - pl - pr) * i / (n - 1), Yv = pt + (H - pt - pb) * (1 - (z[i] - lo) / (hi - lo));
    const c = document.getElementById('prof-c'), d = document.getElementById('prof-d');
    c.setAttribute('x1', X); c.setAttribute('x2', X); c.setAttribute('visibility', 'visible');
    d.setAttribute('cx', X); d.setAttribute('cy', Yv); d.setAttribute('visibility', 'visible');
    const sv = r.alt && r.alt.sv ? r.alt.sv[i] : -1, st = r.alt && r.alt.st ? r.alt.st[i] : -1;
    document.getElementById('prof-r').textContent = `km ${fmt(e.L / 1000 * i / (n - 1), 1)} · ${fmt(z[i])} m` + (sv === 0 ? ' · numa aldeia' : sv > 0 ? ` · aldeia a ${fmt(sv / 1000, 1)} km` : '') + (st > 0 ? ` · estradão a ${st < 1000 ? fmt(st) + ' m' : fmt(st / 1000, 1) + ' km'}` : st === 0 ? ' · em estradão' : '');
    const ll = pts[Math.min(i, pts.length - 1)];
    if (!elMarker) elMarker = L.circleMarker(ll, { radius: 7, color: '#fff', weight: 3, fillColor: '#111', fillOpacity: 1, interactive: false }).addTo(map);
    else elMarker.setLatLng(ll).addTo(map);
  };
  svg.addEventListener('pointermove', move); svg.addEventListener('pointerdown', move);
  svg.style.touchAction = 'none';
}
// GPX (dentro de .zip — o descarregamento da página só aceita zip, não .gpx solto)
const downloadsP = (window.claude && claude.use) ? claude.use('downloads') : Promise.resolve(null);
function routePath(r) {
  const parts = geo(r).filter((p) => p.length > 1);
  if (!r.el || !r.el.o) return { segs: parts, z: null };
  const used = new Set(), path = [];
  r.el.o.forEach(([i, rev]) => { used.add(i); const p = rev ? geo(r)[i].slice().reverse() : geo(r)[i]; path.push(...(path.length ? p.slice(1) : p)); });
  const rest = geo(r).filter((p, i) => !used.has(i) && p.length > 1);
  return { segs: [path, ...rest], z: r.el };
}
function haversine(a, b) { const R = 6371000, t = Math.PI / 180, dLa = (b[0] - a[0]) * t, dLo = (b[1] - a[1]) * t; const h = Math.sin(dLa / 2) ** 2 + Math.cos(a[0] * t) * Math.cos(b[0] * t) * Math.sin(dLo / 2) ** 2; return 2 * R * Math.asin(Math.sqrt(h)); }
function gpxFor(r) {
  const { segs, z } = routePath(r); const x = (s) => String(s).replace(/[<&>"]/g, (c) => ({ '<': '&lt;', '&': '&amp;', '>': '&gt;', '"': '&quot;' }[c]));
  const segXml = segs.map((pts, si) => {
    let d = 0;
    return '<trkseg>' + pts.map((p, i) => {
      if (i) d += haversine(pts[i - 1], p);
      let ele = '';
      if (z && si === 0) { const n = z.z.length, f = Math.min(n - 1, d / z.L * (n - 1)), k = Math.floor(f), w = f - k; ele = `<ele>${Math.round(z.z[k] * (1 - w) + (z.z[Math.min(n - 1, k + 1)]) * w)}</ele>`; }
      return `<trkpt lat="${p[0].toFixed(6)}" lon="${p[1].toFixed(6)}">${ele}</trkpt>`;
    }).join('') + '</trkseg>';
  }).join('\n');
  const name = [r.ref, r.nome].filter(Boolean).join(' · ');
  return `<?xml version="1.0" encoding="UTF-8"?>\n<gpx version="1.1" creator="Sombra na Estrela" xmlns="http://www.topografix.com/GPX/1/1">\n<metadata><name>${x(name)}</name><desc>${x(`Fonte do traçado: ${fonteTxt[r.fonte] || r.fonte}. Altitude: Copernicus DEM 30 m.`)}</desc></metadata>\n<trk><name>${x(name)}</name>\n${segXml}\n</trk>\n</gpx>\n`;
}
const CRC = (() => { const t = new Uint32Array(256); for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xEDB88320 ^ (c >>> 1) : c >>> 1; t[n] = c >>> 0; } return (u) => { let c = 0xFFFFFFFF; for (let i = 0; i < u.length; i++) c = t[(c ^ u[i]) & 255] ^ (c >>> 8); return (c ^ 0xFFFFFFFF) >>> 0; }; })();
function zipOne(fname, text) {
  const enc = new TextEncoder(), nm = enc.encode(fname), data = enc.encode(text), crc = CRC(data);
  const lh = new DataView(new ArrayBuffer(30)); [[0, 0x04034b50, 4], [4, 20, 2], [6, 0x0800, 2], [8, 0, 2], [10, 0, 2], [12, 0x21, 2], [14, crc, 4], [18, data.length, 4], [22, data.length, 4], [26, nm.length, 2], [28, 0, 2]].forEach(([o, v, s]) => s === 4 ? lh.setUint32(o, v, true) : lh.setUint16(o, v, true));
  const ch = new DataView(new ArrayBuffer(46)); [[0, 0x02014b50, 4], [4, 20, 2], [6, 20, 2], [8, 0x0800, 2], [10, 0, 2], [12, 0, 2], [14, 0x21, 2], [16, crc, 4], [20, data.length, 4], [24, data.length, 4], [28, nm.length, 2], [30, 0, 2], [32, 0, 2], [34, 0, 2], [36, 0, 2], [38, 0, 4], [42, 0, 4]].forEach(([o, v, s]) => s === 4 ? ch.setUint32(o, v, true) : ch.setUint16(o, v, true));
  const off = 30 + nm.length + data.length, cdSize = 46 + nm.length;
  const end = new DataView(new ArrayBuffer(22)); [[0, 0x06054b50, 4], [4, 0, 2], [6, 0, 2], [8, 1, 2], [10, 1, 2], [12, cdSize, 4], [16, off, 4], [20, 0, 2]].forEach(([o, v, s]) => s === 4 ? end.setUint32(o, v, true) : end.setUint16(o, v, true));
  return new Blob([lh, nm, data, ch, nm, end]);
}
const slug = (s) => s.normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[^A-Za-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 60) || 'percurso';
async function bindGpx(r) {
  const btn = document.getElementById('gpx'), msg = document.getElementById('gpx-msg'); if (!btn) return;
  const dl = await downloadsP;
  if (!dl) { btn.hidden = true; msg.textContent = 'Descarregar não está disponível nesta vista.'; return; }
  btn.onclick = async () => {
    const base = slug([r.ref, r.nome].filter(Boolean).join(' '));
    try {
      const res = await dl.save({ filename: base + '.zip', data: zipOne(base + '.gpx', gpxFor(r)) });
      msg.textContent = res.status === 'saved' ? `Descarregado: ${base}.zip (tem o ${base}.gpx dentro).` : '';
    } catch (e) {
      const c = e && e.code;
      msg.textContent = c === 'declined' ? 'Descarregamento cancelado.' : c === 'rate_limited' ? 'Já há um pedido aberto; tenta daqui a pouco.' : c === 'extension_not_enabled' ? 'Ficheiros .zip não estão disponíveis nesta vista.' : 'Não foi possível descarregar aqui.';
      if (['unavailable', 'not_granted', 'capability_disabled', 'capability_removed'].includes(c)) btn.hidden = true;
    }
  };
}
// Cabeçalho e estatísticas ao estilo das apps de trilhos
function routeInfo(r) {
  const e = r.el; const km = e ? e.L / 1000 : r.km;
  const up = e ? e.up : null, dn = e ? e.dn : null;
  const zmax = e ? Math.max(...e.z) : r.zmax, zmin = e ? Math.min(...e.z) : r.zmin;
  let tipo = '—';
  if (e) { const p = decodePoly(e.p); const d = haversine(p[0], p[p.length - 1]); tipo = d < 250 ? 'Circular' : 'Linear'; }
  const esforco = km + (up ?? 0) / 100; // km-esforço: 100 m de subida ≈ 1 km plano
  const dif = esforco < 8 ? ['Fácil', 'd1'] : esforco < 15 ? ['Moderada', 'd2'] : esforco < 24 ? ['Difícil', 'd3'] : ['Muito difícil', 'd4'];
  const horas = esforco / 4; const hh = Math.floor(horas), mm = Math.round((horas - hh) * 60 / 5) * 5;
  return { km, up, dn, zmax, zmin, tipo, dif, tempo: `${hh} h ${String(mm % 60).padStart(2, '0')}` };
}
function wikiHead(r) {
  const i = routeInfo(r);
  return `<div class="wk">
    <div><span class="wl">Distância</span><span class="wv">${fmt(i.km, 2)} km</span></div>
    <div><span class="wl">Desnível +</span><span class="wv">${i.up == null ? '—' : fmt(i.up) + ' m'}</span></div>
    <div><span class="wl">Dificuldade</span><span class="wv"><span class="dchip ${i.dif[1]}">${i.dif[0]}</span></span></div>
  </div>`;
}
function wikiStats(r) {
  const i = routeInfo(r);
  const cell = (l, v) => `<div class="ws"><span class="wl">${l}</span><span class="wv2">${v}</span></div>`;
  return `<h3 class="sec">Estatísticas do percurso</h3><div class="wsg">
    ${cell('Distância', fmt(i.km, 2) + ' km')}${cell('Tipo de percurso', i.tipo)}
    ${cell('Desnível positivo', i.up == null ? '—' : fmt(i.up) + ' m')}${cell('Desnível negativo', i.dn == null ? '—' : fmt(i.dn) + ' m')}
    ${cell('Elevação máx.', fmt(i.zmax) + ' m')}${cell('Elevação mín.', fmt(i.zmin) + ' m')}
    ${cell('Dificuldade', i.dif[0])}${cell('Tempo estimado', i.tempo)}
    ${cell('Ardeu 1990–2025', fmt(r.a90) + ' %')}${cell('No Parque Natural', fmt(r.pnse) + ' %')}
  </div><p class="note">Dificuldade e tempo são estimativas: 100 m de subida contam como 1 km, a 4 km/h. Altitude do Copernicus DEM 30 m.</p>`;
}
// Nomes e pontos de interesse (OpenStreetMap)
const POI = window.__POI__ || [];
const PCAT = {
  water: ['Fonte / água', '#2F7FC1', '<path d="M12 4C9.5 8.5 7 11 7 14.5a5 5 0 0 0 10 0C17 11 14.5 8.5 12 4z" fill="#fff" stroke="none"/>'],
  peak: ['Pico', '#6B4F3A', '<path d="M12 6 20 19H4z" fill="#fff" stroke="none"/>'],
  saddle: ['Colo', '#6B4F3A', '<path d="M4 17c4-8 12-8 16 0"/>'],
  waterfall: ['Cascata', '#1F8FA6', '<path d="M8 5v14M12 5v14M16 5v14"/>'],
  view: ['Miradouro', '#C97A12', '<circle cx="8" cy="14" r="3"/><circle cx="16" cy="14" r="3"/><path d="M8 11 9.5 6h5L16 11M11 14h2"/>'],
  picnic: ['Parque de merendas', '#4F8A2E', '<path d="M5 9h14M8 9l-3 9M16 9l3 9M6.5 14h11"/>'],
  shelter: ['Abrigo', '#8A5A2B', '<path d="M4 12 12 5l8 7M6.5 10.5V19h11v-8.5"/>'],
  bath: ['Praia fluvial', '#1F8FA6', '<path d="M4 14c2.7-2 5.3 2 8 0s5.3 2 8 0M4 18c2.7-2 5.3 2 8 0s5.3 2 8 0"/><circle cx="12" cy="8" r="2"/>'],
  camp: ['Parque de campismo', '#4F8A2E', '<path d="M12 6 4 19h16zM12 6v13"/>'],
  chapel: ['Capela / igreja', '#6D5B8C', '<path d="M12 4v16M7 9h10"/>'],
  heritage: ['Património', '#7A6A55', '<path d="M5 19h14M6 9h12M12 5 6 9h12zM9 9v10M15 9v10"/>'],
  attraction: ['Ponto de interesse', '#B83A2E', '<path d="M12 4l2.4 5 5.4.7-4 3.8 1 5.4L12 16.3 7.2 19l1-5.4-4-3.8 5.4-.7z" fill="#fff" stroke="none"/>'],
  info: ['Informação', '#3B6EA8', '<path d="M12 11v7M12 7v.5"/>'],
  parking: ['Estacionamento', '#2F5DA8', '<path d="M9 19V6h4a3.5 3.5 0 0 1 0 7H9"/>'],
  wc: ['WC', '#5B6770', '<path d="M5 8l1.5 8L8.5 10l2 6L12 8M19 9a3 3 0 1 0 0 6"/>'],
  cave: ['Gruta', '#555', '<path d="M5 18c0-6 3-10 7-10s7 4 7 10M10 18c0-2.5 1-4 2-4s2 1.5 2 4"/>'],
  rock: ['Penedo', '#6F6F6F', '<path d="M5 18l3-6 4-3 4 2 3 7z"/>'],
};
const LABEL = { town: 'pl-town', village: 'pl-vil', hamlet: 'pl-ham', lake: 'pl-lake' };
const poiIcon = (c, size = 24) => `<svg viewBox="0 0 24 24" width="${size}" height="${size}" aria-hidden="true"><circle cx="12" cy="12" r="11" fill="${PCAT[c][1]}" stroke="#fff" stroke-width="1.5"/><g fill="none" stroke="#fff" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">${PCAT[c][2]}</g></svg>`;
map.createPane('poiP').style.zIndex = 620;
const poiLayer = L.layerGroup().addTo(map), poiOn = new Map(); let routePoi = new Set();
function poiMinZoom(p, i) {
  const c = p[2];
  if (routePoi.has(i)) return 12;
  const B = smallScreen() ? 1 : 0;
  if (c === 'town') return 9 + B; if (c === 'village') return 11 + B; if (c === 'lake') return 12 + B;
  if (c === 'hamlet') return 13 + B; if (c === 'peak') return (p[3] ? 12 : 14) + B;
  return 14 + B;
}
function poiMarker(p, i) {
  const [la, lo, c, name, ele] = p;
  if (LABEL[c]) return L.marker([la, lo], { pane: 'poiP', interactive: false, keyboard: false, icon: L.divIcon({ className: 'plabel ' + LABEL[c], html: `<span>${esc(name)}</span>`, iconSize: null }) });
  const onRoute = routePoi.has(i);
  const m = L.marker([la, lo], { pane: 'poiP', title: name || PCAT[c][0], icon: L.divIcon({ className: 'picon' + (onRoute ? ' on' : ''), html: poiIcon(c, onRoute ? 28 : 22) + (name && (c === 'peak' || onRoute || map.getZoom() >= (smallScreen() ? 16 : 15)) ? `<span class="pname">${esc(name)}${c === 'peak' && ele ? ' ' + ele + ' m' : ''}</span>` : ''), iconSize: [onRoute ? 28 : 22, onRoute ? 28 : 22], iconAnchor: [onRoute ? 14 : 11, onRoute ? 14 : 11] }) });
  m.bindPopup(`<strong>${esc(name || PCAT[c][0])}</strong><br>${PCAT[c][0]}${ele ? ' · ' + ele + ' m' : ''}`);
  return m;
}
function renderPoi() {
  const z = map.getZoom(), vb = map.getBounds().pad(0.1), want = new Set();
  const cap = smallScreen() ? 70 : 220;
  POI.forEach((p, i) => { if (want.size < cap && z >= poiMinZoom(p, i) && vb.contains([p[0], p[1]])) want.add(i); });
  poiOn.forEach((m, i) => { if (!want.has(i)) { poiLayer.removeLayer(m); poiOn.delete(i); } });
  want.forEach((i) => { if (!poiOn.has(i)) { const m = poiMarker(POI[i], i); poiOn.set(i, m); poiLayer.addLayer(m); } });
}
function refreshPoi() { poiOn.forEach((m) => poiLayer.removeLayer(m)); poiOn.clear(); renderPoi(); }
let lastPoiZ = map.getZoom();
map.on('moveend', () => { if ((lastPoiZ >= 15) !== (map.getZoom() >= 15)) { lastPoiZ = map.getZoom(); refreshPoi(); } else renderPoi(); });
map.on('zoomend', notaLimite);
map.on('moveend zoomend', () => { desenhaZona(); });
renderPoi();
// POI ao longo de um percurso (até 150 m do traçado), com km
function poisAlong(r) {
  if (!r.el) return [];
  const pts = decodePoly(r.el.p), n = pts.length, k = Math.cos(pts[0][0] * Math.PI / 180), out = [];
  const bb = L.latLngBounds(pts).pad(0.02);
  POI.forEach((p, i) => {
    if (LABEL[p[2]] && p[2] !== 'lake' || !vbHas(bb, p)) return;
    let best = 1e12, bi = 0;
    for (let j = 0; j < n; j++) { const dy = (p[0] - pts[j][0]) * 111320, dx = (p[1] - pts[j][1]) * 111320 * k, d = dx * dx + dy * dy; if (d < best) { best = d; bi = j; } }
    if (best < 150 * 150) out.push({ i, p, idx: bi, km: r.el.L / 1000 * bi / (n - 1) });
  });
  const res = [];
  out.filter((o) => !LABEL[o.p[2]]).sort((a, b) => a.km - b.km).forEach((o) => { if (!res.some((q) => q.p[2] === o.p[2] && (q.p[3] || '') === (o.p[3] || '') && Math.abs(q.km - o.km) < 0.3)) res.push(o); });
  return res;
}
const vbHas = (bb, p) => bb.contains([p[0], p[1]]);
function poiList(r) {
  const L_ = poisAlong(r); if (!L_.length) return '';
  return `<h3 class="sec">Pontos de interesse no percurso · ${L_.length}</h3><ol class="wp">${L_.slice(0, 40).map((o) => `<li><button class="wpb" data-la="${o.p[0]}" data-lo="${o.p[1]}">${poiIcon(o.p[2], 22)}<span><span class="nm">${esc(o.p[3] || PCAT[o.p[2]][0])}</span><br><span class="sub">${PCAT[o.p[2]][0]}${o.p[4] ? ' · ' + o.p[4] + ' m' : ''}</span></span><span class="km">km ${fmt(o.km, 1)}</span></button></li>`).join('')}</ol>`;
}
// Previsão do tempo (IPMA, guardada diariamente na base de dados da página)
const dbP = (window.claude && claude.use) ? claude.use('db') : Promise.resolve(null);
let TEMPO = null;
dbP.then(async (db) => { if (!db) return; try { const s = await db.doc('tempo/previsao').get(); TEMPO = s && (s.data ? s.data() : s); if (selected) { const el = document.getElementById('wx'); if (el) el.outerHTML = weatherBlock(selected); } } catch (e) {} });
const WX_ICON = {
  sol: '<circle cx="12" cy="12" r="4.5" fill="#F2B233"/><g stroke="#F2B233" stroke-width="2" stroke-linecap="round"><path d="M12 2.5v2.5M12 19v2.5M2.5 12H5M19 12h2.5M5.3 5.3l1.8 1.8M16.9 16.9l1.8 1.8M5.3 18.7l1.8-1.8M16.9 7.1l1.8-1.8"/></g>',
  solnuvem: '<circle cx="9" cy="9" r="3.6" fill="#F2B233"/><g stroke="#F2B233" stroke-width="1.8" stroke-linecap="round"><path d="M9 2.5v1.6M2.5 9h1.6M4.4 4.4l1.1 1.1M13.6 4.4l-1.1 1.1"/></g><path d="M8 19h9.5a3.5 3.5 0 0 0 0-7 5 5 0 0 0-9.3 1.2A2.9 2.9 0 0 0 8 19z" fill="#DDE3E8" stroke="#9AA6B0" stroke-width="1.2"/>',
  nuvem: '<path d="M6.5 18.5h11a4 4 0 0 0 0-8 5.8 5.8 0 0 0-11 1.5 3.3 3.3 0 0 0 0 6.5z" fill="#DDE3E8" stroke="#9AA6B0" stroke-width="1.2"/>',
  chuva: '<path d="M6.5 14.5h11a4 4 0 0 0 0-8 5.8 5.8 0 0 0-11 1.5 3.3 3.3 0 0 0 0 6.5z" fill="#C9D2DA" stroke="#8795A1" stroke-width="1.2"/><g stroke="#3E86C6" stroke-width="1.8" stroke-linecap="round"><path d="M8 17l-1 3M12 17l-1 3M16 17l-1 3"/></g>',
  trovoada: '<path d="M6.5 13.5h11a4 4 0 0 0 0-8 5.8 5.8 0 0 0-11 1.5 3.3 3.3 0 0 0 0 6.5z" fill="#AEB8C2" stroke="#6F7C88" stroke-width="1.2"/><path d="M12.5 13l-3 5h3l-1.5 4 4.5-6h-3l1.5-3z" fill="#F2B233"/>',
  nevoeiro: '<g stroke="#9AA6B0" stroke-width="2" stroke-linecap="round"><path d="M4 9h16M6 13h12M4 17h16"/></g>',
  neve: '<path d="M6.5 14.5h11a4 4 0 0 0 0-8 5.8 5.8 0 0 0-11 1.5 3.3 3.3 0 0 0 0 6.5z" fill="#DDE3E8" stroke="#9AA6B0" stroke-width="1.2"/><g fill="#7FB3E0"><circle cx="8" cy="18.5" r="1.3"/><circle cx="12" cy="20" r="1.3"/><circle cx="16" cy="18.5" r="1.3"/></g>',
};
const WX_TXT = { 1: 'Céu limpo', 2: 'Pouco nublado', 3: 'Parcialmente nublado', 4: 'Muito nublado', 5: 'Nuvens altas', 6: 'Aguaceiros', 7: 'Aguaceiros fracos', 8: 'Aguaceiros fortes', 9: 'Chuva', 10: 'Chuva fraca', 11: 'Chuva forte', 12: 'Períodos de chuva', 13: 'Períodos de chuva fraca', 14: 'Períodos de chuva forte', 15: 'Chuvisco', 16: 'Neblina', 17: 'Nevoeiro', 18: 'Neve', 19: 'Trovoada', 20: 'Aguaceiros e trovoada', 21: 'Granizo', 22: 'Geada', 23: 'Chuva e trovoada', 24: 'Nebulosidade convectiva', 25: 'Períodos muito nublado', 26: 'Nevoeiro', 27: 'Nublado', 28: 'Aguaceiros de neve', 29: 'Chuva e neve', 30: 'Chuva e neve' };
const wxGroup = (id) => id === 1 ? 'sol' : [2, 3, 5, 25].includes(id) ? 'solnuvem' : [4, 24, 27].includes(id) ? 'nuvem' : [16, 17, 26].includes(id) ? 'nevoeiro' : [18, 22, 28, 29, 30].includes(id) ? 'neve' : [19, 20, 21, 23].includes(id) ? 'trovoada' : id >= 6 && id <= 15 ? 'chuva' : 'nuvem';
const VENTO = { 1: 'fraco', 2: 'moderado', 3: 'forte', 4: 'muito forte' };
const AVISO_COR = { yellow: 'Amarelo', orange: 'Laranja', red: 'Vermelho' };
function weatherBlock(r) {
  if (!TEMPO || !TEMPO.locais || !r.wx || !TEMPO.locais[r.wx]) return '<div id="wx"></div>';
  const loc = TEMPO.locais[r.wx];
  const zr = r.el ? r.el.z.reduce((a, b) => a + b, 0) / r.el.z.length : (r.zmin + r.zmax) / 2;
  const dz = loc.alt != null ? zr - loc.alt : 0, adj = -0.0065 * dz;
  const today = new Date(); today.setHours(0, 0, 0, 0);
  const dias = (loc.dias || []).filter((x) => new Date(x.d + 'T00:00:00') >= today).slice(0, 7);
  if (!dias.length) return '<div id="wx"></div>';
  const wd = (s, i) => i === 0 && new Date(s + 'T00:00:00').getTime() === today.getTime() ? 'Hoje' : new Date(s + 'T12:00:00').toLocaleDateString('pt-PT', { weekday: 'long' }).replace(/-feira$/, '');
  const t = (v) => Math.round(v + adj);
  const avisos = ((TEMPO.avisos || {})[loc.aviso] || []).filter((a) => a.nivel && a.nivel !== 'green');
  const first = dias[0];
  return `<div id="wx"><h3 class="sec">Previsão do tempo</h3><div class="wx">
    <div class="wx-top"><svg viewBox="0 0 24 24" width="64" height="64" aria-hidden="true">${WX_ICON[wxGroup(first.tipo)]}</svg>
      <div class="wx-now"><span class="wx-t">${t(first.tmax)}°<small> / ${t(first.tmin)}°</small></span><span class="sub">${WX_TXT[first.tipo] || ''} · chuva ${fmt(first.prob)}% · vento ${VENTO[first.vento] || '—'}${first.uv ? ' · UV ' + fmt(first.uv) : ''}</span></div></div>
    ${avisos.map((a) => `<p class="wx-av ${a.nivel}">Aviso ${AVISO_COR[a.nivel] || a.nivel}: ${esc(a.tipo)}${a.texto ? ' — ' + esc(a.texto) : ''}</p>`).join('')}
    <ul class="wx-days">${dias.slice(1).map((x, i) => `<li><span class="wx-d">${wd(x.d, i + 1)}</span><svg viewBox="0 0 24 24" width="28" height="28" role="img" aria-label="${WX_TXT[x.tipo] || ''}">${WX_ICON[wxGroup(x.tipo)]}</svg><span class="wx-p">${x.prob > 0 ? fmt(x.prob) + '%' : ''}</span><span class="wx-mm">${t(x.tmax)}° <small>${t(x.tmin)}°</small></span></li>`).join('')}</ul>
    <p class="note">IPMA, ${esc(loc.nome)}${Math.abs(dz) >= 50 ? `; temperaturas ajustadas à altitude média do percurso (${fmt(zr)} m, ${dz > 0 ? '+' : ''}${fmt(dz)} m)` : ''}. Atualizado ${TEMPO.atualizado ? new Date(TEMPO.atualizado).toLocaleString('pt-PT', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' }) : '—'}.</p>
  </div></div>`;
}
// Vista 3D (MapLibre GL): relevo Copernicus 30 m + satélite/ortofotos da página + traçado colorido pela sombra
const DEM_URL = '/_blob/61db3f421f32c3a31441a99ea7f0c42d', DEM_B = [-8.1, 40.0, -7.15, 40.7];
let mlP = null, DEM = null, map3 = null;
const R3857 = 20037508.342789244;
const toM = (lat, lon) => [lon * R3857 / 180, Math.log(Math.tan((90 + lat) * Math.PI / 360)) * R3857 / Math.PI];
function loadScript(src) { return new Promise((ok, ko) => { const s = document.createElement('script'); s.src = src; s.onload = ok; s.onerror = ko; document.head.appendChild(s); }); }
async function ensureML() {
  if (!mlP) mlP = (async () => {
    try { await loadScript('lib/maplibre-gl-csp.js'); } catch (e) { await loadScript('https://cdn.jsdelivr.net/npm/maplibre-gl@4.7.1/dist/maplibre-gl-csp.js'); }
    maplibregl.setWorkerUrl(new URL('lib/maplibre-gl-csp-worker.js', location.href).href);
    maplibregl.addProtocol('dem', demTile); maplibregl.addProtocol('img', imgTile);
  })();
  return mlP;
}
async function ensureDEM() {
  if (DEM) return DEM;
  DEM = (async () => {
    const b = await (await fetch(DEM_URL)).blob();
    const bm = await createImageBitmap(b, { colorSpaceConversion: 'none', premultiplyAlpha: 'none' });
    const c = new OffscreenCanvas(bm.width, bm.height), x = c.getContext('2d', { willReadFrequently: true });
    x.drawImage(bm, 0, 0); const d = x.getImageData(0, 0, bm.width, bm.height).data;
    const z = new Float32Array(bm.width * bm.height); for (let i = 0; i < z.length; i++) z[i] = d[i * 4] * 256 + d[i * 4 + 1] - 32768;
    return { z, w: bm.width, h: bm.height };
  })();
  return DEM;
}
const tileXYZ = (url) => url.split('://')[1].split('/').map(Number);
async function demTile(params) {
  const [z, x, y] = tileXYZ(params.url), D = await ensureDEM(), N = 256, n = 2 ** z;
  const c = new OffscreenCanvas(N, N), ctx = c.getContext('2d'), im = ctx.createImageData(N, N), px = im.data;
  const kx = (D.w - 1) / (DEM_B[2] - DEM_B[0]), ky = (D.h - 1) / (DEM_B[3] - DEM_B[1]);
  for (let j = 0; j < N; j++) {
    const my = (y + (j + 0.5) / N) / n, lat = Math.atan(Math.sinh(Math.PI * (1 - 2 * my))) * 180 / Math.PI;
    const fy = Math.min(D.h - 1.001, Math.max(0, (DEM_B[3] - lat) * ky)), r0 = Math.floor(fy), wy = fy - r0;
    for (let i = 0; i < N; i++) {
      const lon = (x + (i + 0.5) / N) / n * 360 - 180;
      const fx = Math.min(D.w - 1.001, Math.max(0, (lon - DEM_B[0]) * kx)), c0 = Math.floor(fx), wx = fx - c0;
      const a = D.z[r0 * D.w + c0], b = D.z[r0 * D.w + c0 + 1], cc = D.z[(r0 + 1) * D.w + c0], dd = D.z[(r0 + 1) * D.w + c0 + 1];
      const h = (a * (1 - wx) + b * wx) * (1 - wy) + (cc * (1 - wx) + dd * wx) * wy, v = h + 32768, o = (j * N + i) * 4;
      px[o] = Math.floor(v / 256); px[o + 1] = Math.floor(v) % 256; px[o + 2] = Math.floor((v - Math.floor(v)) * 256); px[o + 3] = 255;
    }
  }
  ctx.putImageData(im, 0, 0);
  return { data: await (await c.convertToBlob({ type: 'image/png' })).arrayBuffer() };
}
const bmCache = new Map();
function bitmap(src) {
  if (!bmCache.has(src)) bmCache.set(src, (async () => { const b = await (await fetch(src)).blob(); return createImageBitmap(b); })().catch(() => null));
  if (bmCache.size > 160) { const k = bmCache.keys().next().value; bmCache.delete(k); }
  return bmCache.get(src);
}
const detTiles3 = new Map();
function detBundle3(i) {
  if (!detTiles3.has(i)) detTiles3.set(i, fetch(DET[i][0]).then((r) => r.json()).then((j) => j.t.map(([s, w, n, e, d]) => ['data:image/webp;base64,' + d, [[s, w], [n, e]]])).catch(() => []));
  return detTiles3.get(i);
}
async function imgTile(params) {
  const [z, x, y] = tileXYZ(params.url), N = 512, n = 2 ** z, span = 2 * R3857 / n;
  const minx = -R3857 + x * span, maxy = R3857 - y * span, res = span / N;
  const c = new OffscreenCanvas(N, N), ctx = c.getContext('2d'); ctx.fillStyle = '#2a2f28'; ctx.fillRect(0, 0, N, N);
  const layers = [[['/_blob/bbb0be3a812c34296b0abe310453249c', BOUNDS]], z >= 10 ? CHUNKS : [], z >= 12 ? ORTHO : []];
  if (z >= 15) { const tb = [[0, 0], [0, 0]]; const lonA = x / n * 360 - 180, lonB = (x + 1) / n * 360 - 180; const latA = Math.atan(Math.sinh(Math.PI * (1 - 2 * (y + 1) / n))) * 180 / Math.PI, latB = Math.atan(Math.sinh(Math.PI * (1 - 2 * y / n))) * 180 / Math.PI; const LB = L.latLngBounds([latA, lonA], [latB, lonB]); const ids = DET.map((d, i) => d[1].some((b) => LB.intersects(L.latLngBounds(b))) ? i : -1).filter((i) => i >= 0); layers.push((await Promise.all(ids.map(detBundle3))).flat()); }
  for (const items of layers) {
    for (const [src, b] of items) {
      const [x0, y0] = toM(b[0][0], b[0][1]), [x1, y1] = toM(b[1][0], b[1][1]);
      const dx = (x0 - minx) / res, dy = (maxy - y1) / res, dw = (x1 - x0) / res, dh = (y1 - y0) / res;
      if (dx > N || dy > N || dx + dw < 0 || dy + dh < 0) continue;
      const bm = await bitmap(src); if (bm) ctx.drawImage(bm, dx, dy, dw, dh);
    }
  }
  return { data: await (await c.convertToBlob({ type: 'image/jpeg', quality: 0.9 })).arrayBuffer() };
}
function route3dGeo(r) {
  const feats = [];
  const A = r.alt || {}; const showA = altShow();
  if (showA.ex) (A.ex || []).forEach((x) => feats.push({ type: 'Feature', properties: { c: '#4DA3FF', w: 3 }, geometry: { type: 'LineString', coordinates: decodePoly(x.p).map(([la, lo]) => [lo, la]) } }));
  if (showA.va) (A.va || []).forEach((x) => feats.push({ type: 'Feature', properties: { c: '#C38BFF', w: 3 }, geometry: { type: 'LineString', coordinates: decodePoly(x.p).map(([la, lo]) => [lo, la]) } }));
  if (r.lidar && r.segs) r.segs.forEach((s) => feats.push({ type: 'Feature', properties: { c: shadeCol(s[0]) }, geometry: { type: 'LineString', coordinates: segPts(s).map(([la, lo]) => [lo, la]) } }));
  else geo(r).forEach((part) => part.length > 1 && feats.push({ type: 'Feature', properties: { c: '#FFFFFF' }, geometry: { type: 'LineString', coordinates: part.map(([la, lo]) => [lo, la]) } }));
  return { type: 'FeatureCollection', features: feats };
}
async function open3D(r) {
  const box = document.getElementById('v3d'), msg = document.getElementById('v3d-msg');
  box.hidden = false; msg.textContent = 'A carregar o relevo…';
  try { await ensureML(); } catch (e) { msg.textContent = 'Não foi possível carregar a vista 3D neste dispositivo.'; return; }
  const bb = L.latLngBounds(r.segs ? r.segs.flatMap((s) => segPts(s)) : geo(r).flat());
  if (!map3) {
    map3 = new maplibregl.Map({ container: 'map3', attributionControl: false, maxPitch: 80, pitch: 62, bearing: -20, center: [bb.getCenter().lng, bb.getCenter().lat], zoom: 13,
      style: { version: 8, sources: { img: { type: 'raster', tiles: ['img://{z}/{x}/{y}'], tileSize: 512, maxzoom: 18 }, dem: { type: 'raster-dem', tiles: ['dem://{z}/{x}/{y}'], tileSize: 256, encoding: 'terrarium', maxzoom: 12 }, rota: { type: 'geojson', data: route3dGeo(r) } },
        layers: [{ id: 'bg', type: 'background', paint: { 'background-color': '#2a2f28' } }, { id: 'img', type: 'raster', source: 'img' },
          { id: 'rota-c', type: 'line', source: 'rota', paint: { 'line-color': '#0B120D', 'line-width': 9, 'line-opacity': 0.6 }, layout: { 'line-join': 'round', 'line-cap': 'round' } },
          { id: 'rota', type: 'line', source: 'rota', paint: { 'line-color': ['get', 'c'], 'line-width': ['coalesce', ['get', 'w'], 5] }, layout: { 'line-join': 'round', 'line-cap': 'round' } }],
        terrain: { source: 'dem', exaggeration: 1.3 } } });
    map3.on('error', (e) => { if (e && e.error) msg.textContent = 'Erro 3D: ' + (e.error.message || e.error); });
    map3.on('idle', () => { msg.textContent = ''; });
  } else { map3.getSource('rota').setData(route3dGeo(r)); map3.resize(); }
  map3.fitBounds([[bb.getWest(), bb.getSouth()], [bb.getEast(), bb.getNorth()]], { padding: 40, pitch: 62, bearing: -20, duration: 0 });
  labels3D(r, bb);
}
let marks3 = [];
function labels3D(r, bb) {
  marks3.forEach((m) => m.remove()); marks3 = [];
  const area = bb.pad(0.35), onRoute = new Set(poisAlong(r).map((o) => o.i));
  const pri = { town: 0, village: 1, peak: 2, waterfall: 2, view: 2, bath: 2, hamlet: 3, lake: 3, water: 4, shelter: 4, picnic: 4, heritage: 5, chapel: 6 };
  const cand = POI.map((p, i) => [p, i]).filter(([p, i]) => area.contains([p[0], p[1]]) && (onRoute.has(i) || (p[2] in pri && (p[3] || p[2] === 'peak'))));
  cand.sort((a, b) => (onRoute.has(b[1]) - onRoute.has(a[1])) || ((pri[a[0][2]] ?? 9) - (pri[b[0][2]] ?? 9)));
  cand.slice(0, 160).forEach(([p, i]) => {
    const el = document.createElement('div');
    if (LABEL[p[2]]) { el.className = 'plabel ' + LABEL[p[2]] + ' m3'; el.innerHTML = `<span>${esc(p[3])}</span>`; }
    else { el.className = 'picon m3' + (onRoute.has(i) ? ' on' : ''); el.innerHTML = poiIcon(p[2], onRoute.has(i) ? 26 : 20) + (p[3] ? `<span class="pname">${esc(p[3])}${p[2] === 'peak' && p[4] ? ' ' + p[4] + ' m' : ''}</span>` : ''); el.title = p[3] || PCAT[p[2]][0]; }
    marks3.push(new maplibregl.Marker({ element: el, anchor: LABEL[p[2]] ? 'center' : 'center' }).setLngLat([p[1], p[0]]).addTo(map3));
  });
  (r.alt && altShow().ex ? r.alt.ex : []).forEach((x) => { const dp = decodePoly(x.p), e = dp[dp.length - 1], el = document.createElement('div'); el.className = 'alt-lbl m3'; el.innerHTML = `<span>⤳ ${esc(x.n || 'aldeia')}</span>`; marks3.push(new maplibregl.Marker({ element: el, anchor: 'left' }).setLngLat([e[1], e[0]]).addTo(map3)); });
}
document.getElementById('x3').onclick = () => { document.getElementById('v3d').hidden = true; };
document.getElementById('fab-3d').onclick = () => selected && open3D(selected);
document.getElementById('fab-sheet').onclick = () => sheetPeek(false);
map.on('movestart', () => { if (selected && !$('sheet').classList.contains('peek')) sheetPeek(true); });
document.getElementById('v3d-tilt').onclick = () => map3 && map3.easeTo({ pitch: map3.getPitch() > 30 ? 0 : 62 });
document.getElementById('v3d-rot').onclick = () => map3 && map3.easeTo({ bearing: map3.getBearing() - 45 });
// Tocar num caminho: a que percurso(s) pertence
function nearDist(ll, pts, k) { let best = 1e18; for (let i = 0; i < pts.length; i++) { const dy = (pts[i][0] - ll.lat) * 111320, dx = (pts[i][1] - ll.lng) * 111320 * k, d = dx * dx + dy * dy; if (d < best) best = d; } return Math.sqrt(best); }
function segDist(ll, a, b, k) { const ax = (a[1] - ll.lng) * 111320 * k, ay = (a[0] - ll.lat) * 111320, bx = (b[1] - ll.lng) * 111320 * k, by = (b[0] - ll.lat) * 111320; const dx = bx - ax, dy = by - ay, L2 = dx * dx + dy * dy; let t = L2 ? -(ax * dx + ay * dy) / L2 : 0; t = Math.max(0, Math.min(1, t)); const x = ax + t * dx, y = ay + t * dy; return Math.sqrt(x * x + y * y); }
function lineDist(ll, pts, k) { let best = 1e18; for (let i = 1; i < pts.length; i++) { const d = segDist(ll, pts[i - 1], pts[i], k); if (d < best) best = d; } return best; }
function pathInfo(ll) {
  const k = Math.cos(ll.lat * Math.PI / 180), mpp = 40075016 * k / (256 * 2 ** map.getZoom()), tol = Math.max(12, 16 * mpp);
  const ah = focusGroup ? altHit(ll, tol, k) : null;
  if (ah) { const x = ah[2]; const body0 = ah[1] === 'ex' ? `<strong>Saída para ${esc(x.n || 'aldeia')}</strong><br>Sai do percurso ao km ${fmt(x.km, 1)} · ${kmTxt(x.d)} até à aldeia` : `<strong>${x.alt < x.rota ? 'Atalho' : 'Variante'} do percurso</strong><br>Do km ${fmt(x.k0, 1)} ao ${fmt(x.k1, 1)}: ${kmTxt(x.alt)} em vez de ${kmTxt(x.rota)}`; L.popup({ maxWidth: 260 }).setLatLng(ll).setContent(body0).openOn(map); return; }
  const hits = [];
  D.routes.forEach((r) => {
    if (focusGroup && selected && r.id !== selected.id) return;
    let best = 1e18; for (const part of geo(r)) { if (part.length < 2) continue; const d = lineDist(ll, part, k); if (d < best) best = d; }
    if (best <= tol) hits.push([best, r]);
  });
  hits.sort((a, b) => a[0] - b[0]);
  if (hits.length === 1) return select(hits[0][1]);
  let body;
  if (hits.length > 1) {
    body = `<strong>Este caminho faz parte de ${hits.length} percursos</strong><div class="pi-list">${hits.map(([, r]) => `<button class="pi-b" data-id="${r.id}">${prBadge(r)} ${esc(r.ref || '')} · ${esc(r.nome)}</button>`).join('')}</div>`;
  } else {
    let kind = null;
    for (const [key, nome] of OSM_KINDS.map((k) => [k, OSM_NOME[k]])) { (OSMD[key] || []).some((p) => { if (lineDist(ll, p, k) <= tol) { kind = nome; return true; } return false; }); if (kind) break; }
    if (!kind && focusGroup) focusGroup.eachLayer((l) => { if (kind || !l.getLatLngs || l instanceof L.Circle) return; const p = l.getLatLngs().map((q) => [q.lat, q.lng]); if (p.length > 1 && lineDist(ll, p, k) <= tol) kind = l.options.dashArray ? 'Estradão' : 'Trilho'; });
    if (!kind) return;
    body = `<strong>${kind} (OpenStreetMap)</strong><br>Não faz parte de nenhum dos ${D.routes.length} percursos.`;
  }
  const pop = L.popup({ maxWidth: 280 }).setLatLng(ll).setContent(body).openOn(map);
  setTimeout(() => document.querySelectorAll('.pi-b').forEach((b) => b.onclick = () => { map.closePopup(pop); select(D.routes.find((r) => r.id === +b.dataset.id)); }), 0);
}
map.on('click', (e) => { if (document.body.classList.contains('building')) { if (build.livre) addLivre(e.latlng); else if (RD) addTo(snapNode(e.latlng)); return; } pathInfo(e.latlng); });
// Caminhos alternativos: saídas até aldeias, variantes/atalhos e todos os caminhos num raio de 8 km
const altGroup = L.layerGroup().addTo(map);
const ALT_KEY = 'sne-alt';
function altShow() { try { return Object.assign({ ex: true, va: true, r8: true }, JSON.parse(localStorage.getItem(ALT_KEY) || '{}')); } catch (e) { return { ex: true, va: true, r8: true }; } }
function altSet(k, v) { const s = altShow(); s[k] = v; try { localStorage.setItem(ALT_KEY, JSON.stringify(s)); } catch (e) {} }
function drawAlt(r) {
  altGroup.clearLayers(); const A = r.alt; const s = altShow();
  if (focusGroup) focusGroup.eachLayer((l) => { if (l.setStyle && !(l instanceof L.Circle)) l.setStyle({ opacity: s.r8 ? (l.options.dashArray ? .8 : .9) : 0 }); else if (l instanceof L.Circle) l.setStyle({ opacity: s.r8 ? .7 : 0 }); });
  if (!A) return;
  if (s.va) A.va.forEach((v) => {
    const vp = decodePoly(v.p);
    L.polyline(vp, { color: '#1B0F2A', weight: 7, opacity: .5, interactive: false }).addTo(altGroup);
    L.polyline(vp, { color: '#C38BFF', weight: 4, opacity: 1, dashArray: '8 5', interactive: false, alt: v, altKind: 'va' }).addTo(altGroup);
  });
  if (s.ex) A.ex.forEach((x) => {
    const xp = decodePoly(x.p);
    L.polyline(xp, { color: '#0B1A2A', weight: 7, opacity: .5, interactive: false }).addTo(altGroup);
    L.polyline(xp, { color: '#4DA3FF', weight: 4, opacity: 1, interactive: false, alt: x, altKind: 'ex' }).addTo(altGroup);
    const end = xp[xp.length - 1];
    L.marker(end, { pane: 'poiP', interactive: false, icon: L.divIcon({ className: 'alt-lbl', html: `<span>⤳ ${esc(x.n || 'aldeia')}</span>`, iconSize: null }) }).addTo(altGroup);
  });
}
function altHit(ll, tol, k) {
  let best = null;
  altGroup.eachLayer((l) => { if (!l.options.alt) return; const p = l.getLatLngs().map((q) => [q.lat, q.lng]); const d = lineDist(ll, p, k); if (d <= tol && (!best || d < best[0])) best = [d, l.options.altKind, l.options.alt]; });
  return best;
}
const kmTxt = (m) => m < 1000 ? `${fmt(m)} m` : `${fmt(m / 1000, 1)} km`;
function altBlock(r) {
  const A = r.alt; if (!A) return '';
  const s = altShow();
  const chip = (k, label, color) => `<button class="chipb alt-t" data-k="${k}" aria-pressed="${s[k]}"><i style="background:${color}"></i>${label}</button>`;
  const maxV = Math.max(...A.sv.filter((x) => x >= 0));
  const ex = A.ex.map((x) => `<li><button class="wpb alt-go" data-t="ex" data-i="${A.ex.indexOf(x)}"><span class="alt-sw" style="background:#4DA3FF"></span><span><span class="nm">${esc(x.n || 'Aldeia')}</span><br><span class="sub">sai ao km ${fmt(x.km, 1)} · ${kmTxt(x.d)} até lá</span></span><span class="km">km ${fmt(x.km, 1)}</span></button></li>`).join('');
  const va = A.va.map((v, i) => { const dlt = v.alt - v.rota; return `<li><button class="wpb alt-go" data-t="va" data-i="${i}"><span class="alt-sw" style="background:#C38BFF"></span><span><span class="nm">${dlt < 0 ? 'Atalho' : 'Variante'} km ${fmt(v.k0, 1)}–${fmt(v.k1, 1)}</span><br><span class="sub">${kmTxt(v.alt)} em vez de ${kmTxt(v.rota)} · ${dlt < 0 ? 'poupa ' + kmTxt(-dlt) : 'mais ' + kmTxt(dlt)}</span></span></button></li>`; }).join('');
  return `<h3 class="sec">Caminhos alternativos</h3>
    <div class="chips alt-chips">${chip('ex', 'Saídas', '#4DA3FF')}${chip('va', 'Variantes', '#C38BFF')}${chip('r8', 'Todos a 8 km', '#F6F2DA')}</div>
    <p class="note">Ponto do percurso mais afastado de uma aldeia: ${kmTxt(maxV)} a pé pela rede de caminhos. Passa o dedo no perfil para ver a saída mais próxima em cada ponto.</p>
    ${ex ? `<details class="alt-d" open><summary>Saídas de emergência · ${A.ex.length}</summary><ol class="wp">${ex}</ol></details>` : ''}
    ${va ? `<details class="alt-d"><summary>Variantes e atalhos · ${A.va.length}</summary><ol class="wp">${va}</ol></details>` : ''}
    <p class="note">Calculado sobre os caminhos do OpenStreetMap; confirma no terreno, nem todos estão marcados ou transitáveis.</p>`;
}
function bindAlt(r) {
  document.querySelectorAll('.alt-t').forEach((b) => b.onclick = () => { const v = b.getAttribute('aria-pressed') !== 'true'; b.setAttribute('aria-pressed', v); altSet(b.dataset.k, v); drawAlt(r); if (map3 && !document.getElementById('v3d').hidden) map3.getSource('rota').setData(route3dGeo(r)); });
  document.querySelectorAll('.alt-go').forEach((b) => b.onclick = () => { const x = (b.dataset.t === 'ex' ? r.alt.ex : r.alt.va)[+b.dataset.i]; showMap(); map.fitBounds(L.latLngBounds(decodePoly(x.p)), { padding: [60, 60], maxZoom: 16 }); });
}
// ===== Criador de trilhos: desenhar pela rede de caminhos, com sombra, altitude e terreno =====
const REDE_URL = '/_blob/e60c51a172252278e9f49eb929ab53c2';
const COVER = { 100: ['Zona urbana', '#C2504B'], 211: ['Cultivo', '#D8C24A'], 212: ['Cultivo', '#D8C24A'], 213: ['Área agrícola', '#D8C24A'], 311: ['Sobreiro / azinheira', '#7E5BA6'], 312: ['Eucalipto', '#4FBF52'], 313: ['Folhosas', '#2E9E3A'], 321: ['Pinheiro bravo', '#1F7A2E'], 322: ['Pinheiro manso', '#1B5E2A'], 323: ['Resinosas', '#2C7A86'], 410: ['Matos', '#9A8442'], 420: ['Erva', '#C8BE8C'], 500: ['Rocha / sem vegetação', '#8A8A8A'], 610: ['Zona húmida', '#3E86C6'], 620: ['Água', '#3A5BD9'] };
const KINDNAME = ['Trilho', 'Estradão', 'Escadas', 'Percurso'];
let RD = null, rdLoading = null, rdGrid = null, rdCSR = null;
const build = { nodes: [], edges: [], layer: null, pref: 'curto', livre: false, fimLL: null, fimNo: -1 };
function loadRede() {
  if (RD) return Promise.resolve(RD);
  if (!rdLoading) rdLoading = fetch(REDE_URL).then((r) => r.json()).then((j) => {
    RD = j;
    rdGrid = new Map();
    j.v.forEach((p, i) => { const k = Math.round(p[0] * 200) + ':' + Math.round(p[1] * 200); let a = rdGrid.get(k); if (!a) rdGrid.set(k, a = []); a.push(i); });
    const head = new Int32Array(j.v.length + 1);
    j.e.forEach((e) => { head[e[0]]++; head[e[1]]++; });
    let acc = 0; const start = new Int32Array(j.v.length + 1);
    for (let i = 0; i < j.v.length; i++) { start[i] = acc; acc += head[i]; } start[j.v.length] = acc;
    const cur = start.slice(), adjE = new Int32Array(acc), adjN = new Int32Array(acc);
    j.e.forEach((e, i) => { adjE[cur[e[0]]] = i; adjN[cur[e[0]]++] = e[1]; adjE[cur[e[1]]] = i; adjN[cur[e[1]]++] = e[0]; });
    rdCSR = { start, adjE, adjN };
    return RD;
  }).catch((e) => { rdLoading = null; throw e; });
  return rdLoading;
}
function snapNode(ll, maxM = 120) {
  if (!RD) return -1;
  const k = Math.cos(ll.lat * Math.PI / 180), gi = Math.round(ll.lat * 200), gj = Math.round(ll.lng * 200);
  let best = -1, bd = maxM * maxM;
  for (let di = -1; di <= 1; di++) for (let dj = -1; dj <= 1; dj++) {
    const arr = rdGrid.get((gi + di) + ':' + (gj + dj)); if (!arr) continue;
    for (const i of arr) { const p = RD.v[i], dy = (p[0] - ll.lat) * 111320, dx = (p[1] - ll.lng) * 111320 * k, d = dx * dx + dy * dy; if (d < bd) { bd = d; best = i; } }
  }
  return best;
}
function edgeCost(e) {
  if (build.pref === 'sombra') return e[2] * (e[6] >= 0 ? 1 - 0.6 * e[6] / 100 : 0.85) * (e[7] === 2 ? 1.6 : 1);
  if (build.pref === 'suave') return e[2] * (1 + (e[3] + e[4]) / Math.max(e[2], 1) * 6);
  return e[2] * (e[7] === 2 ? 1.3 : 1);
}
function shortest(from, to) {
  const N = RD.v.length, dist = new Float64Array(N).fill(Infinity), prevN = new Int32Array(N).fill(-1), prevE = new Int32Array(N).fill(-1);
  const heap = [[0, from]]; dist[from] = 0;
  const push = (it) => { heap.push(it); let i = heap.length - 1; while (i > 0) { const p = (i - 1) >> 1; if (heap[p][0] <= heap[i][0]) break; [heap[p], heap[i]] = [heap[i], heap[p]]; i = p; } };
  const pop = () => { const top = heap[0], last = heap.pop(); if (heap.length) { heap[0] = last; let i = 0; for (;;) { const l = 2 * i + 1, r = l + 1; let m = i; if (l < heap.length && heap[l][0] < heap[m][0]) m = l; if (r < heap.length && heap[r][0] < heap[m][0]) m = r; if (m === i) break; [heap[m], heap[i]] = [heap[i], heap[m]]; i = m; } } return top; };
  while (heap.length) {
    const [d, u] = pop(); if (d > dist[u]) continue; if (u === to) break;
    for (let p = rdCSR.start[u]; p < rdCSR.start[u + 1]; p++) {
      const ei = rdCSR.adjE[p], v = rdCSR.adjN[p], nd = d + edgeCost(RD.e[ei]);
      if (nd < dist[v]) { dist[v] = nd; prevN[v] = u; prevE[v] = ei; push([nd, v]); }
    }
  }
  if (!isFinite(dist[to])) return null;
  const nodes = [to], eids = [];
  let cur = to; while (cur !== from) { eids.push(prevE[cur]); cur = prevN[cur]; nodes.push(cur); }
  return { nodes: nodes.reverse(), eids: eids.reverse() };
}
function edgePts(ei, fromNode) {
  const e = RD.e[ei], pts = decodePoly(e[8]);
  return e[0] === fromNode ? pts : pts.slice().reverse();
}
// um troco pode vir da rede mapeada ou ser desenhado a mao
const trocoPts = (x) => x.livre ? x.pts : edgePts(x.ei, x.from);
const trocoL = (x) => x.livre ? x.L : RD.e[x.ei][2];
function buildPts() {
  const out = [];
  build.edges.forEach((x, i) => { const p = trocoPts(x); out.push(...(i ? p.slice(1) : p)); });
  return out;
}
function buildStats() {
  let L = 0, up = 0, dn = 0, shL = 0, shSum = 0, livreL = 0; const cov = {}, kinds = {};
  build.edges.forEach((x) => {
    if (x.livre) {
      L += x.L; up += x.up || 0; dn += x.dn || 0; livreL += x.L;
      if (x.sh >= 0) { shL += x.L; shSum += x.sh * x.L; }
      if (x.cov) cov[x.cov] = (cov[x.cov] || 0) + x.L;
      return;
    }
    const e = RD.e[x.ei]; L += e[2]; up += e[3]; dn += e[4];
    if (e[6] >= 0) { shL += e[2]; shSum += e[6] * e[2]; }
    cov[e[5]] = (cov[e[5]] || 0) + e[2]; kinds[e[7]] = (kinds[e[7]] || 0) + e[2];
  });
  return { L, up, dn, shade: shL ? shSum / shL : null, shCov: L ? shL / L : 0, cov, kinds, livreL, livrePct: L ? livreL / L : 0 };
}
// distancia entre dois pontos, em metros
function distM(a, b) {
  const k = Math.cos((a[0] + b[0]) / 2 * Math.PI / 180);
  const dy = (b[0] - a[0]) * 111320, dx = (b[1] - a[1]) * 111320 * k;
  return Math.hypot(dx, dy);
}
// altitudes ao longo de uma linha, tiradas do modelo de elevacao
async function amostraZ(pts, passo) {
  const D = await ensureDEM();
  const kx = (D.w - 1) / (DEM_B[2] - DEM_B[0]), ky = (D.h - 1) / (DEM_B[3] - DEM_B[1]);
  const z = (p) => {
    const fx = Math.min(D.w - 1.001, Math.max(0, (p[1] - DEM_B[0]) * kx)), fy = Math.min(D.h - 1.001, Math.max(0, (DEM_B[3] - p[0]) * ky));
    const c0 = Math.floor(fx), r0 = Math.floor(fy), wx = fx - c0, wy = fy - r0;
    const a = D.z[r0 * D.w + c0], b = D.z[r0 * D.w + c0 + 1], c = D.z[(r0 + 1) * D.w + c0], d = D.z[(r0 + 1) * D.w + c0 + 1];
    return (a * (1 - wx) + b * wx) * (1 - wy) + (c * (1 - wx) + d * wx) * wy;
  };
  const out = [];
  for (let i = 0; i < pts.length - 1; i++) {
    const d = distM(pts[i], pts[i + 1]), n = Math.max(1, Math.round(d / (passo || 30)));
    for (let j = 0; j < n; j++) {
      const t = j / n;
      out.push(z([pts[i][0] + (pts[i + 1][0] - pts[i][0]) * t, pts[i][1] + (pts[i + 1][1] - pts[i][1]) * t]));
    }
  }
  out.push(z(pts[pts.length - 1]));
  return out;
}
// sombra e terreno de um troco desenhado: vem do caminho mapeado mais proximo
function contextoLivre(meio) {
  if (!RD) return { sh: -1, cov: 0 };
  const n = snapNode(L.latLng(meio[0], meio[1]), 250);
  if (n < 0) return { sh: -1, cov: 0 };
  for (let p = rdCSR.start[n]; p < rdCSR.start[n + 1]; p++) {
    const e = RD.e[rdCSR.adjE[p]];
    if (e[6] >= 0) return { sh: e[6], cov: e[5] };
  }
  const e0 = RD.e[rdCSR.adjE[rdCSR.start[n]]];
  return { sh: -1, cov: e0 ? e0[5] : 0 };
}
function drawBuild() {
  if (!build.layer) build.layer = L.layerGroup().addTo(map);
  build.layer.clearLayers();
  build.edges.forEach((x) => {
    const pts = trocoPts(x), sh = x.livre ? x.sh : RD.e[x.ei][6];
    L.polyline(pts, { color: '#0B120D', weight: 9, opacity: .55, interactive: false }).addTo(build.layer);
    L.polyline(pts, Object.assign({ color: sh >= 0 ? shadeCol(sh) : '#9FB6C9', weight: 5, opacity: 1, interactive: false },
      x.livre ? { dashArray: '10 6' } : {})).addTo(build.layer);
  });
  const pontas = [];
  build.edges.forEach((x, i) => { const p = trocoPts(x); if (!i) pontas.push(p[0]); pontas.push(p[p.length - 1]); });
  if (!pontas.length && build.fimLL) pontas.push(build.fimLL);
  pontas.forEach((p, i) => {
    L.circleMarker(p, { radius: i === 0 ? 7 : 5, color: '#fff', weight: 2, fillColor: i === 0 ? '#2E7D4F' : '#1C2118', fillOpacity: 1, interactive: false }).addTo(build.layer);
  });
  renderBuildPanel();
}
function coverList(cov, L) {
  return Object.entries(cov).sort((a, b) => b[1] - a[1]).slice(0, 4).map(([k, v]) => { const c = COVER[k] || ['Outro', '#999']; return `<span class="cv"><i style="background:${c[1]}"></i>${c[0]} ${Math.round(100 * v / L)}%</span>`; }).join('');
}
function renderBuildPanel() {
  const el = document.getElementById('bpanel'); if (!el) return;
  if (!build.edges.length) {
    el.innerHTML = `<p class="hint">Toca num caminho do mapa para pôr o início. Depois toca noutro ponto e o trilho segue pelos caminhos existentes.</p>${buildChips()}${trailList()}`;
    bindBuildChips(); bindTrailList(); return;
  }
  const s = buildStats(), km = s.L / 1000, esf = km + s.up / 100, h = esf / 4, hh = Math.floor(h), mm = Math.round((h - hh) * 60 / 5) * 5;
  el.innerHTML = `<div class="wk">
      <div><span class="wl">Distância</span><span class="wv">${fmt(km, 2)} km</span></div>
      <div><span class="wl">Desnível +</span><span class="wv">${fmt(s.up)} m</span></div>
      <div><span class="wl">Sombra</span><span class="wv" style="color:${s.shade == null ? 'var(--muted)' : shadeCol(s.shade)}">${s.shade == null ? '—' : fmt(s.shade) + '%'}</span></div>
    </div>
    <div class="bstats"><span>↘ ${fmt(s.dn)} m</span><span>${hh} h ${String(mm % 60).padStart(2, '0')}</span><span>${s.shade == null ? 'sem LiDAR' : `${s.livreL > 0 ? 'sombra estimada nos troços à mão' : 'LiDAR em ' + fmt(100 * s.shCov) + '% do traçado'}`}</span></div>
    <div class="cvs">${coverList(s.cov, s.L)}</div>
    ${buildProfile()}
    ${buildChips()}
    <div class="gpxrow"><button class="btn" id="b-gpx">Descarregar GPX</button><button class="btn alt" id="b-save">Guardar</button><button class="btn alt" id="b-undo">Anular último</button><button class="btn alt" id="b-clear">Limpar</button><button class="btn alt" id="b-loop">Fechar volta</button></div>
    <span class="note" id="b-msg" aria-live="polite"></span>${trailList()}`;
  bindBuildChips();
  document.getElementById('b-undo').onclick = () => {
    if (!build.edges.length) { build.fimLL = null; build.fimNo = -1; build.nodes = []; drawBuild(); return; }
    const fora = build.edges.pop();
    if (!fora.livre && build.nodes.length > 1) build.nodes.pop();
    const ult = build.edges[build.edges.length - 1];
    if (!ult) { build.fimLL = build.nodes.length ? RD.v[build.nodes[0]] : null; build.fimNo = build.nodes.length ? build.nodes[0] : -1; }
    else { const p = trocoPts(ult); build.fimLL = p[p.length - 1]; build.fimNo = ult.livre ? -1 : build.nodes[build.nodes.length - 1]; }
    drawBuild(); updateZprof();
  };
  document.getElementById('b-clear').onclick = () => { build.edges = []; build.nodes = []; build.fimLL = null; build.fimNo = -1; build.zprof = null; drawBuild(); };
  document.getElementById('b-loop').onclick = () => {
    const p = buildPts();
    if (!p.length) return;
    if (build.nodes.length && build.fimNo >= 0) addTo(build.nodes[0]);
    else addLivre(L.latLng(p[0][0], p[0][1]));
  };
  document.getElementById('b-gpx').onclick = () => saveBuildGpx();
  document.getElementById('b-save').onclick = saveTrail;
  bindTrailList();
}
function buildChips() {
  const opt = [['curto', 'Mais curto'], ['sombra', 'Mais sombra'], ['suave', 'Menos subida']];
  return `<div class="fgrp"><span class="flab">Modo</span><div class="chips">
      <button class="chipb b-modo" data-v="0" aria-pressed="${!build.livre}">Seguir caminhos</button>
      <button class="chipb b-modo" data-v="1" aria-pressed="${build.livre}">Desenho livre</button>
    </div></div>
    <div class="fgrp"${build.livre ? ' hidden' : ''}><span class="flab">Preferir</span><div class="chips">${opt.map(([k, t]) => `<button class="chipb b-pref" data-k="${k}" aria-pressed="${build.pref === k}">${t}</button>`).join('')}</div></div>
    ${build.livre ? '<p class="note">Desenho livre: cada toque traça uma recta desde o ponto anterior. Serve para caminhos que ninguém mapeou. A altitude é medida no modelo de elevação; a sombra e o terreno são estimados pelo caminho mapeado mais próximo, e vão assinalados a tracejado.</p>' : ''}`;
}
function bindTrailList() {
  document.querySelectorAll('.tri-o').forEach((b) => b.onclick = (ev) => { if (ev.target.classList.contains('tri-x')) { delTrail(+ev.target.dataset.i); return; } openTrail(+b.dataset.i); });
}
function bindBuildChips() {
  document.querySelectorAll('.b-pref').forEach((b) => b.onclick = () => { build.pref = b.dataset.k; renderBuildPanel(); });
  document.querySelectorAll('.b-modo').forEach((b) => b.onclick = () => { build.livre = b.dataset.v === '1'; renderBuildPanel(); });
}
function buildProfile() {
  const e = build.edges; if (e.length < 1) return '';
  const W = 360, H = 90, pl = 30, pr = 6, pt = 8, pb = 14;
  let acc = 0; const pts = [[0, null]];
  const segs = e.map((x) => { const a = acc; acc += trocoL(x); return { a, b: acc, sh: x.livre ? x.sh : RD.e[x.ei][6], livre: !!x.livre }; });
  const zs = build.zprof;
  if (!zs || !zs.length) return `<div class="prof"><div class="prof-h"><strong>Perfil</strong><span>a calcular…</span></div></div>`;
  let lo = Math.min(...zs), hi = Math.max(...zs); const sp = Math.max(hi - lo, 40); lo -= sp * .08; hi = lo + sp * 1.16;
  const X = (i) => pl + (W - pl - pr) * i / (zs.length - 1), Y = (v) => pt + (H - pt - pb) * (1 - (v - lo) / (hi - lo));
  const line = zs.map((v, i) => `${i ? 'L' : 'M'}${X(i).toFixed(1)},${Y(v).toFixed(1)}`).join('');
  const bars = segs.map((s) => `<rect x="${(pl + (W - pl - pr) * s.a / acc).toFixed(1)}" y="${H - pb + 2}" width="${Math.max(1, (W - pl - pr) * (s.b - s.a) / acc).toFixed(1)}" height="4" fill="${s.sh >= 0 ? shadeCol(s.sh) : '#9FB6C9'}" opacity="${s.livre ? 0.55 : 1}"/>`).join('');
  return `<div class="prof"><div class="prof-h"><strong>Perfil</strong><span>${fmt(Math.min(...zs))}–${fmt(Math.max(...zs))} m</span></div>
    <svg viewBox="0 0 ${W} ${H}" role="img" aria-label="Perfil do trilho"><path d="${line}L${X(zs.length - 1)},${H - pb}L${pl},${H - pb}Z" fill="color-mix(in srgb,var(--accent) 20%,transparent)"/><path d="${line}" class="pl"/>${bars}
      <text x="${pl - 4}" y="${(Y(Math.max(...zs)) + 3).toFixed(1)}" text-anchor="end" class="pt">${fmt(Math.max(...zs))}</text>
      <text x="${pl - 4}" y="${(Y(Math.min(...zs)) + 3).toFixed(1)}" text-anchor="end" class="pt">${fmt(Math.min(...zs))}</text></svg></div>`;
}
async function updateZprof() {
  const pts = buildPts(); if (pts.length < 2) { build.zprof = null; return; }
  try {
    const D = await ensureDEM(); const n = Math.min(200, Math.max(20, pts.length));
    const kx = (D.w - 1) / (DEM_B[2] - DEM_B[0]), ky = (D.h - 1) / (DEM_B[3] - DEM_B[1]);
    const zs = [];
    for (let i = 0; i < n; i++) {
      const p = pts[Math.round(i * (pts.length - 1) / (n - 1))];
      const fx = Math.min(D.w - 1.001, Math.max(0, (p[1] - DEM_B[0]) * kx)), fy = Math.min(D.h - 1.001, Math.max(0, (DEM_B[3] - p[0]) * ky));
      const c0 = Math.floor(fx), r0 = Math.floor(fy), wx = fx - c0, wy = fy - r0;
      const a = D.z[r0 * D.w + c0], b = D.z[r0 * D.w + c0 + 1], c = D.z[(r0 + 1) * D.w + c0], d = D.z[(r0 + 1) * D.w + c0 + 1];
      zs.push(Math.round((a * (1 - wx) + b * wx) * (1 - wy) + (c * (1 - wx) + d * wx) * wy));
    }
    build.zprof = zs;
  } catch (e) { build.zprof = null; }
  renderBuildPanel();
}
function addTo(node) {
  if (node < 0) return;
  const msg = document.getElementById('b-msg');
  if (!build.fimLL) { build.nodes = [node]; build.fimNo = node; build.fimLL = RD.v[node]; drawBuild(); return; }
  if (build.fimNo < 0) { addLivre(L.latLng(RD.v[node][0], RD.v[node][1]), node); return; }  // vinha de desenho livre
  const from = build.fimNo;
  if (from === node) return;
  const r = shortest(from, node);
  if (!r) { if (msg) msg.textContent = 'Não há caminho conhecido até aí. Podes passar a Desenho livre e traçar à mão.'; return; }
  if (msg) msg.textContent = '';
  r.eids.forEach((ei, i) => build.edges.push({ ei, from: r.nodes[i] }));
  build.nodes.push(node); build.fimNo = node; build.fimLL = RD.v[node];
  drawBuild(); updateZprof();
}
// desenho livre: uma linha recta do fim actual ate onde tocaste
async function addLivre(ll, noDestino) {
  const p = [ll.lat, ll.lng];
  if (!build.fimLL) { build.fimLL = p; build.fimNo = noDestino == null ? -1 : noDestino; if (noDestino != null) build.nodes = [noDestino]; drawBuild(); return; }
  const a = build.fimLL, b = p;
  const d = distM(a, b);
  if (d < 5) return;
  const ctx = contextoLivre([(a[0] + b[0]) / 2, (a[1] + b[1]) / 2]);
  const troco = { livre: true, pts: [a, b], L: d, up: 0, dn: 0, sh: ctx.sh, cov: ctx.cov };
  build.edges.push(troco);
  build.fimLL = b; build.fimNo = noDestino == null ? -1 : noDestino;
  if (noDestino != null) build.nodes.push(noDestino);
  drawBuild();
  try {
    const zs = await amostraZ([a, b], 25);
    let up = 0, dn = 0;
    for (let i = 1; i < zs.length; i++) { const dz = zs[i] - zs[i - 1]; if (dz > 0) up += dz; else dn -= dz; }
    troco.up = up; troco.dn = dn;
  } catch (e) {}
  drawBuild(); updateZprof();
}
function gpxBuild() {
  const pts = buildPts(), x = (s) => String(s).replace(/[<&>"]/g, (c) => ({ '<': '&lt;', '&': '&amp;', '>': '&gt;', '"': '&quot;' }[c]));
  const s = buildStats();
  const name = 'Trilho ' + fmt(s.L / 1000, 1) + ' km';
  return `<?xml version="1.0" encoding="UTF-8"?>\n<gpx version="1.1" creator="Sombra na Estrela" xmlns="http://www.topografix.com/GPX/1/1">\n<metadata><name>${x(name)}</name><desc>${x('Criado em Caminhos da Estrela. ' + (s.livreL > 0 ? Math.round(s.livrePct * 100) + '% traçado à mão fora da rede mapeada. ' : 'Todo sobre caminhos do OpenStreetMap. ') + 'Desnível +' + Math.round(s.up) + ' m. ' + (s.shade == null ? 'Sem dados de sombra.' : 'Sombra ' + Math.round(s.shade) + '% (LiDAR DGT em ' + Math.round(100 * s.shCov) + '% do traçado).'))}</desc></metadata>\n<trk><name>${x(name)}</name><trkseg>${pts.map((p) => `<trkpt lat="${p[0].toFixed(6)}" lon="${p[1].toFixed(6)}"></trkpt>`).join('')}</trkseg></trk>\n</gpx>\n`;
}
async function saveBuildGpx() {
  const msg = document.getElementById('b-msg'), dl = await downloadsP;
  if (!dl) { msg.textContent = 'Descarregar não está disponível nesta vista.'; return; }
  const base = 'trilho-' + fmt(buildStats().L / 1000, 1).replace(',', '-') + 'km';
  try { const res = await dl.save({ filename: base + '.zip', data: zipOne(base + '.gpx', gpxBuild()) }); msg.textContent = res.status === 'saved' ? `Descarregado ${base}.zip (tem o ${base}.gpx dentro).` : ''; }
  catch (e) { msg.textContent = e && e.code === 'declined' ? 'Cancelado.' : 'Não foi possível descarregar aqui.'; }
}
function showBuild() {
  $('list').hidden = true; document.querySelector('main').classList.remove('listing');
  $('tab-map').setAttribute('aria-pressed', 'false'); $('tab-list').setAttribute('aria-pressed', 'false'); $('tab-new').setAttribute('aria-pressed', 'true');
  document.body.classList.add('building'); $('sheet').hidden = true; $('bwrap').hidden = false;
  setTimeout(() => map.invalidateSize(), 50);
  const el = document.getElementById('bpanel');
  if (!RD) { el.innerHTML = '<p class="hint">A carregar a rede de caminhos (uma vez só, cerca de 7 MB)…</p>'; loadRede().then(renderBuildPanel).catch(() => { el.innerHTML = '<p class="hint">Não foi possível carregar a rede de caminhos.</p>'; }); }
  else renderBuildPanel();
}
function leaveBuild() { document.body.classList.remove('building'); $('bwrap').hidden = true; $('sheet').hidden = false; $('tab-new').setAttribute('aria-pressed', 'false'); }
// Guardar trilhos criados (neste telemóvel)
const TRI_KEY = 'sne-trilhos';
const triLoad = () => { try { return JSON.parse(localStorage.getItem(TRI_KEY) || '[]'); } catch (e) { return []; } };
const triSave = (a) => { try { localStorage.setItem(TRI_KEY, JSON.stringify(a.slice(-40))); return true; } catch (e) { return false; } };
function saveTrail() {
  if (!build.edges.length) return;
  const s = buildStats(), name = prompt('Nome do trilho:', 'Trilho ' + fmt(s.L / 1000, 1) + ' km');
  if (name === null) return;
  const a = triLoad();
  a.push({ n: name || ('Trilho ' + fmt(s.L / 1000, 1) + ' km'), d: Date.now(), nodes: build.nodes, e: build.edges.map((x) => x.livre ? ['L', x.pts, x.L, x.up, x.dn, x.sh, x.cov] : [x.ei, x.from]), km: +(s.L / 1000).toFixed(2), up: Math.round(s.up), sh: s.shade == null ? null : Math.round(s.shade), livre: +(s.livrePct * 100).toFixed(0) });
  const ok = triSave(a);
  const m = document.getElementById('b-msg'); if (m) m.textContent = ok ? 'Guardado neste telemóvel.' : 'Não foi possível guardar neste telemóvel.';
  renderBuildPanel();
}
function openTrail(i) {
  const t = triLoad()[i]; if (!t) return;
  build.nodes = t.nodes || [];
  build.edges = (t.e || []).map((x) => x[0] === 'L'
    ? { livre: true, pts: x[1], L: x[2], up: x[3], dn: x[4], sh: x[5], cov: x[6] }
    : { ei: x[0], from: x[1] });
  const ult = build.edges[build.edges.length - 1];
  if (ult) { const p = trocoPts(ult); build.fimLL = p[p.length - 1]; build.fimNo = ult.livre ? -1 : (build.nodes[build.nodes.length - 1] ?? -1); }
  else { build.fimLL = null; build.fimNo = -1; }
  drawBuild(); updateZprof();
  const pts = buildPts(); if (pts.length) map.fitBounds(L.latLngBounds(pts), { padding: [40, 40] });
}
function delTrail(i) { const a = triLoad(); a.splice(i, 1); triSave(a); renderBuildPanel(); }
function trailList() {
  const a = triLoad(); if (!a.length) return '';
  return `<h3 class="sec">Os meus trilhos · ${a.length}</h3><ol class="wp">${a.map((t, i) => `<li><button class="wpb tri-o" data-i="${i}"><span><span class="nm">${esc(t.n)}</span><br><span class="sub">${fmt(t.km, 2)} km · ↗ ${fmt(t.up)} m${t.sh == null ? '' : ' · sombra ' + fmt(t.sh) + '%'}</span></span><span class="km tri-x" data-i="${i}" role="button" aria-label="Apagar">✕</span></button></li>`).join('')}</ol><p class="note">Guardados só neste telemóvel, neste navegador.</p>`;
}
// Puxar a ficha para baixo, para ver o mapa
function sheetPeek(on) { const s = $('sheet'); s.classList.toggle('peek', on !== undefined ? on : !s.classList.contains('peek')); const b = document.getElementById('fabs'); if (b) b.hidden = !(selected && s.classList.contains('peek')); setTimeout(() => map.invalidateSize(), 60); }
document.addEventListener('click', (e) => { if (e.target.classList && e.target.classList.contains('grab')) sheetPeek(); });
// Onde estou (GPS) e ecrã inteiro
let geoWatch = null, meMarker = null, meCircle = null, meFollow = true, meLast = null;
function meIcon() { return L.divIcon({ className: 'me', html: '<span class="me-dot"></span><span class="me-pulse"></span>', iconSize: [22, 22], iconAnchor: [11, 11] }); }
function meInfo(p) {
  const el = document.getElementById('me-info'); if (!el) return;
  if (!p) { el.hidden = true; return; }
  let txt = `Precisão ${fmt(p.coords.accuracy)} m`;
  if (p.coords.altitude != null) txt += ` · ${fmt(p.coords.altitude)} m de altitude`;
  if (selected) {
    const k = Math.cos(p.coords.latitude * Math.PI / 180), ll = { lat: p.coords.latitude, lng: p.coords.longitude };
    let best = 1e12; for (const part of geo(selected)) { if (part.length > 1) best = Math.min(best, lineDist(ll, part, k)); }
    if (isFinite(best)) txt += best < 40 ? ' · no percurso' : ` · a ${best < 1000 ? fmt(best) + ' m' : fmt(best / 1000, 1) + ' km'} do percurso`;
  }
  el.textContent = txt; el.hidden = false;
}
function stopGeo() {
  if (geoWatch != null) { navigator.geolocation.clearWatch(geoWatch); geoWatch = null; }
  if (meMarker) { meMarker.remove(); meMarker = null; } if (meCircle) { meCircle.remove(); meCircle = null; }
  meInfo(null); document.getElementById('btn-gps').setAttribute('aria-pressed', 'false');
}
function startGeo() {
  if (!navigator.geolocation) { toast('Este telemóvel não dá a localização.'); return; }
  document.getElementById('btn-gps').setAttribute('aria-pressed', 'true');
  meFollow = true;
  toast('A procurar o sinal de GPS…');
  geoWatch = navigator.geolocation.watchPosition((p) => {
    meLast = p; const ll = [p.coords.latitude, p.coords.longitude];
    if (!meMarker) { meMarker = L.marker(ll, { icon: meIcon(), interactive: false, pane: 'poiP', zIndexOffset: 1000 }).addTo(map); meCircle = L.circle(ll, { radius: p.coords.accuracy, color: '#3E86C6', weight: 1, fillColor: '#3E86C6', fillOpacity: .15, interactive: false }).addTo(map); }
    else { meMarker.setLatLng(ll); meCircle.setLatLng(ll).setRadius(p.coords.accuracy); }
    if (meFollow) { map.setView(ll, Math.max(map.getZoom(), 15), { animate: true }); meFollow = false; }
    meInfo(p); toast('');
    if (map3 && !document.getElementById('v3d').hidden) me3D(ll);
  }, (err) => {
    stopGeo();
    toastAction(err.code === 1 ? 'O GPS está bloqueado nesta página. Podes marcar a tua posição à mão.' : null, 'Marcar posição', askCoords);
    toast(err.code === 1 ? '' : err.code === 3 ? 'Não consegui apanhar o GPS. Tenta ao ar livre.' : 'Não foi possível obter a localização aqui.');
  }, { enableHighAccuracy: true, maximumAge: 5000, timeout: 20000 });
}
let me3 = null;
function me3D(ll) { if (!map3) return; if (!me3) { const el = document.createElement('div'); el.className = 'me m3'; el.innerHTML = '<span class="me-dot"></span>'; me3 = new maplibregl.Marker({ element: el }).setLngLat([ll[1], ll[0]]).addTo(map3); } else me3.setLngLat([ll[1], ll[0]]); }
function toastAction(msg, label, fn) { const el = document.getElementById('toast'); if (!el || !msg) return; el.innerHTML = esc(msg) + ' <button class="tbtn" id="t-act">' + esc(label) + '</button>'; el.hidden = false; clearTimeout(toast._t); document.getElementById('t-act').onclick = () => { el.hidden = true; fn(); }; }
function toast(msg) { const el = document.getElementById('toast'); if (!el) return; el.textContent = msg || ''; el.hidden = !msg; if (msg) { clearTimeout(toast._t); toast._t = setTimeout(() => { el.hidden = true; }, 6000); } }
document.getElementById('btn-gps').onclick = () => { if (geoWatch != null) { if (meLast) { meFollow = true; map.setView([meLast.coords.latitude, meLast.coords.longitude], Math.max(map.getZoom(), 15)); } else stopGeo(); } else startGeo(); };
document.getElementById('btn-gps').ondblclick = stopGeo;
document.getElementById('btn-gps').oncontextmenu = (e) => { e.preventDefault(); askCoords(); };
const fsEl = () => document.querySelector('.app');
function toggleFull() {
  const d = document;
  if (d.fullscreenElement || d.webkitFullscreenElement) { (d.exitFullscreen || d.webkitExitFullscreen).call(d); return; }
  const e = fsEl(), req = e.requestFullscreen || e.webkitRequestFullscreen;
  if (!req) { toast('O ecrã inteiro não está disponível aqui.'); return; }
  Promise.resolve(req.call(e)).catch(() => toast('O navegador não deixou pôr em ecrã inteiro.'));
}
document.getElementById('btn-full').onclick = toggleFull;
document.addEventListener('fullscreenchange', () => { document.getElementById('btn-full').setAttribute('aria-pressed', !!document.fullscreenElement); setTimeout(() => map.invalidateSize(), 120); });
// Sem GPS (a página corre dentro de uma moldura que o bloqueia): marcar a posição à mão
function askCoords() {
  const s = prompt('Cola aqui as coordenadas ou o link do Google Maps:\n(ex.: 40.40123, -7.53712)');
  if (!s) return;
  const m = s.replace(',', ' , ').match(/(-?\d+[.,]\d+)\s*[,; ]\s*(-?\d+[.,]\d+)/);
  if (!m) { toast('Não percebi essas coordenadas.'); return; }
  const la = parseFloat(m[1].replace(',', '.')), lo = parseFloat(m[2].replace(',', '.'));
  if (!isFinite(la) || !isFinite(lo)) { toast('Não percebi essas coordenadas.'); return; }
  setMe({ coords: { latitude: la, longitude: lo, accuracy: 25, altitude: null } }, true);
}
function setMe(p, center) {
  const ll = [p.coords.latitude, p.coords.longitude];
  if (!meMarker) { meMarker = L.marker(ll, { icon: meIcon(), interactive: false, pane: 'poiP', zIndexOffset: 1000 }).addTo(map); meCircle = L.circle(ll, { radius: p.coords.accuracy, color: '#3E86C6', weight: 1, fillColor: '#3E86C6', fillOpacity: .15, interactive: false }).addTo(map); }
  else { meMarker.setLatLng(ll); meCircle.setLatLng(ll).setRadius(p.coords.accuracy); }
  meLast = p; meInfo(p);
  if (center) map.setView(ll, Math.max(map.getZoom(), 15));
  if (map3 && !document.getElementById('v3d').hidden) me3D(ll);
}
function restyle(r, hi) {
  const g = layers.get(r.id);
  if (r.lidar) { g.eachLayer((l) => { if (l.options.casing) l.setStyle({ color: hi ? css('--pr-y') : '#0B120D', opacity: hi ? 1 : .5, weight: hi ? 7 : 5 }); }); return; }
  const layersArr = g.getLayers(); layersArr[0].setStyle(styleFor(r, hi)); if (hi) layersArr[0].bringToFront();
}

// list
const F = { lidar: false, fogo: false, pnse: false, of: false };
const FD = new Set(), FU = new Set(), FH = new Set();
const BD = [[0, 5], [5, 10], [10, 20], [20, 1e9]];
const BU = [[0, 300], [300, 800], [800, 1e9]];
const BH = [[70, 101], [40, 70], [0, 40]];
let sortBy = 'nome', sortDir = 1;
const upOf = (r) => (r.el && r.el.up != null) ? r.el.up : null;
const shOf = (r) => r.lidar ? r.lidar.sombra : (r.arv != null ? r.arv : null);
const semAcento = (s) => String(s == null ? '' : s).toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');
const inBand = (set, bands, v) => !set.size || (v != null && [...set].some((i) => v >= bands[i][0] && v < bands[i][1]));
function renderList() {
  const termos = semAcento($('q').value.trim()).split(/\s+/).filter(Boolean);
  const rs = D.routes.filter((r) => {
    if (F.lidar && !r.lidar) return false;
    if (F.fogo && r.a25 !== 0) return false;
    if (F.pnse && !(r.pnse >= 50)) return false;
    if (F.of && r.fonte !== 'oficial') return false;
    if (!inBand(FD, BD, r.km)) return false;
    if (!inBand(FU, BU, upOf(r))) return false;
    if (!inBand(FH, BH, shOf(r))) return false;
    if (termos.length) {
      const pal = semAcento([r.ref, r.nome, fonteTxt[r.fonte], r.lidar ? 'sombra medida lidar' : '', r.pnse >= 50 ? 'parque natural' : '', r.a25 > 0 ? 'ardido' : ''].join(' '));
      if (!termos.every((t) => pal.includes(t))) return false;
    }
    return true;
  });
  const chave = { nome: (r) => semAcento(r.nome) || '\uffff', km: (r) => r.km == null ? 1e9 : r.km, up: (r) => upOf(r) == null ? -1 : upOf(r), alt: (r) => r.zmax == null ? -1 : r.zmax, sombra: (r) => shOf(r) == null ? -1 : shOf(r) }[sortBy];
  rs.sort((a, b) => { const x = chave(a), y = chave(b); return (x < y ? -1 : x > y ? 1 : 0) * sortDir; });
  const tot = D.routes.length;
  $('count').textContent = rs.length === tot ? `${tot} percursos` : `${rs.length} de ${tot} percursos`;
  $('items').innerHTML = rs.map((r) => {
    const s = shOf(r);
    const v = r.lidar
      ? `<span class="sc" style="color:${shadeCol(r.lidar.sombra)}">${fmt(r.lidar.sombra)}%<small>sombra medida</small></span>`
      : `<span class="sc">${s == null ? '—' : fmt(s) + '%'}<small>árvores (estimativa)</small></span>`;
    const u = upOf(r);
    const sub = [`${fmt(r.km, 1)} km`, u == null ? null : `↑ ${fmt(u)} m`, `${fmt(r.zmin)}–${fmt(r.zmax)} m`,
      r.a25 > 0 ? `ardido 2025 ${fmt(r.a25)}%` : null,
      r.fonte !== 'oficial' ? (r.fonte === 'osm' ? 'OSM' : 'gravação') : 'oficial'].filter(Boolean).join(' · ');
    const nome = (r.nome && r.nome.trim()) ? esc(r.nome) : '<em>Caminho sem nome</em>';
    return `<button class="item" data-id="${r.id}">${prBadge(r)}<span><span class="nm">${esc(r.ref ? r.ref + ' · ' : '')}${nome}</span><br><span class="sub">${sub}</span></span>${v}</button>`;
  }).join('');
  bindItems($('items'));
}
function bindItems(root) { root.querySelectorAll('.item').forEach((b) => b.onclick = () => select(D.routes.find((r) => r.id === +b.dataset.id), true)); }
[['f-lidar', 'lidar'], ['f-fogo', 'fogo'], ['f-pnse', 'pnse'], ['f-of', 'of']].forEach(([id, k]) => $(id).onclick = () => { F[k] = !F[k]; $(id).setAttribute('aria-pressed', F[k]); renderList(); });
[['d', FD, BD.length], ['u', FU, BU.length], ['h', FH, BH.length]].forEach(([pre, set, n]) => {
  for (let i = 0; i < n; i++) {
    const el = $(pre + '-' + i); if (!el) continue;
    el.onclick = () => { if (set.has(i)) set.delete(i); else set.add(i); el.setAttribute('aria-pressed', set.has(i)); renderList(); };
  }
});
const ORD = [['s-nome', 'nome', 'Nome', 1], ['s-km', 'km', 'Distância', 1], ['s-up', 'up', 'Subida', -1], ['s-alt', 'alt', 'Altitude', -1], ['s-sombra', 'sombra', 'Sombra', -1]];
function pintaOrdem() {
  ORD.forEach(([id, k, lbl]) => { const b = $(id); if (!b) return; const on = k === sortBy; b.setAttribute('aria-pressed', on); b.textContent = lbl + (on ? (sortDir > 0 ? ' ↑' : ' ↓') : ''); });
}
ORD.forEach(([id, k, lbl, def]) => { const b = $(id); if (b) b.onclick = () => { if (sortBy === k) sortDir = -sortDir; else { sortBy = k; sortDir = def; } pintaOrdem(); renderList(); }; });
if ($('s-limpar')) $('s-limpar').onclick = () => {
  Object.keys(F).forEach((k) => { F[k] = false; });
  ['f-lidar', 'f-fogo', 'f-pnse', 'f-of'].forEach((x) => $(x) && $(x).setAttribute('aria-pressed', 'false'));
  [['d', FD, BD.length], ['u', FU, BU.length], ['h', FH, BH.length]].forEach(([pre, set, n]) => { set.clear(); for (let i = 0; i < n; i++) { const e = $(pre + '-' + i); if (e) e.setAttribute('aria-pressed', 'false'); } });
  $('q').value = ''; sortBy = 'nome'; sortDir = 1; pintaOrdem(); renderList();
};
pintaOrdem();
$('q').oninput = renderList;
function showMap() { leaveBuild(); $('list').hidden = true; document.querySelector('main').classList.remove('listing'); $('tab-map').setAttribute('aria-pressed', 'true'); $('tab-list').setAttribute('aria-pressed', 'false'); setTimeout(() => map.invalidateSize(), 50); }
function showList() { leaveBuild(); $('list').hidden = false; document.querySelector('main').classList.add('listing'); $('tab-map').setAttribute('aria-pressed', 'false'); $('tab-list').setAttribute('aria-pressed', 'true'); }
$('tab-map').onclick = showMap; $('tab-list').onclick = showList; $('tab-new').onclick = showBuild;
$('legend-d').open = false;

sheetIdle(); renderList();

# -*- coding: utf-8 -*-
import io
P = []

# ---------- contentor do mapa topografico ----------
P.append((
'<div class="mapctl"><button id="btn-gps"',
'<div id="mapt" hidden aria-label="Mapa topográfico"></div>\n    <div class="mapctl"><button id="btn-topo" class="mctl" aria-pressed="false" aria-label="Mapa topográfico" title="Topográfico / Fotografia"><svg viewBox="0 0 24 24" width="22" height="22" aria-hidden="true"><g fill="none" stroke="currentColor" stroke-width="1.8" stroke-linejoin="round"><path d="M2 17l6-9 4 5 3-4 7 8z"/><path d="M5 20h14"/></g></svg></button><button id="btn-relevo" class="mctl" hidden aria-pressed="false" aria-label="Relevo 3D" title="Relevo 3D"><svg viewBox="0 0 24 24" width="22" height="22" aria-hidden="true"><path d="M3 16l9-5 9 5-9 5z" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linejoin="round"/><path d="M3 11l9-5 9 5" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linejoin="round" opacity=".55"/></svg></button><button id="btn-gps"'))

P.append((
"#map{position:absolute;inset:0;background:#2a2f28;z-index:0;isolation:isolate}",
"#map{position:absolute;inset:0;background:#2a2f28;z-index:0;isolation:isolate}\n#mapt{position:absolute;inset:0;background:#F7F4EC;z-index:1}\n#mapt .maplibregl-ctrl-attrib{display:none}\n.topo-lbl{font:600 11px/1.1 var(--f-display),system-ui;color:#3B3226;text-shadow:0 0 3px #F7F4EC,0 0 6px #F7F4EC;white-space:nowrap;pointer-events:none}"))

# ---------- codigo ----------
P.append((
"map.on('moveend zoomend', osmByZoom); osmByZoom();",
"""map.on('moveend zoomend', osmByZoom); osmByZoom();

// ---------------- Mapa topografico (vetorial, MapLibre + PMTiles) ----------------
const TOPO_URL = 'dados/topo.pmtiles';
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
    ],
  };
}
async function abreTopo() {
  const cx = document.getElementById('mapt');
  try { await ensureML(); } catch (e) { toast('Não foi possível carregar o mapa topográfico.'); return; }
  if (!pmProto) {
    try {
      await loadScript('lib/pmtiles.js');
      pmProto = new pmtiles.Protocol();
      maplibregl.addProtocol('pmtiles', pmProto.tile);
    } catch (e) { toast('Falta a biblioteca do mapa topográfico.'); return; }
  }
  const c = map.getCenter(), z = map.getZoom();
  cx.hidden = false;
  if (!mapT) {
    mapT = new maplibregl.Map({ container: 'mapt', attributionControl: false, style: estiloTopo(),
      center: [c.lng, c.lat], zoom: z, maxPitch: 80, minZoom: 8, maxZoom: 17.5 });
    mapT.on('click', (e) => topoClique(e));
    mapT.on('error', (e) => { if (e && e.error && /pmtiles|topo/i.test(String(e.error.message || ''))) toast('Mapa topográfico indisponível.'); });
  } else { mapT.jumpTo({ center: [c.lng, c.lat], zoom: z }); mapT.resize(); }
  topoAberto = true;
  document.getElementById('btn-topo').setAttribute('aria-pressed', 'true');
  document.getElementById('btn-relevo').hidden = false;
  if (meLast) meTopo(meLast);
}
function fechaTopo() {
  if (!topoAberto) return;
  if (mapT) { const c = mapT.getCenter(); map.setView([c.lat, c.lng], Math.round(mapT.getZoom()), { animate: false }); }
  document.getElementById('mapt').hidden = true;
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
document.getElementById('btn-relevo').onclick = () => {
  if (!mapT) return;
  topoRelevo = !topoRelevo;
  document.getElementById('btn-relevo').setAttribute('aria-pressed', topoRelevo);
  if (topoRelevo) { mapT.setTerrain({ source: 'dem', exaggeration: 1.25 }); mapT.easeTo({ pitch: 58, duration: 600 }); }
  else { mapT.setTerrain(null); mapT.easeTo({ pitch: 0, bearing: 0, duration: 600 }); }
};"""))

def apply(path, pairs, req):
    s = io.open(path, encoding='utf-8').read(); n = 0
    for o, x in pairs:
        if o in s: s = s.replace(o, x, 1); n += 1
        elif req: print('  FALTA:', o[:70].replace('\n', '\\n'))
    io.open(path, 'w', encoding='utf-8').write(s); return n

for f in ('page/app.js', 'page/body.html', 'page/head.html', 'page/sombra-na-estrela.html'):
    print(f, '->', apply(f, P, 'sombra' in f))

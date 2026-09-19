#!/usr/bin/env python3
# -*- coding: utf-8 -*-
# Liga o motor de terreno ao botao 3D de cada percurso.
# Falha alto: cada troca tem de aparecer o numero exacto de vezes.
import io, sys

JS = ['fonte/app.js', 'fonte/sombra-na-estrela.html']
HTML = ['fonte/sombra-na-estrela.html']

NOVO_JS = r"""
// ---- 3D de raiz: o mesmo motor do teste-terreno, cozido a entrada ----------
// Cozer as 133 caixas em terra dava 133 ficheiros de meio MB. Nao e preciso: o
// telemovel ja tem o dem.webp e os azulejos, e cozer a caixa de um percurso
// leva menos de um segundo. Depois de cozida nao se constroi mais nada -- e e
// isso que faz a vista ser fluida em vez de se montar enquanto se roda.
let TERR = null, VISTA = null, pmTopo = null;
async function ensureTerreno() {
  if (!TERR) TERR = loadScript('fonte/terreno.js?v=7');
  await TERR;
}
function caixaDoPercurso(r) {
  let lo0 = 1e9, la0 = 1e9, lo1 = -1e9, la1 = -1e9;
  const ps = (r.segs && r.segs.length) ? r.segs.flatMap((s) => segPts(s)) : geo(r).flat();
  for (const [la, lo] of ps) {
    if (lo < lo0) lo0 = lo; if (lo > lo1) lo1 = lo;
    if (la < la0) la0 = la; if (la > la1) la1 = la;
  }
  // folga a volta, e limites: abaixo de 3 km nao ha paisagem, acima de 13 km a
  // semeadura comeca a pesar no telemovel sem se ganhar nada.
  const mlat = 110540, mlon = 111320 * Math.cos((la0 + la1) / 2 * Math.PI / 180);
  const cx = (lo0 + lo1) / 2, cy = (la0 + la1) / 2;
  let w = Math.max((lo1 - lo0) * mlon * 1.35, 3000);
  let h = Math.max((la1 - la0) * mlat * 1.35, 3000);
  w = Math.min(w, 13000); h = Math.min(h, 13000);
  return [cx - w / 2 / mlon, cy - h / 2 / mlat, cx + w / 2 / mlon, cy + h / 2 / mlat];
}
async function terreno3D(r) {
  const box = document.getElementById('v3d'), msg = document.getElementById('v3d-msg');
  const cvs = document.getElementById('t3'), rot = document.getElementById('t3r');
  await ensureTerreno();
  if (!pmProto) {
    await loadScript('lib/pmtiles.js');
    pmProto = new pmtiles.Protocol();
    maplibregl.addProtocol && maplibregl.addProtocol('pmtiles', pmProto.tile);
  }
  if (!pmTopo) pmTopo = new pmtiles.PMTiles(new URL(TOPO_URL, location.href).href);
  const D0 = await ensureDEM();
  const kx = (D0.w - 1) / (DEM_B[2] - DEM_B[0]), ky = (D0.h - 1) / (DEM_B[3] - DEM_B[1]);
  const cotaEmGraus = (lo, la) => {
    const fx = Math.min(D0.w - 1.001, Math.max(0, (lo - DEM_B[0]) * kx));
    const fy = Math.min(D0.h - 1.001, Math.max(0, (DEM_B[3] - la) * ky));
    const i = fx | 0, j = fy | 0, u = fx - i, v = fy - j;
    const a = D0.z[j*D0.w+i], b = D0.z[j*D0.w+i+1], c = D0.z[(j+1)*D0.w+i], d = D0.z[(j+1)*D0.w+i+1];
    return (a*(1-u)+b*u)*(1-v) + (c*(1-u)+d*u)*v;
  };
  const pedeAzulejo = async (z, x, y) => {
    const t = await pmTopo.getZxy(z, x, y);
    return t ? t.data : null;
  };
  const caixa = caixaDoPercurso(r);
  const t0 = performance.now();
  const PASSOS = { relevo: 'a ler o relevo…', 'carta do solo': 'a ler a carta do solo…',
                   sombra: 'a calcular a sombra dos montes…' };
  const T = await cozeCaixa(caixa, { passo: 25, classe: 8, pedeAzulejo, cotaEmGraus,
    aviso: (q) => { msg.textContent = PASSOS[q] || q; } });
  msg.textContent = 'a semear a caixa toda, uma vez…';
  await new Promise((ok) => setTimeout(ok, 0));
  if (VISTA) { VISTA.desliga(); VISTA = null; }
  VISTA = abreVista(cvs, T, { camadaRotulos: rot });
  // a camara aponta ao meio do percurso, deitada o suficiente para ver relevo
  const ps = geo(r).flat();
  const meio = ps[Math.floor(ps.length / 2)] || [(caixa[1]+caixa[3])/2, (caixa[0]+caixa[2])/2];
  VISTA.vaiA(meio[1], meio[0], 1800);
  VISTA.cam.incl = 1.05; VISTA.cam.rumo = 0.7;
  const agora = new Date();
  const sl = document.getElementById('t3h');
  sl.value = agora.getHours() * 60 + agora.getMinutes();
  horaTerreno();
  msg.textContent = '';
  const c = VISTA.conta;
  console.log('terreno 3D: cozer %d ms, malha %d ms, semear %d ms, %s plantas',
    Math.round(performance.now() - t0 - c.malha - c.semear),
    Math.round(c.malha), Math.round(c.semear), c.total.toLocaleString('pt-PT'));
}
const RUMO8 = ['N','NE','E','SE','S','SO','O','NO'];
function horaTerreno() {
  if (!VISTA) return;
  const m = +document.getElementById('t3h').value;
  const q = new Date(); q.setHours(m / 60 | 0, m % 60, 0, 0);
  const s = VISTA.hora(q);
  document.getElementById('t3t').textContent =
    String(m / 60 | 0).padStart(2, '0') + ':' + String(m % 60).padStart(2, '0')
    + (s.alt > 0 ? '  ' + s.alt.toFixed(0) + '° ' + RUMO8[Math.round(s.az / 45) % 8] : '  sol posto');
}
function fecha3D() {
  if (VISTA) { VISTA.desliga(); VISTA = null; }
  document.getElementById('v3d').hidden = true;
}
"""

CHAMADA_VELHA = """async function open3D(r) {
  const box = document.getElementById('v3d'), msg = document.getElementById('v3d-msg');
  box.hidden = false; msg.textContent = 'A carregar o relevo…';
  try { await ensureML(); } catch (e) { msg.textContent = 'Não foi possível carregar a vista 3D neste dispositivo.'; return; }"""

CHAMADA_NOVA = """async function open3D(r) {
  const box = document.getElementById('v3d'), msg = document.getElementById('v3d-msg');
  box.hidden = false; msg.textContent = 'A carregar o relevo…';
  // Primeiro o terreno de raiz. Se este aparelho nao o aguentar (sem WebGL2,
  // por exemplo), cai-se na vista antiga em vez de ficar sem nada.
  document.getElementById('v3d').classList.add('terr');
  try {
    await terreno3D(r);
    return;
  } catch (e) {
    console.warn('terreno 3D nao deu, volta-se a vista antiga:', e);
    document.getElementById('v3d').classList.remove('terr');
    if (VISTA) { VISTA.desliga(); VISTA = null; }
    msg.textContent = 'A carregar o relevo…';
  }
  try { await ensureML(); } catch (e) { msg.textContent = 'Não foi possível carregar a vista 3D neste dispositivo.'; return; }"""

FECHO_VELHO = """document.getElementById('x3').onclick = () => { document.getElementById('v3d').hidden = true; };"""
FECHO_NOVO = """document.getElementById('x3').onclick = () => fecha3D();
document.getElementById('t3h').addEventListener('input', horaTerreno);
for (const [id, k] of [['t3c', 'curvas'], ['t3n', 'nomes']]) {
  document.getElementById(id).addEventListener('click', () => {
    if (!VISTA) return;
    VISTA.mostrar[k] = !VISTA.mostrar[k];
    document.getElementById(id).classList.toggle('on', VISTA.mostrar[k]);
  });
}"""

MARCA = """async function open3D(r) {"""

MARKUP_VELHO = """<div id="v3d" hidden><div id="map3"></div><div class="v3d-bar">"""
MARKUP_NOVO = """<div id="v3d" hidden><div id="map3"></div><canvas id="t3"></canvas><div id="t3r"></div><div id="t3sol"><span>☀</span><input id="t3h" type="range" min="0" max="1439" step="5"><span id="t3t"></span></div><div class="v3d-bar">"""

BOTOES_VELHO = """<button class="btn alt" id="v3d-rot">Rodar 45°</button>"""
BOTOES_NOVO = """<button class="btn alt" id="v3d-rot">Rodar 45°</button><button class="btn alt on" id="t3c">Curvas</button><button class="btn alt on" id="t3n">Nomes</button>"""

CSS_VELHO = """#v3d{position:absolute;inset:0;z-index:1400;background:#1b1f1a}#map3{position:absolute;inset:0}"""
CSS_NOVO = """#v3d{position:absolute;inset:0;z-index:1400;background:#1b1f1a}#map3{position:absolute;inset:0}#t3{position:absolute;inset:0;width:100%;height:100%;display:none;touch-action:none}#t3r{position:absolute;inset:0;pointer-events:none;overflow:hidden;display:none}#t3sol{position:absolute;left:12px;right:12px;bottom:12px;z-index:6;display:none;align-items:center;gap:10px;background:rgba(255,253,246,.93);border-radius:11px;padding:9px 12px;font-size:12.5px;color:#2C2A24}#t3sol input{flex:1;min-width:60px;accent-color:#C8761F}#t3t{font-variant-numeric:tabular-nums;white-space:nowrap;font-weight:600}#v3d.terr #t3,#v3d.terr #t3r{display:block}#v3d.terr #t3sol{display:flex}#v3d.terr #map3{display:none}#v3d .r{position:absolute;transform:translate(-50%,-100%);white-space:nowrap;font-size:11px;line-height:1.1;color:#3A3226;text-shadow:0 0 3px #FFFDF6,0 0 3px #FFFDF6,0 0 5px #FFFDF6}#v3d .r b{display:block;font-weight:600}#v3d .r.cume{color:#5B4426}#v3d .r.povoacao{font-size:12px}#v3d .r.agua{color:#2A5A79}#t3c.on,#t3n.on{background:#2E6B4F;color:#fff;border-color:#2E6B4F}"""


def troca(caminho, pares):
    s = io.open(caminho, encoding='utf-8').read()
    for a, b in pares:
        n = s.count(a)
        if n != 1:
            sys.exit('%s: ancora aparece %d vezes: %r' % (caminho, n, a[:60]))
        s = s.replace(a, b)
    io.open(caminho, 'w', encoding='utf-8').write(s)
    print('%s: %d trocas' % (caminho, len(pares)))


for f in JS:
    troca(f, [(MARCA, NOVO_JS + '\n' + MARCA),
              (CHAMADA_VELHA, CHAMADA_NOVA),
              (FECHO_VELHO, FECHO_NOVO)])
for f in HTML:
    troca(f, [(MARKUP_VELHO, MARKUP_NOVO),
              (BOTOES_VELHO, BOTOES_NOVO),
              (CSS_VELHO, CSS_NOVO)])

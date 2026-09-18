# -*- coding: utf-8 -*-
import io
P = []

# ---- painel: contagem do que falta, cobertura acumulada e camada no mapa ----
P.append((
"""    if (d.tipo === 'pronto') {
      const b = document.getElementById('off-barra-' + d.fase);
      if (b) { b.firstElementChild.style.width = '100%'; b.classList.add('feito'); }
      const bt = document.getElementById(d.fase === 'topo' ? 'off-topo' : 'off-fotos');
      if (bt) { bt.textContent = d.fase === 'topo' ? '✓ Mapa topográfico guardado' : '✓ Fotografia desta zona guardada'; bt.classList.add('on'); }
      toast(d.fase === 'topo' ? 'Mapa topográfico guardado.' : 'Fotografia desta zona guardada.');
      setTimeout(pedeEstado, 2500);
    }""",
"""    if (d.tipo === 'pronto') {
      const b = document.getElementById('off-barra-' + d.fase);
      if (b) { b.firstElementChild.style.width = '100%'; b.classList.add('feito'); }
      const bt = document.getElementById(d.fase === 'topo' ? 'off-topo' : 'off-fotos');
      if (bt) { bt.textContent = d.fase === 'topo' ? '✓ Mapa topográfico guardado' : '✓ Zona guardada'; bt.classList.add('on'); }
      if (d.fase === 'fotos') toast(d.novas ? ('Guardadas ' + fmt(d.novas) + ' imagens novas' + (d.jaLa ? ' (' + fmt(d.jaLa) + ' já tinhas)' : '') + '.') : 'Esta zona já estava toda guardada.');
      else toast('Mapa topográfico guardado.');
      pedeCobertura();
      setTimeout(pedeEstado, 2000);
    }
    if (d.tipo === 'quantos') {
      const b = document.getElementById('off-fotos');
      if (b && !/A guardar|✓/.test(b.textContent)) {
        b.textContent = d.faltam
          ? 'Guardar esta zona (' + fmt(d.faltam) + ' novas de ' + fmt(d.total) + ')'
          : 'Esta zona já está toda guardada';
      }
    }
    if (d.tipo === 'cobertura') { COB = d.quadrados || []; desenhaCobertura(); }"""))

# ---- contagem passa a perguntar ao service worker ----
P.append((
"""function actualizaContagem() {
  const b = document.getElementById('off-fotos');
  if (!b || /guardar as imagens|guardada/i.test(b.textContent)) return;
  const n = fotosDaVista().length;
  b.textContent = 'Guardar a fotografia desta zona (' + fmt(n) + ' imagens)';
}""",
"""function actualizaContagem() {
  const b = document.getElementById('off-fotos');
  if (!b || /A guardar/i.test(b.textContent)) return;
  const u = fotosDaVista();
  if (!u.length) { b.textContent = 'Aproxima o mapa da zona a guardar'; return; }
  b.textContent = 'Guardar esta zona (' + fmt(u.length) + ' imagens)';
  if (navigator.serviceWorker && navigator.serviceWorker.controller) navigator.serviceWorker.controller.postMessage({ tipo: 'quantos', urls: u });
}
// ---- o que ja esta guardado, desenhado no mapa ----
let COB = [], cobGrupo = null, cobLigada = false;
function pedeCobertura() { if (navigator.serviceWorker && navigator.serviceWorker.controller) navigator.serviceWorker.controller.postMessage({ tipo: 'cobertura' }); }
const KM2 = (n) => n * (2 * 20037508.342789244 / 2 ** 19 * 256 / 256) ** 2 / 1e6;   // area de um quadrado z19
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
map.on('moveend zoomend', () => { if (cobLigada) desenhaCobertura(); });"""))

# ---- botoes no painel ----
P.append((
"""    <div class="lin">
      <button class="bt" id="off-fotos">Guardar a fotografia desta zona (${nFotos} imagens)</button>
    </div>
    <div class="barra" id="off-barra-fotos"><i></i></div>""",
"""    <div class="lin">
      <button class="bt" id="off-fotos">Guardar esta zona (${nFotos} imagens)</button>
      <button class="bt ${cobLigada ? 'on' : ''}" id="off-ver">${cobLigada ? '✓ A mostrar o guardado' : 'Ver o que já guardei'}</button>
    </div>
    <div class="barra" id="off-barra-fotos"><i></i></div>
    <p class="est">Guardas por zonas, quantas vezes quiseres: ele traz só o que ainda não tens e junta ao resto.${e.quadrados ? ' Já tens <strong>' + fmt(Math.round(KM2(e.quadrados))) + ' km²</strong> em alta resolução.' : ''}</p>"""))

P.append((
"""  const c = document.getElementById('off-apagar');
  if (c) c.onclick = () => { if (confirm('Apagar o mapa e as imagens guardadas no telemóvel?')) mandaSW({ tipo: 'apagar' }); };""",
"""  const v = document.getElementById('off-ver');
  if (v) v.onclick = () => { cobLigada = !cobLigada; v.textContent = cobLigada ? '✓ A mostrar o guardado' : 'Ver o que já guardei'; v.classList.toggle('on', cobLigada); if (cobLigada) pedeCobertura(); else desenhaCobertura(); };
  const c = document.getElementById('off-apagar');
  if (c) c.onclick = () => { if (confirm('Apagar o mapa e as imagens guardadas no telemóvel?')) mandaSW({ tipo: 'apagar' }); };"""))

P.append((
"  ligaOffline(); pedeEstado();",
"  ligaOffline(); pedeEstado(); pedeCobertura();"))

def apply(path, pairs, req):
    s = io.open(path, encoding='utf-8').read(); n = 0
    for o, x in pairs:
        if o in s: s = s.replace(o, x, 1); n += 1
        elif req: print('  FALTA:', o[:60].replace('\n','\\n'))
    io.open(path, 'w', encoding='utf-8').write(s); return n
for f in ('page/app.js','page/sombra-na-estrela.html'):
    print(f, '->', apply(f, P, 'sombra' in f))

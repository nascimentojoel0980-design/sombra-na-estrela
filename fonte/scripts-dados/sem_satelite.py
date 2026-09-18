# -*- coding: utf-8 -*-
"""Tira a fotografia de satelite de toda a aplicacao.

Porque. Ele disse: "continua muito lento, retira imagem de satelite em todo o
APP, algo esta a criar lentidao em tudo". Tinha razao, e o custo estava em
tres sitios:

  1. A vista 3D do percurso recompunha a fotografia AZULEJO A AZULEJO em
     JavaScript: para cada azulejo ia buscar dezenas de imagens, desenhava-as
     num canvas e voltava a comprimir para JPEG. Tudo na linha principal.
  2. Essas imagens ficavam guardadas descomprimidas -- ate 160 de cada vez.
     Um azulejo de detalhe e 1280x1280, ou seja 6,5 MB em memoria. 160 sao
     perto de 1 GB num telemovel.
  3. O mapa principal ia acrescentando sobreposicoes de imagem a medida que
     ele andava: fundo, blocos de satelite, ortofotos e o detalhe a 25 cm.

O que fica no lugar: 'dados/relevo.jpg', sombreado de encosta feito uma vez a
partir do DEM (ver relevo_fundo.py). Um ficheiro de 1,9 MB em vez de 700 MB de
fotografia, e o mapa topografico continua la inteiro para quem quiser detalhe.

Os ficheiros de fotografia NAO sao apagados -- so deixam de ser usados. Voltar
atras e correr isto ao contrario, nao e refazer dados.

    python3 fonte/scripts-dados/sem_satelite.py
    python3 fonte/build_site.py
"""
import io, os, sys

RAIZ = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
os.chdir(RAIZ)

TROCAS = [
 # 1. o fundo passa a ser o relevo, nao a fotografia
 ("const base = L.imageOverlay('/_blob/bbb0be3a812c34296b0abe310453249c', BOUNDS, { interactive: false, pane: 'satP' }).addTo(map);",
  "const base = L.imageOverlay('dados/relevo.jpg', BOUNDS, { interactive: false, pane: 'satP' }).addTo(map);"),

 # 2. as tres camadas de fotografia deixam de carregar
 ("""function loadChunks() {
  if (map.getZoom() < 11) return;""",
  """function loadChunks() {
  return;   // sem fotografia de satelite: ver fonte/scripts-dados/sem_satelite.py
  /* eslint-disable no-unreachable */
  if (map.getZoom() < 11) return;"""),
 ("""function loadOrtho() {
  if (map.getZoom() < 12) { orthoGroup.eachLayer(l => l.setOpacity(0)); return; }""",
  """function loadOrtho() {
  return;   // sem ortofotos: ver fonte/scripts-dados/sem_satelite.py
  if (map.getZoom() < 12) { orthoGroup.eachLayer(l => l.setOpacity(0)); return; }"""),
 ("""function loadDet() {
  const z = map.getZoom(); detGroup.eachLayer((l) => l.setOpacity(z >= 15 ? 1 : 0));""",
  """function loadDet() {
  return;   // sem detalhe a 25 cm: ver fonte/scripts-dados/sem_satelite.py
  const z = map.getZoom(); detGroup.eachLayer((l) => l.setOpacity(z >= 15 ? 1 : 0));"""),

 # 3. nada para guardar em fotografia, logo nada a contar
 ("""function fotosDaVista() {""",
  """function fotosDaVista() {
  return [];   // sem fotografia nao ha imagens desta zona para guardar
  // eslint-disable-next-line no-unreachable"""),

 # 4. o botao do satelite desaparece
 ("document.getElementById('btn-sat').onclick = () => ligaSat(satModo + 1);",
  """// O botao do satelite sai: nao ha satelite nenhum para ligar. O mapa
// topografico (o botao das montanhas) e agora o unico detalhe, e e vectorial.
{ const bs = document.getElementById('btn-sat'); if (bs) bs.hidden = true; }"""),

 # 5. a vista 3D do percurso passa a ser o mapa topografico com relevo
 ("""    map3 = new maplibregl.Map({ container: 'map3', attributionControl: false, maxPitch: 80, pitch: 62, bearing: -20, center: [bb.getCenter().lng, bb.getCenter().lat], zoom: 13,
      style: { version: 8, sources: { img: { type: 'raster', tiles: ['img://{z}/{x}/{y}'], tileSize: 512, maxzoom: 18 }, dem: { type: 'raster-dem', tiles: ['dem://{z}/{x}/{y}'], tileSize: 256, encoding: 'terrarium', maxzoom: 12 }, rota: { type: 'geojson', data: route3dGeo(r) } },
        layers: [{ id: 'bg', type: 'background', paint: { 'background-color': '#2a2f28' } }, { id: 'img', type: 'raster', source: 'img' },
          { id: 'rota-c', type: 'line', source: 'rota', paint: { 'line-color': '#0B120D', 'line-width': 9, 'line-opacity': 0.6 }, layout: { 'line-join': 'round', 'line-cap': 'round' } },
          { id: 'rota', type: 'line', source: 'rota', paint: { 'line-color': ['get', 'c'], 'line-width': ['coalesce', ['get', 'w'], 5] }, layout: { 'line-join': 'round', 'line-cap': 'round' } }],
        terrain: { source: 'dem', exaggeration: 1.3 } } });""",
  """    // O fundo era fotografia recomposta em JavaScript azulejo a azulejo -- a
    // coisa mais cara da aplicacao inteira. Passa a ser o mesmo mapa
    // topografico vectorial do botao das montanhas, com o relevo por cima.
    // Os nomes 'rota' e 'rota-c' ja existem nesse estilo, dai 'r3'.
    const est = estiloTopo();
    est.sources.rota = { type: 'geojson', data: route3dGeo(r) };
    est.layers.push(
      { id: 'r3-c', type: 'line', source: 'rota', paint: { 'line-color': '#0B120D', 'line-width': 9, 'line-opacity': 0.55 }, layout: { 'line-join': 'round', 'line-cap': 'round' } },
      { id: 'r3', type: 'line', source: 'rota', paint: { 'line-color': ['get', 'c'], 'line-width': ['coalesce', ['get', 'w'], 5] }, layout: { 'line-join': 'round', 'line-cap': 'round' } });
    est.terrain = { source: 'dem', exaggeration: 1.3 };
    map3 = new maplibregl.Map({ container: 'map3', attributionControl: false, maxPitch: 80, pitch: 62, bearing: -20, center: [bb.getCenter().lng, bb.getCenter().lat], zoom: 13, maxZoom: 21, style: est });
    ligaPadroes(map3);"""),

 # 6. a vista 3D precisa do pmtiles, que so o mapa topografico carregava
 ("""  try { await ensureML(); } catch (e) { msg.textContent = 'Não foi possível carregar a vista 3D neste dispositivo.'; return; }""",
  """  try { await ensureML(); } catch (e) { msg.textContent = 'Não foi possível carregar a vista 3D neste dispositivo.'; return; }
  if (!pmProto) {
    try {
      await loadScript('lib/pmtiles.js');
      pmProto = new pmtiles.Protocol();
      maplibregl.addProtocol('pmtiles', pmProto.tile);
    } catch (e) { msg.textContent = 'Falta a biblioteca do mapa topográfico.'; return; }
  }"""),

 # 7. o protocolo da fotografia deixa de existir
 ("    maplibregl.addProtocol('dem', demTile); maplibregl.addProtocol('img', imgTile);",
  "    maplibregl.addProtocol('dem', demTile);"),

 # 8. os botoes de guardar fotografia saem do painel de offline
 ("""  const c = document.getElementById('off-apagar');
  if (c) c.onclick = () => { if (confirm('Apagar o mapa e as imagens guardadas no telemóvel?')) mandaSW({ tipo: 'apagar' }); };""",
  """  // Sem fotografia nao ha "guardar esta zona": o que se guarda agora e o mapa
  // topografico, que e um ficheiro so e ja tem o seu botao.
  ['off-fotos', 'off-ver', 'off-barra-fotos'].forEach((k) => {
    const b = document.getElementById(k); if (b) b.hidden = true;
  });
  const c = document.getElementById('off-apagar');
  if (c) c.onclick = () => { if (confirm('Apagar o mapa guardado no telemóvel?')) mandaSW({ tipo: 'apagar' }); };"""),
 # 9. o rectangulo laranja de "vai guardar" nao tem sentido sem fotografia
 ("  zonaDesc = L.layerGroup().addTo(map);",
  "  return;   // sem fotografia nao ha zona de descarga para marcar\n  zonaDesc = L.layerGroup().addTo(map);"),

 # 10. um fundo de relevo e uma imagem so para 78 km: aos 23 m por pixel fica
 #     borratado mal se aproxima. Em vez de fingir detalhe que nao tem,
 #     desvanece e deixa o papel -- e o mapa topografico (vectorial, nitido em
 #     qualquer zoom) e que serve o detalhe, a um toque de distancia.
 ("map.on('moveend zoomend', loadChunks);",
  """function opacidadeFundo() {
  const z = map.getZoom();
  base.setOpacity(z <= 12 ? 1 : Math.max(0.3, 1 - (z - 12) / 3.5 * 0.7));
}
map.on('zoomend', opacidadeFundo); opacidadeFundo();"""),
]

CONHECIDAS = {'const D = window.__DATA__;'}


def aplica(caminho):
    s = io.open(caminho, encoding='utf-8').read()
    if "L.imageOverlay('dados/relevo.jpg'" in s:
        print('  %s: ja estava sem satelite' % caminho); return
    for velho, novo in TROCAS:
        if velho not in s:
            sys.exit('PAROU: trecho nao encontrado em %s:\n---\n%s\n---' % (caminho, velho[:200]))
        if s.count(velho) != 1:
            sys.exit('PAROU: trecho aparece %d vezes em %s' % (s.count(velho), caminho))
        s = s.replace(velho, novo, 1)
    io.open(caminho, 'w', encoding='utf-8').write(s)
    print('  %s: %d trechos, %.0f KB' % (caminho, len(TROCAS), os.path.getsize(caminho) / 1024))


for f in ('fonte/app.js', 'fonte/sombra-na-estrela.html'):
    aplica(f)

# So no html: o fundo do contentor era verde-escuro porque por baixo estava
# fotografia. Com o relevo esbatido por cima, esse escuro atravessava e o mapa
# ficava um borrao verde-tropa. O papel da o mesmo que o resto da aplicacao.
H = 'fonte/sombra-na-estrela.html'
hs = io.open(H, encoding='utf-8').read()
VELHO = '#map{position:absolute;inset:0;background:#2a2f28;z-index:0;isolation:isolate}'
NOVO = '#map{position:absolute;inset:0;background:#EDEADD;z-index:0;isolation:isolate}'
if VELHO in hs:
    io.open(H, 'w', encoding='utf-8').write(hs.replace(VELHO, NOVO, 1))
    print('  %s: fundo do mapa em papel' % H)
elif NOVO not in hs:
    sys.exit('PAROU: nao encontrei o fundo do #map')

a = io.open('fonte/app.js', encoding='utf-8').read().splitlines()
h = set(io.open('fonte/sombra-na-estrela.html', encoding='utf-8').read().splitlines())
falta = [l for l in a if l not in h and l not in CONHECIDAS]
print('linhas do app.js fora do html: %d' % len(falta))
for l in falta[:5]: print('   ' + l[:100])
if falta: sys.exit('PAROU: os dois ficheiros separaram-se.')
print('OK. Agora:  python3 fonte/build_site.py')

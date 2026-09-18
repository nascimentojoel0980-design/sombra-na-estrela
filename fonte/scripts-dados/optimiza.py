# -*- coding: utf-8 -*-
"""Duas correccoes de desempenho no mapa principal, medidas antes e depois.

MEDIDO ANTES (telemovel a 420x860, DPR 2):
    nos DOM            23 829
    formas SVG         22 235
    camadas Leaflet    22 399
    tarefas longas     4, somando 1121 ms de bloqueio
    tempo ate abrir    1217 ms

O QUE ESTAVA A ACONTECER. Cada percurso com sombra medida por LiDAR era
desenhado troco a troco, com DUAS formas por troco -- o contorno preto e a
linha de cor. 133 percursos com ~85 trocos cada dao 22 mil formas. Todas
criadas ao abrir, todas no mapa ao mesmo tempo, estejam ou nao a vista.

AS DUAS CORRECCOES:

1. preferCanvas. O Leaflet passa a desenhar as linhas num canvas em vez de
   criar um elemento SVG por forma. Uma linha de codigo.

2. Juntar os trocos por cor. O shadeCol so devolve TRES cores (vermelho,
   ambar, verde), por isso os trocos de um percurso cabem em tres formas em
   vez de oitenta e cinco -- mais uma para o contorno, que e todo da mesma
   cor. Quatro formas por percurso em vez de cento e setenta.

    python3 fonte/scripts-dados/optimiza.py
    python3 fonte/build_site.py
"""
import io, os, sys

RAIZ = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
os.chdir(RAIZ)

TROCAS = [
 ("preferCanvas: false", "preferCanvas: true"),

 # 3. nao desenhar o que nao esta a vista
 ('layers.forEach((g, id) => { const r = D.routes.find((x) => x.id === id); if (r.lidar) g.eachLayer((l) => l.bringToFront && l.bringToFront()); });',
  "  layers.forEach((g, id) => { const r = D.routes.find((x) => x.id === id); if (r.lidar) g.eachLayer((l) => l.bringToFront && l.bringToFront()); });\n\n// ---- so se desenha o que esta a vista -------------------------------------\n// Com 133 percursos no mapa, arrastar obrigava a percorrer a geometria de\n// todos a cada fotograma -- incluindo os que estao a cinquenta quilometros de\n// distancia. A caixa de cada percurso calcula-se uma vez; depois, a cada\n// movimento, quem nao toca na vista sai do mapa e quem entra volta.\n// Com um percurso escolhido isto nao manda: ai quem decide e a seleccao.\nconst caixaRota = new Map();\nlayers.forEach((g, id) => {\n  let c = null;\n  g.eachLayer((l) => {\n    if (!l.getBounds) return;\n    const b = l.getBounds();\n    c = c ? c.extend(b) : L.latLngBounds(b.getSouthWest(), b.getNorthEast());\n  });\n  if (c) caixaRota.set(id, c);\n});\nfunction soAVista() {\n  if (selected) return;\n  const vb = map.getBounds().pad(0.3);\n  layers.forEach((g, id) => {\n    const c = caixaRota.get(id);\n    const devia = !c || vb.intersects(c);\n    const tem = map.hasLayer(g);\n    if (devia && !tem) g.addTo(map);\n    else if (!devia && tem) g.remove();\n  });\n}\nmap.on('moveend zoomend', soAVista);\nsoAVista();"),

 ("""  if (r.lidar && r.segs) {
    r.segs.forEach((s) => L.polyline(segPts(s), { color: '#0B120D', weight: 5, opacity: .5, interactive: false, casing: true }).addTo(g));
    r.segs.forEach((s) => L.polyline(segPts(s), { color: shadeCol(s[0]), weight: 2.8, opacity: 1, interactive: false }).addTo(g));
  } else {""",
  """  if (r.lidar && r.segs) {
    // Uma forma por troco dava 22 mil formas para 133 percursos. Mas o
    // shadeCol so devolve TRES cores, e o contorno e todo da mesma: entao os
    // trocos juntam-se por cor numa polilinha de varias partes. Quatro formas
    // por percurso em vez de cento e setenta, com exactamente o mesmo desenho.
    const porCor = new Map(), todos = [];
    r.segs.forEach((s) => {
      const pts = segPts(s); todos.push(pts);
      const c = shadeCol(s[0]);
      if (!porCor.has(c)) porCor.set(c, []);
      porCor.get(c).push(pts);
    });
    L.polyline(todos, { color: '#0B120D', weight: 5, opacity: .5, interactive: false, casing: true }).addTo(g);
    porCor.forEach((linhas, c) => L.polyline(linhas, { color: c, weight: 2.8, opacity: 1, interactive: false }).addTo(g));
  } else {"""),
]

CONHECIDAS = {'const D = window.__DATA__;'}


def aplica(caminho):
    s = io.open(caminho, encoding='utf-8').read()
    if 'const porCor = new Map(), todos = [];' in s:
        print('  %s: ja estava optimizado' % caminho); return
    for velho, novo in TROCAS:
        if velho not in s:
            sys.exit('PAROU: trecho nao encontrado em %s:\n---\n%s\n---' % (caminho, velho[:160]))
        if s.count(velho) != 1:
            sys.exit('PAROU: trecho aparece %d vezes em %s' % (s.count(velho), caminho))
        s = s.replace(velho, novo, 1)
    io.open(caminho, 'w', encoding='utf-8').write(s)
    print('  %s: %d trechos' % (caminho, len(TROCAS)))


for f in ('fonte/app.js', 'fonte/sombra-na-estrela.html'):
    aplica(f)

a = io.open('fonte/app.js', encoding='utf-8').read().splitlines()
h = set(io.open('fonte/sombra-na-estrela.html', encoding='utf-8').read().splitlines())
falta = [l for l in a if l not in h and l not in CONHECIDAS]
print('linhas do app.js fora do html: %d' % len(falta))
if falta:
    for l in falta[:5]: print('   ' + l[:100])
    sys.exit('PAROU: os dois ficheiros separaram-se.')
print('OK. Agora:  python3 fonte/build_site.py')

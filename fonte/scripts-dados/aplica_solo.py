# -*- coding: utf-8 -*-
"""Liga a correccao da COS, os padroes e as arvores em 3D a aplicacao.

Aplica os mesmos trechos aos DOIS ficheiros -- fonte/app.js e
fonte/sombra-na-estrela.html -- como manda o CLAUDE.md. Se um trecho nao for
encontrado, PARA. Um patch que falha em silencio deixa um ficheiro com a
alteracao e o outro sem ela, e isso descobre-se tarde e mal.

    python3 fonte/scripts-dados/aplica_solo.py
    python3 fonte/build_site.py

E idempotente: correr duas vezes nao faz nada da segunda.
"""
import io, os, sys, json

RAIZ = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
os.chdir(RAIZ)

PADROES = json.load(open('fonte/padroes.json'))
ARVORES = io.open('fonte/arvores3d.js', encoding='utf-8').read()
# o ficheiro tem uma cauda para o node; dentro da pagina nao serve
ARVORES = ARVORES.split("if (typeof module !== 'undefined')")[0].rstrip() + '\n'
assert '</script' not in ARVORES, 'arvores3d.js nao pode conter </script'

BLOCO = """// ---- Ocupacao do solo: o codigo verdadeiro da COS -------------------------
// Os azulejos actuais trazem 'g' calculado com a nomenclatura do CORINE, que
// nao e a da COS: a partir do codigo 3 desliza tudo uma casa e a floresta sai
// como rocha, os matos como agua. Mas esse 'g' errado e uma FUNCAO do codigo
// de nivel 1 da COS, por isso da-se a volta ao contrario e recupera-se o
// codigo verdadeiro -- seis das nove classes voltam ao sitio sem refazer
// azulejo nenhum. As tres que cairam todas em 'outro' (rocha 7, zonas humidas
// 8, agua 9) ja nao se distinguem e so voltam com os azulejos refeitos.
// Quando esses chegarem trazem 'c' e o coalesce passa a preferi-lo sozinho.
// Ver fonte/Solo_e_Arvores.md.
const COD = ['coalesce', ['get', 'c'],
  ['match', ['get', 'g'],
    'urbano', 1, 'agricola', 2, 'floresta', 3, 'matos', 4, 'rocha', 5, 'agua', 6, 0]];
const CC = { 1: '#E6DCD4', 2: '#F0E9D2', 3: '#E8EBCD', 4: '#DCE3C2', 5: '#C5D7B8',
             6: '#DFD9BC', 7: '#E6E3DC', 8: '#CFE0D8', 9: '#A8C9E0' };
const corSolo = () => ['match', COD].concat(...Object.keys(CC).map((k) => [+k, CC[k]])).concat(['#EDE9DE']);
const PADROES = __PADROES__;
const PADCOD = { 5: 'floresta', 4: 'montado', 6: 'matos', 7: 'rocha' };
const camadasPadrao = () => Object.keys(PADCOD).map((k) => ({
  id: 'pad-' + k, type: 'fill', source: 'topo', 'source-layer': 'solo', minzoom: 10.5,
  filter: ['==', COD, +k],
  paint: { 'fill-pattern': 'p-' + PADCOD[k],
    // ao longe o padrao emborrata; ao perto as arvores tomam conta. Por isso
    // desvanece nas duas pontas em vez de estar sempre a mesma forca.
    'fill-opacity': ['interpolate', ['linear'], ['zoom'], 10.5, 0, 12.5, 0.8, 16, 0.8, 17.5, 0.22] } }));
function ligaPadroes(m) {
  m.on('styleimagemissing', (e) => {
    const src = PADROES[e.id.replace('p-', '')];
    if (!src || m.hasImage(e.id)) return;
    const im = new Image();
    im.onload = () => { if (!m.hasImage(e.id)) m.addImage(e.id, im, { pixelRatio: 2 }); };
    im.src = src;
  });
}
__ARVORES__
// Tecto de arvores que se baixa sozinho. Nao ha maneira de eu medir daqui o
// telemovel dele -- entao a pagina mede-se a si propria: se os fotogramas com
// as arvores ligadas passarem de 55 ms (menos de 18 por segundo), corta o
// tecto a metade e guarda a decisao. E a mesma defesa do tecto da DGT, pela
// mesma razao: da ultima vez que eu adivinhei um numero, o download parou.
const ARV_TECTO = 150000;
function arvTecto() {
  let v = 0;
  try { v = +localStorage.getItem('sne-arv-tecto3'); } catch (e) {}
  // chave nova de proposito: o valor que o telemovel dele guardou foi
  // decidido com o codigo velho, que era muito mais pesado, e manteria-o
  // preso em 3 750 arvores para sempre.
  return v >= 20000 && v <= ARV_TECTO ? v : ARV_TECTO;
}
function vigiaArvores() {
  if (!mapT) return;
  mapT.on('moveend', () => {
    if (!ARV || !arvQuer) return;
    const r = ARV.ritmo(), tec = arvTecto();
    if (r == null) return;
    if (r > 55 && tec > 25000) {
      const novo = Math.round(tec / 2);
      try { localStorage.setItem('sne-arv-tecto3', String(novo)); } catch (e) {}
      // baixar o tecto na camada que ja existe. Antes destruia-se e criava-se
      // outra, e por isso o aviso repetia-se de cada vez -- era o que ele
      // estava farto de ver. Uma vez chega: ele ja percebeu.
      ARV.tecto(novo);
      if (!avisoLento) { avisoLento = true; toast('Menos árvores: o telemóvel não estava a acompanhar.'); }
    }
  });
}
// ---- o canvas volta ao tamanho certo sozinho -----------------------------
// Ele apanhou duas vezes o mapa desenhado num quadrado no meio do ecra com
// rastos a volta. Isso e o canvas do MapLibre com um tamanho e a caixa com
// outro: o navegador estica os pixeis da borda para tapar o resto, e sai
// aquilo. Ja ha um ouvinte do 'resize', um do 'fullscreenchange', um
// ResizeObserver e um do visualViewport, e mesmo assim voltou a acontecer.
//
// Entao deixo de tentar adivinhar o gatilho e trato do estado: de meio em
// meio segundo compara-se o que o canvas tem com o que devia ter, e repoe-se.
// Se cinco tentativas seguidas nao resolverem, desiste e diz porque -- ficar
// a redimensionar em ciclo era pior do que o defeito.
let vigiaTam = null, falhasTam = 0;
function tamanhoCerto() {
  if (!mapT || !topoAberto) return true;
  const cv = mapT.getCanvas(); if (!cv) return true;
  const dpr = window.devicePixelRatio || 1;
  const qw = Math.round(innerWidth), qh = Math.round(innerHeight);
  const cw = Math.round(cv.clientWidth), ch = Math.round(cv.clientHeight);
  if (!cw || !ch) return true;
  return Math.abs(cw - qw) <= 2 && Math.abs(ch - qh) <= 2
      && Math.abs(cv.width - Math.round(cw * dpr)) <= 2
      && Math.abs(cv.height - Math.round(ch * dpr)) <= 2;
}
function ligaVigiaTamanho() {
  clearInterval(vigiaTam); falhasTam = 0;
  vigiaTam = setInterval(() => {
    if (!topoAberto || !mapT) { clearInterval(vigiaTam); vigiaTam = null; return; }
    if (tamanhoCerto()) { falhasTam = 0; return; }
    if (++falhasTam > 5) {
      clearInterval(vigiaTam); vigiaTam = null;
      console.warn('mapa topografico: o canvas nao aceita o tamanho da janela');
      return;
    }
    ajustaTopo(); mapT.resize();
  }, 500);
}
// As arvores nao dependem do botao do relevo: vistas de cima sao a mesma
// floresta, e a altitude continua a ler-se pelo sombreado e pelas curvas de
// nivel, que nao se mexem daqui. O botao do relevo so muda se o terreno se
// levanta -- e ai as cotas guardadas por celula deixam de servir.
let ARV = null, avisoArv = false, avisoLento = false, arvQuer = false;
function arvoresTopo(liga) {
  arvQuer = !!liga;
  if (!mapT) return;
  if (!liga) { if (ARV) { try { ARV.desliga(); } catch (e) {} ARV = null; } return; }
  if (ARV) return;
  // Nem 'idle' nem isStyleLoaded(): medido neste mapa, com o relevo ligado o
  // isStyleLoaded() fica em false para sempre e o 'idle' pode nunca chegar --
  // e no entanto o addLayer funciona. Entao tenta-se mesmo, e so se ele
  // recusar e que se espera.
  let tentativas = 0;
  const por = () => {
    if (ARV || !mapT || !arvQuer) return;
    try {
      ARV = ligaArvores(mapT, {
        dist: [300, 900, 2500, 7000], tecto: arvTecto(),
        fundo: [0.87, 0.86, 0.80],
        aoContar: (n) => {
          // dito uma vez, e dito como e: a altura das arvores e modelada da
          // classe da carta, nao medida. Modelado nao passa por medido.
          if (n > 0 && !avisoArv) {
            avisoArv = true;
            toast('Árvores onde a carta diz floresta. A altura é modelada, não medida.');
          }
        },
      });
      mapT.addLayer(ARV.camada);
      ARV.semeia();
      vigiaArvores();
    } catch (e) {
      ARV = null;
      if (++tentativas <= 40) { setTimeout(por, 250); return; }
      console.error('arvores:', e && (e.stack || e.message || e));
    }
  };
  por();
}
"""

TROCAS = [
 # 1. o bloco novo, mesmo antes do estado do mapa topografico
 ("let mapT = null, topoAberto = false, topoRelevo = false, pmProto = null, topoMarks = [];",
  BLOCO + "let mapT = null, topoAberto = false, topoRelevo = false, pmProto = null, topoMarks = [];"),

 # 2. o solo passa a pintar-se pelo codigo, e ganha os padroes por cima
 ("""      { id: 'solo', type: 'fill', source: 'topo', 'source-layer': 'solo',
        paint: { 'fill-color': ['match', ['get', 'g'], 'floresta', CS.floresta, 'matos', CS.matos, 'rocha', CS.rocha, 'agricola', CS.agricola, 'urbano', CS.urbano, 'agua', CS.agua, CS.outro], 'fill-opacity': 0.9 } },""",
  """      { id: 'solo', type: 'fill', source: 'topo', 'source-layer': 'solo',
        paint: { 'fill-color': corSolo(), 'fill-opacity': 0.92 } },
      ...camadasPadrao(),"""),

 # 3. carregar os padroes quando o estilo os pedir, e apanhar as mudancas de
 #    tamanho que nao passam por 'resize' nem por 'fullscreenchange'
 ("    mapT.on('click', (e) => topoClique(e));",
  """    ligaPadroes(mapT);
    // O canvas do MapLibre nao se redimensiona sozinho, e nem todas as
    // mudancas de tamanho disparam 'resize' ou 'fullscreenchange': no
    // telemovel as barras do browser aparecem e desaparecem sem disparar
    // nenhum dos dois, e o mapa fica desenhado num quadrado no meio do ecra
    // com rastos a volta. Estes dois apanham a mudanca venha ela de onde vier.
    {
      let rq = null;
      const reajusta = () => { clearTimeout(rq); rq = setTimeout(() => {
        if (mapT && topoAberto) { ajustaTopo(); mapT.resize(); } }, 80); };
      if (window.visualViewport) visualViewport.addEventListener('resize', reajusta);
      if (typeof ResizeObserver === 'function') new ResizeObserver(reajusta).observe(document.body);
    }
    mapT.on('click', (e) => topoClique(e));"""),

 # 4. arvores enquanto o mapa topografico estiver aberto, com ou sem 3D
 ("  document.getElementById('btn-relevo').hidden = false;",
  "  document.getElementById('btn-relevo').hidden = false;\n  arvoresTopo(true);\n  ligaVigiaTamanho();"),
 ("  document.getElementById('btn-relevo').hidden = true;",
  "  document.getElementById('btn-relevo').hidden = true;\n  arvoresTopo(false);\n  clearInterval(vigiaTam); vigiaTam = null;"),

 # 5. o botao do relevo continua a mandar no terreno -- e as cotas guardadas
 #    por celula valem para um estado do relevo, nao para os dois
 ("""  if (topoRelevo) { mapT.setTerrain({ source: 'dem', exaggeration: 1.25 }); mapT.easeTo({ pitch: 58, duration: 600 }); }
  else { mapT.setTerrain(null); mapT.easeTo({ pitch: 0, bearing: 0, duration: 600 }); }""",
  """  if (topoRelevo) { mapT.setTerrain({ source: 'dem', exaggeration: 1.25 }); mapT.easeTo({ pitch: 58, duration: 600 }); }
  else { mapT.setTerrain(null); mapT.easeTo({ pitch: 0, bearing: 0, duration: 600 }); }
  if (ARV) ARV.esquece();"""),
]


def aplica(caminho):
    s = io.open(caminho, encoding='utf-8').read()
    if 'const PADCOD' in s:
        print('  %s: ja estava ligado' % caminho)
        return 0
    n = 0
    for velho, novo in TROCAS:
        if velho not in s:
            sys.exit('PAROU: trecho nao encontrado em %s:\n---\n%s\n---' % (caminho, velho[:220]))
        if s.count(velho) != 1:
            sys.exit('PAROU: trecho aparece %d vezes em %s' % (s.count(velho), caminho))
        s = s.replace(velho, novo, 1)
        n += 1
    s = s.replace('__PADROES__', json.dumps(PADROES, separators=(',', ':')), 1)
    s = s.replace('__ARVORES__', ARVORES, 1)
    io.open(caminho, 'w', encoding='utf-8').write(s)
    print('  %s: %d trechos, %.0f KB' % (caminho, n, os.path.getsize(caminho) / 1024))
    return n


for f in ('fonte/app.js', 'fonte/sombra-na-estrela.html'):
    aplica(f)

# O app.js tem de continuar a ser o MESMO javascript que esta dentro do html.
# Ha uma unica diferenca legitima e ela e antiga: o app.js le os dados de
# window.__DATA__, enquanto no html eles estao em linha. Qualquer OUTRA
# diferenca quer dizer que um patch apanhou um ficheiro e nao o outro.
CONHECIDAS = {'const D = window.__DATA__;'}
a = io.open('fonte/app.js', encoding='utf-8').read().splitlines()
h = set(io.open('fonte/sombra-na-estrela.html', encoding='utf-8').read().splitlines())
falta = [l for l in a if l not in h and l not in CONHECIDAS]
print('linhas do app.js fora do html (tirando a diferenca conhecida): %d' % len(falta))
for l in falta[:5]:
    print('   ' + l[:100])
if falta:
    sys.exit('PAROU: os dois ficheiros separaram-se.')
print('OK. Agora:  python3 fonte/build_site.py')

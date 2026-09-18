import json,os,re,shutil,glob
# Monta o site. Correr a partir da raiz do repositorio:  python3 fonte/build_site.py
# As fontes estao em fonte/ ; o resultado vai para a raiz (= raiz do site publicado).
import os as _os
_RAIZ = _os.path.dirname(_os.path.dirname(_os.path.abspath(__file__)))
_os.chdir(_RAIZ)
SITE=_RAIZ
def cp(a,b):
    if os.path.exists(b) and os.path.getsize(b)==os.path.getsize(a): return
    shutil.copy(a,b)
os.makedirs(SITE+'/dados/det',exist_ok=True); os.makedirs(SITE+'/orto',exist_ok=True)
h=open('fonte/sombra-na-estrela.html',encoding='utf-8').read()
import datetime as _dt
h=h.replace('__VERSAO__', _dt.datetime.now().strftime('%d/%m %H:%M'))
m={}
# As pastas de dados intermedios (ortofull/, det40/, s2/, d3/, vec/) so existiram na
# sessao na nuvem que gerou os dados. Sem elas, os resultados ja publicados em
# dados/, orto/ e no index.html anterior servem de fonte para as correspondencias.
DADOS_LOCAIS = os.path.isdir('ortofull') and os.path.isdir('det40')
INDEX_ANTIGO = open(SITE+'/index.html',encoding='utf-8').read() if os.path.exists(SITE+'/index.html') else ''
if not DADOS_LOCAIS:
    if not INDEX_ANTIGO: raise SystemExit('sem ortofull/ nem index.html anterior: nao ha como resolver os blobs')
    print('sem pastas de dados: a reaproveitar correspondencias do index.html publicado')
# ortofotos
if DADOS_LOCAIS:
    of=json.load(open('ortofull/assets.json'))
    for fn,url in of.items():
        m[url]='orto/'+fn; cp('ortofull/'+fn, SITE+'/orto/'+fn)
else:
    # emparelha cada blob de __ORTHO__ com o ficheiro orto/ do index.html pela caixa de coordenadas
    def orto_idx(txt, chave):
        seg=re.search(r'window\.__ORTHO__=\[(.*?)\];', txt, re.S).group(1)
        return {bb: nome for nome, bb in re.findall(r'\["('+chave+r')",(\[\[[-0-9.,]+\],\[[-0-9.,]+\]\])\]', seg)}
    de=orto_idx(h, r'/_blob/[0-9a-f]{32}'); para=orto_idx(INDEX_ANTIGO, r'orto/of_-?\d+_-?\d+\.webp')
    for bb,url in de.items():
        if bb not in para: raise SystemExit('ortofoto sem correspondencia no index.html: '+url+' '+bb)
        m[url]=para[bb]
        if not os.path.exists(SITE+'/'+para[bb]): print('AVISO: falta', para[bb])
    print('ortofotos resolvidas',len(m))
# detalhe
import math
def m2ll(x,y):
    lon=x/20037508.34*180.0
    lat=math.degrees(2*math.atan(math.exp(y/20037508.34*math.pi))-math.pi/2)
    return lat,lon
DETIDX=[]
if DADOS_LOCAIS:
    for f in sorted(glob.glob('det40/*.webp')):
        fn=os.path.basename(f)
        mm=re.match(r'd_(-?\d+)_(-?\d+)\.webp',fn); x=int(mm.group(1)); y=int(mm.group(2))
        s0,w0=m2ll(x,y); n0,e0=m2ll(x+1280,y+1280)
        DETIDX.append([round(s0,5),round(w0,5),round(n0,5),round(e0,5),fn])
        cp(f, SITE+'/dados/det/'+fn)
else:
    DETIDX=json.loads(re.search(r'window\.__DET__=(\[.*?\]);', INDEX_ANTIGO, re.S).group(1))
    faltam=[t[4] for t in DETIDX if not os.path.exists(SITE+'/dados/det/'+t[4])]
    if faltam: print('AVISO: faltam',len(faltam),'imagens de detalhe, ex.',faltam[:3])
print('det tiles',len(DETIDX))
# outros
m['/_blob/e60c51a172252278e9f49eb929ab53c2']='dados/rede.json'
m['/_blob/c297698b506811ad317814ae35dd2998']='dados/osm.json'
m['/_blob/bbb0be3a812c34296b0abe310453249c']='dados/fundo.jpg'
m['/_blob/61db3f421f32c3a31441a99ea7f0c42d']='dados/dem.webp'
def copia_se_existe(a,b,arvore=False):
    if not os.path.exists(a): return
    if arvore: shutil.copytree(a,b,dirs_exist_ok=True)
    else: shutil.copy(a,b)
copia_se_existe('rede.json',SITE+'/dados/rede.json')
copia_se_existe('s2/osm_enc_v2.json',SITE+'/dados/osm.json')
copia_se_existe('s2/fundo_3857_40m.jpg',SITE+'/dados/fundo.jpg')
copia_se_existe('d3/dem_terrarium.webp',SITE+'/dados/dem.webp')
copia_se_existe('fonte/sat',SITE+'/sat',True); copia_se_existe('fonte/lib',SITE+'/lib',True)
copia_se_existe('node_modules/leaflet/dist/leaflet.js', SITE+'/lib/leaflet.js')
copia_se_existe('fonte/icons', SITE+'/icons',True)
copia_se_existe('fonte/glifos', SITE+'/glifos',True)
if os.path.exists('vec/topo.pmtiles'): cp('vec/topo.pmtiles', SITE+'/dados/topo.pmtiles')
for obrig in ['dados/rede.json','dados/osm.json','dados/fundo.jpg','dados/dem.webp','dados/topo.pmtiles','lib/leaflet.js','lib/pmtiles.js','lib/maplibre-gl-csp.js','lib/maplibre-gl-csp-worker.js']:
    if not os.path.exists(SITE+'/'+obrig): raise SystemExit('falta ficheiro obrigatorio: '+obrig)
shutil.copy('fonte/sw.js', SITE+'/sw.js')
h=h.replace('src="https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.9.4/leaflet.js"','src="lib/leaflet.js"')

# ---- detalhe: imagens soltas em vez de blocos JSON de 9 MB ----
h=re.sub(r'window\.__DET__=\[.*?\];', 'window.__DET__='+json.dumps(DETIDX,separators=(',',':'))+';', h, count=1, flags=re.S)

OLD_LOADDET = """const DET = window.__DET__ || []; const dLoaded = new Set(); const detGroup = L.layerGroup().addTo(map);
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
}"""
NEW_LOADDET = """const DET = window.__DET__ || []; const DETB = 'dados/det/'; const dLoaded = new Map(); const detGroup = L.layerGroup().addTo(map);
const detBounds = (t) => L.latLngBounds([t[0], t[1]], [t[2], t[3]]);
function loadDet() {
  const z = map.getZoom();
  if (z < 15) { if (dLoaded.size) { detGroup.clearLayers(); dLoaded.clear(); } return; }
  const keep = map.getBounds().pad(0.7);
  dLoaded.forEach((ov, i) => { if (!keep.intersects(ov.getBounds())) { detGroup.removeLayer(ov); dLoaded.delete(i); } });
  const vb = map.getBounds().pad(0.15);
  for (let i = 0; i < DET.length; i++) {
    if (dLoaded.has(i)) continue;
    const t = DET[i], b = detBounds(t);
    if (!vb.intersects(b)) continue;
    if (dLoaded.size >= 30) break;
    const ov = L.imageOverlay(DETB + t[4], b, { interactive: false, pane: 'detP', opacity: 1 });
    ov.addTo(detGroup); dLoaded.set(i, ov);
  }
}"""
# Estas tres reescritas so fazem sentido enquanto a aplicacao tiver fotografia
# de satelite. Depois do sem_satelite.py o codigo original deixa de la estar, e
# entao nao ha nada para reescrever -- avisa-se e segue-se, em vez de rebentar.
SEM_SAT = 'dados/relevo.jpg' in h
if OLD_LOADDET in h: h=h.replace(OLD_LOADDET,NEW_LOADDET)
elif not SEM_SAT: raise SystemExit('build: loadDet nao encontrado e a aplicacao ainda tem satelite')
else: print('sem satelite: loadDet nao precisa de reescrita')

OLD_B3 = """const detTiles3 = new Map();
function detBundle3(i) {
  if (!detTiles3.has(i)) detTiles3.set(i, fetch(DET[i][0]).then((r) => r.json()).then((j) => j.t.map(([s, w, n, e, d]) => ['data:image/webp;base64,' + d, [[s, w], [n, e]]])).catch(() => []));
  return detTiles3.get(i);
}"""
NEW_B3 = """function det3(LB) { return DET.filter((t) => LB.intersects(detBounds(t))).slice(0, 20).map((t) => [DETB + t[4], [[t[0], t[1]], [t[2], t[3]]]]); }"""
if OLD_B3 in h: h=h.replace(OLD_B3,NEW_B3)
elif not SEM_SAT: raise SystemExit('build: detBundle3 nao encontrado e a aplicacao ainda tem satelite')

OLD_IDS = """const ids = DET.map((d, i) => d[1].some((b) => LB.intersects(L.latLngBounds(b))) ? i : -1).filter((i) => i >= 0); layers.push((await Promise.all(ids.map(detBundle3))).flat()); }"""
NEW_IDS = """layers.push(det3(LB)); }"""
if OLD_IDS in h: h=h.replace(OLD_IDS,NEW_IDS)
elif not SEM_SAT: raise SystemExit('build: o recorte do detalhe nao foi encontrado e a aplicacao ainda tem satelite')


for k,v in m.items(): h=h.replace(k,v)
left=re.findall(r'/_blob/[0-9a-f]{32}',h)
print('blobs por resolver',len(set(left)),list(set(left))[:3])
if left: raise SystemExit('ha blobs por resolver: o site ficaria com recursos partidos')
# ---- adaptações para site autónomo ----
# 1) GPX/zip sem a capability downloads
h=h.replace("const downloadsP = (window.claude && claude.use) ? claude.use('downloads') : Promise.resolve(null);",
            "const downloadsP = Promise.resolve({ save: async ({ filename, data }) => { const a = document.createElement('a'); a.href = URL.createObjectURL(data instanceof Blob ? data : new Blob([data])); a.download = filename; document.body.appendChild(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(a.href), 30000); return { status: 'saved' }; } });")
# 2) tempo: buscar ao IPMA em direto
old_db = "const dbP = (window.claude && claude.use) ? claude.use('db') : Promise.resolve(null);"
new_db = "const dbP = Promise.resolve(null);"
h=h.replace(old_db,new_db)
old_load = "dbP.then(async (db) => { if (!db) return; try { const s = await db.doc('tempo/previsao').get(); TEMPO = s && (s.data ? s.data() : s); if (selected) { const el = document.getElementById('wx'); if (el) el.outerHTML = weatherBlock(selected); } } catch (e) {} });"
new_load = """const IPMA = { 1050100: ['Belmonte', 604, 'CBO'], 1050300: ['Covilhã', 561, 'CBO'], 1050400: ['Fundão', 501, 'CBO'], 1050700: ['Penamacor', 538, 'CBO'], 1060100: ['Arganil', 169, 'CBR'], 1061100: ['Oliveira do Hospital', 496, 'CBR'], 1061200: ['Pampilhosa da Serra', 712, 'CBR'], 1090300: ['Celorico da Beira', 509, 'GDA'], 1090500: ['Fornos de Algodres', 501, 'GDA'], 1090600: ['Gouveia', 659, 'GDA'], 1090700: ['Guarda', 988, 'GDA'], 1090800: ['Manteigas', 760, 'GDA'], 1091100: ['Sabugal', 780, 'GDA'], 1091200: ['Seia', 555, 'GDA'] };
async function loadTempo(id) {
  if (!id || !IPMA[id]) return;
  TEMPO = TEMPO || { locais: {}, avisos: {}, atualizado: null };
  if (TEMPO.locais[id]) return;
  try {
    const r = await fetch('https://api.ipma.pt/public-data/forecast/aggregate/' + id + '.json');
    const j = await r.json();
    const dias = j.filter((x) => x.idPeriodo === 24 && x.tMin != null && x.tMax != null).map((x) => ({ d: String(x.dataPrev).slice(0, 10), tmin: +x.tMin, tmax: +x.tMax, tipo: +x.idTipoTempo, prob: +(x.probabilidadePrecipita || 0), vento: +(x.idFfxVento || 0), dir: x.ddVento || '', uv: x.iUv ? +x.iUv : null }));
    const [nome, alt, aviso] = IPMA[id];
    TEMPO.locais[id] = { nome, alt, aviso, dias };
    TEMPO.atualizado = (j[0] && j[0].dataUpdate) || new Date().toISOString();
    if (!TEMPO.avisos[aviso]) {
      try {
        const w = await (await fetch('https://api.ipma.pt/open-data/forecast/warnings/warnings_www.json')).json();
        ['GDA', 'CBO', 'CBR'].forEach((a) => { TEMPO.avisos[a] = w.filter((x) => x.idAreaAviso === a && new Date(x.endTime) > new Date()).map((x) => ({ tipo: x.awarenessTypeName, nivel: x.awarenessLevelID, inicio: x.startTime, fim: x.endTime, texto: x.text })); });
      } catch (e) { TEMPO.avisos[aviso] = []; }
    }
    if (selected && selected.wx === id) { const el = document.getElementById('wx'); if (el) el.outerHTML = weatherBlock(selected); }
  } catch (e) {}
}"""
assert old_load in h
h=h.replace(old_load,new_load)
h=h.replace("  $('sheet').scrollTop = 0; $('sheet').classList.remove('peek');","  loadTempo(r.wx);\n  $('sheet').scrollTop = 0; $('sheet').classList.remove('peek');")
# 3) título e rodapé
h=h.replace('<title>Caminhos da Estrela</title>','<title>Caminhos da Estrela</title>\n<meta name="theme-color" content="#1C2118">\n<link rel="manifest" href="manifest.json">\n<link rel="icon" href="icons/favicon.png" type="image/png">\n<link rel="apple-touch-icon" href="icons/icon-192.png">')
open(SITE+'/index.html','w',encoding='utf-8').write(
 '<!doctype html>\n<html lang="pt"><head>\n<meta charset="utf-8">\n<meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover">\n<style>:root{color-scheme:light dark;padding-top:env(safe-area-inset-top,0);padding-bottom:env(safe-area-inset-bottom,0)}html,body{height:100%}body{margin:0;font:14px/1.45 system-ui,sans-serif;background:#EEF0E9}img{max-width:100%}[hidden]{display:none!important}</style>\n'
 + h + '\n</body></html>\n')
json.dump({"name":"Caminhos da Estrela","short_name":"Caminhos","start_url":".","display":"standalone","background_color":"#1C2118","theme_color":"#1C2118","icons":[{"src":"icons/icon-192.png","sizes":"192x192","type":"image/png"},{"src":"icons/icon-512.png","sizes":"512x512","type":"image/png","purpose":"any"}]},open(SITE+'/manifest.json','w'))
shutil.copy('fonte/teste.html', SITE+'/teste.html')
open(SITE+'/.nojekyll','w').write('')
tot=sum(os.path.getsize(os.path.join(r,f)) for r,_,fs in os.walk(SITE) for f in fs)
print('site MB',round(tot/1e6,1),'ficheiros',sum(len(fs) for _,_,fs in os.walk(SITE)))

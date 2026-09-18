import json, os, math

def escreve(path, feats):
    with open(path, 'w') as f:
        f.write('{"type":"FeatureCollection","features":[\n')
        for i, ft in enumerate(feats):
            f.write(json.dumps(ft, separators=(',', ':')))
            f.write(',\n' if i < len(feats)-1 else '\n')
        f.write(']}')
    print(os.path.basename(path), len(feats), 'feats', round(os.path.getsize(path)/1e6, 1), 'MB')

# ---------- caminhos: todos os tipos de via ----------
TIPO = {}
for k in ('path','footway','bridleway','steps'): TIPO[k]='trilho'
TIPO['track']='estradao'
for k in ('service','unclassified','road','residential','living_street'): TIPO[k]='caminho'
for k in ('tertiary','tertiary_link','secondary','secondary_link'): TIPO[k]='estrada'
for k in ('primary','primary_link','trunk','trunk_link','motorway','motorway_link'): TIPO[k]='nacional'
TIPO['cycleway']='trilho'

j = json.load(open('/mnt/user-data/uploads/Downloads/sne-dados/osm_estrela.json'))
cam = []
for e in j['elements']:
    tg = e.get('tags') or {}
    t = TIPO.get(tg.get('highway'))
    g = e.get('geometry')
    if not t or not g or len(g) < 2: continue
    props = {'t': t}
    if tg.get('name'): props['n'] = tg['name'][:60]
    sup = tg.get('surface')
    if sup: props['s'] = sup[:16]
    if tg.get('sac_scale'): props['d'] = tg['sac_scale'][:16]
    cam.append({'type':'Feature','properties':props,
                'geometry':{'type':'LineString','coordinates':[[round(p['lon'],5),round(p['lat'],5)] for p in g]}})
escreve('vec/caminhos.geojson', cam)

# ---------- agua ----------
ja = json.load(open('/mnt/user-data/uploads/Downloads/sne-dados/agua.json'))
linhas, areas = [], []
for e in ja['elements']:
    tg = e.get('tags') or {}
    g = e.get('geometry')
    if not g or len(g) < 2: continue
    co = [[round(p['lon'],5),round(p['lat'],5)] for p in g if p.get('lat') is not None]
    if len(co) < 2: continue
    nome = tg.get('name','')[:60]
    if tg.get('natural') == 'water' or tg.get('landuse') == 'reservoir':
        if co[0] != co[-1]: co = co + [co[0]]
        if len(co) < 4: continue
        areas.append({'type':'Feature','properties':{'n':nome} if nome else {},
                      'geometry':{'type':'Polygon','coordinates':[co]}})
    else:
        w = tg.get('waterway','')
        if w in ('river','stream','canal','ditch','drain','brook'):
            p = {'w': w}
            if nome: p['n'] = nome
            linhas.append({'type':'Feature','properties':p,'geometry':{'type':'LineString','coordinates':co}})
escreve('vec/agua_linha.geojson', linhas)
escreve('vec/agua_area.geojson', areas)

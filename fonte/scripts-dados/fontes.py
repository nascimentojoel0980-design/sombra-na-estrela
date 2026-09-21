# -*- coding: utf-8 -*-
"""Le as fontes de origem guardadas no repositorio sne-dados-fonte.

Porque existe (20/09/2026): a carta de classes vinha de azulejos onde as
classes 7, 8 e 9 da COS tinham caido num saco so ('outro'), e as casas vinham
do OSM, que em Manteigas tem 1 edificio em 5. As fontes certas -- COS 2025
Serie 2 e os contornos da Microsoft + OSM -- estao recortadas a AREA TODA do
mapa (-8.27 39.89 -7.07 40.80) em folhas de 0,3 graus. Este ficheiro so sabe
abrir essas folhas e devolver o que cai numa caixa; nao interpreta nada.

  cos_poligonos(pasta, caixa)   -> (n1, n3, aneis em graus) por poligono
  casas_poligonos(pasta, caixa) -> (fonte, altura_m ou None, anel exterior em graus)

Nao precisa de shapely nem de GDAL: le o GeoPackage com sqlite3, desmonta o
WKB a mao e projecta 3763 -> 4326 com o rasterio (que ja e obrigatorio).
"""
import os, json, sqlite3, struct, glob
import numpy as np
from rasterio.warp import transform as _tr

FOLHA = 0.3
ORIG = (-8.27, 39.89)


def folhas(pasta, prefixo, ext, caixa):
    """nomes das folhas de 0,3 graus que tocam a caixa (as que existem)"""
    lo0, la0, lo1, la1 = caixa
    out = []
    for f in sorted(glob.glob(os.path.join(pasta, prefixo + '_*_*.' + ext))):
        try:
            _, slo, sla = os.path.basename(f)[:-len(ext) - 1].rsplit('_', 2)
            flo, fla = float(slo), float(sla)
        except ValueError:
            continue
        if flo < lo1 and flo + FOLHA > lo0 and fla < la1 and fla + FOLHA > la0:
            out.append(f)
    return out


def _wkb_aneis(b, off):
    """devolve (lista de aneis [(x,y),...] em coordenadas nativas, novo offset)"""
    le = b[off]; E = '<' if le else '>'
    t = struct.unpack_from(E + 'I', b, off + 1)[0]; off += 5
    if t & 0x20000000: off += 4                       # SRID embutido (EWKB)
    tipo = t & 0xFF
    dim = {0: 2, 1: 3, 2: 3, 3: 4}[(t & 0xFFFF) // 1000]   # XY, XYZ, XYM, XYZM
    aneis = []
    if tipo == 3:                                      # Polygon
        n = struct.unpack_from(E + 'I', b, off)[0]; off += 4
        for _ in range(n):
            m = struct.unpack_from(E + 'I', b, off)[0]; off += 4
            a = np.frombuffer(b, dtype=E + 'f8', count=m * dim, offset=off).reshape(m, dim)
            off += m * dim * 8
            aneis.append(a[:, :2])
    elif tipo == 6:                                    # MultiPolygon
        n = struct.unpack_from(E + 'I', b, off)[0]; off += 4
        for _ in range(n):
            sub, off = _wkb_aneis(b, off)
            aneis += sub
    else:
        raise ValueError('WKB tipo %d nao tratado' % tipo)
    return aneis, off


def _gpkg_aneis(blob):
    assert blob[:2] == b'GP', 'nao e geometria GeoPackage'
    flags = blob[3]
    env = {0: 0, 1: 32, 2: 48, 3: 48, 4: 64}[(flags >> 1) & 7]
    aneis, _ = _wkb_aneis(blob, 8 + env)
    return aneis


def _para_graus(aneis, epsg):
    if epsg == 4326: return [[(float(x), float(y)) for x, y in a] for a in aneis]
    tam = [len(a) for a in aneis]
    X = np.concatenate([a[:, 0] for a in aneis]); Y = np.concatenate([a[:, 1] for a in aneis])
    lo, la = _tr('EPSG:%d' % epsg, 'EPSG:4326', X.tolist(), Y.tolist())
    out, k = [], 0
    for n in tam:
        out.append(list(zip(lo[k:k + n], la[k:k + n]))); k += n
    return out


def cos_poligonos(pasta, caixa):
    """COS 2025 Serie 2: (n1 digito 1..9, n3 codigo, aneis em graus).
    Poligonos cortados na fronteira de duas folhas aparecem em ambas -- para
    pintar tanto faz, pintam-se os dois pedacos no mesmo sitio."""
    lo0, la0, lo1, la1 = caixa
    fs = folhas(os.path.join(pasta, 'cos2025'), 'cos2025', 'gpkg', caixa)
    if not fs:
        raise SystemExit('COS: nenhuma folha em %s toca a caixa' % pasta)
    n = 0
    for f in fs:
        c = sqlite3.connect(f)
        (tab, srs), = c.execute('select table_name, srs_id from gpkg_contents where data_type=\'features\'').fetchall()
        # caixa em coordenadas nativas, com folga, para usar a rtree
        xs, ys = _tr('EPSG:4326', 'EPSG:%d' % srs,
                     [lo0, lo1, lo0, lo1], [la0, la0, la1, la1])
        q = ('select t.cos25v1_n1_c, t.cos25v1_n3_c, t.geom from %s t, rtree_%s_geom r '
             'where t.fid = r.id and r.maxx >= ? and r.minx <= ? and r.maxy >= ? and r.miny <= ?'
             % (tab, tab))
        for n1, n3, g in c.execute(q, (min(xs) - 50, max(xs) + 50, min(ys) - 50, max(ys) + 50)):
            aneis = _para_graus(_gpkg_aneis(g), srs)
            a0 = np.array(aneis[0])
            if a0[:, 0].max() < lo0 or a0[:, 0].min() > lo1 or a0[:, 1].max() < la0 or a0[:, 1].min() > la1:
                continue                               # a rtree tem folga; isto e o corte certo
            n += 1
            yield int(str(n1).strip()[0]), int(n3), aneis
        c.close()
    if not n:
        raise SystemExit('COS: as folhas existem mas nenhum poligono cai na caixa')


def casas_poligonos(pasta, caixa):
    """Microsoft + OSM: (fonte, altura em m ou None, anel exterior em graus)."""
    lo0, la0, lo1, la1 = caixa
    fs = folhas(os.path.join(pasta, 'edificios'), 'edificios', 'geojson', caixa)
    if not fs:
        raise SystemExit('edificios: nenhuma folha em %s toca a caixa' % pasta)
    for f in fs:
        with open(f, encoding='utf-8') as fh:
            for lin in fh:
                lin = lin.strip().rstrip(',')
                if not lin.startswith('{"type":"Feature"'): continue
                ft = json.loads(lin)
                g = ft['geometry']; p = ft.get('properties') or {}
                polys = [g['coordinates']] if g['type'] == 'Polygon' else g['coordinates']
                h = p.get('height')
                h = float(h) if h is not None and float(h) > 0 else None
                for poly in polys:
                    anel = poly[0]
                    xs = [x for x, _ in anel]; ys = [y for _, y in anel]
                    if max(xs) < lo0 or min(xs) > lo1 or max(ys) < la0 or min(ys) > la1: continue
                    yield p.get('fonte', '?'), h, [(float(x), float(y)) for x, y in anel]


# ------------------------------------------------------------ rasters em folhas
# Os derivados do LiDAR vivem no armazem em folhas de 0,3 graus (PLANO.md):
#   lidar-derivado/mdt8/mdt8_<lon>_<lat>.tif   int16 decimetros, nodata -32768
#   lidar-derivado/chm5/chm5_<lon>_<lat>.tif   uint8  decimetros, 254 = sem dado
# Isto cola as folhas que tocam a caixa num raster so, em metros, com a mesma
# saida de le_mdt() do cozedor: (array float32 linha 0 = norte, (l, b, r, t)).
RASTER = {
    'mdt8': dict(pasta='lidar-derivado/mdt8', escala=0.1, nodata=(-32768,)),
    'chm5': dict(pasta='lidar-derivado/chm5', escala=0.1, nodata=(254, 255)),
    # rugosidade do MDT-2m (RMS do residuo, cm): campos de blocos; ferramentas/lidar_rugosidade.py
    'rug8': dict(pasta='lidar-derivado/rug8', escala=0.01, nodata=(254, 255)),
    # agua mensal Sentinel-2: 1 agua, 0 nao, 255 nuvem/sem dado (um por mes)
    'agua': dict(pasta='sentinel/agua-mensal', escala=1.0, nodata=(255,)),
}


def ha_raster(pasta, produto, caixa, prefixo=None):
    e = RASTER[produto]
    return bool(folhas(os.path.join(pasta, e['pasta']), prefixo or produto, 'tif', caixa))


def raster_mosaico(pasta, produto, caixa, margem_celulas=3, prefixo=None, preenche='mediana'):
    """preenche: 'mediana' (buracos pequenos, como le_mdt) ou 'minimo' (para o
    horizonte: fora da area de construcao nao se inventa monte nenhum)."""
    import rasterio
    from rasterio.windows import from_bounds as janela
    e = RASTER[produto]
    fs = folhas(os.path.join(pasta, e['pasta']), prefixo or produto, 'tif', caixa)
    if not fs:
        raise SystemExit('%s: nenhuma folha em %s toca a caixa' % (prefixo or produto, pasta))
    lo0, la0, lo1, la1 = caixa
    # grelha alvo: a da primeira folha (todas tem de ter o mesmo passo e estar
    # alinhadas -- e a regra do armazem, e confere-se)
    with rasterio.open(fs[0]) as r0:
        dx, dy = r0.transform.a, -r0.transform.e
        ox, oy = r0.transform.c, r0.transform.f
        assert r0.crs is None or r0.crs.to_epsg() == 4326, '%s nao esta em graus' % fs[0]
    m = margem_celulas
    i0 = int(np.floor((lo0 - ox) / dx)) - m; i1 = int(np.ceil((lo1 - ox) / dx)) + m
    j0 = int(np.floor((oy - la1) / dy)) - m; j1 = int(np.ceil((oy - la0) / dy)) + m
    W, H = i1 - i0, j1 - j0
    Z = np.full((H, W), np.nan, np.float32)
    l = ox + i0 * dx; t = oy - j0 * dy; r_ = ox + i1 * dx; b = oy - j1 * dy
    for f in fs:
        with rasterio.open(f) as r:
            assert abs(r.transform.a - dx) < 1e-12 and abs(-r.transform.e - dy) < 1e-12, \
                'passo diferente entre folhas: ' + f
            # alinhamento: a origem desta folha cai numa celula inteira da grelha alvo
            kx = (r.transform.c - ox) / dx; ky = (oy - r.transform.f) / dy
            assert abs(kx - round(kx)) < 1e-6 and abs(ky - round(ky)) < 1e-6, \
                'folha desalinhada: ' + f
            # janela desta folha que cai no alvo
            fl = max(l, r.bounds.left); fr = min(r_, r.bounds.right)
            fb = max(b, r.bounds.bottom); ft = min(t, r.bounds.top)
            if fr <= fl or ft <= fb: continue
            w = janela(fl, fb, fr, ft, r.transform).round_offsets().round_lengths()
            a = r.read(1, window=w).astype(np.float32)
            for nd in e['nodata']: a[a == nd] = np.nan
            if r.nodata is not None: a[a == r.nodata] = np.nan
            ci = int(round((fl - l) / dx)); cj = int(round((t - ft) / dy))
            hh, ww = a.shape
            Z[cj:cj + hh, ci:ci + ww] = np.where(np.isnan(Z[cj:cj + hh, ci:ci + ww]),
                                                 a * e['escala'], Z[cj:cj + hh, ci:ci + ww])
    if np.isnan(Z).all():
        raise SystemExit('%s: as folhas existem mas nao tem dados na caixa' % (prefixo or produto))
    if preenche is not None and np.isnan(Z).any():
        v = np.nanmedian(Z) if preenche == 'mediana' else float(np.nanmin(Z))
        Z = np.where(np.isnan(Z), v, Z)
    return Z, (l, b, r_, t)


def agua_permanente(pasta, caixa, minimo=0.75, meses_min=6):
    """Agua que esta la o ano inteiro, a partir dos 12 meses de NDWI de 2024.
    Um mes so (Julho) apanha sombra de encosta e lagoas cheias por acaso; a
    persistencia nao. Celula = agua se, dos meses com dado (>= meses_min),
    pelo menos `minimo` a viram como agua. Devolve (0/1 float32, caixa) como
    le_mdt, mais a lista de meses usados."""
    vistos = None; agua = None; cx = None; meses = []
    for m in range(1, 13):
        pref = 'agua_2024-%02d' % m
        if not ha_raster(pasta, 'agua', caixa, pref): continue
        Z, cx = raster_mosaico(pasta, 'agua', caixa, prefixo=pref, preenche=None)
        ok = ~np.isnan(Z)
        if vistos is None:
            vistos = np.zeros(Z.shape, np.int16); agua = np.zeros(Z.shape, np.int16)
        vistos += ok; agua += (ok & (Z > 0.5))
        meses.append(pref[-2:])
    if vistos is None:
        raise SystemExit('agua mensal: nenhuma folha toca a caixa')
    frac = np.where(vistos >= meses_min, agua / np.maximum(vistos, 1), 0.0)
    return (frac >= minimo).astype(np.float32), cx, meses


# ------------------------------------------------------------------ vias OSM
# osm-vias/vias_<lon>_<lat>.geojson: ways do OSM com a classe ORIGINAL
# (highway), por folha de 0,3 graus, ways inteiras (repetidas entre folhas:
# dedup pelo id). Propriedades: id, h, ref, n, s, tt, d, oneway.
def vias(pasta, caixa):
    """(h, s, ref, linha [(lon,lat),...]) por way que toca a caixa, sem repetidos."""
    lo0, la0, lo1, la1 = caixa
    fs = folhas(os.path.join(pasta, 'osm-vias'), 'vias', 'geojson', caixa)
    vistos = set()
    for f in fs:
        with open(f, encoding='utf-8') as fh:
            for lin in fh:
                lin = lin.strip().rstrip(',')
                if not lin.startswith('{"type":"Feature"'): continue
                ft = json.loads(lin); p = ft.get('properties') or {}
                if p.get('id') in vistos: continue
                cs = ft['geometry']['coordinates']
                xs = [c[0] for c in cs]; ys = [c[1] for c in cs]
                if max(xs) < lo0 or min(xs) > lo1 or max(ys) < la0 or min(ys) > la1: continue
                vistos.add(p.get('id'))
                yield p.get('h'), p.get('s'), p.get('ref'), [(float(x), float(y)) for x, y in cs]


def ha_vias(pasta, caixa):
    return bool(folhas(os.path.join(pasta, 'osm-vias'), 'vias', 'geojson', caixa))


# ---------------------------------------------------------------- ardidas
# Cartografia nacional de areas ardidas (ICNF), recortada a area de
# construcao: icnf-ardidas/ardidas_estrela.gpkg (EPSG 3763). Campo 'Ano' e
# DH_Inicio (ms desde 1970, guardado como texto).
# O que conta como "recente": fogo DEPOIS das fontes que medem o que esta de
# pe -- o LiDAR da DGT voou Abr-Set 2024 (Abr-Jun quase tudo) e a COS 2025
# e do inicio de 2025. Um fogo de Agosto de 2025 nao esta em nenhuma das duas:
# a carta e o laser dizem pinhal, e o pinhal ja nao esta la.
ARDIDO_DESDE_MS = 1719792000000      # 2024-07-01 UTC


def ha_ardidas(pasta):
    return os.path.exists(os.path.join(pasta, 'icnf-ardidas', 'ardidas_estrela.gpkg'))


def ardidas_poligonos(pasta, caixa):
    """(ano, inicio_ms ou None, aneis em graus) dos poligonos que tocam a caixa."""
    lo0, la0, lo1, la1 = caixa
    f = os.path.join(pasta, 'icnf-ardidas', 'ardidas_estrela.gpkg')
    c = sqlite3.connect(f)
    (tab, srs), = c.execute('select table_name, srs_id from gpkg_contents where data_type=\'features\'').fetchall()
    xs, ys = _tr('EPSG:4326', 'EPSG:%d' % srs, [lo0, lo1, lo0, lo1], [la0, la0, la1, la1])
    q = ('select t.Ano, t.DH_Inicio, t.geom from %s t, rtree_%s_geom r '
         'where t.fid = r.id and r.maxx >= ? and r.minx <= ? and r.maxy >= ? and r.miny <= ?' % (tab, tab))
    for ano, ini, g in c.execute(q, (min(xs) - 50, max(xs) + 50, min(ys) - 50, max(ys) + 50)):
        if g is None or ano is None: continue
        aneis = _para_graus(_gpkg_aneis(g), srs)
        a0 = np.array(aneis[0])
        if a0[:, 0].max() < lo0 or a0[:, 0].min() > lo1 or a0[:, 1].max() < la0 or a0[:, 1].min() > la1:
            continue
        try: ini = int(float(ini)) if ini not in (None, '') else None
        except ValueError: ini = None
        yield int(ano), ini, aneis
    c.close()


def ardido_recente(ano, ini):
    """Depois das fontes: 2025 em diante, ou 2024 com inicio a partir de Julho."""
    return ano >= 2025 or (ano == 2024 and ini is not None and ini >= ARDIDO_DESDE_MS)

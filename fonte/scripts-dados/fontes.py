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

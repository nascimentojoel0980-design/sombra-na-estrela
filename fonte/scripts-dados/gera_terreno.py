#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
Cozedor de terreno: transforma uma caixa do mapa NUM SO FICHEIRO estatico.

A CAMADA DE ARVORES ACTUAL constroi celulas enquanto o mapa se mexe: por isso
as arvores "piscam" e por isso andar para o lado custa. Aqui nao se constroi
nada a andar. O ficheiro traz:

  - a grelha de cotas da caixa inteira, de uma so vez (uma malha, nao pedacos)
  - a classe do solo em grelha fina (o que nasce onde)
  - o tracado dos percursos, com o corredor ja aberto na grelha de classes

O visualizador le isto UMA vez, gera as plantas UMA vez para um buffer que
nunca mais e tocado, e a partir dai andar, rodar e inclinar custam zero.

Fonte das cotas:
  - por defeito dados/dem.webp (Copernicus ~30 m). A grelha sai a 25 m porque
    nao ha detalhe abaixo disso; pedir mais era inventar.
  - --mdt CAMINHO.tif  usa um modelo de terreno LiDAR (2 m da DGT) quando ele
    existir, e ai o --passo pode descer para 4 ou 8 m. O resto nao muda.

Uso:
  python3 fonte/scripts-dados/gera_terreno.py --nome manteigas \
      --caixa -7.62 40.31 -7.49 40.42 --passo 25 --classe 8
"""
import argparse, gzip, json, math, os, struct, sys
import numpy as np

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from lepmtiles import PM, mvt_camadas, aneis

RAIZ = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
DEM_CAIXA = (-8.1, 40.0, -7.15, 40.7)      # a mesma do app.js

# codigos da COS ao nivel 1 que interessam, mais 9 para agua a serio
TAB_G = {'urbano': 1, 'agricola': 2, 'floresta': 3, 'matos': 4,
         'rocha': 5, 'agua': 6, 'outro': 7}
NOME = {0: 'nada', 1: 'urbano', 2: 'agricola', 3: 'pastagens', 4: 'montado',
        5: 'floresta', 6: 'matos', 7: 'rocha', 9: 'agua'}


# ----------------------------------------------------------------- cotas
def le_dem():
    from PIL import Image
    im = Image.open(os.path.join(RAIZ, 'dados/dem.webp')).convert('RGB')
    a = np.asarray(im).astype(np.float32)
    z = a[:, :, 0] * 256.0 + a[:, :, 1] - 32768.0
    return z, DEM_CAIXA


def le_mdt(caminho):
    """MDT LiDAR. Le GeoTIFF se houver rasterio/GDAL; senao diz porque nao."""
    try:
        import rasterio
    except ImportError:
        sys.exit('para ler %s e precisa a biblioteca rasterio (pip install rasterio)' % caminho)
    with rasterio.open(caminho) as r:
        z = r.read(1).astype(np.float32)
        b = r.bounds
        if r.crs and r.crs.to_epsg() != 4326:
            sys.exit('o MDT tem de vir em graus (EPSG:4326). Reprojecta primeiro:\n'
                     '  gdalwarp -t_srs EPSG:4326 %s mdt_wgs84.tif' % caminho)
        return z, (b.left, b.bottom, b.right, b.top)


def amostra(z, cx, lons, lats):
    """bilinear: lons/lats sao vectores, devolve matriz len(lats) x len(lons)"""
    h, w = z.shape
    kx = (w - 1) / (cx[2] - cx[0])
    ky = (h - 1) / (cx[3] - cx[1])
    fx = np.clip((lons - cx[0]) * kx, 0, w - 1.001)
    fy = np.clip((cx[3] - lats) * ky, 0, h - 1.001)
    c0 = fx.astype(np.int32); wx = (fx - c0).astype(np.float32)
    r0 = fy.astype(np.int32); wy = (fy - r0).astype(np.float32)
    a = z[np.ix_(r0, c0)];       b = z[np.ix_(r0, c0 + 1)]
    c = z[np.ix_(r0 + 1, c0)];   d = z[np.ix_(r0 + 1, c0 + 1)]
    WX = wx[None, :]; WY = wy[:, None]
    return (a * (1 - WX) + b * WX) * (1 - WY) + (c * (1 - WX) + d * WX) * WY


# ------------------------------------------------------------- azulejos
def lon2x(lo, z): return int(math.floor((lo + 180) / 360 * 2 ** z))
def lat2y(la, z):
    r = math.radians(la)
    return int(math.floor((1 - math.log(math.tan(r) + 1 / math.cos(r)) / math.pi) / 2 * 2 ** z))
def x2lon(x, z): return x / 2 ** z * 360 - 180
def y2lat(y, z):
    n = math.pi - 2 * math.pi * y / 2 ** z
    return math.degrees(math.atan(math.sinh(n)))


def poligonos(pm, caixa, z, camada):
    """devolve [(codigo, [anel em graus, ...]), ...] da caixa, sem repetidos"""
    x0, x1 = lon2x(caixa[0], z), lon2x(caixa[2], z)
    y0, y1 = lat2y(caixa[3], z), lat2y(caixa[1], z)
    fora = []
    for tx in range(x0, x1 + 1):
        for ty in range(y0, y1 + 1):
            t = pm.tile(z, tx, ty)
            if not t: continue
            cam = mvt_camadas(t)
            if camada not in cam: continue
            feats, ext = cam[camada]
            w, e = x2lon(tx, z), x2lon(tx + 1, z)
            n, s = y2lat(ty, z), y2lat(ty + 1, z)
            for props, gt, geom in feats:
                if gt != 3: continue                      # so poligonos
                c = props.get('c')
                if camada == 'aguaA':
                    cod = 9
                else:
                    cod = int(c) if c is not None else TAB_G.get(props.get('g'), 0)
                if not cod: continue
                gs = []
                for anel in aneis(geom):
                    if len(anel) < 3: continue
                    gs.append([(w + (px / ext) * (e - w), n + (py / ext) * (s - n))
                               for px, py in anel])
                if gs: fora.append((cod, gs))
    return fora


def linhas(pm, caixa, z, camada):
    x0, x1 = lon2x(caixa[0], z), lon2x(caixa[2], z)
    y0, y1 = lat2y(caixa[3], z), lat2y(caixa[1], z)
    fora = []
    vistos = set()
    for tx in range(x0, x1 + 1):
        for ty in range(y0, y1 + 1):
            t = pm.tile(z, tx, ty)
            if not t: continue
            cam = mvt_camadas(t)
            if camada not in cam: continue
            feats, ext = cam[camada]
            w, e = x2lon(tx, z), x2lon(tx + 1, z)
            n, s = y2lat(ty, z), y2lat(ty + 1, z)
            for props, gt, geom in feats:
                if gt != 2: continue                      # so linhas
                for l in aneis(geom):
                    if len(l) < 2: continue
                    pts = [(w + (px / ext) * (e - w), n + (py / ext) * (s - n))
                           for px, py in l]
                    ch = (round(pts[0][0], 6), round(pts[0][1], 6),
                          round(pts[-1][0], 6), round(pts[-1][1], 6), len(pts))
                    if ch in vistos: continue
                    vistos.add(ch)
                    fora.append(pts)
    return fora


# ----------------------------------------------------------- rasterizar
def pinta(destino, aneis_graus, cod, caixa, mx, my):
    """scanline com regra par-impar: os buracos do poligono contam"""
    lo0, la0, lo1, la1 = caixa
    kx = mx / (lo1 - lo0)
    ky = my / (la1 - la0)
    arestas = []
    for anel in aneis_graus:
        n = len(anel)
        for i in range(n):
            ax, ay = anel[i]
            bx, by = anel[(i + 1) % n]
            if ay == by: continue
            arestas.append(((ax - lo0) * kx, (ay - la0) * ky,
                            (bx - lo0) * kx, (by - la0) * ky))
    if not arestas: return
    A = np.array(arestas, dtype=np.float64)
    ymin = max(0, int(math.floor(min(A[:, 1].min(), A[:, 3].min()))))
    ymax = min(my - 1, int(math.ceil(max(A[:, 1].max(), A[:, 3].max()))))
    for j in range(ymin, ymax + 1):
        yc = j + 0.5
        sel = ((A[:, 1] <= yc) & (A[:, 3] > yc)) | ((A[:, 3] <= yc) & (A[:, 1] > yc))
        if not sel.any(): continue
        E = A[sel]
        t = (yc - E[:, 1]) / (E[:, 3] - E[:, 1])
        xs = np.sort(E[:, 0] + t * (E[:, 2] - E[:, 0]))
        for k in range(0, len(xs) - 1, 2):
            i0 = max(0, int(math.ceil(xs[k] - 0.5)))
            i1 = min(mx - 1, int(math.floor(xs[k + 1] - 0.5)))
            if i1 >= i0: destino[j, i0:i1 + 1] = cod


def abre_corredor(classes, rotas, caixa, mx, my, raio_m):
    """Marca o BIT 7 numa faixa de raio_m de cada lado do tracado.

    Nao apaga a classe: se apagasse, o chao do corredor ficava pintado de
    'nada' e o trilho aparecia como uma risca branca de 18 m de largo. A
    classe fica igual -- so nao nasce la nada.
    """
    lo0, la0, lo1, la1 = caixa
    kx = mx / (lo1 - lo0); ky = my / (la1 - la0)
    mlat = 110540.0; mlon = 111320.0 * math.cos(math.radians((la0 + la1) / 2))
    px_m_x = (lo1 - lo0) * mlon / mx          # metros por celula em x
    px_m_y = (la1 - la0) * mlat / my
    rx = max(1, int(round(raio_m / px_m_x)))
    ry = max(1, int(round(raio_m / px_m_y)))
    # disco de apagar
    yy, xx = np.mgrid[-ry:ry + 1, -rx:rx + 1]
    disco = ((xx * px_m_x) ** 2 + (yy * px_m_y) ** 2) <= raio_m * raio_m
    n = 0
    for l in rotas:
        for i in range(len(l) - 1):
            ax, ay = l[i]; bx, by = l[i + 1]
            # anda ao longo do segmento de meia celula em meia celula
            dx = (bx - ax) * kx; dy = (by - ay) * ky
            passos = int(max(abs(dx), abs(dy)) * 2) + 1
            for k in range(passos + 1):
                u = k / passos
                cx = int((ax + (bx - ax) * u - lo0) * kx)
                cy = int((ay + (by - ay) * u - la0) * ky)
                x0 = max(0, cx - rx); x1 = min(mx, cx + rx + 1)
                y0 = max(0, cy - ry); y1 = min(my, cy + ry + 1)
                if x1 <= x0 or y1 <= y0: continue
                d = disco[y0 - (cy - ry):y1 - (cy - ry), x0 - (cx - rx):x1 - (cx - rx)]
                sub = classes[y0:y1, x0:x1]
                sub[d & (sub != 9)] |= 128
                n += 1
    return n


# ----------------------------------------------------------------- main
def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--nome', required=True)
    ap.add_argument('--caixa', nargs=4, type=float, required=True,
                    metavar=('LON0', 'LAT0', 'LON1', 'LAT1'))
    ap.add_argument('--passo', type=float, default=25.0, help='m entre nos da grelha de cotas')
    ap.add_argument('--classe', type=float, default=8.0, help='m por celula de classe')
    ap.add_argument('--corredor', type=float, default=9.0, help='m limpos de cada lado do percurso')
    ap.add_argument('--mdt', default=None, help='GeoTIFF do MDT LiDAR em EPSG:4326')
    ap.add_argument('--zsolo', type=int, default=15)
    a = ap.parse_args()

    lo0, la0, lo1, la1 = a.caixa
    assert lo1 > lo0 and la1 > la0, 'caixa ao contrario'
    mlat = 110540.0
    mlon = 111320.0 * math.cos(math.radians((la0 + la1) / 2))
    larg_m = (lo1 - lo0) * mlon
    alt_m = (la1 - la0) * mlat

    nx = int(round(larg_m / a.passo)) + 1
    ny = int(round(alt_m / a.passo)) + 1
    mx = int(round(larg_m / a.classe))
    my = int(round(alt_m / a.classe))
    print('caixa  %.1f x %.1f km' % (larg_m / 1000, alt_m / 1000))
    print('cotas  %d x %d  (passo %.0f m)  = %s nos' % (nx, ny, a.passo, f'{nx*ny:,}'))
    print('classe %d x %d  (celula %.0f m) = %s celulas' % (mx, my, a.classe, f'{mx*my:,}'))

    # --- cotas
    if a.mdt:
        z, cx = le_mdt(a.mdt); fonte = 'MDT LiDAR ' + os.path.basename(a.mdt)
    else:
        z, cx = le_dem(); fonte = 'Copernicus 30 m (dem.webp)'
    lons = np.linspace(lo0, lo1, nx)
    lats = np.linspace(la1, la0, ny)              # linha 0 = norte
    Z = amostra(z, cx, lons, lats).astype(np.float32)
    z0, z1 = float(Z.min()), float(Z.max())
    print('cotas de %.1f a %.1f m   (fonte: %s)' % (z0, z1, fonte))
    if z1 - z0 < 1: sys.exit('a caixa nao apanhou relevo nenhum')
    Zq = np.round((Z - z0) / (z1 - z0) * 65535.0).astype(np.uint16)

    # --- classes
    pm = PM(os.path.join(RAIZ, 'dados/topo.pmtiles'))
    C = np.zeros((my, mx), dtype=np.uint8)
    pols = poligonos(pm, a.caixa, a.zsolo, 'solo')
    print('poligonos de solo: %d' % len(pols))
    for cod, gs in pols:
        pinta(C, gs, cod, a.caixa, mx, my)
    agua = poligonos(pm, a.caixa, a.zsolo, 'aguaA')
    for cod, gs in agua:
        pinta(C, gs, 9, a.caixa, mx, my)
    print('albufeiras e lagoas: %d' % len(agua))

    # --- percursos e corredor
    rotas = linhas(pm, a.caixa, a.zsolo, 'rotas')
    npt = sum(len(l) for l in rotas)
    print('percursos: %d tracados, %s pontos' % (len(rotas), f'{npt:,}'))
    n = abre_corredor(C, rotas, a.caixa, mx, my, a.corredor)
    print('corredor aberto em %s passos' % f'{n:,}')

    nc = int((C & 128).astype(bool).sum())
    print('celulas sem vegetacao (corredor): %s  =  %.2f km2'
          % (f'{nc:,}', nc * a.classe * a.classe / 1e6))
    cont = np.bincount((C & 127).ravel(), minlength=10)
    ac = a.classe * a.classe / 1e6
    for cod in range(10):
        if cont[cod]: print('   %-10s %8.2f km2  %5.1f%%' % (NOME.get(cod, cod),
                            cont[cod] * ac, 100 * cont[cod] / C.size))

    # --- escrever
    cab = bytearray(80)
    struct.pack_into('<4sHH', cab, 0, b'TERR', 1, 0)
    struct.pack_into('<dddd', cab, 8, lo0, la0, lo1, la1)
    struct.pack_into('<HHf', cab, 40, nx, ny, a.passo)
    struct.pack_into('<ff', cab, 48, z0, z1)
    struct.pack_into('<HHf', cab, 56, mx, my, a.classe)
    struct.pack_into('<II', cab, 64, len(rotas), npt)
    corpo = bytearray(cab)
    corpo += Zq.tobytes()
    corpo += C.tobytes()
    corpo += np.array([len(l) for l in rotas], dtype=np.uint32).tobytes()
    pts = np.empty((npt, 2), dtype=np.float32)
    k = 0
    for l in rotas:
        for p in l:
            pts[k, 0] = p[0]; pts[k, 1] = p[1]; k += 1
    corpo += pts.tobytes()

    dest = os.path.join(RAIZ, 'dados/terreno', a.nome + '.terr.gz')
    os.makedirs(os.path.dirname(dest), exist_ok=True)
    with gzip.open(dest, 'wb', compresslevel=9) as f:
        f.write(bytes(corpo))
    print('\n%s' % dest)
    print('  por comprimir %.2f MB   comprimido %.2f MB'
          % (len(corpo) / 1e6, os.path.getsize(dest) / 1e6))


if __name__ == '__main__':
    main()

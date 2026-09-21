#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
Cozedor de terreno: transforma uma caixa do mapa NUM SO FICHEIRO estatico.

A camada 3D do mapa constroi celulas enquanto o mapa se mexe -- e dai que vem
o piscar. Aqui nao se constroi nada a andar: o ficheiro traz a caixa inteira e
o visualizador le-o uma vez.

O ficheiro e por BLOCOS, cada um com a sua etiqueta de quatro letras, para se
poder acrescentar coisas sem partir o que ja la esta:

  BBOX  a caixa, em graus
  COTA  grelha de cotas (uint16 quantizado entre z0 e z1)
  CLAS  grelha de classes do solo; bit 7 = corredor do percurso (nao nasce la nada)
  ALTV  altura da vegetacao medida por LiDAR (CHM), em decimetros. So existe
        quando se passa --chm; sem ela, a altura e o valor por defeito da classe
  ROTA  tracado dos percursos
  CAMS  estradas, estradoes, caminhos e trilhos, com o genero de cada um
  CURV  curvas de nivel, com a cota de cada uma
  PONT  cumes, povoacoes e servicos, com nome
  HORI  mapa de horizonte: o angulo a que o terreno tapa o sol, por direccao.
        E isto que da SOMBRA A SERIO -- nao um sombreado decorativo.

Fonte das cotas: dados/dem.webp (Copernicus ~30 m) por defeito, ou --mdt com um
GeoTIFF do MDT LiDAR em EPSG:4326.

  python3 fonte/scripts-dados/gera_terreno.py --nome manteigas \
      --caixa -7.62 40.31 -7.49 40.42 --passo 25 --classe 8
"""
import argparse, gzip, math, os, struct, sys
import collections
import numpy as np

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from lepmtiles import PM, mvt_camadas, aneis
import fontes

RAIZ = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
# Sobe sempre que o CONTEUDO mudar. Vai no nome do ficheiro, nao numa query:
# a regra do service worker para dados/ e cache primeiro e com ignoreSearch,
# ou seja a ignorar a query -- so o caminho e que ela nao sabe ignorar.
VERSAO_DADOS = 3
DEM_CAIXA = (-8.1, 40.0, -7.15, 40.7)

TAB_G = {'urbano': 1, 'agricola': 2, 'floresta': 3, 'matos': 4,
         'rocha': 5, 'agua': 6, 'outro': 7}
NOME = {0: 'nada', 1: 'urbano', 2: 'agricola', 3: 'pastagens', 4: 'montado',
        5: 'floresta', 6: 'matos', 7: 'rocha', 8: 'parede', 9: 'agua',
        10: 'chao nu', 11: 'matagal', 12: 'zona humida'}
# COS 2025 nivel 1 -> classe do motor. Igual excepto o 8: no motor o 8 e
# 'parede' (declive medido), e as zonas humidas da COS vao para o 12.
COS_N1 = {1: 1, 2: 2, 3: 3, 4: 4, 5: 5, 6: 6, 7: 7, 8: 12, 9: 9}
# generos de ponto que valem a pena carregar
PONTOS = ['cume', 'povoacao', 'aldeia', 'abrigo', 'agua', 'miradouro', 'info',
          'parque', 'cascata', 'lagoa']

# Por onde se anda nao cresce mato. Cada genero tem a sua largura limpa, de
# cada lado do eixo: uma nacional abre mais do que um trilho de cabras.
# Nao e enfeite -- e o que faz o caminho ler-se de cima por entre as copas.
TIPO_CAM = {'nacional': 0, 'estrada': 1, 'estradao': 2, 'caminho': 3, 'trilho': 4,
            'rio': 5, 'ribeira': 6, 'levada': 7, 'urbana': 8, 'autoestrada': 9}
LIMPO = {'nacional': 11.0, 'estrada': 9.0, 'estradao': 6.0, 'caminho': 5.0, 'trilho': 4.0,
         'rio': 4.0, 'ribeira': 2.0, 'levada': 1.5, 'urbana': 5.0, 'autoestrada': 14.0}
# highway do OSM (vias do armazem) -> tipo do motor. Os azulejos antigos so
# tinham 5 tipos; com a classe original separam-se autoestrada, nacional,
# municipal (estrada), urbana e rural (caminho).
HIGHWAY = {'motorway': 'autoestrada', 'motorway_link': 'autoestrada', 'trunk': 'autoestrada', 'trunk_link': 'autoestrada',
           'primary': 'nacional', 'primary_link': 'nacional',
           'secondary': 'estrada', 'secondary_link': 'estrada', 'tertiary': 'estrada', 'tertiary_link': 'estrada',
           'residential': 'urbana', 'living_street': 'urbana', 'service': 'urbana', 'pedestrian': 'urbana',
           'unclassified': 'caminho', 'road': 'caminho',
           'track': 'estradao',
           'path': 'trilho', 'footway': 'trilho', 'bridleway': 'trilho', 'steps': 'trilho', 'cycleway': 'trilho'}
# linhas de agua do OSM (camada aguaL): w=river/stream/canal -> tipo do motor
TIPO_AGUA = {'river': 'rio', 'stream': 'ribeira', 'canal': 'levada', 'drain': 'levada', 'ditch': 'levada'}
# piso (surface do OSM), guardado ao lado do tipo no bloco CAMS: 0 sem
# informacao, 1 alcatrao/betao, 2 calcada, 3 terra/gravilha. So 26% das vias
# de Manteigas o trazem; onde nao ha, o motor pinta pelo tipo e diz que e.
PISO = {'asphalt': 1, 'paved': 1, 'concrete': 1, 'concrete:plates': 1, 'chipseal': 1,
        'sett': 2, 'cobblestone': 2, 'paving_stones': 2, 'unhewn_cobblestone': 2,
        'unpaved': 3, 'gravel': 3, 'fine_gravel': 3, 'compacted': 3, 'dirt': 3, 'ground': 3,
        'earth': 3, 'grass': 3, 'sand': 3, 'rock': 3, 'pebblestone': 3, 'mud': 3, 'wood': 3}


# ----------------------------------------------------------------- cotas
def le_dem():
    from PIL import Image
    a = np.asarray(Image.open(os.path.join(RAIZ, 'dados/dem.webp')).convert('RGB')).astype(np.float32)
    return a[:, :, 0] * 256.0 + a[:, :, 1] - 32768.0, DEM_CAIXA


def le_mdt(caminho):
    try:
        import rasterio
    except ImportError:
        sys.exit('para ler %s e precisa a biblioteca rasterio (pip install rasterio)' % caminho)
    with rasterio.open(caminho) as r:
        if r.crs and r.crs.to_epsg() != 4326:
            sys.exit('o MDT tem de vir em graus (EPSG:4326):\n'
                     '  gdalwarp -t_srs EPSG:4326 %s mdt_wgs84.tif' % caminho)
        b = r.bounds
        z = r.read(1).astype(np.float32)
        nd = r.nodata
        if nd is not None:
            z = np.where(z == nd, np.nan, z)
            # tapa buracos com a media dos vizinhos validos, senao abrem-se
            # poços no meio da malha
            if np.isnan(z).any():
                m = np.nanmedian(z)
                z = np.where(np.isnan(z), m, z)
        return z, (b.left, b.bottom, b.right, b.top)


def amostra_grossa(z, cx, lons, lats, k, modo):
    """Para celulas muito maiores do que o raster (vista geral a 50 m sobre um
    CHM de 5 m): k x k sub-amostras por celula e um resumo. Amostrar por
    PONTO deixava a floresta ao acaso -- o ponto caia numa clareira e a celula
    inteira deixava de ser floresta (2 690 km2 da COS -> 701).
      modo 'p75'   3.o quartil: a copa dominante da celula
      modo 'media' fraccao/media (agua: celula e agua se metade for)"""
    def fino(v):
        d = (v[1] - v[0]) if len(v) > 1 else 0
        return (v[:, None] + d * (np.arange(k) + 0.5) / k - d / 2).ravel()
    A = amostra(z, cx, fino(lons), fino(lats))
    A = A.reshape(len(lats), k, len(lons), k).transpose(0, 2, 1, 3).reshape(len(lats), len(lons), k * k)
    if modo == 'p75': return np.percentile(A, 75, axis=2).astype(np.float32)
    return A.mean(axis=2).astype(np.float32)


def tapa_caixa(cx, caixa, quem):
    """amostra() faz clip: um raster que nao tape a caixa nao rebenta, esborrata
    o valor da borda para dentro em silencio. Mais vale morrer aqui."""
    lo0, la0, lo1, la1 = caixa
    if cx[0] <= lo0 and cx[1] <= la0 and cx[2] >= lo1 and cx[3] >= la1:
        return
    sys.exit('o %s nao tapa a caixa toda e amostra() esborrataria a borda:\n'
             '  caixa  %.5f %.5f %.5f %.5f\n'
             '  raster %.5f %.5f %.5f %.5f' % ((quem,) + tuple(caixa) + tuple(cx)))


def amostra(z, cx, lons, lats):
    h, w = z.shape
    kx = (w - 1) / (cx[2] - cx[0]); ky = (h - 1) / (cx[3] - cx[1])
    fx = np.clip((lons - cx[0]) * kx, 0, w - 1.001)
    fy = np.clip((cx[3] - lats) * ky, 0, h - 1.001)
    c0 = fx.astype(np.int32); wx = (fx - c0).astype(np.float32)
    r0 = fy.astype(np.int32); wy = (fy - r0).astype(np.float32)
    a = z[np.ix_(r0, c0)]; b = z[np.ix_(r0, c0 + 1)]
    c = z[np.ix_(r0 + 1, c0)]; d = z[np.ix_(r0 + 1, c0 + 1)]
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


def varre(pm, caixa, z, camada):
    """passa por todos os azulejos da caixa e devolve (props, gtipo, aneis em graus)"""
    x0, x1 = lon2x(caixa[0], z), lon2x(caixa[2], z)
    y0, y1 = lat2y(caixa[3], z), lat2y(caixa[1], z)
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
                gs = [[(w + (px / ext) * (e - w), n + (py / ext) * (s - n)) for px, py in a]
                      for a in aneis(geom)]
                yield props, gt, gs


def sem_repetir(it):
    vistos = set()
    for props, gt, gs in it:
        for g in gs:
            if len(g) < 2: continue
            ch = (round(g[0][0], 6), round(g[0][1], 6), round(g[-1][0], 6), round(g[-1][1], 6), len(g))
            if ch in vistos: continue
            vistos.add(ch)
            yield props, g


# ----------------------------------------------------------- rasterizar
def orelhas(P):
    """Triangula um poligono simples por corte de orelhas.

    Um leque a partir do centroide chegava para rectangulos e mentia em todos os
    L -- e meia Manteigas sao Ls. Isto nao e rapido, mas corre uma vez aqui e
    nunca no telemovel, que e o padrao de todo este cozedor.
    """
    n = len(P)
    if n < 3: return []
    # area assinada: garantir sentido anti-horario
    a2 = sum(P[i][0] * P[(i + 1) % n][1] - P[(i + 1) % n][0] * P[i][1] for i in range(n))
    idx = list(range(n)) if a2 > 0 else list(range(n - 1, -1, -1))
    def cruz(o, a, b):
        return (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0])
    def dentro(p, a, b, c):
        d1, d2, d3 = cruz(a, b, p), cruz(b, c, p), cruz(c, a, p)
        return not ((d1 < 0 or d2 < 0 or d3 < 0) and (d1 > 0 or d2 > 0 or d3 > 0))
    tri, guarda = [], 0
    while len(idx) > 3 and guarda < 4 * n:
        guarda += 1
        for k in range(len(idx)):
            i0, i1, i2 = idx[k - 1], idx[k], idx[(k + 1) % len(idx)]
            a, b, c = P[i0], P[i1], P[i2]
            if cruz(a, b, c) <= 0: continue                 # reflexo, nao e orelha
            if any(dentro(P[j], a, b, c) for j in idx if j not in (i0, i1, i2)):
                continue
            tri.append((i0, i1, i2)); idx.pop(k); guarda = 0
            break
        else:
            break
    if len(idx) == 3: tri.append(tuple(idx))
    return tri


def dilata(m, n):
    """alarga a mascara n celulas para cada lado (sem scipy: so np.maximum)"""
    if n <= 0: return m
    for _ in range(n):
        d = m.copy()
        d[1:, :] = np.maximum(d[1:, :], m[:-1, :])
        d[:-1, :] = np.maximum(d[:-1, :], m[1:, :])
        m = d.copy()
        d[:, 1:] = np.maximum(d[:, 1:], m[:, :-1])
        d[:, :-1] = np.maximum(d[:, :-1], m[:, 1:])
        m = d
    return m


def pinta(destino, gs, cod, caixa, mx, my):
    """Enche poligonos na grelha das classes. LINHA 0 = NORTE, como as cotas
    (lats = linspace(la1, la0)), o CHM, o abre_corredor, o confere.py e o motor.

    20/09/2026: ate aqui esta funcao punha a linha 0 a SUL. Tudo o que passava
    por ela -- COS, agua do OSM, mascara das casas -- ficava espelhado
    norte-sul em relacao ao relevo e a medicao. As classes que a medicao
    decide (floresta, matagal, chao nu) saiam certas, porque o CHM esta a
    norte-primeiro; as que vem da carta saiam no sitio errado. Era isto que
    punha a rocha do planalto no fundo do vale, o urbano fora da vila e a
    copa dos telhados por zerar (a mascara zerava-a no espelho). Nao foi a
    COS: a COS estava certa e nos e que a liamos ao contrario."""
    lo0, la0, lo1, la1 = caixa
    kx = mx / (lo1 - lo0); ky = my / (la1 - la0)
    A = []
    for anel in gs:
        n = len(anel)
        for i in range(n):
            ax, ay = anel[i]; bx, by = anel[(i + 1) % n]
            if ay == by: continue
            A.append(((ax - lo0) * kx, (la1 - ay) * ky, (bx - lo0) * kx, (la1 - by) * ky))
    if not A: return
    A = np.array(A, dtype=np.float64)
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
    """Marca o BIT 7 ao longo do tracado: a classe fica, mas nao nasce la nada.

    Apagar a classe punha o chao do trilho pintado de 'nada' e o caminho
    aparecia como uma risca branca de 18 m de largo.
    """
    lo0, la0, lo1, la1 = caixa
    kx = mx / (lo1 - lo0); ky = my / (la1 - la0)
    mlat = 110540.0; mlon = 111320.0 * math.cos(math.radians((la0 + la1) / 2))
    px = (lo1 - lo0) * mlon / mx; py = (la1 - la0) * mlat / my
    rx = max(1, int(round(raio_m / px))); ry = max(1, int(round(raio_m / py)))
    yy, xx = np.mgrid[-ry:ry + 1, -rx:rx + 1]
    disco = ((xx * px) ** 2 + (yy * py) ** 2) <= raio_m * raio_m
    n = 0
    for l in rotas:
        for i in range(len(l) - 1):
            ax, ay = l[i]; bx, by = l[i + 1]
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


# -------------------------------------------------------------- horizonte
def horizonte(Z, passo_x, passo_y, ndir, alcance_m, janela=None):
    """Para cada no e cada direccao, o angulo a que o terreno tapa o ceu.

    E o que permite sombra a serio: ao desenhar, compara-se a altura do sol
    com este angulo na direccao do sol. Se o sol vier mais baixo do que o
    horizonte, aquele ponto esta a sombra de um monte -- que e o que interessa
    a quem anda na serra ao fim da tarde.

    Guarda-se em graus/0.5 num byte (0..180 = 0..90 graus).
    """
    # janela = (j0, i0, ny, nx): calcula so para esses nos de Z, mas ve Z todo
    # (a moldura a volta da caixa, quando ha)
    NY, NX = Z.shape
    j0, i0, ny, nx = janela if janela else (0, 0, NY, NX)
    Zc = Z[j0:j0 + ny, i0:i0 + nx]
    H = np.zeros((ndir, ny, nx), dtype=np.uint8)
    base = min(passo_x, passo_y)
    for d in range(ndir):
        az = 2 * math.pi * d / ndir              # 0 = norte, cresce para leste
        maxang = np.zeros((ny, nx), dtype=np.float32)
        # Amostra-se ao longo do raio a distancias CRESCENTES, em metros. A
        # primeira versao acumulava a distancia em numero de celulas e dividia
        # metros por celulas: os angulos sairam 25 vezes maiores e o vale
        # aparecia com 26 graus de horizonte medio.
        dist = base
        while dist < alcance_m:
            di = math.sin(az) * dist / passo_x       # leste = +coluna
            dj = -math.cos(az) * dist / passo_y      # norte = -linha
            ii = np.clip(np.arange(i0, i0 + nx)[None, :] + di, 0, NX - 1).astype(np.int32)
            jj = np.clip(np.arange(j0, j0 + ny)[:, None] + dj, 0, NY - 1).astype(np.int32)
            np.maximum(maxang, (Z[jj, ii] - Zc) / dist, out=maxang)
            dist *= 1.25
        H[d] = np.clip(np.degrees(np.arctan(maxang)) * 2.0, 0, 180).astype(np.uint8)
    return H


# ---------------------------------------------------------------- blocos
def bloco(tag, corpo):
    return struct.pack('<4sI', tag.encode('ascii'), len(corpo)) + bytes(corpo)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--nome', required=True)
    ap.add_argument('--caixa', nargs=4, type=float, required=True,
                    metavar=('LON0', 'LAT0', 'LON1', 'LAT1'))
    ap.add_argument('--passo', type=float, default=25.0)
    ap.add_argument('--classe', type=float, default=8.0)
    ap.add_argument('--corredor', type=float, default=9.0)
    ap.add_argument('--mdt', default=None)
    ap.add_argument('--chm', default=None,
                    help='GeoTIFF do modelo de altura do coberto (LiDAR), EPSG:4326')
    ap.add_argument('--ndvi', default=None,
                    help='GeoTIFF uint8 de NDVI (valor/127.5-1, 255 = sem dado). Abaixo de 0,5 m o '
                         'laser nao diz se e erva ou pedra; o NDVI diz se e verde')
    ap.add_argument('--agua', default=None,
                    help='GeoTIFF 0/1 em EPSG:4326: agua MEDIDA (Sentinel NDWI '
                         'cruzado com a Copernicus WAW). Ganha a tudo o resto, '
                         'porque e a unica classe que tres fontes confirmaram')
    ap.add_argument('--matagal-min', type=float, default=1.5,
                    help='m de copa medida a partir dos quais o mato passa de '
                         'rasteiro a matagal (so com --chm)')
    ap.add_argument('--agua-graus', type=float, default=12.0,
                    help='declive acima do qual um poligono de agua do OSM e '
                         'recusado: uma superficie de agua nao fica de pe numa encosta')
    ap.add_argument('--parede-graus', type=float, default=45.0,
                    help='declive a partir do qual a celula e parede de rocha e nao '
                         'leva vegetacao nenhuma. So com --mdt: num DEM de 30 m o '
                         'declive nao encontra uma escarpa')
    ap.add_argument('--arvore-min', type=float, default=5.0,
                    help='m de copa medida a partir dos quais a celula e floresta, '
                         'diga a COS o que disser (so faz efeito com --chm)')
    ap.add_argument('--zsolo', type=int, default=15)
    ap.add_argument('--titulo', default=None, help='como aparece no menu da aplicacao')
    ap.add_argument('--versao', type=int, default=VERSAO_DADOS,
                    help='vai no NOME do ficheiro: e a unica coisa que a cache do '
                         'telemovel nao sabe ignorar (ver ARMADILHAS 10)')
    ap.add_argument('--passo-horizonte', type=float, default=None,
                    help='m entre nos do mapa de horizonte; por defeito e o --passo. '
                         'Como o horizonte e um campo liso, 25 m chega mesmo com o '
                         'relevo a 8, e poupa quase todo o peso do ficheiro')
    ap.add_argument('--dir', type=int, default=16, help='direccoes do mapa de horizonte')
    ap.add_argument('--sem-horizonte', action='store_true')
    ap.add_argument('--sem-casas', action='store_true')
    ap.add_argument('--sem-curvas', action='store_true', help='sem curvas de nivel (vista geral)')
    ap.add_argument('--so-caminhos', default=None,
                    help='lista de tipos a guardar, ex. nacional,estrada,estradao,rio (vista geral)')
    ap.add_argument('--sem-plantas', action='store_true',
                    help='a zona nao semeia nada (vista geral da serra a 50 m: a 6 000 km2 '
                         'seriam 140 milhoes de plantas). Fica escrito no indice e o motor obedece.')
    ap.add_argument('--alcance', type=float, default=15000.0,
                    help='ate que distancia (m) um monte pode tapar o sol; com o MDT do armazem '
                         'o horizonte ve para fora da caixa ate aqui')
    ap.add_argument('--penedo-alt', type=float, default=1200.0,
                    help='acima desta cota, uma pegada so da Microsoft, pequena e fora de '
                         'urbano/agricola, e tratada como penedo e nao se desenha')
    ap.add_argument('--penedo-m2', type=float, default=60.0)
    ap.add_argument('--fontes', default=os.path.join(RAIZ, '..', 'sne-dados-fonte'),
                    help='pasta do repositorio sne-dados-fonte (COS 2025 Serie 2 e '
                         'contornos Microsoft + OSM, recortados a area toda do mapa)')
    ap.add_argument('--sem-fontes', action='store_true',
                    help='cozer com os azulejos antigos (COS com 7, 8 e 9 num saco so; '
                         'casas so do OSM). So para comparar; a zona sai marcada.')
    ap.add_argument('--sem-boletim', action='store_true',
                    help='escreve o indice mesmo que o boletim falhe. So com '
                         'motivo escrito: e esta guarda que impede uma zona '
                         'nova de ser publicada sem ninguem saber que falhou')
    a = ap.parse_args()

    lo0, la0, lo1, la1 = a.caixa
    assert lo1 > lo0 and la1 > la0, 'caixa ao contrario'
    mlat = 110540.0; mlon = 111320.0 * math.cos(math.radians((la0 + la1) / 2))
    larg_m = (lo1 - lo0) * mlon; alt_m = (la1 - la0) * mlat
    nx = int(round(larg_m / a.passo)) + 1
    ny = int(round(alt_m / a.passo)) + 1
    mx = int(round(larg_m / a.classe)); my = int(round(alt_m / a.classe))
    print('caixa  %.1f x %.1f km' % (larg_m / 1000, alt_m / 1000))
    print('cotas  %d x %d (passo %.0f m) = %s nos' % (nx, ny, a.passo, f'{nx*ny:,}'))
    print('classe %d x %d (celula %.0f m) = %s celulas' % (mx, my, a.classe, f'{mx*my:,}'))

    # MDT e CHM: por omissao vem das folhas do armazem (lidar-derivado/mdt8 e
    # chm5), para qualquer caixa da serra cozer com o mesmo comando. --mdt e
    # --chm apontados a ficheiros soltos continuam a valer e passam a frente.
    usa_fontes = not a.sem_fontes
    if usa_fontes and not os.path.isdir(a.fontes):
        sys.exit('nao encontro o sne-dados-fonte em %s (clona-o ao lado, ou --fontes PASTA; '
                 '--sem-fontes coze com os azulejos antigos e a zona sai marcada)' % a.fontes)
    if not a.mdt and usa_fontes and fontes.ha_raster(a.fontes, 'mdt8', a.caixa):
        a.mdt = 'armazem:mdt8'
    if not a.chm and usa_fontes and fontes.ha_raster(a.fontes, 'chm5', a.caixa):
        a.chm = 'armazem:chm5'
    if not a.agua and usa_fontes and fontes.ha_raster(a.fontes, 'agua', a.caixa, 'agua_2024-07'):
        a.agua = 'armazem:agua'
    if a.mdt:
        if a.mdt == 'armazem:mdt8': z, cx = fontes.raster_mosaico(a.fontes, 'mdt8', a.caixa)
        else: z, cx = le_mdt(a.mdt)
        tapa_caixa(cx, a.caixa, 'MDT')
        # Isto aparece no menu ao pe do utilizador ("As cotas vem de ..."),
        # por isso nao leva o nome de um ficheiro do disco de quem cozeu.
        fonte = 'MDT do LiDAR' + (', com copa medida' if a.chm else '')
    else:
        z, cx = le_dem(); fonte = 'Copernicus 30 m'
    print('MDT: %s   CHM: %s   agua: %s' % (a.mdt or 'Copernicus 30 m', a.chm or 'nenhum (altura modelada)',
                                          a.agua or 'so COS/OSM'))
    lons = np.linspace(lo0, lo1, nx); lats = np.linspace(la1, la0, ny)
    Z = amostra(z, cx, lons, lats).astype(np.float32)
    z0, z1 = float(Z.min()), float(Z.max())
    print('cotas de %.1f a %.1f m   (%s)' % (z0, z1, fonte))
    if z1 - z0 < 1: sys.exit('a caixa nao apanhou relevo nenhum')

    # declive na grelha das classes, calculado uma vez: serve a agua (uma
    # superficie de agua nao fica de pe), as paredes e a leitura da COS
    if a.mdt:
        gy0, gx0 = np.gradient(Z, a.passo)
        gr0 = np.degrees(np.arctan(np.hypot(gx0, gy0)))
        jj0 = (np.arange(my) / my * ny).astype(int).clip(0, ny - 1)
        ii0 = (np.arange(mx) / mx * nx).astype(int).clip(0, nx - 1)
        DEC = gr0[np.ix_(jj0, ii0)]
    else:
        DEC = np.zeros((my, mx), np.float32)   # num DEM de 30 m o declive nao vale

    pm = PM(os.path.join(RAIZ, 'dados/topo.pmtiles'))

    # --- classes
    # A COS vem do GeoPackage da Serie 2 guardado no sne-dados-fonte, com o
    # digito de nivel 1 verdadeiro: 7, 8 e 9 separados. Os azulejos antigos
    # tinham os tres num saco 'outro' e foi isso que pos a zona baixa de
    # Manteigas a "rocha" (20/09/2026). Fica tambem a grelha N3 (codigo de
    # nivel 3), para o boletim poder dizer o que a COS chama a cada mancha.
    C = np.zeros((my, mx), dtype=np.uint8)
    N3 = np.zeros((my, mx), dtype=np.uint16)
    n_sol = 0
    if usa_fontes:
        fonte_cos = 'COS 2025 Serie 2'
        for n1, n3, gs in fontes.cos_poligonos(a.fontes, a.caixa):
            pinta(C, gs, COS_N1[n1], a.caixa, mx, my)
            pinta(N3, gs, n3, a.caixa, mx, my); n_sol += 1
        # O nivel 1 "7" da COS NAO e rocha: em Manteigas sao 31 km2, e destes
        # 30,6 sao 713 "Vegetacao esparsa" e so 0,7 sao 712 "Espacos rochosos".
        # Os azulejos antigos nao traziam o n3 e pintavam tudo de pedra -- era
        # daqui que vinha "a zona baixa de Manteigas e rocha". Com o n3 a mao:
        #   712 espacos rochosos      -> 7  rocha
        #   711 praias, dunas, areais -> 10 chao nu
        #   713 vegetacao esparsa     -> 10 chao nu PROVISORIO: o que la
        #       cresce decide-se pela altura medida, mais abaixo (>= 0,5 m
        #       mato, >= 1,5 matagal, >= 5 arvore). Sem CHM fica chao nu, que
        #       e o que "espacos descobertos" quer dizer.
        esparsa = (N3 == 713) | (N3 == 711)
        C = np.where(esparsa, 10, C).astype(np.uint8)
        # Cursos de agua (911) sao poligonos com metros de largura em encostas.
        # Onde o declive nao deixa existir uma superficie de agua, a celula e
        # margem, e segue o mesmo caminho da vegetacao esparsa.
        rio = (C == 9) & (DEC >= a.agua_graus)
        C = np.where(rio, 10, C).astype(np.uint8)
        esparsa |= rio
        if rio.any():
            print('agua da COS em declive >= %.0f graus: %.2f km2 passam a margem'
                  % (a.agua_graus, rio.sum() * (a.classe * a.classe) / 1e6))
    else:
        fonte_cos = 'azulejos antigos (7/8/9 num saco)'
        esparsa = np.zeros((my, mx), bool)
        print('AVISO: --sem-fontes: classes dos azulejos antigos, com 7, 8 e 9 num saco so')
        for props, gt, gs in varre(pm, a.caixa, a.zsolo, 'solo'):
            if gt != 3: continue
            c = props.get('c')
            cod = int(c) if c is not None else TAB_G.get(props.get('g'), 0)
            if not cod: continue
            pinta(C, gs, cod, a.caixa, mx, my); n_sol += 1
    ac_ = (a.classe * a.classe) / 1e6
    print('COS (%s), antes de qualquer medicao:' % fonte_cos)
    for k in sorted(set(C.ravel().tolist())):
        if k: print('   %-12s %7.2f km2' % (NOME.get(k, k), (C == k).sum() * ac_))
    if usa_fontes and (N3 // 100 == 7).any():
        print('   o "7" da COS, por n3 (712 e rocha; 711 e 713 nao):')
        for k3 in sorted(set(N3[N3 // 100 == 7].ravel().tolist())):
            print('      %d  %7.2f km2' % (k3, (N3 == k3).sum() * ac_))
    n_ag = 0
    AGUA_OSM = np.zeros((my, mx), dtype=np.uint8)
    for props, gt, gs in varre(pm, a.caixa, a.zsolo, 'aguaA'):
        if gt != 3: continue
        pinta(AGUA_OSM, gs, 1, a.caixa, mx, my); n_ag += 1
    print('poligonos: solo %d, agua %d' % (n_sol, n_ag))

    # --- contornos dos edificios, lidos UMA vez: servem para proteger a copa
    # medida da promocao (telhado nao e arvore) e para os extrudir no fim.
    # Microsoft + OSM do sne-dados-fonte; o OSM sozinho tinha 1 casa em 5.
    contornos_casas = []          # aneis em graus
    alturas_casas = []            # m medidos pela fonte, ou None
    fontes_casas = {}
    n_penedo = 0
    if not a.sem_casas:
        if usa_fontes:
            # A Microsoft ve casas em penedos. Rotularam-se 24 pegadas dela de
            # 15-60 m2 fora de urbano/agricola contra o ortofoto (20/09/2026):
            # das 16 com ortofoto, 10 de 11 acima de 1190 m eram penedos de
            # granito e 3 de 3 abaixo de 1100 m eram casas. O que separa e a
            # cota -- o planalto e um campo de blocos -- e nao a altura medida
            # (um penedo mede 2,5 m no CHM como um telhado). Regra, medida e
            # com limiares a vista: so-Microsoft + < --penedo-m2 + fora de
            # urbano/agricola + acima de --penedo-alt = penedo. Perde-se um
            # casal de pastor pequeno la em cima; ganha-se nao inventar casas
            # no Covao. O OSM passa sempre: la alguem viu a casa.
            base0 = C & 127
            for fo, h, anel in fontes.casas_poligonos(a.fontes, a.caixa):
                if fo == 'ms':
                    P = [((lo - lo0) * mlon, (la - la0) * mlat) for lo, la in anel]
                    if P[0] == P[-1]: P.pop()
                    k = len(P)
                    if k >= 3:
                        m2 = abs(sum(P[i][0] * P[(i + 1) % k][1] - P[(i + 1) % k][0] * P[i][1]
                                     for i in range(k))) / 2
                        cxm = sum(x for x, _ in P) / k; cym = sum(y for _, y in P) / k
                        i = min(mx - 1, max(0, int(cxm / larg_m * mx)))
                        j = min(my - 1, max(0, int((1 - cym / alt_m) * my)))
                        iz = min(nx - 1, max(0, int(round(cxm / larg_m * (nx - 1)))))
                        jz = min(ny - 1, max(0, int(round((alt_m - cym) / alt_m * (ny - 1)))))
                        if (m2 < a.penedo_m2 and base0[j, i] not in (1, 2)
                                and Z[jz, iz] >= a.penedo_alt):
                            n_penedo += 1
                            continue
                contornos_casas.append(anel); alturas_casas.append(h)
                fontes_casas[fo] = fontes_casas.get(fo, 0) + 1
            if n_penedo:
                print('pegadas Microsoft tratadas como penedos (< %.0f m2, > %.0f m, fora de '
                      'urbano/agricola): %d' % (a.penedo_m2, a.penedo_alt, n_penedo))
        else:
            for props, gt, gs in varre(pm, a.caixa, a.zsolo, 'casas'):
                if gt != 3 or not gs: continue
                contornos_casas.append(gs[0]); alturas_casas.append(None)
                fontes_casas['osm'] = fontes_casas.get('osm', 0) + 1
        print('contornos de edificios: %d  %s' % (len(contornos_casas),
              ' '.join('%s %d' % kv for kv in sorted(fontes_casas.items()))))

    # --- percursos
    rotas = [g for props, g in sem_repetir(
        (p, gt, gs) for p, gt, gs in varre(pm, a.caixa, a.zsolo, 'rotas') if gt == 2)]
    npt = sum(len(l) for l in rotas)
    print('percursos: %d tracados, %s pontos' % (len(rotas), f'{npt:,}'))

    # --- estradas, estradoes, caminhos e trilhos
    # Do armazem (osm-vias, classe original do OSM) quando existe; senao dos
    # azulejos, que so trazem 5 tipos.
    cams = []
    if usa_fontes and fontes.ha_vias(a.fontes, a.caixa):
        fonte_vias = 'OSM (armazem, highway original)'
        for h, sup, ref, linha in fontes.vias(a.fontes, a.caixa):
            t = HIGHWAY.get(h)
            if not t: continue
            if a.so_caminhos and t not in a.so_caminhos.split(','): continue
            cams.append((TIPO_CAM[t], t, linha, PISO.get((sup or '').split(';')[0], 0)))
    else:
        fonte_vias = 'azulejos (5 tipos)'
        for props, g in sem_repetir(
                (p, gt, gs) for p, gt, gs in varre(pm, a.caixa, a.zsolo, 'caminhos') if gt == 2):
            t = props.get('t') or 'caminho'
            if a.so_caminhos and t not in a.so_caminhos.split(','): continue
            cams.append((TIPO_CAM.get(t, 3), t, g, PISO.get((props.get('s') or '').split(';')[0], 0)))
    print('vias: %s' % fonte_vias)
    # --- linhas de agua (OSM aguaL). A COS so tem cursos com 20 m de largura
    # e o Sentinel nao ve 3 m: o Zezere no Covao da Ametade nao existia no
    # mapa. Vao no mesmo bloco dos caminhos, com o seu tipo, e o motor
    # desenha-os como fita azul; o corredor limpo e a propria agua.
    n_agl = 0
    for props, g in sem_repetir(
            (p, gt, gs) for p, gt, gs in varre(pm, a.caixa, a.zsolo, 'aguaL') if gt == 2):
        t = TIPO_AGUA.get(props.get('w'), 'ribeira')
        if a.so_caminhos and t not in a.so_caminhos.split(','): continue
        cams.append((TIPO_CAM[t], t, g, 0)); n_agl += 1
    porT = {}
    for _, t, _, _ in cams: porT[t] = porT.get(t, 0) + 1
    print('caminhos e linhas de agua: %d (%s)' % (len(cams), ', '.join('%s %d' % kv for kv in sorted(porT.items()))))
    porP = collections.Counter(p for _, _, _, p in cams)
    print('   piso conhecido: alcatrao %d, calcada %d, terra %d; sem informacao %d'
          % (porP[1], porP[2], porP[3], porP[0]))

    abre_corredor(C, rotas, a.caixa, mx, my, a.corredor)
    for t, r in LIMPO.items():
        ls = [g for tt, nome, g, _ in cams if nome == t]
        if ls: abre_corredor(C, ls, a.caixa, mx, my, r)
    ncorr = int((C & 128).astype(bool).sum())
    print('corredor sem vegetacao: %.2f km2' % (ncorr * a.classe * a.classe / 1e6))
    cont = np.bincount((C & 127).ravel(), minlength=10)
    ac = a.classe * a.classe / 1e6
    print('   ' + '  '.join('%s %.1f' % (NOME.get(k, k), cont[k] * ac)
                            for k in range(10) if cont[k]))

    # --- altura da vegetacao medida (CHM do LiDAR)
    ALTV = None
    if a.chm:
        if a.chm == 'armazem:chm5': zc, cc = fontes.raster_mosaico(a.fontes, 'chm5', a.caixa)
        else: zc, cc = le_mdt(a.chm)
        tapa_caixa(cc, a.caixa, 'CHM')
        lonsC = np.linspace(lo0, lo1, mx); latsC = np.linspace(la1, la0, my)
        passo_chm = abs(cc[2] - cc[0]) / zc.shape[1] * mlon
        if a.classe >= 4 * passo_chm:
            h = amostra_grossa(zc, cc, lonsC, latsC, 4, 'p75')
            print('CHM agregado: celula de %.0f m sobre copa de %.0f m, 4x4 sub-amostras, 3.o quartil'
                  % (a.classe, passo_chm))
        else:
            h = amostra(zc, cc, lonsC, latsC)
        # o CHM traz lixo: ramos soltos a 60 m e valores negativos
        h = np.clip(h, 0, 25.5)
        # Degraus de 0,5 m. O motor ja sorteia +-28% de altura por planta
        # (alt = hBase * (0.72 + 0.56*acaso)), por isso a decima de metro nunca
        # se ve -- mas e ruido do laser que o gzip tem de engolir byte a byte.
        # Sem isto o bloco ALTV quase duplica o ficheiro.
        ALTV = (np.round(h * 2) * 5).clip(0, 255).astype(np.uint8)

        # --- a medicao manda na carta
        # A COS diz ONDE ha floresta; o CHM diz onde ha mesmo copa. Onde os dois
        # discordam, quem mediu ganha. E o unico caminho que apanha coisas que
        # nunca chegam a unidade minima de cartografia -- a fita de vidoeiros do
        # Zezere no Covao da Ametade e a mais obvia: a COS poe matos, e ha
        # betulas de 12 m. Sem isto o CHM so mudava a altura das arvores que a
        # COS ja tinha, e deixava o covao pelado na mesma.
        #
        # Importa tambem por outra razao: a altura medida entra no desenho na
        # celula onde foi medida. Uma celula de matos com 15 m de copa dava um
        # arbusto de 15 m de alto e 19 m de raio (raio = altura x k, e o matos
        # tem k=1,25). Promove-la a floresta poe la uma arvore, que e o que esta
        # la. O bit 128 -- o corredor limpo do caminho -- nao se toca.
        # Um MDS mede telhados tao bem como copas: sobre o centro de Manteigas
        # da 5 m de media e 16 de maximo. Promover isso a floresta punha pinhal
        # em cima das casas. O urbano e o agricola ficam sempre de fora, e alem
        # disso pinta-se a mancha das casas soltas -- as quintas e as Caldas nao
        # estao dentro de nenhum poligono urbano.
        CASA = np.zeros((my, mx), dtype=np.uint8)
        ncasa = 0
        for anel in contornos_casas:
            pinta(CASA, [anel], 1, a.caixa, mx, my); ncasa += 1
        CASA_LARGA = dilata(CASA, int(math.ceil(12.0 / a.classe)))  # beirados e quintal
        CASA_JUSTA = dilata(CASA, 1)                                # so o edificio

        base = C & 127
        corr = C & 128
        # O urbano deixou de estar excluido (20/09/2026): com os contornos
        # Microsoft + OSM os telhados ja estao mascarados um a um, e o que
        # sobra com 5 m de copa dentro de um poligono urbano e arvore -- o
        # Covao da Ametade e "Turismo" na COS (parque de campismo) e tem
        # vidoeiros de 12 m que saiam apagados. O agricola continua de fora:
        # um olival mede 5 m e nao e floresta.
        livre = (CASA_LARGA == 0) & (base != 2)
        # ... mas so ha urbano promovivel quando os telhados estao mascarados.
        # Sem contornos (--sem-casas, vista geral) o MDS le telhado como copa e
        # as vilas saiam floresta: 4 em 12 celulas "floresta" da serra eram
        # telhados vermelhos no ortofoto (20/09/2026).
        promoviveis = [0, 3, 6, 7, 10] + ([1] if contornos_casas else [])
        subiu = (h >= a.arvore_min) & livre & np.isin(base, promoviveis)
        # a vegetacao esparsa da COS (chao nu provisorio) ganha mato onde o
        # laser mede mato; o matagal parte-se logo a seguir como o resto
        cresce = esparsa & (base == 10) & (h >= 0.5) & (h < a.arvore_min)
        # e ao contrario: a COS diz floresta e o laser nao encontra nada de pe.
        # Nao e engano da COS -- ela responde a "que povoamento e este", e um
        # pinhal ardido continua a ser um pinhal. O laser responde a outra
        # pergunta, "o que esta ca hoje", e e essa que faz falta a quem anda la.
        arde = np.isin(base, [4, 5])
        raso = (h < 0.5) & arde                    # chao nu: ver classe 10
        rege = (h >= 0.5) & (h < a.arvore_min) & arde   # regeneracao baixa
        base = np.where(subiu, 5, base)
        base = np.where(cresce, 6, base)
        base = np.where(rege, 6, base)
        base = np.where(raso, 10, base)    # chao nu, nao pastagens: ver CLASSES
        C = (base | corr).astype(np.uint8)
        ac = a.classe * a.classe / 1e6
        print('casas protegidas da promocao: %d poligonos' % ncasa)
        print('a medicao corrigiu a carta:')
        print('   +%.2f km2 de arvores que a COS nao tinha' % (subiu.sum() * ac))
        print('   -%.2f km2 que a COS diz floresta e mede menos de %.1f m'
              '  (%.2f raso, %.2f regeneracao)'
              % ((raso.sum() + rege.sum()) * ac, a.arvore_min,
                 raso.sum() * ac, rege.sum() * ac))
        if esparsa.any():
            ce = collections.Counter((base[esparsa]).ravel().tolist())
            print('   vegetacao esparsa da COS (%.2f km2) medida: ' % (esparsa.sum() * ac)
                  + '  '.join('%s %.2f' % (NOME.get(k, k), n * ac) for k, n in ce.most_common(5)))

        # --- abaixo de 0,5 m o laser nao ve o que e; o satelite ve se e verde
        # "Chao nu" era uma afirmacao que a medicao nao sustentava: o LiDAR so
        # diz "< 0,5 m", e a fotografia do Covao da Ametade mostra clareiras de
        # erva onde o mapa punha chao pelado. Medido no Sentinel de Julho de
        # 2024: as celulas que eram "chao nu" tem NDVI mediano 0,39 (P90 0,62);
        # a rocha da COS tem 0,24; a pastagem 0,59. Regra, so onde o laser mede
        # menos de 0,5 m e a classe e aberta (erva, mato, chao nu):
        #   NDVI >= 0,50  erva (3)     0,25..0,50  rasteiro (6)     < 0,25  chao nu (10)
        # Sem --ndvi nao se afirma nada: fica rasteiro (6), que nao desenha nada
        # abaixo de 0,3 m. (Isto nao contradiz O_Satelite_Nao_Separa_Rocha.md:
        # la tentou-se separar rocha de mato ralo; aqui separa-se verde de nao
        # verde, que e o que o NDVI mede mesmo.)
        base = C & 127; corr = C & 128
        baixo = (h < 0.5) & np.isin(base, [3, 6, 10])
        if a.ndvi:
            zn, cn = le_mdt(a.ndvi); tapa_caixa(cn, a.caixa, 'NDVI')
            vn = amostra(zn, cn, lonsC, latsC)
            NDVI = np.where(vn >= 254, np.nan, vn / 127.5 - 1)
            ok = baixo & ~np.isnan(NDVI)
            base = np.where(ok & (NDVI >= 0.5), 3, base)
            base = np.where(ok & (NDVI >= 0.25) & (NDVI < 0.5), 6, base)
            base = np.where(ok & (NDVI < 0.25), 10, base)
            # o urbano da COS sem edificio e verde e relvado, nao asfalto: o
            # parque de campismo do Covao e "Turismo" e tem NDVI 0,80
            relva = (base == 1) & (CASA_LARGA == 0) & (h < a.arvore_min) & ~np.isnan(NDVI) & (NDVI >= 0.5)
            base = np.where(relva, 3, base)
            print('abaixo de 0,5 m, pelo NDVI: erva %.2f  rasteiro %.2f  chao nu %.2f km2;'
                  ' urbano relvado %.2f km2; sem NDVI %.2f km2'
                  % (((base == 3) & baixo).sum() * ac, ((base == 6) & baixo).sum() * ac,
                     ((base == 10) & baixo).sum() * ac, relva.sum() * ac,
                     (baixo & np.isnan(NDVI)).sum() * ac))
        else:
            base = np.where(baixo & (base == 10), 6, base)
            print('sem --ndvi: o que mede < 0,5 m fica rasteiro; "chao nu" nao se afirma')
        C = (base | corr).astype(np.uint8)

        # --- o mato partido em dois pela medicao
        # Giesta e urze alta de 2 ou 3 m nao se andam como se anda num urzal
        # rasteiro de meio metro, e ate agora eram a mesma classe, a mesma cor
        # e a mesma altura desenhada. Nao e uma classe nova da carta: e a mesma
        # classe 6 partida pelo que o laser mediu.
        base = C & 127; corr = C & 128
        alto = (h >= a.matagal_min) & (base == 6)
        base = np.where(alto, 11, base)
        C = (base | corr).astype(np.uint8)
        print('mato partido pela altura medida: %.2f km2 acima de %.1f m (matagal),'
              ' %.2f km2 abaixo (rasteiro)'
              % (alto.sum() * ac, a.matagal_min, ((C & 127) == 6).sum() * ac))

        # O motor so le a altura medida onde nasce alguma coisa (as classes com
        # lam: montado, floresta, matos, matagal, rocha). Fora disso o byte nunca e lido
        # -- e um byte de ruido do CHM que so estorva o gzip. Zera-se.
        # O 11 TEM de estar nesta lista. O motor passou a nao plantar nada onde a
        # altura medida e zero; se se zerasse o ALTV do matagal aqui, ele
        # desaparecia todo do desenho -- apagado por uma optimizacao de tamanho.
        # O CHM mede COPA, e um telhado de 6 m e, para o laser, 6 m de coisa
        # acima do chao. Ate aqui as casas so estavam protegidas da PROMOCAO a
        # floresta; a ALTURA continuava a vir do telhado. Numa celula de matos
        # isso dava um arbusto de 6 m em cima da casa -- e desde que a medicao
        # passou a mandar, ficou pior, porque a altura do telhado passou a ser
        # respeitada. Zera-se o ALTV sobre o edificio: la nao ha planta nenhuma,
        # ha uma casa, e a casa desenha-se como casa.
        ALTV = np.where(CASA_JUSTA > 0, 0, ALTV).astype(np.uint8)
        print('altura zerada sobre %d celulas de casa (o laser via telhados como copa)'
              % int((CASA_JUSTA > 0).sum()))

        usa = np.isin(C & 127, [4, 5, 6, 7, 11])
        ALTV = np.where(usa, ALTV, 0).astype(np.uint8)
        print('altura guardada so onde nasce alguma coisa: %.0f%% do bloco a zero'
              % (100.0 * (~usa).sum() / usa.size))

        arv = np.isin(C & 127, [4, 5])
        if arv.any():
            print('altura medida onde ha arvores: media %.1f m, maximo %.1f m'
                  % (ALTV[arv].mean() / 10, ALTV[arv].max() / 10))
            cont = np.bincount((C & 127).ravel(), minlength=10)
            print('   depois do CHM:  ' + '  '.join(
                '%s %.1f' % (NOME.get(k, k), cont[k] * ac)
                for k in range(10) if cont[k]))
        else:
            print('CHM lido, mas nem a COS nem a medicao acharam arvores na caixa')

    # --- a agua do OSM, so onde uma superficie de agua pode existir
    # Os poligonos aguaA incluem RIBEIRAS desenhadas como area, com metros de
    # largura, em encostas de 17 graus de declive medio. Uma superficie de agua
    # nao fica de pe numa encosta: ou e um lago e e plana, ou e uma linha de
    # agua e nao e uma superficie. O boletim apanhou isto -- 24% da agua da
    # versao anterior estava em declive acima de 12 graus.
    plano = DEC < a.agua_graus if a.mdt else np.ones((my, mx), bool)
    vale = (AGUA_OSM > 0) & plano
    ac0 = a.classe * a.classe / 1e6
    # O OSM desenha lagoas que em Julho estao secas (a da Nave a NE do Covao:
    # fundo castanho no ortofoto, COS pastagem, Sentinel sem agua). Uma lagoa
    # sazonal nao e um espelho de agua nem e pasto seco: e zona humida (12).
    # So fica agua onde a COS ja diz agua; o Sentinel confirma-a mais abaixo.
    corr_ = C & 128; base_ = C & 127
    ja_agua = base_ == 9
    sazonal = vale & ~ja_agua
    C = (np.where(sazonal, 12, base_) | corr_).astype(np.uint8)
    print('agua do OSM: %d poligonos, %.2f km2 ja eram agua na COS, %.2f km2 sem agua na COS'
          ' passam a zona humida (lagoa sazonal), %.2f km2 recusados por declive >= %.0f graus'
          % (n_ag, (vale & ja_agua).sum() * ac0, sazonal.sum() * ac0,
             ((AGUA_OSM > 0) & ~plano).sum() * ac0, a.agua_graus))

    # --- paredes e escarpas: isto nao e uma classe de ocupacao, e geometria
    # "Rocha" sao duas coisas que o motor tratava como uma so: blocos POUSADOS
    # num chao de declive suave, e o terreno de pe. Plantar uma pedra de 2 m --
    # ou um arbusto -- numa parede dos Cantaros nao e rocha, e um erro que se
    # ve. Medido antes desta regra existir, na caixa de Manteigas: 0,76 km2 de
    # encosta acima de 50 graus estavam a levar matos, e 0,36 km2 acima de 40
    # levavam arvores.
    #
    # Nao precisa de satelite: o declive chega, e sai do MDT que ja esta aqui.
    # So com --mdt, porque num DEM de 30 m o declive nao encontra uma escarpa.
    # E so onde o laser nao ve nada de pe: se o CHM mediu copa naquela celula,
    # ha mesmo arvore agarrada a encosta e a medicao continua a mandar.
    if a.mdt:
        dec = DEC
        base = C & 127; corr = C & 128
        # "Sem nada de pe" aqui quer dizer sem ARVORE, nao sem um tufo de urze
        # agarrado a uma fenda. O limiar e o mesmo --arvore-min do resto: numa
        # parede a 45 graus, um arbusto desenhado de pe esta tao errado como
        # uma pedra. Arvore agarrada a encosta, essa fica -- existe mesmo.
        nu = (ALTV < a.arvore_min * 10) if ALTV is not None else np.ones_like(base, bool)
        parede = (dec >= a.parede_graus) & nu & (base != 9)
        C = (np.where(parede, 8, base) | corr).astype(np.uint8)
        ac = a.classe * a.classe / 1e6
        print('paredes de rocha (declive >= %.0f graus, sem copa medida): %.2f km2'
              % (a.parede_graus, parede.sum() * ac))
        antes = collections.Counter(base[parede].ravel().tolist())
        if antes:
            print('   deixaram de ser:  ' + '  '.join(
                '%s %.2f' % (NOME.get(k, k), n * ac) for k, n in antes.most_common(4)))

    # --- agua medida, e por ultimo porque ganha a tudo
    # A COS perdeu a agua: o saco do 'outro' eram as classes 7, 8 e 9 juntas e
    # nao se distinguem. Esta mascara vem do Sentinel-2 (NDWI) cruzado com a
    # Copernicus Water and Wetness -- 0,57 km2 de cada fonte, 0,50 de
    # interseccao, 89% de concordancia entre duas fontes independentes uma da
    # outra e do nosso mapa, e o MDT a confirmar 0,6 graus de declive na maior
    # massa. Tres fontes no mesmo sitio: e a classe em que temos mais confianca
    # de todas, por isso e a ultima a escrever e nao ha regra que lhe passe por
    # cima -- nem a da parede.
    if a.agua:
        if a.agua == 'armazem:agua':
            # persistencia: agua em >= 75% dos meses com dado de 2024. Um mes so
            # apanha sombra de encosta (NDWI > 0 em vertente a norte no Inverno)
            # e lagoas sazonais; a persistencia atravessa o Verao e limpa as duas.
            za, ca, meses = fontes.agua_permanente(a.fontes, a.caixa)
            print('agua permanente: %d meses de 2024 (%s), agua em >= 75%% deles'
                  % (len(meses), ' '.join(meses)))
        else:
            za, ca = le_mdt(a.agua)
        tapa_caixa(ca, a.caixa, 'mapa de agua')
        lonsA = np.linspace(lo0, lo1, mx); latsA = np.linspace(la1, la0, my)
        passo_ag = abs(ca[2] - ca[0]) / za.shape[1] * mlon
        if a.classe >= 4 * passo_ag:
            mask = amostra_grossa(za, ca, lonsA, latsA, 4, 'media') >= 0.5
        else:
            mask = amostra(za, ca, lonsA, latsA) > 0.5
        base = C & 127; corr = C & 128
        # tambem a agua medida obedece ao declive: agua persistente numa encosta
        # de 12 graus e o registo do satelite a escorregar na margem de uma
        # albufeira, nao agua (c4r6, 21/09/2026: 'agua e plana' chumbava por isso)
        mask = mask & plano
        novo_ag = mask & (base != 9)
        C = (np.where(mask, 9, base) | corr).astype(np.uint8)
        ac = a.classe * a.classe / 1e6
        print('agua medida: %.2f km2  (%.2f km2 que a COS nao tinha)'
              % (mask.sum() * ac, novo_ag.sum() * ac))

    # --- curvas de nivel (ja vem dos azulejos: nao ha nada a calcular)
    curvas = []
    for props, g in ([] if a.sem_curvas else sem_repetir(
            (p, gt, gs) for p, gt, gs in varre(pm, a.caixa, a.zsolo, 'curvas') if gt == 2)):
        curvas.append((int(props.get('alt') or 0), int(props.get('g') or 0), g))
    print('curvas de nivel: %d linhas, %s pontos'
          % (len(curvas), f'{sum(len(g) for _,_,g in curvas):,}'))

    # --- pontos com nome
    pontos = []
    vistos = set()
    for props, gt, gs in varre(pm, a.caixa, a.zsolo, 'pontos'):
        if gt != 1: continue
        k = props.get('k') or 'info'
        n = (props.get('n') or '').strip()
        for g in gs:
            for (lo, la) in g:
                if not (lo0 <= lo <= lo1 and la0 <= la <= la1): continue
                ch = (round(lo, 5), round(la, 5), n)
                if ch in vistos: continue
                vistos.add(ch)
                pontos.append((k, n, lo, la, int(props.get('alt') or 0)))
    print('pontos com nome: %d' % len(pontos))

    # --- casas
    # Ele disse que as casas se confundiam com as arvores, e confundiam-se
    # porque nao existiam: o urbano era so uma cor no chao. Os contornos sao
    # reais, do OSM. A ALTURA E MODELADA e diz-se que e.
    #
    # Tentou-se medi-la no CHM e nao da: a casa mediana tem 75 m2, ou seja tres
    # celulas de 5 m, e a reamostragem por media dilui o telhado contra o chao
    # a volta -- 90% das casas sairam com 0 a 2 m. O instrumento e grosso demais
    # para o objecto. Com um CHM a 2 m mediam-se de verdade; fica anotado.
    CASA = None
    if not a.sem_casas:
        alt_casa = lambda m2: 3.0 if m2 < 40 else (6.5 if m2 < 200 else 8.0)
        V = []
        n_casa = 0; n_med = 0
        vistas = set()
        for anel, h_med in zip(contornos_casas, alturas_casas):
            if len(anel) < 4: continue
            P = [((lo - lo0) * mlon, (la - la0) * mlat) for lo, la in anel]
            if P[0] == P[-1]: P.pop()
            if len(P) < 3: continue
            # O varre() le azulejos INTEIROS, e um edificio a cavalo de dois
            # aparece nos dois. Sem isto desenhavam-se 58 casas duas vezes, uma
            # dentro da outra, a brigar pelo z-buffer.
            ch = (round(P[0][0], 1), round(P[0][1], 1), len(P))
            if ch in vistas: continue
            vistas.add(ch)
            # Pelo CENTRO, nao por todos os cantos: uma casa a cavalo da borda
            # da caixa e uma casa, e antes caia fora inteira.
            cxm = sum(x for x, _ in P) / len(P); cym = sum(y for _, y in P) / len(P)
            if not (0 <= cxm <= larg_m and 0 <= cym <= alt_m): continue
            P = [(min(larg_m, max(0.0, x)), min(alt_m, max(0.0, y))) for x, y in P]
            # area por formula do laco
            k = len(P)
            m2 = abs(sum(P[i][0] * P[(i + 1) % k][1] - P[(i + 1) % k][0] * P[i][1]
                         for i in range(k))) / 2
            if m2 < 8 or m2 > 20000: continue
            # assenta no ponto MAIS BAIXO do contorno: numa encosta, se cada
            # canto seguisse a sua cota o edificio saia torcido, e se seguisse o
            # mais alto ficava a flutuar de um lado
            cot = [float(Z[min(ny - 1, max(0, int(round((alt_m - y) / alt_m * (ny - 1))))),
                           min(nx - 1, max(0, int(round(x / larg_m * (nx - 1)))))]) for x, y in P]
            base = min(cot)
            # altura medida pela fonte quando a traz (Microsoft, onde tem);
            # senao MODELADA pela area, e o boletim diz que e
            topo = base + (h_med if h_med else alt_casa(m2))
            n_med += 1 if h_med else 0
            for i in range(k):                                    # paredes
                x0, y0 = P[i]; x1, y1 = P[(i + 1) % k]
                V += [x0, y0, base, x1, y1, base, x0, y0, topo,
                      x0, y0, topo, x1, y1, base, x1, y1, topo]
            for i0, i1, i2 in orelhas(P):                         # telhado
                for ii in (i0, i1, i2): V += [P[ii][0], P[ii][1], topo]
            n_casa += 1
        if V:
            A3 = np.array(V, dtype=np.float32).reshape(-1, 3)
            q = np.empty(A3.shape, dtype=np.uint16)
            q[:, 0] = np.clip(A3[:, 0] / larg_m, 0, 1) * 65535
            q[:, 1] = np.clip(A3[:, 1] / alt_m, 0, 1) * 65535
            # escala em z PROPRIA, nao a do terreno: um telhado na Torre fica
            # acima da cota mais alta da caixa, e com a escala do terreno era
            # cortado rente -- as casas mais altas perdiam a altura toda.
            zc0 = float(A3[:, 2].min()); zc1 = float(A3[:, 2].max())
            q[:, 2] = np.clip((A3[:, 2] - zc0) / max(1e-6, zc1 - zc0), 0, 1) * 65535
            CASA = struct.pack('<Iff', len(q), zc0, zc1) + q.tobytes()
            print('casas: %d edificios, %s vertices, %.2f MB'
                  ' (contornos %s; altura medida em %d, MODELADA nas outras)'
                  % (n_casa, f'{len(q):,}', len(CASA) / 1e6,
                     ' + '.join(sorted(fontes_casas)) or 'nenhum', n_med))
        else:
            print('casas: nenhuma dentro da caixa')

    # --- horizonte, na sua propria grelha
    # O horizonte e um campo LISO: entre dois nos a 25 m o angulo a que o monte
    # tapa o ceu quase nao muda. A grelha das cotas, essa, quer ser fina -- com
    # o MDT de 2 m da DGT queremos 8 m. Amarrar as duas custa caro e nao paga:
    # a 8 m o bloco HORI sozinho sao 33,6 MB por comprimir, contra 3,4 a 25 m.
    # O motor ja lia nx/ny do cabecalho do proprio bloco e amostra a textura em
    # coordenadas normalizadas com LINEAR, por isso nada muda do lado de la.
    H = None; hx = hy = 0
    if not a.sem_horizonte:
        ph = a.passo_horizonte or a.passo
        hx = int(round(larg_m / ph)) + 1
        hy = int(round(alt_m / ph)) + 1
        # O horizonte tem de ver para FORA da caixa: um cume a 3 km da borda
        # tapa o sol la dentro e antes nao existia (so se conhecia o relevo da
        # propria caixa, ate 4 km). Com o MDT do armazem, amostra-se uma
        # moldura de --alcance a volta e calcula-se so para os nos da caixa.
        margem = 0.0
        if a.mdt == 'armazem:mdt8':
            mlo = a.alcance / mlon; mla = a.alcance / mlat
            caixa_h = (lo0 - mlo, la0 - mla, lo1 + mlo, la1 + mla)
            try:
                zh, cxh = fontes.raster_mosaico(a.fontes, 'mdt8', caixa_h, preenche='minimo')
                # a moldura pode ficar mais curta onde acaba a area de construcao
                caixa_h = (max(caixa_h[0], cxh[0]), max(caixa_h[1], cxh[1]),
                           min(caixa_h[2], cxh[2]), min(caixa_h[3], cxh[3]))
                margem = a.alcance
            except SystemExit:
                zh, cxh = z, cx
        if margem:
            # grelha estendida com o MESMO passo e alinhada aos nos da caixa
            ex0 = int(math.ceil((lo0 - caixa_h[0]) * mlon / ph)); ex1 = int(math.ceil((caixa_h[2] - lo1) * mlon / ph))
            ey0 = int(math.ceil((caixa_h[3] - la1) * mlat / ph)); ey1 = int(math.ceil((la0 - caixa_h[1]) * mlat / ph))
            dlo = (lo1 - lo0) / (hx - 1); dla = (la1 - la0) / (hy - 1)
            lonsH = lo0 + dlo * np.arange(-ex0, hx + ex1); latsH = la1 - dla * np.arange(-ey0, hy + ey1)
            lonsH = np.clip(lonsH, cxh[0], cxh[2]); latsH = np.clip(latsH, cxh[1], cxh[3])
            Zh = amostra(zh, cxh, lonsH, latsH).astype(np.float32)
            H = horizonte(Zh, larg_m / (hx - 1), alt_m / (hy - 1), a.dir, a.alcance,
                          janela=(ey0, ex0, hy, hx))
        else:
            if (hx, hy) == (nx, ny):
                Zh = Z
            else:
                Zh = amostra(z, cx, np.linspace(lo0, lo1, hx),
                             np.linspace(la1, la0, hy)).astype(np.float32)
            H = horizonte(Zh, larg_m / (hx - 1), alt_m / (hy - 1), a.dir, min(a.alcance, 4000.0))
        print('mapa de horizonte: %d x %d (passo %.0f m), %d direccoes, %.2f MB, ve ate %.0f km%s'
              % (hx, hy, ph, a.dir, H.nbytes / 1e6, (margem or min(a.alcance, 4000.0)) / 1000,
                 ' com moldura fora da caixa' if margem else ' SO DENTRO DA CAIXA'))
        print('   horizonte medio %.1f graus, maximo %.1f'
              % (H.mean() / 2, H.max() / 2))

    # ------------------------------------------------------------ escrever
    saida = bytearray(b'TERR' + struct.pack('<HH', 2, 0))
    saida += bloco('BBOX', struct.pack('<dddd', lo0, la0, lo1, la1))
    saida += bloco('COTA', struct.pack('<HHfff', nx, ny, a.passo, z0, z1)
                   + np.round((Z - z0) / (z1 - z0) * 65535).astype(np.uint16).tobytes())
    saida += bloco('CLAS', struct.pack('<HHf', mx, my, a.classe) + C.tobytes())

    def linhas_bloco(tag, lista, extra=None):
        comp = np.array([len(g) for g in lista], dtype=np.uint32)
        pts = np.empty((int(comp.sum()), 2), dtype=np.float32)
        k = 0
        for g in lista:
            for (lo, la) in g:
                pts[k, 0] = lo; pts[k, 1] = la; k += 1
        c = struct.pack('<I', len(lista)) + comp.tobytes()
        if extra is not None: c += extra.tobytes()
        return bloco(tag, c + pts.tobytes())

    saida += linhas_bloco('ROTA', rotas)
    saida += linhas_bloco('CAMS', [g for _, _, g, _ in cams],
                          np.array([[t, piso] for t, _, _, piso in cams], dtype=np.int16))
    saida += linhas_bloco('CURV', [g for _, _, g in curvas],
                          np.array([[alt, gr] for alt, gr, _ in curvas], dtype=np.int16))
    corpo = bytearray(struct.pack('<I', len(pontos)))
    for k, n, lo, la, alt in pontos:
        kb = k.encode('utf-8')[:20]; nb = n.encode('utf-8')[:60]
        corpo += struct.pack('<ffHBB', lo, la, alt, len(kb), len(nb)) + kb + nb
    saida += bloco('PONT', corpo)
    if ALTV is not None:
        if not a.sem_plantas:     # sem plantas ninguem le a altura; 2,5 MB a menos
            saida += bloco('ALTV', struct.pack('<HH', mx, my) + ALTV.tobytes())
    if CASA is not None:
        saida += bloco('CASA', CASA)
    if H is not None:
        saida += bloco('HORI', struct.pack('<HHH', hx, hy, a.dir) + H.tobytes())

    ficheiro = '%s-v%d.terr.gz' % (a.nome, a.versao)
    pasta = os.path.join(RAIZ, 'dados/terreno')
    os.makedirs(pasta, exist_ok=True)
    dest = os.path.join(pasta, ficheiro)
    with gzip.open(dest, 'wb', compresslevel=9) as f:
        f.write(bytes(saida))
    print('\n%s' % dest)
    print('  por comprimir %.2f MB   comprimido %.2f MB'
          % (len(saida) / 1e6, os.path.getsize(dest) / 1e6))

    # --- o boletim, antes do indice e nao depois
    # Regra do projecto, pedida por ele: "nao quero que estejas a corrigir o
    # problema imagem a imagem; quero como deve ser, porque agora e uma area
    # pequena e quando for grande ou nova nao sei afirmar."
    #
    # Uma zona so entra no indice -- ou seja, so passa a ser a zona que a
    # aplicacao carrega -- se nenhuma VERIFICACAO falhar. O ficheiro cozido
    # fica sempre no disco para se poder olhar; o que nao acontece e passar a
    # ser publicado sem ninguem saber que falhou.
    import subprocess
    print()
    bol = subprocess.run([sys.executable, os.path.join(os.path.dirname(os.path.abspath(__file__)),
                                                       'confere.py'), dest,
                          '--casas-fonte', ' + '.join(sorted(fontes_casas)) or 'nenhuma',
                          '--classes-fonte', fonte_cos],
                         capture_output=True, text=True)
    print(bol.stdout, end='')
    if bol.stderr.strip(): print(bol.stderr.strip())
    if bol.returncode != 0 and not a.sem_boletim:
        print('\nO INDICE NAO FOI ESCRITO. A zona anterior continua a ser a publicada.')
        print('O ficheiro cozido esta em %s, para se poder olhar.' % dest)
        print('Corrige o que falhou, ou volta a cozer com --sem-boletim se souberes')
        print('o que estas a fazer e escreveres porque.')
        sys.exit(2)

    # --- o indice, que e por onde a aplicacao sabe que esta zona existe.
    # Cozer uma zona nova e so correr isto: o menu apanha-a sozinho.
    import json
    ip = os.path.join(pasta, 'index.json')
    idx = {'zonas': []}
    if os.path.exists(ip):
        try: idx = json.load(open(ip, encoding='utf-8'))
        except Exception: pass
    zonas = [z for z in idx.get('zonas', []) if z.get('nome') != a.nome]
    zonas.append({
        'nome': a.nome,
        'titulo': a.titulo or a.nome.replace('-', ' ').title(),
        'ficheiro': ficheiro,
        'caixa': [round(v, 6) for v in a.caixa],
        'km': [round(larg_m / 1000, 1), round(alt_m / 1000, 1)],
        'passo': a.passo, 'classe': a.classe,
        'cota': [round(z0), round(z1)],
        'fonte': fonte,
        'fontes': {'classes': fonte_cos, 'mdt': a.mdt or 'Copernicus 30 m', 'chm': a.chm, 'vias': fonte_vias,
                   'agua': a.agua, 'horizonte_km': round((margem or min(a.alcance, 4000.0)) / 1000) if H is not None else None,
                   'casas': ' + '.join(sorted(fontes_casas)) or None,
                   'penedos_rejeitados': n_penedo},
        'bytes': os.path.getsize(dest),
        'tem': {'curvas': bool(curvas), 'pontos': bool(pontos), 'rotas': bool(rotas),
                'caminhos': bool(cams), 'sombra': H is not None,
                'casas': CASA is not None,
                'plantas': not a.sem_plantas,
                'altura_medida': ALTV is not None},
    })
    zonas.sort(key=lambda z: z['titulo'])
    idx['zonas'] = zonas
    json.dump(idx, open(ip, 'w', encoding='utf-8'), ensure_ascii=False, indent=1)
    print('  indice: %s (%d zona%s)' % (ip, len(zonas), '' if len(zonas) == 1 else 's'))


if __name__ == '__main__':
    main()

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
import numpy as np

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from lepmtiles import PM, mvt_camadas, aneis

RAIZ = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
# Sobe sempre que o CONTEUDO mudar. Vai no nome do ficheiro, nao numa query:
# a regra do service worker para dados/ e cache primeiro e com ignoreSearch,
# ou seja a ignorar a query -- so o caminho e que ela nao sabe ignorar.
VERSAO_DADOS = 3
DEM_CAIXA = (-8.1, 40.0, -7.15, 40.7)

TAB_G = {'urbano': 1, 'agricola': 2, 'floresta': 3, 'matos': 4,
         'rocha': 5, 'agua': 6, 'outro': 7}
NOME = {0: 'nada', 1: 'urbano', 2: 'agricola', 3: 'pastagens', 4: 'montado',
        5: 'floresta', 6: 'matos', 7: 'rocha', 9: 'agua'}
# generos de ponto que valem a pena carregar
PONTOS = ['cume', 'povoacao', 'aldeia', 'abrigo', 'agua', 'miradouro', 'info',
          'parque', 'cascata', 'lagoa']

# Por onde se anda nao cresce mato. Cada genero tem a sua largura limpa, de
# cada lado do eixo: uma nacional abre mais do que um trilho de cabras.
# Nao e enfeite -- e o que faz o caminho ler-se de cima por entre as copas.
TIPO_CAM = {'nacional': 0, 'estrada': 1, 'estradao': 2, 'caminho': 3, 'trilho': 4}
LIMPO = {'nacional': 11.0, 'estrada': 9.0, 'estradao': 6.0, 'caminho': 5.0, 'trilho': 4.0}


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
def pinta(destino, gs, cod, caixa, mx, my):
    lo0, la0, lo1, la1 = caixa
    kx = mx / (lo1 - lo0); ky = my / (la1 - la0)
    A = []
    for anel in gs:
        n = len(anel)
        for i in range(n):
            ax, ay = anel[i]; bx, by = anel[(i + 1) % n]
            if ay == by: continue
            A.append(((ax - lo0) * kx, (ay - la0) * ky, (bx - lo0) * kx, (by - la0) * ky))
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
def horizonte(Z, passo_x, passo_y, ndir, alcance_m):
    """Para cada no e cada direccao, o angulo a que o terreno tapa o ceu.

    E o que permite sombra a serio: ao desenhar, compara-se a altura do sol
    com este angulo na direccao do sol. Se o sol vier mais baixo do que o
    horizonte, aquele ponto esta a sombra de um monte -- que e o que interessa
    a quem anda na serra ao fim da tarde.

    Guarda-se em graus/0.5 num byte (0..180 = 0..90 graus).
    """
    ny, nx = Z.shape
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
            ii = np.clip(np.arange(nx)[None, :] + di, 0, nx - 1).astype(np.int32)
            jj = np.clip(np.arange(ny)[:, None] + dj, 0, ny - 1).astype(np.int32)
            np.maximum(maxang, (Z[jj, ii] - Z) / dist, out=maxang)
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
    ap.add_argument('--zsolo', type=int, default=15)
    ap.add_argument('--titulo', default=None, help='como aparece no menu da aplicacao')
    ap.add_argument('--versao', type=int, default=VERSAO_DADOS,
                    help='vai no NOME do ficheiro: e a unica coisa que a cache do '
                         'telemovel nao sabe ignorar (ver ARMADILHAS 10)')
    ap.add_argument('--dir', type=int, default=16, help='direccoes do mapa de horizonte')
    ap.add_argument('--sem-horizonte', action='store_true')
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

    if a.mdt:
        z, cx = le_mdt(a.mdt); fonte = 'MDT ' + os.path.basename(a.mdt)
    else:
        z, cx = le_dem(); fonte = 'Copernicus 30 m'
    lons = np.linspace(lo0, lo1, nx); lats = np.linspace(la1, la0, ny)
    Z = amostra(z, cx, lons, lats).astype(np.float32)
    z0, z1 = float(Z.min()), float(Z.max())
    print('cotas de %.1f a %.1f m   (%s)' % (z0, z1, fonte))
    if z1 - z0 < 1: sys.exit('a caixa nao apanhou relevo nenhum')

    pm = PM(os.path.join(RAIZ, 'dados/topo.pmtiles'))

    # --- classes
    C = np.zeros((my, mx), dtype=np.uint8)
    n_sol = 0
    for props, gt, gs in varre(pm, a.caixa, a.zsolo, 'solo'):
        if gt != 3: continue
        c = props.get('c')
        cod = int(c) if c is not None else TAB_G.get(props.get('g'), 0)
        if not cod: continue
        pinta(C, gs, cod, a.caixa, mx, my); n_sol += 1
    n_ag = 0
    for props, gt, gs in varre(pm, a.caixa, a.zsolo, 'aguaA'):
        if gt != 3: continue
        pinta(C, gs, 9, a.caixa, mx, my); n_ag += 1
    print('poligonos: solo %d, agua %d' % (n_sol, n_ag))

    # --- percursos
    rotas = [g for props, g in sem_repetir(
        (p, gt, gs) for p, gt, gs in varre(pm, a.caixa, a.zsolo, 'rotas') if gt == 2)]
    npt = sum(len(l) for l in rotas)
    print('percursos: %d tracados, %s pontos' % (len(rotas), f'{npt:,}'))

    # --- estradas, estradoes, caminhos e trilhos
    cams = []
    for props, g in sem_repetir(
            (p, gt, gs) for p, gt, gs in varre(pm, a.caixa, a.zsolo, 'caminhos') if gt == 2):
        t = props.get('t') or 'caminho'
        cams.append((TIPO_CAM.get(t, 3), t, g))
    porT = {}
    for _, t, _ in cams: porT[t] = porT.get(t, 0) + 1
    print('caminhos: %d (%s)' % (len(cams), ', '.join('%s %d' % kv for kv in sorted(porT.items()))))

    abre_corredor(C, rotas, a.caixa, mx, my, a.corredor)
    for t, r in LIMPO.items():
        ls = [g for tt, nome, g in cams if nome == t]
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
        zc, cc = le_mdt(a.chm)
        lonsC = np.linspace(lo0, lo1, mx); latsC = np.linspace(la1, la0, my)
        h = amostra(zc, cc, lonsC, latsC)
        # o CHM traz lixo: ramos soltos a 60 m e valores negativos
        h = np.clip(h, 0, 25.5)
        ALTV = np.round(h * 10).astype(np.uint8)
        dentro = (C & 127)
        arv = np.isin(dentro, [4, 5])
        if arv.any():
            print('altura medida onde ha arvores: media %.1f m, maximo %.1f m'
                  % (ALTV[arv].mean() / 10, ALTV[arv].max() / 10))
        else:
            print('CHM lido, mas a caixa nao tem floresta nem montado')

    # --- curvas de nivel (ja vem dos azulejos: nao ha nada a calcular)
    curvas = []
    for props, g in sem_repetir(
            (p, gt, gs) for p, gt, gs in varre(pm, a.caixa, a.zsolo, 'curvas') if gt == 2):
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

    # --- horizonte
    H = None
    if not a.sem_horizonte:
        px = larg_m / (nx - 1); py = alt_m / (ny - 1)
        H = horizonte(Z, px, py, a.dir, 4000.0)
        print('mapa de horizonte: %d direccoes, %.2f MB' % (a.dir, H.nbytes / 1e6))
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
    saida += linhas_bloco('CAMS', [g for _, _, g in cams],
                          np.array([[t, 0] for t, _, _ in cams], dtype=np.int16))
    saida += linhas_bloco('CURV', [g for _, _, g in curvas],
                          np.array([[alt, gr] for alt, gr, _ in curvas], dtype=np.int16))
    corpo = bytearray(struct.pack('<I', len(pontos)))
    for k, n, lo, la, alt in pontos:
        kb = k.encode('utf-8')[:20]; nb = n.encode('utf-8')[:60]
        corpo += struct.pack('<ffHBB', lo, la, alt, len(kb), len(nb)) + kb + nb
    saida += bloco('PONT', corpo)
    if ALTV is not None:
        saida += bloco('ALTV', struct.pack('<HH', mx, my) + ALTV.tobytes())
    if H is not None:
        saida += bloco('HORI', struct.pack('<HHH', nx, ny, a.dir) + H.tobytes())

    ficheiro = '%s-v%d.terr.gz' % (a.nome, a.versao)
    pasta = os.path.join(RAIZ, 'dados/terreno')
    os.makedirs(pasta, exist_ok=True)
    dest = os.path.join(pasta, ficheiro)
    with gzip.open(dest, 'wb', compresslevel=9) as f:
        f.write(bytes(saida))
    print('\n%s' % dest)
    print('  por comprimir %.2f MB   comprimido %.2f MB'
          % (len(saida) / 1e6, os.path.getsize(dest) / 1e6))

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
        'bytes': os.path.getsize(dest),
        'tem': {'curvas': bool(curvas), 'pontos': bool(pontos), 'rotas': bool(rotas),
                'caminhos': bool(cams), 'sombra': H is not None,
                'altura_medida': ALTV is not None},
    })
    zonas.sort(key=lambda z: z['titulo'])
    idx['zonas'] = zonas
    json.dump(idx, open(ip, 'w', encoding='utf-8'), ensure_ascii=False, indent=1)
    print('  indice: %s (%d zona%s)' % (ip, len(zonas), '' if len(zonas) == 1 else 's'))


if __name__ == '__main__':
    main()

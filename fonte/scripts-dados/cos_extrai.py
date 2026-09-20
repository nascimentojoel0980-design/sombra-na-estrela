# -*- coding: utf-8 -*-
"""Recorta a COS 2025 para a area da Estrela e escreve vec/solo_cos.geojson.

O que mudou em 18/09/2026, e porque:

  A versao anterior deste ficheiro traduzia os codigos da COS pela nomenclatura
  do CORINE. Nao e a mesma. No CORINE o nivel 1 vai ate 5; na COS vai ate 9, e
  a partir do 3 tudo desliza:

      codigo   COS 2025                          o que a versao velha dizia
      1        Territorios artificializados      urbano      (certo)
      2        Agricultura                       agricola    (certo)
      3        Pastagens                         floresta    ERRADO
      4        Sistemas agro-florestais          matos       ERRADO
      5        Florestas                         rocha       ERRADO
      6        Matos                             agua        ERRADO
      7        Espacos descobertos               outro       perdido
      8        Zonas humidas                     outro       perdido
      9        Corpos de agua                    outro       perdido

  Em casa do Joel isso dava 17 manchas de "rocha" que sao pinhal e zero de
  floresta; no planalto dava 12 manchas de "agua" que sao matos.

  Para isto nao voltar a acontecer sem se dar por ela, o ficheiro deixou de
  confiar so no numero: le tambem o rotulo de texto da COS e, se o rotulo
  contradisser o grupo atribuido, aborta e diz quais. Um mapa errado que corre
  ate ao fim e pior do que um script que rebenta.

Saida por poligono:
  c  digito de nivel 1 da COS (1..9) -- o dado cru, sem interpretacao
  g  grupo legivel derivado de c
  d  cobertura de copa em % (so quando medida)
  h  altura media de copa em m (so quando medida)
  m  1 se d e h vem de medicao LiDAR, 0 se vem de valor por defeito da classe

  O 'c' existe para o estilo poder decidir sozinho: e a propriedade que faltava
  quando o erro de cima passou despercebido. Quem le 'c' nunca herda um engano
  de traducao feito na construcao.
"""
import sqlite3, json, os, sys, argparse, unicodedata
from shapely import wkb
from shapely.geometry import box, mapping
from shapely.ops import transform
import pyproj

# ---------------------------------------------------------------- nomenclatura
# COS 2025, nivel 1. Fonte: DGT, Especificacoes Tecnicas da COS 2025 v1.
GRUPO = {
    '1': 'urbano',     # territorios artificializados
    '2': 'agricola',   # agricultura
    '3': 'erva',       # pastagens
    '4': 'montado',    # sistemas agro-florestais (arvore esparsa sobre pastagem)
    '5': 'floresta',   # florestas
    '6': 'matos',      # matos
    '7': 'rocha',      # espacos descobertos ou com pouca vegetacao
    '8': 'humida',     # zonas humidas
    '9': 'agua',       # corpos de agua
}

# Palavras que so aparecem no rotulo de um grupo. Servem de contraprova ao
# numero: se o texto diz "pinheiro" e o numero levou a mancha para 'rocha',
# alguem se enganou -- e este ficheiro nao continua a correr.
#
# 20/09/2026: corrida sobre a COS 2025 Serie 2 (area toda, 158 925 poligonos)
# apanhou 7 falsos positivos, todos da lista e nenhum dos dados:
#   'agricol' -> "Instalacoes agricolas, pecuarias e aquicolas" (n1=1, urbano)
#   'hortas'  -> "Espacos verdes e hortas comunitarias"          (n1=1, urbano)
#   'cultur'  -> "Aquicultura"                                   (n1=9, agua)
#   'folhos', 'resinos' -> "Superficies agrossilvicolas/silvopastoris de
#                           folhosas/resinosas"                  (n1=4, montado)
# Sairam 'agricol' (fica 'agricultura'), 'hortas', 'cultur' (fica 'culturas'),
# 'folhos' e 'resinos'. A prova definitiva para o gpkg e outra e nao precisa de
# palavras: codigo e rotulo bijectivos em n3/n4 e os 9 rotulos de n1 da Serie 2
# (4 = "Superficies agroflorestais (SAF)", 9 = "Massas de agua superficiais";
# os outros 7 iguais a Serie 1). Esta lista fica como segunda rede.
PALAVRAS = {
    'urbano':   ('tecido', 'industri', 'comerci', 'equipament', 'infraestrutur',
                 'extrac', 'inert', 'deposit', 'constru', 'urban', 'aeropor',
                 'portuar', 'rede viaria', 'ferroviar', 'desport', 'vazadour'),
    'agricola': ('culturas', 'cereais', 'arroz', 'horticol', 'vinha', 'pomar',
                 'olival', 'agricultura', 'temporari', 'estufas'),
    'erva':     ('pastagem', 'pastagens'),
    'montado':  ('agro-florest', 'agroflorest', 'sistemas agro', 'montado'),
    'floresta': ('florest', 'sobreiro', 'azinheira', 'eucalipto', 'pinheiro',
                 'carvalh', 'castanheir', 'acacia'),
    'matos':    ('matos', 'matagal', 'esclerofit'),
    'rocha':    ('rocha', 'rochos', 'praia', 'duna', 'areal', 'sem vegetacao',
                 'vegetacao esparsa', 'escassa', 'descobert', 'ardid'),
    'humida':   ('humid', 'sapal', 'sapais', 'salina', 'turfeir', 'paul'),
    'agua':     ('agua', 'aguas', 'curso de agua', 'lagoa', 'albufeira',
                 'oceano', 'estuar', 'lagunar'),
}

# Valores por defeito quando nao ha LiDAR. Sao estimativas de classe, nao
# medicoes -- por isso saem com m=0 e a aplicacao tem de o dizer ao utilizador.
DEFEITO = {                 # grupo: (cobertura %, altura de copa m)
    'floresta': (70, 14),
    'montado':  (30,  8),
    'matos':    (0,  1.0),
    'erva':     (0,  0.0),
    'agricola': (0,  0.0),
    'urbano':   (0,  0.0),
    'rocha':    (0,  0.0),
    'humida':   (0,  0.0),
    'agua':     (0,  0.0),
}

TRONCO = 3.0   # m: abaixo disto o LiDAR nao esta a ver arvore, esta a ver mato


def limpa(s):
    """minusculas sem acentos -- para comparar rotulos sem tropecar em 'a'/'a'."""
    s = unicodedata.normalize('NFD', (s or '').lower())
    return ''.join(ch for ch in s if unicodedata.category(ch) != 'Mn')


def grupos_do_rotulo(rot):
    t = limpa(rot)
    return {g for g, ps in PALAVRAS.items() if any(p in t for p in ps)}


def grupo(n1, n2, n3):
    """O digito de nivel 1 manda. n2/n3 so entram se n1 vier vazio."""
    c = (n1 or n2 or n3 or '').strip()
    return c[:1], GRUPO.get(c[:1], 'outro')


# ------------------------------------------------------------------- argumentos
ap = argparse.ArgumentParser()
ap.add_argument('--gpkg', default='cos/cos2025v1.gpkg')
ap.add_argument('--saida', default='vec/solo_cos.geojson')
ap.add_argument('--chm', nargs='*', default=[],
                help='GeoTIFF de altura de copa (CHM). Onde houver, d e h sao medidos.')
ap.add_argument('--area-min', type=float, default=4000.0, help='m2; abaixo disto nao se ve')
ap.add_argument('--simplifica', type=float, default=8.0, help='m')
A = ap.parse_args()

t = pyproj.Transformer.from_crs(4326, 3763, always_xy=True)
ti = pyproj.Transformer.from_crs(3763, 4326, always_xy=True)
x0, y0 = t.transform(-8.10, 40.00); x1, y1 = t.transform(-7.15, 40.70)
x0b, y0b = t.transform(-8.10, 40.70); x1b, y1b = t.transform(-7.15, 40.00)
X0, X1 = min(x0, x0b), max(x1, x1b); Y0, Y1 = min(y0, y1b), max(y1, y0b)
print('bbox 3763', round(X0), round(Y0), round(X1), round(Y1))


def gpkg_wkb(blob):
    # cabecalho GeoPackage: magic(2) ver(1) flags(1) srs(4) + envelope
    flags = blob[3]; env = (flags >> 1) & 0x07
    n = {0: 0, 1: 32, 2: 48, 3: 48, 4: 64}[env]
    return wkb.loads(blob[8 + n:])


# ------------------------------------------------------------------------ LiDAR
CHM = []
if A.chm:
    try:
        import rasterio
        from rasterio.mask import mask as rio_mask
    except ImportError:
        sys.exit('ERRO: --chm precisa do rasterio (pip install rasterio).')
    for p in A.chm:
        if not os.path.exists(p):
            sys.exit('ERRO: CHM nao encontrado: ' + p)
        CHM.append(rasterio.open(p))
        print('CHM', os.path.basename(p), CHM[-1].crs, CHM[-1].shape)


def copa(g3763):
    """(cobertura %, altura media m) medidos no CHM, ou None se a mancha nao
    cai em nenhum CHM. g3763 vem em EPSG:3763."""
    for src in CHM:
        try:
            gg = transform(pyproj.Transformer.from_crs(3763, src.crs, always_xy=True).transform, g3763)
            if not box(*src.bounds).contains(gg.centroid):
                continue
            arr, _ = rio_mask(src, [mapping(gg)], crop=True, filled=True, nodata=-9999)
            v = arr[0]
            v = v[(v > -100) & (v < 80)]
            if v.size < 25:
                continue
            arv = v[v >= TRONCO]
            cob = 100.0 * arv.size / v.size
            alt = float(arv.mean()) if arv.size else 0.0
            return round(cob), round(alt, 1)
        except Exception:
            continue
    return None


# ------------------------------------------------------------------------ corte
if not os.path.exists(A.gpkg):
    sys.exit('ERRO: nao encontrei ' + A.gpkg)
con = sqlite3.connect(A.gpkg); cur = con.cursor()
cur.execute("""SELECT c.geom, c.cos25v1_n1_c, c.cos25v1_n2_c, c.cos25v1_n3_c, c.cos25v1_n3_l
               FROM cos2025v1 c JOIN rtree_cos2025v1_geom r ON c.fid = r.id
               WHERE r.minx < ? AND r.maxx > ? AND r.miny < ? AND r.maxy > ?""",
            (X1, X0, Y1, Y0))
recorte = box(X0, Y0, X1, Y1)

os.makedirs(os.path.dirname(A.saida) or '.', exist_ok=True)
out = open(A.saida, 'w')
out.write('{"type":"FeatureCollection","features":[\n')

n = saltos = medidos = 0
primeiro = True
vistos = {}          # (codigo, rotulo) -> grupo, para a tabela no fim
contas = {}          # grupo -> n poligonos
choques = {}         # (codigo, rotulo, grupo, grupos_do_texto) -> n

for blob, n1, n2, n3, rot in cur:
    try:
        g = gpkg_wkb(blob)
    except Exception:
        saltos += 1; continue
    if not g.intersects(recorte):
        continue
    g = g.intersection(recorte)
    if g.is_empty or g.area < A.area_min:
        continue

    cod, grp = grupo(n1, n2, n3)

    # ---- a contraprova: o texto contradiz o numero?
    gt = grupos_do_rotulo(rot)
    if gt and grp not in gt:
        k = (cod, (rot or '')[:70], grp, ','.join(sorted(gt)))
        choques[k] = choques.get(k, 0) + 1

    # ---- copa: medida onde ha LiDAR, por defeito onde nao ha
    d, h, m = 0, 0.0, 0
    if grp in ('floresta', 'montado', 'matos'):
        med = copa(g) if CHM else None
        if med:
            d, h, m = med[0], med[1], 1; medidos += 1
        else:
            d, h = DEFEITO[grp]

    gs = g.simplify(A.simplifica)
    if gs.is_empty:
        continue
    gs = transform(ti.transform, gs)

    pr = {'c': int(cod) if cod.isdigit() else 0, 'g': grp}
    if d or h:
        pr['d'] = d; pr['h'] = h; pr['m'] = m
    ft = {'type': 'Feature', 'properties': pr, 'geometry': mapping(gs)}
    if not primeiro:
        out.write(',\n')
    out.write(json.dumps(ft, separators=(',', ':')))
    primeiro = False; n += 1
    vistos[(cod, (rot or '')[:60])] = grp
    contas[grp] = contas.get(grp, 0) + 1
    if n % 20000 == 0:
        print(n, flush=True)

out.write('\n]}')
out.close()

# ------------------------------------------------------------------- relatorio
print()
print('codigo -> rotulo -> grupo')
for (cod, rot), grp in sorted(vistos.items()):
    print('  %-2s %-60s %s' % (cod, rot, grp))
print()
print('poligonos por grupo:')
for grp, q in sorted(contas.items(), key=lambda kv: -kv[1]):
    print('  %-9s %7d' % (grp, q))
print()
print('poligonos', n, 'saltados', saltos, 'com copa medida', medidos,
      'MB', round(os.path.getsize(A.saida) / 1e6, 1))

if choques:
    print()
    print('!!! O ROTULO CONTRADIZ O CODIGO em %d combinacoes:' % len(choques))
    for (cod, rot, grp, gt), q in sorted(choques.items(), key=lambda kv: -kv[1]):
        print('  codigo %-2s "%s"' % (cod, rot))
        print('     atribuido: %-9s  o texto diz: %s   (%d poligonos)' % (grp, gt, q))
    print()
    print('A tabela GRUPO ou a tabela PALAVRAS esta errada. Corrige antes de')
    print('gerar azulejos: o ficheiro %s ficou escrito mas NAO deve ser usado.' % A.saida)
    sys.exit(2)

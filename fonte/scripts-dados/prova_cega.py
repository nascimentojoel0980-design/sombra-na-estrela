# -*- coding: utf-8 -*-
"""Prova cega: o mapa cozido contra o ortofoto da DGT, por amostragem.

Porque. Ele disse a coisa certa -- "tem de ser fiavel porque nao posso andar a
controlar uma area tao grande". Isso nao se resolve a caminhar: resolve-se por
amostragem cega, que e como se mede um classificador.

Tiram-se N celulas AO ACASO de cada classe, com semente fixa, e recorta-se o
ortofoto de 0,62 m/px por cima de cada uma. Os recortes vao BARALHADOS e SEM
ETIQUETA numa folha numerada; a chave fica num ficheiro a parte. Quem olha
escreve o que ve e SO DEPOIS se abre a chave -- ver a etiqueta primeiro faz
concordar com ela sem querer, e o numero deixa de valer nada.

Exige-se que a classe domine a janela toda do recorte (--pureza), senao a prova
era injusta: o que se testa e "quando o mapa diz X numa mancha de 60 m, e X?".
"""
import argparse, csv, glob, gzip, math, os, re, struct, sys
import numpy as np
from PIL import Image, ImageDraw

RAIZ = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
R = 6378137.0
NOME = {3: 'pastagem', 5: 'floresta', 6: 'mato rasteiro', 7: 'rocha com blocos',
        8: 'parede de rocha', 9: 'agua', 10: 'chao nu', 11: 'matagal'}


def merc(lo, la):
    return (lo / 180 * 20037508.342789244,
            math.log(math.tan(math.pi / 4 + math.radians(la) / 2)) * R)


def le_terreno(f):
    b = gzip.open(f, 'rb').read()
    i, B = 8, {}
    while i < len(b):
        t, n = struct.unpack_from('<4sI', b, i); i += 8
        B[t.decode()] = b[i:i + n]; i += n
    cx = struct.unpack_from('<dddd', B['BBOX'], 0)
    mx, my, pc = struct.unpack_from('<HHf', B['CLAS'], 0)
    C = np.frombuffer(B['CLAS'], dtype=np.uint8, offset=8).reshape(my, mx) & 127
    return C, cx, mx, my, pc


class Ortos:
    """os azulejos de detalhe, indexados pelo canto em Web Mercator"""
    def __init__(self, pasta):
        self.pasta = pasta
        xs = set()
        self.tem = set()
        for f in glob.glob(os.path.join(pasta, 'd_*.webp')):
            m = re.search(r'd_(-?\d+)_(\d+)', f)
            x, y = int(m.group(1)), int(m.group(2))
            xs.add(x); self.tem.add((x, y))
        ordenado = sorted(xs)
        self.passo = min((b - a for a, b in zip(ordenado, ordenado[1:]) if b > a),
                         default=1280)
        self.cache = {}

    def recorte(self, lo, la, lado_m, px_saida):
        x, y = merc(lo, la)
        tx = math.floor(x / self.passo) * self.passo
        ty = math.floor(y / self.passo) * self.passo
        if (tx, ty) not in self.tem:
            return None
        im = self.cache.get((tx, ty))
        if im is None:
            im = Image.open(os.path.join(self.pasta, 'd_%d_%d.webp' % (tx, ty))).convert('RGB')
            if len(self.cache) > 12: self.cache.clear()
            self.cache[(tx, ty)] = im
        mpp = self.passo / im.width
        px = int((x - tx) / mpp); py = int((ty + self.passo - y) / mpp)
        k = int(lado_m / mpp / 2)
        if px - k < 0 or py - k < 0 or px + k >= im.width or py + k >= im.height:
            return None
        return im.crop((px - k, py - k, px + k, py + k)).resize((px_saida, px_saida), Image.LANCZOS)


def realca(im, ref):
    """Clarear sem inventar.

    A primeira versao esticava CADA recorte pelos seus proprios percentis. Em
    imagens escuras e muito comprimidas isso amplifica o ruido do codec, nao o
    conteudo: saiu azul electrico e aos quadradinhos, e dois recortes ficaram
    azul chapado. Inutilizavel como prova.

    Agora o esticao e UM SO, calculado a partir de uma amostra grande do proprio
    ortofoto (ver escala_comum), e o mesmo para todos os recortes. Assim os
    recortes sao comparaveis entre si -- que e o ponto de uma folha de contacto
    -- e nenhum e esticado ate rebentar. So gama e corte nos extremos; a cor
    relativa entre canais nao se toca.
    """
    lo, hi, gama = ref
    a = np.asarray(im).astype(np.float32)
    a = np.clip((a - lo) / max(1.0, hi - lo), 0, 1) ** gama
    return Image.fromarray((a * 255).astype(np.uint8))


def escala_comum(O, amostras=40):
    """percentis 1 e 96 sobre uma amostra grande de azulejos, uma vez so"""
    fs = sorted(O.tem)
    if not fs: return (0.0, 255.0, 1.0)
    passo = max(1, len(fs) // amostras)
    v = []
    for (tx, ty) in fs[::passo][:amostras]:
        f = os.path.join(O.pasta, 'd_%d_%d.webp' % (tx, ty))
        if not os.path.exists(f): continue
        a = np.asarray(Image.open(f).convert('RGB').resize((128, 128))).astype(np.float32)
        v.append(a.reshape(-1, 3))
    if not v: return (0.0, 255.0, 1.0)
    v = np.concatenate(v)
    lo, hi = float(np.percentile(v, 1)), float(np.percentile(v, 96))
    print('escala comum dos ortofotos: %.0f a %.0f (de 255), gama 0,75' % (lo, hi))
    return (lo, hi, 0.75)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--terreno', default='dados/terreno/manteigas-v6.terr.gz')
    ap.add_argument('--ortos', default='dados/det')
    ap.add_argument('--por-classe', type=int, default=6)
    ap.add_argument('--lado', type=float, default=60.0, help='m de lado de cada recorte')
    ap.add_argument('--pureza', type=float, default=0.70,
                    help='fraccao da janela que tem de ser da classe')
    ap.add_argument('--semente', type=int, default=20260920)
    ap.add_argument('--saida', default='dados/lidar')
    a = ap.parse_args()

    C, cx, mx, my, pc = le_terreno(os.path.join(RAIZ, a.terreno))
    lo0, la0, lo1, la1 = cx
    O = Ortos(os.path.join(RAIZ, a.ortos))
    REF = escala_comum(O)
    print('ortofotos: azulejos de %d m; classes %dx%d a %.0f m' % (O.passo, mx, my, pc))

    r = max(1, int(a.lado / pc / 2))
    rng = np.random.default_rng(a.semente)
    escolhidos = []
    for cod in sorted(NOME):
        cand = np.argwhere(C == cod)
        if not len(cand): continue
        rng.shuffle(cand)
        n = 0
        for cj, ci in cand:
            if cj - r < 0 or ci - r < 0 or cj + r >= my or ci + r >= mx: continue
            jan = C[cj - r:cj + r, ci - r:ci + r]
            if (jan == cod).mean() < a.pureza: continue
            lo = lo0 + (ci + 0.5) / mx * (lo1 - lo0)
            la = la1 - (cj + 0.5) / my * (la1 - la0)
            im = O.recorte(lo, la, a.lado, 230)
            if im is None: continue
            escolhidos.append({'cod': int(cod), 'classe': NOME[cod],
                               'lon': round(float(lo), 6), 'lat': round(float(la), 6),
                               'im': realca(im, REF)})
            n += 1
            if n >= a.por_classe: break
        print('   %-18s %d de %d pedidos' % (NOME[cod], n, a.por_classe))

    if not escolhidos:
        sys.exit('nenhum recorte: o ortofoto nao cobre nenhuma celula amostrada')

    rng.shuffle(escolhidos)
    cols = 6
    linhas = (len(escolhidos) + cols - 1) // cols
    L, marg = 230, 10
    folha = Image.new('RGB', (cols * (L + marg) + marg, linhas * (L + marg + 18) + marg), (24, 26, 24))
    d = ImageDraw.Draw(folha)
    for k, e in enumerate(escolhidos):
        cxp = marg + (k % cols) * (L + marg)
        cyp = marg + (k // cols) * (L + marg + 18)
        folha.paste(e['im'], (cxp, cyp))
        d.text((cxp + 3, cyp + L + 3), '%d' % (k + 1), fill=(210, 215, 205))
    dest = os.path.join(RAIZ, a.saida, 'prova_cega.jpg')
    os.makedirs(os.path.dirname(dest), exist_ok=True)
    folha.save(dest, quality=88)

    chave = os.path.join(RAIZ, a.saida, 'prova_cega_chave.csv')
    with open(chave, 'w', newline='', encoding='utf-8') as f:
        w = csv.writer(f)
        w.writerow(['numero', 'classe', 'lon', 'lat'])
        for k, e in enumerate(escolhidos):
            w.writerow([k + 1, e['classe'], e['lon'], e['lat']])
    print('\n%s  (%d recortes de %.0f m, %d por linha)' % (dest, len(escolhidos), a.lado, cols))
    print('%s  -- NAO abrir antes de escrever o que se ve' % chave)


if __name__ == '__main__':
    main()

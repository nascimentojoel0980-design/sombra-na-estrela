# -*- coding: utf-8 -*-
"""Boletim de uma zona cozida: em que partes dela se pode confiar.

Porque este ficheiro existe. Ele disse: "nao quero que estejas a corrigir o
problema imagem a imagem que envio; quero como deve ser, porque agora e uma
area pequena e quando for grande ou nova nao sei afirmar". Tinha razao. Uma
zona nova tem de se declarar a si propria antes de alguem olhar para ela.

Cada linha do boletim tem de ser uma de duas coisas, e diz qual:

  VERIFICACAO   confronta o mapa com uma fonte INDEPENDENTE do que o produziu.
                Se falha, o mapa esta errado.
  CONSISTENCIA  confirma que o cozedor fez o que diz que faz. E circular por
                construcao -- passar nao prova que o mapa e verdade, so prova
                que o gerador nao se partiu.

A distincao e o ponto todo: uma consistencia a passar nao e uma garantia, e
vender-lha como tal seria o mesmo erro que pintar telhados de cinzento por
causa de um ficheiro dessaturado.

E o que NAO se consegue verificar aparece como NAO VERIFICADO, com o nome da
razao. Uma classe sem verificacao possivel nao e uma classe boa por defeito.
"""
import json, argparse, glob, gzip, json, math, os, re, struct, sys
import numpy as np

RAIZ = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
R = 6378137.0
NOME = {0: 'sem dado', 1: 'urbano', 2: 'agricola', 3: 'pastagem', 4: 'montado',
        5: 'floresta', 6: 'mato rasteiro', 7: 'rocha', 8: 'parede', 9: 'agua',
        10: 'chao nu', 11: 'matagal', 12: 'zona humida'}


def le(f):
    b = gzip.open(f, 'rb').read()
    i, B = 8, {}
    while i < len(b):
        t, n = struct.unpack_from('<4sI', b, i); i += 8
        B[t.decode()] = b[i:i + n]; i += n
    T = {}
    T['caixa'] = struct.unpack_from('<dddd', B['BBOX'], 0)
    nx, ny, passo, z0, z1 = struct.unpack_from('<HHfff', B['COTA'], 0)
    T['Z'] = z0 + np.frombuffer(B['COTA'], np.uint16, offset=16).reshape(ny, nx).astype(np.float32) / 65535 * (z1 - z0)
    T['passo'] = passo
    mx, my, pc = struct.unpack_from('<HHf', B['CLAS'], 0)
    T['C'] = np.frombuffer(B['CLAS'], np.uint8, offset=8).reshape(my, mx) & 127
    T['corr'] = (np.frombuffer(B['CLAS'], np.uint8, offset=8).reshape(my, mx) & 128) > 0
    T['pc'] = pc
    T['ALTV'] = (np.frombuffer(B['ALTV'], np.uint8, offset=4).reshape(my, mx)
                 if 'ALTV' in B else None)
    T['temCasas'] = 'CASA' in B
    T['pontos'] = []
    if 'PONT' in B:
        n, off = struct.unpack_from('<I', B['PONT'], 0)[0], 4
        for _ in range(n):
            lo, la, alt, lk, ln = struct.unpack_from('<ffHBB', B['PONT'], off); off += 12
            kb = B['PONT'][off:off + lk].decode('utf-8'); off += lk
            nb = B['PONT'][off:off + ln].decode('utf-8'); off += ln
            T['pontos'].append((kb, nb, lo, la))
    if T['temCasas']:
        n, zc0, zc1 = struct.unpack_from('<Iff', B['CASA'], 0)
        T['nVertCasa'] = n
        q = np.frombuffer(B['CASA'], np.uint16, offset=12).reshape(-1, 3).astype(np.float32) / 65535
        tri = q.reshape(-1, 3, 3)
        telhado = (tri[:, 0, 2] == tri[:, 1, 2]) & (tri[:, 1, 2] == tri[:, 2, 2])
        T['telhados'] = tri[telhado].mean(1)[:, :2] if telhado.any() else None   # x,y em fraccao da caixa
    return T


class Boletim:
    def __init__(self): self.linhas = []
    def ver(self, nome, ok, txt, valor=None):
        self.linhas.append(('VERIFICACAO', nome, ok, txt, valor))
    def cons(self, nome, ok, txt, valor=None):
        self.linhas.append(('CONSISTENCIA', nome, ok, txt, valor))
    def nao(self, nome, txt):
        self.linhas.append(('NAO VERIFICADO', nome, None, txt, None))
    def imprime(self):
        larg = max(len(l[1]) for l in self.linhas) + 1
        for tipo, nome, ok, txt, _ in self.linhas:
            marca = '  ? ' if ok is None else ('  v ' if ok else '  X ')
            print('%s%-14s %-*s %s' % (marca, tipo, larg, nome, txt))
        falhas = [l[1] for l in self.linhas if l[2] is False]
        naos = [l[1] for l in self.linhas if l[2] is None]
        print()
        if falhas: print('FALHOU: ' + ', '.join(falhas))
        if naos: print('sem maneira de verificar: ' + ', '.join(naos))
        if not falhas: print('nenhuma verificacao falhou')
        return not falhas
    def json(self):
        def puro(v):
            if isinstance(v, dict): return {k: puro(w) for k, w in v.items()}
            if hasattr(v, 'item'): return v.item()     # numpy nao vai para JSON
            return v
        return [{'tipo': t, 'nome': n, 'passa': puro(ok), 'texto': x, 'valor': puro(v)}
                for t, n, ok, x, v in self.linhas]


# ---------------------------------------------------------------- ortofoto
class Ortos:
    def __init__(self, pasta):
        self.pasta, self.tem = pasta, set()
        xs = set()
        for f in glob.glob(os.path.join(pasta, 'd_*.webp')):
            m = re.search(r'd_(-?\d+)_(\d+)', f)
            x, y = int(m.group(1)), int(m.group(2)); xs.add(x); self.tem.add((x, y))
        o = sorted(xs)
        self.passo = min((b - a for a, b in zip(o, o[1:]) if b > a), default=1280)
        self.cache = {}
    def cinza(self, lo, la, lado=40):
        from PIL import Image
        x = lo / 180 * 20037508.342789244
        y = math.log(math.tan(math.pi / 4 + math.radians(la) / 2)) * R
        tx = math.floor(x / self.passo) * self.passo; ty = math.floor(y / self.passo) * self.passo
        if (tx, ty) not in self.tem: return None
        im = self.cache.get((tx, ty))
        if im is None:
            im = Image.open(os.path.join(self.pasta, 'd_%d_%d.webp' % (tx, ty))).convert('L')
            if len(self.cache) > 8: self.cache.clear()
            self.cache[(tx, ty)] = im
        mpp = self.passo / im.width
        px = int((x - tx) / mpp); py = int((ty + self.passo - y) / mpp); k = int(lado / mpp / 2)
        if px - k < 0 or py - k < 0 or px + k >= im.width or py + k >= im.height: return None
        return np.asarray(im.crop((px - k, py - k, px + k, py + k))).astype(np.float32)


def coesao(x, y):
    """d de Cohen: quantos desvios-padrao separam duas populacoes"""
    if len(x) < 20 or len(y) < 20: return None
    s = math.sqrt((x.var() + y.var()) / 2)
    return abs(x.mean() - y.mean()) / s if s > 1e-9 else None


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('terreno')
    ap.add_argument('--ortos', default='dados/det')
    ap.add_argument('--dem', default='dados/dem.webp')
    ap.add_argument('--amostra', type=int, default=300)
    ap.add_argument('--semente', type=int, default=20260920)
    ap.add_argument('--json', default=None)
    ap.add_argument('--casas-fonte', default='OSM',
                    help='de onde vieram os contornos (o cozedor passa-o); so para o texto')
    ap.add_argument('--classes-fonte', default='azulejos antigos',
                    help='de onde veio a carta de classes (o cozedor passa-o)')
    a = ap.parse_args()

    T = le(os.path.join(RAIZ, a.terreno) if not os.path.isabs(a.terreno) else a.terreno)
    lo0, la0, lo1, la1 = T['caixa']
    C, pc, ALTV = T['C'], T['pc'], T['ALTV']
    my, mx = C.shape
    ac = pc * pc / 1e6
    rng = np.random.default_rng(a.semente)
    B = Boletim()

    print('%s' % a.terreno)
    print('caixa %.4f %.4f %.4f %.4f   classes %dx%d a %.0f m   %.0f km2\n'
          % (lo0, la0, lo1, la1, mx, my, pc, C.size * ac))

    # ---- 1. cotas contra uma fonte independente (Copernicus 30 m)
    dem = os.path.join(RAIZ, a.dem)
    if os.path.exists(dem):
        from PIL import Image
        A = np.asarray(Image.open(dem).convert('RGB')).astype(np.float32)
        Zc = A[:, :, 0] * 256.0 + A[:, :, 1] - 32768.0
        # A caixa do DEM vem do cozedor, nao de memoria. A primeira versao deste
        # ficheiro inventou-a e a prova das cotas falhou com correlacao 0,83
        # sobre um MDT que a outra sessao tinha conferido a 0,9998 -- a falha
        # era da prova. Uma prova com a referencia errada nao prova nada, e ja
        # e a terceira vez neste projecto.
        sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
        from gera_terreno import DEM_CAIXA
        hD, wD = Zc.shape
        ny, nx = T['Z'].shape
        jj = ((DEM_CAIXA[3] - np.linspace(la1, la0, ny)) / (DEM_CAIXA[3] - DEM_CAIXA[1]) * (hD - 1))
        ii = ((np.linspace(lo0, lo1, nx) - DEM_CAIXA[0]) / (DEM_CAIXA[2] - DEM_CAIXA[0]) * (wD - 1))
        if jj.min() >= 0 and jj.max() < hD and ii.min() >= 0 and ii.max() < wD:
            Zr = Zc[np.ix_(jj.astype(int), ii.astype(int))]
            d = T['Z'] - Zr
            r = float(np.corrcoef(T['Z'].ravel(), Zr.ravel())[0, 1])
            vies = float(np.median(d)); esp = float(np.percentile(np.abs(d - vies), 90))
            ok = bool(r > 0.99 and abs(vies) < 25 and esp < 60)
            B.ver('cotas', ok, 'correlacao %.4f com o Copernicus 30 m; vies %+.1f m, '
                  'P90 do desvio %.1f m' % (r, vies, esp), {'r': r, 'vies': vies})
        else:
            B.nao('cotas', 'a caixa sai fora do DEM de referencia')
    else:
        B.nao('cotas', 'nao ha %s para comparar' % a.dem)

    # ---- 2. floresta contra o ortofoto (fonte independente do LiDAR)
    # So faz sentido com celulas finas: a 50 m uma celula e uma mistura e a
    # textura de um recorte nao a classifica (medido: d=0,7 numa carta que
    # concorda a 86% com a zona fina verificada). Para celulas grossas a prova
    # e outra, a 2b: coerencia com as zonas finas ja aprovadas.
    O = Ortos(os.path.join(RAIZ, a.ortos))
    grossa = T['pc'] >= 20
    if grossa:
        B.nao('floresta', 'textura do ortofoto nao se aplica a celulas de %.0f m; ver coerencia com zonas finas' % T['pc'])
        pasta = os.path.dirname(os.path.abspath(a.terreno if os.path.isabs(a.terreno) else os.path.join(RAIZ, a.terreno)))
        finas = []
        try:
            idx = json.load(open(os.path.join(pasta, 'index.json'), encoding='utf-8'))
            for zf in idx.get('zonas', []):
                if zf.get('classe', 99) >= 20: continue
                bj = os.path.join(pasta, zf['ficheiro'].replace('.terr.gz', '.boletim.json'))
                if not os.path.exists(bj): continue
                bol = json.load(open(bj, encoding='utf-8'))
                if any(l.get('passa') is False for l in bol.get('linhas', [])): continue
                zlo0, zla0, zlo1, zla1 = zf['caixa']
                if zlo1 <= lo0 or zlo0 >= lo1 or zla1 <= la0 or zla0 >= la1: continue
                finas.append((zf, os.path.join(pasta, zf['ficheiro'])))
        except Exception as e:
            finas = []
        res = []
        for zf, ff in finas:
            F = le(ff); CF = F['C']; fy, fx = CF.shape; zlo0, zla0, zlo1, zla1 = F['caixa']
            r = max(1, int(round(T['pc'] / F['pc'] / 2)))
            tot = 0; ok = 0
            for j in range(my):
                la = la1 - (j + 0.5) / my * (la1 - la0)
                if not (zla0 < la < zla1): continue
                for i in range(mx):
                    if C[j, i] != 5: continue
                    lo = lo0 + (i + 0.5) / mx * (lo1 - lo0)
                    if not (zlo0 < lo < zlo1): continue
                    i0 = int((lo - zlo0) / (zlo1 - zlo0) * fx); j0 = int((zla1 - la) / (zla1 - zla0) * fy)
                    w = CF[max(0, j0 - r):j0 + r, max(0, i0 - r):i0 + r]
                    if not w.size: continue
                    tot += 1; ok += int(np.bincount(w.ravel(), minlength=13).argmax() == 5)
            if tot >= 100: res.append((zf['nome'], ok / tot, tot))
        if res:
            pior = min(p for _, p, _ in res)
            B.ver('coerencia com zonas finas', bool(pior >= 0.7),
                  'floresta grossa e floresta na zona fina verificada: ' +
                  ', '.join('%s %.0f%% (%d celulas)' % (n, 100 * p, t) for n, p, t in res),
                  {'zonas': {n: p for n, p, _ in res}})
        else:
            B.nao('coerencia com zonas finas', 'nenhuma zona fina aprovada dentro desta caixa')
    if O.tem and not grossa:
        def amostra(masc, n):
            cand = np.argwhere(masc)
            if not len(cand): return np.array([]), 0
            rng.shuffle(cand); v = []
            for cj, ci in cand:
                lo = lo0 + (ci + 0.5) / mx * (lo1 - lo0); la = la1 - (cj + 0.5) / my * (la1 - la0)
                g = O.cinza(lo, la)
                if g is None: continue
                v.append([g.mean(), g.std()])
                if len(v) >= n: break
            return np.array(v), len(cand)
        F, nF = amostra(C == 5, a.amostra)
        NF, _ = amostra(np.isin(C, [3, 6, 7, 10]), a.amostra)
        if len(F) >= 20 and len(NF) >= 20:
            dB = coesao(F[:, 0], NF[:, 0]); dC = coesao(F[:, 1], NF[:, 1])
            ok = bool((dB or 0) > 1.0 or (dC or 0) > 1.0)
            B.ver('floresta', ok, 'contra a textura do ortofoto, %d+%d celulas: '
                  'brilho d=%.2f, contraste d=%.2f (>1 separa)' % (len(F), len(NF), dB or 0, dC or 0),
                  {'d_brilho': dB, 'd_contraste': dC})
        else:
            B.nao('floresta', 'o ortofoto nao cobre celulas suficientes')
        cob = 0
        for _ in range(200):
            lo = rng.uniform(lo0, lo1); la = rng.uniform(la0, la1)
            if O.cinza(lo, la, 20) is not None: cob += 1
        B.ver('cobertura do ortofoto', bool(cob > 20),
              '%.0f%% da caixa tem ortofoto de detalhe (faixa dos percursos)' % (cob / 2),
              {'pct': cob / 2})
    else:
        B.nao('floresta', 'nao ha ortofoto em %s' % a.ortos)

    # ---- 3. rocha: declarar que nao ha como verificar
    B.nao('rocha / chao nu / mato',
          'quatro vias medidas e nenhuma separa (ver O_Satelite_Nao_Separa_Rocha.md); '
          'vem da COS e nao esta verificada')

    # ---- 4. consistencias: o cozedor fez o que diz?
    if ALTV is not None:
        f = C == 5
        if f.any():
            p = float((ALTV[f] >= 50).mean())
            B.cons('floresta tem copa', bool(p > 0.98), '%.1f%% das celulas de floresta medem >= 5 m' % (100 * p))
        m = C == 11
        if m.any():
            p = float((ALTV[m] >= 15).mean())
            B.cons('matagal tem copa', bool(p > 0.98), '%.1f%% do matagal mede >= 1,5 m' % (100 * p))
        n = C == 10
        if n.any():
            p = float((ALTV[n] < 5).mean())
            B.cons('chao nu esta nu', bool(p > 0.98), '%.1f%% do chao nu mede < 0,5 m' % (100 * p))
    else:
        B.nao('altura da vegetacao', 'a zona foi cozida sem --chm: as alturas sao da classe')

    gy, gx = np.gradient(T['Z'], T['passo'])
    dec = np.degrees(np.arctan(np.hypot(gx, gy)))
    ny, nx = T['Z'].shape
    dc = dec[np.ix_((np.arange(my) / my * ny).astype(int).clip(0, ny - 1),
                    (np.arange(mx) / mx * nx).astype(int).clip(0, nx - 1))]
    p = C == 8
    if p.any():
        q = float((dc[p] >= 40).mean())
        B.cons('paredes sao ingremes', bool(q > 0.95), '%.1f%% das paredes tem declive >= 40 graus' % (100 * q))
    g = C == 9
    if g.any():
        q = float((dc[g] < 12).mean())
        B.cons('agua e plana', bool(q > 0.90), '%.1f%% da agua tem declive < 12 graus' % (100 * q))

    # ---- 4b. posicao: a carta esta no sitio do relevo?
    # A grelha de classes esteve espelhada norte-sul ate a v10 sem nenhuma
    # verificacao dar por isso: as consistencias sao elementares e a floresta
    # e decidida pela medicao, que estava certa. Esta e a prova que faltava.
    # Os contornos dos edificios sao de outra fonte (Microsoft/OSM) e uma casa
    # assenta em terreno artificializado ou agricola da COS; com a grelha ao
    # espelho assentavam em floresta e matos (0,3%). As "povoacoes" do OSM nao
    # servem: metade sao topónimos de sitios ermos (Fraga do Vale Mourisco).
    if T['temCasas'] and T.get('telhados') is not None:
        pts = T['telhados']
        i = (pts[:, 0] * (mx - 1)).round().astype(int).clip(0, mx - 1)
        j = ((1 - pts[:, 1]) * (my - 1)).round().astype(int).clip(0, my - 1)
        sob = C[j, i]
        p = float(np.isin(sob, [1, 2]).mean())
        B.ver('posicao da carta', bool(p >= 0.5),
              '%.0f%% dos telhados (%s) assentam em urbano ou agricola da COS '
              '(com a grelha espelhada eram 0,3%%)' % (100 * p, f'{len(pts):,}'), {'p': p})
    else:
        B.nao('posicao da carta', 'sem contornos de edificios nao ha com que conferir a posicao')

    # ---- 5. casas
    urb = float((C == 1).sum()) * ac
    if T['temCasas']:
        B.ver('casas', True, '%s vertices de contorno (%s); %.2f km2 de urbano na carta. '
              'Densidade NAO verificada contra o ortofoto; alturas modeladas onde a fonte nao mede'
              % (f"{T['nVertCasa']:,}", a.casas_fonte, urb), {'urbano_km2': urb})
    else:
        B.nao('casas', 'a zona foi cozida sem contornos de edificios')

    if 'saco' in a.classes_fonte or 'azulejos' in a.classes_fonte:
        B.nao('carta de classes', 'cozida com %s: 7, 8 e 9 da COS num saco so' % a.classes_fonte)

    # ---- 6. o que a zona tem, para ninguem lhe pedir o que ela nao pode dar
    print('classes (%s):' % a.classes_fonte)
    for k in sorted(set(C.ravel().tolist())):
        print('   %-15s %7.2f km2' % (NOME.get(k, k), (C == k).sum() * ac))
    print()
    bom = B.imprime()
    if a.json:
        json.dump({'terreno': a.terreno, 'linhas': B.json()},
                  open(os.path.join(RAIZ, a.json), 'w', encoding='utf-8'),
                  ensure_ascii=False, indent=1)
        print('\nboletim em %s' % a.json)
    sys.exit(0 if bom else 2)


if __name__ == '__main__':
    main()

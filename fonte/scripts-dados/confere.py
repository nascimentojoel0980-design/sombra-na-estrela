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
        10: 'chao nu', 11: 'matagal', 12: 'zona humida', 13: 'ardido recente'}


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


def pinta_poligono(destino, gs, caixa, mx, my):
    """enche aneis (graus) na grelha; linha 0 = norte, como o cozedor"""
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
            i0 = max(0, int(math.ceil(xs[k] - 0.5))); i1 = min(mx - 1, int(math.floor(xs[k + 1] - 0.5)))
            if i1 >= i0: destino[j, i0:i1 + 1] = 1


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
    ap.add_argument('--amostra', type=int, default=2000)
    ap.add_argument('--semente', type=int, default=20260920)
    ap.add_argument('--json', default=None)
    ap.add_argument('--fontes', default=os.path.join(RAIZ, '..', 'sne-dados-fonte'), help='o armazem (para o NDVI recente)')
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
            # A correlacao depende do relevo que ha para correlacionar: numa caixa
            # plana (Oliveira do Hospital, 100 m de desnivel) r cai para 0,977
            # com um erro P90 de 9 m, MENOR do que o de Manteigas (15 m) onde r
            # e 0,9996. O que se exige e o erro; r so quando ha relevo.
            ok = bool(abs(vies) < 25 and esp < 60 and (r > 0.99 or esp < 20))
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
                    tot += 1; ok += int(np.bincount((w & 127).ravel(), minlength=14).argmax() == 5)   # sem o bit do corredor
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
        # Chao ABERTO: erva, chao nu, rocha, e rasteiro onde o laser mede menos
        # de 0,5 m. O rasteiro ate 1,5 m tem textura de arbusto e nas zonas
        # ardidas em 2017 (oeste) confundia-se com a floresta na foto (d=0,8);
        # a pergunta certa e "floresta vs chao aberto", nao "vs tudo o resto".
        # O ardido recente (13) fica de fora dos dois lados: a foto pode ser
        # de antes do fogo e mostrar pinhal onde o mapa, com razao, ja nao poe.
        aberto = np.isin(C, [3, 7, 10]) | ((C == 6) & ((ALTV < 5) if ALTV is not None else True))
        # E so em NUCLEO: o recorte tem 40 m e a celula 5 m; no carvalhal aberto
        # do planalto da Guarda uma celula "floresta" e uma copa com pasto a
        # volta, e o recorte media as duas (d=0,7 em c5r3 sem nucleo, 2,0 com
        # nucleo de 20 m; Manteigas 1,5 -> 2,3). Compara-se so onde a classe
        # enche o recorte; se nao houver celulas que cheguem, recua-se.
        def nucleo(m, n):
            from numpy.lib.stride_tricks import sliding_window_view as swv
            if n == 0: return m
            p = np.pad(m, n, constant_values=False)
            return swv(p, (2 * n + 1, 2 * n + 1)).all(axis=(2, 3))
        F = NF = np.array([]); nF = 0
        for n in (4, 2, 0):
            F, nF = amostra(nucleo(C == 5, n), a.amostra)
            NF, _ = amostra(nucleo(aberto, n), a.amostra)
            if len(F) >= 60 and len(NF) >= 60: nuc = n; break
        else: nuc = 0
        # O ortofoto de prova e de ANTES dos fogos recentes (classe 13). Onde
        # uma parte grande da zona ardeu depois das fontes, a foto ja nao
        # mostra o chao de hoje e nao serve de prova: nem aprova nem chumba
        # (c7r0 Medelim, 21/09/2026: 16 km2 ardidos em 2025, a floresta que
        # sobra sao 0,65 km2 de bordas e a textura deixa de separar).
        ardido = float((C == 13).mean())
        if ardido > 0.10:
            B.nao('floresta', '%.0f%% da zona ardeu depois do ortofoto de prova (classe 13): a foto ja nao mostra o chao de hoje'
                  % (100 * ardido))
        elif len(F) >= 20 and len(NF) >= 20:
            dB = coesao(F[:, 0], NF[:, 0]); dC = coesao(F[:, 1], NF[:, 1])
            # d e o d de Cohen entre floresta e chao aberto. O limiar e 0,8 --
            # o "efeito grande" de Cohen -- e nao 1,0: com 300 amostras o d
            # tinha +-0,1 de sorteio e a zona c5r4 (montado com pasto) entrava e
            # saia do indice consoante a tiragem (1,03 na v16, 0,89 na v17;
            # 0,96 com 2000 amostras, 21/09/2026). Amostra de 2000 por defeito:
            # o d passa a ter +-0,03 e a decisao deixa de ser sorte.
            ok = bool((dB or 0) >= 0.8 or (dC or 0) >= 0.8)
            B.ver('floresta', ok, 'contra a textura do ortofoto, %d+%d celulas em nucleo de %d m: '
                  'brilho d=%.2f, contraste d=%.2f (>=0,8 separa, efeito grande de Cohen)' % (len(F), len(NF), nuc * T['pc'], dB or 0, dC or 0),
                  {'d_brilho': dB, 'd_contraste': dC, 'nucleo_m': nuc * T['pc']})
        else:
            B.nao('floresta', 'o ortofoto nao cobre celulas suficientes')
        cob = 0
        for _ in range(200):
            lo = rng.uniform(lo0, lo1); la = rng.uniform(la0, la1)
            if O.cinza(lo, la, 20) is not None: cob += 1
        # A cobertura do ortofoto e uma propriedade dos NOSSOS dados de prova,
        # nao do mapa: onde nao ha foto, as provas que dela dependem ficam
        # NAO VERIFICADAS, mas isso nao chumba a zona (chumbava: 20/09/2026,
        # as zonas fora da faixa dos percursos nao entravam no indice).
        if cob > 20:
            B.ver('cobertura do ortofoto', True,
                  '%.0f%% da caixa tem ortofoto de detalhe (faixa dos percursos)' % (cob / 2), {'pct': cob / 2})
        else:
            B.nao('cobertura do ortofoto', 'so %.0f%% da caixa tem ortofoto de detalhe: as provas por foto nao se fazem aqui' % (cob / 2))
    elif not grossa:
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
        if T['pc'] >= 20:
            B.nao('altura da vegetacao', 'vista geral sem plantas: a altura medida nao se guarda')
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

    # ---- 5b. ardido recente: o que esta VIVO hoje. O ortofoto de prova e de
    # antes dos fogos e mostra verde onde ja so ha cinza ("mas na ortofoto
    # esta verde", 21/09/2026). A prova certa e o NDVI do Sentinel-2 mais
    # recente (armazem, ferramentas/sentinel_ndvi.py), sobre os POLIGONOS do
    # ICNF posteriores as fontes (nao sobre a classe 13, que ja e decidida
    # pelo NDVI -- seria circular): se ardeu, a mediana de dentro fica abaixo
    # da vegetacao de fora. Quanto: Medelim (Ago 2025) 0,25 vs 0,37; Gouveia
    # (Set 2024, a rebentar) 0,42 vs 0,60; Mortagua/Carvalhal (Set 2024,
    # eucaliptal a rebentar com forca) 0,58 vs 0,74 -- dois anos depois o
    # rebento ja repoe 80% do NDVI. O que se exige e uma quebra real (>= 10%,
    # com milhares de celulas a mediana e firme); um poligono SEM quebra
    # nenhuma e o que nao se deve acreditar.
    try:
        sys.path.insert(0, os.path.dirname(os.path.abspath(__file__))); import fontes as _fontes
        tem_ardidas = _fontes.ha_ardidas(a.fontes); tem_ndvi = _fontes.ha_raster(a.fontes, 'ndvi', (lo0, la0, lo1, la1))
    except Exception as e:
        tem_ardidas = tem_ndvi = False; _fontes = None
    if tem_ardidas:
        Q = np.zeros((my, mx), dtype=np.uint8); nq = 0
        for ano, ini, aneis in _fontes.ardidas_poligonos(a.fontes, (lo0, la0, lo1, la1)):
            if _fontes.ardido_recente(ano, ini): pinta_poligono(Q, aneis, (lo0, la0, lo1, la1), mx, my); nq += 1
        km2_q = float(Q.sum()) * ac
        if km2_q >= 0.5 and tem_ndvi:
            zn, cn = _fontes.raster_mosaico(a.fontes, 'ndvi', (lo0, la0, lo1, la1), preenche=None)
            hN, wN = zn.shape
            ci = np.clip(((np.arange(mx) + 0.5) / mx * (lo1 - lo0) + lo0 - cn[0]) / (cn[2] - cn[0]) * wN, 0, wN - 1).astype(int)
            rj = np.clip((cn[3] - (la1 - (np.arange(my) + 0.5) / my * (la1 - la0))) / (cn[3] - cn[1]) * hN, 0, hN - 1).astype(int)
            N = zn[np.ix_(rj, ci)]
            dentro = N[(Q == 1) & np.isfinite(N)]
            fora = N[(Q == 0) & np.isin(C, [3, 4, 5, 6, 11, 13]) & np.isfinite(N)]
            data = ''
            try:
                import rasterio as _rio
                f0 = _fontes.folhas(os.path.join(a.fontes, 'sentinel', 'ndvi'), 'ndvi', 'tif', (lo0, la0, lo1, la1))[0]
                with _rio.open(f0) as r: cen = json.loads(r.tags().get('CENAS', '{}'))
                data = ', '.join(sorted(set(v['data'] for v in cen.values()))) if cen else ''
            except Exception: pass
            if dentro.size >= 100 and fora.size >= 100:
                md, mf = float(np.median(dentro)), float(np.median(fora))
                B.ver('ardido recente', bool(md <= 0.90 * mf),
                      'NDVI Sentinel-2 de %s nos %d poligonos do ICNF posteriores as fontes (%.2f km2): mediana %.2f dentro, %.2f na vegetacao de fora; '
                      'ardeu se dentro <= 0,90 x fora. Na carta: %.2f km2 de cinza (13) e o resto a rebentar (6)'
                      % (data or 'hoje', nq, km2_q, md, mf, float((C == 13).sum()) * ac), {'dentro': md, 'fora': mf, 'data': data, 'km2_poligonos': km2_q})
            else:
                B.nao('ardido recente', 'NDVI sem celulas validas que cheguem (nuvem?) em %.2f km2 de poligonos ardidos' % km2_q)
        elif km2_q >= 0.5:
            B.nao('ardido recente', '%.2f km2 de poligonos ardidos posteriores as fontes e sem NDVI recente no armazem (ferramentas/sentinel_ndvi.py)' % km2_q)
        elif km2_q > 0:
            B.nao('ardido recente', 'so %.2f km2 de poligonos ardidos posteriores as fontes: pouco para medir' % km2_q)

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

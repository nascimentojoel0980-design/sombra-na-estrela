#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""Circular a partir de um ponto, escolhida pela SOMBRA, sobre as fontes do mapa.

  python3 fonte/scripts-dados/rota_sombra.py --casa -7.5244444 40.2409778 --km 15 20 [--circular 0.7] [--saida rota]

O grafo sao as vias do OSM do armazem (sne-dados-fonte/osm-vias, highway
original). A sombra de cada troco e a fraccao do troco debaixo de copa medida
pelo LiDAR (ALTV >= 5 m, ou classe floresta/montado onde nao ha medicao),
lida das zonas cozidas (dados/terreno). As cotas vem das mesmas zonas (MDT do
LiDAR a 8 m). Nada e inventado: todos os trocos existem no OSM.

Como procura: Dijkstra de casa com um custo = comprimento x factor da via
x (1 + 2 x (1 - sombra)). Os nos a meio do comprimento pedido sao pontos de
viragem; para cada um, caminho de ida e caminho de volta com as arestas da
ida penalizadas 6x (circular, nao ida-e-volta). Fica o circuito de melhor
sombra que cumpre o comprimento e a circularidade minima (fraccao do
comprimento sem repetir).

Vias: auto-estrada, IP/IC e as suas ligacoes nao entram. Nacional (primary)
so como ultimo recurso (x4), secundaria x2,5, terciaria x1,6, ruas x1,2,
escadas x1,5, track/path/footway x1.
"""
import argparse, datetime, gzip, heapq, json, math, os, struct, sys, time
import numpy as np
AQUI = os.path.dirname(os.path.abspath(__file__)); RAIZ = os.path.dirname(os.path.dirname(AQUI))
sys.path.insert(0, AQUI)
import fontes
import importlib.util
_s = importlib.util.spec_from_file_location('confere', os.path.join(AQUI, 'confere.py')); confere = importlib.util.module_from_spec(_s)
try: _s.loader.exec_module(confere)
except SystemExit: pass

FACTOR = {'motorway': None, 'motorway_link': None, 'trunk': None, 'trunk_link': None,
          'primary': 4.0, 'primary_link': 4.0, 'secondary': 2.5, 'secondary_link': 2.5, 'tertiary': 1.6, 'tertiary_link': 1.6,
          'residential': 1.2, 'living_street': 1.1, 'service': 1.2, 'unclassified': 1.2, 'road': 1.3, 'pedestrian': 1.0,
          'track': 1.0, 'path': 1.0, 'footway': 1.0, 'bridleway': 1.0, 'cycleway': 1.1, 'steps': 1.5}
NOME_VIA = {'primary': 'nacional', 'secondary': 'secundária', 'tertiary': 'terciária', 'residential': 'rua', 'living_street': 'rua',
            'service': 'serviço', 'unclassified': 'estrada sem classificação', 'road': 'estrada', 'pedestrian': 'pedonal',
            'track': 'estradão / caminho de terra', 'path': 'trilho', 'footway': 'caminho pedonal', 'bridleway': 'caminho', 'cycleway': 'ciclovia', 'steps': 'escadas'}


def metros(a, b, mlon, mlat):
    return math.hypot((b[0] - a[0]) * mlon, (b[1] - a[1]) * mlat)


def le_hori(f):
    """o mapa de horizonte da zona: (hx, hy, ndir, dados uint8 graus/0,5 em [dir][linha norte-primeiro][coluna])"""
    b = gzip.open(f, 'rb').read(); i = 8
    while i < len(b):
        t, n = struct.unpack_from('<4sI', b, i); i += 8
        if t == b'HORI':
            hx, hy, nd = struct.unpack_from('<HHH', b, i)
            return hx, hy, nd, np.frombuffer(b, np.uint8, count=hx * hy * nd, offset=i + 6).reshape(nd, hy, hx)
        i += n
    return None


def posicao_sol(quando_utc, lat, lon):
    """altura e azimute (0 = N, sentido horario) -- a mesma formula do motor"""
    R = math.pi / 180
    dias = (quando_utc - datetime.datetime(2000, 1, 1, 12, tzinfo=datetime.timezone.utc)).total_seconds() / 86400
    M = R * (357.5291 + 0.98560028 * dias)
    Cc = R * (1.9148 * math.sin(M) + 0.02 * math.sin(2 * M) + 0.0003 * math.sin(3 * M))
    L = M + Cc + R * 102.9372 + math.pi
    e = R * 23.4397
    dec = math.asin(math.sin(e) * math.sin(L)); ra = math.atan2(math.sin(L) * math.cos(e), math.cos(L))
    H = R * (280.16 + 360.9856235 * dias) + R * lon - ra; f = R * lat
    alt = math.asin(math.sin(f) * math.sin(dec) + math.cos(f) * math.cos(dec) * math.cos(H))
    az = math.atan2(math.sin(H), math.cos(H) * math.sin(f) - math.tan(dec) * math.cos(f))
    return alt / R, ((az / R) + 180 + 360) % 360


class Terreno:
    """as zonas cozidas que tocam a caixa: copa, classe, cota e sombra do monte por (lo, la)"""
    def __init__(self, caixa):
        idx = json.load(open(os.path.join(RAIZ, 'dados/terreno/index.json'), encoding='utf-8'))
        self.zs = []
        for z in idx['zonas']:
            c = z['caixa']
            if z['classe'] >= 20 or c[0] > caixa[2] or c[2] < caixa[0] or c[1] > caixa[3] or c[3] < caixa[1]: continue
            f = os.path.join(RAIZ, 'dados/terreno', z['ficheiro'])
            T = confere.le(f); T['nome'] = z['nome']; T['titulo'] = z['titulo']; T['hori'] = le_hori(f)
            self.zs.append(T)
        if not self.zs: sys.exit('nenhuma zona cozida toca a caixa')
        self.sol = []                      # lista de (alt, az) das horas a considerar
    def monte(self, lo, la):
        """fraccao das horas escolhidas em que o ponto esta a sombra do monte"""
        T = self.zona(lo, la)
        if T is None or T['hori'] is None or not self.sol: return 0.0
        hx, hy, nd, H = T['hori']; lo0, la0, lo1, la1 = T['caixa']
        i = min(hx - 1, max(0, int(round((lo - lo0) / (lo1 - lo0) * (hx - 1))))); j = min(hy - 1, max(0, int(round((la1 - la) / (la1 - la0) * (hy - 1)))))
        n = 0
        for alt, az in self.sol:
            if alt <= 0: n += 1; continue
            f = az / 360 * nd; l0 = int(f) % nd; l1 = (l0 + 1) % nd; w = f - int(f)
            h = (H[l0, j, i] * (1 - w) + H[l1, j, i] * w) / 2
            if alt <= h: n += 1
        return n / len(self.sol)
    def zona(self, lo, la):
        for T in self.zs:
            lo0, la0, lo1, la1 = T['caixa']
            if lo0 <= lo <= lo1 and la0 <= la <= la1: return T
        return None
    def copa(self, lo, la):
        T = self.zona(lo, la)
        if T is None: return None
        lo0, la0, lo1, la1 = T['caixa']; C = T['C']; my, mx = C.shape
        i = min(mx - 1, int((lo - lo0) / (lo1 - lo0) * mx)); j = min(my - 1, int((la1 - la) / (la1 - la0) * my))
        c = C[j, i] & 127
        if T.get('ALTV') is not None: return 1.0 if T['ALTV'][j, i] >= 50 else 0.0
        return 1.0 if c in (4, 5) else 0.0
    def classe(self, lo, la):
        T = self.zona(lo, la)
        if T is None: return -1
        lo0, la0, lo1, la1 = T['caixa']; C = T['C']; my, mx = C.shape
        i = min(mx - 1, int((lo - lo0) / (lo1 - lo0) * mx)); j = min(my - 1, int((la1 - la) / (la1 - la0) * my))
        return int(C[j, i] & 127)
    def cota(self, lo, la):
        T = self.zona(lo, la)
        if T is None: return None
        lo0, la0, lo1, la1 = T['caixa']; Z = T['Z']; ny, nx = Z.shape
        fx = min(nx - 1.001, max(0, (lo - lo0) / (lo1 - lo0) * (nx - 1))); fy = min(ny - 1.001, max(0, (la1 - la) / (la1 - la0) * (ny - 1)))
        i, j = int(fx), int(fy); u, v = fx - i, fy - j
        return float(Z[j, i] * (1 - u) * (1 - v) + Z[j, i + 1] * u * (1 - v) + Z[j + 1, i] * (1 - u) * v + Z[j + 1, i + 1] * u * v)


def grafo(caixa, terr, mlon, mlat, casa=None, raio_casa=1200.0):
    """nos por coordenada (6 casas), arestas com comprimento, via, sombra, povoacao.
    'povo': o troco anda em urbano (classe 1 da carta) ou em rua, fora do raio
    de casa -- e o que se evita quando nao se quer passar pela cidade."""
    ch = lambda p: (round(p[0], 6), round(p[1], 6))
    adj = {}; arestas = {}
    def liga(a, b, m, h, sombra, povo):
        k = (a, b) if a < b else (b, a)
        if k in arestas: return
        arestas[k] = {'m': m, 'h': h, 'sombra': sombra, 'povo': povo}
        adj.setdefault(a, []).append(b); adj.setdefault(b, []).append(a)
    n = 0
    for h, s, ref, linha in fontes.vias(fontes_dir, caixa):
        if FACTOR.get(h) is None: continue
        pts = [ch(p) for p in linha]
        for a, b in zip(pts, pts[1:]):
            if a == b: continue
            m = metros(a, b, mlon, mlat)
            if m > 2000: continue                   # linha partida, nao e um troco
            # sombra: amostra de 10 em 10 m ao longo do troco
            k = max(1, int(m / 10)); som = 0.0; nv = 0; urb = 0
            for t in (np.arange(k) + 0.5) / k:
                plo, pla = a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t
                c = terr.copa(plo, pla)
                if c is None: continue
                som += max(c, terr.monte(plo, pla)); nv += 1
                if terr.classe(plo, pla) == 1: urb += 1
            meio = ((a[0] + b[0]) / 2, (a[1] + b[1]) / 2)
            perto = casa is not None and metros(meio, casa, mlon, mlat) <= raio_casa
            povo = (not perto) and ((nv and urb / nv > 0.5) or h in ('residential', 'living_street', 'pedestrian', 'steps'))
            liga(a, b, m, h, som / nv if nv else 0.0, povo)
        n += 1
    return adj, arestas


SEM_CIDADE = True

def custo(e, penal=None, k=None):
    f = FACTOR[e['h']] * (1 + 2.0 * (1 - e['sombra']))
    if SEM_CIDADE and e.get('povo'): f *= 8.0       # so como ultimo recurso
    if penal and k in penal: f *= 6.0
    return e['m'] * f


def dijkstra(adj, arestas, ini, penal=None, alvo=None):
    d = {ini: 0.0}; comp = {ini: 0.0}; ant = {}
    fila = [(0.0, ini)]
    while fila:
        dc, u = heapq.heappop(fila)
        if dc > d.get(u, 1e30): continue
        if alvo is not None and u == alvo: break
        for v in adj.get(u, ()):
            k = (u, v) if u < v else (v, u); e = arestas[k]
            nc = dc + custo(e, penal, k)
            if nc < d.get(v, 1e30):
                d[v] = nc; comp[v] = comp[u] + e['m']; ant[v] = u; heapq.heappush(fila, (nc, v))
    return d, comp, ant


def caminho(ant, ini, fim):
    p = [fim]
    while p[-1] != ini:
        if p[-1] not in ant: return None
        p.append(ant[p[-1]])
    return p[::-1]


def avalia(nos, arestas, terr, mlon, mlat):
    L = 0.0; som = 0.0; usadas = {}; porVia = {}
    for a, b in zip(nos, nos[1:]):
        k = (a, b) if a < b else (b, a); e = arestas[k]
        L += e['m']; som += e['m'] * e['sombra']; usadas[k] = usadas.get(k, 0) + 1
        porVia[e['h']] = porVia.get(e['h'], 0.0) + e['m']
    repetido = sum(arestas[k]['m'] * (n - 1) for k, n in usadas.items() if n > 1)
    povo = sum(arestas[k]['m'] * n for k, n in usadas.items() if arestas[k].get('povo'))
    # cotas e subida (alisadas a 5 pontos, histerese de 3 m como o motor)
    zs = [terr.cota(*p) for p in nos]
    zs = [z if z is not None else (zs[i - 1] if i else 0) for i, z in enumerate(zs)]
    zz = np.array(zs, dtype=float)
    za = np.convolve(np.pad(zz, 2, mode='edge'), np.ones(5) / 5, mode='valid') if len(zz) >= 5 else zz
    sobe = desce = 0.0; ref = za[0]
    for z in za[1:]:
        if z - ref > 3: sobe += z - ref; ref = z
        elif ref - z > 3: desce += ref - z; ref = z
    # tempo: Tobler pela inclinacao, x factor do chao (caminho 1,0), sem paragens
    seg = 0.0
    for i in range(1, len(nos)):
        m = metros(nos[i - 1], nos[i], mlon, mlat)
        if m <= 0: continue
        s = max(-1.0, min(1.0, (za[i] - za[i - 1]) / m)); v = 6 * math.exp(-3.5 * abs(s + 0.05))
        zm = (za[i] + za[i - 1]) / 2
        if zm > 1200: v *= max(0.7, 1 - 0.04 * (zm - 1200) / 300)
        seg += m / (v / 3.6)
    return {'km': L / 1000, 'sombra': som / L if L else 0, 'circular': 1 - repetido / L if L else 0, 'povo_km': povo / 1000,
            'sobe': sobe, 'desce': desce, 'zmin': float(min(za)), 'zmax': float(max(za)), 'tempo_s': seg,
            'porVia': {h: v / 1000 for h, v in sorted(porVia.items(), key=lambda kv: -kv[1])}, 'z': za.tolist()}


def main():
    global fontes_dir
    ap = argparse.ArgumentParser()
    ap.add_argument('--casa', nargs=2, type=float, required=True, metavar=('LON', 'LAT'))
    ap.add_argument('--km', nargs=2, type=float, default=[15, 20])
    ap.add_argument('--circular', type=float, default=0.7, help='fraccao minima do comprimento sem repetir')
    ap.add_argument('--fontes', default=os.path.join(RAIZ, '..', 'sne-dados-fonte'))
    ap.add_argument('--saida', default='rota_sombra')
    ap.add_argument('--n', type=int, default=3, help='quantas alternativas mostrar')
    ap.add_argument('--cidade', action='store_true', help='deixa passar por povoacoes e ruas (por defeito evita-se, fora de %d m de casa)' % 1200)
    ap.add_argument('--povo-max', type=float, default=1.0, help='km maximos em povoacao/ruas fora do raio de casa')
    ap.add_argument('--data', default=None, help='dia da caminhada (AAAA-MM-DD; por defeito hoje)')
    ap.add_argument('--horas', nargs='*', type=float, default=[8, 9, 10, 11, 12], help='horas locais a considerar para a sombra do monte')
    a = ap.parse_args(); fontes_dir = a.fontes; t0 = time.time()
    lo, la = a.casa; mlat = 110540.0; mlon = 111320.0 * math.cos(math.radians(la))
    r = a.km[1] / 2 * 1.15 * 1000           # raio de procura: metade do comprimento, com folga
    caixa = (lo - r / mlon, la - r / mlat, lo + r / mlon, la + r / mlat)
    terr = Terreno(caixa)
    dia = datetime.date.fromisoformat(a.data) if a.data else datetime.date.today()
    # hora local de Lisboa: no verao UTC+1 (ultimo domingo de Marco a ultimo de Outubro)
    verao = datetime.date(dia.year, 3, 31 - (datetime.date(dia.year, 3, 31).weekday() + 1) % 7) <= dia < datetime.date(dia.year, 10, 31 - (datetime.date(dia.year, 10, 31).weekday() + 1) % 7)
    for h in a.horas:
        q = datetime.datetime(dia.year, dia.month, dia.day, int(h), int((h % 1) * 60), tzinfo=datetime.timezone.utc) - datetime.timedelta(hours=1 if verao else 0)
        terr.sol.append(posicao_sol(q, la, lo))
    print('zonas: %s' % ', '.join(T['nome'] for T in terr.zs))
    print('sol em %s as %s: altura %s' % (dia, ' '.join('%gh' % h for h in a.horas), ' '.join('%.0f' % s[0] for s in terr.sol)))
    global SEM_CIDADE; SEM_CIDADE = not a.cidade
    adj, arestas = grafo(caixa, terr, mlon, mlat, casa=(lo, la))
    print('grafo: %d nos, %d arestas (%.0f s)' % (len(adj), len(arestas), time.time() - t0), flush=True)
    casa = min(adj, key=lambda p: metros(p, (lo, la), mlon, mlat))
    dc = metros(casa, (lo, la), mlon, mlat)
    print('no de partida a %.0f m de casa: %.6f %.6f' % (dc, casa[0], casa[1]))
    d, comp, ant = dijkstra(adj, arestas, casa)
    meio = (a.km[0] + a.km[1]) / 2 * 1000 / 2
    cand = [n for n in d if 0.75 * meio <= comp[n] <= 1.35 * meio]
    # espalhar os candidatos pelas direccoes (36 sectores), os de menor custo em cada
    sect = {}
    for n in cand:
        s = int((math.degrees(math.atan2((n[1] - la) * mlat, (n[0] - lo) * mlon)) % 360) // 10)
        sect.setdefault(s, []).append(n)
    cand = []
    for s, ns in sect.items(): cand += sorted(ns, key=lambda n: d[n])[:6]
    print('%d pontos de viragem candidatos (%.1f-%.1f km de ida)' % (len(cand), 0.75 * meio / 1000, 1.35 * meio / 1000), flush=True)
    res = []
    for n in cand:
        ida = caminho(ant, casa, n)
        if not ida: continue
        penal = set((u, v) if u < v else (v, u) for u, v in zip(ida, ida[1:]))
        d2, comp2, ant2 = dijkstra(adj, arestas, n, penal=penal, alvo=casa)
        volta = caminho(ant2, n, casa)
        if not volta: continue
        nos = ida + volta[1:]
        ev = avalia(nos, arestas, terr, mlon, mlat)
        if not (a.km[0] <= ev['km'] <= a.km[1]) or ev['circular'] < a.circular: continue
        if SEM_CIDADE and ev['povo_km'] > a.povo_max: continue
        ev['nos'] = nos; ev['viragem'] = n
        ev['nota'] = ev['sombra'] - 0.3 * max(0, 0.85 - ev['circular'])
        res.append(ev)
    if not res: sys.exit('nenhum circuito cumpre %.0f-%.0f km com %.0f%% sem repetir' % (a.km[0], a.km[1], 100 * a.circular))
    res.sort(key=lambda e: -e['nota'])
    # tirar quase-duplicados (mesmo ponto de viragem a menos de 1 km)
    esc = []
    for e in res:
        if all(metros(e['viragem'], f['viragem'], mlon, mlat) > 1500 for f in esc): esc.append(e)
        if len(esc) >= a.n: break
    hm = lambda s: '%dh%02d' % (s // 3600, (s % 3600) // 60)
    for i, e in enumerate(esc):
        print('\n#%d  %.1f km  sombra %.0f%%  circular %.0f%%  sobe %.0f m  desce %.0f m  cotas %.0f-%.0f m  tempo a andar %s  povoacao/ruas fora de casa %.1f km'
              % (i + 1, e['km'], 100 * e['sombra'], 100 * e['circular'], e['sobe'], e['desce'], e['zmin'], e['zmax'], hm(e['tempo_s']), e['povo_km']))
        print('    vias: ' + ', '.join('%s %.1f km' % (NOME_VIA.get(h, h), v) for h, v in e['porVia'].items()))
        print('    viragem em %.5f %.5f' % e['viragem'])
    # GPX + JSON do melhor e das alternativas
    os.makedirs(os.path.dirname(a.saida) or '.', exist_ok=True)
    for i, e in enumerate(esc):
        nome = '%s%s' % (a.saida, '' if i == 0 else '_alt%d' % i)
        with open(nome + '.gpx', 'w', encoding='utf-8') as f:
            f.write('<?xml version="1.0" encoding="UTF-8"?>\n<gpx version="1.1" creator="sombra-na-estrela rota_sombra" xmlns="http://www.topografix.com/GPX/1/1">\n')
            f.write('<trk><name>Circular com sombra %.1f km (%.0f%% sob copa)</name><trkseg>\n' % (e['km'], 100 * e['sombra']))
            for (plo, pla), z in zip(e['nos'], e['z']): f.write('<trkpt lat="%.6f" lon="%.6f"><ele>%.1f</ele></trkpt>\n' % (pla, plo, z))
            f.write('</trkseg></trk></gpx>\n')
        json.dump({k: v for k, v in e.items() if k != 'nos'} | {'pontos': [[p[0], p[1], round(z, 1)] for p, z in zip(e['nos'], e['z'])]},
                  open(nome + '.json', 'w'), ensure_ascii=False)
    print('\nescrito %s.gpx (+%d alternativas)  %.0f s' % (a.saida, len(esc) - 1, time.time() - t0))


if __name__ == '__main__':
    main()

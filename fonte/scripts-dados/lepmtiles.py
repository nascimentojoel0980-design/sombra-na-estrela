# leitor minimo de PMTiles v3 + MVT, so o que faz falta
import struct, gzip, io, json

def varint(b, i):
    r = 0; s = 0
    while True:
        x = b[i]; i += 1
        r |= (x & 0x7f) << s
        if not (x & 0x80): return r, i
        s += 7

class PM:
    def __init__(self, caminho):
        self.f = open(caminho, 'rb')
        h = self.f.read(127)
        assert h[:7] == b'PMTiles', 'nao e pmtiles'
        (self.root_off, self.root_len, self.md_off, self.md_len,
         self.leaf_off, self.leaf_len, self.data_off, self.data_len) = struct.unpack('<QQQQQQQQ', h[8:72])
        self.n_addr, self.n_tile, self.n_ent = struct.unpack('<QQQ', h[72:96])
        self.clus = h[96]
        self.comp_dir, self.comp_tile = h[97], h[98]
        self.minz, self.maxz = h[100], h[101]

    def _le(self, off, ln, comp):
        self.f.seek(off); b = self.f.read(ln)
        if comp == 2: b = gzip.decompress(b)
        return b

    def _dir(self, off, ln):
        b = self._le(off, ln, self.comp_dir)
        i = 0; n, i = varint(b, i)
        ids = [0]*n; runs = [0]*n; lens = [0]*n; offs = [0]*n
        ult = 0
        for k in range(n):
            d, i = varint(b, i); ult += d; ids[k] = ult
        for k in range(n): runs[k], i = varint(b, i)
        for k in range(n): lens[k], i = varint(b, i)
        for k in range(n):
            v, i = varint(b, i)
            offs[k] = (offs[k-1] + lens[k-1]) if (v == 0 and k > 0) else (v - 1)
        return list(zip(ids, runs, lens, offs))

    @staticmethod
    def zxy_id(z, x, y):
        # Hilbert, como manda a especificacao
        acc = 0
        for t in range(z): acc += (1 << t) * (1 << t)
        n = 1 << z; rx = ry = 0; d = 0; xx, yy = x, y
        s = n // 2
        while s > 0:
            rx = 1 if (xx & s) > 0 else 0
            ry = 1 if (yy & s) > 0 else 0
            d += s * s * ((3 * rx) ^ ry)
            # rotate
            if ry == 0:
                if rx == 1:
                    xx = s - 1 - xx; yy = s - 1 - yy
                xx, yy = yy, xx
            s //= 2
        return acc + d

    def tile(self, z, x, y):
        # A procura numa directoria de PMTiles nao e "id igual": e a ULTIMA
        # entrada com id <= procurado. Se essa entrada tiver run_length 0 e um
        # apontador para uma sub-directoria (folha) e desce-se; se tiver run>0
        # cobre [id, id+run) e so ai se exige o intervalo. Com o teste de
        # igualdade nao se encontrava azulejo nenhum abaixo da raiz.
        tid = self.zxy_id(z, x, y)
        dirs = self._dir(self.root_off, self.root_len)
        for _ in range(4):
            achou = None
            for e in dirs:
                if e[0] <= tid: achou = e
                else: break
            if achou is None: return None
            i_, run, ln, off = achou
            if run == 0:
                dirs = self._dir(self.leaf_off + off, ln); continue
            if tid >= i_ + run: return None
            return self._le(self.data_off + off, ln, self.comp_tile)
        return None

def mvt_camadas(buf):
    """devolve {nome: [ (props, [aneis...]) ]} com coordenadas em 0..extent"""
    out = {}
    i = 0
    while i < len(buf):
        key, i = varint(buf, i)
        campo, tipo = key >> 3, key & 7
        if campo == 3 and tipo == 2:
            ln, i = varint(buf, i)
            nome, feats, ext = _camada(buf[i:i+ln])
            out[nome] = (feats, ext); i += ln
        else:
            i = _salta(buf, i, tipo)
    return out

def _salta(b, i, tipo):
    if tipo == 0: _, i = varint(b, i); return i
    if tipo == 2: ln, i = varint(b, i); return i + ln
    if tipo == 5: return i + 4
    if tipo == 1: return i + 8
    raise ValueError('tipo ' + str(tipo))

def _camada(b):
    nome = ''; ext = 4096; chaves = []; valores = []; feats = []
    i = 0
    while i < len(b):
        key, i = varint(b, i); campo, tipo = key >> 3, key & 7
        if campo == 1 and tipo == 2:
            ln, i = varint(b, i); nome = b[i:i+ln].decode('utf-8'); i += ln
        elif campo == 2 and tipo == 2:
            ln, i = varint(b, i); feats.append(b[i:i+ln]); i += ln
        elif campo == 3 and tipo == 2:
            ln, i = varint(b, i); chaves.append(b[i:i+ln].decode('utf-8')); i += ln
        elif campo == 4 and tipo == 2:
            ln, i = varint(b, i); valores.append(_valor(b[i:i+ln])); i += ln
        elif campo == 5:
            ext, i = varint(b, i)
        else:
            i = _salta(b, i, tipo)
    return nome, [_feat(f, chaves, valores) for f in feats], ext

def _valor(b):
    i = 0
    while i < len(b):
        key, i = varint(b, i); campo, tipo = key >> 3, key & 7
        if campo == 1 and tipo == 2:
            ln, i = varint(b, i); return b[i:i+ln].decode('utf-8', 'replace')
        if campo == 4 and tipo == 0: v, i = varint(b, i); return v
        if campo == 5 and tipo == 0: v, i = varint(b, i); return v
        if campo == 6 and tipo == 0:
            v, i = varint(b, i); return (v >> 1) ^ -(v & 1)
        if campo == 2 and tipo == 5: return struct.unpack('<f', b[i:i+4])[0]
        if campo == 3 and tipo == 1: return struct.unpack('<d', b[i:i+8])[0]
        i = _salta(b, i, tipo)
    return None

def _feat(b, chaves, valores):
    props = {}; geom = []; gtipo = 0
    i = 0
    while i < len(b):
        key, i = varint(b, i); campo, tipo = key >> 3, key & 7
        if campo == 2 and tipo == 2:
            ln, i = varint(b, i); fim = i + ln
            par = []
            while i < fim:
                v, i = varint(b, i); par.append(v)
            for k in range(0, len(par) - 1, 2):
                props[chaves[par[k]]] = valores[par[k+1]]
        elif campo == 3 and tipo == 0:
            gtipo, i = varint(b, i)
        elif campo == 4 and tipo == 2:
            ln, i = varint(b, i); fim = i + ln
            while i < fim:
                v, i = varint(b, i); geom.append(v)
        else:
            i = _salta(b, i, tipo)
    return props, gtipo, geom

def aneis(geom):
    """descodifica os comandos do MVT em aneis de (x,y)"""
    out = []; cur = []; x = y = 0; i = 0
    while i < len(geom):
        cmd = geom[i]; i += 1
        op, cnt = cmd & 7, cmd >> 3
        if op == 1:      # MoveTo
            for _ in range(cnt):
                dx = geom[i]; dy = geom[i+1]; i += 2
                x += (dx >> 1) ^ -(dx & 1); y += (dy >> 1) ^ -(dy & 1)
                if cur: out.append(cur)
                cur = [(x, y)]
        elif op == 2:    # LineTo
            for _ in range(cnt):
                dx = geom[i]; dy = geom[i+1]; i += 2
                x += (dx >> 1) ^ -(dx & 1); y += (dy >> 1) ^ -(dy & 1)
                cur.append((x, y))
        elif op == 7:    # ClosePath
            if cur: out.append(cur); cur = []
    if cur: out.append(cur)
    return out

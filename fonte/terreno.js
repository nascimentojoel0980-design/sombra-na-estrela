// ===========================================================================
// Terreno de raiz: uma malha so, cozida, que nunca se reconstroi
// ---------------------------------------------------------------------------
// A camada de arvores do mapa constroi celulas ENQUANTO O MAPA SE MEXE. E daí
// que vem o piscar: o que se ve depende do que ja deu tempo de construir, e
// andar para o lado paga celulas novas. Aqui o problema nao se resolve, apaga-
// se: o ficheiro .terr traz a caixa inteira, e ao abrir fazem-se DUAS coisas,
// uma unica vez:
//
//   1. a malha do terreno da caixa toda -> um VBO estatico
//   2. todas as plantas da caixa toda   -> um VBO estatico
//
// A partir daqui andar, rodar e inclinar nao tocam em buffer nenhum. Nao ha
// nada para construir, logo nao ha nada que possa chegar tarde.
//
// O QUE MUDA COM A DISTANCIA, E O QUE NAO MUDA
//
// Desenhar 2,9 milhoes de plantas a cada fotograma nao cabe em telemovel
// nenhum -- sao ~90 milhoes de triangulos. Mas o que se corta NAO e uma zona
// do mapa: e uma FRACCAO CONSTANTE de cada sitio. Cada planta traz um posto
// (rank) fixo, sorteado na posicao. A fracao desenhada a distancia d e
// (D0/d)^2, ou seja o mesmo numero de plantas POR PIXEL em todo o ecra. Como
// o posto e fixo e a distancia e continua, a planta que sai e sempre a mesma e
// sai a MURCHAR, nao a apagar-se. E como o buffer nunca muda, voltar atras
// mostra exactamente o que estava la antes.
//
// Os blocos de 1 km servem so para nao mandar ao cartao coisas que estao atras
// da cabeca. Nao sao pedacos carregados a parte: estao todos no mesmo buffer,
// cozidos ao mesmo tempo; um bloco e so um intervalo de indices.
// ===========================================================================

const CLASSES = {
  //            cor do chao   o que nasce  altura  raio/altura  por m2
  0: { cor: [0.93, 0.92, 0.87] },                                        // nada
  1: { cor: [0.90, 0.87, 0.84] },                                        // urbano
  2: { cor: [0.94, 0.91, 0.82] },                                        // agricola
  3: { cor: [0.91, 0.92, 0.80] },                                        // pastagens
  4: { cor: [0.86, 0.89, 0.76], tipo: 0, h: 8.0,  k: 0.70, lam: 0.0045, conif: 0.0 },
  5: { cor: [0.77, 0.84, 0.72], tipo: 0, h: 14.0, k: 0.21, lam: 0.0430, conif: 0.62 },
  6: { cor: [0.87, 0.85, 0.74], tipo: 1, h: 1.4,  k: 1.25, lam: 0.0200 },
  7: { cor: [0.84, 0.83, 0.81], tipo: 2, h: 2.0,  k: 0.75, lam: 0.0120 },
  9: { cor: [0.55, 0.75, 0.88] },                                        // agua
};
const BLOCO = 1000;        // m: so para nao desenhar o que esta atras
const D0 = 250;            // m: dentro disto vai tudo o que a carta diz

// ------------------------------------------------------------------ ficheiro
async function carregaTerreno(url) {
  const r = await fetch(url);
  if (!r.ok) throw new Error('nao abriu ' + url + ': ' + r.status);
  let buf = await r.arrayBuffer();
  // Ha servidores que desencolhem o .gz sozinhos e outros que o entregam tal
  // e qual. Em vez de adivinhar pelo nome, olha-se para os dois primeiros
  // bytes: 1f 8b e gzip, 'TERR' ja vem pronto.
  const b0 = new Uint8Array(buf, 0, 2);
  if (b0[0] === 0x1f && b0[1] === 0x8b) {
    if (typeof DecompressionStream === 'undefined')
      throw new Error('o ficheiro veio comprimido e este navegador nao o sabe abrir');
    buf = await new Response(new Blob([buf]).stream()
      .pipeThrough(new DecompressionStream('gzip'))).arrayBuffer();
  }
  const d = new DataView(buf);
  const magia = String.fromCharCode(d.getUint8(0), d.getUint8(1), d.getUint8(2), d.getUint8(3));
  if (magia !== 'TERR') throw new Error('nao e um ficheiro TERR (veio ' + magia + ')');
  const T = {
    versao: d.getUint16(4, true),
    lo0: d.getFloat64(8, true), la0: d.getFloat64(16, true),
    lo1: d.getFloat64(24, true), la1: d.getFloat64(32, true),
    nx: d.getUint16(40, true), ny: d.getUint16(42, true), passo: d.getFloat32(44, true),
    z0: d.getFloat32(48, true), z1: d.getFloat32(52, true),
    mx: d.getUint16(56, true), my: d.getUint16(58, true), passoC: d.getFloat32(60, true),
    nRotas: d.getUint32(64, true), nPontos: d.getUint32(68, true),
  };
  let o = 80;
  T.cotas = new Uint16Array(buf, o, T.nx * T.ny); o += T.nx * T.ny * 2;
  T.classe = new Uint8Array(buf, o, T.mx * T.my); o += T.mx * T.my;
  const comp = new Uint32Array(buf.slice(o, o + T.nRotas * 4)); o += T.nRotas * 4;
  const pts = new Float32Array(buf.slice(o, o + T.nPontos * 8));
  T.rotas = []; let k = 0;
  for (let i = 0; i < T.nRotas; i++) {
    const n = comp[i], l = new Float32Array(n * 2);
    for (let j = 0; j < n * 2; j++) l[j] = pts[k++];
    T.rotas.push(l);
  }
  // metros locais: origem no canto sudoeste da caixa
  T.mlat = 110540; T.mlon = 111320 * Math.cos((T.la0 + T.la1) / 2 * Math.PI / 180);
  T.larg = (T.lo1 - T.lo0) * T.mlon;
  T.alt = (T.la1 - T.la0) * T.mlat;
  T.cota = (i, j) => T.z0 + T.cotas[j * T.nx + i] / 65535 * (T.z1 - T.z0);
  return T;
}

// ---------------------------------------------------------------- malha
// Uma malha so para a caixa inteira. O norte e a linha 0 das cotas; em metros
// locais o y cresce para norte, por isso a linha 0 fica em y = alt.
function malhaTerreno(T) {
  const { nx, ny } = T;
  const pos = new Float32Array(nx * ny * 3);
  const nor = new Float32Array(nx * ny * 3);
  const dx = T.larg / (nx - 1), dy = T.alt / (ny - 1);
  for (let j = 0; j < ny; j++) {
    for (let i = 0; i < nx; i++) {
      const o = (j * nx + i) * 3;
      pos[o] = i * dx; pos[o + 1] = T.alt - j * dy; pos[o + 2] = T.cota(i, j);
    }
  }
  // normais por diferencas centrais na grelha, que e regular
  for (let j = 0; j < ny; j++) {
    for (let i = 0; i < nx; i++) {
      const iw = i > 0 ? i - 1 : i, ie = i < nx - 1 ? i + 1 : i;
      const jn = j > 0 ? j - 1 : j, js = j < ny - 1 ? j + 1 : j;
      const zx = (T.cota(ie, j) - T.cota(iw, j)) / ((ie - iw) * dx);
      const zy = (T.cota(i, jn) - T.cota(i, js)) / ((js - jn) * dy);
      const l = Math.hypot(zx, zy, 1), o = (j * nx + i) * 3;
      nor[o] = -zx / l; nor[o + 1] = -zy / l; nor[o + 2] = 1 / l;
    }
  }
  const idx = new Uint32Array((nx - 1) * (ny - 1) * 6);
  let k = 0;
  for (let j = 0; j < ny - 1; j++) {
    for (let i = 0; i < nx - 1; i++) {
      const a = j * nx + i, b = a + 1, c = a + nx, e = c + 1;
      idx[k++] = a; idx[k++] = c; idx[k++] = b;
      idx[k++] = b; idx[k++] = c; idx[k++] = e;
    }
  }
  return { pos, nor, idx, nVert: nx * ny, nInd: idx.length };
}

// ------------------------------------------------------------- as plantas
// Numero inteiro e determinista a partir da posicao. Nada de sin(): sobre um
// intervalo pequeno o fract(sin()) degenera e as arvores saem as riscas.
function baralha(a, b, c) {
  let h = (a * 374761393 + b * 668265263 + c * 1274126177) | 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}

// Gera TODAS as plantas da caixa, uma vez. Devolve o buffer entrelacado e o
// indice dos blocos (so para nao mandar desenhar o que esta atras).
function semeiaTudo(T, op) {
  op = op || {};
  const dens = op.densidade == null ? 1 : op.densidade;
  const { mx, my, passoC } = T;
  const bx = Math.ceil(T.larg / BLOCO), by = Math.ceil(T.alt / BLOCO);
  const nB = bx * by;
  // 1a passagem: contar por bloco, para nao crescer arrays
  const conta = new Uint32Array(nB);
  const porCelula = new Float32Array(256);
  for (const c in CLASSES) {
    const E = CLASSES[c];
    porCelula[c] = E.lam ? E.lam * passoC * passoC * dens : 0;
  }
  const cx = (i) => (i + 0.5) * (T.larg / mx);
  const cy = (j) => T.alt - (j + 0.5) * (T.alt / my);
  const bloco = (x, y) => Math.min(by - 1, Math.max(0, Math.floor((T.alt - y) / BLOCO))) * bx
                        + Math.min(bx - 1, Math.max(0, Math.floor(x / BLOCO)));
  const quantos = (i, j, cod) => {
    const m = porCelula[cod];
    if (!m) return 0;
    const n = Math.floor(m);
    return n + (baralha(i, j, 11) < (m - n) ? 1 : 0);
  };
  for (let j = 0; j < my; j++) {
    for (let i = 0; i < mx; i++) {
      const v = T.classe[j * mx + i];
      if (v & 128) continue;                 // corredor do percurso
      const n = quantos(i, j, v & 127);
      if (n) conta[bloco(cx(i), cy(j))] += n;
    }
  }
  let total = 0;
  const ini = new Uint32Array(nB + 1);
  for (let b = 0; b < nB; b++) { ini[b] = total; total += conta[b]; }
  ini[nB] = total;

  // 2a passagem: escrever. 12 bytes por planta.
  //   0 x uint16   2 y uint16   4 z uint16   6 altura u8   7 raio u8
  //   8 tipo u8    9 tom u8    10 rot u8    11 posto u8
  const buf = new ArrayBuffer(total * 12);
  const U16 = new Uint16Array(buf), U8 = new Uint8Array(buf);
  const cursor = ini.slice(0, nB);
  const kz = 65535 / (T.z1 - T.z0);
  const kx = 65535 / T.larg, ky = 65535 / T.alt;
  // cota interpolada na grelha de cotas
  const cotaEm = (x, y) => {
    const fx = Math.min(T.nx - 1.001, Math.max(0, x / T.larg * (T.nx - 1)));
    const fy = Math.min(T.ny - 1.001, Math.max(0, (T.alt - y) / T.alt * (T.ny - 1)));
    const i0 = fx | 0, j0 = fy | 0, u = fx - i0, v = fy - j0;
    const a = T.cota(i0, j0), b = T.cota(i0 + 1, j0);
    const c = T.cota(i0, j0 + 1), d = T.cota(i0 + 1, j0 + 1);
    return (a * (1 - u) + b * u) * (1 - v) + (c * (1 - u) + d * u) * v;
  };
  const larguraCel = T.larg / mx, alturaCel = T.alt / my;
  for (let j = 0; j < my; j++) {
    for (let i = 0; i < mx; i++) {
      const v = T.classe[j * mx + i];
      if (v & 128) continue;
      const cod = v & 127;
      const n = quantos(i, j, cod);
      if (!n) continue;
      const E = CLASSES[cod];
      for (let k = 0; k < n; k++) {
        const x = (i + baralha(i, j, 20 + k)) * larguraCel;
        const y = T.alt - (j + baralha(i, j, 40 + k)) * alturaCel;
        const b = bloco(x, y), o = cursor[b]++ * 12, o2 = o >> 1;
        const alt = E.h * (0.72 + 0.56 * baralha(i, j, 60 + k));
        const raio = Math.max(0.35, alt * E.k * (0.85 + 0.3 * baralha(i, j, 80 + k)));
        U16[o2] = Math.min(65535, x * kx);
        U16[o2 + 1] = Math.min(65535, y * ky);
        U16[o2 + 2] = Math.max(0, Math.min(65535, (cotaEm(x, y) - T.z0) * kz));
        U8[o + 6] = Math.min(255, Math.round(alt * 10));
        U8[o + 7] = Math.min(255, Math.round(raio * 20));
        // tipo nos 2 bits de baixo, forma no bit 2
        U8[o + 8] = E.tipo | (baralha(i, j, 100 + k) < (E.conif || 0) ? 0 : 4);
        U8[o + 9] = Math.round(baralha(i, j, 120 + k) * 255);
        U8[o + 10] = Math.round(baralha(i, j, 140 + k) * 255);
        U8[o + 11] = Math.round(baralha(i, j, 160 + k) * 255);   // posto
      }
    }
  }
  // dentro de cada bloco, ordenar por posto: assim desenhar um prefixo do
  // bloco e desenhar "os primeiros x% de todo o bloco", nao um canto dele.
  const tmp = new Uint8Array(12);
  const u8 = new Uint8Array(buf);
  for (let b = 0; b < nB; b++) {
    const a = ini[b], z = ini[b + 1], n = z - a;
    if (n < 2) continue;
    const ord = new Uint32Array(n);
    for (let t = 0; t < n; t++) ord[t] = t;
    ord.sort((p, q) => u8[(a + p) * 12 + 11] - u8[(a + q) * 12 + 11]);
    const copia = u8.slice(a * 12, z * 12);
    for (let t = 0; t < n; t++) u8.set(copia.subarray(ord[t] * 12, ord[t] * 12 + 12), (a + t) * 12);
  }
  return { buf, total, ini, bx, by, nB };
}

if (typeof module !== 'undefined') module.exports = { carregaTerreno, malhaTerreno, semeiaTudo, CLASSES, BLOCO, D0 };

// ===========================================================================
// O desenho. WebGL2 directo, sem biblioteca de mapa por baixo.
// ===========================================================================
const VS_CHAO = `#version 300 es
in vec3 aP; in vec3 aN;
uniform mat4 uMVP; uniform vec3 uCam; uniform vec2 uTam;
out vec3 vN; out vec2 vUV; out float vD;
void main() {
  vN = aN; vUV = vec2(aP.x / uTam.x, 1.0 - aP.y / uTam.y);
  vD = length(aP - uCam);
  gl_Position = uMVP * vec4(aP, 1.0);
}`;
const FS_CHAO = `#version 300 es
precision highp float;
in vec3 vN; in vec2 vUV; in float vD;
uniform sampler2D uClasse; uniform vec3 uFundo; uniform float uNevoa;
out vec4 oCor;
void main() {
  vec3 sol = normalize(vec3(-0.55, 0.45, 0.70));
  vec3 n = normalize(vN);
  float lam = max(0.0, dot(n, sol));
  float ceu = 0.5 + 0.5 * n.z;
  vec3 base = texture(uClasse, vUV).rgb;
  vec3 c = base * (0.42 + 0.54 * lam + 0.16 * ceu);
  oCor = vec4(mix(c, uFundo, clamp(vD / uNevoa, 0.0, 1.0) * 0.85), 1.0);
}`;

const VS_PLANTA = `#version 300 es
in vec4 aV;        // ux, uy, t, parte(0 copa 1 tronco)
in float aBossa;
in vec3 aPos;      // x, y, z normalizados na caixa
in vec4 aPar;      // altura*10, raio*20, tipo|forma, tom
in vec2 aRot;      // rodar, posto
uniform mat4 uMVP; uniform vec3 uCam;
uniform vec3 uCaixa;       // largura, altura, (z1-z0) em metros
uniform float uZ0;
uniform float uD0;         // raio de densidade cheia
out vec3 vCor; out float vLuz; out float vD;
void main() {
  vec3 p0 = vec3(aPos.x * uCaixa.x, aPos.y * uCaixa.y, uZ0 + aPos.z * uCaixa.z);
  float alt = aPar.x * 0.1, raio = aPar.y * 0.05;
  float tipo = mod(aPar.z, 4.0);
  float forma = aPar.z >= 4.0 ? 1.0 : 0.0;
  float tom = aPar.w / 255.0;
  float rot = aRot.x * 6.283, posto = aRot.y;

  // Quanto desta planta se ve, a esta distancia. A fraccao e (D0/d)^2 --
  // o mesmo numero de plantas por pixel em todo o ecra -- e quem fica e quem
  // tem posto baixo. O posto e fixo na posicao, logo e sempre a mesma planta.
  float d = max(1.0, length(p0 - uCam));
  float frac = clamp((uD0 / d) * (uD0 / d), 0.0, 1.0);
  // murcha em vez de apagar: a ultima decima do corte e uma rampa
  float vive = smoothstep(frac, frac * 0.82, posto);
  if (vive <= 0.001) { gl_Position = vec4(2.0, 2.0, 2.0, 1.0); return; }

  float t = aV.z; vec3 p; vec3 nrm;
  if (aV.w < 0.5) {
    float cone = pow(1.0 - t, 0.85);
    float bola = sqrt(max(0.0, 1.0 - pow(abs(2.0 * t - 1.0), 2.2)));
    float r = mix(cone, bola, forma);
    float base = mix(0.30, 0.34, forma) * alt;
    if (tipo > 0.5) {
      r = tipo > 1.5 ? mix(1.0, 0.42, t) : sqrt(max(0.0, 1.0 - t * t));
      base = 0.0;
    }
    r *= aBossa;
    p = vec3(aV.xy * r * raio, base + t * (alt - base));
    if (tipo > 1.5)      nrm = normalize(vec3(aV.xy, 0.45));
    else if (tipo > 0.5) nrm = normalize(vec3(aV.xy * r * alt, max(0.08, t) * raio));
    else nrm = normalize(vec3(aV.xy * mix(1.0, 1.6, forma), mix(0.75, 0.45, forma)));
  } else if (tipo > 0.5) {
    p = vec3(0.0); nrm = vec3(0.0, 0.0, 1.0);
  } else {
    float rt = max(0.09, 0.016 * alt);
    p = vec3(aV.xy * rt, t * mix(0.34, 0.40, forma) * alt);
    nrm = vec3(aV.xy, 0.0);
  }
  float s = sin(rot), c = cos(rot);
  p.xy = vec2(p.x * c - p.y * s, p.x * s + p.y * c);
  nrm.xy = vec2(nrm.x * c - nrm.y * s, nrm.x * s + nrm.y * c);
  p *= vive;

  vec3 sol = normalize(vec3(-0.55, 0.45, 0.70));
  float lam = max(0.0, dot(normalize(nrm), sol));
  float ceu = 0.5 + 0.5 * normalize(nrm).z;
  vLuz = 0.46 + 0.42 * lam + 0.18 * ceu;
  vec3 cor;
  if (tipo > 1.5)      cor = vec3(0.53 + 0.17 * tom, 0.52 + 0.17 * tom, 0.50 + 0.16 * tom);
  else if (tipo > 0.5) cor = vec3(0.42 + 0.14 * tom, 0.44 + 0.15 * tom, 0.25 + 0.11 * tom);
  else                 cor = vec3(0.24 + 0.22 * tom, 0.44 + 0.26 * tom, 0.25 + 0.18 * tom);
  vCor = aV.w < 0.5 ? cor : vec3(0.46, 0.36, 0.26);
  vD = d;
  gl_Position = uMVP * vec4(p0 + p, 1.0);
}`;
const FS_PLANTA = `#version 300 es
precision mediump float;
in vec3 vCor; in float vLuz; in float vD;
uniform vec3 uFundo; uniform float uNevoa;
out vec4 oCor;
void main() {
  oCor = vec4(mix(vCor * vLuz, uFundo, clamp(vD / uNevoa, 0.0, 1.0) * 0.85), 1.0);
}`;

function modeloPlanta() {
  // 6 lados x 2 aneis de copa + 6 de tronco = 36 triangulos. Com 87 mil
  // plantas a vista sao 3,1 milhoes de triangulos: cabe. Com 7x3 eram 4,9.
  const LADOS = 6, ANEIS = 2, V = [];
  const bossa = (i, k) => 0.80 + 0.40 * baralha(i, k, 3);
  const anel = (i, t) => {
    const a = i / LADOS * 6.283185;
    return [Math.cos(a), Math.sin(a), t];
  };
  for (let r = 0; r < ANEIS; r++) {
    const t0 = r / ANEIS, t1 = (r + 1) / ANEIS;
    for (let i = 0; i < LADOS; i++) {
      const a0 = anel(i, t0), a1 = anel(i + 1, t0);
      const b0 = anel(i, t1), b1 = anel(i + 1, t1);
      const q = [[a0, i, r], [b0, i, r + 1], [a1, i + 1, r],
                 [a1, i + 1, r], [b0, i, r + 1], [b1, i + 1, r + 1]];
      for (const [v, ii, rr] of q) V.push(v[0], v[1], v[2], 0, bossa(ii % LADOS, rr));
    }
  }
  for (let i = 0; i < LADOS; i++) {          // tronco
    const a0 = anel(i, 0), a1 = anel(i + 1, 0);
    const b0 = anel(i, 1), b1 = anel(i + 1, 1);
    const q = [[a0], [b0], [a1], [a1], [b0], [b1]];
    for (const [v] of q) V.push(v[0], v[1], v[2], 1, 1);
  }
  return new Float32Array(V);
}

function prog(gl, vs, fs) {
  const c = (t, s) => {
    const o = gl.createShader(t); gl.shaderSource(o, s); gl.compileShader(o);
    if (!gl.getShaderParameter(o, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(o));
    return o;
  };
  const p = gl.createProgram();
  gl.attachShader(p, c(gl.VERTEX_SHADER, vs));
  gl.attachShader(p, c(gl.FRAGMENT_SHADER, fs));
  gl.linkProgram(p);
  if (!gl.getProgramParameter(p, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(p));
  return p;
}

// matrizes (coluna maior, como o WebGL quer)
function perspetiva(fovY, asp, zn, zf) {
  const f = 1 / Math.tan(fovY / 2);
  return new Float32Array([f / asp, 0, 0, 0, 0, f, 0, 0, 0, 0, (zf + zn) / (zn - zf), -1,
                           0, 0, 2 * zf * zn / (zn - zf), 0]);
}
function olhar(olho, alvo, cima) {
  const z = [olho[0] - alvo[0], olho[1] - alvo[1], olho[2] - alvo[2]];
  let l = Math.hypot(z[0], z[1], z[2]); z[0] /= l; z[1] /= l; z[2] /= l;
  const x = [cima[1] * z[2] - cima[2] * z[1], cima[2] * z[0] - cima[0] * z[2], cima[0] * z[1] - cima[1] * z[0]];
  l = Math.hypot(x[0], x[1], x[2]) || 1; x[0] /= l; x[1] /= l; x[2] /= l;
  const y = [z[1] * x[2] - z[2] * x[1], z[2] * x[0] - z[0] * x[2], z[0] * x[1] - z[1] * x[0]];
  return new Float32Array([x[0], y[0], z[0], 0, x[1], y[1], z[1], 0, x[2], y[2], z[2], 0,
    -(x[0] * olho[0] + x[1] * olho[1] + x[2] * olho[2]),
    -(y[0] * olho[0] + y[1] * olho[1] + y[2] * olho[2]),
    -(z[0] * olho[0] + z[1] * olho[1] + z[2] * olho[2]), 1]);
}
function mult(a, b) {
  const o = new Float32Array(16);
  for (let i = 0; i < 4; i++) for (let j = 0; j < 4; j++) {
    let s = 0; for (let k = 0; k < 4; k++) s += a[k * 4 + j] * b[i * 4 + k];
    o[i * 4 + j] = s;
  }
  return o;
}

if (typeof module !== 'undefined') Object.assign(module.exports,
  { modeloPlanta, perspetiva, olhar, mult, VS_CHAO, FS_CHAO, VS_PLANTA, FS_PLANTA, prog });

// ------------------------------------------------------------- percursos
// O tracado desenha-se como FITA sobre a mesma malha, nao como linha 2D
// projectada por cima: assim uma lomba tapa mesmo o que esta do outro lado, e
// o percurso passa por dentro do corredor que ja foi aberto na vegetacao.
function fitaRotas(T, largura, acima) {
  largura = largura || 7; acima = acima || 1.2;
  const cotaEm = (x, y) => {
    const fx = Math.min(T.nx - 1.001, Math.max(0, x / T.larg * (T.nx - 1)));
    const fy = Math.min(T.ny - 1.001, Math.max(0, (T.alt - y) / T.alt * (T.ny - 1)));
    const i = fx | 0, j = fy | 0, u = fx - i, v = fy - j;
    const a = T.cota(i, j), b = T.cota(i + 1, j), c = T.cota(i, j + 1), d = T.cota(i + 1, j + 1);
    return (a * (1 - u) + b * u) * (1 - v) + (c * (1 - u) + d * u) * v;
  };
  const emM = (lo, la) => [(lo - T.lo0) * T.mlon, (la - T.la0) * T.mlat];
  const V = [];
  const h = largura / 2;
  for (const l of T.rotas) {
    const n = l.length / 2;
    if (n < 2) continue;
    const P = new Array(n);
    for (let i = 0; i < n; i++) P[i] = emM(l[i * 2], l[i * 2 + 1]);
    for (let i = 0; i + 1 < n; i++) {
      const a = P[i], b = P[i + 1];
      let dx = b[0] - a[0], dy = b[1] - a[1];
      const L = Math.hypot(dx, dy);
      if (L < 0.5 || L > 400) continue;            // salta saltos de azulejo
      dx /= L; dy /= L;
      const px = -dy * h, py = dx * h;
      const za = cotaEm(a[0], a[1]) + acima, zb = cotaEm(b[0], b[1]) + acima;
      const a0 = [a[0] - px, a[1] - py, za], a1 = [a[0] + px, a[1] + py, za];
      const b0 = [b[0] - px, b[1] - py, zb], b1 = [b[0] + px, b[1] + py, zb];
      for (const q of [a0, b0, a1, a1, b0, b1]) V.push(q[0], q[1], q[2]);
    }
  }
  return new Float32Array(V);
}

const VS_ROTA = `#version 300 es
in vec3 aP; uniform mat4 uMVP; uniform vec3 uCam; out float vD;
void main(){ vD = length(aP - uCam); gl_Position = uMVP * vec4(aP, 1.0); }`;
const FS_ROTA = `#version 300 es
precision mediump float; in float vD;
uniform vec3 uFundo; uniform float uNevoa; uniform vec3 uCor;
out vec4 oCor;
void main(){ oCor = vec4(mix(uCor, uFundo, clamp(vD / uNevoa, 0.0, 1.0) * 0.85), 1.0); }`;

if (typeof module !== 'undefined') Object.assign(module.exports, { fitaRotas, VS_ROTA, FS_ROTA });

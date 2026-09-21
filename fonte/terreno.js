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
  1: { cor: [0.84, 0.76, 0.72] },                                        // urbano
  2: { cor: [0.93, 0.87, 0.65] },                                        // agricola
  3: { cor: [0.84, 0.89, 0.62] },                                        // pastagens
  4: { cor: [0.78, 0.84, 0.60], tipo: 0, h: 8.0,  k: 0.70, lam: 0.0045, conif: 0.0 },
  5: { cor: [0.50, 0.68, 0.48], tipo: 0, h: 14.0, k: 0.21, lam: 0.0430, conif: 0.62 },
  6: { cor: [0.80, 0.76, 0.52], tipo: 1, h: 1.4,  k: 1.25, lam: 0.0200 },
  7: { cor: [0.76, 0.75, 0.73], tipo: 2, h: 2.0,  k: 0.75, lam: 0.0120 },
  // Parede e escarpa. Nao leva 'lam', logo nao nasce la nada -- e isso e o
  // ponto: uma pedra de 2 m espetada para fora de uma parede dos Cantaros nao
  // e rocha, e um erro. A rocha da classe 7 sao blocos POUSADOS num chao de
  // declive suave; isto e o proprio terreno de pe. A paleta le as cores de
  // CLASSES, por isso esta entrada tem de existir ou o chao sai preto.
  8: { cor: [0.55, 0.53, 0.51] },                                        // parede
  9: { cor: [0.38, 0.64, 0.85] },                                        // agua
  // Chao nu. O que o CHM diz que nao tem nada de pe e a COS ainda chama
  // floresta. Ia para pastagens, e no Sentinel de 22/07/2024 e a superficie
  // MAIS BRANCA da caixa -- mais clara que o proprio planalto de rocha. Pintar
  // isso de verde-palha era a unica coisa no mapa que a imagem desmentia a
  // olho. NDVI +0,39, abaixo do matos (+0,47) e da rocha da COS (+0,49): e o
  // menos vegetado que ha aqui. Sem 'lam': nao nasce nada.
  10: { cor: [0.90, 0.85, 0.76] },                                      // chao nu
  // Matagal: o mato que o laser mede ACIMA de 1,5 m. Nao e uma classe nova da
  // carta -- e a mesma classe 6 partida em duas pela medicao. Giesta e urze
  // alta de 2 ou 3 m nao se andam como se anda num urzal rasteiro, e ate agora
  // eram a mesma cor e a mesma altura desenhada.
  11: { cor: [0.66, 0.72, 0.48], tipo: 1, h: 2.4,  k: 1.05, lam: 0.0260 },
  // Zonas humidas da COS 2025 (classe 8 da COS; 8 no motor ja era 'parede').
  // Nao nasce nada: turfeira e lameiro encharcado, nao mato.
  12: { cor: [0.62, 0.76, 0.70] },
  // Ardido recente: fogo depois das fontes (LiDAR 2024, COS 2025), da carta
  // do ICNF. Cinza e chao queimado; nao nasce nada. A carta e o laser ainda
  // dizem pinhal -- e o que la estava quando mediram.
  13: { cor: [0.40, 0.33, 0.29] },
};
// contornos das areas ardidas (ICNF), por ano: a historia do fogo por cima do chao
const COR_ARDIDA = (ano) => ano >= 2025 ? [0.80, 0.10, 0.08] : ano >= 2024 ? [0.93, 0.48, 0.08]
                          : ano >= 2022 ? [0.62, 0.20, 0.55] : [0.45, 0.30, 0.12];
const ARDIDAS_LEGENDA = [{ nome: '2025', cor: COR_ARDIDA(2025) }, { nome: '2024', cor: COR_ARDIDA(2024) },
                         { nome: '2022–2023', cor: COR_ARDIDA(2022) }, { nome: '2017–2021', cor: COR_ARDIDA(2017) }];
const agoraMs = () => (typeof performance !== 'undefined' ? performance : Date).now();
// Por onde se anda nao cresce mato. Cada genero tem a sua largura limpa, de
// cada lado do eixo, e a sua largura desenhada. Nao e enfeite: e o que faz o
// caminho ler-se de cima por entre as copas.
// Os nomes vivem ao pe das cores de proposito: a legenda da pagina e GERADA
// destas tabelas, nao escrita a mao. Uma legenda escrita a mao mente no dia em
// que alguem mexe numa cor e se esquece dela.
const NOME_CLASSE = {
  0: 'sem dado', 1: 'urbano', 2: 'agrícola', 3: 'pastagem', 4: 'montado',
  5: 'floresta', 6: 'mato rasteiro', 7: 'rocha com blocos', 8: 'parede de rocha',
  9: 'água', 10: 'chão nu', 11: 'matagal', 12: 'zona húmida', 13: 'ardido recente (fogo desde 07/2024, ICNF)',
};

const CAMINHOS = [
  // 20/09/2026: cores mais afastadas umas das outras, a pedido -- laranja
  // forte, amarelo, castanho, cinzento claro, vermelho escuro; as larguras
  // ja eram diferentes (9 / 7 / 4,5 / 3 / 2,2 m)
  // Estradas alcatroadas: cinzento escuro com o eixo pintado por cima
  // (eixo: true desenha uma segunda fita fina, clara, ao centro).
  { n: 'nacional', limpo: 11, larg: 9.0, cor: [0.19, 0.19, 0.21], eixo: true },
  { n: 'estrada',  limpo:  9, larg: 7.0, cor: [0.25, 0.25, 0.27], eixo: true },
  { n: 'estradao', limpo:  6, larg: 4.5, cor: [0.50, 0.34, 0.16] },
  { n: 'caminho',  limpo:  5, larg: 3.0, cor: [0.78, 0.76, 0.72] },
  { n: 'trilho',   limpo:  4, larg: 2.2, cor: [0.58, 0.14, 0.12] },
  // linhas de agua do OSM (20/09/2026): a COS so tem cursos com 20 m de
  // largura e o Sentinel nao ve 3 m -- o Zezere no Covao nao existia no mapa
  { n: 'rio',      limpo:  3, larg: 3.0, cor: [0.30, 0.55, 0.82] },
  { n: 'ribeira',  limpo:  2, larg: 1.6, cor: [0.36, 0.60, 0.84] },
  { n: 'levada',   limpo:  1.5, larg: 1.4, cor: [0.42, 0.64, 0.84] },
  // 'urbana' nao vem do ficheiro: e um 'caminho' (rua residencial, de servico
  // ou sem classificacao no OSM) sem piso conhecido cuja maioria dos vertices
  // cai em URBANO da COS. Uma rua dentro de uma povoacao esta alcatroada,
  // e pintava-se de cinzento claro como um caminho rural (21/09/2026).
  { n: 'urbana',   limpo:  5, larg: 4.0, cor: [0.38, 0.38, 0.40], inferida: 'rua residencial ou de serviço; ou caminho em urbano da COS', legenda: 'urbana' },
  { n: 'autoestrada', limpo: 14, larg: 12.0, cor: [0.14, 0.14, 0.16], eixo: true, legenda: 'auto-estrada / IP' },
];
// nomes que a legenda mostra (o codigo interno fica)
const NOME_CAMINHO = { nacional: 'nacional (N)', estrada: 'municipal / secundária', estradao: 'estradão',
                       caminho: 'rural sem classificação', trilho: 'trilho', rio: 'rio', ribeira: 'ribeira', levada: 'levada' };
// Os pontos com nome agrupam-se por cor: a legenda da pagina le isto.
const GRUPO_PONTO = {
  cume: 'cume', povoacao: 'povoacao', aldeia: 'povoacao',
  agua: 'agua', lagoa: 'agua', cascata: 'agua', nascente: 'agua',
  monumento: 'patrimonio', castelo: 'patrimonio', igreja: 'patrimonio',
  ruinas: 'patrimonio', arqueologia: 'patrimonio',
  ver: 'interesse', miradouro: 'interesse', piquenique: 'interesse',
  abrigo: 'interesse', campismo: 'interesse', parque: 'interesse',
};
const SINAL_PONTO = { cume: '▲ ', patrimonio: '◆ ', interesse: '● ', agua: '~ ' };
const PONTOS_LEGENDA = [
  { g: 'cume',       nome: 'cume',                 cor: '#5B4426' },
  { g: 'povoacao',   nome: 'povoação',             cor: '#3A3226' },
  { g: 'patrimonio', nome: 'monumento, castelo, igreja, ruínas', cor: '#1E5BD8' },
  { g: 'interesse',  nome: 'miradouro, abrigo, campismo, sítio a ver', cor: '#A0308F' },
  { g: 'agua',       nome: 'nascente, lagoa, cascata', cor: '#2A5A79' },
  { g: 'outro',      nome: 'comer, WC, estacionamento', cor: '#7A7268' },
];
// Fontes de ortofoto para drapear no chao (azulejos Web Mercator z/x/y).
//   esri: Esri World Imagery (Maxar) -- global, CORS aberto, ate z19; uso nao
//         comercial com atribuicao. Em Portugal anda nos 0,3-0,5 m.
//   dgt:  ortofoto oficial DGT 25 cm por WMS -- melhor, mas so serve se o WMS
//         responder com CORS ao navegador (a confirmar).
const FOTO_FONTES = {
  esri: { nome: 'Esri World Imagery', atrib: 'Esri, Maxar, Earthstar Geographics', zmax: 19,
          url: (z, x, y) => 'https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/' + z + '/' + y + '/' + x },
};
// Azulejos de foto ja descarregados, partilhados entre zonas: ao trocar de
// zona o contexto WebGL e outro e as texturas morrem, mas as imagens nao
// precisam de voltar a vir da rede (nem da cache do service worker) --
// recompoem-se daqui. Ate 900 azulejos (~30 MB).
const AZULEJOS = new Map();
function azulejo(url) {
  let p = AZULEJOS.get(url);
  if (p) { AZULEJOS.delete(url); AZULEJOS.set(url, p); return p; }   // LRU: vai para o fim
  p = new Promise((ok) => {
    const im = new Image(); im.crossOrigin = 'anonymous';
    let feito = false; const fim = (v) => { if (!feito) { feito = true; ok(v); } };
    im.onload = () => fim(im); im.onerror = () => fim(null);
    setTimeout(() => { if (!feito) { im.src = ''; fim(null); } }, 12000);
    im.src = url;
  });
  AZULEJOS.set(url, p);
  if (AZULEJOS.size > 900) AZULEJOS.delete(AZULEJOS.keys().next().value);
  return p;
}
const COR_EIXO = [0.96, 0.94, 0.86];   // a risca do meio das estradas
// Corta linhas [lon,lat,...] em tracos de `cheio` m com `vazio` m entre eles,
// para a fita do eixo sair tracejada. Devolve linhas de dois pontos.
function tracos(T, linhas, cheio, vazio) {
  const out = [];
  for (const L of linhas) {
    const n = L.length / 2;
    let acum = 0;                      // distancia percorrida na linha
    for (let i = 0; i + 1 < n; i++) {
      const a = T.emM(L[i * 2], L[i * 2 + 1]), b = T.emM(L[i * 2 + 2], L[i * 2 + 3]);
      const dx = b[0] - a[0], dy = b[1] - a[1], len = Math.hypot(dx, dy);
      if (len < 0.01) continue;
      const per = cheio + vazio;
      // primeiro traco que comeca dentro deste segmento
      let s = Math.ceil(acum / per) * per - acum;
      // um traco que vinha do segmento anterior e ainda esta a meio
      const fase = acum % per;
      if (fase < cheio && fase > 0) {
        const fim = Math.min(len, cheio - fase);
        out.push(pontoLL(T, a, dx, dy, len, 0, fim));
      }
      for (; s < len; s += per) {
        const fim = Math.min(len, s + cheio);
        out.push(pontoLL(T, a, dx, dy, len, s, fim));
      }
      acum += len;
    }
  }
  return out;
}
function pontoLL(T, a, dx, dy, len, s0, s1) {
  const p = T.emLL(a[0] + dx * s0 / len, a[1] + dy * s0 / len);
  const q = T.emLL(a[0] + dx * s1 / len, a[1] + dy * s1 / len);
  return new Float32Array([p[0], p[1], q[0], q[1]]);
}
// Piso do OSM (2.o valor de caminhosTipo): quando se sabe, manda na cor.
// 1 alcatrao, 2 calcada, 3 terra; 0 = sem informacao -> cor do tipo.
const PISOS = [
  null,
  { n: 'alcatrão',        cor: [0.24, 0.24, 0.26] },
  { n: 'calçada',         cor: [0.66, 0.62, 0.55] },
  { n: 'terra, gravilha', cor: [0.62, 0.47, 0.30] },
];
const BLOCO = 1000;        // m: so para nao desenhar o que esta atras
const D0 = 250;            // m: dentro disto vai tudo o que a carta diz

// ------------------------------------------------------------------ ficheiro
// O ficheiro e por BLOCOS de quatro letras. Ler assim quer dizer que um
// ficheiro velho continua a abrir quando se acrescenta coisa nova, e que um
// ficheiro novo nao parte um visualizador velho: o que ele nao conhecer, salta.
async function carregaTerreno(url) {
  const r = await fetch(url);
  if (!r.ok) throw new Error('nao abriu ' + url + ': ' + r.status);
  let buf = await r.arrayBuffer();
  // Ha servidores que desencolhem o .gz sozinhos e outros que o entregam tal
  // e qual: em vez de adivinhar pelo nome, olha-se para os dois primeiros bytes.
  const b0 = new Uint8Array(buf, 0, 2);
  if (b0[0] === 0x1f && b0[1] === 0x8b) {
    if (typeof DecompressionStream === 'undefined')
      throw new Error('veio comprimido e este navegador nao o sabe abrir');
    buf = await new Response(new Blob([buf]).stream()
      .pipeThrough(new DecompressionStream('gzip'))).arrayBuffer();
  }
  const d = new DataView(buf);
  const tag = (o) => String.fromCharCode(d.getUint8(o), d.getUint8(o+1), d.getUint8(o+2), d.getUint8(o+3));
  if (tag(0) !== 'TERR') throw new Error('nao e um ficheiro TERR (veio ' + tag(0) + ')');
  const versao = d.getUint16(4, true);
  if (versao < 2) throw new Error('este ficheiro e do formato antigo (versao '
    + versao + '). Quase de certeza veio da cache do telemovel: limpa os dados '
    + 'do sitio, ou espera que o service worker novo tome conta.');
  const B = {};
  let o = 8;
  while (o + 8 <= buf.byteLength) {
    const t = tag(o), n = d.getUint32(o + 4, true);
    B[t] = { o: o + 8, n };
    o += 8 + n;
  }
  const T = { versao, blocos: Object.keys(B) };

  const bb = B.BBOX.o;
  T.lo0 = d.getFloat64(bb, true); T.la0 = d.getFloat64(bb + 8, true);
  T.lo1 = d.getFloat64(bb + 16, true); T.la1 = d.getFloat64(bb + 24, true);

  let p = B.COTA.o;
  T.nx = d.getUint16(p, true); T.ny = d.getUint16(p + 2, true);
  T.passo = d.getFloat32(p + 4, true);
  T.z0 = d.getFloat32(p + 8, true); T.z1 = d.getFloat32(p + 12, true);
  T.cotas = new Uint16Array(buf.slice(p + 16, p + 16 + T.nx * T.ny * 2));

  p = B.CLAS.o;
  T.mx = d.getUint16(p, true); T.my = d.getUint16(p + 2, true);
  T.passoC = d.getFloat32(p + 4, true);
  T.classe = new Uint8Array(buf.slice(p + 8, p + 8 + T.mx * T.my));

  const leLinhas = (bl, comExtra) => {
    if (!bl) return { linhas: [], extra: null };
    let q = bl.o;
    const n = d.getUint32(q, true); q += 4;
    const comp = new Uint32Array(buf.slice(q, q + n * 4)); q += n * 4;
    let extra = null;
    if (comExtra) { extra = new Int16Array(buf.slice(q, q + n * 4)); q += n * 4; }
    let tot = 0; for (let i = 0; i < n; i++) tot += comp[i];
    const pts = new Float32Array(buf.slice(q, q + tot * 8));
    const linhas = []; let k = 0;
    for (let i = 0; i < n; i++) {
      const c = comp[i], l = new Float32Array(c * 2);
      for (let j = 0; j < c * 2; j++) l[j] = pts[k++];
      linhas.push(l);
    }
    return { linhas, extra };
  };
  T.rotas = leLinhas(B.ROTA, false).linhas;
  const cm = leLinhas(B.CAMS, true);
  T.caminhos = cm.linhas; T.caminhosTipo = cm.extra;   // [tipo, 0] por linha
  const cv = leLinhas(B.CURV, true);
  T.curvas = cv.linhas; T.curvasAlt = cv.extra;    // [alt, mestra] por linha
  const ar = B.ARDI ? leLinhas(B.ARDI, true) : { linhas: [], extra: [] };
  T.ardidas = ar.linhas; T.ardidasAno = ar.extra;  // [ano, 0] por contorno

  T.pontos = [];
  if (B.PONT) {
    let q = B.PONT.o;
    const n = d.getUint32(q, true); q += 4;
    const td = new TextDecoder('utf-8');
    for (let i = 0; i < n; i++) {
      const lo = d.getFloat32(q, true), la = d.getFloat32(q + 4, true);
      const alt = d.getUint16(q + 8, true), lk = d.getUint8(q + 10), ln = d.getUint8(q + 11);
      q += 12;
      const k = td.decode(new Uint8Array(buf, q, lk)); q += lk;
      const nome = td.decode(new Uint8Array(buf, q, ln)); q += ln;
      T.pontos.push({ k, nome, lo, la, alt });
    }
  }

  // Altura da vegetacao medida por LiDAR, quando existe. Sem ela, cada classe
  // usa a sua altura por defeito e a legenda tem de dizer "modelado".
  // Casas: contorno real do OSM, altura MODELADA (ver o cozedor). Vem ja
  // triangulado de la -- paredes e telhado -- porque triangular poligonos
  // em L no telemovel era trabalho por fotograma, que e o que este motor
  // nao faz.
  T.casas = null; T.nCasas = 0;
  if (B.CASA) {
    const q = B.CASA.o;
    T.nCasas = d.getUint32(q, true);
    T.casaZ0 = d.getFloat32(q + 4, true); T.casaZ1 = d.getFloat32(q + 8, true);
    T.casas = new Uint16Array(buf.slice(q + 12, q + 12 + T.nCasas * 6));
  }

  T.altv = null;
  if (B.ALTV) {
    const q = B.ALTV.o;
    const ax = d.getUint16(q, true), ay = d.getUint16(q + 2, true);
    T.altv = new Uint8Array(buf.slice(q + 4, q + 4 + ax * ay));
  }
  // Rugosidade do chao (RMS do residuo do MDT a 2 m, em cm, por celula de
  // classe): e o que diz onde ha campo de blocos. O CHM nao ve pedras.
  T.rugo = null;
  if (B.RUGO) {
    const q = B.RUGO.o;
    const rx = d.getUint16(q, true), ry = d.getUint16(q + 2, true);
    T.rugo = new Uint8Array(buf.slice(q + 4, q + 4 + rx * ry));
  }
  // Penedos com posicao medida: pegadas da Microsoft que o cozedor recusou
  // como casas (pequenas, altas, fora de urbano/agricola). [lo, la, m2]
  T.penedos = [];
  if (B.PENE) {
    let q = B.PENE.o;
    const n = d.getUint32(q, true); q += 4;
    for (let i = 0; i < n; i++, q += 12)
      T.penedos.push({ lo: d.getFloat32(q, true), la: d.getFloat32(q + 4, true), m2: d.getFloat32(q + 8, true) });
  }

  // Mapa de horizonte: por cada no e cada direccao, a que altura o terreno
  // tapa o ceu. E com isto que a sombra e sombra e nao sombreado.
  T.hori = null;
  if (B.HORI) {
    const q = B.HORI.o;
    const hx = d.getUint16(q, true), hy = d.getUint16(q + 2, true), nd = d.getUint16(q + 4, true);
    T.hori = { nx: hx, ny: hy, ndir: nd,
               dados: new Uint8Array(buf.slice(q + 6, q + 6 + hx * hy * nd)) };
  }

  T.mlat = 110540; T.mlon = 111320 * Math.cos((T.la0 + T.la1) / 2 * Math.PI / 180);
  T.larg = (T.lo1 - T.lo0) * T.mlon;
  T.alt = (T.la1 - T.la0) * T.mlat;
  T.cota = (i, j) => T.z0 + T.cotas[j * T.nx + i] / 65535 * (T.z1 - T.z0);
  T.cotaEm = (x, y) => {
    const fx = Math.min(T.nx - 1.001, Math.max(0, x / T.larg * (T.nx - 1)));
    const fy = Math.min(T.ny - 1.001, Math.max(0, (T.alt - y) / T.alt * (T.ny - 1)));
    const i = fx | 0, j = fy | 0, u = fx - i, v = fy - j;
    const a = T.cota(i, j), b = T.cota(i + 1, j), c = T.cota(i, j + 1), e = T.cota(i + 1, j + 1);
    return (a * (1 - u) + b * u) * (1 - v) + (c * (1 - u) + e * u) * v;
  };
  T.emM = (lo, la) => [(lo - T.lo0) * T.mlon, (la - T.la0) * T.mlat];
  T.emLL = (x, y) => [T.lo0 + x / T.mlon, T.la0 + y / T.mlat];
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
  // Onde ha altura medida, e ela que manda -- inclusive para dizer que nao ha
  // nada. Antes o motor so olhava para o ALTV acima de 0,8 m e abaixo disso
  // caia no valor por defeito da classe: 44% das celulas de "matos" (26,5 km2)
  // levavam arbustos de 1,4 m onde o laser mede ZERO. Nao e uma regra nova
  // nem uma inferencia; e parar de escrever por cima da medicao.
  //
  // So vale para o que e VEGETAL (tipo 0 arvore, tipo 1 arbusto). O CHM mede
  // COPA: sobre um penedo da zero porque a pedra e chao, e apagar as pedras da
  // classe rocha (tipo 2) por causa disso seria o erro simetrico.
  const MED_MIN = 3;                   // 0,3 m em decimetros
  const vegetal = (cod) => { const E = CLASSES[cod]; return E && (E.tipo === 0 || E.tipo === 1); };
  const pedra = (cod) => { const E = CLASSES[cod]; return E && E.tipo === 2; };
  const medido = (i, j) => (T.altv ? T.altv[j * mx + i] : -1);
  // Blocos: onde ha rugosidade medida, e ela que manda -- nada abaixo de 8 cm
  // (chao liso, erva sobre laje), densidade a crescer com ela (0,35 m de RMS
  // = a densidade da classe; ate 3x), e a altura do bloco proporcional
  // (0,5 a 3,5 m). Sem medicao fica a densidade uniforme da classe, como antes.
  const RUG_MIN = 8, RUG_REF = 35;
  const rugo = (i, j) => (T.rugo ? T.rugo[j * mx + i] : -1);
  const quantos = (i, j, cod) => {
    let m = porCelula[cod];
    if (!m) return 0;
    if (vegetal(cod)) { const q = medido(i, j); if (q >= 0 && q < MED_MIN) return 0; }
    if (pedra(cod)) { const r = rugo(i, j); if (r >= 0) { if (r < RUG_MIN) return 0; m *= Math.min(3, r / RUG_REF); } }
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
  // os penedos medidos, um por pegada
  const pen = (T.penedos || []).map((p) => { const m = T.emM(p.lo, p.la); return { x: m[0], y: m[1], m2: p.m2 }; })
    .filter((p) => p.x >= 0 && p.x <= T.larg && p.y >= 0 && p.y <= T.alt);
  for (const p of pen) conta[bloco(p.x, p.y)]++;
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
      // A altura medida manda em tudo o que e vegetal. A da classe so entra
      // onde nao ha medicao nenhuma -- zonas cozidas sem LiDAR.
      const q = vegetal(cod) ? medido(i, j) : -1;
      let hBase = q >= MED_MIN ? q / 10 : E.h;
      if (pedra(cod)) { const r = rugo(i, j); if (r >= RUG_MIN) hBase = Math.max(0.5, Math.min(3.5, 3.0 * r / 100)); }
      for (let k = 0; k < n; k++) {
        const x = (i + baralha(i, j, 20 + k)) * larguraCel;
        const y = T.alt - (j + baralha(i, j, 40 + k)) * alturaCel;
        const b = bloco(x, y), o = cursor[b]++ * 12, o2 = o >> 1;
        const alt = hBase * (0.72 + 0.56 * baralha(i, j, 60 + k));
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
  // penedos: bola de granito com o raio da pegada, altura 1,2 x raio, posto 0
  // (e o que se ve sempre: sao os blocos grandes que dao nome ao sitio)
  pen.forEach((p, k) => {
    const b = bloco(p.x, p.y), o = cursor[b]++ * 12, o2 = o >> 1;
    const raio = Math.max(0.8, Math.sqrt(p.m2 / Math.PI)), alt = Math.min(25, raio * 1.2);
    U16[o2] = Math.min(65535, p.x * kx); U16[o2 + 1] = Math.min(65535, p.y * ky);
    U16[o2 + 2] = Math.max(0, Math.min(65535, (cotaEm(p.x, p.y) - T.z0) * kz));
    U8[o + 6] = Math.min(255, Math.round(alt * 10)); U8[o + 7] = Math.min(255, Math.round(raio * 20));
    U8[o + 8] = 2 | 4; U8[o + 9] = Math.round(baralha(k, 7, 1) * 255); U8[o + 10] = Math.round(baralha(k, 7, 2) * 255); U8[o + 11] = 0;
  });
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
// ARMADILHA 11: um const de topo NAO esta no window. A pagina precisa destas
// tabelas para desenhar a legenda, por isso pendura-se aqui explicitamente.
if (typeof window !== 'undefined') window.LEGENDA = { CLASSES, NOME_CLASSE, CAMINHOS, NOME_CAMINHO, PONTOS_LEGENDA, PISOS, FOTO_FONTES, ARDIDAS_LEGENDA };

// ===========================================================================
// O desenho. WebGL2 directo, sem biblioteca de mapa por baixo.
// ===========================================================================
const VS_CHAO = `#version 300 es
in vec3 aP; in vec3 aN;
uniform mat4 uMVP; uniform vec3 uCam; uniform vec2 uTam;
out vec3 vN; out vec2 vUV; out float vD; out vec2 vXY;
void main() {
  vN = aN; vUV = vec2(aP.x / uTam.x, 1.0 - aP.y / uTam.y); vXY = aP.xy;
  vD = length(aP - uCam);
  gl_Position = uMVP * vec4(aP, 1.0);
}`;
// A sombra sai do mapa de horizonte: para o azimute do sol le-se a que altura
// o terreno tapa o ceu naquele ponto, e compara-se com a altura do sol. Se o
// sol vier mais baixo, aquele sitio esta a sombra de um monte -- que e a
// pergunta a que esta aplicacao inteira existe para responder.
const GLSL_SOMBRA = `
  uniform sampler2DArray uHori;   // ndir camadas, graus/2 num byte
  uniform vec3 uSol;              // direccao do sol (x leste, y norte, z cima)
  uniform float uSolAlt;          // altura do sol em graus
  uniform float uSolAz;           // azimute em voltas (0 = norte, 0.25 = leste)
  uniform float uNdir;
  uniform float uTemHori;
  float aoSol(vec2 uv) {
    if (uTemHori < 0.5 || uSolAlt <= 0.0) return uSolAlt <= 0.0 ? 0.0 : 1.0;
    float f = uSolAz * uNdir;
    float l0 = floor(f), t = f - l0;
    float a0 = texture(uHori, vec3(uv, mod(l0, uNdir))).r * 255.0 * 0.5;
    float a1 = texture(uHori, vec3(uv, mod(l0 + 1.0, uNdir))).r * 255.0 * 0.5;
    float h = mix(a0, a1, t);
    return smoothstep(h - 0.8, h + 0.8, uSolAlt);
  }`;

const FS_CHAO = `#version 300 es
precision highp float;
precision highp sampler2DArray;
in vec3 vN; in vec2 vUV; in float vD; in vec2 vXY;
uniform sampler2D uClasse; uniform vec3 uFundo; uniform float uNevoa; uniform vec2 uTexel;
uniform sampler2D uFoto; uniform float uTemFoto; uniform vec4 uFotoCaixa;   // x0,y0,x1,y1 do bloco, m
` + GLSL_SOMBRA + `
out vec4 oCor;
void main() {
  vec3 n = normalize(vN);
  float lam = max(0.0, dot(n, uSol));
  float ceu = 0.5 + 0.5 * n.z;
  float sol = aoSol(vUV);
  if (uTemFoto > 0.5) {
    // ortofoto drapeado no bloco: a foto ja traz a sua luz; poe-se so um pouco
    // de relevo e a sombra do monte a hora escolhida, para nao mentir sobre o sol
    vec2 fuv = vec2((vXY.x - uFotoCaixa.x) / (uFotoCaixa.z - uFotoCaixa.x),
                    (uFotoCaixa.w - vXY.y) / (uFotoCaixa.w - uFotoCaixa.y));
    vec3 f = texture(uFoto, fuv).rgb;
    vec3 cf = f * (0.62 + 0.30 * (0.5 * lam * sol + 0.5 * ceu) + 0.12 * sol);
    oCor = vec4(mix(cf, uFundo, clamp(vD / uNevoa, 0.0, 1.0) * 0.85), 1.0);
    return;
  }
  // A carta e de celulas de 5 m e ve-se em escada quando se esta perto. Quatro
  // amostras a 3/4 de celula em diagonal alargam a transicao a ~2 celulas sem
  // mudar a carta nem o ficheiro. (20/09/2026, "o pixel pode ser mais detalhado?")
  vec2 o = uTexel * 0.75;
  vec3 base = 0.25 * (texture(uClasse, vUV + vec2( o.x,  o.y)).rgb + texture(uClasse, vUV + vec2(-o.x,  o.y)).rgb
                    + texture(uClasse, vUV + vec2( o.x, -o.y)).rgb + texture(uClasse, vUV + vec2(-o.x, -o.y)).rgb);
  // A luz do sol so entra se o monte a deixar passar; a do ceu entra sempre.
  // Sao de cores diferentes -- o sol puxa ao amarelo, o ceu ao azul -- e e
  // isso que faz a sombra ler-se como sombra e nao como um cinzento morto.
  vec3 c = base * (vec3(1.02, 0.97, 0.87) * (0.64 * lam * sol)
                 + vec3(0.78, 0.85, 1.00) * (0.34 + 0.24 * ceu));
  oCor = vec4(mix(c, uFundo, clamp(vD / uNevoa, 0.0, 1.0) * 0.85), 1.0);
}`;

const VS_PLANTA = `#version 300 es
precision highp float;
precision highp sampler2DArray;
in vec4 aV;        // ux, uy, t, parte(0 copa 1 tronco)
in float aBossa;
in vec3 aPos;      // x, y, z normalizados na caixa
in vec4 aPar;      // altura*10, raio*20, tipo|forma, tom
in vec2 aRot;      // rodar, posto
uniform mat4 uMVP; uniform vec3 uCam;
uniform vec3 uCaixa;       // largura, altura, (z1-z0) em metros
uniform float uZ0;
` + GLSL_SOMBRA + `
uniform float uD0;         // raio de densidade cheia
uniform vec2 uTam;         // largura, altura da caixa, para ler o horizonte
out vec3 vCor; out float vLuz; out float vD; out float vFrio;
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

  float lam = max(0.0, dot(normalize(nrm), uSol));
  float ceu = 0.5 + 0.5 * normalize(nrm).z;
  float sol = aoSol(vec2(p0.x / uTam.x, 1.0 - p0.y / uTam.y));
  vLuz = 0.34 + 0.56 * lam * sol + 0.24 * ceu;
  vFrio = 1.0 - 0.55 * lam * sol;
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
in vec3 vCor; in float vLuz; in float vD; in float vFrio;
uniform vec3 uFundo; uniform float uNevoa;
out vec4 oCor;
void main() {
  vec3 c = vCor * vLuz * mix(vec3(1.02, 0.97, 0.87), vec3(0.80, 0.86, 1.00), vFrio);
  oCor = vec4(mix(c, uFundo, clamp(vD / uNevoa, 0.0, 1.0) * 0.85), 1.0);
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
  return new Float32Array(fitaLinhas(T, suaviza(T, T.rotas), largura || 2.5, acima || 1.2));
}

// Cantos arredondados, sem inventar tracado. Os vertices do OSM estao a
// 18 m (mediana) e viram 17 graus (mediana); nos caminhos e ribeiras chegam a
// 50 m e a fita de rectas le-se como poligono. A primeira versao passava uma
// Catmull-Rom pelo troco todo com desvio preso a 1,5 m -- nas estradas, com
// vertices densos, ficou curva; nos caminhos o limite quase nao dobrava o
// cotovelo. Isto e outra coisa: as RECTAS ficam exactamente onde o OSM as
// pos, e cada canto e substituido por um arco tangente as duas rectas. O raio
// escolhe-se canto a canto para o arco nunca se afastar do vertice original
// mais do que `desvioMax` m (2 m, abaixo da tolerancia do proprio OSM), nem
// comer mais de 45% de cada troco vizinho. Um canto de 90 graus fica com
// raio 4,8 m; um de 30 graus, com 12 m (o tecto).
// Os azulejos partem cada via nas suas bordas; os pedacos encostam ponta com
// ponta mas sao linhas separadas -- o canto entre eles nunca era arredondado
// e cada ponta levava a sua tampa. Isto cose de novo pontas que coincidem
// (a menos de 0,3 m) e onde SO se encontram duas linhas: num cruzamento a
// serio (3 ou mais) nao se junta nada, que isso seria escolher um caminho.
function juntaLinhas(T, linhas) {
  const chave = (lo, la) => Math.round(lo * 3e5) + ',' + Math.round(la * 3e5);   // ~0,3 m
  const pontas = new Map();
  const L = linhas.map((l) => Array.from(l));
  const usada = new Array(L.length).fill(false);
  const add = (k, i, fim) => { if (!pontas.has(k)) pontas.set(k, []); pontas.get(k).push([i, fim]); };
  L.forEach((l, i) => { if (l.length >= 4) { add(chave(l[0], l[1]), i, 0); add(chave(l[l.length - 2], l[l.length - 1]), i, 1); } });
  const grau2 = (k) => pontas.has(k) && pontas.get(k).length === 2;
  const out = [];
  for (let i = 0; i < L.length; i++) {
    if (usada[i] || L[i].length < 4) { if (!usada[i]) { out.push(linhas[i]); usada[i] = true; } continue; }
    let cur = L[i].slice(); usada[i] = true;
    for (const lado of [1, 0]) {                       // primeiro para a frente, depois para tras
      for (let passos = 0; passos < 5000; passos++) {
        const k = lado ? chave(cur[cur.length - 2], cur[cur.length - 1]) : chave(cur[0], cur[1]);
        if (!grau2(k)) break;
        const outra = pontas.get(k).find(([j]) => !usada[j]);
        if (!outra) break;
        const [j, fim] = outra; let seg = L[j].slice(); usada[j] = true;
        // orientar o pedaco para continuar cur
        if (lado) { if (fim === 1) seg = inverte(seg); cur = cur.concat(seg.slice(2)); }
        else { if (fim === 0) seg = inverte(seg); cur = seg.slice(0, -2).concat(cur); }
      }
    }
    out.push(new Float32Array(cur));
  }
  return out;
}
function inverte(l) { const r = []; for (let i = l.length - 2; i >= 0; i -= 2) r.push(l[i], l[i + 1]); return r; }

function suaviza(T, linhas, desvioMax, raioMax) {
  desvioMax = desvioMax || 2.0; raioMax = raioMax || 12;
  linhas = juntaLinhas(T, linhas || []);
  const out = [];
  for (const L of linhas) {
    const n = L.length / 2;
    if (n < 3) { out.push(L); continue; }
    const P = new Array(n);
    for (let i = 0; i < n; i++) P[i] = T.emM(L[i * 2], L[i * 2 + 1]);
    const R = [P[0][0], P[0][1]];
    for (let i = 1; i + 1 < n; i++) {
      const a = P[i - 1], v = P[i], b = P[i + 1];
      const ux = v[0] - a[0], uy = v[1] - a[1], la = Math.hypot(ux, uy);
      const wx = b[0] - v[0], wy = b[1] - v[1], lb = Math.hypot(wx, wy);
      if (la < 0.05 || lb < 0.05) { R.push(v[0], v[1]); continue; }
      const cosT = (ux * wx + uy * wy) / (la * lb);
      const teta = Math.acos(Math.max(-1, Math.min(1, cosT)));   // angulo de viragem
      if (teta < 0.03 || teta > 2.8) { R.push(v[0], v[1]); continue; }  // recto ou inversao
      const sec = 1 / Math.cos(teta / 2);
      let r = Math.min(raioMax, desvioMax / (sec - 1));
      let d = r * Math.tan(teta / 2);                              // recuo tangente
      const dmax = 0.45 * Math.min(la, lb);
      if (d > dmax) { d = dmax; r = d / Math.tan(teta / 2); }
      if (r < 0.5) { R.push(v[0], v[1]); continue; }
      // pontos de tangencia
      const t1 = [v[0] - ux / la * d, v[1] - uy / la * d];
      const t2 = [v[0] + wx / lb * d, v[1] + wy / lb * d];
      // centro do arco: a r do vertice ao longo da bissectriz interior
      const bx = (-ux / la + wx / lb), by = (-uy / la + wy / lb), lbis = Math.hypot(bx, by) || 1;
      const c = [v[0] + bx / lbis * r * sec, v[1] + by / lbis * r * sec];
      const a1 = Math.atan2(t1[1] - c[1], t1[0] - c[0]);
      let a2 = Math.atan2(t2[1] - c[1], t2[0] - c[0]);
      let da = a2 - a1;
      while (da > Math.PI) da -= 2 * Math.PI;
      while (da < -Math.PI) da += 2 * Math.PI;
      const k = Math.max(2, Math.min(10, Math.ceil(Math.abs(da) * r / 2)));   // ~2 m por passo
      for (let s = 0; s <= k; s++) {
        const ang = a1 + da * s / k;
        R.push(c[0] + Math.cos(ang) * r, c[1] + Math.sin(ang) * r);
      }
    }
    R.push(P[n - 1][0], P[n - 1][1]);
    const F = new Float32Array(R.length);
    for (let i = 0; i < R.length; i += 2) { const ll = T.emLL(R[i], R[i + 1]); F[i] = ll[0]; F[i + 1] = ll[1]; }
    out.push(F);
  }
  return out;
}

// Setas de sentido ao longo de um trilho: um triangulo a cada `passo` m,
// apontado no sentido em que os pontos vem (num GPX e o sentido em que se
// andou; num percurso, o da ficha). Assentam um pouco acima da fita.
function setasLinhas(T, linhas, largura, acima, passo) {
  passo = passo || 120;
  const V = [], L2 = largura * 1.1, W2 = largura * 0.9;
  for (const l of suaviza(T, linhas || [])) {
    const n = l.length / 2;
    let prox = passo * 0.5;
    for (let i = 0; i + 1 < n; i++) {
      const a = T.emM(l[i * 2], l[i * 2 + 1]), b = T.emM(l[i * 2 + 2], l[i * 2 + 3]);
      const dx = b[0] - a[0], dy = b[1] - a[1], len = Math.hypot(dx, dy);
      if (len < 0.01) continue;
      while (prox <= len) {
        const cx = a[0] + dx * prox / len, cy = a[1] + dy * prox / len;
        const ux = dx / len, uy = dy / len;                    // sentido
        const z = T.cotaEm(cx, cy) + acima;
        // ponta a frente, base atras com duas abas
        V.push(cx + ux * L2, cy + uy * L2, z,
               cx - ux * L2 * 0.4 - uy * W2, cy - uy * L2 * 0.4 + ux * W2, z,
               cx - ux * L2 * 0.4 + uy * W2, cy - uy * L2 * 0.4 - ux * W2, z);
        prox += passo;
      }
      prox -= len;
    }
  }
  return V;
}

function fitaLinhas(T, linhas, largura, acima) {
  // Uma fita continua, nao um rectangulo por troco.
  //
  // A versao anterior desenhava cada troco com a SUA perpendicular. Numa curva
  // as duas perpendiculares sao diferentes, os rectangulos nao encostam, e fica
  // um entalhe triangular por fora de cada cotovelo e uma sobreposicao por
  // dentro. De perto le-se como uma tira de poligonos soltos, que foi o que ele
  // viu.
  //
  // A costura e a classica: em cada NO, em vez da perpendicular de um dos
  // trocos, usa-se a BISSECTRIZ dos dois, esticada por 1/cos(metade do angulo)
  // -- e o esticao exacto para que as duas bordas se encontrem no mesmo ponto.
  // Em curvas muito fechadas esse factor dispara, por isso leva tecto: prefere-
  // se um bisel pequeno a uma bicuda de dezenas de metros.
  const cotaEm = (x, y) => T.cotaEm(x, y);
  const emM = (lo, la) => [(lo - T.lo0) * T.mlon, (la - T.la0) * T.mlat];
  const V = [];
  const h = largura / 2, MITRA = 3.0;
  for (const l of (linhas || [])) {
    if (l.length < 4) continue;
    // Partir em tracos continuos. Um salto de azulejo corta a fita em vez de
    // ser saltado no meio dela -- senao costurava-se por cima do buraco.
    const tracos = []; let cur = [];
    for (let i = 0; i < l.length / 2; i++) {
      const p = emM(l[i * 2], l[i * 2 + 1]);
      if (cur.length) {
        const q = cur[cur.length - 1];
        const L = Math.hypot(p[0] - q[0], p[1] - q[1]);
        if (L < 0.5) continue;
        if (L > 400) { if (cur.length > 1) tracos.push(cur); cur = []; }
      }
      cur.push(p);
    }
    if (cur.length > 1) tracos.push(cur);

    for (const P of tracos) {
      const m = P.length, D = new Array(m - 1);
      for (let i = 0; i + 1 < m; i++) {
        const dx = P[i + 1][0] - P[i][0], dy = P[i + 1][1] - P[i][1];
        const L = Math.hypot(dx, dy) || 1;
        D[i] = [dx / L, dy / L];
      }
      const O = new Array(m);
      for (let i = 0; i < m; i++) {
        const dp = D[i - 1] || D[i], dn = D[i] || D[i - 1];
        let nx = -(dp[1] + dn[1]), ny = dp[0] + dn[0];
        const L = Math.hypot(nx, ny);
        if (L < 1e-6) { O[i] = [-dn[1] * h, dn[0] * h]; continue; }  // inversao
        nx /= L; ny /= L;
        let k = nx * -dn[1] + ny * dn[0];                 // cos(metade do angulo)
        k = Math.abs(k) < 1e-3 ? MITRA : Math.min(MITRA, Math.abs(1 / k));
        O[i] = [nx * h * k, ny * h * k];
      }
      for (let i = 0; i + 1 < m; i++) {
        const a = P[i], b = P[i + 1], oa = O[i], ob = O[i + 1];
        const za = cotaEm(a[0], a[1]) + acima, zb = cotaEm(b[0], b[1]) + acima;
        const a0 = [a[0] - oa[0], a[1] - oa[1], za], a1 = [a[0] + oa[0], a[1] + oa[1], za];
        const b0 = [b[0] - ob[0], b[1] - ob[1], zb], b1 = [b[0] + ob[0], b[1] + ob[1], zb];
        for (const q of [a0, b0, a1, a1, b0, b1]) V.push(q[0], q[1], q[2]);
      }
      // Tampas redondas nas duas pontas. Uma via que acaba numa outra (T) ou
      // numa borda de azulejo acabava a direito, meio metro antes ou depois,
      // e via-se a fenda; o semicirculo de raio h fecha a juncao.
      if (h >= 0.6) {
        for (const [p, d] of [[P[0], [-D[0][0], -D[0][1]]], [P[m - 1], D[m - 2]]]) {
          const z = cotaEm(p[0], p[1]) + acima, n = h < 2 ? 5 : 8;
          const a0 = Math.atan2(d[1], d[0]) - Math.PI / 2;
          for (let s = 0; s < n; s++) {
            const t0 = a0 + Math.PI * s / n, t1 = a0 + Math.PI * (s + 1) / n;
            V.push(p[0], p[1], z,
                   p[0] + Math.cos(t0) * h, p[1] + Math.sin(t0) * h, z,
                   p[0] + Math.cos(t1) * h, p[1] + Math.sin(t1) * h, z);
          }
        }
      }
    }
  }
  return V;
}

// As fitas de todos os caminhos, agrupadas por genero: cada grupo e um
// intervalo do mesmo buffer, e desenha-se com a sua cor e uma chamada so.
function fitaCaminhos(T, acima) {
  if (!T.caminhos || !T.caminhos.length) return { pos: new Float32Array(0), grupos: [] };
  // grupos por (tipo, piso): a largura vem do tipo, a cor do piso se se souber
  const porTipo = CAMINHOS.map(() => []);
  const porTP = CAMINHOS.map(() => PISOS.map(() => []));
  const URBANA = CAMINHOS.findIndex((c) => c.n === 'urbana');
  const emUrbano = (l) => {                         // fraccao dos vertices em urbano (classe 1)
    if (!T.classe) return 0;
    let n = 0, u = 0;
    for (let k = 0; k < l.length; k += 2) {
      const m = T.emM(l[k], l[k + 1]);
      const i = Math.floor(m[0] / T.larg * T.mx), j = Math.floor((T.alt - m[1]) / T.alt * T.my);
      if (i < 0 || j < 0 || i >= T.mx || j >= T.my) continue;
      n++; if ((T.classe[j * T.mx + i] & 127) === 1) u++;
    }
    return n ? u / n : 0;
  };
  for (let i = 0; i < T.caminhos.length; i++) {
    const t0 = T.caminhosTipo ? T.caminhosTipo[i * 2] : 3;
    let t = porTipo[t0] ? t0 : 3;
    const p = T.caminhosTipo ? (T.caminhosTipo[i * 2 + 1] || 0) : 0;
    if (t === 3 && p === 0 && URBANA >= 0 && emUrbano(T.caminhos[i]) >= 0.5) t = URBANA;
    porTipo[t].push(T.caminhos[i]);
    porTP[t][PISOS[p] ? p : 0].push(T.caminhos[i]);
  }
  const V = [], grupos = [];
  const alt = acima == null ? 0.9 : acima;
  for (let t = 0; t < CAMINHOS.length; t++) {
    for (let p = 0; p < PISOS.length; p++) {
      if (!porTP[t][p].length) continue;
      const ini = V.length / 3;
      const f = fitaLinhas(T, suaviza(T, porTP[t][p]), CAMINHOS[t].larg, alt);
      for (let k = 0; k < f.length; k++) V.push(f[k]);
      grupos.push({ tipo: t, piso: p, ini, n: V.length / 3 - ini });
    }
  }
  // o eixo das estradas: tracejado (4 m pintado, 6 m sem), 0,5 m de largo,
  // um nadinha acima da fita larga
  for (let t = 0; t < CAMINHOS.length; t++) {
    if (!CAMINHOS[t].eixo) continue;
    const ini = V.length / 3;
    // 0,45 m acima e nao 0,08: a fita da estrada e plana entre as duas bordas,
    // e num lombo (terreno convexo de lado a lado) o asfalto passava por cima
    // da risca do eixo e ela desaparecia em trocos inteiros (21/09/2026)
    const f = fitaLinhas(T, tracos(T, suaviza(T, porTipo[t]), 4, 6), 0.5, alt + 0.45);
    for (let k = 0; k < f.length; k++) V.push(f[k]);
    grupos.push({ tipo: t, eixo: true, ini, n: V.length / 3 - ini });
  }
  return { pos: new Float32Array(V), grupos };
}

// CAMINHO SEMPRE A VISTA, MAS SO DO QUE ESTA A FRENTE DELE
//
// A maneira facil de por a cor do caminho por cima de tudo e desligar o teste
// de profundidade. So que ai o caminho tambem aparece ATRAVES dos montes, e um
// trilho que se ve do outro lado da serra nao e um mapa, e um raio-X.
//
// Entao desliga-se o teste (para as copas nao o taparem) e trata-se do relevo
// a mao: cada vertice da fita anda do olho ate si proprio a ver se o chao
// passa por cima da linha. Se passar, aquele bocado nao se desenha. Fica
// exactamente o que se quer -- por cima das arvores, por baixo dos montes.
// As casas: um prisma por edificio, cor por orientacao da face. A normal sai
// das derivadas do fragmento -- nao ha atributo de normal, e por isso o buffer
// e so posicao e cabe em 6 bytes por vertice.
const VS_CASA = `#version 300 es
precision highp float;
in vec3 aP;
uniform mat4 uMVP; uniform vec3 uCam;
out vec3 vP; out float vD;
void main() { vP = aP; vD = length(aP - uCam); gl_Position = uMVP * vec4(aP, 1.0); }`;

const FS_CASA = `#version 300 es
precision highp float;
in vec3 vP; in float vD;
uniform vec3 uSol; uniform vec3 uFundo; uniform float uNevoa;
out vec4 oCor;
void main() {
  vec3 n = normalize(cross(dFdx(vP), dFdy(vP)));
  if (n.z < 0.0) n = -n;
  float teto = smoothstep(0.55, 0.9, n.z);
  // Telha, e nao cinzento. Isto ja esteve cinzento durante uma versao porque
  // eu "medi" 400 telhados no nosso ortofoto e deu RGB 138/120/118. O que medi
  // foi a DESSATURACAO DO FICHEIRO -- aquele ortofoto tem saturacao media de
  // 0,057, esta praticamente a cinzento -- e nao a cor dos telhados. Uma
  // fotografia aerea de Manteigas mostra telha laranja em toda a vila, e o
  // proprio ortofoto confirma a DIRECCAO (o telhado e 12% mais vermelho que o
  // chao a volta); o que ele nao consegue dar e quanto.
  //
  // Fica escrito porque a licao e geral: um instrumento que nao resolve a
  // grandeza nao a mede -- devolve o seu proprio defeito com ar de numero.
  // 20/09/2026: ele pediu "blocos laranja". Nao e cor de telha nem de parede:
  // e um SINAL, para a casa nunca se confundir com copa nem com chao. Paredes
  // um pouco mais escuras que o tecto so para o volume se ler.
  // 20/09/2026: "blocos totalmente cor de tijolo" -- telhado e paredes tijolo,
  // as paredes um pouco mais escuras para o volume se ler
  vec3 cor = mix(vec3(0.54, 0.24, 0.16), vec3(0.66, 0.30, 0.20), teto);
  float lam = max(0.0, dot(n, uSol));
  cor *= 0.62 + 0.22 * (0.5 + 0.5 * n.z) + 0.30 * lam;
  // vD / uNevoa como nos outros programas. Estava vD * uNevoa: com uNevoa em
  // metros isso saturava logo, e as casas saiam sempre 72% cor de fundo --
  // era por isso que pareciam rosa palido a qualquer distancia.
  oCor = vec4(mix(cor, uFundo, clamp(vD / uNevoa, 0.0, 1.0) * 0.85), 1.0);
}`;

const VS_ROTA = `#version 300 es
precision highp float;
precision highp usampler2D;
in vec3 aP;
uniform mat4 uMVP; uniform vec3 uCam;
uniform usampler2D uCota;
uniform vec2 uGrelha;      // nos da grelha de cotas
uniform vec3 uCaixaT;      // largura, altura, (z1-z0)
uniform float uZ0T;
uniform float uPorCima;    // 1 = trata do relevo aqui; 0 = deixa ao z-buffer
out float vD; out float vTapado;
float cotaEm(vec2 p) {
  vec2 f = vec2(p.x / uCaixaT.x * (uGrelha.x - 1.0),
                (uCaixaT.y - p.y) / uCaixaT.y * (uGrelha.y - 1.0));
  ivec2 i = ivec2(clamp(f, vec2(0.0), uGrelha - vec2(1.0)));
  return uZ0T + float(texelFetch(uCota, i, 0).r) / 65535.0 * uCaixaT.z;
}
void main() {
  vD = length(aP - uCam);
  vTapado = 0.0;
  if (uPorCima > 0.5) {
    // as pontas nao contam: a propria encosta onde o caminho assenta tapava-o
    for (int k = 3; k <= 14; k++) {
      vec3 q = mix(uCam, aP, float(k) / 17.0);
      if (cotaEm(q.xy) > q.z + 14.0) { vTapado = 1.0; break; }
    }
  }
  gl_Position = uMVP * vec4(aP, 1.0);
}`;
const FS_ROTA = `#version 300 es
precision mediump float; in float vD; in float vTapado;
uniform vec3 uFundo; uniform float uNevoa; uniform vec3 uCor;
out vec4 oCor;
void main(){
  if (vTapado > 0.5) discard;          // ha monte pelo meio
  oCor = vec4(mix(uCor, uFundo, clamp(vD / uNevoa, 0.0, 1.0) * 0.85), 1.0);
}`;

if (typeof module !== 'undefined') Object.assign(module.exports,
  { fitaRotas, fitaCaminhos, fitaLinhas, CAMINHOS, VS_ROTA, FS_ROTA });

// ------------------------------------------------------- curvas de nivel
// As curvas ja vinham nos azulejos com a cota: nao ha nada a calcular, so a
// pousar no relevo. Desenham-se como linhas de 1 pixel, que e o que uma carta
// topografica faz -- engrossar so as faria competir com o percurso.
function linhasCurvas(T, acima) {
  acima = acima || 0.8;
  const V = [], M = [];
  for (let i = 0; i < T.curvas.length; i++) {
    const l = T.curvas[i], n = l.length / 2;
    const mestra = T.curvasAlt ? (T.curvasAlt[i * 2 + 1] ? 1 : 0) : 0;
    for (let k = 0; k + 1 < n; k++) {
      const a = T.emM(l[k * 2], l[k * 2 + 1]);
      const b = T.emM(l[(k + 1) * 2], l[(k + 1) * 2 + 1]);
      if (Math.hypot(b[0] - a[0], b[1] - a[1]) > 400) continue;   // salto de azulejo
      V.push(a[0], a[1], T.cotaEm(a[0], a[1]) + acima,
             b[0], b[1], T.cotaEm(b[0], b[1]) + acima);
      M.push(mestra, mestra);
    }
  }
  return { pos: new Float32Array(V), mestra: new Float32Array(M), n: M.length };
}

const VS_CURVA = `#version 300 es
in vec3 aP; in float aM;
uniform mat4 uMVP; uniform vec3 uCam;
out float vD; out float vM;
void main(){ vD = length(aP - uCam); vM = aM; gl_Position = uMVP * vec4(aP, 1.0); }`;
const FS_CURVA = `#version 300 es
precision mediump float; in float vD; in float vM;
uniform vec3 uFundo; uniform float uNevoa;
out vec4 oCor;
void main(){
  vec3 c = mix(vec3(0.70, 0.60, 0.45), vec3(0.56, 0.45, 0.27), vM);
  float a = mix(0.55, 0.9, vM) * (1.0 - clamp(vD / uNevoa, 0.0, 1.0));
  oCor = vec4(mix(c, uFundo, clamp(vD / uNevoa, 0.0, 1.0) * 0.85), a);
}`;

// ------------------------------------------------------------------- sol
// Posicao do sol (NOAA simplificado, o mesmo que o SunCalc usa). Devolve
// altura em graus acima do horizonte e azimute em graus a contar do norte.
function posicaoSol(data, lat, lon) {
  const R = Math.PI / 180;
  const dias = (data.getTime() - Date.UTC(2000, 0, 1, 12)) / 86400000;
  const M = R * (357.5291 + 0.98560028 * dias);
  const C = R * (1.9148 * Math.sin(M) + 0.02 * Math.sin(2 * M) + 0.0003 * Math.sin(3 * M));
  const L = M + C + R * 102.9372 + Math.PI;
  const e = R * 23.4397;
  const dec = Math.asin(Math.sin(e) * Math.sin(L));
  const ra = Math.atan2(Math.sin(L) * Math.cos(e), Math.cos(L));
  const H = R * (280.16 + 360.9856235 * dias) + R * lon - ra;
  const f = R * lat;
  const alt = Math.asin(Math.sin(f) * Math.sin(dec) + Math.cos(f) * Math.cos(dec) * Math.cos(H));
  const az = Math.atan2(Math.sin(H), Math.cos(H) * Math.sin(f) - Math.tan(dec) * Math.cos(f));
  return { alt: alt / R, az: ((az / R) + 180 + 360) % 360 };
}
// vector do sol no referencial do terreno: x leste, y norte, z cima
function vectorSol(alt, az) {
  const R = Math.PI / 180, ca = Math.cos(alt * R);
  return [Math.sin(az * R) * ca, Math.cos(az * R) * ca, Math.sin(alt * R)];
}

if (typeof module !== 'undefined') Object.assign(module.exports,
  { linhasCurvas, VS_CURVA, FS_CURVA, posicaoSol, vectorSol });

// ---------------------------------------------------- detalhe do chao
// A 25 m o chao sao 430 mil triangulos e nao custa nada. Com o MDT LiDAR a 8 m
// passam a 4,2 milhoes, sempre desenhados -- e ai custa. Entao o chao parte-se
// em BLOCOS e cada bloco desenha-se com o passo que a distancia pedir.
//
// O problema classico disto sao as FENDAS: dois blocos vizinhos com passos
// diferentes nao encaixam e ve-se o ceu pelo meio. A solucao aqui nao e
// esconder a fenda com saias: e nao a deixar acontecer. A ORLA de cada bloco
// e SEMPRE de passo 1, seja qual for o passo do miolo, por isso dois vizinhos
// partilham exactamente os mesmos vertices na fronteira. Entre a orla fina e o
// miolo grosso ha uma faixa de leques que costura os dois. Custa uma tira de
// triangulos finos por bloco -- cerca de 6% -- e em troca nunca ha fenda
// nenhuma, com qualquer combinacao de passos.
const PASSOS = [1, 2, 4, 8];

function malhaBlocos(T, BL) {
  BL = BL || 64;
  const { nx, ny } = T;
  const bx = Math.ceil((nx - 1) / BL), by = Math.ceil((ny - 1) / BL);
  const partes = [];                 // por bloco: {i0,j0,ci,cj, caixa, niveis:[{off,n}]}
  const todos = [];                  // indices, todos seguidos, num so buffer
  const V = (i, j) => j * nx + i;

  for (let bj = 0; bj < by; bj++) {
    for (let bi = 0; bi < bx; bi++) {
      const i0 = bi * BL, j0 = bj * BL;
      const ci = Math.min(BL, nx - 1 - i0), cj = Math.min(BL, ny - 1 - j0);
      if (ci < 1 || cj < 1) continue;
      const niveis = [];
      for (const s of PASSOS) {
        const ini = todos.length;
        if (s === 1 || ci <= 2 * s || cj <= 2 * s) {
          // pequeno de mais para ter miolo grosso: vai todo fino
          for (let j = 0; j < cj; j++) for (let i = 0; i < ci; i++) {
            const a = V(i0 + i, j0 + j), b = a + 1, c = a + nx, d = c + 1;
            todos.push(a, c, b, b, c, d);
          }
        } else {
          // miolo, de passo s
          for (let j = s; j + s <= cj - s; j += s) for (let i = s; i + s <= ci - s; i += s) {
            const a = V(i0 + i, j0 + j), b = V(i0 + i + s, j0 + j);
            const c = V(i0 + i, j0 + j + s), d = V(i0 + i + s, j0 + j + s);
            todos.push(a, c, b, b, c, d);
          }
          // as quatro faixas de costura: orla de passo 1, miolo de passo s
          const faixa = (fino, grosso, n, inverte) => {
            for (let c = 0; c + s <= n; c += s) {
              const g0 = grosso(c), g1 = grosso(c + s);
              for (let k = 0; k < s; k++) {
                const f0 = fino(c + k), f1 = fino(c + k + 1);
                if (inverte) todos.push(g0, f1, f0); else todos.push(g0, f0, f1);
              }
              if (inverte) todos.push(g0, g1, fino(c + s)); else todos.push(g0, fino(c + s), g1);
            }
          };
          // norte: linha j0 fina, linha j0+s grossa
          faixa((k) => V(i0 + k, j0), (k) => V(i0 + k, j0 + s), ci, true);
          // sul: linha j0+cj fina, linha j0+cj-s grossa
          faixa((k) => V(i0 + k, j0 + cj), (k) => V(i0 + k, j0 + cj - s), ci, false);
          // oeste: coluna i0 fina, coluna i0+s grossa (so entre s e cj-s)
          faixa((k) => V(i0, j0 + s + k), (k) => V(i0 + s, j0 + s + k), cj - 2 * s, false);
          // este: coluna i0+ci fina, coluna i0+ci-s grossa
          faixa((k) => V(i0 + ci, j0 + s + k), (k) => V(i0 + ci - s, j0 + s + k), cj - 2 * s, true);
        }
        niveis.push({ off: ini, n: todos.length - ini });
      }
      // caixa do bloco em metros, para medir distancia e cortar o que nao se ve
      const dx = T.larg / (nx - 1), dy = T.alt / (ny - 1);
      let z0 = 1e9, z1 = -1e9;
      for (let j = 0; j <= cj; j += 4) for (let i = 0; i <= ci; i += 4) {
        const z = T.cota(i0 + i, j0 + j);
        if (z < z0) z0 = z; if (z > z1) z1 = z;
      }
      partes.push({
        x0: i0 * dx, x1: (i0 + ci) * dx,
        y0: T.alt - (j0 + cj) * dy, y1: T.alt - j0 * dy,
        z0, z1, niveis,
      });
    }
  }
  return { idx: new Uint32Array(todos), partes, bx, by, BL };
}

// Que passo usar a esta distancia. O erro que um passo s deixa no ecra e
// proporcional a s/distancia: fixa-se um erro e resolve-se para s.
function passoDoBloco(d, passoMalha, metrosPorPixel) {
  const alvo = metrosPorPixel * 2.2;          // 2,2 pixeis de erro, na pratica invisivel
  for (let k = PASSOS.length - 1; k > 0; k--) {
    if (PASSOS[k] * passoMalha <= alvo * (d / 500)) return k;
  }
  return 0;
}

if (typeof module !== 'undefined') Object.assign(module.exports,
  { malhaBlocos, passoDoBloco, PASSOS });

// ===========================================================================
// A VISTA: pega num terreno cozido e num canvas, e desenha.
// ---------------------------------------------------------------------------
// Estava tudo na pagina de ensaio. Passa para aqui porque o mapa a serio vai
// usar exactamente o mesmo motor -- se houvesse duas copias, uma delas ficava
// para tras no dia seguinte.
// ===========================================================================
function abreVista(canvas, T, op) {
  op = op || {};
  const gl = canvas.getContext('webgl2', { antialias: op.antialias !== false, alpha: false });
  if (!gl) throw new Error('este aparelho nao tem WebGL2');
  const FUNDO = op.fundo || [0.871, 0.851, 0.784];
  const P = {}, L = {}, A = {};
  const VERT_MODELO = 108;
  let M, BLO, S, texClasse, texHori, texCota, bufInst, aInst, C = [], vivo = true;
  const cam = { x: T.larg / 2, y: T.alt / 2, dist: op.dist || 2400,
                rumo: op.rumo || 0.6, incl: op.incl == null ? 0.95 : op.incl };
  const mostrar = { curvas: true, nomes: true, plantas: true, ardidas: true,
                    caminhos: true, percursos: true, sombra: true,
                    foto: null,          // null = carta; 'esri' = ortofoto drapeado
                    // o caminho por cima das copas, mas nao atraves dos montes
                    porCima: true };
  const conta = { total: 0, desenhadas: 0, triChao: 0, blocosChao: 0, semear: 0, malha: 0, fotosDespejadas: 0, fotosFalhadas: 0 };
  let solAlt = 30, solAz = 180, solV = [0, 0, 1];
  let corDest = [0.10, 0.36, 0.78];

  const unis = (p, ns) => { const o = {}; for (const n of ns) o[n] = gl.getUniformLocation(p, n); return o; };
  const SOMBRA_U = ['uHori', 'uSol', 'uSolAlt', 'uSolAz', 'uNdir', 'uTemHori'];
  const vbo = (prog, nome, dados, tam, stride, off) => {
    const b = gl.createBuffer(); gl.bindBuffer(gl.ARRAY_BUFFER, b);
    gl.bufferData(gl.ARRAY_BUFFER, dados, gl.STATIC_DRAW);
    const l = gl.getAttribLocation(prog, nome);
    gl.enableVertexAttribArray(l);
    gl.vertexAttribPointer(l, tam, gl.FLOAT, false, stride || 0, off || 0);
    return b;
  };
  function apontaBloco(primeira) {
    const o = primeira * 12;
    gl.bindBuffer(gl.ARRAY_BUFFER, bufInst);
    gl.vertexAttribPointer(aInst.pos, 3, gl.UNSIGNED_SHORT, true, 12, o);
    gl.vertexAttribPointer(aInst.par, 4, gl.UNSIGNED_BYTE, false, 12, o + 6);
    gl.vertexAttribPointer(aInst.rot, 2, gl.UNSIGNED_BYTE, true, 12, o + 10);
  }
  function paleta() {
    const im = new Uint8Array(T.mx * T.my * 3), tab = new Float32Array(768);
    for (const k in CLASSES) { const c = CLASSES[k].cor; tab[k*3]=c[0]; tab[k*3+1]=c[1]; tab[k*3+2]=c[2]; }
    for (let i = 0; i < T.mx * T.my; i++) {
      const c = (T.classe[i] & 127) * 3;
      im[i*3] = tab[c]*255; im[i*3+1] = tab[c+1]*255; im[i*3+2] = tab[c+2]*255;
    }
    return im;
  }

  // ---- construir, uma vez
  let t = agoraMs();
  M = malhaTerreno(T); BLO = malhaBlocos(T, 64);
  conta.malha = agoraMs() - t;
  t = agoraMs(); S = semeiaTudo(T, op); conta.semear = agoraMs() - t;
  conta.total = S.total;

  P.chao = prog(gl, VS_CHAO, FS_CHAO);
  P.planta = prog(gl, VS_PLANTA, FS_PLANTA);
  P.rota = prog(gl, VS_ROTA, FS_ROTA);
  P.curva = prog(gl, VS_CURVA, FS_CURVA);
  P.casa = T.casas ? prog(gl, VS_CASA, FS_CASA) : null;
  L.chao = unis(P.chao, ['uMVP','uCam','uTam','uClasse','uFundo','uNevoa','uTexel','uFoto','uTemFoto','uFotoCaixa'].concat(SOMBRA_U));
  L.planta = unis(P.planta, ['uMVP','uCam','uCaixa','uZ0','uD0','uTam','uFundo','uNevoa'].concat(SOMBRA_U));
  L.rota = unis(P.rota, ['uMVP','uCam','uFundo','uNevoa','uCor',
                         'uCota','uGrelha','uCaixaT','uZ0T','uPorCima']);
  L.curva = unis(P.curva, ['uMVP','uCam','uFundo','uNevoa']);
  if (P.casa) L.casa = unis(P.casa, ['uMVP','uCam','uSol','uFundo','uNevoa']);

  if (P.casa) {
    // os uint16 do ficheiro voltam a metros aqui, uma vez so
    const u = T.casas, f = new Float32Array(T.nCasas * 3);
    const kx = T.larg / 65535, ky = T.alt / 65535;
    const kz = (T.casaZ1 - T.casaZ0) / 65535;
    for (let i = 0; i < T.nCasas; i++) {
      f[i*3] = u[i*3] * kx; f[i*3+1] = u[i*3+1] * ky;
      f[i*3+2] = T.casaZ0 + u[i*3+2] * kz;
    }
    A.casa = gl.createVertexArray(); gl.bindVertexArray(A.casa);
    vbo(P.casa, 'aP', f, 3);
    A.nCasa = T.nCasas;
  }

  A.chao = gl.createVertexArray(); gl.bindVertexArray(A.chao);
  vbo(P.chao, 'aP', M.pos, 3); vbo(P.chao, 'aN', M.nor, 3);
  const bi = gl.createBuffer(); gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, bi);
  gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, BLO.idx, gl.STATIC_DRAW);

  texClasse = gl.createTexture(); gl.bindTexture(gl.TEXTURE_2D, texClasse);
  gl.pixelStorei(gl.UNPACK_ALIGNMENT, 1);
  gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGB8, T.mx, T.my, 0, gl.RGB, gl.UNSIGNED_BYTE, paleta());
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR_MIPMAP_LINEAR);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
  gl.generateMipmap(gl.TEXTURE_2D);

  if (T.hori) {
    texHori = gl.createTexture(); gl.bindTexture(gl.TEXTURE_2D_ARRAY, texHori);
    gl.texImage3D(gl.TEXTURE_2D_ARRAY, 0, gl.R8, T.hori.nx, T.hori.ny, T.hori.ndir,
                  0, gl.RED, gl.UNSIGNED_BYTE, T.hori.dados);
    gl.texParameteri(gl.TEXTURE_2D_ARRAY, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D_ARRAY, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D_ARRAY, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D_ARRAY, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
  }

  texCota = gl.createTexture(); gl.bindTexture(gl.TEXTURE_2D, texCota);
  gl.texImage2D(gl.TEXTURE_2D, 0, gl.R16UI, T.nx, T.ny, 0,
                gl.RED_INTEGER, gl.UNSIGNED_SHORT, T.cotas);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);

  A.planta = gl.createVertexArray(); gl.bindVertexArray(A.planta);
  vbo(P.planta, 'aV', modeloPlanta(), 4, 20, 0);
  let l = gl.getAttribLocation(P.planta, 'aBossa'); gl.enableVertexAttribArray(l);
  gl.vertexAttribPointer(l, 1, gl.FLOAT, false, 20, 16);
  bufInst = gl.createBuffer(); gl.bindBuffer(gl.ARRAY_BUFFER, bufInst);
  gl.bufferData(gl.ARRAY_BUFFER, S.buf, gl.STATIC_DRAW);
  aInst = { pos: gl.getAttribLocation(P.planta, 'aPos'),
            par: gl.getAttribLocation(P.planta, 'aPar'),
            rot: gl.getAttribLocation(P.planta, 'aRot') };
  for (const k in aInst) { gl.enableVertexAttribArray(aInst[k]); gl.vertexAttribDivisor(aInst[k], 1); }
  apontaBloco(0);

  A.rota = gl.createVertexArray(); gl.bindVertexArray(A.rota);
  const fita = fitaRotas(T, op.larguraRota || 2.5, 1.2); A.nRota = fita.length / 3;
  if (A.nRota) vbo(P.rota, 'aP', fita, 3);

  A.cam = gl.createVertexArray(); gl.bindVertexArray(A.cam);
  const fc = fitaCaminhos(T, 0.9); A.grupos = fc.grupos; A.nCam = fc.pos.length / 3;
  if (A.nCam) vbo(P.rota, 'aP', fc.pos, 3);

  // contornos das areas ardidas, um grupo por ano (cada um com a sua cor)
  A.ardi = gl.createVertexArray(); gl.bindVertexArray(A.ardi); A.gruposArdi = []; A.nArdi = 0;
  if (T.ardidas && T.ardidas.length) {
    const porAno = new Map();
    // o extra e plano: [ano, 0] por linha
    T.ardidas.forEach((l, i) => { const ano = T.ardidasAno ? T.ardidasAno[i * 2] : 0; if (!porAno.has(ano)) porAno.set(ano, []); porAno.get(ano).push(l); });
    const partes = []; let ini = 0;
    for (const ano of [...porAno.keys()].sort((x, y) => x - y)) {
      const f = new Float32Array(fitaLinhas(T, porAno.get(ano), Math.max(3.0, T.passoC * 0.6), 0.9));
      partes.push(f); A.gruposArdi.push({ ano, ini, n: f.length / 3 }); ini += f.length / 3;
    }
    const tudo = new Float32Array(ini * 3); let k = 0; for (const f of partes) { tudo.set(f, k); k += f.length; }
    A.nArdi = ini; if (A.nArdi) vbo(P.rota, 'aP', tudo, 3);
  }

  // trilho em destaque e marca de "estou aqui": VAOs proprios, refeitos so
  // quando mudam (o destaque quando se escolhe outro, a marca a cada fixo)
  A.dest = gl.createVertexArray(); A.bufDest = gl.createBuffer(); A.nDest = 0;
  gl.bindVertexArray(A.dest); gl.bindBuffer(gl.ARRAY_BUFFER, A.bufDest);
  { const l2 = gl.getAttribLocation(P.rota, 'aP');
    gl.enableVertexAttribArray(l2); gl.vertexAttribPointer(l2, 3, gl.FLOAT, false, 0, 0); }
  // setas de sentido do trilho em destaque e dos extras
  A.seta = gl.createVertexArray(); A.bufSeta = gl.createBuffer(); A.nSeta = 0;
  gl.bindVertexArray(A.seta); gl.bindBuffer(gl.ARRAY_BUFFER, A.bufSeta);
  { const l2 = gl.getAttribLocation(P.rota, 'aP');
    gl.enableVertexAttribArray(l2); gl.vertexAttribPointer(l2, 3, gl.FLOAT, false, 0, 0); }
  A.setaExtra = gl.createVertexArray(); A.bufSetaExtra = gl.createBuffer(); A.nSetaExtra = 0;
  gl.bindVertexArray(A.setaExtra); gl.bindBuffer(gl.ARRAY_BUFFER, A.bufSetaExtra);
  { const l2 = gl.getAttribLocation(P.rota, 'aP');
    gl.enableVertexAttribArray(l2); gl.vertexAttribPointer(l2, 3, gl.FLOAT, false, 0, 0); }
  // "ver no terreno": os trilhos do utilizador que ele quer sempre a vista,
  // cada um com a sua cor, num VAO refeito so quando a lista muda
  A.extra = gl.createVertexArray(); A.bufExtra = gl.createBuffer(); A.gruposExtra = [];
  gl.bindVertexArray(A.extra); gl.bindBuffer(gl.ARRAY_BUFFER, A.bufExtra);
  { const l2 = gl.getAttribLocation(P.rota, 'aP');
    gl.enableVertexAttribArray(l2); gl.vertexAttribPointer(l2, 3, gl.FLOAT, false, 0, 0); }
  A.marca = gl.createVertexArray(); A.bufMarca = gl.createBuffer(); A.nMarca = 0;
  gl.bindVertexArray(A.marca); gl.bindBuffer(gl.ARRAY_BUFFER, A.bufMarca);
  { const l2 = gl.getAttribLocation(P.rota, 'aP');
    gl.enableVertexAttribArray(l2); gl.vertexAttribPointer(l2, 3, gl.FLOAT, false, 0, 0); }

  A.curva = gl.createVertexArray(); gl.bindVertexArray(A.curva);
  const cu = linhasCurvas(T, 0.8); A.nCurva = cu.n;
  if (A.nCurva) { vbo(P.curva, 'aP', cu.pos, 3); vbo(P.curva, 'aM', cu.mestra, 1); }
  gl.bindVertexArray(null);

  gl.enable(gl.DEPTH_TEST);
  gl.clearColor(FUNDO[0], FUNDO[1], FUNDO[2], 1);

  // ---- rotulos
  const ORDEM = { cume: 0, povoacao: 1, aldeia: 1, lagoa: 2, cascata: 2, miradouro: 2,
                  monumento: 2, castelo: 2, igreja: 2, ruinas: 3, arqueologia: 3, nascente: 3 };
  if (op.rotulos !== false) {
    // 'info' sao os paineis interpretativos: chamam-se quase todos o mesmo e
    // empilhavam-se em cima do vale. Nao entram.
    C = T.pontos.filter((p) => p.nome && p.k !== 'info').map((p) => {
      const m = T.emM(p.lo, p.la);
      return Object.assign({}, p, { mx: m[0], my: m[1], mz: T.cotaEm(m[0], m[1]),
        pri: ORDEM[p.k] === undefined ? 5 : ORDEM[p.k] });
    }).sort((a, b) => a.pri - b.pri);
    for (const p of C) {
      const el = document.createElement('div');
      const g = GRUPO_PONTO[p.k] || 'outro';
      el.className = 'r ' + g;
      el.innerHTML = (SINAL_PONTO[g] || '') + '<b>' + p.nome.replace(/[<&]/g, '') + '</b>'
        + (p.k === 'cume' && p.alt ? p.alt + ' m' : '');
      el.style.display = 'none';
      (op.camadaRotulos || document.body).appendChild(el);
      p.el = el;
    }
  }

  function poeSol(quando) {
    const s = posicaoSol(quando, (T.la0 + T.la1) / 2, (T.lo0 + T.lo1) / 2);
    solAlt = s.alt; solAz = s.az; solV = vectorSol(Math.max(s.alt, 0), s.az);
    return s;
  }
  poeSol(op.quando || new Date());

  function poeSombra(u) {
    if (texHori) { gl.activeTexture(gl.TEXTURE1); gl.bindTexture(gl.TEXTURE_2D_ARRAY, texHori); }
    gl.uniform1i(u.uHori, 1);
    gl.uniform3f(u.uSol, solV[0], solV[1], solV[2]);
    gl.uniform1f(u.uSolAlt, solAlt);
    gl.uniform1f(u.uSolAz, ((solAz % 360) + 360) % 360 / 360);
    gl.uniform1f(u.uNdir, T.hori ? T.hori.ndir : 16);
    gl.uniform1f(u.uTemHori, (T.hori && mostrar.sombra) ? 1 : 0);
  }
  // ---- ortofoto por bloco, com o detalhe a seguir a distancia
  // Cada bloco de 1 km da malha pode levar uma textura feita de azulejos de
  // imagem (Web Mercator XYZ). O nivel de zoom escolhe-se pela distancia da
  // camara: perto z18 (0,46 m/px), longe z15 (3,6 m/px). Enquanto o nivel bom
  // nao chega usa-se o que houver (mais grosso) ou a carta. Cache pequena.
  // Guarda-se por bytes e despeja-se o que ha mais tempo nao se ve. Antes a
  // cache era de 96 texturas e despejava a mais ANTIGA, estivesse a vista ou
  // nao: numa zona de 11x12 km (132 blocos) ou na serra inteira (600) os
  // blocos a vista despejavam-se uns aos outros a cada quadro e a vista
  // piscava entre foto, carta e azulejo grosso (gravacao de 21/09/2026).
  const fotos = new Map();            // chave 'bi:z' -> {tex, pronta, bytes, usada, falhou}
  let fotosAPedir = 0, fotosBytes = 0, quadro = 0;
  const ORC_FOTO = (typeof navigator !== 'undefined' && navigator.deviceMemory && navigator.deviceMemory <= 4) ? 110e6 : 260e6;
  const merc = (lo, la) => [lo / 180 * 20037508.342789244,
                            Math.log(Math.tan(Math.PI / 4 + la * Math.PI / 360)) * 6378137];
  // O nivel de zoom vem do que o ecra consegue mostrar: metros por pixel do
  // ecra a distancia do bloco contra os metros por pixel do azulejo. Pedir
  // mais fino do que isso e so peso -- e era o que fazia a serra inteira
  // pedir z15 para 600 blocos (1 GB de texturas).
  function nivelPara(mpp, laM) {
    const z0 = 156543.03392804097 * Math.cos(laM * Math.PI / 180);   // m/px a z0
    return Math.max(12, Math.min(18, Math.floor(Math.log2(z0 / Math.max(0.05, mpp * 0.75)))));
  }
  // o nivel nunca pede mais de ~1100 px por bloco: num bloco de 1 km isso e
  // z17 (20 azulejos); z18 seriam 81 azulejos por bloco e a fila encravava.
  function nivelMax(b) {
    const larg = b.x1 - b.x0, laM = T.la0 + (b.y0 + b.y1) / 2 / T.mlat;
    let z = 19;
    while (z > 12 && larg / (40075016.68557849 * Math.cos(laM * Math.PI / 180) / Math.pow(2, z) / 256) > 1100) z--;
    return z;
  }
  function fotoDoBloco(bi, b, mpp, fonte) {
    const laM = T.la0 + (b.y0 + b.y1) / 2 / T.mlat;
    const z = Math.min(fonte.zmax || 18, nivelPara(mpp, laM), nivelMax(b));
    // Grosso primeiro: tres niveis abaixo sao 1-2 azulejos por bloco e cobre
    // a vista inteira num instante; o nivel bom vem a seguir e substitui.
    let pronto = null, zp = -1;
    for (let zz = z; zz >= 12; zz--) {
      const e = fotos.get(bi + ':' + zz);
      if (e && e.pronta) { pronto = e.tex; zp = zz; e.usada = quadro; break; }
    }
    // tambem se pode ter uma mais fina do que a precisa (a camara afastou-se)
    if (!pronto) for (let zz = z + 1; zz <= 18; zz++) {
      const e = fotos.get(bi + ':' + zz);
      if (e && e.pronta) { pronto = e.tex; zp = zz; e.usada = quadro; break; }
    }
    if (zp >= z) return pronto;
    if (!pronto) pedeFoto(bi, b, Math.max(12, z - 3), fonte);
    else pedeFoto(bi, b, z, fonte);
    return pronto;
  }
  function despejaFotos() {
    if (fotosBytes <= ORC_FOTO) return;
    // as que nao se viram neste quadro, da mais esquecida para a mais recente
    const cand = [];
    for (const [k, e] of fotos) if (e.pronta && e.usada < quadro) cand.push([k, e]);
    cand.sort((a, b) => a[1].usada - b[1].usada);
    for (const [k, e] of cand) {
      if (fotosBytes <= ORC_FOTO * 0.8) break;
      gl.deleteTexture(e.tex); fotosBytes -= e.bytes; fotos.delete(k); conta.fotosDespejadas++;
    }
    // se tudo o que ha esta a vista, fica: despejar o visivel e piscar
  }
  function pedeFoto(bi, b, z, fonte) {
    const k = bi + ':' + z;
    const ja = fotos.get(k);
    if (ja) { if (ja.falhou && agoraMs() - ja.falhou > 60000) fotos.delete(k); else return; }
    if (fotosAPedir >= 6) return;
    const e = { tex: null, pronta: false, bytes: 0, usada: quadro, falhou: 0, t0: agoraMs() }; fotos.set(k, e); fotosAPedir++;
    const ll0 = T.emLL(b.x0, b.y0), ll1 = T.emLL(b.x1, b.y1);
    const m0 = merc(ll0[0], ll0[1]), m1 = merc(ll1[0], ll1[1]);
    const N = Math.pow(2, z), tam = 40075016.68557849 / N;          // m por azulejo
    const tx0 = Math.floor((m0[0] + 20037508.342789244) / tam), tx1 = Math.floor((m1[0] + 20037508.342789244) / tam);
    const ty0 = Math.floor((20037508.342789244 - m1[1]) / tam), ty1 = Math.floor((20037508.342789244 - m0[1]) / tam);
    const mpp = tam / 256;
    const W = Math.min(2048, Math.round((m1[0] - m0[0]) / mpp)), Hh = Math.min(2048, Math.round((m1[1] - m0[1]) / mpp));
    const cv2 = document.createElement('canvas'); cv2.width = Math.max(16, W); cv2.height = Math.max(16, Hh);
    const cx2 = cv2.getContext('2d');
    cx2.fillStyle = '#8a8f7a'; cx2.fillRect(0, 0, cv2.width, cv2.height);   // onde faltar azulejo: verde-cinza, nao preto
    const sx = cv2.width / (m1[0] - m0[0]), sy = cv2.height / (m1[1] - m0[1]);
    const pedidos = [];
    for (let tx = tx0; tx <= tx1; tx++) for (let ty = ty0; ty <= ty1; ty++) {
      pedidos.push(azulejo(fonte.url(z, tx, ty)).then((im) => {
        if (!im) return false;
        const ex0 = tx * tam - 20037508.342789244, ey1 = 20037508.342789244 - ty * tam;
        try { cx2.drawImage(im, (ex0 - m0[0]) * sx, (m1[1] - ey1) * sy, tam * sx, tam * sy); } catch (err) { return false; }
        return true;
      }));
    }
    Promise.all(pedidos).then((rs) => {
      fotosAPedir = Math.max(0, fotosAPedir - 1);
      // sem rede: fica marcado como falhado e so se volta a pedir dai a um
      // minuto (antes apagava-se e pedia-se outra vez no quadro seguinte)
      if (!rs.some(Boolean)) { e.falhou = agoraMs(); conta.fotosFalhadas++; return; }
      if (gl.isContextLost()) { fotos.delete(k); return; }
      const tex = gl.createTexture(); gl.activeTexture(gl.TEXTURE3); gl.bindTexture(gl.TEXTURE_2D, tex);
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGB8, cv2.width, cv2.height, 0, gl.RGB, gl.UNSIGNED_BYTE, cv2);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR_MIPMAP_LINEAR);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
      gl.generateMipmap(gl.TEXTURE_2D);
      e.tex = tex; e.pronta = true; e.bytes = cv2.width * cv2.height * 4;   // RGB8 fica em 4 bytes/px na pratica, sem contar mipmaps
      e.usada = quadro; fotosBytes += e.bytes;
      despejaFotos();
    });
  }

  function coord() {
    const cz = T.cotaEm(cam.x, cam.y);
    const h = Math.cos(cam.incl) * cam.dist, r = Math.sin(cam.incl) * cam.dist;
    const ox = cam.x - Math.sin(cam.rumo) * r, oy = cam.y - Math.cos(cam.rumo) * r;
    const dz = cam.dz || 0;
    return { olho: [ox, oy, Math.max(cz + h + dz, T.cotaEm(ox, oy) + 25)],
             alvo: [cam.x, cam.y, cz + dz] };
  }
  function naVista(b, M4) {
    let e = 0x3f;
    for (let k = 0; k < 8; k++) {
      const x = (k & 1) ? b.x1 : b.x0, y = (k & 2) ? b.y1 : b.y0, z = (k & 4) ? b.z1 : b.z0;
      const cx = M4[0]*x + M4[4]*y + M4[8]*z + M4[12];
      const cy = M4[1]*x + M4[5]*y + M4[9]*z + M4[13];
      const cz = M4[2]*x + M4[6]*y + M4[10]*z + M4[14];
      const cw = M4[3]*x + M4[7]*y + M4[11]*z + M4[15];
      let f = 0;
      if (cx < -cw) f |= 1; if (cx > cw) f |= 2;
      if (cy < -cw) f |= 4; if (cy > cw) f |= 8;
      if (cz < -cw) f |= 16; if (cz > cw) f |= 32;
      e &= f; if (!e) return true;
    }
    return false;
  }
  // Ha monte pelo meio? Sem isto os nomes do outro lado da serra flutuam no ar.
  function tapado(olho, x, y, z) {
    const n = 16;
    for (let k = 2; k <= n - 2; k++) {
      const u = k / n;
      if (T.cotaEm(olho[0] + (x - olho[0]) * u, olho[1] + (y - olho[1]) * u)
          > olho[2] + (z - olho[2]) * u + 22) return true;
    }
    return false;
  }
  function poeRotulos(MVP, olho, W, H) {
    const caixas = []; let postos = 0;
    for (const p of C) {
      const esconde = () => { if (p.el.style.display !== 'none') p.el.style.display = 'none'; };
      if (!mostrar.nomes || postos >= 30) { esconde(); continue; }
      const x = p.mx, y = p.my, z = p.mz + 12;
      const cx = MVP[0]*x + MVP[4]*y + MVP[8]*z + MVP[12];
      const cy = MVP[1]*x + MVP[5]*y + MVP[9]*z + MVP[13];
      const cw = MVP[3]*x + MVP[7]*y + MVP[11]*z + MVP[15];
      const dist = Math.hypot(x - olho[0], y - olho[1], z - olho[2]);
      if (cw <= 0 || dist > 7000) { esconde(); continue; }
      const sx = (cx / cw * 0.5 + 0.5) * W, sy = (1 - (cy / cw * 0.5 + 0.5)) * H;
      if (sx < -40 || sx > W + 40 || sy < 46 || sy > H - 66) { esconde(); continue; }
      const lg = Math.min(150, 7 + p.nome.length * 6), a = sx - lg / 2, b = sx + lg / 2;
      let choca = false;
      for (const q of caixas) if (a < q[1] && b > q[0] && sy - 26 < q[3] && sy > q[2]) { choca = true; break; }
      if (choca || tapado(olho, x, y, z)) { esconde(); continue; }
      caixas.push([a, b, sy - 26, sy]);
      p.el.style.display = '';
      p.el.style.left = sx.toFixed(0) + 'px';
      p.el.style.top = sy.toFixed(0) + 'px';
      p.el.style.opacity = (1 - Math.min(0.7, dist / 9000)).toFixed(2);
      postos++;
    }
  }

  let ultimo = 0; const ritmos = []; let ultimaProj = null;
  function desenha(ts, soUm) {
    if (!vivo) return;
    if (!soUm) requestAnimationFrame(desenha);
    const dpr = Math.min(devicePixelRatio || 1, op.dprMax || 2);
    const cw = canvas.clientWidth || innerWidth, ch = canvas.clientHeight || innerHeight;
    const W = Math.round(cw * dpr), H = Math.round(ch * dpr);
    if (canvas.width !== W || canvas.height !== H) { canvas.width = W; canvas.height = H; }
    gl.viewport(0, 0, W, H);
    gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);

    const { olho, alvo } = coord();
    const longe = Math.max(9000, cam.dist * 6);
    const MVP = mult(perspetiva(1.0, W / H, Math.max(2, cam.dist * 0.01), longe),
                     olhar(olho, alvo, [0, 0, 1]));
    ultimaProj = { MVP, olho, W, H, dpr };            // para api.aoEcra
    const nevoa = longe * 0.75;
    const comuns = (u) => {
      gl.uniformMatrix4fv(u.uMVP, false, MVP);
      gl.uniform3f(u.uCam, olho[0], olho[1], olho[2]);
      gl.uniform3f(u.uFundo, FUNDO[0], FUNDO[1], FUNDO[2]);
      gl.uniform1f(u.uNevoa, nevoa);
    };

    gl.useProgram(P.chao); comuns(L.chao);
    gl.uniform2f(L.chao.uTam, T.larg, T.alt);
    gl.activeTexture(gl.TEXTURE0); gl.bindTexture(gl.TEXTURE_2D, texClasse);
    gl.uniform1i(L.chao.uClasse, 0);
    gl.uniform2f(L.chao.uTexel, 1 / T.mx, 1 / T.my);
    gl.uniform1i(L.chao.uFoto, 3);
    poeSombra(L.chao);
    gl.bindVertexArray(A.chao);
    const mppBase = 2 * Math.tan(0.5) / H;
    let triChao = 0, blocosChao = 0;
    const foto = mostrar.foto ? FOTO_FONTES[mostrar.foto] : null;
    for (let bi = 0; bi < BLO.partes.length; bi++) {
      const b = BLO.partes[bi];
      if (!naVista(b, MVP)) continue;
      const dx = Math.max(b.x0 - olho[0], 0, olho[0] - b.x1);
      const dy = Math.max(b.y0 - olho[1], 0, olho[1] - b.y1);
      const dz = Math.max(b.z0 - olho[2], 0, olho[2] - b.z1);
      const d = Math.max(1, Math.hypot(dx, dy, dz));
      const nv = b.niveis[passoDoBloco(d, T.passo, mppBase * d)];
      let temFoto = 0;
      if (foto) {
        const tex = fotoDoBloco(bi, b, mppBase * d, foto);
        if (tex) { gl.activeTexture(gl.TEXTURE3); gl.bindTexture(gl.TEXTURE_2D, tex); temFoto = 1;
                   gl.uniform4f(L.chao.uFotoCaixa, b.x0, b.y0, b.x1, b.y1); }
      }
      gl.uniform1f(L.chao.uTemFoto, temFoto);
      gl.drawElements(gl.TRIANGLES, nv.n, gl.UNSIGNED_INT, nv.off * 4);
      triChao += nv.n / 3; blocosChao++;
    }
    conta.triChao = triChao; conta.blocosChao = blocosChao;
    conta.fotos = fotos.size; conta.fotosMB = fotosBytes / 1e6;
    quadro++;

    if (mostrar.curvas && A.nCurva) {
      gl.useProgram(P.curva); comuns(L.curva);
      gl.enable(gl.BLEND); gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);
      gl.bindVertexArray(A.curva);
      gl.drawArrays(gl.LINES, 0, A.nCurva);
      gl.disable(gl.BLEND);
    }
    // As casas antes das plantas: sao opacas e poucas, e preenchem o z-buffer
    // cedo, o que poupa as arvores que ficam atras delas.
    if (P.casa && mostrar.casas !== false) {
      gl.useProgram(P.casa); comuns(L.casa);
      gl.uniform3f(L.casa.uSol, solV[0], solV[1], solV[2]);
      gl.bindVertexArray(A.casa);
      gl.drawArrays(gl.TRIANGLES, 0, A.nCasa);
    }

    let des = 0;
    if (mostrar.plantas) {
      gl.useProgram(P.planta); comuns(L.planta);
      gl.uniform3f(L.planta.uCaixa, T.larg, T.alt, T.z1 - T.z0);
      gl.uniform2f(L.planta.uTam, T.larg, T.alt);
      gl.uniform1f(L.planta.uZ0, T.z0);
      gl.uniform1f(L.planta.uD0, op.d0 || D0);
      poeSombra(L.planta);
      gl.bindVertexArray(A.planta);
      for (let b = 0; b < S.nB; b++) {
        const n = S.ini[b + 1] - S.ini[b];
        if (!n) continue;
        const bi2 = b % S.bx, bj = (b / S.bx) | 0;
        const x0 = bi2 * BLOCO, x1 = x0 + BLOCO, y1 = T.alt - bj * BLOCO, y0 = y1 - BLOCO;
        const dx = Math.max(x0 - olho[0], 0, olho[0] - x1);
        const dy = Math.max(y0 - olho[1], 0, olho[1] - y1);
        const d = Math.max(1, Math.hypot(dx, dy));
        if (d > longe) continue;
        const dd = (op.d0 || D0) / d;
        const q = Math.min(n, Math.ceil(n * Math.min(1, dd * dd)) + 1);
        apontaBloco(S.ini[b]);
        gl.drawArraysInstanced(gl.TRIANGLES, 0, VERT_MODELO, q);
        des += q;
      }
    }
    conta.desenhadas = des;

    // Por fim os caminhos e os percursos. Com 'porCima' ligado nao ha teste de
    // profundidade -- por isso nenhuma copa os tapa -- e e o proprio shader que
    // corta o que tem monte pelo meio. Desligado, ficam onde estavam, debaixo
    // do que estiver a frente.
    const desenhaFitas = () => {
      gl.useProgram(P.rota); comuns(L.rota);
      gl.activeTexture(gl.TEXTURE2); gl.bindTexture(gl.TEXTURE_2D, texCota);
      gl.uniform1i(L.rota.uCota, 2);
      gl.uniform2f(L.rota.uGrelha, T.nx, T.ny);
      gl.uniform3f(L.rota.uCaixaT, T.larg, T.alt, T.z1 - T.z0);
      gl.uniform1f(L.rota.uZ0T, T.z0);
      gl.uniform1f(L.rota.uPorCima, mostrar.porCima ? 1 : 0);
      if (mostrar.porCima) gl.disable(gl.DEPTH_TEST);
      if (mostrar.caminhos && A.nCam) {
        gl.bindVertexArray(A.cam);
        for (const g of A.grupos) {
          if (!g.n) continue;
          const c = g.eixo ? COR_EIXO : (g.piso && PISOS[g.piso] ? PISOS[g.piso].cor : CAMINHOS[g.tipo].cor);
          gl.uniform3f(L.rota.uCor, c[0], c[1], c[2]);
          gl.drawArrays(gl.TRIANGLES, g.ini, g.n);
        }
      }
      if (mostrar.ardidas && A.nArdi) {
        gl.bindVertexArray(A.ardi);
        for (const g of A.gruposArdi) {
          const c = COR_ARDIDA(g.ano);
          gl.uniform3f(L.rota.uCor, c[0], c[1], c[2]);
          gl.drawArrays(gl.TRIANGLES, g.ini, g.n);
        }
      }
      if (mostrar.percursos && A.nRota) {
        const c = op.corRota || [0.83, 0.25, 0.18];
        gl.uniform3f(L.rota.uCor, c[0], c[1], c[2]);
        gl.bindVertexArray(A.rota);
        gl.drawArrays(gl.TRIANGLES, 0, A.nRota);
      }
      if (A.gruposExtra.length) {
        gl.bindVertexArray(A.extra);
        for (const g of A.gruposExtra) {
          if (!g.n) continue;
          gl.uniform3f(L.rota.uCor, g.cor[0], g.cor[1], g.cor[2]);
          gl.drawArrays(gl.TRIANGLES, g.ini, g.n);
        }
      }
      // o trilho escolhido por cima dos outros, mais grosso e mais vivo
      if (A.nDest) {
        const c = corDest;
        gl.uniform3f(L.rota.uCor, c[0], c[1], c[2]);
        gl.bindVertexArray(A.dest);
        gl.drawArrays(gl.TRIANGLES, 0, A.nDest);
      }
      if (A.nSetaExtra) {
        gl.uniform3f(L.rota.uCor, 1.0, 0.98, 0.92);
        gl.bindVertexArray(A.setaExtra);
        gl.drawArrays(gl.TRIANGLES, 0, A.nSetaExtra);
      }
      if (A.nSeta) {
        gl.uniform3f(L.rota.uCor, 1.0, 0.98, 0.92);
        gl.bindVertexArray(A.seta);
        gl.drawArrays(gl.TRIANGLES, 0, A.nSeta);
      }
      // a marca de "estou aqui" nunca se esconde, nem atras do monte: quem
      // esta a andar precisa de se ver, mesmo que o relevo diga que nao.
      if (A.nMarca) {
        gl.uniform1f(L.rota.uPorCima, 0);
        gl.uniform3f(L.rota.uCor, 0.13, 0.42, 0.85);
        gl.bindVertexArray(A.marca);
        gl.drawArrays(gl.TRIANGLES, 0, A.nMarca);
      }
      if (mostrar.porCima) gl.enable(gl.DEPTH_TEST);
    };
    desenhaFitas();
    gl.bindVertexArray(null);
    poeRotulos(MVP, olho, cw, ch);

    if (ultimo) { ritmos.push(ts - ultimo); if (ritmos.length > 60) ritmos.shift(); }
    ultimo = ts;
    if (op.aoDesenhar) op.aoDesenhar(conta);
  }
  requestAnimationFrame(desenha);

  const trava = (v, a, b) => Math.max(a, Math.min(b, v));
  const api = {
    cam, mostrar, conta, T,
    // onde cai no ecra (px CSS) um ponto do terreno, com a ultima camara
    // desenhada; null antes do primeiro quadro. 'atras' = fora do campo.
    aoEcra(lo, la, dz) {
      if (!ultimaProj) return null;
      const { MVP, W, H, dpr } = ultimaProj;
      const m = T.emM(lo, la), x = m[0], y = m[1], z = T.cotaEm(x, y) + (dz || 0);
      const cx = MVP[0]*x + MVP[4]*y + MVP[8]*z + MVP[12];
      const cy = MVP[1]*x + MVP[5]*y + MVP[9]*z + MVP[13];
      const cw = MVP[3]*x + MVP[7]*y + MVP[11]*z + MVP[15];
      if (cw <= 0) return { x: 0, y: 0, atras: true };
      return { x: (cx / cw * 0.5 + 0.5) * W / dpr, y: (1 - (cy / cw * 0.5 + 0.5)) * H / dpr, atras: false };
    },
    ritmo: () => ritmos.length ? ritmos.slice().sort((a, b) => a - b)[ritmos.length >> 1] : 0,
    hora: (quando) => poeSol(quando),
    sol: () => ({ alt: solAlt, az: solAz }),
    anda(dx, dy) {
      const k = cam.dist * 0.0016, sn = Math.sin(cam.rumo), cs = Math.cos(cam.rumo);
      cam.x = trava(cam.x - (dx * cs - dy * sn) * k, 0, T.larg);
      cam.y = trava(cam.y + (dx * sn + dy * cs) * k, 0, T.alt);
    },
    roda: (d) => cam.rumo += d,
    // O alcance da densidade cheia muda a quente: e so um uniform e o numero
    // de instancias que se manda desenhar. O buffer nao se toca.
    d0: (v) => { op.d0 = Math.max(60, Math.min(2500, v)); return op.d0; },
    inclina: (d) => cam.incl = trava(cam.incl + d, 0.06, 1.45),
    // O zoom escala tambem a altura do elevador (dz): depois de subir 3 km,
    // aproximar sem isto ia ao encontro de um alvo que ficou no ar e a altura
    // fixa dominava tudo -- "o zoom deixou de funcionar". Assim, aproximar
    // traz-te de volta ao chao e afastar sobe, na mesma proporcao.
    // ate 160 km: a vista geral tem 80 km de lado e quer-se ve-la inteira
    aproxima: (f) => { const d0 = cam.dist; cam.dist = trava(cam.dist * f, 40, 160000);
                       if (cam.dz) cam.dz *= cam.dist / d0; },
    // Subir na vertical nao e inclinar. A camara orbita um ponto do chao a
    // distancia 'dist' e inclinacao 'incl'; a altura e h = cos(incl)*dist e o
    // afastamento no plano e r = sin(incl)*dist. Inclinar muda os dois ao
    // mesmo tempo -- afasta-te enquanto sobes. Para subir a direito mantem-se
    // o r e mexe-se so no h, e recalculam-se dist e incl a partir dai. O
    // ponto do chao debaixo da camara fica onde estava.
    // Elevador: sobe e desce e mais nada. A primeira versao mantinha o
    // afastamento no plano e mexia na altura, o que obrigava a recalcular
    // dist e incl -- ou seja, mudava a camara. Ele disse que nao e isso: e
    // subir com a mesma vista. Aqui o olho E o alvo sobem juntos, portanto a
    // direccao de onde se olha nao muda uma virgula.
    sobe: (d) => { cam.dz = trava((cam.dz || 0) + d * cam.dist * 0.12, -3 * cam.dist, 3 * cam.dist); },
    vaiA(lo, la, dist) { const m = T.emM(lo, la); cam.x = m[0]; cam.y = m[1];
                         if (dist) cam.dist = dist; cam.dz = 0; },
    // linhas em [lon, lat] achatadas, como as do ficheiro
    destaque(linhas, cor, largura) {
      corDest = cor || [0.10, 0.36, 0.78];
      const v = fitaLinhas(T, suaviza(T, linhas || []), largura || 9, 1.6);
      A.nDest = v.length / 3;
      gl.bindBuffer(gl.ARRAY_BUFFER, A.bufDest);
      gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(v), gl.DYNAMIC_DRAW);
      const st = setasLinhas(T, linhas || [], (largura || 9) * 0.5, 1.75, 120);
      A.nSeta = st.length / 3;
      gl.bindBuffer(gl.ARRAY_BUFFER, A.bufSeta);
      gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(st), gl.DYNAMIC_DRAW);
    },
    // a camara como um todo, para trocar de zona sem perder o sitio
    camara() { const ll = T.emLL(cam.x, cam.y); return { lo: ll[0], la: ll[1], dist: cam.dist, rumo: cam.rumo, incl: cam.incl }; },
    poeCamara(c) { if (!c) return; const m = T.emM(c.lo, c.la);
      cam.x = trava(m[0], 0, T.larg); cam.y = trava(m[1], 0, T.alt);
      if (c.dist) cam.dist = trava(c.dist, 40, 160000);
      if (c.rumo != null) cam.rumo = c.rumo; if (c.incl != null) cam.incl = trava(c.incl, 0.06, 1.45); cam.dz = 0; },
    // lista de { linhas, cor, largura }: os trilhos a manter a vista
    extras(lista) {
      const V = [], grupos = [];
      for (const e of lista || []) {
        const v = fitaLinhas(T, suaviza(T, e.linhas || []), e.largura || 6, 1.4);
        grupos.push({ ini: V.length / 3, n: v.length / 3, cor: e.cor || [0.72, 0.30, 0.66] });
        for (let k = 0; k < v.length; k++) V.push(v[k]);
      }
      A.gruposExtra = grupos;
      gl.bindBuffer(gl.ARRAY_BUFFER, A.bufExtra);
      gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(V), gl.DYNAMIC_DRAW);
      const S = [];
      for (const e of lista || []) { const st = setasLinhas(T, e.linhas || [], (e.largura || 6) * 0.5, 1.55, 120); for (let k = 0; k < st.length; k++) S.push(st[k]); }
      A.nSetaExtra = S.length / 3;
      gl.bindBuffer(gl.ARRAY_BUFFER, A.bufSetaExtra);
      gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(S), gl.DYNAMIC_DRAW);
    },
    // onde estou: um anel no chao e um pau a apontar ao ceu
    marca(lo, la, raio) {
      if (lo == null) { A.nMarca = 0; return null; }
      const m = T.emM(lo, la);
      const z = T.cotaEm(m[0], m[1]);
      const R = raio || 14, H = 45, V = [];
      const N = 14;
      for (let i = 0; i < N; i++) {
        const a0 = i / N * 6.283, a1 = (i + 1) / N * 6.283;
        const p0 = [m[0] + Math.cos(a0) * R, m[1] + Math.sin(a0) * R];
        const p1 = [m[0] + Math.cos(a1) * R, m[1] + Math.sin(a1) * R];
        const q0 = [m[0] + Math.cos(a0) * R * 0.62, m[1] + Math.sin(a0) * R * 0.62];
        const q1 = [m[0] + Math.cos(a1) * R * 0.62, m[1] + Math.sin(a1) * R * 0.62];
        for (const q of [[q0, 1.5], [p0, 1.5], [q1, 1.5], [q1, 1.5], [p0, 1.5], [p1, 1.5]])
          V.push(q[0][0], q[0][1], z + q[1]);
      }
      const e = 2.2;
      for (let i = 0; i < 4; i++) {
        const a0 = i / 4 * 6.283, a1 = (i + 1) / 4 * 6.283;
        const x0 = m[0] + Math.cos(a0) * e, y0 = m[1] + Math.sin(a0) * e;
        const x1 = m[0] + Math.cos(a1) * e, y1 = m[1] + Math.sin(a1) * e;
        V.push(x0, y0, z, x1, y1, z, x0, y0, z + H);
        V.push(x1, y1, z, x1, y1, z + H, x0, y0, z + H);
      }
      A.nMarca = V.length / 3;
      gl.bindBuffer(gl.ARRAY_BUFFER, A.bufMarca);
      gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(V), gl.DYNAMIC_DRAW);
      return { x: m[0], y: m[1], z };
    },
    // esta dentro da caixa desta zona?
    dentro(lo, la) { return lo >= T.lo0 && lo <= T.lo1 && la >= T.la0 && la <= T.la1; },
    // um quadro agora, devolvido como imagem: a pagina mostra-o enquanto a
    // zona seguinte se constroi, para nao haver um corte a preto na troca
    instantaneo() {
      try { desenha(agoraMs(), true); return canvas.toDataURL('image/jpeg', 0.72); } catch (e) { return null; }
    },
    desliga() {
      vivo = false;
      for (const p of C) if (p.el && p.el.parentNode) p.el.parentNode.removeChild(p.el);
      C = [];
      const ext = gl.getExtension('WEBGL_lose_context'); if (ext) ext.loseContext();
    },
  };
  // gestos, se pedirem
  if (op.gestos !== false) ligaGestos(canvas, api);
  return api;
}

// Um dedo anda. Dois dedos fazem as tres coisas ao mesmo tempo: afastar e
// juntar da zoom, torcer roda, subir e descer juntos inclina.
function ligaGestos(cv, v) {
  const dedos = new Map();
  let par = null, botao = 0;
  const estado = () => {
    const [a, b] = [...dedos.values()];
    return { d: Math.hypot(b.x - a.x, b.y - a.y), a: Math.atan2(b.y - a.y, b.x - a.x), cy: (a.y + b.y) / 2 };
  };
  cv.addEventListener('pointerdown', (e) => {
    cv.setPointerCapture(e.pointerId);
    dedos.set(e.pointerId, { x: e.clientX, y: e.clientY });
    botao = e.button;
    if (dedos.size === 2) par = estado();
  });
  const larga = (e) => { dedos.delete(e.pointerId); par = dedos.size === 2 ? estado() : null; };
  cv.addEventListener('pointerup', larga);
  cv.addEventListener('pointercancel', larga);
  cv.addEventListener('pointerleave', larga);
  cv.addEventListener('pointermove', (e) => {
    const p = dedos.get(e.pointerId); if (!p) return;
    const dx = e.clientX - p.x, dy = e.clientY - p.y;
    p.x = e.clientX; p.y = e.clientY;
    if (dedos.size === 1) {
      if (botao === 2 || e.shiftKey) { v.roda(dx * 0.006); v.inclina(dy * 0.005); }
      else v.anda(dx, dy);
    } else if (dedos.size === 2 && par) {
      const n = estado();
      if (par.d > 8 && n.d > 8) v.aproxima(par.d / n.d);
      let da = n.a - par.a;
      if (da > Math.PI) da -= 2 * Math.PI;
      if (da < -Math.PI) da += 2 * Math.PI;
      v.roda(-da); v.inclina((n.cy - par.cy) * 0.004);
      par = n;
    }
  });
  cv.addEventListener('contextmenu', (e) => e.preventDefault());
  cv.addEventListener('wheel', (e) => { e.preventDefault(); v.aproxima(Math.exp(e.deltaY * 0.0012)); },
                      { passive: false });
}

if (typeof module !== 'undefined') Object.assign(module.exports, { abreVista, ligaGestos });

// ===========================================================================
// COZER NO NAVEGADOR
// ---------------------------------------------------------------------------
// Cozer as 133 caixas dos percursos em terra dava 133 ficheiros de meio MB. Nao
// e preciso: o telemovel ja tem o dem.webp e os azulejos. Coze-se a caixa do
// percurso a entrada, com o mesmo formato e o mesmo motor. Nao se descarrega
// nada de novo, e depois de cozida nao se constroi mais nada.
// ===========================================================================

// ---- leitor minimo de MVT (o mesmo que o lepmtiles.py faz do lado de la)
function _varint(b, i) { let r = 0, s = 0, x;
  do { x = b[i++]; r |= (x & 0x7f) << s; s += 7; } while (x & 0x80);
  return [r >>> 0, i]; }
function _salta(b, i, t) {
  if (t === 0) return _varint(b, i)[1];
  if (t === 2) { const [n, j] = _varint(b, i); return j + n; }
  if (t === 5) return i + 4;
  if (t === 1) return i + 8;
  throw new Error('tipo ' + t);
}
function leMVT(buf) {
  const b = new Uint8Array(buf), out = {};
  let i = 0;
  while (i < b.length) {
    const [k, j] = _varint(b, i); i = j;
    if ((k >> 3) === 3 && (k & 7) === 2) {
      const [n, j2] = _varint(b, i); i = j2;
      const c = _camada(b.subarray(i, i + n)); i += n;
      out[c.nome] = c;
    } else i = _salta(b, i, k & 7);
  }
  return out;
}
function _camada(b) {
  let nome = '', ext = 4096; const chaves = [], valores = [], feats = [];
  let i = 0;
  while (i < b.length) {
    const [k, j] = _varint(b, i); i = j;
    const campo = k >> 3, tipo = k & 7;
    if (campo === 1 && tipo === 2) { const [n, j2] = _varint(b, i); i = j2;
      nome = new TextDecoder().decode(b.subarray(i, i + n)); i += n; }
    else if (campo === 2 && tipo === 2) { const [n, j2] = _varint(b, i); i = j2;
      feats.push(b.subarray(i, i + n)); i += n; }
    else if (campo === 3 && tipo === 2) { const [n, j2] = _varint(b, i); i = j2;
      chaves.push(new TextDecoder().decode(b.subarray(i, i + n))); i += n; }
    else if (campo === 4 && tipo === 2) { const [n, j2] = _varint(b, i); i = j2;
      valores.push(_valor(b.subarray(i, i + n))); i += n; }
    else if (campo === 5) { const [v, j2] = _varint(b, i); ext = v; i = j2; }
    else i = _salta(b, i, tipo);
  }
  return { nome, ext, feicoes: feats.map((f) => _feat(f, chaves, valores)) };
}
function _valor(b) {
  let i = 0;
  while (i < b.length) {
    const [k, j] = _varint(b, i); i = j;
    const campo = k >> 3, tipo = k & 7;
    if (campo === 1 && tipo === 2) { const [n, j2] = _varint(b, i);
      return new TextDecoder().decode(b.subarray(j2, j2 + n)); }
    if ((campo === 4 || campo === 5) && tipo === 0) return _varint(b, i)[0];
    if (campo === 6 && tipo === 0) { const v = _varint(b, i)[0]; return (v >> 1) ^ -(v & 1); }
    if (campo === 2 && tipo === 5) return new DataView(b.buffer, b.byteOffset + i, 4).getFloat32(0, true);
    if (campo === 3 && tipo === 1) return new DataView(b.buffer, b.byteOffset + i, 8).getFloat64(0, true);
    i = _salta(b, i, tipo);
  }
  return null;
}
function _feat(b, chaves, valores) {
  const props = {}; let gtipo = 0; const geom = [];
  let i = 0;
  while (i < b.length) {
    const [k, j] = _varint(b, i); i = j;
    const campo = k >> 3, tipo = k & 7;
    if (campo === 2 && tipo === 2) {
      const [n, j2] = _varint(b, i); i = j2; const fim = i + n; const par = [];
      while (i < fim) { const [v, j3] = _varint(b, i); par.push(v); i = j3; }
      for (let q = 0; q + 1 < par.length; q += 2) props[chaves[par[q]]] = valores[par[q + 1]];
    } else if (campo === 3 && tipo === 0) { const [v, j2] = _varint(b, i); gtipo = v; i = j2; }
    else if (campo === 4 && tipo === 2) {
      const [n, j2] = _varint(b, i); i = j2; const fim = i + n;
      while (i < fim) { const [v, j3] = _varint(b, i); geom.push(v); i = j3; }
    } else i = _salta(b, i, tipo);
  }
  return { props, gtipo, geom };
}
function aneisMVT(geom) {
  const out = []; let cur = [], x = 0, y = 0, i = 0;
  while (i < geom.length) {
    const cmd = geom[i++], op = cmd & 7, cnt = cmd >> 3;
    if (op === 1) for (let k = 0; k < cnt; k++) {
      const dx = geom[i++], dy = geom[i++];
      x += (dx >> 1) ^ -(dx & 1); y += (dy >> 1) ^ -(dy & 1);
      if (cur.length) out.push(cur);
      cur = [[x, y]];
    } else if (op === 2) for (let k = 0; k < cnt; k++) {
      const dx = geom[i++], dy = geom[i++];
      x += (dx >> 1) ^ -(dx & 1); y += (dy >> 1) ^ -(dy & 1);
      cur.push([x, y]);
    } else if (op === 7) { if (cur.length) { out.push(cur); cur = []; } }
  }
  if (cur.length) out.push(cur);
  return out;
}

const TAB_G = { urbano: 1, agricola: 2, floresta: 3, matos: 4, rocha: 5, agua: 6, outro: 7 };
const TIPO_CAM = { nacional: 0, estrada: 1, estradao: 2, caminho: 3, trilho: 4 };
const lon2x = (lo, z) => Math.floor((lo + 180) / 360 * Math.pow(2, z));
const lat2y = (la, z) => { const r = la * Math.PI / 180;
  return Math.floor((1 - Math.log(Math.tan(r) + 1 / Math.cos(r)) / Math.PI) / 2 * Math.pow(2, z)); };
const x2lon = (x, z) => x / Math.pow(2, z) * 360 - 180;
const y2lat = (y, z) => { const n = Math.PI - 2 * Math.PI * y / Math.pow(2, z);
  return Math.atan(Math.sinh(n)) * 180 / Math.PI; };

// scanline com regra par-impar: os buracos do poligono contam
function pintaPol(dest, mx, my, caixa, gs, cod) {
  const [lo0, la0, lo1, la1] = caixa;
  const kx = mx / (lo1 - lo0), ky = my / (la1 - la0);
  const A = [];
  for (const anel of gs) {
    const n = anel.length;
    for (let i = 0; i < n; i++) {
      const a = anel[i], b = anel[(i + 1) % n];
      if (a[1] === b[1]) continue;
      A.push([(a[0] - lo0) * kx, (a[1] - la0) * ky, (b[0] - lo0) * kx, (b[1] - la0) * ky]);
    }
  }
  if (!A.length) return;
  let y0 = 1e9, y1 = -1e9;
  for (const e of A) { y0 = Math.min(y0, e[1], e[3]); y1 = Math.max(y1, e[1], e[3]); }
  y0 = Math.max(0, Math.floor(y0)); y1 = Math.min(my - 1, Math.ceil(y1));
  const xs = [];
  for (let j = y0; j <= y1; j++) {
    const yc = j + 0.5; xs.length = 0;
    for (const e of A) {
      if ((e[1] <= yc && e[3] > yc) || (e[3] <= yc && e[1] > yc))
        xs.push(e[0] + (yc - e[1]) / (e[3] - e[1]) * (e[2] - e[0]));
    }
    if (xs.length < 2) continue;
    xs.sort((a, b) => a - b);
    for (let k = 0; k + 1 < xs.length; k += 2) {
      const i0 = Math.max(0, Math.ceil(xs[k] - 0.5)), i1 = Math.min(mx - 1, Math.floor(xs[k + 1] - 0.5));
      for (let i = i0; i <= i1; i++) dest[j * mx + i] = cod;
    }
  }
}

// Mapa de horizonte, o mesmo que o cozedor em Python faz.
//
// Num telemovel isto e a parte cara -- na grelha inteira levava cinco segundos
// aqui e uns quinze la. Mas o horizonte e um campo LISO: entre dois nos a 25 m
// um do outro nao muda quase nada. Entao calcula-se numa grelha mais larga (o
// 'salto') e deixa-se a placa grafica interpolar, que e o que ela faz de
// borla. Salto 2 e quatro vezes menos trabalho e nao se ve diferenca.
function mapaHorizonte(Z, nx, ny, px, py, ndir, alcance, salto) {
  salto = Math.max(1, salto || 1);
  const hx = Math.max(2, Math.ceil(nx / salto)), hy = Math.max(2, Math.ceil(ny / salto));
  const kx = px * (nx - 1) / (hx - 1), ky = py * (ny - 1) / (hy - 1);
  // grelha larga, tirada da fina
  const G = new Float32Array(hx * hy);
  for (let j = 0; j < hy; j++) {
    const sj = Math.min(ny - 1, Math.round(j * (ny - 1) / (hy - 1)));
    for (let i = 0; i < hx; i++)
      G[j * hx + i] = Z[sj * nx + Math.min(nx - 1, Math.round(i * (nx - 1) / (hx - 1)))];
  }
  const H = new Uint8Array(ndir * hx * hy);
  const maxang = new Float32Array(hx * hy);
  for (let d = 0; d < ndir; d++) {
    maxang.fill(0);
    const az = 2 * Math.PI * d / ndir;
    for (let dist = Math.min(kx, ky); dist < alcance; dist *= 1.4) {
      const di = Math.round(Math.sin(az) * dist / kx);
      const dj = Math.round(-Math.cos(az) * dist / ky);
      for (let j = 0; j < hy; j++) {
        const jj = Math.min(hy - 1, Math.max(0, j + dj)) * hx;
        const j0 = j * hx;
        for (let i = 0; i < hx; i++) {
          const a = (G[jj + Math.min(hx - 1, Math.max(0, i + di))] - G[j0 + i]) / dist;
          if (a > maxang[j0 + i]) maxang[j0 + i] = a;
        }
      }
    }
    const base = d * hx * hy;
    for (let k = 0; k < hx * hy; k++)
      H[base + k] = Math.min(180, Math.max(0, Math.round(Math.atan(maxang[k]) * 180 / Math.PI * 2)));
  }
  return { nx: hx, ny: hy, ndir, dados: H };
}

// ---- o cozedor
// pedeAzulejo(z, x, y) -> Promise<ArrayBuffer|null>
// cotaEmGraus(lon, lat) -> metros
async function cozeCaixa(caixa, op) {
  op = op || {};
  const passo = op.passo || 25, celula = op.classe || 8, zsolo = op.zsolo == null ? 15 : op.zsolo;
  const [lo0, la0, lo1, la1] = caixa;
  const mlat = 110540, mlon = 111320 * Math.cos((la0 + la1) / 2 * Math.PI / 180);
  const larg = (lo1 - lo0) * mlon, alt = (la1 - la0) * mlat;
  const nx = Math.round(larg / passo) + 1, ny = Math.round(alt / passo) + 1;
  const mx = Math.round(larg / celula), my = Math.round(alt / celula);
  const aviso = op.aviso || (() => {});

  aviso('relevo');
  const Z = new Float32Array(nx * ny);
  let z0 = 1e9, z1 = -1e9;
  for (let j = 0; j < ny; j++) {
    const la = la1 - (la1 - la0) * j / (ny - 1);
    for (let i = 0; i < nx; i++) {
      const lo = lo0 + (lo1 - lo0) * i / (nx - 1);
      const z = op.cotaEmGraus(lo, la);
      Z[j * nx + i] = z;
      if (z < z0) z0 = z; if (z > z1) z1 = z;
    }
  }
  if (!(z1 - z0 > 1)) throw new Error('a caixa nao apanhou relevo');

  aviso('carta do solo');
  const classe = new Uint8Array(mx * my);
  const rotas = [], curvas = [], curvasAlt = [], pontos = [];
  const caminhos = [], caminhosTipo = [];
  const x0 = lon2x(lo0, zsolo), x1 = lon2x(lo1, zsolo);
  const y0 = lat2y(la1, zsolo), y1 = lat2y(la0, zsolo);
  const vistos = new Set();
  for (let tx = x0; tx <= x1; tx++) {
    for (let ty = y0; ty <= y1; ty++) {
      let buf;
      try { buf = await op.pedeAzulejo(zsolo, tx, ty); } catch (e) { buf = null; }
      if (!buf) continue;
      let cam;
      try { cam = leMVT(buf); } catch (e) { continue; }
      const w = x2lon(tx, zsolo), e = x2lon(tx + 1, zsolo);
      const n = y2lat(ty, zsolo), s = y2lat(ty + 1, zsolo);
      const emGraus = (c, ext) => c.map(([px, py]) => [w + px / ext * (e - w), n + py / ext * (s - n)]);
      const aplica = (nome, fn) => {
        const c = cam[nome]; if (!c) return;
        for (const f of c.feicoes) fn(f, c.ext);
      };
      aplica('solo', (f, ext) => {
        if (f.gtipo !== 3) return;
        const cc = f.props.c;
        const cod = cc != null ? +cc : (TAB_G[f.props.g] || 0);
        if (!cod) return;
        pintaPol(classe, mx, my, caixa, aneisMVT(f.geom).map((a) => emGraus(a, ext)), cod);
      });
      aplica('aguaA', (f, ext) => {
        if (f.gtipo !== 3) return;
        pintaPol(classe, mx, my, caixa, aneisMVT(f.geom).map((a) => emGraus(a, ext)), 9);
      });
      const linhas = (f, ext, destino, extra, tipo) => {
        if (f.gtipo !== 2) return;
        for (const a of aneisMVT(f.geom)) {
          if (a.length < 2) continue;
          const g = emGraus(a, ext);
          const ch = g[0][0].toFixed(5) + ',' + g[0][1].toFixed(5) + ',' + g.length;
          if (vistos.has(ch)) continue;
          vistos.add(ch);
          const l = new Float32Array(g.length * 2);
          for (let k = 0; k < g.length; k++) { l[k * 2] = g[k][0]; l[k * 2 + 1] = g[k][1]; }
          destino.push(l);
          if (tipo !== undefined) caminhosTipo.push(tipo, 0);
          if (extra) extra.push(+f.props.alt || 0, f.props.g ? 1 : 0);
        }
      };
      aplica('rotas', (f, ext) => linhas(f, ext, rotas, null));
      aplica('caminhos', (f, ext) => {
        const t = TIPO_CAM[f.props.t];
        linhas(f, ext, caminhos, null, t === undefined ? 3 : t);
      });
      aplica('curvas', (f, ext) => linhas(f, ext, curvas, curvasAlt));
      aplica('pontos', (f, ext) => {
        if (f.gtipo !== 1) return;
        const k = f.props.k || 'info', nm = (f.props.n || '').trim();
        if (!nm) return;
        for (const a of aneisMVT(f.geom)) for (const g of emGraus(a, ext)) {
          if (g[0] < lo0 || g[0] > lo1 || g[1] < la0 || g[1] > la1) continue;
          const ch = 'p' + g[0].toFixed(5) + g[1].toFixed(5) + nm;
          if (vistos.has(ch)) continue;
          vistos.add(ch);
          pontos.push({ k, nome: nm, lo: g[0], la: g[1], alt: +f.props.alt || 0 });
        }
      });
    }
  }

  // Corredor sem vegetacao: bit 7, a classe fica. Em TODOS -- percursos,
  // nacionais, estradas, estradoes, caminhos e trilhos -- cada um com a sua
  // largura. Onde se anda nao cresce mato, e e por isso que o caminho se ve.
  const kx = mx / (lo1 - lo0), ky = my / (la1 - la0);
  const abre = (linhasG, raio) => {
    if (!(raio > 0)) return;
    const rx = Math.max(1, Math.round(raio / (larg / mx)));
    const ry = Math.max(1, Math.round(raio / (alt / my)));
    for (const l of linhasG) {
      const n = l.length / 2;
      for (let i = 0; i + 1 < n; i++) {
        const ax = l[i*2], ay = l[i*2+1], bx = l[i*2+2], by = l[i*2+3];
        const dx = (bx - ax) * kx, dy = (by - ay) * ky;
        const ps = Math.ceil(Math.max(Math.abs(dx), Math.abs(dy)) * 2) + 1;
        for (let k = 0; k <= ps; k++) {
          const u = k / ps;
          const cx = Math.round((ax + (bx - ax) * u - lo0) * kx);
          const cy = Math.round((ay + (by - ay) * u - la0) * ky);
          for (let jj = Math.max(0, cy - ry); jj <= Math.min(my - 1, cy + ry); jj++)
            for (let ii = Math.max(0, cx - rx); ii <= Math.min(mx - 1, cx + rx); ii++) {
              const o = jj * mx + ii;
              if ((classe[o] & 127) !== 9) classe[o] |= 128;
            }
        }
      }
    }
  };
  abre(op.rotas || rotas, op.corredor == null ? 9 : op.corredor);
  for (let t = 0; t < CAMINHOS.length; t++)
    abre(caminhos.filter((_, i) => caminhosTipo[i * 2] === t), CAMINHOS[t].limpo);

  let hori = null;
  if (op.horizonte !== false) {
    aviso('sombra');
    hori = mapaHorizonte(Z, nx, ny, larg / (nx - 1), alt / (ny - 1),
                         op.ndir || 16, op.alcance || 4000, op.saltoHorizonte || 2);
  }

  const cotas = new Uint16Array(nx * ny);
  for (let k = 0; k < cotas.length; k++) cotas[k] = Math.round((Z[k] - z0) / (z1 - z0) * 65535);
  const T = { versao: 2, blocos: ['COZIDO'], lo0, la0, lo1, la1, nx, ny, passo, z0, z1,
              mx, my, passoC: celula, cotas, classe, rotas,
              caminhos, caminhosTipo: new Int16Array(caminhosTipo),
              curvas, curvasAlt: new Int16Array(curvasAlt), pontos, hori, altv: null,
              mlat, mlon, larg, alt };
  T.cota = (i, j) => T.z0 + T.cotas[j * T.nx + i] / 65535 * (T.z1 - T.z0);
  T.cotaEm = (x, y) => {
    const fx = Math.min(T.nx - 1.001, Math.max(0, x / T.larg * (T.nx - 1)));
    const fy = Math.min(T.ny - 1.001, Math.max(0, (T.alt - y) / T.alt * (T.ny - 1)));
    const i = fx | 0, j = fy | 0, u = fx - i, v = fy - j;
    const a = T.cota(i, j), b = T.cota(i + 1, j), c = T.cota(i, j + 1), e = T.cota(i + 1, j + 1);
    return (a * (1 - u) + b * u) * (1 - v) + (c * (1 - u) + e * u) * v;
  };
  T.emM = (lo, la) => [(lo - T.lo0) * T.mlon, (la - T.la0) * T.mlat];
  T.emLL = (x, y) => [T.lo0 + x / T.mlon, T.la0 + y / T.mlat];
  return T;
}

if (typeof module !== 'undefined') Object.assign(module.exports,
  { cozeCaixa, leMVT, aneisMVT, mapaHorizonte });

// ===========================================================================
// TRILHOS: a base de dados, os meus, e o que se sabe de cada um
// ===========================================================================

// polilinha codificada (o mesmo formato que a aplicacao ja usa nos percursos)
function descodificaPoly(s) {
  const pts = []; let i = 0, la = 0, lo = 0;
  while (i < s.length) {
    let r = 0, sh = 0, b;
    do { b = s.charCodeAt(i++) - 63; r |= (b & 31) << sh; sh += 5; } while (b >= 32);
    la += (r & 1) ? ~(r >> 1) : (r >> 1);
    r = 0; sh = 0;
    do { b = s.charCodeAt(i++) - 63; r |= (b & 31) << sh; sh += 5; } while (b >= 32);
    lo += (r & 1) ? ~(r >> 1) : (r >> 1);
    pts.push([la / 1e5, lo / 1e5]);
  }
  return pts;
}

// GPX: so o que interessa -- os pontos, a altitude se vier, e a hora se vier.
// Nada de XML parser a serio: um ficheiro de GPS e sempre a mesma coisa.
function leGPX(texto) {
  const doc = new DOMParser().parseFromString(texto, 'application/xml');
  if (doc.querySelector('parsererror')) throw new Error('o ficheiro nao e um GPX valido');
  const nome = (doc.querySelector('trk > name, rte > name, metadata > name') || {}).textContent;
  const pts = [];
  const nos = doc.querySelectorAll('trkpt, rtept');
  for (const n of nos) {
    const la = parseFloat(n.getAttribute('lat')), lo = parseFloat(n.getAttribute('lon'));
    if (!isFinite(la) || !isFinite(lo)) continue;
    const e = n.querySelector('ele'), t = n.querySelector('time');
    pts.push({ la, lo,
      z: e ? parseFloat(e.textContent) : null,
      t: t ? Date.parse(t.textContent) : null });
  }
  if (pts.length < 2) throw new Error('o GPX nao tem pontos a que se chame um trilho');
  return { nome: (nome || '').trim() || 'Trilho importado', pts };
}

const RAIO_T = 6371000;
function metros(a, b) {
  const f = Math.PI / 180;
  const dla = (b.la - a.la) * f, dlo = (b.lo - a.lo) * f;
  const m = Math.cos((a.la + b.la) / 2 * f);
  return RAIO_T * Math.hypot(dla, dlo * m);
}

// O que se sabe de um trilho. A cota vem do GPS quando ele a traz e do terreno
// quando nao traz -- e diz-se qual foi, porque um GPS de telemovel erra 15 m
// na vertical com facilidade e o terreno nao erra nada dessa maneira.
// Um GPS de relogio grava um ponto por segundo, e cada ponto treme uns
// metros. Somar essas tremuras da 30% de distancia a mais: o trilho do Javali
// Inferno (19/09/2026) dava 18,6 km em bruto; o relogio dizia 14,9; com um
// passo minimo de 5 m entre pontos guardados da 14,7. O passo e 5 m porque e
// o que o relogio proprio usa, a menos de 1%. A ordem e os tempos ficam.
function simplificaTrilho(pts, passo) {
  passo = passo || 5;
  if (!pts || pts.length < 3) return pts || [];
  const out = [pts[0]];
  for (let i = 1; i < pts.length - 1; i++)
    if (metros(out[out.length - 1], pts[i]) >= passo) out.push(pts[i]);
  out.push(pts[pts.length - 1]);
  return out;
}

function medeTrilho(T, pts, op) {
  op = op || {};
  const brutos = pts ? pts.length : 0;
  pts = simplificaTrilho(pts, op.passo || 5);
  const n = pts.length;
  if (n < 2) return null;
  const doGPS = op.cotaDoGPS !== false && pts.some((p) => p.z != null);
  const z = new Float64Array(n);
  for (let i = 0; i < n; i++) {
    if (doGPS && pts[i].z != null) z[i] = pts[i].z;
    else if (T) { const m = T.emM(pts[i].lo, pts[i].la); z[i] = T.cotaEm(m[0], m[1]); }
    else z[i] = 0;
  }
  // Alisar antes de contar subida: sem isto o ruido do GPS inventa centenas de
  // metros de desnivel que nunca se subiram. Mas a janela tem de ser
  // proporcional -- com 4 fixos, um trilho de tres pontos ficava todo na media
  // e dava zero de subida.
  const zs = new Float64Array(n);
  const J = Math.max(0, Math.min(4, Math.floor(n / 8)));
  for (let i = 0; i < n; i++) {
    let s = 0, c = 0;
    for (let k = Math.max(0, i - J); k <= Math.min(n - 1, i + J); k++) { s += z[k]; c++; }
    zs[i] = s / c;
  }
  // Subida acumulada com HISTERESE, nao com um limiar por amostra. Com o
  // limiar por amostra, um trilho de 400 pontos a subir 300 m sobe 0,75 m de
  // cada vez -- fica tudo abaixo do limiar e a conta dava 207 em vez de 300.
  // A histerese compara com o ultimo extremo marcado: o ruido nao passa, a
  // rampa passa inteira.
  const LIMIAR = 3;
  let dist = 0, sobe = 0, desce = 0, zmin = 1e9, zmax = -1e9, ref = zs[0];
  const acum = new Float64Array(n);
  for (let i = 0; i < n; i++) {
    if (i) dist += metros(pts[i - 1], pts[i]);
    acum[i] = dist;
    const d = zs[i] - ref;
    if (d > LIMIAR) { sobe += d; ref = zs[i]; }
    else if (d < -LIMIAR) { desce += -d; ref = zs[i]; }
    if (zs[i] < zmin) zmin = zs[i];
    if (zs[i] > zmax) zmax = zs[i];
  }
  const t0 = pts[0].t, t1 = pts[n - 1].t;
  const dur = (t0 && t1 && t1 > t0) ? (t1 - t0) / 1000 : null;
  let dentro = 0;
  if (T) for (const p of pts)
    if (p.lo >= T.lo0 && p.lo <= T.lo1 && p.la >= T.la0 && p.la <= T.la1) dentro++;
  return {
    pontos: brutos, km: dist / 1000, sobe: Math.round(sobe), desce: Math.round(desce),
    zmin: Math.round(zmin), zmax: Math.round(zmax),
    cotaDe: doGPS ? 'GPS' : 'terreno',
    dur, vel: dur ? (dist / 1000) / (dur / 3600) : null,
    dentro: T ? dentro / n : null,
    z: zs, acum,
  };
}

// Quanto do trilho esta ao sol a esta hora. E a pergunta que da nome a
// aplicacao, e aqui responde-se com o mapa de horizonte que ja esta cozido:
// para cada ponto, compara-se a altura do sol com a altura a que o monte tapa
// o ceu naquela direccao.
// op.horaPropria: um trilho GRAVADO tem a hora de cada ponto, e a pergunta
// certa e "quanto dele andei ao sol", nao "quanto estaria ao sol as 15:05".
// Cada ponto usa a sua hora (o sol calcula-se por minuto, para nao repetir
// a conta 20 000 vezes). Sem horas, ou sem a opcao, vale a hora dada.
function solNoTrilho(T, pts, quando, op) {
  if (!T || !T.hori) return null;
  op = op || {};
  const laC = (T.la0 + T.la1) / 2, loC = (T.lo0 + T.lo1) / 2;
  const H = T.hori, nd = H.ndir;
  const porPonto = !!(op.horaPropria && pts.some((p) => p.t));
  const cache = new Map();
  const solEm = (ms) => {
    const k = Math.floor(ms / 60000);
    let s = cache.get(k);
    if (!s) { s = posicaoSol(new Date(k * 60000), laC, loC); cache.set(k, s); }
    return s;
  };
  const sFixo = posicaoSol(quando, laC, loC);
  const marca = new Uint8Array(pts.length);
  let ao = 0, dentro = 0, t0 = null, t1 = null;
  for (let i = 0; i < pts.length; i++) {
    const p = pts[i];
    if (p.lo < T.lo0 || p.lo > T.lo1 || p.la < T.la0 || p.la > T.la1) { marca[i] = 2; continue; }
    dentro++;
    const s = porPonto && p.t ? solEm(p.t) : sFixo;
    if (porPonto && p.t) { if (t0 == null || p.t < t0) t0 = p.t; if (t1 == null || p.t > t1) t1 = p.t; }
    if (s.alt <= 0) { marca[i] = 0; continue; }
    const f = ((s.az % 360) + 360) % 360 / 360 * nd;
    const l0 = Math.floor(f) % nd, l1 = (l0 + 1) % nd, t = f - Math.floor(f);
    const m = T.emM(p.lo, p.la);
    const i0 = Math.min(H.nx - 1, Math.max(0, Math.round(m[0] / T.larg * (H.nx - 1))));
    const j0 = Math.min(H.ny - 1, Math.max(0, Math.round((T.alt - m[1]) / T.alt * (H.ny - 1))));
    const a0 = H.dados[l0 * H.nx * H.ny + j0 * H.nx + i0] / 2;
    const a1 = H.dados[l1 * H.nx * H.ny + j0 * H.nx + i0] / 2;
    const h = a0 * (1 - t) + a1 * t;
    if (s.alt > h) { marca[i] = 1; ao++; }
  }
  return { sol: sFixo, marca, pct: dentro ? 100 * ao / dentro : 0, dentro, porPonto, t0, t1 };
}

// Quanto do trilho vai debaixo de arvores. O mapa de horizonte so sabe do
// monte; a copa e outra sombra, e num vale de vidoeiros e a que conta. Vem
// da altura medida (>= 5 m) onde ha, senao da classe (montado/floresta).
function copaNoTrilho(T, pts) {
  if (!T || !T.classe) return null;
  const mx = T.mx, my = T.my;
  let sob = 0, dentro = 0;
  for (const p of pts) {
    if (p.lo < T.lo0 || p.lo > T.lo1 || p.la < T.la0 || p.la > T.la1) continue;
    dentro++;
    const m = T.emM(p.lo, p.la);
    const i = Math.min(mx - 1, Math.max(0, Math.floor(m[0] / T.larg * mx)));
    const j = Math.min(my - 1, Math.max(0, Math.floor((T.alt - m[1]) / T.alt * my)));
    const k = j * mx + i, c = T.classe[k] & 127;
    const arv = T.altv ? T.altv[k] >= 50 : (c === 4 || c === 5);
    if (arv) sob++;
  }
  return { pct: dentro ? 100 * sob / dentro : 0, dentro, medida: !!T.altv };
}

// ------------------------------------------------- tempo a andar
// A classe do chao no ponto (a zona que o contem, entre varias). Se ha
// corredor de caminho ate ~10 m ao lado, e por ele que se anda: o tracado
// (GPS ou base de dados) anda uns metros ao lado do corredor cozido.
function classeEm(Ts, lo, la) {
  for (const T of Ts) {
    if (!T.classe || lo < T.lo0 || lo > T.lo1 || la < T.la0 || la > T.la1) continue;
    const m = T.emM(lo, la);
    const i = Math.min(T.mx - 1, Math.max(0, Math.floor(m[0] / T.larg * T.mx)));
    const j = Math.min(T.my - 1, Math.max(0, Math.floor((T.alt - m[1]) / T.alt * T.my)));
    const c = T.classe[j * T.mx + i];
    if (c & 128) return c;
    const r = Math.max(1, Math.round(10 / (T.larg / T.mx)));
    for (let dj = -r; dj <= r; dj++) for (let di = -r; di <= r; di++) {
      const ii = i + di, jj = j + dj;
      if (ii < 0 || jj < 0 || ii >= T.mx || jj >= T.my) continue;
      if (T.classe[jj * T.mx + ii] & 128) return c | 128;
    }
    return c;
  }
  return -1;
}
// tipo de chao para andar: [nome, factor sobre a velocidade de Tobler]
const CHAO_ANDAR = {
  caminho: ['caminho, estrada ou trilho marcado', 1.0], urbano: ['povoação / campo agrícola', 1.0],
  erva: ['erva, pastagem ou chão nu', 0.85], humida: ['zona húmida / lameiro', 0.7], rasteiro: ['mato rasteiro', 0.8],
  matagal: ['matagal alto (giesta, urze alta)', 0.55], arv: ['floresta aberta', 0.8], mata: ['floresta densa', 0.7],
  rocha: ['blocos de rocha', 0.6], parede: ['escarpa / parede', 0.4], agua: ['água', 0.5], ardido: ['chão ardido recente', 0.75], fora: ['fora do mapa', 0.85],
};
function tipoChao(c) {
  if (c < 0) return 'fora';
  if (c & 128) return 'caminho';
  return { 0: 'erva', 1: 'urbano', 2: 'urbano', 3: 'erva', 4: 'arv', 5: 'mata', 6: 'rasteiro', 7: 'rocha', 8: 'parede', 9: 'agua', 10: 'erva', 11: 'matagal', 12: 'humida', 13: 'ardido' }[c & 127] || 'erva';
}
// Tempo a andar: Tobler pela inclinacao de cada troco, vezes o factor do chao
// lido do mapa, menos 4% por 300 m acima dos 1200 m. Sem paragens. Devolve
// tambem o acumulado por ponto (ps, acum em m, tempos em s) para se saber
// quanto falta a partir de um sitio.
function estimaTempo(Ts, pts, e) {
  const ps = simplificaTrilho(pts, 5);          // os mesmos pontos que medeTrilho usou (e.z alinha)
  const zs = e.z, n = Math.min(ps.length, zs.length);
  const soma = {}; let total = 0, m = 0;
  const acum = new Float64Array(n), tempos = new Float64Array(n);
  for (let i = 1; i < n; i++) {
    const d = metros(ps[i - 1], ps[i]);
    acum[i] = acum[i - 1] + (d > 0 ? d : 0);
    if (!(d > 0)) { tempos[i] = tempos[i - 1]; continue; }
    const s = (zs[i] - zs[i - 1]) / d;
    let v = 6 * Math.exp(-3.5 * Math.abs(s + 0.05));                 // km/h, Tobler
    const c = classeEm(Ts, (ps[i - 1].lo + ps[i].lo) / 2, (ps[i - 1].la + ps[i].la) / 2);
    const tipo = tipoChao(c);
    v *= CHAO_ANDAR[tipo][1];
    const zm = (zs[i] + zs[i - 1]) / 2;
    if (zm > 1200) v *= Math.max(0.7, 1 - 0.04 * (zm - 1200) / 300);
    const seg = d / (v / 3.6);
    (soma[tipo] = soma[tipo] || { nome: CHAO_ANDAR[tipo][0], m: 0, s: 0 }); soma[tipo].m += d; soma[tipo].s += seg;
    total += seg; m += d; tempos[i] = tempos[i - 1] + seg;
  }
  const linhas = Object.values(soma).sort((a, b) => b.m - a.m);
  return { total, m, n: n - 1, linhas, ps: ps.slice(0, n), acum, tempos };
}
// O que falta a partir de um sitio (lo, la): o ponto do trilho mais perto,
// se estiver a menos de `raio` m; senao null.
function faltaDesde(est, lo, la, raio) {
  let k = -1, dm = raio || 300;
  for (let i = 0; i < est.ps.length; i++) { const d = metros(est.ps[i], { lo, la }); if (d < dm) { dm = d; k = i; } }
  if (k < 0) return null;
  return { m: est.m - est.acum[k], s: est.total - est.tempos[k], desvio: dm, i: k };
}

if (typeof module !== 'undefined') Object.assign(module.exports,
  { descodificaPoly, leGPX, medeTrilho, solNoTrilho, copaNoTrilho, simplificaTrilho, metros, setasLinhas, estimaTempo, faltaDesde, classeEm });

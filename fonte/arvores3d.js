// ===========================================================================
// Arvores em 3D, instanciadas -- camada propria do MapLibre (WebGL directo)
// ---------------------------------------------------------------------------
// Um so modelo de arvore, 40 triangulos, desenhado N vezes numa unica chamada
// de desenho (instancing). 30 000 arvores custam o mesmo que uma em numero de
// chamadas; o que cresce e so o buffer de instancias.
//
// Nao usa three.js. Sao ~13 KB de codigo contra ~600 KB de biblioteca, e a
// biblioteca faria exactamente isto por baixo.
//
// AS TRES COISAS QUE VEM DO DADO, E A QUE NAO VEM
//
//   onde   as arvores nascem dentro dos poligonos de floresta (COS n1=5) e de
//          montado (n1=4). Fora deles nao ha nenhuma. Nunca uma arvore em cima
//          de rocha, de pastagem ou de agua; os buracos do poligono contam.
//   quantas  densidade tirada da cobertura de copa 'd' da mancha, pela relacao
//          de Poisson  lambda = -ln(1 - d/100) / (pi * r^2).  Nao e um numero
//          escolhido a olho: e quantas copas de raio r sao precisas para tapar
//          d% do chao. Montado a 30% da ~45 arvores/ha, pinhal a 70% da ~430.
//   que altura  'h' da mancha, com variacao por arvore. Cada uma tem a sua, e
//          assenta na cota do seu proprio ponto -- a copa acompanha a encosta.
//
//   QUAL  a especie desenhada (copa de cone ou copa redonda) NAO vem do dado.
//          A COS ao nivel 1 nao distingue pinhal de carvalhal. A forma e
//          decorativa e sorteada por posicao; a altura e a densidade sao dado.
//
// E 'd'/'h' so sao medidos onde ha LiDAR (ver cos_extrai.py --chm). Onde nao
// ha, sao valores por defeito da classe e a mancha traz m=0. A legenda tem de
// dizer "modelado", como o resto do projecto ja faz com as cotas.
//
// COMO SE DESENHA LONGE SEM MATAR O TELEMOVEL
//
// A primeira versao punha arvores num circulo de 800 m a volta do centro do
// mapa. Com o ecra inclinado isso da uma FAIXA: o chao ali a frente e as
// serras ao fundo ficam os dois fora do circulo, e nao tinham arvore nenhuma.
// Foi o que ele apanhou, e tinha razao.
//
// Agora ha tres niveis, por distancia. A grelha de pontos e sempre a mesma, e
// os niveis sao sub-grelhas dela: o nivel 0 sao os pontos de 9 em 9, o nivel 1
// os de 3 em 3, o nivel 2 todos. Por isso o nivel 0 esta contido no 1, que
// esta contido no 2 -- aproximar ACRESCENTA arvores, nunca troca uma por
// outra. E o que faz a transicao nao piscar. Cada arvore traz o seu nivel e e
// o shader que a encolhe ate desaparecer no limite do nivel dela, em vez de a
// cortar de repente.
// ===========================================================================

function ligaArvores(map, op) {
  op = op || {};
  // O zoom nao e um interruptor: e uma rampa. Semeia-se a partir de ZSEM e as
  // arvores CRESCEM do chao entre ZOOM0 e ZOOM1, em vez de aparecerem todas de
  // uma vez ao passar uma linha. Era o que se via: "so aparecem ao fazer zoom".
  const ZSEM = op.zoomSemeia == null ? 13.8 : op.zoomSemeia;
  const ZOOM0 = op.zoom0 == null ? 14.0 : op.zoom0;
  const ZOOM1 = op.zoom1 == null ? 15.4 : op.zoom1;
  // limite de cada nivel, em metros: [todos, de 3 em 3, de 9 em 9]
  // Quatro aneis, e as contas feitas antes de escrever. Pinhal cerrado sao
  // ~430 arvores/ha e a serra tem uns 30% de floresta:
  //
  //      0- 300 m   todos os pontos       3 613 arvores
  //    300- 900 m   de 3 em 3 (1/9)       3 212
  //    900-2500 m   de 9 em 9 (1/81)      2 696
  //   2500-7000 m   de 27 em 27 (1/729)   2 354
  //                                 TOTAL 11 876, tecto 14 000
  //
  // Chegar aos SETE quilometros custa praticamente o mesmo que chegar a tres:
  // as arvores ao longe sao poucas porque a grelha delas e grossa. O que custa
  // e o anel de perto -- e era esse que estava a comer o tecto todo, deixando
  // uma faixa de arvores a meio do ecra e nada para la dela.
  const DIST = op.dist || [300, 900, 2500, 7000];   // so historico: ver limites()
  // O tecto de 14 000 vinha de quando semear custava caro e corria a cada
  // fotograma. Isso acabou: as celulas estao guardadas e durante o arrasto nao
  // se constroi nada. O que sobra e desenho, e 40 000 arvores sao 1,8 milhoes
  // de triangulos numa so chamada -- coisa que qualquer telemovel destes faz
  // sem dar por ela. O vigia continua la para o caso de eu estar enganado.
  let TECTO = op.tecto == null ? 40000 : op.tecto;
  const ORCAMENTO = op.orcamento == null ? 400 : op.orcamento; // celulas novas por passagem
  const GRELHA = 3.0;                                  // m: passo da grelha base
  const FUNDO = op.fundo || [0.86, 0.86, 0.80];        // cor para onde desmaia

  // --- o que cada grupo e, em arvore -------------------------------------
  // c = digito de nivel 1 da COS. 5 floresta, 4 sistemas agro-florestais.
  // k = raio de copa / altura da arvore, medido em povoamentos reais:
  //   pinheiro bravo de 14 m tem copa de 5 a 6 m de diametro  -> k ~ 0.21
  //   sobreiro de 8 m tem copa de 10 a 14 m de diametro       -> k ~ 0.70
  const ESPECIE = {
    5: { h: 14, d: 70, k: 0.21, conifera: 0.62 },  // floresta
    4: { h:  8, d: 30, k: 0.70, conifera: 0.0 },   // montado: copa larga, esparsa
  };

  // ---------------------------------------------------------------- a cota
  // Nesta versao do MapLibre o z que a custom layer recebe NAO e altitude
  // absoluta: e altitude relativa a cota do centro do mapa, ja multiplicada
  // pelo exagero do relevo. Medido: com o centro a 565 m e exagero 1,3, o
  // transform diz elevation = 732,5 e queryTerrainElevation devolve 0 no
  // centro, +103,6 num ponto 84 m mais alto (84 x 1,3 = 109) e -106,9 num
  // ponto 83 m mais baixo. Bate.
  //
  // Por isso a cota nao se calcula por fora -- pergunta-se ao mapa, que e
  // quem manda no referencial. Guarda-se a cota ABSOLUTA por arvore e tira-se
  // a referencia no shader, com um uniform lido a cada fotograma: senao as
  // arvores flutuavam durante o arrasto, quando o centro muda e o buffer
  // ainda e o de antes.
  const refMapa = () => {
    const e = map.transform && map.transform.elevation;
    return typeof e === 'number' && isFinite(e) ? e : 0;
  };
  function chaoAbs(lon, lat) {
    if (!map.getTerrain || !map.getTerrain()) return 0;      // sem relevo, plano
    const e = map.queryTerrainElevation({ lng: lon, lat: lat });
    return e == null || !isFinite(e) ? 0 : e + refMapa();
  }

  // ------------------------------------------------------------------ malha
  function malha() {
    const SEG = 7, T = [0.0, 0.30, 0.62, 1.0], V = [];
    // Bossa por (lado, anel): e o que da a copa aos bocados do desenho de
    // poucos poligonos, em vez de um cone liso de torno. Tem de ser funcao so
    // do indice, e i=SEG tem de dar o mesmo que i=0, senao a copa abre.
    const bossa = (i, r) => {
      const k = ((i % SEG) * 7919 + r * 104729) % 1000;
      return 0.74 + (k / 1000) * 0.52;
    };
    const anel = (i, r) => {
      const a = (i / SEG) * Math.PI * 2;
      return [Math.cos(a), Math.sin(a), T[r], 0, bossa(i, r)];
    };
    for (let r = 0; r < T.length - 1; r++) {
      for (let i = 0; i < SEG; i++) {
        const a = anel(i, r), b = anel(i + 1, r);
        const c = anel(i, r + 1), d = anel(i + 1, r + 1);
        V.push(...a, ...b, ...d);
        V.push(...a, ...d, ...c);
      }
    }
    // tronco: duas chapas cruzadas (4 triangulos) -- chega, e ve-se de todos os lados
    for (const e of [[1, 0], [0, 1]]) {
      const [ux, uy] = e;
      V.push(-ux, -uy, 0, 1, 1, ux, uy, 0, 1, 1, ux, uy, 1, 1, 1);
      V.push(-ux, -uy, 0, 1, 1, ux, uy, 1, 1, 1, -ux, -uy, 1, 1, 1);
    }
    return new Float32Array(V);   // 5 floats/vertice: ux, uy, t, parte, bossa
  }
  const MALHA = malha(), NVERT = MALHA.length / 5;

  const VS = `
    attribute vec4 aV;        // ux, uy, t, parte(0=copa 1=tronco)
    attribute float aBossa;   // irregularidade da copa, fixa por vertice
    attribute vec3 aPos;      // mercator x, y, e cota absoluta em metros
    attribute vec4 aArv;      // altura(m), raio(m), forma(0 cone..1 bola), rodar
    attribute vec3 aTom;      // cor da copa
    attribute float aNiv;     // 0 = ve-se ao longe, 2 = so ao perto
    uniform mat4 uM;
    uniform float uEsc;       // metros -> unidades mercator
    uniform float uRef;       // cota do centro do mapa, em metros (referencial)
    uniform vec2 uCentro;     // mercator
    uniform vec4 uDist;       // alcance de cada nivel, em metros
    uniform float uZoom;      // 0 = ainda nao se ve, 1 = tamanho inteiro
    varying vec3 vCor;
    varying float vLuz;
    varying float vFade;
    void main() {
      float alt = aArv.x, raio = aArv.y, forma = aArv.z, rot = aArv.w;
      float t = aV.z;
      vec3 p; vec3 nrm;
      if (aV.w < 0.5) {
        // copa: perfil entre cone (1-t) e bola, conforme a forma, aos bocados
        float cone = pow(1.0 - t, 0.85);
        float bola = sqrt(max(0.0, 1.0 - pow(abs(2.0 * t - 1.0), 2.2)));
        float r = mix(cone, bola, forma) * aBossa;
        float base = mix(0.30, 0.34, forma) * alt;        // onde a copa comeca
        p = vec3(aV.xy * r * raio, base + t * (alt - base));
        nrm = normalize(vec3(aV.xy * mix(1.0, 1.6, forma), mix(0.75, 0.45, forma)));
      } else {
        // tronco: raio a serio, nao um poste (14 m de pinheiro = ~20 cm de raio)
        float rt = max(0.09, 0.016 * alt);
        p = vec3(aV.xy * rt, t * mix(0.34, 0.40, forma) * alt);
        nrm = vec3(aV.xy, 0.0);
      }
      float s = sin(rot), c = cos(rot);
      p.xy = vec2(p.x * c - p.y * s, p.x * s + p.y * c);
      nrm.xy = vec2(nrm.x * c - nrm.y * s, nrm.x * s + nrm.y * c);

      // Distancia ao centro, em metros. Cada nivel tem o seu alcance e a
      // arvore MURCHA ate ao chao no fim do dela, em vez de desaparecer de
      // repente: uma arvore que encolhe nao se ve a sair, uma que se apaga ve-se.
      float dm = length(aPos.xy - uCentro) / uEsc;
      float lim = aNiv < 0.5 ? uDist.w : (aNiv < 1.5 ? uDist.z : (aNiv < 2.5 ? uDist.y : uDist.x));
      float murcha = (1.0 - smoothstep(lim * 0.86, lim, dm)) * uZoom;
      p *= murcha;

      // sol de noroeste a 45 graus. Em mercator o norte e -y.
      vec3 sol = normalize(vec3(-0.55, -0.45, 0.70));
      float lam = max(0.0, dot(normalize(nrm), sol));
      // ceu por cima a levantar o que fica a sombra: sem isto o lado escuro da
      // copa fica preto e a mancha le-se como um borrao, nao como arvores.
      float ceu = 0.5 + 0.5 * normalize(nrm).z;
      vLuz = 0.46 + 0.42 * lam + 0.18 * ceu;
      vCor = aV.w < 0.5 ? aTom : vec3(0.46, 0.36, 0.26);
      vFade = clamp((dm - uDist.y) / max(1.0, uDist.w - uDist.y), 0.0, 1.0);
      gl_Position = uM * vec4(vec3(aPos.xy, (aPos.z - uRef) * uEsc) + p * uEsc, 1.0);
    }`;

  const FS = `
    precision mediump float;
    uniform vec3 uFundo;
    varying vec3 vCor; varying float vLuz; varying float vFade;
    void main() {
      vec3 c = vCor * vLuz;
      gl_FragColor = vec4(mix(c, uFundo, vFade * 0.80), 1.0);
    }`;

  // -------------------------------------------------------------- geometria
  const CIRC = 40075016.685578488;
  const escala = (lat) => 1 / (CIRC * Math.cos(lat * Math.PI / 180));
  const merc = (lon, lat) => [
    (180 + lon) / 360,
    (180 - (180 / Math.PI) * Math.log(Math.tan(Math.PI / 4 + lat * Math.PI / 360))) / 360,
  ];

  // ruido determinista: a mesma celula da sempre a mesma arvore, por isso nada
  // salta quando se arrasta o mapa.
  function baralha(a, b, s) {
    let h = (a * 374761393 + b * 668265263 + s * 2246822519) | 0;
    h = (h ^ (h >>> 13)) * 1274126177 | 0;
    return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
  }

  function dentro(anel, x, y) {
    let d = false;
    for (let i = 0, j = anel.length - 1; i < anel.length; j = i++) {
      const xi = anel[i][0], yi = anel[i][1], xj = anel[j][0], yj = anel[j][1];
      if ((yi > y) !== (yj > y) && x < (xj - xi) * (y - yi) / (yj - yi) + xi) d = !d;
    }
    return d;
  }
  function dentroPol(pol, x, y) {
    if (!dentro(pol[0], x, y)) return false;
    for (let i = 1; i < pol.length; i++) if (dentro(pol[i], x, y)) return false;
    return true;   // buracos contam: uma clareira nao leva arvores
  }

  // ------------------------------------------------------------- as celulas
  // As arvores nascem em CELULAS FIXAS NO MUNDO (azulejos z17, ~234 m), nao
  // numa caixa a volta do centro do ecra. A celula nao se mexe quando o mapa
  // se mexe, por isso as arvores dela tambem nao; e cada uma calcula-se uma
  // vez e fica guardada, por isso andar para o lado so paga as celulas novas.
  const CELZ = 17, P2 = Math.pow(2, CELZ);
  const celulas = new Map();      // "x/y/salto" -> Float32Array, 11 por arvore
  let INST = null, nInst = 0, assinatura = '', semTerreno = false, incompleto = false, cortado = false;
  // Quando nao cabe no tecto, encolhe-se a DENSIDADE DE PERTO, nao o alcance.
  // Estava ao contrario: eu encolhia o alcance todo, e o que ficava de fora
  // era justamente o que ele queria ver -- o horizonte, que quase nao custa.
  let escDens = 1;

  const tileLon = (x) => x / P2 * 360 - 180;
  const tileLat = (y) => {
    const n = Math.PI - 2 * Math.PI * y / P2;
    return 180 / Math.PI * Math.atan(0.5 * (Math.exp(n) - Math.exp(-n)));
  };
  const lonTile = (lo) => Math.floor((lo + 180) / 360 * P2);
  const latTile = (la) => {
    const r = la * Math.PI / 180;
    return Math.floor((1 - Math.log(Math.tan(r) + 1 / Math.cos(r)) / Math.PI) / 2 * P2);
  };

  // A cota nao se pergunta arvore a arvore: a grelha e de 9x9 por celula, ou
  // seja um ponto a cada ~29 m, que e a resolucao do proprio modelo do
  // terreno. Pedir mais fino seria inventar detalhe que o DEM nao tem, e
  // custava 500 perguntas por celula em vez de 81.
  function cotasDaCelula(w, s, e, n) {
    const N = 9, g = new Float32Array(N * N);
    let faltam = 0;
    for (let j = 0; j < N; j++) {
      for (let i = 0; i < N; i++) {
        const v = chaoAbs(w + (e - w) * i / (N - 1), s + (n - s) * j / (N - 1));
        g[j * N + i] = v;
        // O ponto mais baixo de todo o modelo do terreno desta zona sao 118 m.
        // Um valor abaixo de 50 nao e uma cota baixa: e o azulejo do relevo que
        // ainda nao chegou. So contar os ZEROS deixava passar celulas
        // meio-carregadas, e daí saíam arvores ao nivel do mar -- o resumo dava
        // cotaMin 1 numa serra que comeca aos 118.
        if (v < 50) faltam++;
      }
    }
    return { g, N, todasZero: faltam > 0 };
  }
  function cotaEm(C, w, s, e, n, lo, la) {
    const fx = Math.min(C.N - 1.001, Math.max(0, (lo - w) / (e - w) * (C.N - 1)));
    const fy = Math.min(C.N - 1.001, Math.max(0, (la - s) / (n - s) * (C.N - 1)));
    const i0 = Math.floor(fx), j0 = Math.floor(fy), tx = fx - i0, ty = fy - j0;
    const a = C.g[j0 * C.N + i0], b = C.g[j0 * C.N + i0 + 1];
    const c = C.g[(j0 + 1) * C.N + i0], d = C.g[(j0 + 1) * C.N + i0 + 1];
    return (a * (1 - tx) + b * tx) * (1 - ty) + (c * (1 - tx) + d * tx) * ty;
  }

  // salto = 1, 3 ou 9: de quantos em quantos pontos da grelha se olha. Como as
  // grelhas grossas sao sub-conjuntos da fina, aproximar so ACRESCENTA arvores.
  // Cada nivel e uma sub-grelha do seguinte: os pontos de 27 em 27 estao
  // dentro dos de 9 em 9, que estao dentro dos de 3 em 3. Por isso aproximar
  // so ACRESCENTA arvores -- nunca troca uma por outra.
  const nivelDe = (i, j) =>
    (i % 27 === 0 && j % 27 === 0) ? 0 :
    (i % 9 === 0 && j % 9 === 0) ? 1 :
    (i % 3 === 0 && j % 3 === 0) ? 2 : 3;


  function fazCelula(tx, ty, salto, feats) {
    const w = tileLon(tx), e = tileLon(tx + 1);
    const n = tileLat(ty), s = tileLat(ty + 1);
    const dLat = GRELHA / 110540;
    const dLon = GRELHA / (111320 * Math.cos((n + s) / 2 * Math.PI / 180));
    const feitas = new Set(), saida = [];

    for (const f of feats) {
      const cod = f.properties.c != null ? +f.properties.c
        : ({ rocha: 5, matos: 4 })[f.properties.g] || 0;   // azulejos antigos
      const E = ESPECIE[cod]; if (!E) continue;
      const alt = +f.properties.h || E.h;
      // op.densidade so existe para ensaio: forca a mesma cobertura em tudo.
      const cob = Math.min(92, op.densidade || +f.properties.d || E.d);
      const raio = Math.max(0.8, alt * E.k);
      const lam = -Math.log(1 - cob / 100) / (Math.PI * raio * raio);   // arvores/m2
      const manter = Math.min(1, lam * GRELHA * GRELHA);
      const gs = f.geometry.type === 'Polygon' ? [f.geometry.coordinates] : f.geometry.coordinates;

      for (const pol of gs) {
        let x0 = 1e9, y0 = 1e9, x1 = -1e9, y1 = -1e9;
        for (const q of pol[0]) {
          if (q[0] < x0) x0 = q[0]; if (q[0] > x1) x1 = q[0];
          if (q[1] < y0) y0 = q[1]; if (q[1] > y1) y1 = q[1];
        }
        const cw = Math.max(x0, w), ce = Math.min(x1, e);
        const cs = Math.max(y0, s), cn = Math.min(y1, n);
        if (ce <= cw || cn <= cs) continue;
        // intervalos meio-abertos: cada ponto da grelha pertence a uma celula so
        let i0 = Math.ceil(cw / dLon), i1 = Math.ceil(ce / dLon) - 1;
        let j0 = Math.ceil(cs / dLat), j1 = Math.ceil(cn / dLat) - 1;
        i0 = Math.ceil(i0 / salto) * salto; j0 = Math.ceil(j0 / salto) * salto;
        for (let j = j0; j <= j1; j += salto) {
          for (let i = i0; i <= i1; i += salto) {
            const k = i * 8388608 + j;
            if (feitas.has(k)) continue;          // a mancha vem repartida
            const lo = (i + (baralha(i, j, 1) - 0.5) * 0.9) * dLon;
            const la = (j + (baralha(i, j, 2) - 0.5) * 0.9) * dLat;
            if (lo < w || lo >= e || la < s || la >= n) continue;
            if (!dentroPol(pol, lo, la)) continue;
            feitas.add(k);                        // dentro conta, guarde-se ou nao
            if (baralha(i, j, 3) > manter) continue;
            const hh = alt * (0.72 + 0.56 * baralha(i, j, 4));
            saida.push([lo, la, hh,
              Math.max(0.6, hh * E.k * (0.85 + 0.3 * baralha(i, j, 5))),
              baralha(i, j, 6) < E.conifera ? 0 : 1,
              baralha(i, j, 7), baralha(i, j, 8), nivelDe(i, j)]);
          }
        }
      }
    }
    if (!saida.length) return new Float32Array(0);

    const C = cotasDaCelula(w, s, e, n);
    // Se ha relevo mas o modelo do terreno ainda nao chegou a esta celula, nao
    // se guarda nada: guardar punha estas arvores ao nivel do centro do mapa
    // para sempre, porque a celula ja nao voltava a ser calculada.
    if (C.todasZero && map.getTerrain && map.getTerrain()) return null;

    const buf = new Float32Array(saida.length * 11);
    for (let t = 0; t < saida.length; t++) {
      const a = saida[t], mm = merc(a[0], a[1]), o = t * 11, tom = a[5];
      buf[o] = mm[0]; buf[o + 1] = mm[1];
      buf[o + 2] = cotaEm(C, w, s, e, n, a[0], a[1]);
      buf[o + 3] = a[2]; buf[o + 4] = a[3]; buf[o + 5] = a[4];
      buf[o + 6] = a[6] * 6.283;
      buf[o + 7] = 0.24 + 0.22 * tom;              // tom: verde-escuro a claro
      buf[o + 8] = 0.44 + 0.26 * tom;
      buf[o + 9] = 0.25 + 0.18 * tom;
      buf[o + 10] = a[7];                          // nivel
    }
    return buf;
  }

  // ------------------------------------------------------------- semear
  // soReusar: durante o arrasto nao se constroi celula nenhuma -- junta-se o
  // que ja esta guardado e pronto. Construir a meio de um movimento e o que o
  // tornava pesado e pouco responsivo; o que faltar entra quando ele larga.
  // Ate aqui os aneis estavam em METROS FIXOS, e isso estava errado de raiz.
  // Com o ecra a pique e muito aproximado ve-se 300 m de chao; deitado e
  // afastado ve-se sete quilometros. Um anel denso de 300 m e tudo no primeiro
  // caso e uma nesga invisivel no segundo -- que foi o que ele viu: arvores so
  // numa faixa, ou primeiro plano vazio.
  //
  // Os aneis passam a ser FRACCOES DO QUE SE VE. Primeiro estima-se a que
  // distancia esta o chao no cimo do ecra, a partir da escala e da inclinacao,
  // e depois reparte-se: 8% a cheio, 25% a um nono, 60% a um oitenta-e-um, e
  // 130% (para la do horizonte visivel) a um setecentos-e-vinte-e-nove.
  // E os aneis tambem nao se centram no centro do mapa. Com o ecra deitado, o
  // chao ali a frente esta LONGE do centro -- por isso o primeiro plano ficava
  // vazio enquanto o meio do ecra tinha floresta. O centro dos aneis desliza
  // do meio do ecra (a pique) para junto do fundo (deitado), que e onde ele
  // esta a olhar de perto. As fraccoes tambem mudam: a pique quer-se densidade
  // cheia em todo o ecra, deitado quer-se um degrade ate ao horizonte.
  const metros = (a, b) => {
    const k = Math.cos((a.lat + b.lat) / 2 * Math.PI / 180);
    const dy = (a.lat - b.lat) * 110540, dx = (a.lng - b.lng) * 111320 * k;
    return Math.sqrt(dx * dx + dy * dy);
  };
  function vista() {
    const cv = map.getCanvas();
    const w = (cv && cv.clientWidth) || 400, h = (cv && cv.clientHeight) || 700;
    const f = Math.min(1, (map.getPitch() || 0) / 70);
    let perto, longe;
    try {
      perto = map.unproject([w / 2, h * (0.5 + 0.45 * f)]);
      longe = map.unproject([w / 2, h * 0.15]);
    } catch (e) { perto = longe = map.getCenter(); }
    let A = metros(perto, longe);
    if (!isFinite(A) || A < 120) A = 120;
    return { perto, A: Math.min(9000, A), f };
  }
  // O escDens so aperta os DOIS DE PERTO, que sao os que custam.
  function limites() {
    const v = vista(), A = v.A, f = v.f;
    return [
      Math.max(60, A * (1.30 - 1.22 * f) * escDens),
      Math.max(150, A * (1.60 - 1.35 * f) * escDens),
      A * (2.20 - 1.60 * f),
      Math.min(7000, A * (3.00 - 1.70 * f)),
    ];
  }

  function semeia(soReusar) {
    if (map.getZoom() < ZSEM) { nInst = 0; incompleto = false; return; }
    const ct = map.getCenter();
    // As manchas so se pedem se houver mesmo celula nova para construir: com
    // tudo ja guardado, semear outra vez e so juntar buffers, e isso pode
    // correr enquanto o mapa se mexe sem dar por ela.
    let feats = null;
    const manchas = () => {
      if (feats) return feats;
      feats = map.querySourceFeatures('topo', {
        sourceLayer: 'solo',
        filter: ['in', ['coalesce', ['get', 'c'],
          ['match', ['get', 'g'], 'rocha', 5, 'matos', 4, 0]], ['literal', [4, 5]]],
      });
      return feats;
    };

    const RMAX = limites()[3];
    const comRelevo = !!(map.getTerrain && map.getTerrain());
    const cv2 = vista().perto;
    const mLat = 1 / 110540, mLon = 1 / (111320 * Math.cos(cv2.lat * Math.PI / 180));
    const tx0 = lonTile(cv2.lng - RMAX * mLon), tx1 = lonTile(cv2.lng + RMAX * mLon);
    const ty0 = latTile(cv2.lat + RMAX * mLat), ty1 = latTile(cv2.lat - RMAX * mLat);

    // Lista das celulas ORDENADA pela distancia ao centro. Sem isto, o
    // enchimento por orcamento ia de noroeste para sudeste e uma passagem
    // ainda a meio deixava metade do mapa com floresta e metade sem, com uma
    // fronteira recta a separar -- que e exactamente o que ele fotografou.
    // Do centro para fora, uma passagem a meio le-se como "ainda a carregar",
    // que e a verdade.
    const lista = [];
    for (let ty = ty0; ty <= ty1; ty++) {
      for (let tx = tx0; tx <= tx1; tx++) {
        const clo = (tileLon(tx) + tileLon(tx + 1)) / 2;
        const cla = (tileLat(ty) + tileLat(ty + 1)) / 2;
        const dx = (clo - cv2.lng) / mLon, dy = (cla - cv2.lat) / mLat;
        const d = Math.sqrt(dx * dx + dy * dy);
        if (d > RMAX + 200) continue;
        lista.push([d, tx, ty]);
      }
    }
    lista.sort((a, b) => a[0] - b[0]);

    const partes = []; let total = 0, novas = 0;
    let faltouDEM = false, faltouTempo = false;
    {
      for (const [d, tx, ty] of lista) {
        // A distancia e a do CENTRO da celula, mas as arvores dela espalham-se
        // por 234 m. Sem esta folga havia uma faixa onde o shader queria
        // desenhar arvores de detalhe fino que a celula nem tinha construido --
        // e essas nao ha maneira de as murchar, simplesmente faltavam.
        const FOLGA = 250;
        const L = limites();
        const salto = d < L[0] + FOLGA ? 1 : (d < L[1] + FOLGA ? 3 : (d < L[2] + FOLGA ? 9 : 27));
        // A chave leva o estado do relevo: sem relevo as cotas sao todas zero
        // (e certo, o mapa e plano), e essa celula nao serve quando o relevo
        // liga. Sem isto, ligar o 3D deixava as arvores enterradas.
        const ch = tx + '/' + ty + '/' + salto + (comRelevo ? 't' : 'p');
        let c = celulas.get(ch);
        if (c === undefined) {
          // orcamento por passagem: encher tudo de uma vez trancava o ecra.
          // O que faltar fica para a passagem seguinte, marcada aqui.
          if (soReusar || novas >= ORCAMENTO) { faltouTempo = true; continue; }
          if (!manchas().length) { faltouTempo = true; continue; }
          c = fazCelula(tx, ty, salto, feats); novas++;
          if (c === null) { faltouDEM = true; continue; }
          celulas.set(ch, c);
          if (celulas.size > 9000) celulas.delete(celulas.keys().next().value);
        }
        if (c.length) { partes.push([d, c]); total += c.length / 11; }
      }
    }
    semTerreno = faltouDEM;
    incompleto = faltouTempo;

    // ---- O TECTO, E O DEFEITO QUE ELE APONTOU DESDE O PRINCIPIO -----------
    // Estava a aplicar-se como FRACCAO DO TOTAL EM VISTA: manter = TECTO/total.
    // O total muda quando ele anda -- entra numa zona de floresta, o total
    // sobe, a fraccao desce, e arvores que ja estavam no ecra desaparecem sem
    // ele ter feito nada senao andar. Tornar o sorteio estavel nao chegava: o
    // que tinha de ser estavel era o LIMITE, e era ele que mexia.
    //
    // Agora o tecto e uma DISTANCIA, nao uma fraccao. As celulas ja vem
    // ordenadas do centro para fora; enchem-se ate ao tecto e a distancia onde
    // isso acontece passa a ser o alcance das arvores -- o mesmo alcance que o
    // shader usa para as murchar. O corte e a vista acabam no mesmo sitio, por
    // isso nao ha fronteira: ha arvores a ficarem pequenas ate desaparecerem.
    //
    // O alcance move-se devagar (um quarto do caminho de cada vez) para nao
    // saltar de um fotograma para o outro.
    const buf = new Float32Array(Math.min(total, TECTO) * 11);
    let k = 0, cortou = false;
    for (const [d, c] of partes) {
      const nc = c.length / 11;
      if (k + nc > TECTO) { cortou = true; break; }
      buf.set(c, k * 11); k += nc;
    }
    // Ajuste da densidade de perto: aperta quando nao cabe, alarga quando
    // sobra folga. Um terco do caminho de cada vez, para nao saltar.
    const alvo = total > TECTO ? escDens * 0.78
      : (total < TECTO * 0.65 ? escDens * 1.15 : escDens);
    escDens = Math.max(0.15, Math.min(1, escDens + (alvo - escDens) * 0.35));
    INST = buf; nInst = k;
    cortado = cortou;
    if (op.aoContar) op.aoContar(k, cortado, incompleto);
  }

  // -------------------------------------------------------------- a camada
  let prog, locs, bufV, bufI, inst2, cap = 0;
  // Ritmo de desenho medido no proprio sitio onde custa: entre chamadas ao
  // render desta camada. So contam os fotogramas desenhados enquanto o mapa se
  // mexe -- ai o MapLibre repinta sem parar e a diferenca entre dois renders E
  // o custo do fotograma. Com o mapa parado nao ha repintura e a diferenca e
  // tempo de espera, que nao quer dizer nada.
  let tAnterior = 0, mexiaAntes = false; const ritmos = [];

  const camada = {
    id: op.id || 'arvores', type: 'custom', renderingMode: '3d',

    onAdd(m, gl) {
      const cria = (t, s) => {
        const x = gl.createShader(t); gl.shaderSource(x, s); gl.compileShader(x);
        if (!gl.getShaderParameter(x, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(x));
        return x;
      };
      prog = gl.createProgram();
      gl.attachShader(prog, cria(gl.VERTEX_SHADER, VS));
      gl.attachShader(prog, cria(gl.FRAGMENT_SHADER, FS));
      gl.linkProgram(prog);
      if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(prog));

      // WebGL2 traz instancing de fabrica; em WebGL1 vem pela extensao ANGLE.
      inst2 = typeof gl.drawArraysInstanced === 'function'
        ? { div: (i, d) => gl.vertexAttribDivisor(i, d),
            draw: (n, c) => gl.drawArraysInstanced(gl.TRIANGLES, 0, n, c) }
        : (() => {
            const e = gl.getExtension('ANGLE_instanced_arrays');
            if (!e) return null;
            return { div: (i, d) => e.vertexAttribDivisorANGLE(i, d),
                     draw: (n, c) => e.drawArraysInstancedANGLE(gl.TRIANGLES, 0, n, c) };
          })();

      locs = {
        aV: gl.getAttribLocation(prog, 'aV'),
        aBossa: gl.getAttribLocation(prog, 'aBossa'),
        aPos: gl.getAttribLocation(prog, 'aPos'),
        aArv: gl.getAttribLocation(prog, 'aArv'),
        aTom: gl.getAttribLocation(prog, 'aTom'),
        aNiv: gl.getAttribLocation(prog, 'aNiv'),
        uM: gl.getUniformLocation(prog, 'uM'),
        uEsc: gl.getUniformLocation(prog, 'uEsc'),
        uRef: gl.getUniformLocation(prog, 'uRef'),
        uCentro: gl.getUniformLocation(prog, 'uCentro'),
        uDist: gl.getUniformLocation(prog, 'uDist'),
        uZoom: gl.getUniformLocation(prog, 'uZoom'),
        uFundo: gl.getUniformLocation(prog, 'uFundo'),
      };
      bufV = gl.createBuffer();
      gl.bindBuffer(gl.ARRAY_BUFFER, bufV);
      gl.bufferData(gl.ARRAY_BUFFER, MALHA, gl.STATIC_DRAW);
      bufI = gl.createBuffer();
    },

    onRemove(m, gl) {
      if (prog) gl.deleteProgram(prog);
      if (bufV) gl.deleteBuffer(bufV);
      if (bufI) gl.deleteBuffer(bufI);
      prog = null;
    },

    render(gl, matriz) {
      if (!prog || !inst2 || !nInst || !INST) return;
      gl.useProgram(prog);
      gl.enable(gl.DEPTH_TEST); gl.depthFunc(gl.LEQUAL); gl.depthMask(true);
      gl.disable(gl.BLEND);
      gl.enable(gl.CULL_FACE); gl.cullFace(gl.BACK);

      gl.bindBuffer(gl.ARRAY_BUFFER, bufV);
      gl.enableVertexAttribArray(locs.aV);
      gl.vertexAttribPointer(locs.aV, 4, gl.FLOAT, false, 20, 0);
      inst2.div(locs.aV, 0);
      gl.enableVertexAttribArray(locs.aBossa);
      gl.vertexAttribPointer(locs.aBossa, 1, gl.FLOAT, false, 20, 16);
      inst2.div(locs.aBossa, 0);

      gl.bindBuffer(gl.ARRAY_BUFFER, bufI);
      if (cap < nInst) { gl.bufferData(gl.ARRAY_BUFFER, INST, gl.DYNAMIC_DRAW); cap = nInst; }
      else gl.bufferSubData(gl.ARRAY_BUFFER, 0, INST);
      const S = 44;
      gl.enableVertexAttribArray(locs.aPos);
      gl.vertexAttribPointer(locs.aPos, 3, gl.FLOAT, false, S, 0); inst2.div(locs.aPos, 1);
      gl.enableVertexAttribArray(locs.aArv);
      gl.vertexAttribPointer(locs.aArv, 4, gl.FLOAT, false, S, 12); inst2.div(locs.aArv, 1);
      gl.enableVertexAttribArray(locs.aTom);
      gl.vertexAttribPointer(locs.aTom, 3, gl.FLOAT, false, S, 28); inst2.div(locs.aTom, 1);
      gl.enableVertexAttribArray(locs.aNiv);
      gl.vertexAttribPointer(locs.aNiv, 1, gl.FLOAT, false, S, 40); inst2.div(locs.aNiv, 1);

      const ct = map.getCenter(), esc = escala(ct.lat);
      const vp = vista().perto, c = merc(vp.lng, vp.lat);
      gl.uniformMatrix4fv(locs.uM, false, matriz);
      gl.uniform1f(locs.uEsc, esc);
      gl.uniform1f(locs.uRef, refMapa());
      gl.uniform2f(locs.uCentro, c[0], c[1]);
      // os mesmos limites que decidiram como se construiu cada celula
      const L = limites();
      gl.uniform4f(locs.uDist, L[0], L[1], L[2], L[3]);
      const fz = Math.max(0, Math.min(1, (map.getZoom() - ZOOM0) / (ZOOM1 - ZOOM0)));
      gl.uniform1f(locs.uZoom, fz * fz * (3 - 2 * fz));   // suave nas duas pontas
      gl.uniform3f(locs.uFundo, FUNDO[0], FUNDO[1], FUNDO[2]);

      const agora = typeof performance !== 'undefined' ? performance.now() : Date.now();
      const mexe = typeof map.isMoving === 'function' ? map.isMoving() : true;
      if (tAnterior && mexe && mexiaAntes) {
        ritmos.push(agora - tAnterior);
        if (ritmos.length > 60) ritmos.shift();
      }
      tAnterior = agora; mexiaAntes = mexe;
      inst2.draw(NVERT, nInst);

      // Devolver o GL como estava. Nao chega por o divisor a zero: os arrays
      // ficavam LIGADOS a apontar para o nosso buffer, e o MapLibre desenha a
      // seguir com os mesmos indices de atributo. Dava aquele ecra de
      // triangulos castanhos gigantes -- nao eram arvores, era o terreno dele
      // a ler vertices nossos.
      inst2.div(locs.aPos, 0); inst2.div(locs.aArv, 0);
      inst2.div(locs.aTom, 0); inst2.div(locs.aNiv, 0);
      gl.disableVertexAttribArray(locs.aPos); gl.disableVertexAttribArray(locs.aArv);
      gl.disableVertexAttribArray(locs.aTom); gl.disableVertexAttribArray(locs.aNiv);
      gl.disableVertexAttribArray(locs.aV); gl.disableVertexAttribArray(locs.aBossa);
      gl.disable(gl.CULL_FACE);
      gl.bindBuffer(gl.ARRAY_BUFFER, null);
    },
  };

  // ------------------------------------------------------ quando re-semear
  let pendente = null;
  function talvezSemeia(forca) {
    const ct = map.getCenter();
    const a = [Math.round(map.getZoom() * 2), Math.round((map.getPitch() || 0) / 6),
               ct.lng.toFixed(3), ct.lat.toFixed(3)].join('|');
    if (a === assinatura && !forca) return;
    assinatura = a;
    clearTimeout(pendente);
    pendente = setTimeout(() => {
      semeia();
      map.triggerRepaint();
      // ficou por encher: continua na proxima volta, sem trancar esta
      if (incompleto) { pendente = setTimeout(() => talvezSemeia(true), 40); }
    }, 90);
  }

  // Durante o movimento tambem: com as celulas ja guardadas, semear e so
  // juntar buffers. Sem isto, rodar o mapa nao mudava nada ate largar e no
  // fim entrava tudo de golpe -- que e o que ele descreveu.
  let ultimoMov = 0;
  map.on('move', () => {
    const t = Date.now();
    if (t - ultimoMov < 220) return;
    ultimoMov = t;
    semeia(true);
  });
  map.on('moveend', () => talvezSemeia(false));
  map.on('sourcedata', (e) => {
    if (e.sourceId !== 'topo' || !e.isSourceLoaded) return;
    // celulas vazias podem te-lo ficado por os azulejos ainda nao terem
    // chegado; as que tem arvores estao boas e ficam.
    for (const [k, v] of celulas) if (!v.length) celulas.delete(k);
    assinatura = ''; talvezSemeia(true);
  });
  map.on('idle', () => { if (semTerreno || incompleto) { assinatura = ''; talvezSemeia(true); } });

  return {
    camada,
    semeia: () => { assinatura = ''; talvezSemeia(true); },
    quantas: () => nInst,
    esquece() { celulas.clear(); assinatura = ''; talvezSemeia(true); },
    // baixar o tecto sem destruir a camada: destrui-la fazia o aviso repetir-se
    tecto(n) { TECTO = Math.max(1500, n | 0); assinatura = ''; talvezSemeia(true); },
    // mediana de ms entre fotogramas desta camada, ou null se ainda nao ha
    // amostra que chegue para dizer alguma coisa. Seis chegam: um telemovel
    // que esteja mesmo a sofrer desenha poucos fotogramas, e exigir vinte
    // amostras era nunca apanhar justamente esse.
    ritmo() {
      if (ritmos.length < 6) return null;
      const o = ritmos.slice().sort((a, b) => a - b);
      return +o[o.length >> 1].toFixed(1);
    },
    // A prova de que andar com o mapa nao mexe nas arvores: conta e soma as
    // arvores DENTRO DE UMA CAIXA FIXA no terreno. Se a caixa e a mesma, o
    // numero e a soma tem de ser os mesmos, esteja o centro do mapa onde
    // estiver. Era exactamente isto que falhava antes, e nao havia medicao
    // nenhuma que o apanhasse -- so o olho dele.
    naCaixa(w, s, e, n) {
      if (!nInst || !INST) return { n: 0, soma: 0 };
      const a = merc(w, n), b = merc(e, s);   // mercator: y cresce para sul
      let q = 0, soma = 0;
      for (let i = 0; i < nInst; i++) {
        const x = INST[i * 11], y = INST[i * 11 + 1];
        if (x < a[0] || x > b[0] || y < a[1] || y > b[1]) continue;
        q++; soma += x * 1e6 + y * 1e6 + INST[i * 11 + 3];
      }
      return { n: q, soma: +soma.toFixed(3) };
    },
    // Para diagnostico: cada arvore assenta na cota do SEU ponto e tem a SUA
    // altura. Se o intervalo de cotas for zero numa encosta, ha algo errado.
    resumo() {
      if (!nInst || !INST) return { n: 0 };
      let c0 = 1e9, c1 = -1e9, a0 = 1e9, a1 = -1e9, sa = 0;
      const niv = [0, 0, 0, 0];
      for (let i = 0; i < nInst; i++) {
        const c = INST[i * 11 + 2], h = INST[i * 11 + 3];
        if (c < c0) c0 = c; if (c > c1) c1 = c;
        if (h < a0) a0 = h; if (h > a1) a1 = h; sa += h;
        niv[INST[i * 11 + 10]]++;
      }
      return { n: nInst, celulas: celulas.size, niveis: niv, incompleto, cortado,
               limites: limites().map(Math.round),
               cotaMin: +c0.toFixed(1), cotaMax: +c1.toFixed(1),
               alturaMin: +a0.toFixed(1), alturaMax: +a1.toFixed(1),
               alturaMedia: +(sa / nInst).toFixed(1) };
    },
    desliga() {
      clearTimeout(pendente);
      if (map.getLayer(camada.id)) map.removeLayer(camada.id);
    },
  };
}

if (typeof module !== 'undefined') module.exports = { ligaArvores };

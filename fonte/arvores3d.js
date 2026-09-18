// ===========================================================================
// Arvores em 3D, instanciadas -- camada propria do MapLibre (WebGL directo)
// ---------------------------------------------------------------------------
// Um so modelo de arvore, 28 triangulos, desenhado N vezes numa unica chamada
// de desenho (instancing). 20 000 arvores custam o mesmo que uma em numero de
// chamadas; o que cresce e so o buffer de instancias, 40 bytes cada.
//
// Nao usa three.js. Sao ~9 KB de codigo contra ~600 KB de biblioteca, e a
// biblioteca faria exactamente isto por baixo.
//
// AS TRES COISAS QUE VEM DO DADO, E A QUE NAO VEM
//
//   onde   as arvores nascem dentro dos poligonos de floresta (COS n1=5) e de
//          montado (n1=4). Fora deles nao ha nenhuma. Chao a chao: nunca uma
//          arvore em cima de rocha, de pastagem ou de agua.
//   quantas  densidade tirada da cobertura de copa 'd' da mancha, pela relacao
//          de Poisson  lambda = -ln(1 - d/100) / (pi * r^2).  Nao e um numero
//          escolhido a olho: e quantas copas de raio r sao precisas para tapar
//          d% do chao. Montado a 30% da ~45 arvores/ha, pinhal a 70% da ~430.
//          Sao os numeros reais destes povoamentos.
//   que altura  'h' da mancha, em metros, escalado contra o terreno com o mesmo
//          exagero do relevo. Uma arvore de 14 m mede 14 m ao lado da encosta.
//
//   QUAL  a especie desenhada (copa de cone ou copa redonda) NAO vem do dado.
//          A COS ao nivel 1 nao distingue pinhal de carvalhal. A forma e
//          decorativa e sorteada por posicao; a altura e a densidade sao dado.
//          Quem olhar para isto tem de saber a diferenca.
//
// E 'd'/'h' so sao medidos onde ha LiDAR (ver cos_extrai.py --chm). Onde nao
// ha, sao valores por defeito da classe e a mancha traz m=0. A legenda tem de
// dizer "modelado", como o resto do projecto ja faz com as cotas.
// ===========================================================================

function ligaArvores(map, op) {
  op = op || {};
  const ZMIN = op.zoomMin == null ? 15 : op.zoomMin;   // abaixo disto, padrao 2D
  const RAIO = op.raio == null ? 900 : op.raio;        // m a volta do centro
  const TECTO = op.tecto == null ? 45000 : op.tecto;   // arvores no maximo
  const GRELHA = 3.0;                                  // m: passo da grelha base
  const FUNDO = op.fundo || [0.78, 0.80, 0.72];        // cor para onde desmaia

  // --- o que cada grupo e, em arvore -------------------------------------
  // c = digito de nivel 1 da COS. 5 floresta, 4 sistemas agro-florestais.
  // k = raio de copa / altura da arvore. Medido em povoamentos reais:
  //   pinheiro bravo de 14 m tem copa de 5 a 6 m de diametro  -> k ~ 0.20
  //   sobreiro de 8 m tem copa de 10 a 14 m de diametro       -> k ~ 0.75
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
  // Copa: torno de 6 lados, 3 aneis. Tronco: dois quadrados cruzados.
  // O perfil do raio e calculado no vertex shader, por isso a mesma malha da
  // cone (conifera) ou bola (folhosa) conforme o valor de instancia aForma.
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
    uniform mat4 uM;
    uniform float uEsc;       // metros -> unidades mercator
    uniform float uRef;       // cota do centro do mapa, em metros (referencial)
    uniform vec2 uCentro;     // mercator, para o desmaio de distancia
    uniform vec2 uFade;       // inicio e fim do desmaio, em metros
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
      // sol de noroeste a 45 graus. Em mercator o norte e -y.
      vec3 sol = normalize(vec3(-0.55, -0.45, 0.70));
      float lam = max(0.0, dot(normalize(nrm), sol));
      // ceu por cima a levantar o que fica a sombra: sem isto o lado escuro da
      // copa fica preto e a mancha le-se como um borrao, nao como arvores.
      float ceu = 0.5 + 0.5 * normalize(nrm).z;
      vLuz = 0.46 + 0.42 * lam + 0.18 * ceu;
      vCor = aV.w < 0.5 ? aTom : vec3(0.46, 0.36, 0.26);
      vec3 mund = vec3(aPos.xy, (aPos.z - uRef) * uEsc) + p * uEsc;
      float dm = length(mund.xy - uCentro) / uEsc;
      vFade = clamp((dm - uFade.x) / max(1.0, uFade.y - uFade.x), 0.0, 1.0);
      gl_Position = uM * vec4(mund, 1.0);
    }`;

  const FS = `
    precision mediump float;
    uniform vec3 uFundo;
    varying vec3 vCor; varying float vLuz; varying float vFade;
    void main() {
      vec3 c = vCor * vLuz;
      gl_FragColor = vec4(mix(c, uFundo, vFade * 0.92), 1.0);
    }`;

  // -------------------------------------------------------------- geometria
  const R3857 = 20037508.342789244, CIRC = 40075016.685578488;
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

  // ------------------------------------------------------------- semear
  let INST = null, nInst = 0, assinatura = '';

  function semeia() {
    const z = map.getZoom();
    if (z < ZMIN) { nInst = 0; return; }
    const ct = map.getCenter();
    const feats = map.querySourceFeatures('topo', {
      sourceLayer: 'solo',
      filter: ['in', ['coalesce', ['get', 'c'],
        ['match', ['get', 'g'], 'rocha', 5, 'matos', 4, 0]], ['literal', [4, 5]]],
    });
    if (!feats.length) { nInst = 0; return; }

    const mLat = 1 / 110540, mLon = 1 / (111320 * Math.cos(ct.lat * Math.PI / 180));
    const dLat = GRELHA * mLat, dLon = GRELHA * mLon;
    const L = { w: ct.lng - RAIO * mLon, e: ct.lng + RAIO * mLon,
                s: ct.lat - RAIO * mLat, n: ct.lat + RAIO * mLat };

    const feitas = new Set();
    const px = [], py = [], ph = [], pr = [], pf = [], pt = [];
    let cheio = false;

    for (const f of feats) {
      if (cheio) break;
      const cod = f.properties.c != null ? +f.properties.c
        : ({ rocha: 5, matos: 4 })[f.properties.g] || 0;   // azulejos antigos
      const E = ESPECIE[cod]; if (!E) continue;
      const alt = +f.properties.h || E.h;
      // op.densidade so existe para ensaio: forca a mesma cobertura em tudo,
      // para se ver lado a lado o que a densidade muda. A serio, vem do dado.
      const cob = Math.min(92, op.densidade || +f.properties.d || E.d);
      const raio = Math.max(0.8, alt * E.k);
      const lam = -Math.log(1 - cob / 100) / (Math.PI * raio * raio);  // arvores/m2
      const manter = Math.min(1, lam * GRELHA * GRELHA);
      const gs = f.geometry.type === 'Polygon' ? [f.geometry.coordinates] : f.geometry.coordinates;

      for (const pol of gs) {
        let x0 = 1e9, y0 = 1e9, x1 = -1e9, y1 = -1e9;
        for (const p of pol[0]) {
          if (p[0] < x0) x0 = p[0]; if (p[0] > x1) x1 = p[0];
          if (p[1] < y0) y0 = p[1]; if (p[1] > y1) y1 = p[1];
        }
        x0 = Math.max(x0, L.w); x1 = Math.min(x1, L.e);
        y0 = Math.max(y0, L.s); y1 = Math.min(y1, L.n);
        if (x1 <= x0 || y1 <= y0) continue;

        const i0 = Math.floor(x0 / dLon), i1 = Math.ceil(x1 / dLon);
        const j0 = Math.floor(y0 / dLat), j1 = Math.ceil(y1 / dLat);
        for (let j = j0; j <= j1 && !cheio; j++) {
          for (let i = i0; i <= i1; i++) {
            const k = i * 8388608 + j;
            if (feitas.has(k)) continue;              // a mancha vem repartida
            const lon = (i + 0.5 + (baralha(i, j, 1) - 0.5) * 0.9) * dLon;
            const lat = (j + 0.5 + (baralha(i, j, 2) - 0.5) * 0.9) * dLat;
            if (lon < L.w || lon > L.e || lat < L.s || lat > L.n) continue;
            if (!dentroPol(pol, lon, lat)) continue;
            feitas.add(k);                            // dentro conta, guarde-se ou nao
            if (baralha(i, j, 3) > manter) continue;
            const hh = alt * (0.72 + 0.56 * baralha(i, j, 4));
            px.push(lon); py.push(lat); ph.push(hh);
            pr.push(Math.max(0.6, hh * E.k * (0.85 + 0.3 * baralha(i, j, 5))));
            pf.push(baralha(i, j, 6) < E.conifera ? 0.0 : 1.0);
            pt.push(baralha(i, j, 7));
            if (px.length >= TECTO) { cheio = true; break; }
          }
        }
      }
    }

    const n = px.length;
    const buf = new Float32Array(n * 10);
    let planas = 0;
    for (let i = 0; i < n; i++) {
      const [mx, my] = merc(px[i], py[i]);
      const cota = chaoAbs(px[i], py[i]);
      if (cota === 0) planas++;
      const o = i * 10;
      buf[o] = mx; buf[o + 1] = my; buf[o + 2] = cota;
      buf[o + 3] = ph[i]; buf[o + 4] = pr[i]; buf[o + 5] = pf[i];
      buf[o + 6] = baralha(i, 0, 8) * 6.283;
      const v = pt[i];                                 // tom: verde-escuro a verde-claro
      buf[o + 7] = 0.24 + 0.22 * v;
      buf[o + 8] = 0.44 + 0.26 * v;
      buf[o + 9] = 0.25 + 0.18 * v;
    }
    INST = buf; nInst = n;
    // Se ha relevo mas nenhuma arvore apanhou cota, os azulejos do DEM ainda
    // nao chegaram. Marca-se para voltar a semear quando o mapa assentar --
    // sem isto as arvores ficavam todas ao nivel do centro.
    semTerreno = !!(map.getTerrain && map.getTerrain()) && n > 0 && planas === n;
    if (op.aoContar) op.aoContar(n, cheio);
  }

  // -------------------------------------------------------------- a camada
  let prog, locs, bufV, bufI, inst2, cap = 0;

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
        uM: gl.getUniformLocation(prog, 'uM'),
        uEsc: gl.getUniformLocation(prog, 'uEsc'),
        uRef: gl.getUniformLocation(prog, 'uRef'),
        uCentro: gl.getUniformLocation(prog, 'uCentro'),
        uFade: gl.getUniformLocation(prog, 'uFade'),
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
      const S = 40;
      gl.enableVertexAttribArray(locs.aPos);
      gl.vertexAttribPointer(locs.aPos, 3, gl.FLOAT, false, S, 0); inst2.div(locs.aPos, 1);
      gl.enableVertexAttribArray(locs.aArv);
      gl.vertexAttribPointer(locs.aArv, 4, gl.FLOAT, false, S, 12); inst2.div(locs.aArv, 1);
      gl.enableVertexAttribArray(locs.aTom);
      gl.vertexAttribPointer(locs.aTom, 3, gl.FLOAT, false, S, 28); inst2.div(locs.aTom, 1);

      const ct = map.getCenter(), esc = escala(ct.lat), c = merc(ct.lng, ct.lat);
      gl.uniformMatrix4fv(locs.uM, false, matriz);
      gl.uniform1f(locs.uEsc, esc);
      gl.uniform1f(locs.uRef, refMapa());
      gl.uniform2f(locs.uCentro, c[0], c[1]);
      gl.uniform2f(locs.uFade, RAIO * 0.45, RAIO);
      gl.uniform3f(locs.uFundo, FUNDO[0], FUNDO[1], FUNDO[2]);
      inst2.draw(NVERT, nInst);

      // devolver o divisor a zero: o MapLibre reutiliza estes indices
      inst2.div(locs.aPos, 0); inst2.div(locs.aArv, 0); inst2.div(locs.aTom, 0);
    },
  };

  // ------------------------------------------------------ quando re-semear
  let pendente = null, semTerreno = false;
  function talvezSemeia() {
    const ct = map.getCenter();
    const a = [Math.round(map.getZoom() * 2), ct.lng.toFixed(3), ct.lat.toFixed(3)].join('|');
    if (a === assinatura) return;
    assinatura = a;
    clearTimeout(pendente);
    pendente = setTimeout(() => { semeia(); map.triggerRepaint(); }, 120);
  }

  map.on('moveend', talvezSemeia);
  map.on('idle', () => { if (semTerreno) { assinatura = ''; talvezSemeia(); } });
  map.on('sourcedata', (e) => { if (e.sourceId === 'topo' && e.isSourceLoaded) { assinatura = ''; talvezSemeia(); } });

  return {
    camada,
    semeia: () => { assinatura = ''; talvezSemeia(); },
    quantas: () => nInst,
    // Para diagnostico: cada arvore assenta na cota do SEU ponto (chaoAbs e
    // chamado por arvore, nao por mancha) e tem a SUA altura. Se o intervalo
    // de cotas for zero numa encosta, ha alguma coisa errada -- e isto diz-o.
    resumo() {
      if (!nInst || !INST) return { n: 0 };
      let c0 = 1e9, c1 = -1e9, a0 = 1e9, a1 = -1e9, sa = 0;
      for (let i = 0; i < nInst; i++) {
        const c = INST[i * 10 + 2], h = INST[i * 10 + 3];
        if (c < c0) c0 = c; if (c > c1) c1 = c;
        if (h < a0) a0 = h; if (h > a1) a1 = h; sa += h;
      }
      return { n: nInst, cotaMin: +c0.toFixed(1), cotaMax: +c1.toFixed(1),
               alturaMin: +a0.toFixed(1), alturaMax: +a1.toFixed(1),
               alturaMedia: +(sa / nInst).toFixed(1) };
    },
    desliga() { map.off('moveend', talvezSemeia); if (map.getLayer(camada.id)) map.removeLayer(camada.id); },
  };
}

if (typeof module !== 'undefined') module.exports = { ligaArvores };

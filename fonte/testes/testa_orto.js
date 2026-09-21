// A ortofoto nao pode piscar: com a camara parada, depois de os azulejos
// chegarem, o conjunto de texturas tem de ficar quieto (sem despejos), e a
// memoria dentro do orcamento. Azulejos simulados (a rede daqui nao chega ao
// Esri): cada um e um PNG com a cor a variar por x/y.
const { chromium, devices } = require('playwright');
const zlib = require('zlib');
function png(w, h, r, g, b) {
  const raw = Buffer.alloc((w * 3 + 1) * h);
  for (let y = 0; y < h; y++) { raw[y * (w * 3 + 1)] = 0; for (let x = 0; x < w; x++) { const o = y * (w * 3 + 1) + 1 + x * 3; raw[o] = r; raw[o + 1] = g; raw[o + 2] = b; } }
  const crc = (buf) => { let c, t = []; for (let n = 0; n < 256; n++) { c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; t[n] = c >>> 0; } let cr = 0xffffffff; for (const v of buf) cr = t[(cr ^ v) & 0xff] ^ (cr >>> 8); return (cr ^ 0xffffffff) >>> 0; };
  const chunk = (tipo, dados) => { const len = Buffer.alloc(4); len.writeUInt32BE(dados.length); const td = Buffer.concat([Buffer.from(tipo), dados]); const c = Buffer.alloc(4); c.writeUInt32BE(crc(td)); return Buffer.concat([len, td, c]); };
  const ihdr = Buffer.alloc(13); ihdr.writeUInt32BE(w, 0); ihdr.writeUInt32BE(h, 4); ihdr[8] = 8; ihdr[9] = 2; ihdr[10] = 0; ihdr[11] = 0; ihdr[12] = 0;
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', ihdr), chunk('IDAT', zlib.deflateSync(raw)), chunk('IEND', Buffer.alloc(0))]);
}
(async () => {
  const pc = process.argv.includes('--pc');
  const b = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium', args: ['--use-gl=swiftshader'] });
  const ctx = pc ? await b.newContext({ viewport: { width: 1400, height: 800 } }) : await b.newContext({ ...devices['Pixel 7'] });
  const p = await ctx.newPage();
  const erros = []; p.on('pageerror', (e) => erros.push(e.message));
  let azulejos = 0; const porNivel = {};
  await p.route(/arcgisonline\.com/, (route) => { azulejos++; const m = /tile\/(\d+)\/(\d+)\/(\d+)/.exec(route.request().url()); porNivel[m[1]] = (porNivel[m[1]] || 0) + 1;
    route.fulfill({ status: 200, contentType: 'image/png', body: png(256, 256, (+m[3] * 37) & 255, (+m[2] * 53) & 255, 120) }); });
  await p.goto('http://localhost:8765/terreno.html' + (process.argv[2] && !process.argv[2].startsWith('--') ? process.argv[2] : ''), { waitUntil: 'load' });
  await p.waitForFunction(() => window.V && window.T, null, { timeout: 90000 });
  await p.evaluate(() => { const c = document.getElementById('chao'); c.value = 'esri'; c.dispatchEvent(new Event('change')); });
  // espera ate os pedidos pararem
  // espera ate o numero de texturas parar de crescer (o swiftshader e lento: quadros de segundos)
  let ant = -1, quieto = 0, fAnt = -1;
  for (let k = 0; k < 80 && quieto < 4; k++) { await p.waitForTimeout(2000); const f = await p.evaluate(() => { try { return V.conta.fotos; } catch (e) { return -2; } }); if (f === -2) console.log('sem V:', await p.evaluate(() => document.getElementById('estado').textContent + ' | ' + document.getElementById('versao').textContent)); if (f === fAnt && azulejos === ant) quieto++; else quieto = 0; fAnt = f; ant = azulejos; }
  const c1 = await p.evaluate(() => !V ? { semV: document.getElementById('estado').textContent } : ({ fotos: V.conta.fotos, MB: +V.conta.fotosMB.toFixed(1), despejadas: V.conta.fotosDespejadas, falhadas: V.conta.fotosFalhadas, blocos: V.conta.blocosChao, zona: document.getElementById('versao').textContent }));
  await p.waitForTimeout(8000);
  const c2 = await p.evaluate(() => !V ? { semV: document.getElementById('estado').textContent } : ({ fotos: V.conta.fotos, MB: +V.conta.fotosMB.toFixed(1), despejadas: V.conta.fotosDespejadas, falhadas: V.conta.fotosFalhadas, blocos: V.conta.blocosChao }));
  const az2 = azulejos;
  console.log(JSON.stringify({ c1, c2, azulejos, porNivel }), 'erros:', erros);
  await p.screenshot({ path: process.env.FOTO || '/tmp/orto.png' });
  await b.close();
  // parado: nada muda entre c1 e c2, e nenhum azulejo novo
  // criterio: nunca despejou nem falhou com a camara parada, memoria no orcamento; (o carregamento pode ainda estar a acabar: o swiftshader demora segundos por quadro)
  if (erros.length || c2.despejadas || c2.falhadas || c2.MB > 260 || c2.fotos < c1.fotos) process.exit(1);
})().catch(e => { console.log('ERRO', e.message); process.exit(1); });

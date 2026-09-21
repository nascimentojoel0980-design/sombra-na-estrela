const { chromium, devices } = require('playwright');
(async () => {
  const b = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium', args: ['--use-gl=swiftshader'] });
  const p = await (await b.newContext({ ...devices['Pixel 7'] })).newPage();
  let erros = [];
  p.on('pageerror', (e) => erros.push(e.message));
  await p.goto('http://localhost:8765/terreno.html', { waitUntil: 'load' });
  await p.waitForTimeout(12000);
  const z0 = await p.evaluate(() => document.getElementById('versao').textContent);
  await p.evaluate(() => { const i = ZONAS.findIndex((z) => z.nome === 'manteigas'); document.getElementById('zona').value = String(i); document.getElementById('zona').dispatchEvent(new Event('change')); });
  await p.waitForTimeout(15000);
  const z1 = await p.evaluate(() => ({ v: document.getElementById('versao').textContent, estado: document.getElementById('estado').textContent, V: !!window.V }));
  await p.evaluate(() => { const i = ZONAS.findIndex((z) => z.classe >= 20); document.getElementById('zona').value = String(i); document.getElementById('zona').dispatchEvent(new Event('change')); });
  await p.waitForTimeout(15000);
  const z2 = await p.evaluate(() => ({ v: document.getElementById('versao').textContent, estado: document.getElementById('estado').textContent, V: !!window.V, off: document.getElementById('offInfo').textContent }));
  console.log(z0, JSON.stringify(z1), JSON.stringify(z2), 'erros:', erros);
  await b.close();
  if (erros.length || !z2.V) process.exit(1);
})().catch(e => { console.log('ERRO', e.message); process.exit(1); });

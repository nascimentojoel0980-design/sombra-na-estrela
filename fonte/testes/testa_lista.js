const { chromium, devices } = require('playwright');
(async () => {
  const b = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium', args: ['--use-gl=swiftshader'] });
  const p = await (await b.newContext({ ...devices['Pixel 7'] })).newPage();
  const erros = []; p.on('pageerror', (e) => erros.push(e.message));
  await p.goto('http://localhost:8765/terreno.html', { waitUntil: 'load' });
  await p.waitForTimeout(12000);
  await p.evaluate(() => { document.getElementById('menu').classList.add('on'); document.getElementById('soZona').checked = false; pintaLista(); });
  const r = await p.evaluate(async () => { const rows = [...document.querySelectorAll('#lista .tr')]; rows[0].click(); await new Promise(r => setTimeout(r, 4000));
    const a = { sel1: document.querySelector('#lista .tr.sel b')?.textContent, estat1: !!document.querySelector('#lista .tr.sel .estat')?.textContent };
    const rows2 = [...document.querySelectorAll('#lista .tr')]; rows2[1].click(); await new Promise(r => setTimeout(r, 4000));
    a.nSel = document.querySelectorAll('#lista .tr.sel').length; a.nEstat = document.querySelectorAll('#lista .estat').length; a.sel2 = document.querySelector('#lista .tr.sel b')?.textContent; a.estat2 = (document.querySelector('#lista .tr.sel .estat')?.textContent || '').slice(0, 80);
    return a; });
  console.log(JSON.stringify(r), 'erros:', erros);
  await b.close(); if (erros.length) process.exit(1);
})().catch(e => { console.log('ERRO', e.message); process.exit(1); });

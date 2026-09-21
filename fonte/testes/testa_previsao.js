const { chromium, devices } = require('playwright');
const hoje = new Date(); const d0 = new Date(hoje.getFullYear(), hoje.getMonth(), hoje.getDate());
const tempo = []; for (let i = 0; i < 168; i++) { const d = new Date(d0.getTime() + i * 3600e3); tempo.push(d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0') + 'T' + String(d.getHours()).padStart(2, '0') + ':00'); }
const serie = (f, horas) => tempo.map((t, i) => i < horas ? f(i) : null);
function modelo(id, horas, niveis) {
  const h = { time: tempo,
    temperature_2m: serie((i) => 12 + 8 * Math.sin(i / 24 * 6.28), horas), dew_point_2m: serie((i) => 6, horas),
    precipitation: serie((i) => (i % 40 === 0 ? 4 : 0), horas), snowfall: serie(() => 0, horas), weather_code: serie((i) => (i % 40 === 0 ? 61 : (i % 50 === 0 ? 95 : 2)), horas),
    wind_speed_10m: serie((i) => 20 + (i % 30), horas), wind_direction_10m: serie(() => 270, horas), wind_gusts_10m: serie((i) => 40 + (i % 30), horas),
    cloud_cover: serie(() => 50, horas), cloud_cover_low: serie((i) => (i % 7 ? 30 : 90), horas), cape: serie((i) => (i % 50 === 0 ? 1200 : 100), horas), freezing_level_height: serie((i) => 1500 + i * 5, horas) };
  if (niveis) Object.assign(h, { temperature_850hPa: serie((i) => 5, horas), wind_speed_850hPa: serie((i) => 45, horas), wind_direction_850hPa: serie(() => 300, horas), geopotential_height_850hPa: serie(() => 1480, horas),
    temperature_700hPa: serie(() => -4, horas), wind_speed_700hPa: serie(() => 70, horas), wind_direction_700hPa: serie(() => 310, horas), geopotential_height_700hPa: serie(() => 3050, horas) });
  const r = { latitude: 40.3, longitude: -7.6, elevation: 1200, hourly: h };
  if (id === 'ecmwf_ifs025') r.daily = { time: tempo.filter((t) => t.endsWith('T00:00')).map((t) => t.slice(0, 10)), sunrise: tempo.filter((t) => t.endsWith('T00:00')).map((t) => t.slice(0, 10) + 'T07:20'), sunset: tempo.filter((t) => t.endsWith('T00:00')).map((t) => t.slice(0, 10) + 'T19:40') };
  return r;
}
function ensemble() { const h = { time: tempo }; for (const k of ['temperature_2m', 'precipitation', 'wind_speed_10m']) { h[k] = serie((i) => k === 'temperature_2m' ? 12 : k === 'precipitation' ? 0 : 20, 168); for (let m = 1; m <= 6; m++) h[k + '_member' + String(m).padStart(2, '0')] = serie((i) => k === 'temperature_2m' ? 12 + m + (i > 100 ? m * 2 : 0) : k === 'precipitation' ? (m > 3 && i > 120 ? 1 : 0) : 20 + m, 168); } return { hourly: h }; }
(async () => {
  const b = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium', args: ['--use-gl=swiftshader'] });
  const p = await (await b.newContext({ ...devices['Pixel 7'] })).newPage();
  const erros = []; p.on('pageerror', (e) => erros.push(e.message));
  const pedidos = [];
  await p.route(/api\.open-meteo\.com|ensemble-api\.open-meteo\.com|api\.ipma\.pt/, (route) => {
    const u = route.request().url(); pedidos.push(u.slice(0, 90));
    let body;
    if (u.includes('ensemble-api')) body = ensemble();
    else if (u.includes('ipma')) body = [{ idAreaAviso: 'GDA', awarenessTypeName: 'Vento', awarenessLevelID: 'yellow', startTime: tempo[0], endTime: tempo[30], text: 'Vento forte nas terras altas.' }, { idAreaAviso: 'LSB', awarenessLevelID: 'red', awarenessTypeName: 'Calor' }];
    else { const id = /models=([a-z_0-9]+)/.exec(u)[1]; const horas = { meteofrance_arome_france_hd: 48, meteofrance_arpege_europe: 96, icon_eu: 120, ecmwf_ifs025: 168 }[id];
      if (id === 'icon_eu' && u.includes('850hPa')) return route.fulfill({ status: 400, contentType: 'application/json', body: JSON.stringify({ error: true, reason: 'sem níveis' }) });
      body = modelo(id, horas, id !== 'icon_eu'); }
    route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(body) });
  });
  await p.goto('http://localhost:8765/trilho.html?bd=0', { waitUntil: 'load' });
  await p.waitForFunction(() => /Próximos 7 dias|Sem previsão/.test(document.getElementById('met').textContent), null, { timeout: 90000 });
  const r = await p.evaluate(() => ({ nota: document.getElementById('metNota').textContent, linhas: document.querySelectorAll('#met .dia').length, cartas: document.querySelectorAll('#met .hoje .h').length,
    modelos: [...document.querySelectorAll('#met .dia')].map((d) => d.querySelector('.chips').lastElementChild.textContent), aval: [...document.querySelectorAll('#met .dia .aval')].map((e) => e.textContent),
    conf: [], avisos: document.getElementById('met').textContent.includes('Vento') && !document.getElementById('met').textContent.includes('Calor'),
    texto: document.getElementById('met').innerText.slice(0, 500) }));
  console.log(JSON.stringify(r, null, 1)); console.log('pedidos', pedidos.length, 'erros:', erros);
  await p.screenshot({ path: process.argv[2] || '/tmp/prev.png', fullPage: true });
  await b.close(); if (erros.length) process.exit(1);
})().catch(e => { console.log('ERRO', e.message); process.exit(1); });

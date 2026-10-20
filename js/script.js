/* SKYLINE WEATHER - script.js
   Poora logic yahan hai. index.html ke body ke aakhir me load hoti hai. */

// APP KAISE CHALTA HAI (short me):
// 1. Page khulte hi init (neeche) aapki location maangta hai -> loadWeather() chalta hai.
// 2. loadWeather() Open-Meteo se weather + air quality data laata hai.
// 3. Phir alag alag render function (renderCurrent, renderAQI, renderHourly...) screen ke hisse bharte hain.
// 4. Search, suggestions, travel matcher aur audio button alag alag event listeners se chalte hain.
//
// STATE: laaya hua data yahan rakha jata hai, taaki chart, audio jaise doosre functions use kar sakein.
const STATE = {};          // latest wx / aq / loc / map grid, shared by renderers
let chartView = 'week';  // 'day' | 'week'
// pad(5) -> "05": date banane me kaam aata hai.
const pad = n => String(n).padStart(2, '0');
// Open-Meteo ki 4 FREE APIs ke links (koi API key nahi chahiye):
// arch = purana data (Archive), geo = shehar dhundhna (Geocoding), wx = weather forecast, aq = hawa ki quality.
const API = {
  arch: 'https://archive-api.open-meteo.com/v1/archive',
  geo: 'https://geocoding-api.open-meteo.com/v1/search',
  wx: 'https://api.open-meteo.com/v1/forecast',
  aq: 'https://air-quality-api.open-meteo.com/v1/air-quality'
};
// Chhota shortcut: $("clock") likhne par document.getElementById("clock") ka kaam hota hai.
const $ = id => document.getElementById(id);
// Chart.js ka object yahan rakhte hain, taaki naya chart banane se pehle purana hata sakein.
let chart;

// WMO weather code ko samajhne wali table. Open-Meteo weather ko number (code) me deta hai, jaise 0 = saaf aasmaan, 61 = baarish.
// Har code ke liye 3 cheezein lautati hai: [naam, din ka icon, raat ka icon].
const WMO = c => {
  if (c === 0) return ['Clear sky', 'sun', 'moon'];
  if (c <= 2) return ['Partly cloudy', 'cloud-sun', 'cloud-moon'];
  if (c === 3) return ['Overcast', 'cloud', 'cloud'];
  if (c <= 48) return ['Foggy', 'cloud-fog', 'cloud-fog'];
  if (c <= 57) return ['Drizzle', 'cloud-drizzle', 'cloud-drizzle'];
  if (c <= 67) return ['Rain', 'cloud-rain', 'cloud-rain'];
  if (c <= 77) return ['Snow', 'snowflake', 'snowflake'];
  if (c <= 82) return ['Rain showers', 'cloud-rain', 'cloud-rain'];
  if (c <= 86) return ['Snow showers', 'snowflake', 'snowflake'];
  return ['Thunderstorm', 'cloud-lightning', 'cloud-lightning'];
};
// Weather code aur din/raat ke hisaab se sahi icon ka naam deta hai.
const icon = (c, day = 1) => WMO(c)[day ? 1 : 2];
// True agar code baarish/bauchhaar/storm ka ho. Theme, suggestions aur travel matcher me kaam aata hai.
const isRainCode = c => (c >= 51 && c <= 67) || (c >= 80 && c <= 82) || c >= 95;
// True agar code barf ka ho.
const isSnowCode = c => (c >= 71 && c <= 77) || c === 85 || c === 86;

// Upar wale status box me message dikhata hai (err = true ho to laal rang). Khali message ho to box chhup jata hai.
function setStatus(msg, err) {
  const s = $('status');
  s.textContent = msg || '';
  s.classList.toggle('hidden', !msg);
  s.style.color = err ? '#ef4444' : '';
}
// Naye HTML me aaye <i data-lucide="..."> tags ko asli icons me badalta hai. Har baar HTML badalne ke baad chalana padta hai.
function ic() { try { if (window.lucide) lucide.createIcons(); } catch (e) { console.warn('Icons unavailable', e); } }
// 13 -> "1 PM", 0 -> "12 AM" (24 ghante se 12 ghante ka format).
const fmtHour = h => `${h % 12 || 12} ${h < 12 ? 'AM' : 'PM'}`;
// "2026-10-04" jaisi date ko "Sun" ya "Sunday, Oct 4" jaise naam me badalta hai.
const dayName = (d, o = { weekday: 'short' }) => new Date(d + 'T00:00').toLocaleDateString('en-US', o);
// Hawa ki degree (0-360) ko disha me badalta hai: N, NE, E, SE...
const compass = d => ['N', 'NE', 'E', 'SE', 'S', 'SW', 'W', 'NW'][Math.round(d / 45) % 8];

/* ---------- Clock ---------- */
// Clock: abhi ka time (12:30 PM) aur date (Sunday, Oct 4, 2026) header me likhta hai.
function tick() {
  const n = new Date();
  $('clock').textContent = n.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', hour12: true }) + ' | ' +
    n.toLocaleDateString('en-US', { weekday: 'long', month: 'short', day: 'numeric', year: 'numeric' });
}
// Pehli baar turant chalao, phir har 1000 ms (1 second) me dobara.
tick(); setInterval(tick, 1000);

/* ---------- Theme ---------- */
// THEME CHUNNA: weather code aur din/raat dekhkar tay karta hai ki kaun si theme lage.
// Priority order: storm > snow > rain > raat > fog > cloudy > sunny.
// Phir body ki class aur background effect (barish/barf/sooraj/taare) badal deta hai.
function applyTheme(code, isDay) {
  let t = 'sunny';
  if (code >= 95) t = 'storm';
  else if (isSnowCode(code)) t = 'snow';
  else if (isRainCode(code)) t = 'rain';
  else if (!isDay) t = 'night';
  else if (code >= 45 && code <= 48) t = 'fog';
  else if (code >= 2) t = 'cloudy';
  document.body.className = 't-' + t;
  $('fx').className = (t === 'rain' || t === 'storm') ? 'rain' : t === 'snow' ? 'snow' : t === 'sunny' ? 'sun' : t === 'night' ? 'stars' : '';
}

/* ---------- API helpers ---------- */
// Kisi bhi API URL se data laata hai aur JSON me badalta hai. Error aaye to message ke saath error phenkta hai.
async function getJSON(url) {
  const r = await fetch(url);
  if (!r.ok) throw new Error('Request failed (' + r.status + ')');
  return r.json();
}
// Shehar ka naam search karta hai (30 results tak). India ke results ko LIST ME PEHLE rakhta hai, taaki "Assam" likhne par Mozambique na aaye.
async function searchPlaces(name, n = 30) {
  const d = await getJSON(`${API.geo}?name=${encodeURIComponent(name)}&count=${n}&language=en&format=json`);
  const r = d.results || [];
  // India first, keep the API's own (population-based) order inside each group
  return [...r.filter(p => p.country_code === 'IN'), ...r.filter(p => p.country_code !== 'IN')];
}
// API ke result ko apne format me badalta hai: {lat, lon, name}. Naam = shehar, rajya, desh.
const toLoc = p => ({ lat: p.latitude, lon: p.longitude, name: [p.name, p.admin1, p.country].filter(Boolean).join(', ') });
// Naam se sabse upar wala (India-first) shehar deta hai. Kuch na mile to error.
async function geocode(name) {
  const r = await searchPlaces(name);
  if (!r.length) throw new Error(`Couldn't find "${name}". Check the spelling and try again.`);
  return toLoc(r[0]);
}

/* ---------- Search suggestions ---------- */
// SEARCH SUGGESTIONS: user type karta hai to har akshar par API na chale, isliye 300 ms ruk kar (debounce) hi search karte hain.
let suggTimer;
// Har baar jab user box me kuch type kare to yeh chalta hai.
$('cityInput').addEventListener('input', e => {
  clearTimeout(suggTimer);
  const q = e.target.value.trim();
  if (q.length < 2) { $('sugg').classList.add('hidden'); return; }
  suggTimer = setTimeout(async () => {
    try {
      const r = (await searchPlaces(q)).slice(0, 6);
      const box = $('sugg');
      box.innerHTML = r.map((p, i) => `<li><button type="button" data-i="${i}" class="w-full text-left px-4 py-2 hover:bg-white/10">
        ${p.name}<span class="opacity-60">, ${[p.admin1, p.country].filter(Boolean).join(', ')}</span></button></li>`).join('');
      box.classList.toggle('hidden', !r.length);
      // Suggestion par click: wahi shehar chunkar weather load karo aur list band karo.
      box.onclick = ev => {
        const b = ev.target.closest('button'); if (!b) return;
        const loc = toLoc(r[+b.dataset.i]);
        $('cityInput').value = loc.name; box.classList.add('hidden'); loadWeather(loc);
      };
    } catch (err) { console.warn(err); }
  }, 300);
});
// Box ya list ke bahar kahin click karne par suggestions band.
document.addEventListener('click', e => { if (!e.target.closest('#cityInput,#sugg')) $('sugg').classList.add('hidden'); });

/* ---------- Main load ---------- */
// MAIN FUNCTION: kisi bhi location (lat, lon, name) ka poora weather laakar screen par dikhata hai.
async function loadWeather(loc) {
  try {
    setStatus('Fetching live weather...');
    // Weather API ka URL banana. Hum yeh maangte hain:
    // current = abhi ka data, hourly = ghante-ghante ka, daily = din-din ka. forecast_days=8 (aaj + 7 din), timezone=auto (us jagah ka local time).
    const wxUrl = `${API.wx}?latitude=${loc.lat}&longitude=${loc.lon}&timezone=auto&forecast_days=8` +
      `&current=temperature_2m,apparent_temperature,relative_humidity_2m,is_day,precipitation,weather_code,pressure_msl,wind_speed_10m,wind_direction_10m` +
      `&hourly=temperature_2m,weather_code,precipitation_probability,visibility,uv_index` +
      `&daily=weather_code,temperature_2m_max,temperature_2m_min,precipitation_probability_max,precipitation_sum,sunrise,sunset,uv_index_max,wind_speed_10m_max`;
    // Air Quality API ka URL: US AQI, PM2.5, PM10.
    const aqUrl = `${API.aq}?latitude=${loc.lat}&longitude=${loc.lon}&current=us_aqi,pm2_5,pm10`;
    // Dono API ek saath bulate hain (tez). Agar AQI fail ho jaye to .catch se null ho jata hai, taaki baaki page chalta rahe.
    const [wx, aq] = await Promise.all([getJSON(wxUrl), getJSON(aqUrl).catch(() => null)]);
    // Ab data ko screen ke alag alag hisson me bharte hain.
    renderCurrent(wx, loc);
    renderAQI(aq);
    renderHourly(wx);
    renderDaily(wx);
    // Data STATE me save karo (chart, audio aur wear suggestions ko chahiye).
    Object.assign(STATE, { wx, aq, loc });
    // Naya shehar aaya to purani audio band karo.
    stopSpeech();
    renderWear(wx, aq);
    setStatus('');
    ic();
    // Extras load in the background so the main page never waits on them
    renderYoY(wx, loc);
  } catch (e) {
    console.error(e);
    setStatus(e.message || 'Something went wrong while loading weather.', true);
  }
}

// HERO CARD + METRICS: shehar ka naam, temperature, condition, feels-like aur 6 metric cards bharta hai. Theme bhi yahin set hoti hai.
function renderCurrent(wx, loc) {
  const c = wx.current, h = wx.hourly;
  // Hourly data me "abhi" wale ghante ki position (index) dhundhta hai. UV aur visibility ghante-wise data me hoti hai, isliye yeh index chahiye.
  const idx = Math.max(0, h.time.indexOf(c.time.slice(0, 13) + ':00'));
  applyTheme(c.weather_code, c.is_day);
  $('place').textContent = loc.name;
  $('temp').textContent = Math.round(c.temperature_2m) + '°';
  $('cond').textContent = WMO(c.weather_code)[0];
  $('feels').textContent = `Feels like ${Math.round(c.apparent_temperature)}°C`;
  $('curIcon').setAttribute('data-lucide', icon(c.weather_code, c.is_day));
  const vis = h.visibility[idx] != null ? (h.visibility[idx] / 1000).toFixed(1) + ' km' : '--';
  // Metric cards ki list: [icon, naam, value]. Neeche map() se har ek ka HTML card banta hai.
  const m = [
    ['droplets', 'Humidity', c.relative_humidity_2m + '%'],
    ['wind', 'Wind', `${Math.round(c.wind_speed_10m)} km/h ${compass(c.wind_direction_10m)}`],
    ['sun', 'UV index', (h.uv_index[idx] ?? 0).toFixed(1)],
    ['eye', 'Visibility', vis],
    ['cloud-rain', 'Precipitation', c.precipitation + ' mm'],
    ['gauge', 'Pressure', Math.round(c.pressure_msl) + ' hPa']
  ];
  $('metrics').innerHTML = m.map(([i, l, v]) => `
    <div class="glass p-4 transition hover:-translate-y-1">
      <i data-lucide="${i}" class="w-5 h-5 sub"></i>
      <div class="sub text-sm mt-2">${l}</div><div class="text-xl font-semibold">${v}</div>
    </div>`).join('');
  // Index save karo; renderHourly ko "ab se" shuru karne ke liye chahiye.
  wx._idx = idx;
}

// AQI CARD: US AQI number ke hisaab se category, rang aur health tip dikhata hai.
function renderAQI(aq) {
  const box = $('aqi');
  if (!aq?.current || aq.current.us_aqi == null) { box.innerHTML = '<p class="sub">Air quality data is unavailable for this location.</p>'; return; }
  const v = Math.round(aq.current.us_aqi);
  // AQI ke levels: [upar ki seema, naam, rang, tip]. .find() pehla level deta hai jisme value fit ho.
  // Jaise AQI 62 -> 100 se chhota hai -> "Moderate".
  const L = [
    [50, 'Good', '#22c55e', 'Air is clean. Great day to be outside.'],
    [100, 'Moderate', '#eab308', 'Acceptable. Unusually sensitive people should take it easy outdoors.'],
    [150, 'Unhealthy for sensitive groups', '#f97316', 'Children, older adults and people with asthma should limit long outdoor effort.'],
    [200, 'Unhealthy', '#ef4444', 'Reduce prolonged outdoor exertion. Consider a mask outside.'],
    [300, 'Very unhealthy', '#a855f7', 'Stay indoors where possible and keep windows closed.'],
    [Infinity, 'Hazardous', '#9f1239', 'Avoid going outside. Use an air purifier indoors.']
  ].find(x => v <= x[0]);
  box.innerHTML = `
    <div class="flex items-center justify-between"><h3 class="font-semibold">Air quality (US AQI)</h3>
      <span class="px-3 py-1 rounded-full text-white text-sm font-medium" style="background:${L[2]}">${L[1]}</span></div>
    <div class="text-5xl font-semibold mt-2" style="color:${L[2]}">${v}</div>
    <div class="h-2 rounded-full mt-3 bg-black/10 overflow-hidden"><div class="h-full rounded-full" style="width:${Math.min(100, v / 3)}%;background:${L[2]}"></div></div>
    <p class="text-sm mt-3">${L[3]}</p>
    <p class="text-xs sub mt-2">PM2.5 ${aq.current.pm2_5} µg/m³ · PM10 ${aq.current.pm10} µg/m³</p>`;
}

// HOURLY CARDS: abhi se aaj raat 12 baje tak ke har ghante ka card (time, icon, temperature, barish ka chance).
function renderHourly(wx) {
  const h = wx.hourly, start = wx._idx;
  const today = h.time[start].slice(0, 10);
  let end = start;
  while (end < h.time.length && h.time[end].slice(0, 10) === today) end++;
  // Agar din ke kuch hi ghante bache hon to kam se kam 8 cards dikhao.
  if (end - start < 8) end = start + 8;
  let out = '';
  for (let i = start; i < end; i++) {
    const hr = +h.time[i].slice(11, 13);
    const day = hr >= 6 && hr < 19 ? 1 : 0;
    out += `<div class="hour glass p-3 text-center shrink-0 ${i === start ? 'ring-2 ring-white/70' : ''}">
      <div class="text-sm sub">${i === start ? 'Now' : fmtHour(hr)}</div>
      <i data-lucide="${icon(h.weather_code[i], day)}" class="w-7 h-7 mx-auto my-2"></i>
      <div class="font-semibold">${Math.round(h.temperature_2m[i])}°</div>
      <div class="text-xs sub flex items-center justify-center gap-1 mt-1"><i data-lucide="droplet" class="w-3 h-3"></i>${h.precipitation_probability[i] ?? 0}%</div>
    </div>`;
  }
  $('hourly').innerHTML = out;
}

// KAL KA CARD + 7 DIN KI ROW: kal ka detail card aur neeche 7 din ka chhota summary banata hai, phir chart banata hai.
function renderDaily(wx) {
  const d = wx.daily;
  const t = 1; // tomorrow
  const [name, , ] = WMO(d.weather_code[t]);
  const rows = [
    ['thermometer', 'High / Low', `${Math.round(d.temperature_2m_max[t])}° / ${Math.round(d.temperature_2m_min[t])}°`],
    ['cloud-rain', 'Rain chance', `${d.precipitation_probability_max[t] ?? 0}%`],
    ['droplets', 'Rainfall', `${d.precipitation_sum[t]} mm`],
    ['wind', 'Max wind', `${Math.round(d.wind_speed_10m_max[t])} km/h`],
    ['sun', 'UV peak', d.uv_index_max[t].toFixed(1)],
    ['sunrise', 'Sunrise', d.sunrise[t].slice(11)],
    ['sunset', 'Sunset', d.sunset[t].slice(11)]
  ];
  $('tomorrow').innerHTML = `
    <h2 class="text-lg font-semibold">Tomorrow</h2>
    <p class="sub text-sm">${dayName(d.time[t], { weekday: 'long', month: 'short', day: 'numeric' })}</p>
    <div class="flex items-center gap-3 my-3"><i data-lucide="${icon(d.weather_code[t])}" class="w-12 h-12"></i><span class="text-xl font-medium">${name}</span></div>
    <ul class="space-y-2">${rows.map(r => `<li class="flex justify-between text-sm border-b pb-1" style="border-color:var(--gb)">
      <span class="sub flex items-center gap-2"><i data-lucide="${r[0]}" class="w-4 h-4"></i>${r[1]}</span><b>${r[2]}</b></li>`).join('')}</ul>`;

  // 7 din ki row: har din ka naam, icon aur max temperature.
  $('week').innerHTML = d.time.slice(0, 7).map((x, i) => `
    <div><div class="sub">${i === 0 ? 'Today' : dayName(x)}</div>
    <i data-lucide="${icon(d.weather_code[i])}" class="w-5 h-5 mx-auto my-1"></i>
    <div class="font-semibold">${Math.round(d.temperature_2m_max[i])}°</div></div>`).join('');

  // Chart ko data chahiye, isliye STATE me rakho aur chart banao.
  STATE.wx = wx;
  drawChart(chartView);
}

/* ---------- Chart: 1-day (hourly) and 7-day views ---------- */
// CHART BANANA: view = "day" (aaj ke 24 ghante) ya "week" (7 din). Dono me line chart banta hai.
// Daayi taraf alag axis (y1) barish ke chance (%) ke liye hai.
function drawChart(view) {
  const wx = STATE.wx, d = wx.daily, h = wx.hourly;
  // Chart ke text ka rang theme se lete hain, taaki dark theme me bhi dikhe.
  const tc = getComputedStyle(document.body).getPropertyValue('--tx').trim() || '#123';
  let labels, sets;
  // Aaj ke 24 ghanton ka data (temperature + barish chance). i0 = aaj ke 12 AM ki position.
  if (view === 'day') {
    const i0 = Math.max(0, h.time.findIndex(t => t.startsWith(d.time[0])));
    const r = a => a.slice(i0, i0 + 24);
    labels = r(h.time).map(t => fmtHour(+t.slice(11, 13)));
    sets = [
      { label: 'Temp °C', data: r(h.temperature_2m), borderColor: '#fb923c', backgroundColor: 'rgba(251,146,60,.22)', tension: .4, fill: true, pointRadius: 2 },
      { label: 'Rain chance %', data: r(h.precipitation_probability), borderColor: '#a78bfa', borderDash: [5, 5], tension: .4, yAxisID: 'y1', pointRadius: 0 }
    ];
  } else {
    labels = d.time.slice(0, 7).map((x, i) => i === 0 ? 'Today' : dayName(x));
    sets = [
      { label: 'High °C', data: d.temperature_2m_max.slice(0, 7), borderColor: '#fb923c', backgroundColor: 'rgba(251,146,60,.2)', tension: .4, fill: true, pointRadius: 4 },
      { label: 'Low °C', data: d.temperature_2m_min.slice(0, 7), borderColor: '#38bdf8', backgroundColor: 'rgba(56,189,248,.15)', tension: .4, fill: true, pointRadius: 4 },
      { label: 'Rain chance %', data: d.precipitation_probability_max.slice(0, 7), borderColor: '#a78bfa', borderDash: [5, 5], tension: .4, yAxisID: 'y1', pointRadius: 3 }
    ];
  }
  // Purana chart hatao, nahi to naye ke upar chipak jata hai.
  if (chart) chart.destroy();
  // Chart.js se naya chart banao. responsive = screen ke saath size badle; tooltip pe hover karne par us din ki saari lines dikhti hain.
  chart = new Chart($('chart'), {
    type: 'line',
    data: { labels, datasets: sets },
    options: {
      responsive: true, maintainAspectRatio: false,
      interaction: { mode: 'index', intersect: false },
      plugins: { legend: { labels: { color: tc, usePointStyle: true } } },
      scales: {
        x: { ticks: { color: tc, maxTicksLimit: view === 'day' ? 8 : 7 }, grid: { display: false } },
        y: { ticks: { color: tc }, grid: { color: 'rgba(128,128,128,.2)' } },
        y1: { position: 'right', min: 0, max: 100, ticks: { color: tc }, grid: { display: false } }
      }
    }
  });
}
// Chart ke tabs: click par view badlo, active tab ko highlight karo aur chart dobara banao.
document.querySelectorAll('[data-view]').forEach(b => b.addEventListener('click', () => {
  chartView = b.dataset.view;
  document.querySelectorAll('[data-view]').forEach(x => x.classList.toggle('on', x === b));
  if (STATE.wx) drawChart(chartView);
}));

/* ---------- What to wear + activities (rule-based on temp, rain, UV, wind, AQI) ---------- */
// WHAT TO WEAR + ACTIVITIES: simple rules (if-else) se kapde aur activity batata hai. Koi AI nahi; temperature, barish, UV, hawa aur AQI dekhta hai.
function renderWear(wx, aq) {
  const c = wx.current, d = wx.daily;
  const feels = c.apparent_temperature, rainP = d.precipitation_probability_max[0] ?? 0;
  const uv = d.uv_index_max[0] ?? 0, wind = c.wind_speed_10m, aqi = aq?.current?.us_aqi ?? 0, code = c.weather_code;
  // wet = True agar abhi baarish ho rahi hai, ya aaj barish ka chance 60% se zyada hai.
  const wet = isRainCode(code) || c.precipitation > 0 || rainP >= 60;
  const snow = isSnowCode(code), storm = code >= 95;
  // Do khali lists: kapde (wear) aur activities (act). Neeche rules inme suggestions daalte hain.
  const wear = [], act = [];

  // KAPDE: "feels like" temperature ke hisaab se (8 se kam: bhaari jacket ... 27 se zyada: halke kapde).
  if (feels <= 8) wear.push(['thermometer-snowflake', 'Heavy jacket, warm layers, gloves and a scarf']);
  else if (feels <= 16) wear.push(['shirt', 'Light jacket or a sweater over a full-sleeve top']);
  else if (feels <= 27) wear.push(['shirt', 'T-shirt or a light shirt. Keep a thin layer for the evening']);
  else wear.push(['shirt', 'Loose, breathable cotton in light colours']);
  if (feels >= 33) wear.push(['droplets', 'Carry water and drink often']);
  if (wet) wear.push(['umbrella', 'Take an umbrella and water-resistant shoes']);
  else if (rainP >= 30) wear.push(['umbrella', `Keep a compact umbrella handy (${rainP}% chance of rain)`]);
  if (uv >= 6) wear.push(['sun', `UV peaks at ${uv.toFixed(0)}. Use SPF 30+ sunscreen, sunglasses and a cap`]);
  else if (uv >= 3 && c.is_day) wear.push(['sun', 'Sunglasses and sunscreen for the midday sun']);
  if (wind >= 30) wear.push(['wind', 'It is windy. A windbreaker will help']);
  if (aqi > 100) wear.push(['shield-alert', 'Air quality is poor. Wear an N95 mask outside']);

  // ACTIVITIES: pehle sabse zaruri condition dekhte hain (storm, kharab hawa, baarish, thand, garmi), baaki me bahar ki activity.
  if (storm) act.push(['house', 'Thunderstorm outside. Stay in, watch a film or read']);
  else if (aqi > 150) act.push(['dumbbell', 'Skip outdoor exercise. Try an indoor workout or yoga']);
  else if (wet) { act.push(['coffee', 'Good day for a café or a museum']); act.push(['book-open', 'Catch up on a book or a series at home']); }
  else if (snow || feels <= 8) { act.push(['coffee', 'Hot drink and a short walk while the sun is out']); act.push(['mountain', 'Winter hikes need proper boots and layers']); }
  else if (feels >= 34) { act.push(['bike', 'Exercise early morning or after sunset']); act.push(['waves', 'Beat the heat with a swim or an indoor plan']); }
  else { act.push(['footprints', 'Great weather for an outdoor run or brisk walk']); act.push(['bike', 'Try cycling, or a picnic in the park']); }
  if (!c.is_day && !wet && code <= 1) act.push(['moon', 'Clear night sky. Good for stargazing']);

  // Har list ke pehle 4 suggestions ko chhote chip boxes me badalta hai.
  const list = (items) => items.slice(0, 4).map(([i, t]) => `<div class="chip"><i data-lucide="${i}" class="w-5 h-5 shrink-0 mt-0.5"></i><span>${t}</span></div>`).join('');
  $('wear').innerHTML = `<div><h3 class="font-medium mb-2 sub">Wear and carry</h3><div class="space-y-2">${list(wear)}</div></div>
    <div><h3 class="font-medium mb-2 sub">Best activities</h3><div class="space-y-2">${list(act)}</div></div>`;
}

/* ---------- Audio weather summary (window.speechSynthesis) ----------
   Builds a spoken summary in Hindi or English: greeting by local time, temperature,
   condition, and an evening rain note taken from the hourly forecast. */
// Hindi number words (0-100) so a Hindi voice never has to guess how to read digits
const HI_NUM = ('शून्य एक दो तीन चार पाँच छह सात आठ नौ दस ग्यारह बारह तेरह चौदह पंद्रह सोलह सत्रह अठारह उन्नीस बीस ' +
  'इक्कीस बाईस तेईस चौबीस पच्चीस छब्बीस सत्ताईस अट्ठाईस उनतीस तीस इकतीस बत्तीस तैंतीस चौंतीस पैंतीस छत्तीस सैंतीस अड़तीस उनतालीस चालीस ' +
  'इकतालीस बयालीस तैंतालीस चौवालीस पैंतालीस छियालीस सैंतालीस अड़तालीस उनचास पचास इक्यावन बावन तिरपन चौवन पचपन छप्पन सत्तावन अट्ठावन उनसठ साठ ' +
  'इकसठ बासठ तिरसठ चौंसठ पैंसठ छियासठ सड़सठ अड़सठ उनहत्तर सत्तर इकहत्तर बहत्तर तिहत्तर चौहत्तर पचहत्तर छिहत्तर सतहत्तर अठहत्तर उन्यासी अस्सी ' +
  'इक्यासी बयासी तिरासी चौरासी पचासी छियासी सत्तासी अट्ठासी नवासी नब्बे इक्यानवे बानवे तिरानवे चौरानवे पंचानवे छियानवे सत्तानवे अट्ठानवे निन्यानवे सौ').split(' ');
// Number ko Hindi shabd me badalta hai (24 -> "चौबीस"), taaki Hindi voice ginti sahi bole. Negative ho to "माइनस" lagata hai.
function hiNum(x) {
  const n = Math.round(x), a = Math.abs(n);
  const w = a <= 100 ? HI_NUM[a] : HI_NUM[Math.floor(a / 100)] + ' सौ' + (a % 100 ? ' ' + HI_NUM[a % 100] : '');
  return (n < 0 ? 'माइनस ' : '') + w;
}
// Weather condition words: index from condIdx()
// Weather condition ke naam teen bhashaon me. Index condIdx() deta hai.
const COND = {
  hi: ['साफ़ आसमान', 'आंशिक रूप से बादल', 'घने बादल', 'कोहरा', 'बूंदाबांदी', 'बारिश', 'बर्फबारी', 'बारिश की बौछारें', 'बर्फ की बौछारें', 'आंधी-तूफ़ान'],
  hinglish: ['saaf aasmaan', 'aanshik roop se baadal', 'ghane baadal', 'kohra', 'boondabaandi', 'baarish', 'barfbaari', 'baarish ki bauchhaarein', 'barf ki bauchhaarein', 'aandhi-toofaan'],
  en: ['clear sky', 'partly cloudy skies', 'overcast skies', 'fog', 'drizzle', 'rain', 'snow', 'rain showers', 'snow showers', 'a thunderstorm']
};
// Weather code ko 0-9 ke index me badalta hai (COND list me se naam chunne ke liye).
const condIdx = c => c === 0 ? 0 : c <= 2 ? 1 : c === 3 ? 2 : c <= 48 ? 3 : c <= 57 ? 4 : c <= 67 ? 5 : c <= 77 ? 6 : c <= 82 ? 7 : c <= 86 ? 8 : 9;

/* mode: 'hi' (Devanagari for a Hindi voice) | 'hinglish' (Roman Hindi for an English-India voice) | 'en' */
// AUDIO TEXT BANANA: mode ke hisaab se poora bolne wala text banata hai. Isme greeting, temperature, condition, high/low, barish note, salah aur AQI hota hai.
function buildSpeech(mode) {
  const { wx, aq, loc } = STATE; if (!wx) return '';
  // Chhota helper: mode ke hisaab se teen text me se ek chunta hai (hi = Hindi, hn = Hinglish, en = English).
  const L = (hi, hn, en) => mode === 'hi' ? hi : mode === 'hinglish' ? hn : en;     // pick text by mode
  const N = x => mode === 'hi' ? hiNum(x) : (Math.round(x) < 0 ? 'minus ' : '') + Math.abs(Math.round(x));                    // number formatter
  const c = wx.current, d = wx.daily, h = wx.hourly;
  const hour = +c.time.slice(11, 13);                                                 // local hour at the searched place
  const generic = loc.name.startsWith('Current') || loc.name.startsWith('Map');
  const city = loc.name.split(',')[0];

  // Din ka hissa: 0 subah (5-12), 1 dopahar (12-5), 2 shaam (5-9), 3 raat. Greeting isi se chunti hai.
  const slot = hour >= 5 && hour < 12 ? 0 : hour < 17 ? 1 : hour < 21 ? 2 : 3;
  const greet = L(['सुप्रभात', 'शुभ दोपहर', 'शुभ संध्या', 'शुभ रात्रि'], ['Suprabhat', 'Shubh dopahar', 'Shubh sandhya', 'Shubh ratri'],
    ['Good morning', 'Good afternoon', 'Good evening', 'Good night'].map(x => x))[slot] ?? '';
  const greetTxt = Array.isArray(greet) ? greet[slot] : greet;

  // Highest rain chance between 5 PM and 9 PM today (only while that window is still ahead)
  const today = d.time[0];
  // Aaj shaam 5 se 9 baje ke beech ke ghanton ka barish chance nikalta hai. Inme se sabse zyada (eveP) baad me use hota hai.
  const eve = h.time.map((t, i) => [t, i]).filter(([t]) => t.startsWith(today) && +t.slice(11, 13) >= 17 && +t.slice(11, 13) <= 21)
    .map(([, i]) => h.precipitation_probability[i] ?? 0);
  const eveP = hour <= 21 && eve.length ? Math.max(...eve) : null;
  const dayP = d.precipitation_probability_max[0] ?? 0, tmrP = d.precipitation_probability_max[1] ?? 0;

  // BARISH KI LINE: shaam ko chance ho to shaam ka note, raat 9 ke baad ho to kal ka, warna poore din ka, aur kam ho to "barish kam hai".
  let rain;
  if (eveP !== null && eveP >= 25) {
    const k = eveP >= 70 ? 0 : eveP >= 40 ? 1 : 2;
    const kind = L(['अच्छी बारिश', 'हल्की बारिश', 'हल्की बूंदाबांदी'], ['achhi baarish', 'halki baarish', 'halki boondabaandi'], ['good rain', 'light rain', 'a few light showers'])[k];
    rain = L(`शाम को ${kind} होने की संभावना है, लगभग ${N(eveP)} प्रतिशत।`, `Shaam ko ${kind} hone ki sambhavna hai, lagbhag ${N(eveP)} percent.`, `There is a chance of ${kind} this evening, around ${N(eveP)} percent.`);
  } else if (hour > 21 && tmrP >= 40) {
    rain = L(`कल बारिश की संभावना ${N(tmrP)} प्रतिशत है।`, `Kal baarish ki sambhavna ${N(tmrP)} percent hai.`, `Tomorrow has a ${N(tmrP)} percent chance of rain.`);
  } else if (dayP >= 40) {
    rain = L(`आज दिन में बारिश की संभावना ${N(dayP)} प्रतिशत है।`, `Aaj din mein baarish ki sambhavna ${N(dayP)} percent hai.`, `There is a ${N(dayP)} percent chance of rain during the day.`);
  } else {
    rain = L('आज बारिश की संभावना कम है।', 'Aaj baarish ki sambhavna kam hai.', 'Rain is unlikely today.');
  }

  // Chhoti salah: chhata, paani, dhoop se bachav, garm kapde.
  const tips = [];
  if (Math.max(eveP ?? 0, dayP) >= 40) tips.push(L('छाता साथ रखें।', 'Chhaata saath rakhein.', 'Carry an umbrella.'));
  if (c.apparent_temperature >= 33) tips.push(L('खूब पानी पीते रहें।', 'Khoob paani peete rahein.', 'Stay hydrated.'));
  if ((d.uv_index_max[0] ?? 0) >= 6) tips.push(L('यूवी इंडेक्स ज़्यादा है, धूप से बचें।', 'UV index zyada hai, dhoop se bachein.', 'UV is high, protect yourself from the sun.'));
  if (c.apparent_temperature <= 10) tips.push(L('गर्म कपड़े पहनें।', 'Garm kapde pehnein.', 'Dress warmly.'));

  // Hawa ki quality ki line (agar AQI data mila ho).
  let aqiLine = '';
  if (aq?.current?.us_aqi != null) {
    const v = aq.current.us_aqi, k = v <= 50 ? 0 : v <= 100 ? 1 : v <= 150 ? 2 : v <= 200 ? 3 : 4;
    const nm = L(['अच्छी', 'मध्यम', 'संवेदनशील लोगों के लिए हानिकारक', 'खराब', 'बहुत खराब'], ['achhi', 'madhyam', 'sensitive logon ke liye haanikaarak', 'kharab', 'bahut kharab'],
      ['good', 'moderate', 'unhealthy for sensitive groups', 'unhealthy', 'very unhealthy'])[k];
    aqiLine = L(`हवा की गुणवत्ता ${nm} है, एक्यूआई ${N(v)}।`, `Hawa ki quality ${nm} hai, AQI ${N(v)}.`, `Air quality is ${nm}, with an AQI of ${N(v)}.`);
  }

  // Jagah ka naam (jaise "Delhi में"). Agar naam "Current location" ho to "आपके स्थान पर".
  const where = generic ? L('आपके स्थान पर', 'Aapke location par', 'at your location') : L(`${city} में`, `${city} mein`, `in ${city}`);
  const cond = COND[mode][condIdx(c.weather_code)];
  // Pehle do vakya: greeting + abhi ka temperature, aur aaj ka high/low.
  const parts = L(
    [`${greetTxt}! ${where} अभी तापमान ${N(c.temperature_2m)} डिग्री सेल्सियस है और मौसम ${cond} है।`, `आज अधिकतम तापमान ${N(d.temperature_2m_max[0])} और न्यूनतम ${N(d.temperature_2m_min[0])} डिग्री रहेगा।`],
    [`${greetTxt}! ${where} abhi temperature ${N(c.temperature_2m)} degree Celsius hai aur mausam ${cond} hai.`, `Aaj ka maximum temperature ${N(d.temperature_2m_max[0])} aur minimum ${N(d.temperature_2m_min[0])} degree rahega.`],
    [`${greetTxt}! The temperature ${where} is ${N(c.temperature_2m)} degrees Celsius with ${cond}.`, `Today's high is ${N(d.temperature_2m_max[0])} and the low is ${N(d.temperature_2m_min[0])}.`]);
  // Sab tukde jodkar ek text banao (khali hisse hata ke).
  return [...parts, rain, ...tips, aqiLine].filter(Boolean).join(' ');
}

let speakId = 0;   // guards against a cancelled utterance resetting the UI of a newer one
function setSpeakUI(on) {
  const el = $('speakTxt'); if (el) el.textContent = on ? 'Playing...' : 'Play Audio Summary';
  const st = $('stopBtn'); if (st) st.disabled = !on;
}
// Audio band karo. speakId badhane se purani audio ke "khatam hua" signal ignore ho jate hain.
function stopSpeech() {
  speakId++;
  if ('speechSynthesis' in window) speechSynthesis.cancel();
  setSpeakUI(false);
}
// Stop button dabane par audio band.
$('stopBtn').addEventListener('click', stopSpeech);

// Voice picker: list the voices that suit the chosen language, best-sounding first
// Voice ko number dena: "Natural/Online" sabse achhi, phir Google, phir Microsoft. Upar wali voice default me chunte hain.
const voiceRank = v => (/natural|online/i.test(v.name) ? 3 : 0) + (/google/i.test(v.name) ? 2 : 0) + (/microsoft/i.test(v.name) ? 1 : 0);
// Device ki saari voices me se chuni hui bhasha ke liye suitable voices nikalta hai (Hindi ke liye hi-IN, baaki ke liye English; en-IN pehle).
function voicesFor(mode) {
  const all = ('speechSynthesis' in window) ? speechSynthesis.getVoices() : [];
  const list = mode === 'hi' ? all.filter(v => v.lang.toLowerCase().replace('_', '-').startsWith('hi')) : all.filter(v => /^en/i.test(v.lang));
  return list.sort((a, b) => (mode !== 'hi' ? (b.lang === 'en-IN') - (a.lang === 'en-IN') : 0) || voiceRank(b) - voiceRank(a));
}
// Voice dropdown bharta hai. Agar ek hi voice ho to dropdown chhupa deta hai.
function fillVoices() {
  const sel = $('voiceSel'), list = voicesFor($('speakLang').value);
  sel.innerHTML = list.map(v => `<option value="${v.voiceURI}">${v.name}</option>`).join('');
  sel.classList.toggle('hidden', list.length < 2);
}
// Voices kuch browsers me der se load hoti hain; load hote hi dropdown dobara bharo.
if ('speechSynthesis' in window) speechSynthesis.addEventListener('voiceschanged', fillVoices);
$('speakLang').addEventListener('change', fillVoices);
fillVoices();

// Voices load asynchronously in some browsers, so wait briefly if the list is still empty
// Agar voices ki list abhi khali hai to 1.5 second tak load hone ka intezaar karo.
function ensureVoices() {
  const synth = speechSynthesis;
  if (synth.getVoices().length) return Promise.resolve();
  return new Promise(res => {
    const t = setTimeout(res, 1500);
    synth.addEventListener('voiceschanged', () => { clearTimeout(t); res(); }, { once: true });
  });
}

// PLAY AUDIO SUMMARY: button dabane par yeh chalta hai.
// Steps: purani audio roko -> voices ka intezaar -> bhasha/voice chuno -> text banao -> boliye.
$('speakBtn').addEventListener('click', async () => {
  if (!('speechSynthesis' in window)) return setStatus('Your browser does not support audio summaries.', true);
  const synth = window.speechSynthesis;
  synth.cancel();                                   // restart cleanly if already playing
  await ensureVoices(); fillVoices();
  let mode = $('speakLang').value, list = voicesFor(mode);
  // Hindi voice device me nahi hai to Hinglish me bolo (English voice Devanagari galat padhti hai).
  if (mode === 'hi' && !list.length) {
    // No Hindi voice installed: Devanagari read by an English voice sounds wrong, so speak Roman Hindi instead
    mode = 'hinglish'; list = voicesFor('hinglish');
    setStatus('Is device me Hindi voice nahi mili, isliye Hinglish me bol raha hoon. Behtar Hindi ke liye system settings (Speech) me Hindi voice add karein.', true);
  }
  // Dropdown me jo voice chuni gayi wahi, warna list ki sabse achhi voice.
  const chosen = ($('speakLang').value === mode && list.find(v => v.voiceURI === $('voiceSel').value)) || list[0];
  const text = buildSpeech(mode);
  if (!text) return setStatus('Weather is still loading. Try again in a moment.', true);
  // Utterance = bolne wali cheez. Text, voice, speed (rate) yahan set hoti hai. synth.speak() se boli jati hai.
  const u = new SpeechSynthesisUtterance(text);
  if (chosen) { u.voice = chosen; u.lang = chosen.lang; } else u.lang = mode === 'hi' ? 'hi-IN' : 'en-IN';
  u.rate = .92; u.pitch = 1;
  // Is audio ka number. Audio khatam hone par UI tabhi badlo jab koi nayi audio na shuru hui ho.
  const id = ++speakId;
  u.onend = u.onerror = () => { if (id === speakId) setSpeakUI(false); };
  setTimeout(() => synth.speak(u), 80);             // small delay: Chrome can drop speak() right after cancel()
  setSpeakUI(true);
});

/* ---------- Year-over-year comparison (Open-Meteo Archive API) ---------- */
// YEAR OVER YEAR: Archive API se pichhle saal ki usi tareekh ka high/low laakar aaj se compare karta hai.
async function renderYoY(wx, loc) {
  const box = $('yoy');
  box.innerHTML = '<p class="sub">Loading comparison...</p>';
  try {
    const today = wx.daily.time[0];
    // Aaj ki date todkar saal, mahina, din nikalo; pichhle saal ki wahi date banane ke liye (29 Feb ho to 28 Feb).
    let [y, m, dd] = today.split('-').map(Number);
    if (m === 2 && dd === 29) dd = 28;                       // leap-day safe
    const ly = `${y - 1}-${pad(m)}-${pad(dd)}`;
    // Archive API se pichhle saal ka us din ka max/min temperature aur barish.
    const j = await getJSON(`${API.arch}?latitude=${loc.lat}&longitude=${loc.lon}&start_date=${ly}&end_date=${ly}&daily=temperature_2m_max,temperature_2m_min,precipitation_sum&timezone=auto`);
    const a = j.daily;
    if (!a || a.temperature_2m_max[0] == null) throw new Error('No archive data for that date');
    const nowHi = wx.daily.temperature_2m_max[0], nowLo = wx.daily.temperature_2m_min[0];
    const thenHi = a.temperature_2m_max[0], thenLo = a.temperature_2m_min[0];
    // Aaj ka average (high+low)/2 minus pichhle saal ka average. Plus = zyada garam, minus = zyada thanda.
    const diff = (nowHi + nowLo) / 2 - (thenHi + thenLo) / 2;
    const warm = diff > 0.4, cool = diff < -0.4;
    // Badge: 0.4 degree se zyada farak ho to warmer/cooler, warna "About the same".
    const badge = warm ? ['#f97316', 'trending-up', `${diff.toFixed(1)}°C warmer`] : cool ? ['#38bdf8', 'trending-down', `${Math.abs(diff).toFixed(1)}°C cooler`] : ['#22c55e', 'minus', 'About the same'];
    const col = (title, hi, lo, rain) => `<div class="rounded-2xl p-3 border" style="border-color:var(--gb)">
      <div class="sub text-sm">${title}</div>
      <div class="text-2xl font-semibold mt-1">${Math.round(hi)}° <span class="text-base font-normal sub">/ ${Math.round(lo)}°</span></div>
      <div class="text-xs sub mt-1">Rain ${rain ?? 0} mm</div></div>`;
    box.innerHTML = `<h2 class="text-lg font-semibold">Year over year</h2>
      <p class="sub text-sm mb-3">Today vs the same date last year (${dayName(ly, { month: 'short', day: 'numeric', year: 'numeric' })})</p>
      <div class="grid grid-cols-2 gap-3">${col('Today', nowHi, nowLo, wx.daily.precipitation_sum[0])}${col('Last year', thenHi, thenLo, a.precipitation_sum[0])}</div>
      <div class="mt-3 inline-flex items-center gap-2 px-3 py-1.5 rounded-full text-white text-sm font-medium" style="background:${badge[0]}">
        <i data-lucide="${badge[1]}" class="w-4 h-4"></i>${badge[2]} than the same day last year</div>`.replace('About the same than', 'About the same as');
    ic();
  } catch (e) {
    console.error(e);
    box.innerHTML = '<h2 class="text-lg font-semibold">Year over year</h2><p class="sub mt-2">Last year\'s data is not available for this location right now.</p>';
  }
}

/* ---------- Travel matcher ---------- */
// TRAVEL MATCHER KE RULES: har vibe ke liye ek test function. Din ka data (avg, max, code, rain) deta hai, True/False aata hai.
// Pleasant: average 18-25. Warm: max 26-33 aur saaf mausam. Rainy: 1mm+ barish ya barish ka code. Cold: average 15 se kam.
const VIBES = {
  pleasant: { label: 'Pleasant / Cool', test: d => d.avg >= 18 && d.avg <= 25 },
  warm: { label: 'Warm / Sunny', test: d => d.max >= 26 && d.max <= 33 && d.code <= 2 },
  rainy: { label: 'Rainy vibe', test: d => d.rain >= 1 || isRainCode(d.code) },
  cold: { label: 'Cold', test: d => d.avg < 15 }
};

// TRAVEL FINDER: destination ke agle 16 din ka forecast laakar vibe se match karta hai.
async function findTravelDays(e) {
  e.preventDefault();
  const out = $('travelOut');
  try {
    out.innerHTML = '<p class="sub">Checking 16 days of forecast...</p>';
    // Destination shehar dhundho (India-first).
    const loc = await geocode($('destInput').value.trim());
    const d = (await getJSON(`${API.wx}?latitude=${loc.lat}&longitude=${loc.lon}&timezone=auto&forecast_days=16` +
      `&daily=weather_code,temperature_2m_max,temperature_2m_min,precipitation_sum,precipitation_probability_max`)).daily;
    const vibe = VIBES[$('vibe').value];
    // API ke alag alag arrays ko "ek din = ek object" me badalta hai, taaki filter karna aasaan ho.
    const days = d.time.map((t, i) => ({
      date: t, code: d.weather_code[i], max: d.temperature_2m_max[i], min: d.temperature_2m_min[i],
      avg: (d.temperature_2m_max[i] + d.temperature_2m_min[i]) / 2,
      rain: d.precipitation_sum[i] ?? 0, prob: d.precipitation_probability_max[i] ?? 0
    }));
    // FILTER: hit = vibe se match karne wale din, miss = baaki din.
    const hit = days.filter(vibe.test), miss = days.filter(x => !vibe.test(x));
    // Ek din ka card banata hai. ok = True ho to hara "Ideal Trip Day" card, warna dhundhla card.
    const card = (x, ok) => `
      <div class="${ok ? 'ideal' : 'glass dim'} p-4 rounded-2xl">
        ${ok ? '<div class="text-xs font-bold mb-1 flex items-center gap-1"><i data-lucide="sparkles" class="w-4 h-4"></i>Ideal Trip Day</div>' : ''}
        <div class="font-semibold">${dayName(x.date, { weekday: 'short', month: 'short', day: 'numeric' })}</div>
        <div class="flex items-center gap-2 my-2"><i data-lucide="${icon(x.code)}" class="w-7 h-7"></i><span class="text-sm">${WMO(x.code)[0]}</span></div>
        <div class="text-lg font-semibold">${Math.round(x.max)}° <span class="text-sm font-normal opacity-75">/ ${Math.round(x.min)}°</span></div>
        <div class="text-xs opacity-80 mt-1">Rain ${x.prob}% · ${x.rain} mm</div>
      </div>`;
    let html = `<h3 class="font-semibold mb-3">${loc.name} · ${vibe.label}</h3>`;
    // Match mile: matching din upar (green), baaki "Other Forecasted Days" me neeche.
    if (hit.length) {
      html += `<div class="mb-2 font-medium text-green-500">${hit.length} matching day${hit.length > 1 ? 's' : ''}</div>
        <div class="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-3">${hit.map(x => card(x, true)).join('')}</div>`;
      if (miss.length) html += `<h4 class="mt-6 mb-2 sub font-medium">Other Forecasted Days</h4>
        <div class="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-3">${miss.map(x => card(x, false)).join('')}</div>`;
    } else {
      // Koi din match nahi hua: saaf message dikhao aur saare din normal (neutral) style me.
      html += `<div class="rounded-2xl p-4 mb-4 border" style="border-color:var(--gb)"><b>No exact matches found for your vibe in the next 16 days.</b></div>
        <div class="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-3">${days.map(x => card(x, false).replace('glass dim', 'glass')).join('')}</div>`;
    }
    out.innerHTML = html;
    ic();
  } catch (err) {
    console.error(err);
    out.innerHTML = `<p style="color:#ef4444">${err.message}</p>`;
  }
}

/* ---------- Init ---------- */
// SEARCH BUTTON: form submit hone par shehar dhundho aur uska weather dikhao.
$('searchForm').addEventListener('submit', async e => {
  e.preventDefault();
  $('sugg').classList.add('hidden');
  const q = $('cityInput').value.trim();
  if (!q) return;
  try { setStatus('Searching...'); await loadWeather(await geocode(q)); }
  catch (err) { setStatus(err.message, true); }
});
// Travel form submit hone par findTravelDays chalao.
$('travelForm').addEventListener('submit', findTravelDays);

// Browser se location maangta hai (Promise me). Fail ho to saaf message: permission band, location nahi mili, ya time out.
function getPosition() {
  return new Promise((res, rej) => {
    if (!navigator.geolocation) return rej(new Error('Your browser does not support location access.'));
    navigator.geolocation.getCurrentPosition(res, err => {
      const m = {
        1: 'Location permission is blocked. Allow location for this page in your browser settings, then press "Current location".',
        2: 'Your device could not work out its location. Check GPS/Wi-Fi and try again.',
        3: 'Finding your location took too long. Try again.'
      };
      rej(new Error(m[err.code] || 'Could not get your location.'));
    }, { enableHighAccuracy: true, timeout: 20000, maximumAge: 0 });
  });
}

// CURRENT LOCATION: location lekar weather dikhata hai. silentFallback = True (page khulte waqt) ho aur location fail ho jaye to Delhi dikha deta hai, par error message bhi rehta hai.
async function useCurrentLocation(silentFallback) {
  const btn = $('locBtn');
  btn.disabled = true;
  try {
    setStatus('Finding your location...');
    const p = await getPosition();
    const { latitude: lat, longitude: lon } = p.coords;
    $('cityInput').value = '';
    await loadWeather({ lat, lon, name: `Current location (${lat.toFixed(2)}°, ${lon.toFixed(2)}°)` });
  } catch (err) {
    setStatus(err.message, true);
    if (silentFallback) {
      // Show a default city so the page is not empty, but keep the error visible
      try { const d = await geocode('Delhi'); const msg = $('status').textContent; await loadWeather(d); setStatus(msg + ' Showing Delhi for now.', true); } catch (e) {}
    }
  } finally { btn.disabled = false; }
}

// "Current location" button dabane par.
$('locBtn').addEventListener('click', () => useCurrentLocation(false));
ic();
// PAGE KHULTE HI: icons banao aur apni location se weather dikhao.
useCurrentLocation(true);

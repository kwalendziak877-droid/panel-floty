const JSON_HEADERS = { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' };

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    if (!url.pathname.startsWith('/api/')) return env.ASSETS.fetch(request);
    try {
      if (url.pathname === '/api/config' && request.method === 'GET') {
        return json({ oneSignalAppId: env.ONESIGNAL_APP_ID || '', ownerAlias: env.ONESIGNAL_OWNER_ALIAS || 'fleet-owner' });
      }
      if (url.pathname === '/api/login' && request.method === 'POST') return login(request, env);
      if (url.pathname === '/api/logout' && request.method === 'POST') return logout();
      if (!(await authenticated(request, env))) return json({ error: 'Wymagane logowanie' }, 401);
      if (url.pathname === '/api/session' && request.method === 'GET') return json({ authenticated: true });
      if (url.pathname === '/api/vehicles' && request.method === 'GET') return listVehicles(env);
      if (url.pathname === '/api/vehicles' && request.method === 'PUT') return saveVehicle(request, env);
      if (url.pathname.startsWith('/api/vehicles/') && request.method === 'DELETE') return deleteVehicle(url, env);
      if (url.pathname === '/api/settings' && request.method === 'GET') return getSettings(env);
      if (url.pathname === '/api/settings' && request.method === 'PUT') return saveSettings(request, env);
      return json({ error: 'Nie znaleziono' }, 404);
    } catch (error) {
      console.error(error);
      return json({ error: 'Błąd serwera. Spróbuj ponownie.' }, 500);
    }
  },

  async scheduled(controller, env, ctx) {
    ctx.waitUntil(runReminders(env, controller.scheduledTime));
  }
};

function json(value, status = 200, headers = {}) {
  return new Response(JSON.stringify(value), { status, headers: { ...JSON_HEADERS, ...headers } });
}
async function body(request) {
  const value = await request.json();
  if (!value || typeof value !== 'object') throw new Error('Nieprawidłowe dane');
  return value;
}
function cookies(request) {
  return Object.fromEntries((request.headers.get('cookie') || '').split(';').map(x => x.trim().split('=').map(decodeURIComponent)).filter(x => x.length === 2));
}
async function digest(value) {
  const bytes = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value));
  return [...new Uint8Array(bytes)].map(x => x.toString(16).padStart(2, '0')).join('');
}
async function authenticated(request, env) {
  if (!env.SESSION_SECRET) return false;
  return cookies(request).fleet_session === await digest(env.SESSION_SECRET);
}
async function login(request, env) {
  const data = await body(request);
  if (!env.APP_PASSWORD || data.password !== env.APP_PASSWORD) return json({ error: 'Nieprawidłowe hasło' }, 401);
  const token = await digest(env.SESSION_SECRET);
  return json({ authenticated: true }, 200, { 'set-cookie': `fleet_session=${token}; Path=/; HttpOnly; Secure; SameSite=Strict; Max-Age=2592000` });
}
function logout() {
  return json({ authenticated: false }, 200, { 'set-cookie': 'fleet_session=; Path=/; HttpOnly; Secure; SameSite=Strict; Max-Age=0' });
}

async function listVehicles(env) {
  const result = await env.DB.prepare('SELECT * FROM vehicles ORDER BY registration COLLATE NOCASE').all();
  return json({ vehicles: result.results || [] });
}
function cleanText(value, max = 250) { return String(value || '').trim().slice(0, max); }
function validDate(value) { return value === '' || value == null || /^\d{4}-\d{2}-\d{2}$/.test(value); }
async function saveVehicle(request, env) {
  const v = await body(request);
  v.id = cleanText(v.id, 80); v.registration = cleanText(v.registration, 12).toUpperCase(); v.type = cleanText(v.type, 10);
  if (!v.id || !v.registration || !['truck', 'trailer'].includes(v.type)) return json({ error: 'Uzupełnij numer rejestracyjny i rodzaj pojazdu.' }, 400);
  for (const key of ['inspection', 'tachograph', 'oc', 'ac']) if (!validDate(v[key])) return json({ error: 'Nieprawidłowa data.' }, 400);
  await env.DB.prepare(`INSERT INTO vehicles (id,registration,type,brand,model,vin,inspection,tachograph,oc,ac,notes,updated_at)
    VALUES (?,?,?,?,?,?,?,?,?,?,?,datetime('now'))
    ON CONFLICT(id) DO UPDATE SET registration=excluded.registration,type=excluded.type,brand=excluded.brand,model=excluded.model,vin=excluded.vin,
    inspection=excluded.inspection,tachograph=excluded.tachograph,oc=excluded.oc,ac=excluded.ac,notes=excluded.notes,updated_at=datetime('now')`)
    .bind(v.id, v.registration, v.type, cleanText(v.brand, 80), cleanText(v.model, 80), cleanText(v.vin, 17).toUpperCase(), v.inspection || '', v.tachograph || '', v.oc || '', v.ac || '', cleanText(v.notes, 1000)).run();
  return json({ vehicle: v });
}
async function deleteVehicle(url, env) {
  const id = decodeURIComponent(url.pathname.slice('/api/vehicles/'.length));
  await env.DB.prepare('DELETE FROM vehicles WHERE id = ?').bind(id).run();
  return json({ ok: true });
}

const DEFAULT_SETTINGS = { email: '', email_enabled: 1, push_enabled: 1, reminder_days: [30, 14, 7] };
async function getSettings(env) {
  const row = await env.DB.prepare('SELECT * FROM settings WHERE id = 1').first();
  if (!row) return json({ settings: DEFAULT_SETTINGS });
  return json({ settings: { ...row, reminder_days: safeDays(row.reminder_days) } });
}
function safeDays(value) {
  try { return JSON.parse(value || '[]').map(Number).filter(x => [1, 7, 14, 30].includes(x)); } catch { return [30, 14, 7]; }
}
async function saveSettings(request, env) {
  const s = await body(request);
  const value = { email: cleanText(s.email, 254), email_enabled: s.email_enabled ? 1 : 0, push_enabled: s.push_enabled ? 1 : 0, reminder_days: Array.isArray(s.reminder_days) ? s.reminder_days.map(Number).filter(x => [1, 7, 14, 30].includes(x)) : [] };
  await env.DB.prepare(`INSERT INTO settings (id,email,email_enabled,push_enabled,reminder_days,updated_at) VALUES (1,?,?,?,?,datetime('now'))
    ON CONFLICT(id) DO UPDATE SET email=excluded.email,email_enabled=excluded.email_enabled,push_enabled=excluded.push_enabled,reminder_days=excluded.reminder_days,updated_at=datetime('now')`)
    .bind(value.email, value.email_enabled, value.push_enabled, JSON.stringify(value.reminder_days)).run();
  return json({ settings: value });
}

export function warsawDate(timestamp = Date.now()) {
  const parts = new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Warsaw', year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(new Date(timestamp));
  const item = Object.fromEntries(parts.map(p => [p.type, p.value]));
  return `${item.year}-${item.month}-${item.day}`;
}
export function dateDifference(target, today) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(target || '') || !/^\d{4}-\d{2}-\d{2}$/.test(today || '')) return null;
  return Math.round((Date.parse(`${target}T00:00:00Z`) - Date.parse(`${today}T00:00:00Z`)) / 86400000);
}
export function remindersForVehicle(vehicle, today, reminderDays) {
  const fields = [['inspection', 'przegląd techniczny'], ['tachograph', 'legalizacja tachografu'], ['oc', 'ubezpieczenie OC'], ['ac', 'ubezpieczenie AC']];
  const wanted = new Set([0, ...reminderDays]);
  return fields.flatMap(([key, label]) => {
    const left = dateDifference(vehicle[key], today);
    return wanted.has(left) ? [{ key, label, date: vehicle[key], days: left }] : [];
  });
}
function describeReminder(vehicle, item) {
  const when = item.days === 0 ? 'kończy się dzisiaj' : `kończy się za ${item.days} dni`;
  return `${vehicle.registration}: ${item.label} ${when} (${item.date}).`;
}
function htmlEscape(value) { return String(value).replace(/[&<>'"]/g, c => ({ '&':'&amp;', '<':'&lt;', '>':'&gt;', "'":'&#39;', '"':'&quot;' }[c])); }

async function runReminders(env, timestamp = Date.now()) {
  const [vehicleResult, settingRow] = await Promise.all([
    env.DB.prepare('SELECT * FROM vehicles').all(),
    env.DB.prepare('SELECT * FROM settings WHERE id = 1').first()
  ]);
  const s = settingRow ? { ...settingRow, reminder_days: safeDays(settingRow.reminder_days) } : DEFAULT_SETTINGS;
  const today = warsawDate(timestamp);
  for (const vehicle of vehicleResult.results || []) {
    for (const item of remindersForVehicle(vehicle, today, s.reminder_days)) {
      const message = describeReminder(vehicle, item);
      if (Number(s.push_enabled) && env.ONESIGNAL_APP_ID && env.ONESIGNAL_REST_API_KEY) await sendOnce(env, `${vehicle.id}:${item.key}:${item.date}:push`, 'push', message);
      if (Number(s.email_enabled) && s.email && env.EMAIL_WEBHOOK_URL && env.EMAIL_WEBHOOK_SECRET) await sendOnce(env, `${vehicle.id}:${item.key}:${item.date}:email`, 'email', message, s.email);
    }
  }
}
async function sendOnce(env, key, channel, message, email = '') {
  const exists = await env.DB.prepare('SELECT 1 FROM notification_log WHERE notification_key = ?').bind(key).first();
  if (exists) return;
  let response;
  if (channel === 'push') {
    const payload = { app_id: env.ONESIGNAL_APP_ID, include_aliases: { external_id: [env.ONESIGNAL_OWNER_ALIAS || 'fleet-owner'] }, target_channel: 'push', headings: { en: 'Termin w Panelu Floty' }, contents: { en: message }, url: env.APP_URL || undefined };
    response = await fetch('https://api.onesignal.com/notifications', { method: 'POST', headers: { 'content-type': 'application/json', authorization: `Key ${env.ONESIGNAL_REST_API_KEY}` }, body: JSON.stringify(payload) });
    if (!response.ok) throw new Error(`OneSignal push: ${response.status} ${await response.text()}`);
  } else {
    const payload = { secret: env.EMAIL_WEBHOOK_SECRET, to: email, subject: 'Przypomnienie – Panel Floty', textBody: message, htmlBody: `<div style="font-family:Arial,sans-serif;color:#172033"><h2>Przypomnienie o terminie</h2><p>${htmlEscape(message)}</p><p><a href="${htmlEscape(env.APP_URL || '#')}">Otwórz Panel Floty</a></p></div>` };
    response = await fetch(env.EMAIL_WEBHOOK_URL, { method: 'POST', headers: { 'content-type': 'text/plain;charset=utf-8' }, body: JSON.stringify(payload), redirect: 'follow' });
    if (!response.ok) throw new Error(`Gmail webhook: ${response.status} ${await response.text()}`);
    const result = await response.json().catch(() => ({ ok: false }));
    if (!result.ok) throw new Error(`Gmail webhook: ${result.error || 'nieznany błąd'}`);
  }
  await env.DB.prepare('INSERT INTO notification_log (notification_key,channel,message,sent_at) VALUES (?,?,?,datetime(\'now\'))').bind(key, channel, message).run();
}

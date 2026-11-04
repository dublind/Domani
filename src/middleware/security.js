const crypto = require('crypto');
const logger = require('../utils/logger');

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

/**
 * Compara dos strings en tiempo constante para evitar timing attacks.
 */
function safeEqual(a, b) {
  const ha = crypto.createHash('sha256').update(String(a)).digest();
  const hb = crypto.createHash('sha256').update(String(b)).digest();
  return crypto.timingSafeEqual(ha, hb);
}

/**
 * Cabeceras de seguridad basicas para todas las respuestas.
 */
function securityHeaders(req, res, next) {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('Referrer-Policy', 'no-referrer');
  res.setHeader('Cache-Control', 'no-store');
  if (req.secure || req.headers['x-forwarded-proto'] === 'https') {
    res.setHeader('Strict-Transport-Security', 'max-age=31536000; includeSubDomains');
  }
  next();
}

// Bloqueo simple por IP tras varios intentos fallidos de login
const failedAttempts = new Map();
const MAX_FAILED = 10;
const BLOCK_MS = 15 * 60 * 1000;

function isBlocked(ip) {
  const entry = failedAttempts.get(ip);
  if (!entry) return false;
  if (Date.now() - entry.first > BLOCK_MS) {
    failedAttempts.delete(ip);
    return false;
  }
  return entry.count >= MAX_FAILED;
}

function registerFailure(ip) {
  const entry = failedAttempts.get(ip);
  if (!entry || Date.now() - entry.first > BLOCK_MS) {
    failedAttempts.set(ip, { count: 1, first: Date.now() });
  } else {
    entry.count++;
  }
}

const SESSION_COOKIE = 'domani_session';
const SESSION_HOURS = 8;

function sessionSecret() {
  // SESSION_SECRET recomendado; si falta se deriva de la clave (cambiar la clave invalida las sesiones)
  return process.env.SESSION_SECRET || `${process.env.PANEL_USER}:${process.env.PANEL_PASSWORD}:domani`;
}

function sign(value) {
  return crypto.createHmac('sha256', sessionSecret()).update(value).digest('base64url');
}

function createSessionCookie(user) {
  const expires = Date.now() + SESSION_HOURS * 3600 * 1000;
  const payload = Buffer.from(JSON.stringify({ u: user, e: expires })).toString('base64url');
  return `${payload}.${sign(payload)}`;
}

function readCookie(req, name) {
  const header = req.headers.cookie || '';
  for (const part of header.split(';')) {
    const [k, ...v] = part.trim().split('=');
    if (k === name) return decodeURIComponent(v.join('='));
  }
  return null;
}

function validSession(req) {
  const raw = readCookie(req, SESSION_COOKIE);
  if (!raw || !raw.includes('.')) return false;
  const [payload, sig] = raw.split('.');
  if (!safeEqual(sig, sign(payload))) return false;
  try {
    const data = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8'));
    return data.e > Date.now() && data.u === process.env.PANEL_USER;
  } catch (e) {
    return false;
  }
}

function cookieOptions(req) {
  const secure = req.secure || req.headers['x-forwarded-proto'] === 'https';
  return `Path=/; HttpOnly; SameSite=Strict; Max-Age=${SESSION_HOURS * 3600}${secure ? '; Secure' : ''}`;
}

function authConfigured() {
  return !!(process.env.PANEL_USER && process.env.PANEL_PASSWORD);
}

/**
 * Exige sesion iniciada. Paginas -> redirige a /login; API -> 401 JSON.
 * Si PANEL_USER / PANEL_PASSWORD no estan configurados, se bloquea todo (fail closed).
 */
function requireLogin(req, res, next) {
  if (authConfigured() && validSession(req)) return next();
  if (req.path.startsWith('/api/')) {
    return res.status(401).json({ success: false, error: 'Sesion requerida' });
  }
  return res.redirect('/login');
}

function escapeHtml(t) {
  return String(t).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

function loginPage(error = '') {
  return `<!DOCTYPE html>
<html lang="es">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Domani - Iniciar sesion</title>
  <style>
    :root { --red:#C8102E; --red-dark:#9B0D22; --off-white:#FAF7F5; --gray-200:#E8E0DC; --gray-500:#9A8A85; --gray-900:#1E1410; }
    * { margin:0; padding:0; box-sizing:border-box; }
    body { font-family:'Segoe UI', Arial, sans-serif; background:var(--off-white); min-height:100vh; color:var(--gray-900); display:flex; flex-direction:column; }
    .topbar { background:var(--red); height:60px; padding:0 30px; display:flex; align-items:center; gap:12px; box-shadow:0 2px 12px rgba(200,16,46,0.3); }
    .logo { width:38px; height:38px; background:#fff; border-radius:8px; display:flex; align-items:center; justify-content:center; font-size:20px; }
    .brand { color:#fff; font-size:1.3em; font-weight:700; letter-spacing:1px; }
    .brand span { opacity:.75; font-weight:400; font-size:.75em; margin-left:6px; }
    main { flex:1; display:flex; align-items:center; justify-content:center; padding:24px 16px; }
    .card { background:#fff; width:100%; max-width:380px; border-radius:16px; padding:32px 28px; box-shadow:0 4px 24px rgba(30,20,16,0.08); }
    h1 { font-size:1.25em; margin-bottom:4px; }
    p.sub { color:var(--gray-500); font-size:.9em; margin-bottom:24px; }
    label { display:block; font-size:11px; font-weight:600; letter-spacing:1.5px; text-transform:uppercase; color:var(--gray-500); margin-bottom:6px; }
    input { width:100%; padding:12px 14px; border:1px solid var(--gray-200); border-radius:10px; font-size:15px; margin-bottom:18px; }
    input:focus { outline:none; border-color:var(--red); box-shadow:0 0 0 3px rgba(200,16,46,0.12); }
    button { width:100%; padding:13px; background:var(--red); color:#fff; border:none; border-radius:10px; font-size:15px; font-weight:700; cursor:pointer; }
    button:hover { background:var(--red-dark); }
    .error { background:#FDECEE; color:var(--red-dark); padding:10px 12px; border-radius:8px; font-size:.9em; margin-bottom:18px; }
  </style>
</head>
<body>
  <div class="topbar"><div class="logo">🍕</div><div class="brand">Domani <span>Panel de Ventas</span></div></div>
  <main>
    <form class="card" method="POST" action="/login" autocomplete="on">
      <h1>Iniciar sesion</h1>
      <p class="sub">Ingresa tus credenciales para ver las ventas.</p>
      ${error ? `<div class="error">${escapeHtml(error)}</div>` : ''}
      <label for="user">Usuario</label>
      <input id="user" name="user" type="text" autocomplete="username" required autofocus>
      <label for="password">Clave</label>
      <input id="password" name="password" type="password" autocomplete="current-password" required>
      <button type="submit">Entrar</button>
    </form>
  </main>
</body>
</html>`;
}

/**
 * Registra /login (GET y POST) y /logout en la app.
 */
function mountAuthRoutes(app) {
  app.get('/login', (req, res) => {
    if (authConfigured() && validSession(req)) return res.redirect('/panel');
    res.send(loginPage(authConfigured() ? '' : 'El acceso no esta configurado en el servidor.'));
  });

  app.post('/login', (req, res) => {
    if (!authConfigured()) {
      logger.error('Seguridad: PANEL_USER / PANEL_PASSWORD no configurados. Acceso bloqueado.');
      return res.status(503).send(loginPage('El acceso no esta configurado en el servidor.'));
    }
    const ip = req.ip;
    if (isBlocked(ip)) {
      return res.status(429).send(loginPage('Demasiados intentos. Intenta de nuevo en 15 minutos.'));
    }
    const { user = '', password = '' } = req.body || {};
    if (safeEqual(user, process.env.PANEL_USER) && safeEqual(password, process.env.PANEL_PASSWORD)) {
      failedAttempts.delete(ip);
      res.setHeader('Set-Cookie', `${SESSION_COOKIE}=${createSessionCookie(user)}; ${cookieOptions(req)}`);
      logger.info(`Seguridad: inicio de sesion correcto desde ${ip}`);
      return res.redirect(303, '/panel');
    }
    registerFailure(ip);
    logger.warn(`Seguridad: login fallido desde ${ip}`);
    return res.status(401).send(loginPage('Usuario o clave incorrectos.'));
  });

  app.get('/logout', (req, res) => {
    res.setHeader('Set-Cookie', `${SESSION_COOKIE}=; Path=/; HttpOnly; SameSite=Strict; Max-Age=0`);
    res.redirect('/login');
  });
}

/**
 * Valida los parametros de fecha (YYYY-MM-DD) y de restaurante (entero).
 * Evita path traversal en los nombres de archivo y entradas inesperadas.
 */
function validateQuery(req, res, next) {
  for (const key of ['date', 'start', 'end']) {
    const value = req.query[key];
    if (value === undefined) continue;
    if (typeof value !== 'string' || !DATE_RE.test(value) || isNaN(Date.parse(value))) {
      return res.status(400).json({ success: false, error: `Parametro ${key} invalido (formato YYYY-MM-DD)` });
    }
  }
  const loc = req.query.loc;
  if (loc !== undefined && (typeof loc !== 'string' || !/^\d{1,2}$/.test(loc))) {
    return res.status(400).json({ success: false, error: 'Parametro loc invalido' });
  }
  next();
}

/**
 * Oculta tokens y claves dentro de URLs o textos antes de loguearlos.
 */
function redact(text) {
  return String(text).replace(/(xapitoken|token|apikey|api_key|password)=([^&\s]+)/gi, '$1=***');
}

module.exports = { securityHeaders, requireLogin, mountAuthRoutes, validateQuery, redact };

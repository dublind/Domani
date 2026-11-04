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

/**
 * Autenticacion HTTP Basic para el panel y la API.
 * Requiere PANEL_USER y PANEL_PASSWORD en las variables de entorno.
 * Si no estan configuradas, se bloquea todo el acceso (fail closed).
 */
function basicAuth(req, res, next) {
  const user = process.env.PANEL_USER;
  const pass = process.env.PANEL_PASSWORD;

  if (!user || !pass) {
    logger.error('Seguridad: PANEL_USER / PANEL_PASSWORD no configurados. Acceso bloqueado.');
    return res.status(503).json({ success: false, error: 'Acceso no configurado' });
  }

  const ip = req.ip;
  if (isBlocked(ip)) {
    return res.status(429).json({ success: false, error: 'Demasiados intentos. Intenta mas tarde.' });
  }

  const header = req.headers.authorization || '';
  const [scheme, encoded] = header.split(' ');
  if (scheme === 'Basic' && encoded) {
    const decoded = Buffer.from(encoded, 'base64').toString('utf8');
    const sep = decoded.indexOf(':');
    const reqUser = decoded.slice(0, sep);
    const reqPass = decoded.slice(sep + 1);
    if (sep > -1 && safeEqual(reqUser, user) && safeEqual(reqPass, pass)) {
      failedAttempts.delete(ip);
      return next();
    }
    registerFailure(ip);
    logger.warn(`Seguridad: login fallido desde ${ip} en ${req.path}`);
  }

  res.setHeader('WWW-Authenticate', 'Basic realm="Domani Ventas", charset="UTF-8"');
  return res.status(401).send('Autenticacion requerida');
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

module.exports = { securityHeaders, basicAuth, validateQuery, redact };

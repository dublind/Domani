const path = require('path');
const cfg = require(path.join(__dirname, '..', '..', 'config.json'));

// Cargar config.json en process.env para compatibilidad con servicios que usan process.env
Object.entries(cfg).forEach(([key, value]) => {
  if (!process.env[key]) process.env[key] = value;
});

module.exports = {
  // Toteat Configuration
  toteat: {
    apiUrl: cfg.TOTEAT_BASE_URL || 'https://api.toteat.com/mw/or/1.0',
    apiKey: cfg.TOTEAT_API_KEY || cfg.TOTEAT_TOKEN,
    apiUserId: cfg.TOTEAT_USER_ID || '1001',
    restaurantId: cfg.TOTEAT_RESTAURANT_ID,
    localId: cfg.TOTEAT_LOCAL_ID || '1',
    environment: 'PROD'
  },

  // Marketman Configuration
  marketman: {
    apiUrl: cfg.MARKETMAN_API_URL || 'https://api.marketman.com',
    apiKey: cfg.MARKETMAN_API_KEY,
    locationId: cfg.MARKETMAN_LOCATION_ID
  },

  // Server Configuration
  server: {
    port: cfg.PORT || 3000,
    env: cfg.NODE_ENV || 'development'
  },

  // Cron Configuration
  cron: {
    schedule: cfg.CRON_SCHEDULE || '0 8 * * *'
  },

  // Logging Configuration
  logging: {
    level: cfg.LOG_LEVEL || 'info'
  }
};

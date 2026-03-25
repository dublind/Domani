const path = require('path');
const configPath = path.join(__dirname, '..', '..', 'config.json');

// En local usa config.json; en Railway (o cualquier servidor) usa variables de entorno
let cfg = {};
try {
  cfg = require(configPath);
  Object.entries(cfg).forEach(([key, value]) => {
    if (!process.env[key]) process.env[key] = value;
  });
} catch (e) {
  // config.json no existe — se usan las variables de entorno directamente
}

const env = process.env; // ya tiene los valores de config.json + variables de Railway

module.exports = {
  toteat: {
    apiUrl: env.TOTEAT_BASE_URL || 'https://api.toteat.com/mw/or/1.0',
    apiKey: env.TOTEAT_API_KEY || env.TOTEAT_TOKEN,
    apiUserId: env.TOTEAT_USER_ID || '1001',
    restaurantId: env.TOTEAT_RESTAURANT_ID,
    localId: env.TOTEAT_LOCAL_ID || '1',
    environment: 'PROD'
  },
  marketman: {
    apiUrl: env.MARKETMAN_API_URL || 'https://api.marketman.com',
    apiKey: env.MARKETMAN_API_KEY,
    locationId: env.MARKETMAN_LOCATION_ID
  },
  server: {
    port: env.PORT || 3000,
    env: env.NODE_ENV || 'development'
  },
  cron: {
    schedule: env.CRON_SCHEDULE || '0 8 * * *'
  },
  logging: {
    level: env.LOG_LEVEL || 'info'
  }
};

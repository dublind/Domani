require('dotenv').config();

module.exports = {
  // Toteat Configuration
  toteat: {
    apiUrl: process.env.TOTEAT_API_URL || 'https://toteatdev.appspot.com/mw/or/1.0',
    apiKey: process.env.TOTEAT_API_KEY,
    apiUserId: process.env.TOTEAT_API_USER_ID || '1001',
    restaurantId: process.env.TOTEAT_RESTAURANT_ID,
    localId: process.env.TOTEAT_LOCAL_ID || '1',
    environment: process.env.TOTEAT_ENVIRONMENT || 'PROD'
  },

  // Marketman Configuration
  marketman: {
    apiUrl: process.env.MARKETMAN_API_URL || 'https://api.marketman.com',
    apiKey: process.env.MARKETMAN_API_KEY,
    locationId: process.env.MARKETMAN_LOCATION_ID
  },

  // Server Configuration
  server: {
    port: process.env.PORT || 3000,
    env: process.env.NODE_ENV || 'development'
  },

  // Cron Configuration
  cron: {
    schedule: process.env.CRON_SCHEDULE || '0 6 * * *' // Default: 6 AM daily
  },

  // Logging Configuration
  logging: {
    level: process.env.LOG_LEVEL || 'info'
  }
};

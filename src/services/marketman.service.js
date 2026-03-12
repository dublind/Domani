const axios = require('axios');
const logger = require('../utils/logger');
const config = require('../config/config');

class MarketmanService {
  constructor() {
    this.apiUrl = config.marketman.apiUrl;
    this.apiKey = config.marketman.apiKey;
    this.apiPassword = config.marketman.apiPassword;
    this.locationId = config.marketman.locationId;
    this.tokenCache = null; // { token, expires }
  }

  isConfigured() {
    if (!this.apiKey || !this.apiPassword || !this.locationId) {
      logger.warn('Marketman no está configurado (faltan credenciales o locationId)');
      return false;
    }
    return true;
  }

  /**
   * Obtiene un token válido desde MarketMan, guardándolo en caché hasta su expiración
   * El endpoint de autenticación usa "APIKey" y "APIPassword" en los parámetros.
   */
  async getToken() {
    if (this.tokenCache && this.tokenCache.expires > Date.now()) {
      return this.tokenCache.token;
    }

    if (!this.apiKey || !this.apiPassword) {
      throw new Error('Faltan credenciales de Marketman (APIKey/APIPassword)');
    }

    const url = `${this.apiUrl}/Login/GetToken`;
    logger.info('Solicitando token Marketman...');

    const resp = await axios.get(url, {
      params: {
        APIKey: this.apiKey,
        APIPassword: this.apiPassword
      },
      timeout: 20000
    });

    if (resp.data && resp.data.AccessToken) {
      const token = resp.data.AccessToken;
      const expiresIn = resp.data.ExpiresIn || 3600; // segundos
      this.tokenCache = {
        token,
        expires: Date.now() + expiresIn * 1000 - 60000 // refrescar 1 min antes
      };
      logger.info('Token Marketman obtenido y cacheado');
      return token;
    }

    throw new Error('No se recibió AccessToken al solicitar token');
  }

  /**
   * Construye el payload JSON que se envía a MarketMan a partir de la lista de productos
   */
  buildPayload(products, totales, startDate, endDate = null) {
    const formatDate = (d) => {
      const [y, m, dd] = d.split('-');
      return `${dd}/${m}/${y}`;
    };

    const formattedStart = formatDate(startDate);
    const formattedEnd = endDate ? formatDate(endDate) : formattedStart;

    // agrupar productos como en el Excel
    const grouped = {};
    for (const p of products) {
      const key = p.producto || 'N/A';
      if (!grouped[key]) {
        grouped[key] = {
          producto: p.producto,
          codigo: p.codigo,
          precioUnitario: p.precioUnitario || 0,
          cantidad: 0,
          ventaSinImpuesto: 0,
          ventaConImpuesto: 0,
          categoria: p.categoria
        };
      }
      grouped[key].cantidad += p.cantidad || 0;
      grouped[key].ventaSinImpuesto += p.ventaSinImpuesto || 0;
      grouped[key].ventaConImpuesto += p.ventaConImpuesto || 0;
    }

    const items = Object.values(grouped).map(p => ({
      menuItem: p.producto,
      menuItemCode: p.codigo,
      menuItemListPrice: p.precioUnitario,
      quantitySold: p.cantidad,
      salesTotalExclTax: p.ventaSinImpuesto,
      salesTotalInclTax: p.ventaConImpuesto,
      category: p.categoria
    }));

    const payload = {
      LocationName: config.marketman.locationName || 'Domani Providencia',
      LocationId: this.locationId,
      BeginDate: formattedStart,
      EndDate: formattedEnd,
      TotalRevenueExclTax: totales.totalSinImpuesto || 0,
      TotalRevenueInclTax: totales.totalConImpuesto || 0,
      Items: items
    };

    return payload;
  }

  /**
   * Envía un set de ventas a MarketMan (modo async by default)
   */
  async pushSales(payload) {
    if (!this.isConfigured()) {
      return { success: false, error: 'Marketman not configured' };
    }

    try {
      // obtener token y añadirlo al header
      const token = await this.getToken();

      const url = `${this.apiUrl}/Sales/SetSalesAsync`;
      const params = {
        APIKey: this.apiKey,       // algunos endpoints aún esperan la clave como parámetro
        LocationId: this.locationId
      };

      logger.info('Enviando ventas a Marketman, url=', url, 'params=', params);
      const response = await axios.post(url, payload, {
        params,
        headers: {
          Authorization: `Bearer ${token}`
        },
        timeout: 30000
      });

      logger.info('Respuesta Marketman:', response.data);
      return { success: true, data: response.data };
    } catch (err) {
      logger.error('Error comunicándose con Marketman:', err.message);
      return { success: false, error: err.message, details: err.response?.data };
    }
  }

  /**
   * Método de conveniencia para generar payload y empujarlo
   */
  async uploadDailySales(products, totales, startDate, endDate = null) {
    const payload = this.buildPayload(products, totales, startDate, endDate);
    return this.pushSales(payload);
  }
}

module.exports = new MarketmanService();
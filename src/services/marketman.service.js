const axios = require('axios');
const logger = require('../utils/logger');

const BASE_URL = 'https://api.marketman.com/v3';

class MarketManService {
  constructor() {
    this.apiKey = process.env.MARKETMAN_API_KEY;
    this.apiPassword = process.env.MARKETMAN_API_PASSWORD;
    this.buyerGuid = process.env.MARKETMAN_BUYER_GUID;
    this.accessToken = null;
    this.tokenExpiry = null;
  }

  /**
   * Obtiene el AUTH_TOKEN de MarketMan (lo cachea hasta que expira)
   */
  async getAccessToken() {
    if (this.accessToken && this.tokenExpiry && new Date() < this.tokenExpiry) {
      return this.accessToken;
    }

    const response = await axios.post(`${BASE_URL}/auth/GetToken`, {
      APIKey: this.apiKey,
      APIPassword: this.apiPassword
    });

    if (!response.data || !response.data.AUTH_TOKEN) {
      throw new Error(`MarketMan auth fallida: ${JSON.stringify(response.data)}`);
    }

    this.accessToken = response.data.AUTH_TOKEN;
    this.tokenExpiry = new Date(response.data.ExpiryDateUTC);
    logger.info('MarketMan: token obtenido correctamente');
    return this.accessToken;
  }

  /**
   * Sube las ventas del día a MarketMan via SetSales
   * @param {string} startDate - Fecha inicio YYYY-MM-DD
   * @param {string} endDate - Fecha fin YYYY-MM-DD (igual a startDate si es un día)
   * @param {Array} products - Productos parseados de Toteat
   * @param {Object} totales - { totalSinImpuesto, totalConImpuesto }
   */
  async uploadSales(startDate, endDate, products, totales) {
    if (!this.apiKey || !this.apiPassword || !this.buyerGuid) {
      logger.warn('MarketMan: credenciales no configuradas, se omite upload');
      return { success: false, error: 'Credenciales de MarketMan no configuradas' };
    }

    try {
      const token = await this.getAccessToken();

      // Agrupar productos por codigo/nombre para evitar duplicados
      const productosAgrupados = {};
      for (const p of products) {
        const key = p.codigo || p.producto;
        if (!productosAgrupados[key]) {
          productosAgrupados[key] = { ...p, cantidad: 0, ventaSinImpuesto: 0, ventaConImpuesto: 0 };
        }
        productosAgrupados[key].cantidad += p.cantidad;
        productosAgrupados[key].ventaSinImpuesto += p.ventaSinImpuesto;
        productosAgrupados[key].ventaConImpuesto += p.ventaConImpuesto;
      }

      const productosLista = Object.values(productosAgrupados);

      // Items: catálogo completo de lo que se vendió (menu items)
      const items = productosLista.map(p => ({
        Type: 'MenuItem',
        Name: p.producto,
        ID: p.codigo || p.producto,
        PriceWithVAT: p.precioUnitario,
        PriceWithoutVAT: Math.round(p.precioUnitario / 1.19), // IVA Chile 19%
        SKU: p.codigo || p.producto,
        Category: p.categoria || 'General'
      }));

      // Transactions: detalle de cada venta
      const transactions = productosLista.map(p => ({
        ItemCode: p.codigo || p.producto,
        ItemID: p.codigo || p.producto,
        ItemName: p.producto,
        PriceTotalWithVAT: p.ventaConImpuesto,
        PriceTotalWithoutVAT: p.ventaSinImpuesto,
        DateUTC: `${startDate.replace(/-/g, '/')} 12:00:00`,
        Quantity: p.cantidad
      }));

      const fromDateUTC = `${startDate.replace(/-/g, '/')} 00:00:00`;
      const toDateUTC = `${(endDate || startDate).replace(/-/g, '/')} 23:59:59`;
      const uniqueID = startDate.replace(/-/g, ''); // Ej: 20260224

      const body = {
        BuyerGuid: this.buyerGuid,
        UniqueID: uniqueID,
        FromDateUTC: fromDateUTC,
        ToDateUTC: toDateUTC,
        TotalPriceWithVAT: totales.totalConImpuesto,
        TotalPriceWithoutVAT: totales.totalSinImpuesto,
        Items: items,
        Transactions: transactions
      };

      logger.info(`MarketMan: subiendo ventas del ${startDate} al ${endDate || startDate} (${productosLista.length} productos)`);

      const response = await axios.post(`${BASE_URL}/buyers/sales/SetSales`, body, {
        headers: {
          AUTH_TOKEN: token,
          'Content-Type': 'application/json'
        }
      });

      if (response.data.IsSuccess) {
        logger.info('MarketMan: ventas subidas correctamente');
        return { success: true };
      } else {
        logger.error(`MarketMan SetSales error: ${response.data.ErrorMessage} (${response.data.ErrorCode})`);
        return { success: false, error: response.data.ErrorMessage, code: response.data.ErrorCode };
      }

    } catch (error) {
      const msg = error.response?.data ? JSON.stringify(error.response.data) : error.message;
      logger.error(`MarketMan: error en upload: ${msg}`);
      return { success: false, error: msg };
    }
  }

  /**
   * Test de conexión con MarketMan
   */
  async testConnection() {
    try {
      await this.getAccessToken();
      return { success: true, message: 'Conexión con MarketMan OK' };
    } catch (error) {
      return { success: false, error: error.message };
    }
  }
}

module.exports = new MarketManService();

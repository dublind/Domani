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

    const response = await axios.post(`${BASE_URL}/buyers/auth/GetToken`, {
      APIKey: this.apiKey,
      APIPassword: this.apiPassword
    });

    if (!response.data || !response.data.Token) {
      throw new Error(`MarketMan auth fallida: ${JSON.stringify(response.data)}`);
    }

    this.accessToken = response.data.Token;
    this.tokenExpiry = new Date(response.data.ExpireDateUTC);
    logger.info('MarketMan: token obtenido correctamente');
    return this.accessToken;
  }

  /**
   * Sube las ventas del día a MarketMan via CreateSalesPeriodContainer (POS API)
   * @param {string} startDate - Fecha inicio YYYY-MM-DD
   * @param {string} endDate - Fecha fin YYYY-MM-DD (igual a startDate si es un día)
   * @param {Array} products - Productos parseados de Toteat (no usados aquí, reserved para Checks)
   * @param {Object} totales - { totalSinImpuesto, totalConImpuesto }
   */
  async uploadSales(startDate, endDate, products, totales) {
    if (!this.apiKey || !this.apiPassword || !this.buyerGuid) {
      logger.warn('MarketMan: credenciales no configuradas, se omite upload');
      return { success: false, error: 'Credenciales de MarketMan no configuradas' };
    }

    try {
      const token = await this.getAccessToken();

      const fromDateUTC = `${startDate.replace(/-/g, '/')} 00:00:00`;
      const toDateUTC = `${(endDate || startDate).replace(/-/g, '/')} 23:59:59`;
      const containerID = startDate.replace(/-/g, ''); // Ej: 20260228

      const body = {
        BuyerGuid: this.buyerGuid,
        SalesPeriodContainer: {
          SalesPeriodContainerID: containerID,
          DateTimeFromUTC: fromDateUTC,
          DateTimeToUTC: toDateUTC,
          TotalSalesWithVAT: totales.totalConImpuesto,
          TotalSalesWithoutVAT: totales.totalSinImpuesto
        }
      };

      logger.info(`MarketMan: subiendo ventas del ${startDate} al ${endDate || startDate} (${products.length} productos)`);

      const response = await axios.post(`${BASE_URL}/buyers/pos/CreateSalesPeriodContainer`, body, {
        headers: {
          AUTH_TOKEN: token,
          'Content-Type': 'application/json'
        }
      });

      if (response.data.IsSuccess) {
        logger.info('MarketMan: container creado correctamente');
      } else if (String(response.data.ErrorCode) === '22') {
        logger.info(`MarketMan: container ${containerID} ya existe, continuando con checks`);
      } else {
        logger.error(`MarketMan CreateSalesPeriodContainer error: ${response.data.ErrorMessage} (${response.data.ErrorCode})`);
        return { success: false, error: response.data.ErrorMessage, code: response.data.ErrorCode };
      }

      // 1. Registrar categorías
      const categoriesResult = await this.syncCategories(products);
      if (!categoriesResult.success) {
        logger.warn(`MarketMan sync categorías falló: ${categoriesResult.error}`);
      }

      // 2. Registrar items del menú
      const menuResult = await this.syncMenuItems(products);
      if (!menuResult.success) {
        logger.warn(`MarketMan sync menú falló: ${menuResult.error}`);
      }

      // Crear checks con el detalle de productos
      const checksResult = await this.createChecks(containerID, startDate, products);
      if (checksResult.success) {
        logger.info('MarketMan: ventas subidas correctamente');
      } else {
        logger.warn(`MarketMan checks fallaron: ${checksResult.error}`);
      }

      return { success: true, containerID };

    } catch (error) {
      const msg = error.response?.data ? JSON.stringify(error.response.data) : error.message;
      logger.error(`MarketMan: error en upload: ${msg}`);
      return { success: false, error: msg };
    }
  }

  /**
   * Crea los checks (detalle de productos vendidos) en MarketMan
   */
  async createChecks(containerID, startDate, products) {
    try {
      const token = await this.getAccessToken();

      const dateStr = startDate.replace(/-/g, '/');
      const fromDateUTC = `${dateStr} 00:00:00`;
      const toDateUTC = `${dateStr} 23:59:59`;

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

      // Crear un check por producto
      const checks = productosLista.map((p, index) => ({
        CheckPOSID: `${containerID}_${index + 1}`,
        DateTimeOpenUTC: fromDateUTC,
        DateTimeCloseUTC: toDateUTC,
        Items: [{
          ItemPOSID: String(p.codigo || p.producto),
          CategoryPOSID: String(p.categoria || 'General'),
          QuantitySold: p.cantidad,
          SalePriceWithoutTax: p.ventaSinImpuesto,
          SalePriceWithTax: p.ventaConImpuesto
        }]
      }));

      logger.info(`MarketMan: enviando ${checks.length} checks para container ${containerID}`);

      const response = await axios.post(`${BASE_URL}/buyers/pos/CreateChecks`, {
        BuyerGuid: this.buyerGuid,
        SalesPeriodContainerID: containerID,
        Checks: checks
      }, {
        headers: { AUTH_TOKEN: token, 'Content-Type': 'application/json' }
      });

      if (response.data.IsSuccess) {
        logger.info('MarketMan: checks creados correctamente');
        return { success: true };
      } else {
        logger.error(`MarketMan CreateChecks error: ${response.data.ErrorMessage} (${response.data.ErrorCode})`);
        logger.error(`MarketMan respuesta completa: ${JSON.stringify(response.data).substring(0, 2000)}`);
        return { success: false, error: response.data.ErrorMessage };
      }

    } catch (error) {
      const msg = error.response?.data ? JSON.stringify(error.response.data) : error.message;
      logger.error(`MarketMan: error creando checks: ${msg}`);
      return { success: false, error: msg };
    }
  }

  /**
   * Crea solo las categorías nuevas en MarketMan (evita error "already exists")
   */
  async syncCategories(products) {
    try {
      const token = await this.getAccessToken();

      // Obtener categorías que ya existen
      const existingRes = await axios.post(`${BASE_URL}/buyers/pos/GetPOSCategories`, {
        BuyerGuid: this.buyerGuid
      }, { headers: { AUTH_TOKEN: token, 'Content-Type': 'application/json' } });

      const existingIDs = new Set(
        (existingRes.data.POSCategories || []).map(c => c.CategoryPOSID)
      );
      logger.info(`MarketMan: ${existingIDs.size} categorías ya existen`);

      // Solo crear las que no existen
      const categoriasUnicas = [...new Set(products.map(p => p.categoria || 'General'))];
      const nuevas = categoriasUnicas
        .filter(cat => !existingIDs.has(cat))
        .map(cat => ({ CategoryPOSID: cat, Name: cat }));

      if (nuevas.length === 0) {
        logger.info('MarketMan: todas las categorías ya están registradas');
        return { success: true };
      }

      logger.info(`MarketMan: creando ${nuevas.length} categorías nuevas: ${nuevas.map(c => c.Name).join(', ')}`);

      const response = await axios.post(`${BASE_URL}/buyers/pos/CreatePOSCategories`, {
        BuyerGuid: this.buyerGuid,
        POSCategories: nuevas
      }, { headers: { AUTH_TOKEN: token, 'Content-Type': 'application/json' } });

      if (response.data.IsSuccess) {
        logger.info('MarketMan: nuevas categorías creadas correctamente');
      } else {
        logger.warn(`MarketMan CreatePOSCategories: ${response.data.ErrorMessage}`);
      }

      return { success: true }; // Continuar aunque falle alguna categoría

    } catch (error) {
      const msg = error.response?.data ? JSON.stringify(error.response.data) : error.message;
      logger.error(`MarketMan: error sincronizando categorías: ${msg}`);
      return { success: true }; // No bloquear el flujo por categorías
    }
  }

  /**
   * Registra/actualiza los items del menú en MarketMan antes de crear checks
   */
  async syncMenuItems(products) {
    try {
      const token = await this.getAccessToken();

      // Deduplicar por codigo
      const productosAgrupados = {};
      for (const p of products) {
        const key = p.codigo || p.producto;
        if (!productosAgrupados[key]) {
          productosAgrupados[key] = p;
        }
      }

      const menuItems = Object.values(productosAgrupados).map(p => ({
        ItemPOSID: String(p.codigo || p.producto),
        ItemPOSCode: String(p.codigo || p.producto),
        POSLocationSyncID: String(p.codigo || p.producto),
        Name: p.producto,
        CategoryPOSID: String(p.categoria || 'General'),
        SalePriceWithTax: p.precioUnitario,
        SalePriceWithoutTax: Math.round(p.precioUnitario / 1.19),
        TypeID: 1,
        Type: 'Menu Item'
      }));

      logger.info(`MarketMan: sincronizando ${menuItems.length} items del menú`);

      const response = await axios.post(`${BASE_URL}/buyers/pos/SetPosMenuItems`, {
        BuyerGuid: this.buyerGuid,
        MenuItems: menuItems
      }, {
        headers: { AUTH_TOKEN: token, 'Content-Type': 'application/json' }
      });

      if (response.data.IsSuccess) {
        logger.info('MarketMan: menú sincronizado correctamente');
        return { success: true };
      } else {
        logger.error(`MarketMan SetPosMenuItems error: ${response.data.ErrorMessage} (${response.data.ErrorCode})`);
        logger.error(`MarketMan menú respuesta: ${JSON.stringify(response.data).substring(0, 2000)}`);
        return { success: false, error: response.data.ErrorMessage };
      }

    } catch (error) {
      const msg = error.response?.data ? JSON.stringify(error.response.data) : error.message;
      logger.error(`MarketMan: error sincronizando menú: ${msg}`);
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

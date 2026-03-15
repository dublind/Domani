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
   * Limpia texto removiendo emojis y caracteres especiales no-ASCII
   * MarketMan rechaza items con emojis o caracteres unicode especiales
   */
  sanitizeName(text) {
    if (!text) return '';
    return text
      // Remover emojis y simbolos unicode (rangos comunes de emojis)
      .replace(/[\u{1F600}-\u{1F64F}]/gu, '')  // emoticones
      .replace(/[\u{1F300}-\u{1F5FF}]/gu, '')  // simbolos y pictogramas
      .replace(/[\u{1F680}-\u{1F6FF}]/gu, '')  // transporte y mapas
      .replace(/[\u{1F1E0}-\u{1F1FF}]/gu, '')  // banderas
      .replace(/[\u{2600}-\u{26FF}]/gu, '')     // simbolos misc
      .replace(/[\u{2700}-\u{27BF}]/gu, '')     // dingbats
      .replace(/[\u{FE00}-\u{FE0F}]/gu, '')     // selectores de variacion
      .replace(/[\u{200D}]/gu, '')               // zero width joiner
      .replace(/[\u{20E3}]/gu, '')               // combining enclosing keycap
      .replace(/[\u{E0020}-\u{E007F}]/gu, '')   // tags
      .replace(/►/g, '')                          // flecha especial usada en categorias Toteat
      .replace(/\s+/g, ' ')                       // colapsar espacios multiples
      .trim();
  }

  /**
   * Limpia el ID de categoria para MarketMan
   * Remueve caracteres especiales que causan rechazo
   */
  sanitizeCategoryID(category) {
    if (!category) return 'General';
    return this.sanitizeName(category) || 'General';
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
   * Sube las ventas del dia a MarketMan via POS API
   * Flujo: Container -> Categorias -> Menu Items -> Checks
   * @param {string} startDate - Fecha inicio YYYY-MM-DD
   * @param {string} endDate - Fecha fin YYYY-MM-DD
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

      const fromDateUTC = `${startDate.replace(/-/g, '/')} 00:00:00`;
      const toDateUTC = `${(endDate || startDate).replace(/-/g, '/')} 23:59:59`;
      const containerID = startDate.replace(/-/g, '');

      // Sanitizar productos antes de enviarlos
      const productosSanitizados = this.sanitizeProducts(products);
      logger.info(`MarketMan: ${products.length} productos originales -> ${productosSanitizados.length} despues de sanitizar`);

      if (productosSanitizados.length === 0) {
        logger.warn('MarketMan: no hay productos validos para subir despues de sanitizar');
        return { success: false, error: 'No hay productos validos para subir' };
      }

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

      logger.info(`MarketMan: subiendo ventas del ${startDate} al ${endDate || startDate} (${productosSanitizados.length} productos)`);

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

      // 1. Registrar categorias
      const categoriesResult = await this.syncCategories(productosSanitizados);
      if (!categoriesResult.success) {
        logger.warn(`MarketMan sync categorias fallo: ${categoriesResult.error}`);
      }

      // 2. Registrar items del menu (REQUERIDO antes de crear checks)
      const menuResult = await this.syncMenuItems(productosSanitizados);
      if (!menuResult.success) {
        logger.error(`MarketMan sync menu fallo: ${menuResult.error}`);
        logger.error('MarketMan: NO se pueden crear checks sin menu items registrados');
        return { success: false, error: `Menu items fallaron: ${menuResult.error}` };
      }

      // 3. Crear checks con el detalle de productos (solo si menu items fue exitoso)
      const checksResult = await this.createChecks(containerID, startDate, productosSanitizados);
      if (checksResult.success) {
        logger.info('MarketMan: ventas subidas correctamente');
      } else {
        logger.warn(`MarketMan checks fallaron: ${checksResult.error}`);
      }

      return { success: checksResult.success, containerID };

    } catch (error) {
      const msg = error.response?.data ? JSON.stringify(error.response.data) : error.message;
      logger.error(`MarketMan: error en upload: ${msg}`);
      return { success: false, error: msg };
    }
  }

  /**
   * Sanitiza la lista de productos para MarketMan:
   * - Remueve emojis y caracteres especiales de nombres y categorias
   * - Filtra productos sin codigo valido
   * - Asegura que los precios sean numeros positivos
   */
  sanitizeProducts(products) {
    const sanitized = [];

    for (const p of products) {
      const codigo = String(p.codigo || '').trim();
      const nombre = this.sanitizeName(p.producto);
      const categoria = this.sanitizeCategoryID(p.categoria);

      // Saltar productos sin codigo numerico (MarketMan usa IDs numericos)
      if (!codigo || codigo === '0') {
        logger.info(`MarketMan: producto saltado sin codigo valido: "${p.producto}"`);
        continue;
      }

      // Saltar productos sin nombre
      if (!nombre) {
        logger.info(`MarketMan: producto saltado sin nombre valido: codigo=${codigo}`);
        continue;
      }

      sanitized.push({
        ...p,
        producto: nombre,
        codigo: codigo,
        categoria: categoria,
        // Asegurar que los precios sean numeros validos (minimo 0)
        precioUnitario: Math.max(0, Math.round(p.precioUnitario || 0)),
        ventaSinImpuesto: Math.max(0, Math.round(p.ventaSinImpuesto || 0)),
        ventaConImpuesto: Math.max(0, Math.round(p.ventaConImpuesto || 0)),
        cantidad: Math.max(0, p.cantidad || 0)
      });
    }

    return sanitized;
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

      // Agrupar productos por codigo para evitar duplicados
      const productosAgrupados = {};
      for (const p of products) {
        const key = p.codigo;
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
          ItemPOSID: String(p.codigo),
          CategoryPOSID: String(p.categoria || 'General'),
          QuantitySold: p.cantidad,
          SalePriceWithoutTax: Math.round(p.ventaSinImpuesto),
          SalePriceWithTax: Math.round(p.ventaConImpuesto)
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
        // Loguear items invalidos especificamente
        this.logInvalidChecks(response.data);
        return { success: false, error: response.data.ErrorMessage };
      }

    } catch (error) {
      const msg = error.response?.data ? JSON.stringify(error.response.data) : error.message;
      logger.error(`MarketMan: error creando checks: ${msg}`);
      return { success: false, error: msg };
    }
  }

  /**
   * Registra items del menu en MarketMan
   * Si falla el lote completo, intenta enviar en lotes mas pequenos
   */
  async syncMenuItems(products) {
    try {
      const token = await this.getAccessToken();

      // Deduplicar por codigo
      const productosAgrupados = {};
      for (const p of products) {
        const key = p.codigo;
        if (!productosAgrupados[key]) {
          productosAgrupados[key] = p;
        }
      }

      const menuItems = Object.values(productosAgrupados).map(p => ({
        ItemPOSID: String(p.codigo),
        ItemPOSCode: String(p.codigo),
        POSLocationSyncID: String(p.codigo),
        Name: p.producto,
        CategoryPOSID: String(p.categoria || 'General'),
        SalePriceWithTax: Math.max(0, p.precioUnitario || 0),
        SalePriceWithoutTax: Math.max(0, Math.round((p.precioUnitario || 0) / 1.19)),
        TypeID: 1,
        Type: 'MenuItem'
      }));

      logger.info(`MarketMan: sincronizando ${menuItems.length} items del menu`);

      // Intentar enviar todos de una vez
      const result = await this.sendMenuItemsBatch(token, menuItems);

      if (result.success) {
        logger.info('MarketMan: menu sincronizado correctamente');
        return { success: true };
      }

      // Si fallo, identificar items invalidos y reintentar sin ellos
      logger.warn('MarketMan: lote completo fallo, identificando items invalidos...');
      const invalidItems = this.findInvalidMenuItems(result.responseData);

      if (invalidItems.length > 0) {
        logger.info(`MarketMan: ${invalidItems.length} items invalidos encontrados: ${invalidItems.join(', ')}`);
        const validMenuItems = menuItems.filter(item => !invalidItems.includes(item.ItemPOSID));

        if (validMenuItems.length === 0) {
          logger.error('MarketMan: todos los items del menu son invalidos');
          return { success: false, error: 'Todos los items del menu son invalidos' };
        }

        logger.info(`MarketMan: reintentando con ${validMenuItems.length} items validos`);
        const retryResult = await this.sendMenuItemsBatch(token, validMenuItems);

        if (retryResult.success) {
          logger.info(`MarketMan: menu sincronizado (${validMenuItems.length}/${menuItems.length} items)`);
          return { success: true };
        }

        logger.error(`MarketMan: reintento tambien fallo: ${retryResult.error}`);
        return { success: false, error: retryResult.error };
      }

      // Si no pudimos identificar items invalidos, intentar en lotes pequenos
      logger.info('MarketMan: intentando envio en lotes de 20 items...');
      return await this.sendMenuItemsInBatches(token, menuItems, 20);

    } catch (error) {
      const msg = error.response?.data ? JSON.stringify(error.response.data) : error.message;
      logger.error(`MarketMan: error sincronizando menu: ${msg}`);
      return { success: false, error: msg };
    }
  }

  /**
   * Envia un lote de menu items a MarketMan
   */
  async sendMenuItemsBatch(token, menuItems) {
    try {
      const response = await axios.post(`${BASE_URL}/buyers/pos/SetPosMenuItems`, {
        BuyerGuid: this.buyerGuid,
        MenuItems: menuItems
      }, {
        headers: { AUTH_TOKEN: token, 'Content-Type': 'application/json' }
      });

      if (response.data.IsSuccess) {
        return { success: true };
      }

      // Loguear items invalidos para diagnostico
      this.logInvalidMenuItems(response.data);

      return {
        success: false,
        error: response.data.ErrorMessage,
        responseData: response.data
      };
    } catch (error) {
      const msg = error.response?.data ? JSON.stringify(error.response.data) : error.message;
      return { success: false, error: msg };
    }
  }

  /**
   * Envia menu items en lotes mas pequenos para aislar fallos
   */
  async sendMenuItemsInBatches(token, menuItems, batchSize) {
    let exitosos = 0;
    let fallidos = 0;

    for (let i = 0; i < menuItems.length; i += batchSize) {
      const batch = menuItems.slice(i, i + batchSize);
      const result = await this.sendMenuItemsBatch(token, batch);

      if (result.success) {
        exitosos += batch.length;
        logger.info(`MarketMan: lote ${Math.floor(i / batchSize) + 1} exitoso (${batch.length} items)`);
      } else {
        fallidos += batch.length;
        logger.warn(`MarketMan: lote ${Math.floor(i / batchSize) + 1} fallo (${batch.length} items): ${result.error}`);
      }
    }

    logger.info(`MarketMan: resultado lotes menu: ${exitosos} exitosos, ${fallidos} fallidos`);
    return { success: exitosos > 0, exitosos, fallidos };
  }

  /**
   * Analiza la respuesta de SetPosMenuItems y encuentra los items invalidos
   */
  findInvalidMenuItems(responseData) {
    const invalidIDs = [];
    if (!responseData || !responseData.MenuItemsResult) return invalidIDs;

    for (const item of responseData.MenuItemsResult) {
      if (item.ValidationResult && !item.ValidationResult.IsValid) {
        invalidIDs.push(item.ItemPOSID);
      }
    }
    return invalidIDs;
  }

  /**
   * Loguea los items invalidos del menu para diagnostico
   */
  logInvalidMenuItems(responseData) {
    if (!responseData || !responseData.MenuItemsResult) {
      logger.error(`MarketMan SetPosMenuItems error: ${responseData?.ErrorMessage} (sin detalle de items)`);
      return;
    }

    const invalidos = responseData.MenuItemsResult.filter(
      item => item.ValidationResult && !item.ValidationResult.IsValid
    );
    const validos = responseData.MenuItemsResult.filter(
      item => item.ValidationResult && item.ValidationResult.IsValid
    );

    logger.error(`MarketMan SetPosMenuItems: ${validos.length} validos, ${invalidos.length} invalidos de ${responseData.MenuItemsResult.length} total`);

    for (const item of invalidos) {
      logger.error(`  Item invalido: ID=${item.ItemPOSID} Name="${item.Name}" Cat="${item.CategoryPOSID}" Errores: ${JSON.stringify(item.ValidationResult.Errors)}`);
    }
  }

  /**
   * Loguea los checks invalidos para diagnostico
   */
  logInvalidChecks(responseData) {
    if (!responseData || !responseData.Checks) {
      logger.error(`MarketMan CreateChecks error: ${responseData?.ErrorMessage} (sin detalle de checks)`);
      return;
    }

    let totalInvalidos = 0;
    for (const check of responseData.Checks) {
      if (check.Items) {
        for (const item of check.Items) {
          if (item.ValidationResult && !item.ValidationResult.IsValid) {
            totalInvalidos++;
            if (totalInvalidos <= 10) {
              logger.error(`  Check invalido: CheckID=${check.CheckPOSID} ItemID=${item.ItemPOSID} Errores: ${JSON.stringify(item.ValidationResult.Errors)}`);
            }
          }
        }
      }
    }

    if (totalInvalidos > 10) {
      logger.error(`  ... y ${totalInvalidos - 10} items invalidos mas`);
    }
    logger.error(`MarketMan CreateChecks: ${totalInvalidos} items invalidos en total`);
  }

  /**
   * Crea solo las categorias nuevas en MarketMan
   * Usa nombres sanitizados para evitar rechazos por caracteres especiales
   */
  async syncCategories(products) {
    try {
      const token = await this.getAccessToken();

      // Obtener categorias que ya existen
      const existingRes = await axios.post(`${BASE_URL}/buyers/pos/GetPOSCategories`, {
        BuyerGuid: this.buyerGuid
      }, { headers: { AUTH_TOKEN: token, 'Content-Type': 'application/json' } });

      const existingIDs = new Set(
        (existingRes.data.POSCategories || []).map(c => c.CategoryPOSID)
      );
      logger.info(`MarketMan: ${existingIDs.size} categorias ya existen`);

      // Solo crear las que no existen (ya sanitizadas en sanitizeProducts)
      const categoriasUnicas = [...new Set(products.map(p => p.categoria || 'General'))];
      const nuevas = categoriasUnicas
        .filter(cat => !existingIDs.has(cat))
        .map(cat => ({ CategoryPOSID: cat, Name: cat }));

      if (nuevas.length === 0) {
        logger.info('MarketMan: todas las categorias ya estan registradas');
        return { success: true };
      }

      logger.info(`MarketMan: creando ${nuevas.length} categorias nuevas: ${nuevas.map(c => c.Name).join(', ')}`);

      const response = await axios.post(`${BASE_URL}/buyers/pos/CreatePOSCategories`, {
        BuyerGuid: this.buyerGuid,
        POSCategories: nuevas
      }, { headers: { AUTH_TOKEN: token, 'Content-Type': 'application/json' } });

      if (response.data.IsSuccess) {
        logger.info('MarketMan: nuevas categorias creadas correctamente');
      } else {
        logger.warn(`MarketMan CreatePOSCategories: ${response.data.ErrorMessage}`);
      }

      return { success: true };

    } catch (error) {
      const msg = error.response?.data ? JSON.stringify(error.response.data) : error.message;
      logger.error(`MarketMan: error sincronizando categorias: ${msg}`);
      return { success: true }; // No bloquear el flujo por categorias
    }
  }

  /**
   * Test de conexion con MarketMan
   */
  async testConnection() {
    try {
      await this.getAccessToken();
      return { success: true, message: 'Conexion con MarketMan OK' };
    } catch (error) {
      return { success: false, error: error.message };
    }
  }
}

module.exports = new MarketManService();

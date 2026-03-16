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
      // Mantener solo caracteres ASCII seguros: letras, numeros, espacios, puntuacion basica
      // Incluye letras acentuadas comunes del espanol (á-ú, ñ, Á-Ú, Ñ)
      .replace(/[^\w\sáéíóúñÁÉÍÓÚÑ&.,;:()/'"-]/g, '')
      .replace(/\s+/g, ' ')
      .trim();
  }

  /**
   * Limpia el ID de categoria para MarketMan
   * Remueve caracteres especiales y normaliza a mayusculas
   * (Toteat puede enviar "AGREGADOS" y "Agregados" como categorias distintas)
   */
  sanitizeCategoryID(category) {
    if (!category) return 'GENERAL';
    const cleaned = this.sanitizeName(category);
    return cleaned ? cleaned.toUpperCase() : 'GENERAL';
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

      // 1. Registrar categorias (REQUERIDO antes de menu items)
      const categoriesResult = await this.syncCategories(productosSanitizados);
      if (!categoriesResult.success) {
        logger.error(`MarketMan sync categorias fallo: ${categoriesResult.error}`);
        logger.error('MarketMan: NO se pueden crear menu items sin categorias registradas');
        return { success: false, error: `Categorias fallaron: ${categoriesResult.error}` };
      }

      // 2. Registrar items del menu (REQUERIDO antes de crear checks)
      const menuResult = await this.syncMenuItems(productosSanitizados);
      if (!menuResult.success) {
        logger.error(`MarketMan sync menu fallo: ${menuResult.error}`);
        logger.error('MarketMan: NO se pueden crear checks sin menu items registrados');
        return { success: false, error: `Menu items fallaron: ${menuResult.error}` };
      }

      // Filtrar productos cuyos menu items fallaron para no enviarlos en checks
      let productosParaChecks = productosSanitizados;
      if (menuResult.invalidItemIDs && menuResult.invalidItemIDs.length > 0) {
        const invalidSet = new Set(menuResult.invalidItemIDs);
        productosParaChecks = productosSanitizados.filter(p => !invalidSet.has(String(p.codigo)));
        logger.info(`MarketMan: ${menuResult.invalidItemIDs.length} items excluidos de checks por ser invalidos en menu`);
      }

      // 3. Crear checks con el detalle de productos (solo si menu items fue exitoso)
      const checksResult = await this.createChecks(containerID, startDate, productosParaChecks);
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

      // Crear un check por producto (timestamp para evitar colision con reintentos)
      const ts = Date.now();
      const checks = productosLista.map((p, index) => ({
        CheckPOSID: `${containerID}_${ts}_${index + 1}`,
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
      }

      const errorMsg = response.data.ErrorMessage || response.data.errorMessage || 'Error desconocido';
      const errorCode = response.data.ErrorCode || response.data.errorCode || '';
      logger.error(`MarketMan CreateChecks error: ${errorMsg} (code: ${errorCode})`);
      this.logInvalidChecks(response.data);

      // Identificar checks invalidos y reintentar sin ellos
      const invalidCheckIDs = this.findInvalidCheckIDs(response.data);
      if (invalidCheckIDs.size > 0) {
        const validChecks = checks.filter(c => !invalidCheckIDs.has(c.CheckPOSID));
        if (validChecks.length === 0) {
          logger.error('MarketMan: todos los checks son invalidos');
          return { success: false, error: errorMsg };
        }

        logger.info(`MarketMan: reintentando con ${validChecks.length} checks validos (${invalidCheckIDs.size} excluidos)`);
        const retryResponse = await axios.post(`${BASE_URL}/buyers/pos/CreateChecks`, {
          BuyerGuid: this.buyerGuid,
          SalesPeriodContainerID: containerID,
          Checks: validChecks
        }, {
          headers: { AUTH_TOKEN: token, 'Content-Type': 'application/json' }
        });

        if (retryResponse.data.IsSuccess) {
          logger.info(`MarketMan: checks creados (${validChecks.length}/${checks.length})`);
          return { success: true };
        }

        const retryError = retryResponse.data.ErrorMessage || 'Error en reintento';
        logger.error(`MarketMan: reintento de checks tambien fallo: ${retryError}`);
        return { success: false, error: retryError };
      }

      return { success: false, error: errorMsg };

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
        return { success: true, invalidItemIDs: [] };
      }

      // Si fallo, identificar items invalidos y reintentar sin ellos
      logger.warn('MarketMan: lote completo fallo, identificando items invalidos...');
      const invalidItems = this.findInvalidMenuItems(result.responseData);

      if (invalidItems.length > 0) {
        logger.info(`MarketMan: ${invalidItems.length} items invalidos encontrados: ${invalidItems.join(', ')}`);
        const validMenuItems = menuItems.filter(item => !invalidItems.includes(item.ItemPOSID));

        if (validMenuItems.length === 0) {
          logger.error('MarketMan: todos los items del menu son invalidos');
          return { success: false, error: 'Todos los items del menu son invalidos', invalidItemIDs: invalidItems };
        }

        logger.info(`MarketMan: reintentando con ${validMenuItems.length} items validos`);
        const retryResult = await this.sendMenuItemsBatch(token, validMenuItems);

        if (retryResult.success) {
          logger.info(`MarketMan: menu sincronizado (${validMenuItems.length}/${menuItems.length} items)`);
          return { success: true, invalidItemIDs: invalidItems };
        }

        logger.error(`MarketMan: reintento tambien fallo: ${retryResult.error}`);
        return { success: false, error: retryResult.error, invalidItemIDs: invalidItems };
      }

      // Si no pudimos identificar items invalidos, intentar en lotes pequenos
      logger.info('MarketMan: intentando envio en lotes de 20 items...');
      const batchResult = await this.sendMenuItemsInBatches(token, menuItems, 20);
      batchResult.invalidItemIDs = [];
      return batchResult;

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
   * Encuentra los CheckPOSIDs invalidos en la respuesta de CreateChecks
   */
  findInvalidCheckIDs(responseData) {
    const invalidIDs = new Set();
    if (!responseData || !responseData.Checks) return invalidIDs;

    for (const check of responseData.Checks) {
      let isInvalid = false;

      if (check.ValidationResult && !check.ValidationResult.IsValid) {
        isInvalid = true;
      }

      if (check.Items) {
        for (const item of check.Items) {
          if (item.ValidationResult && !item.ValidationResult.IsValid) {
            isInvalid = true;
          }
        }
      }

      if (isInvalid) {
        invalidIDs.add(check.CheckPOSID);
      }
    }
    return invalidIDs;
  }

  /**
   * Loguea los checks invalidos para diagnostico
   * Revisa validacion a nivel de Check Y a nivel de Item
   */
  logInvalidChecks(responseData) {
    if (!responseData || !responseData.Checks) {
      logger.error(`MarketMan CreateChecks: sin detalle de checks en respuesta`);
      logger.error(`MarketMan CreateChecks respuesta completa: ${JSON.stringify(responseData).substring(0, 3000)}`);
      return;
    }

    let checksInvalidos = 0;
    let itemsInvalidos = 0;
    let logged = 0;

    for (const check of responseData.Checks) {
      // Revisar validacion a nivel de CHECK
      if (check.ValidationResult && !check.ValidationResult.IsValid) {
        checksInvalidos++;
        if (logged < 10) {
          logger.error(`  Check invalido: ID=${check.CheckPOSID} Errores: ${JSON.stringify(check.ValidationResult.Errors)}`);
          logged++;
        }
      }

      // Revisar validacion a nivel de ITEM dentro del check
      if (check.Items) {
        for (const item of check.Items) {
          if (item.ValidationResult && !item.ValidationResult.IsValid) {
            itemsInvalidos++;
            if (logged < 10) {
              logger.error(`  Item invalido en check ${check.CheckPOSID}: ItemID=${item.ItemPOSID} Errores: ${JSON.stringify(item.ValidationResult.Errors)}`);
              logged++;
            }
          }
        }
      }
    }

    if (logged >= 10) {
      logger.error(`  ... mas errores omitidos`);
    }
    logger.error(`MarketMan CreateChecks: ${checksInvalidos} checks invalidos, ${itemsInvalidos} items invalidos de ${responseData.Checks.length} checks total`);

    // Si no encontramos errores especificos, loguear muestra de la respuesta
    if (checksInvalidos === 0 && itemsInvalidos === 0) {
      logger.error(`MarketMan CreateChecks: no se encontraron errores de validacion especificos`);
      logger.error(`MarketMan CreateChecks primer check: ${JSON.stringify(responseData.Checks[0]).substring(0, 500)}`);
    }
  }

  /**
   * Crea solo las categorias nuevas en MarketMan
   * Usa nombres sanitizados para evitar rechazos por caracteres especiales
   * Reintenta una por una si el lote falla
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
      logger.info(`MarketMan: ${existingIDs.size} categorias ya existen: ${[...existingIDs].join(', ')}`);

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

      // Intentar crear todas de una vez
      const response = await axios.post(`${BASE_URL}/buyers/pos/CreatePOSCategories`, {
        BuyerGuid: this.buyerGuid,
        POSCategories: nuevas
      }, { headers: { AUTH_TOKEN: token, 'Content-Type': 'application/json' } });

      if (response.data.IsSuccess) {
        logger.info('MarketMan: nuevas categorias creadas correctamente');
        return { success: true };
      }

      // Si fallo el lote, intentar crear una por una
      logger.warn(`MarketMan CreatePOSCategories lote fallo: ${response.data.ErrorMessage}. Intentando una por una...`);
      let creadas = 0;
      let fallidas = 0;

      for (const cat of nuevas) {
        try {
          const r = await axios.post(`${BASE_URL}/buyers/pos/CreatePOSCategories`, {
            BuyerGuid: this.buyerGuid,
            POSCategories: [cat]
          }, { headers: { AUTH_TOKEN: token, 'Content-Type': 'application/json' } });

          if (r.data.IsSuccess) {
            creadas++;
            logger.info(`MarketMan: categoria "${cat.Name}" creada`);
          } else if (String(r.data.ErrorCode) === '22' || (r.data.ErrorMessage || '').includes('already exist')) {
            creadas++;
            logger.info(`MarketMan: categoria "${cat.Name}" ya existia`);
          } else {
            fallidas++;
            logger.error(`MarketMan: categoria "${cat.Name}" fallo: ${r.data.ErrorMessage}`);
          }
        } catch (err) {
          fallidas++;
          logger.error(`MarketMan: categoria "${cat.Name}" error: ${err.message}`);
        }
      }

      logger.info(`MarketMan: categorias - ${creadas} creadas, ${fallidas} fallidas`);
      return { success: fallidas === 0, error: fallidas > 0 ? `${fallidas} categorias no se pudieron crear` : null };

    } catch (error) {
      const msg = error.response?.data ? JSON.stringify(error.response.data) : error.message;
      logger.error(`MarketMan: error sincronizando categorias: ${msg}`);
      return { success: false, error: msg };
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

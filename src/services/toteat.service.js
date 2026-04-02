const axios = require('axios');
const logger = require('../utils/logger');

class ToteatService {
  constructor(config = {}) {
    this.config = {
      baseUrl: config.baseUrl || 'https://api.toteat.com/mw/or/1.0',
      token: config.token || process.env.LOC1_TOTEAT_TOKEN || 'C92Q8x9bq6Ix5QJWIQsvravh7Q1la7Np',
      restaurantId: config.restaurantId || process.env.LOC1_TOTEAT_RESTAURANT_ID || '6512174172209152',
      localId: config.localId || process.env.LOC1_TOTEAT_LOCAL_ID || '1',
      userId: config.userId || '1001'
    };
  }
  /**
   * Obtiene la recaudacion de un dia desde la API de Toteat
   * @param {Date|string} date - Fecha a consultar
   * @returns {Promise<Object>} - Datos de ventas del dia
   */
  async getCollection(date = null) {
    // Formatear fecha como YYYYMMDD
    const targetDate = date ? new Date(date) : new Date();
    const dateStr = targetDate.toISOString().split('T')[0].replace(/-/g, '');

    logger.info(`Consultando API Toteat para fecha: ${dateStr}`);

    try {
      // Todos los parametros van como query params segun documentacion Toteat
      const url = `${this.config.baseUrl}/collection?xir=${this.config.restaurantId}&xil=${this.config.localId}&xiu=${this.config.userId}&xapitoken=${this.config.token}&date=${dateStr}`;

      logger.info(`URL: ${url}`);

      const response = await axios.get(url, {
        timeout: 30000
      });

      if (response.data && response.data.ok) {
        logger.info('Datos obtenidos exitosamente de Toteat (collection)');
        let data = response.data.data;

        // Si la collection viene vacia (sin shifts), intentar endpoints alternativos
        const isShiftsEmpty = !data || !data.shifts || (typeof data.shifts === 'object' && Object.keys(data.shifts).length === 0) || (Array.isArray(data.shifts) && data.shifts.length === 0);
        if (isShiftsEmpty) {
          logger.info('Collection vacia — intentando endpoints alternativos (orders/sales)');
          const alt = await this.tryAlternateEndpoints(date);
          if (alt && alt.found) {
            data = alt.data;
            logger.info(`Datos obtenidos desde endpoint alternativo: ${alt.endpoint}`);
          }
        }

        return {
          success: true,
          data,
          message: response.data.msg?.texto || 'OK'
        };
      } else {
        throw new Error(response.data?.msg?.texto || 'Error en respuesta de Toteat');
      }

    } catch (error) {
      logger.error('Error consultando API Toteat:', error.message);

      if (error.response) {
        // Error de respuesta del servidor
        const status = error.response.status;
        if (status === 400) {
          throw new Error('Parametros invalidos');
        } else if (status === 429) {
          throw new Error('Limite de solicitudes excedido (1 por minuto)');
        }
      }

      throw error;
    }
  }

  /**
   * Procesa los datos de collection y extrae las ventas por producto
   * @param {Object} collectionData - Datos crudos de la API
   * @returns {Array} - Lista de productos con ventas
   */
  parseCollectionToProducts(collectionData) {
    const products = [];

    if (!collectionData || !collectionData.shifts) {
      return products;
    }

    // Helper: convierte arrays u objetos en arrays
    const toArray = (val) => {
      if (!val) return [];
      if (Array.isArray(val)) return val;
      if (typeof val === 'object') return Object.values(val);
      return [];
    };

    // Helper: parsea montos que pueden venir como string
    const parseAmount = (amt) => {
      if (typeof amt === 'number') return amt;
      if (typeof amt === 'string') return parseFloat(amt.replace(/,/g, '').replace(/[^0-9.-]/g, '')) || 0;
      return 0;
    };

    // Iterar por turnos (soporta objeto o array)
    const shifts = toArray(collectionData.shifts);
    for (const shift of shifts) {
      if (!shift) continue;

      // Algunos responses incluyen `sales` a nivel de turno
      const salesCategories = toArray(shift.sales);
      for (const category of salesCategories) {
        if (!category) continue;
        const items = toArray(category.items);
        for (const item of items) {
          const cantidad = item.quantity || item.q || 0;
          const total = parseAmount(item.total || item.amount || item.totalWithTax || 0);
          const totalWithTax = parseAmount(item.totalWithTax || item.amountWithTax || item.total || 0);

          products.push({
            producto: (item.name || item.product || '').toString(),
            codigo: item.id || item.code || '',
            cantidad: Number(cantidad) || 0,
            ventaSinImpuesto: Math.round(total),
            ventaConImpuesto: Math.round(totalWithTax || total),
            categoria: category.name || category.category || 'OTROS'
          });
        }
      }

      // También puede venir itemizacion dentro de registers -> movements
      const registers = toArray(shift.registers);
      for (const reg of registers) {
        const movements = toArray(reg.movements);
        for (const mv of movements) {
          const mvItems = toArray(mv.items || mv.orderItems || mv.products);
          for (const it of mvItems) {
            const cantidad = it.quantity || it.qty || 0;
            const total = parseAmount(it.total || it.amount || (it.price && cantidad ? it.price * cantidad : 0));
            const totalWithTax = parseAmount(it.totalWithTax || it.amountWithTax || total);

            products.push({
              producto: (it.name || it.product || '').toString(),
              codigo: it.id || it.code || '',
              cantidad: Number(cantidad) || 0,
              ventaSinImpuesto: Math.round(total),
              ventaConImpuesto: Math.round(totalWithTax || total),
              categoria: it.category || mv.type || 'OTROS'
            });
          }
        }

        // Extraer metodos de pago como items (cuando no hay itemizacion detallada)
        const paymentMethods = toArray(reg.paymentMethods || reg.paymentMethod || reg.payment);
        for (const pm of paymentMethods) {
          const amount = parseAmount(pm.amount || pm.total || 0);
          const methodName = (pm.paymentMethod || pm.method || pm.name || 'Otro').toString().replace(/,$/, '').trim();

          products.push({
            producto: methodName,
            codigo: pm.paymentMethodID || pm.id || '',
            cantidad: 1,
            ventaSinImpuesto: Math.round(amount / 1.19),
            ventaConImpuesto: Math.round(amount),
            categoria: `Pago - ${reg.registerName || reg.resgisterName || 'Caja'}`
          });
        }

        // Si no hay paymentMethods pero existe finalAmount > 0, agregar cierre de caja
        const finalAmount = parseAmount(reg.finalAmount || reg.closingAmount || 0);
        if ((!paymentMethods || paymentMethods.length === 0) && finalAmount > 0) {
          products.push({
            producto: `Cierre de caja (${reg.closedCashier || reg.openedCashier || 'N/A'})`,
            codigo: reg.closedDate ? (reg.closedDate.split('T')[0] || '') : '',
            cantidad: 1,
            ventaSinImpuesto: Math.round(finalAmount / 1.19),
            ventaConImpuesto: Math.round(finalAmount),
            categoria: `Cierre - ${reg.registerName || reg.resgisterName || 'Caja'}`
          });
        }
      }
    }

    return products;
  }

  /**
   * Prueba la conexion con la API de Toteat
   * @returns {Promise<Object>}
   */
  async testConnection() {
    try {
      // Usar fecha de ayer para prueba
      const yesterday = new Date();
      yesterday.setDate(yesterday.getDate() - 1);

      const result = await this.getCollection(yesterday);
      return {
        connected: true,
        message: result.message
      };
    } catch (error) {
      return {
        connected: false,
        error: error.message
      };
    }
  }

  /**
   * Obtiene todos los productos (menu) desde la API de Toteat
   */
  async getProducts() {
    try {
      const url = `${this.config.baseUrl}/products?xir=${this.config.restaurantId}&xil=${this.config.localId}&xiu=${this.config.userId}&xapitoken=${this.config.token}`;
      logger.info(`Consultando todos los productos Toteat: ${url}`);
      
      const response = await axios.get(url, { timeout: 30000 });
      if (response.data && response.data.data) {
        // En /products a veces la data viene directo o en otro nivel
        const productsList = Array.isArray(response.data.data) ? response.data.data : [];
        return { success: true, data: productsList };
      }
      return { success: false, message: 'No se encontraron productos' };
    } catch (error) {
      logger.error('Error consultando productos Toteat:', error.message);
      return { success: false, message: error.message };
    }
  }

  /**
   * Parse todos los productos de Toteat a formato base
   */
  parseProducts(productsData) {
    const products = [];
    if (!Array.isArray(productsData)) return products;
    
    for (const item of productsData) {
      if (!item || !item.id) continue;
      
      products.push({
        producto: (item.name || '').replace(/\\u[\dA-Fa-f]{4}/g, (m) =>
            String.fromCharCode(parseInt(m.slice(2), 16))),
        codigo: item.id || '',
        precioUnitario: Math.round(item.price || 0),
        cantidad: 0,
        ventaSinImpuesto: 0,
        ventaConImpuesto: 0,
        categoria: item.category || 'OTROS'
      });
    }
    
    return products;
  }

  /**
   * Intenta llamar endpoints alternativos comunes para obtener ventas itemizadas
   * Devuelve el primer resultado que contenga datos relevantes
   */
  async tryAlternateEndpoints(date) {
    const dateStr = date ? new Date(date).toISOString().split('T')[0].replace(/-/g, '') : new Date().toISOString().split('T')[0].replace(/-/g, '');
    const candidates = ['orders', 'sales', 'orders/list', 'orders/day', 'order', 'transactions'];

    for (const ep of candidates) {
      try {
        const url = `${this.config.baseUrl}/${ep}?xir=${this.config.restaurantId}&xil=${this.config.localId}&xiu=${this.config.userId}&xapitoken=${this.config.token}&date=${dateStr}`;
        logger.info(`Intentando endpoint alternativo: ${url}`);
        const resp = await axios.get(url, { timeout: 20000 });
        if (resp.data && resp.data.ok && resp.data.data) {
          // si trae orders o lista con elementos
          const d = resp.data.data;
          const hasOrders = (d.orders && (Array.isArray(d.orders) ? d.orders.length > 0 : Object.keys(d.orders || {}).length > 0)) || (Array.isArray(d) && d.length > 0) || (d.sales && Object.keys(d.sales || {}).length > 0);
          if (hasOrders) {
            return { found: true, endpoint: ep, data: d };
          }
          // A veces la respuesta ya está en resp.data (no en data)
          if (resp.data.orders && resp.data.orders.length > 0) {
            return { found: true, endpoint: ep, data: resp.data };
          }
        }
      } catch (err) {
        logger.info(`Endpoint alternativo ${ep} respondio error o no existe`);
      }
    }

    return { found: false };
  }

  /**
   * Obtiene las ventas desde la API de Toteat
   * Usa el endpoint /sales con parámetros ini y end (formato YYYYMMDD)
   * @param {string} startDate - Fecha inicio (YYYY-MM-DD)
   * @param {string} endDate - Fecha fin (YYYY-MM-DD), opcional (usa startDate si no se pasa)
   */
  async getSales(startDate = null, endDate = null) {
    const start = startDate ? new Date(startDate) : new Date();
    const end = endDate ? new Date(endDate) : start;
    const startStr = start.toISOString().split('T')[0].replace(/-/g, '');
    const endStr = end.toISOString().split('T')[0].replace(/-/g, '');

    logger.info(`Consultando ventas de Toteat para rango: ${startStr} - ${endStr}`);

    try {
      const url = `${this.config.baseUrl}/sales?xir=${this.config.restaurantId}&xil=${this.config.localId}&xiu=${this.config.userId}&xapitoken=${this.config.token}&ini=${startStr}&end=${endStr}`;

      logger.info(`URL sales: ${url}`);

      const response = await axios.get(url, { timeout: 30000 });

      logger.info(`Toteat response status: ${response.status}, ok: ${response.data?.ok}, keys: ${Object.keys(response.data || {}).join(',')}`);

      if (response.data && response.data.data) {
        const data = response.data.data;
        logger.info(`Ventas obtenidas: ${Array.isArray(data) ? data.length : 0} ordenes`);
        return {
          success: true,
          data: data,
          message: response.data.msg?.texto || 'OK'
        };
      }

      // Capturar el mensaje real de error de Toteat
      const errorMsg = response.data?.msg?.texto
        || response.data?.message
        || response.data?.error
        || JSON.stringify(response.data)
        || 'No se encontraron ventas';

      logger.warn(`Toteat sin datos: ${errorMsg}`);
      return { success: false, message: errorMsg };

    } catch (err) {
      const status = err.response?.status;
      const apiMsg = err.response?.data?.msg?.texto || err.response?.data?.message || err.response?.data?.error;
      const fullMsg = status ? `HTTP ${status}${apiMsg ? ': ' + apiMsg : ''}` : err.message;
      logger.error(`Error obteniendo ventas: ${fullMsg}`);
      return { success: false, message: fullMsg };
    }
  }

  /**
   * Parsea las ventas de Toteat a formato de productos
   */
  parseSalesToProducts(salesData) {
    const products = [];

    if (!Array.isArray(salesData)) {
      return products;
    }

    for (const order of salesData) {
      if (!order || !order.products) continue;

      for (const item of order.products) {
        const cantidad = item.quantity || 1;
        const netPrice = item.netPrice || item.payed || 0;
        const taxes = item.taxes || 0;

        products.push({
          producto: (item.name || '').replace(/\\u[\dA-Fa-f]{4}/g, (m) =>
            String.fromCharCode(parseInt(m.slice(2), 16))),
          codigo: item.id || '',
          precioUnitario: Math.round(netPrice / cantidad),
          cantidad: cantidad,
          ventaSinImpuesto: Math.round(netPrice - taxes),
          ventaConImpuesto: Math.round(netPrice),
          categoria: item.hierarchyName || 'OTROS'
        });
      }
    }

    return products;
  }

  /**
   * Parsea ordenes de Toteat a formato de productos vendidos
   */
  parseOrdersToProducts(ordersData) {
    const products = [];

    const toArray = (val) => {
      if (!val) return [];
      if (Array.isArray(val)) return val;
      if (typeof val === 'object') return Object.values(val);
      return [];
    };

    const parseAmount = (amt) => {
      if (typeof amt === 'number') return amt;
      if (typeof amt === 'string') return parseFloat(amt.replace(/,/g, '').replace(/[^0-9.-]/g, '')) || 0;
      return 0;
    };

    // Si viene como array de ordenes
    const orders = toArray(ordersData.orders || ordersData);

    for (const order of orders) {
      if (!order) continue;

      // Cada orden puede tener items/products/orderItems
      const items = toArray(order.items || order.products || order.orderItems || order.details);

      for (const item of items) {
        const cantidad = parseAmount(item.quantity || item.qty || item.q || 1);
        const precio = parseAmount(item.price || item.unitPrice || item.precioUnitario || 0);
        const total = parseAmount(item.total || item.amount || item.subtotal || (precio * cantidad));
        const totalConIva = parseAmount(item.totalWithTax || item.totalConImpuesto || item.amountWithTax || Math.round(total * 1.19));

        if (item.name || item.product || item.productName || item.description) {
          products.push({
            producto: (item.name || item.product || item.productName || item.description || '').toString(),
            codigo: item.id || item.productId || item.code || item.sku || '',
            precioUnitario: Math.round(precio),
            cantidad: cantidad,
            ventaSinImpuesto: Math.round(total),
            ventaConImpuesto: Math.round(totalConIva),
            categoria: item.category || item.categoryName || order.type || 'VENTAS'
          });
        }
      }
    }

    return products;
  }

  /**
   * Diagnostico: prueba todos los endpoints conocidos y devuelve info de cada uno
   */
  async diagnoseEndpoints(date = null) {
    const targetDate = date ? new Date(date) : new Date();
    const dateStr = targetDate.toISOString().split('T')[0].replace(/-/g, '');

    const results = [];
    const endpoints = [
      'collection', 'order', 'orders', 'sales', 'salesByProduct',
      'salesByCategory', 'transactions', 'menu', 'products'
    ];

    for (const ep of endpoints) {
      try {
        const url = `${this.config.baseUrl}/${ep}?xir=${this.config.restaurantId}&xil=${this.config.localId}&xiu=${this.config.userId}&xapitoken=${this.config.token}&date=${dateStr}`;

        const response = await axios.get(url, { timeout: 15000 });

        results.push({
          endpoint: ep,
          status: response.status,
          ok: response.data?.ok || false,
          hasData: !!response.data?.data,
          dataKeys: response.data?.data ? Object.keys(response.data.data) : [],
          sample: JSON.stringify(response.data).substring(0, 500)
        });
      } catch (err) {
        results.push({
          endpoint: ep,
          status: err.response?.status || 'error',
          error: err.message
        });
      }
    }

    return results;
  }
}

module.exports = ToteatService;

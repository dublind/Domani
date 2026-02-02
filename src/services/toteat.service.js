const axios = require('axios');
const logger = require('../utils/logger');

// Configuracion API Toteat
// URL de produccion (cambiar a toteatdev si es desarrollo)
const TOTEAT_CONFIG = {
  baseUrl: process.env.TOTEAT_BASE_URL || 'https://api.toteat.com/mw/or/1.0',
  token: process.env.TOTEAT_TOKEN || 'C92Q8x9bq6Ix5QJWIQsvravh7Q1la7Np',
  restaurantId: process.env.TOTEAT_RESTAURANT_ID || '6512174172209152',
  localId: process.env.TOTEAT_LOCAL_ID || '1',
  userId: process.env.TOTEAT_USER_ID || '1001'
};

class ToteatService {
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
      const url = `${TOTEAT_CONFIG.baseUrl}/collection?xir=${TOTEAT_CONFIG.restaurantId}&xil=${TOTEAT_CONFIG.localId}&xiu=${TOTEAT_CONFIG.userId}&xapitoken=${TOTEAT_CONFIG.token}&date=${dateStr}`;

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
   * Intenta llamar endpoints alternativos comunes para obtener ventas itemizadas
   * Devuelve el primer resultado que contenga datos relevantes
   */
  async tryAlternateEndpoints(date) {
    const dateStr = date ? new Date(date).toISOString().split('T')[0].replace(/-/g, '') : new Date().toISOString().split('T')[0].replace(/-/g, '');
    const candidates = ['orders', 'sales', 'orders/list', 'orders/day', 'order', 'transactions'];

    for (const ep of candidates) {
      try {
        const url = `${TOTEAT_CONFIG.baseUrl}/${ep}?xir=${TOTEAT_CONFIG.restaurantId}&xil=${TOTEAT_CONFIG.localId}&xiu=${TOTEAT_CONFIG.userId}&xapitoken=${TOTEAT_CONFIG.token}&date=${dateStr}`;
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
   * Obtiene las ventas de un dia desde la API de Toteat
   * Usa el endpoint /sales con parámetros ini y end (formato YYYYMMDD)
   */
  async getSales(date = null) {
    const targetDate = date ? new Date(date) : new Date();
    const dateStr = targetDate.toISOString().split('T')[0].replace(/-/g, '');

    logger.info(`Consultando ventas de Toteat para fecha: ${dateStr}`);

    try {
      const url = `${TOTEAT_CONFIG.baseUrl}/sales?xir=${TOTEAT_CONFIG.restaurantId}&xil=${TOTEAT_CONFIG.localId}&xiu=${TOTEAT_CONFIG.userId}&xapitoken=${TOTEAT_CONFIG.token}&ini=${dateStr}&end=${dateStr}`;

      logger.info(`URL sales: ${url}`);

      const response = await axios.get(url, { timeout: 30000 });

      if (response.data && response.data.data) {
        const data = response.data.data;
        logger.info(`Ventas obtenidas: ${Array.isArray(data) ? data.length : 0} ordenes`);
        return {
          success: true,
          data: data,
          message: response.data.msg?.texto || 'OK'
        };
      }

      return { success: false, message: 'No se encontraron ventas' };

    } catch (err) {
      logger.error(`Error obteniendo ventas: ${err.message}`);
      return { success: false, message: err.message };
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
        const url = `${TOTEAT_CONFIG.baseUrl}/${ep}?xir=${TOTEAT_CONFIG.restaurantId}&xil=${TOTEAT_CONFIG.localId}&xiu=${TOTEAT_CONFIG.userId}&xapitoken=${TOTEAT_CONFIG.token}&date=${dateStr}`;

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

module.exports = new ToteatService();

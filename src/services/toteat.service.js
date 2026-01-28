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
        logger.info('Datos obtenidos exitosamente de Toteat');
        return {
          success: true,
          data: response.data.data,
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

    // Iterar por turnos
    for (const shift of collectionData.shifts) {
      if (!shift.sales) continue;

      // Iterar por categorias de ventas
      for (const category of shift.sales) {
        if (!category.items) continue;

        for (const item of category.items) {
          products.push({
            producto: item.name || '',
            codigo: item.id || '',
            cantidad: item.quantity || 0,
            ventaSinImpuesto: item.total || 0,
            ventaConImpuesto: item.totalWithTax || item.total || 0,
            categoria: category.name || 'OTROS'
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
}

module.exports = new ToteatService();

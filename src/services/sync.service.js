const toteatService = require('./toteat.service');
const collectionParserService = require('./collection-parser.service');
const logger = require('../utils/logger');

class SyncService {
  /**
   * Obtiene los datos de ventas de Toteat
   * @param {Date} date - Fecha del reporte (opcional, default: ayer)
   * @returns {Promise<Object>} - Resultado con los datos procesados
   */
  async getDailySalesFromToteat(date = null) {
    const startTime = Date.now();
    const syncDate = date || new Date(Date.now() - 24 * 60 * 60 * 1000);
    const formattedDate = syncDate.toISOString().split('T')[0];

    logger.info(`Obteniendo datos de Toteat para ${formattedDate}`);

    const result = {
      success: false,
      date: formattedDate,
      data: [],
      summary: {},
      errors: [],
      duration: 0
    };

    try {
      // 1. Obtener datos de Toteat
      logger.info('Obteniendo colección de Toteat');
      const collectionData = await toteatService.getDailySalesReport(syncDate);

      if (!collectionData) {
        throw new Error('No se obtuvieron datos de Toteat');
      }

      // 2. Procesar datos
      logger.info('Procesando datos de colección');
      const parsedCollection = collectionParserService.parseCollection(collectionData, formattedDate);
      const summary = collectionParserService.generateSummary(parsedCollection);

      result.success = true;
      result.data = parsedCollection;
      result.summary = summary;
      result.duration = Date.now() - startTime;

      logger.info(`Datos de Toteat procesados exitosamente (${result.duration}ms)`);
      logger.info(`Resumen: ${JSON.stringify(summary)}`);

      return result;

    } catch (error) {
      result.errors.push(error.message);
      result.duration = Date.now() - startTime;
      
      logger.error('Error en getDailySalesFromToteat:', {
        message: error.message,
        stack: error.stack,
        date: formattedDate
      });

      return result;
    }
  }

  /**
   * Prueba la conexión a Toteat
   * @returns {Promise<Object>} - Resultado de la prueba
   */
  async testConnections() {
    logger.info('Iniciando prueba de conexiones');
    
    const result = {
      toteat: null
    };

    try {
      logger.info('Probando conexión con Toteat');
      result.toteat = await toteatService.testConnection();
      
      return {
        success: result.toteat.connected,
        services: result,
        timestamp: new Date().toISOString()
      };

    } catch (error) {
      logger.error('Error en testConnections:', error.message);
      return {
        success: false,
        services: result,
        error: error.message,
        timestamp: new Date().toISOString()
      };
    }
  }

  /**
   * Obtiene el estado del servicio
   * @returns {Object}
   */
  getStatus() {
    return {
      service: 'Toteat API Sync',
      running: true,
      timestamp: new Date().toISOString()
    };
  }
}

module.exports = new SyncService();

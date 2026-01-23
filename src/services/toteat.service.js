const axios = require('axios');
const fs = require('fs');
const path = require('path');
const config = require('../config/config');
const logger = require('../utils/logger');

class ToteatService {
  constructor() {
    this.apiUrl = config.toteat.apiUrl;
    this.apiKey = config.toteat.apiKey;
    this.restaurantId = config.toteat.restaurantId;
    this.localId = config.toteat.localId || '1';
    this.userId = config.toteat.apiUserId || '1001';
    this.useLocalFile = process.env.TOTEAT_USE_LOCAL_FILE === 'true';
    this.localFilePath = path.join(__dirname, '../../data/sample-collection.json');

    this.client = axios.create({
      baseURL: this.apiUrl,
      headers: {
        'Content-Type': 'application/json'
      },
      httpsAgent: new (require('https').Agent)({ rejectUnauthorized: false }),
      timeout: 10000
    });
  }

  /**
   * Carga datos desde archivo local
   * @returns {Object} - Datos de collection desde archivo
   */
  loadFromLocalFile() {
    try {
      logger.info(`Cargando datos desde archivo local: ${this.localFilePath}`);
      const fileContent = fs.readFileSync(this.localFilePath, 'utf8');
      const data = JSON.parse(fileContent);
      logger.info('Datos cargados exitosamente desde archivo local');
      return data.data;
    } catch (error) {
      logger.error(`Error cargando archivo local: ${error.message}`);
      throw new Error(`No se pudo cargar el archivo local: ${error.message}`);
    }
  }

  /**
   * Obtiene el reporte de cajas (collection) de Toteat
   * @param {Date} date - Fecha del reporte (default: ayer)
   * @returns {Promise<Object>} - Datos de cajas y métodos de pago
   */
  async getDailySalesReport(date = null) {
    // Si está habilitado el modo local, cargar desde archivo
    if (this.useLocalFile) {
      logger.info('Modo local activado - cargando datos desde archivo');
      return this.loadFromLocalFile();
    }

    try {
      const reportDate = date || new Date(Date.now() - 24 * 60 * 60 * 1000);
      // Formato YYYYMMDD sin guiones
      const formattedDate = reportDate.toISOString().split('T')[0].replace(/-/g, '');

      logger.info(`Obteniendo reporte de cajas de Toteat para ${formattedDate}`);
      logger.info(`URL: ${this.apiUrl}/collection`);
      logger.info(`Params: xir=${this.restaurantId}, xil=${this.localId}, xiu=${this.userId}, date=${formattedDate}`);

      const response = await this.client.get('/collection', {
        params: {
          xir: this.restaurantId,
          xil: this.localId,
          xiu: this.userId,
          xapitoken: this.apiKey,
          date: formattedDate
        }
      });

      if (response.data && response.data.ok) {
        const collectionData = response.data.data || {};
        logger.info(`Reporte de cajas obtenido exitosamente`);
        logger.info(`Respuesta: ${response.data.msg.texto}`);
        return collectionData;
      } else {
        throw new Error(response.data?.msg?.texto || 'Error desconocido en respuesta de Toteat');
      }

    } catch (error) {
      logger.error('Error obteniendo reporte de Toteat:', {
        message: error.message,
        status: error.response?.status,
        statusText: error.response?.statusText,
        data: error.response?.data,
        url: error.config?.url,
        params: error.config?.params
      });

      if (error.response?.status === 404) {
        throw new Error('Endpoint /collection no encontrado en Toteat. Verifica la URL del API.');
      }

      if (error.response?.data?.msg?.tipo === 7) {
        throw new Error('Token de Toteat sin permisos de API. Contacta a soporte@toteat.com para activar permisos.');
      }

      throw new Error(`Error al obtener reporte de Toteat: ${error.message}`);
    }
  }

  /**
   * Verifica el estado de la conexión con Toteat
   * @returns {Promise<Object>} - Estado de la conexión
   */
  async testConnection() {
    // Si está en modo local, verificar que el archivo existe
    if (this.useLocalFile) {
      logger.info('Modo local activado - verificando archivo de datos');
      try {
        this.loadFromLocalFile();
        return {
          connected: true,
          mode: 'local',
          message: 'Modo local activo - datos cargados desde archivo',
          timestamp: new Date().toISOString()
        };
      } catch (error) {
        return {
          connected: false,
          mode: 'local',
          message: error.message,
          timestamp: new Date().toISOString()
        };
      }
    }

    try {
      const yesterday = new Date(Date.now() - 24 * 60 * 60 * 1000);
      const formattedDate = yesterday.toISOString().split('T')[0].replace(/-/g, '');

      logger.info(`Probando conexión con Toteat`);
      logger.info(`URL: ${this.apiUrl}/collection?xir=${this.restaurantId}&xil=${this.localId}&xiu=${this.userId}&date=${formattedDate}`);

      const response = await this.client.get('/collection', {
        params: {
          xir: this.restaurantId,
          xil: this.localId,
          xiu: this.userId,
          xapitoken: this.apiKey,
          date: formattedDate
        }
      });

      logger.info('Respuesta de Toteat:', response.data);

      if (response.data && response.data.ok === true) {
        return {
          connected: true,
          message: response.data.msg?.texto || 'Conexión exitosa con Toteat',
          timestamp: new Date().toISOString()
        };
      } else {
        return {
          connected: false,
          message: response.data?.msg?.texto || 'Respuesta inválida de Toteat',
          responseData: response.data,
          timestamp: new Date().toISOString()
        };
      }

    } catch (error) {
      let errorMessage = error.message;
      
      if (error.response?.status === 404) {
        errorMessage = `Endpoint no encontrado (404). Verifica la URL: ${this.apiUrl}/collection`;
      } else if (error.response?.status === 401 || error.response?.status === 403) {
        errorMessage = `Error de autenticación (${error.response.status}). Verifica los parámetros: xir, xil, xiu, xapitoken`;
      } else if (error.code === 'ECONNREFUSED') {
        errorMessage = `Conexión rechazada. ¿El servidor de Toteat está disponible? URL: ${this.apiUrl}`;
      } else if (error.response?.data?.msg?.tipo === 7) {
        errorMessage = `Token sin permisos (tipo 7). Contacta a Toteat para activar permisos de API.`;
      }

      logger.error('Error en testConnection:', {
        message: errorMessage,
        status: error.response?.status,
        statusText: error.response?.statusText,
        responseData: error.response?.data,
        url: this.apiUrl,
        params: {
          xir: this.restaurantId,
          xil: this.localId,
          xiu: this.userId
        }
      });

      return {
        connected: false,
        message: errorMessage,
        timestamp: new Date().toISOString()
      };
    }
  }

  /**
   * Formatea una fecha a formato YYYY-MM-DD
   * @param {Date} date - Fecha a formatear
   * @returns {string} - Fecha formateada
   */
  formatDate(date) {
    return date.toISOString().split('T')[0];
  }

  /**
   * Valida que las credenciales estén configuradas
   * @returns {boolean}
   */
  validateCredentials() {
    if (!this.apiKey || !this.localId) {
      logger.error('Credenciales de Toteat no configuradas');
      return false;
    }
    return true;
  }
}

module.exports = new ToteatService();

const cron = require('node-cron');
const fs = require('fs');
const path = require('path');
const XLSX = require('xlsx');
const ToteatService = require('./toteat.service');
const emailService = require('./email.service');
const marketmanService = require('./marketman.service');
const logger = require('../utils/logger');
const { getLocations } = require('../config/locations');

class SchedulerService {
  constructor() {
    this.exportDir = path.join(__dirname, '..', '..', 'data', 'exports');
    this.ensureExportDir();
  }

  /**
   * Asegura que el directorio de exportación exista
   */
  ensureExportDir() {
    if (!fs.existsSync(this.exportDir)) {
      fs.mkdirSync(this.exportDir, { recursive: true });
      logger.info(`Directorio de exportación creado: ${this.exportDir}`);
    }
  }

  /**
   * Inicia las tareas programadas
   */
  start() {
    // Ejecutar todos los dias a las 8:00 AM hora Chile
    // Formato cron: minuto hora dia mes diaSemana
    cron.schedule('0 8 * * *', async () => {
      logger.info('=== TAREA PROGRAMADA: Exportacion automatica de ventas ===');
      await this.exportYesterdaySales();
    }, {
      timezone: 'America/Santiago' // Zona horaria de Chile
    });

    logger.info('Tarea programada configurada: Exportacion diaria a las 8:00 AM (Chile)');
  }

  /**
   * Exporta las ventas del día anterior a Excel
   */
  async exportYesterdaySales() {
    const yesterday = new Date();
    yesterday.setDate(yesterday.getDate() - 1);
    const dateStr = yesterday.toISOString().split('T')[0];

    logger.info(`Exportando ventas del ${dateStr} para todos los restaurantes...`);

    const locations = getLocations();
    if (locations.length === 0) {
      logger.error('No hay restaurantes configurados en el .env');
      return { success: false, error: 'No hay restaurantes configurados' };
    }

    const results = [];
    for (const location of locations) {
      logger.info(`=== Procesando: ${location.name} ===`);
      const result = await this.exportLocationSales(location, dateStr);
      results.push({ location: location.name, ...result });
    }

    return { success: true, results };
  }

  /**
   * Exporta las ventas de un restaurante específico para una fecha
   */
  async exportLocationSales(location, dateStr) {
    try {
      const toteatService = new ToteatService(location.toteat);
      const result = await toteatService.getSales(dateStr);

      if (!result.success) {
        logger.error(`[${location.name}] Error obteniendo ventas: ${result.message}`);
        return { success: false, error: result.message };
      }

      if (!result.data || result.data.length === 0) {
        logger.warn(`[${location.name}] No hay ventas para el ${dateStr}`);
        return { success: false, error: 'No hay ventas para esta fecha' };
      }

      const products = toteatService.parseSalesToProducts(result.data);
      const totalSinImpuesto = products.reduce((sum, p) => sum + (p.ventaSinImpuesto || 0), 0);
      const totalConImpuesto = products.reduce((sum, p) => sum + (p.ventaConImpuesto || 0), 0);

      const porCategoria = {};
      products.forEach(p => {
        if (!porCategoria[p.categoria]) {
          porCategoria[p.categoria] = { cantidad: 0, totalSinIva: 0, totalConIva: 0 };
        }
        porCategoria[p.categoria].cantidad += p.cantidad;
        porCategoria[p.categoria].totalSinIva += p.ventaSinImpuesto;
        porCategoria[p.categoria].totalConIva += p.ventaConImpuesto;
      });

      const filePath = await this.generateExcel(dateStr, products, porCategoria, {
        totalSinImpuesto,
        totalConImpuesto,
        ordenes: result.data.length
      }, null, location.name);

      logger.info(`[${location.name}] Excel exportado: ${filePath}`);

      // Subir a MarketMan si tiene BuyerGuid configurado
      let marketmanUploaded = false;
      if (location.marketman.buyerGuid) {
        const marketmanResult = await marketmanService.uploadSales(
          dateStr, dateStr, products,
          { totalSinImpuesto, totalConImpuesto },
          location.marketman.buyerGuid
        );
        marketmanUploaded = marketmanResult.success;
        if (marketmanUploaded) {
          logger.info(`[${location.name}] Ventas subidas a MarketMan`);
        } else {
          logger.warn(`[${location.name}] MarketMan upload falló: ${marketmanResult.error}`);
        }
      } else {
        logger.info(`[${location.name}] Sin BuyerGuid de MarketMan, se omite upload`);
      }

      const emailResult = await emailService.sendSalesReport(filePath, dateStr, {
        productos: products.length,
        ordenes: result.data.length,
        total: totalConImpuesto
      });

      return {
        success: true,
        filePath,
        productos: products.length,
        ordenes: result.data.length,
        total: totalConImpuesto,
        emailSent: emailResult.success,
        marketmanUploaded
      };

    } catch (error) {
      logger.error(`[${location.name}] Error en exportación:`, error);
      return { success: false, error: error.message };
    }
  }

  /**
   * Genera el archivo Excel en formato Marketman
   * @param {string} startDate - Fecha inicio (YYYY-MM-DD)
   * @param {string} endDate - Fecha fin (YYYY-MM-DD), opcional
   */
  async generateExcel(startDate, products, porCategoria, totales, endDate = null, locationName = 'Domani') {
    const formatDate = (d) => { const [y, m, dd] = d.split('-'); return `${dd}/${m}/${y}`; };
    const formattedStart = formatDate(startDate);
    const formattedEnd = endDate ? formatDate(endDate) : formattedStart;

    // Agrupar productos por nombre y sumar cantidades/totales
    const productosAgrupados = {};
    for (const p of products) {
      const key = p.producto;
      if (!productosAgrupados[key]) {
        productosAgrupados[key] = {
          producto: p.producto,
          codigo: p.codigo,
          precioUnitario: p.precioUnitario,
          cantidad: 0,
          ventaSinImpuesto: 0,
          ventaConImpuesto: 0,
          categoria: p.categoria
        };
      }
      productosAgrupados[key].cantidad += p.cantidad;
      productosAgrupados[key].ventaSinImpuesto += p.ventaSinImpuesto;
      productosAgrupados[key].ventaConImpuesto += p.ventaConImpuesto;
    }

    // Convertir a array y ordenar por cantidad descendente
    const productosOrdenados = Object.values(productosAgrupados)
      .sort((a, b) => b.cantidad - a.cantidad);

    // Formato Marketman
    const data = [
      ['Location name', locationName],
      ['Begin date', formattedStart],
      ['End date', formattedEnd],
      ['Total revenue excl. tax', totales.totalSinImpuesto],
      ['Ingresos totales inc. impuesto', totales.totalConImpuesto],
      [], // Fila vacía
      ['ELEMENTO DE MENÚ', 'Menu item code', 'Menu item list price', 'Quantity sold', 'Sales total excl. tax', 'Ventas totales inc. impuesto', 'Categoría']
    ];

    // Agregar productos
    for (const p of productosOrdenados) {
      data.push([
        p.producto,
        p.codigo,
        p.precioUnitario,
        p.cantidad,
        p.ventaSinImpuesto,
        p.ventaConImpuesto,
        p.categoria
      ]);
    }

    // Crear workbook
    const wb = XLSX.utils.book_new();
    const ws = XLSX.utils.aoa_to_sheet(data);

    // Ajustar ancho de columnas
    ws['!cols'] = [
      { wch: 35 },  // ELEMENTO DE MENÚ
      { wch: 15 },  // Menu item code
      { wch: 18 },  // Menu item list price
      { wch: 14 },  // Quantity sold
      { wch: 20 },  // Sales total excl. tax
      { wch: 25 },  // Ventas totales inc. impuesto
      { wch: 30 }   // Categoría
    ];

    XLSX.utils.book_append_sheet(wb, ws, 'Sheet1');

    // Guardar archivo
    const fileName = endDate && endDate !== startDate
      ? `ventas_domani_${startDate}_a_${endDate}.xlsx`
      : `ventas_domani_${startDate}.xlsx`;
    const filePath = path.join(this.exportDir, fileName);

    XLSX.writeFile(wb, filePath);

    return filePath;
  }

  /**
   * Exporta ventas de un rango de fechas a Excel
   * @param {string} startDate
   * @param {string} endDate
   * @param {string|number} locIndex - índice de restaurante (1-based), opcional
   */
  async runRangeExport(startDate, endDate, locIndex = 1) {
    logger.info(`Exportación de rango: ${startDate} a ${endDate}`);

    const locations = getLocations();
    const idx = Math.max(0, Math.min(parseInt(locIndex, 10) - 1, locations.length - 1));
    const location = locations[idx];
    const toteatService = new ToteatService(location ? location.toteat : {});

    const result = await toteatService.getSales(startDate, endDate);

    if (!result.success) {
      return { success: false, error: result.message };
    }

    if (!result.data || result.data.length === 0) {
      return { success: false, error: 'No hay ventas para este rango de fechas' };
    }

    const products = toteatService.parseSalesToProducts(result.data);
    const totalSinImpuesto = products.reduce((sum, p) => sum + (p.ventaSinImpuesto || 0), 0);
    const totalConImpuesto = products.reduce((sum, p) => sum + (p.ventaConImpuesto || 0), 0);

    const porCategoria = {};
    products.forEach(p => {
      if (!porCategoria[p.categoria]) {
        porCategoria[p.categoria] = { cantidad: 0, totalSinIva: 0, totalConIva: 0 };
      }
      porCategoria[p.categoria].cantidad += p.cantidad;
      porCategoria[p.categoria].totalSinIva += p.ventaSinImpuesto;
      porCategoria[p.categoria].totalConIva += p.ventaConImpuesto;
    });

    const filePath = await this.generateExcel(startDate, products, porCategoria, {
      totalSinImpuesto,
      totalConImpuesto,
      ordenes: result.data.length
    }, endDate);

    return {
      success: true,
      filePath,
      productos: products.length,
      ordenes: result.data.length,
      total: totalConImpuesto
    };
  }

  /**
   * Ejecuta la exportación manualmente (para testing)
   */
  async runManualExport(date = null) {
    if (date) {
      const dateStr = date;
      logger.info(`Exportación manual para fecha: ${dateStr}`);

      const locations = getLocations();
      const location = locations[0];
      const toteatService = new ToteatService(location ? location.toteat : {});

      const result = await toteatService.getSales(dateStr);

      if (!result.success) {
        return { success: false, error: result.message };
      }

      const products = toteatService.parseSalesToProducts(result.data);
      const totalSinImpuesto = products.reduce((sum, p) => sum + (p.ventaSinImpuesto || 0), 0);
      const totalConImpuesto = products.reduce((sum, p) => sum + (p.ventaConImpuesto || 0), 0);

      const porCategoria = {};
      products.forEach(p => {
        if (!porCategoria[p.categoria]) {
          porCategoria[p.categoria] = { cantidad: 0, totalSinIva: 0, totalConIva: 0 };
        }
        porCategoria[p.categoria].cantidad += p.cantidad;
        porCategoria[p.categoria].totalSinIva += p.ventaSinImpuesto;
        porCategoria[p.categoria].totalConIva += p.ventaConImpuesto;
      });

      const filePath = await this.generateExcel(dateStr, products, porCategoria, {
        totalSinImpuesto,
        totalConImpuesto,
        ordenes: result.data.length
      });

      // Subir ventas a MarketMan
      const marketmanResult = await marketmanService.uploadSales(dateStr, dateStr, products, {
        totalSinImpuesto,
        totalConImpuesto
      });

      if (marketmanResult.success) {
        logger.info('Ventas subidas a MarketMan correctamente');
      } else {
        logger.warn(`MarketMan upload falló: ${marketmanResult.error}`);
      }

      // Enviar por email
      const emailResult = await emailService.sendSalesReport(filePath, dateStr, {
        productos: products.length,
        ordenes: result.data.length,
        total: totalConImpuesto
      });

      return {
        success: true,
        filePath,
        productos: products.length,
        ordenes: result.data.length,
        total: totalConImpuesto,
        emailSent: emailResult.success
      };
    }

    // Si no se especifica fecha, exportar ayer
    return await this.exportYesterdaySales();
  }
}

module.exports = new SchedulerService();

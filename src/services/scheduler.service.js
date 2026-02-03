const cron = require('node-cron');
const fs = require('fs');
const path = require('path');
const XLSX = require('xlsx');
const toteatService = require('./toteat.service');
const emailService = require('./email.service');
const logger = require('../utils/logger');

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
    // Ejecutar todos los días a las 1:00 PM hora Chile
    // Formato cron: minuto hora día mes díaSemana
    cron.schedule('0 13 * * *', async () => {
      logger.info('=== TAREA PROGRAMADA: Exportación automática de ventas ===');
      await this.exportYesterdaySales();
    }, {
      timezone: 'America/Santiago' // Zona horaria de Chile
    });

    logger.info('Tarea programada configurada: Exportación diaria a las 1:00 PM (Chile)');
  }

  /**
   * Exporta las ventas del día anterior a Excel
   */
  async exportYesterdaySales() {
    try {
      // Calcular fecha de ayer
      const yesterday = new Date();
      yesterday.setDate(yesterday.getDate() - 1);
      const dateStr = yesterday.toISOString().split('T')[0];

      logger.info(`Exportando ventas del ${dateStr}...`);

      // Obtener ventas de Toteat
      const result = await toteatService.getSales(dateStr);

      if (!result.success) {
        logger.error(`Error obteniendo ventas: ${result.message}`);
        return { success: false, error: result.message };
      }

      if (!result.data || result.data.length === 0) {
        logger.warn(`No hay ventas para exportar del ${dateStr}`);
        return { success: false, error: 'No hay ventas para esta fecha' };
      }

      // Parsear ventas a productos
      const products = toteatService.parseSalesToProducts(result.data);

      // Calcular totales
      const totalSinImpuesto = products.reduce((sum, p) => sum + (p.ventaSinImpuesto || 0), 0);
      const totalConImpuesto = products.reduce((sum, p) => sum + (p.ventaConImpuesto || 0), 0);

      // Agrupar por categoría
      const porCategoria = {};
      products.forEach(p => {
        if (!porCategoria[p.categoria]) {
          porCategoria[p.categoria] = { cantidad: 0, totalSinIva: 0, totalConIva: 0 };
        }
        porCategoria[p.categoria].cantidad += p.cantidad;
        porCategoria[p.categoria].totalSinIva += p.ventaSinImpuesto;
        porCategoria[p.categoria].totalConIva += p.ventaConImpuesto;
      });

      // Generar Excel
      const filePath = await this.generateExcel(dateStr, products, porCategoria, {
        totalSinImpuesto,
        totalConImpuesto,
        ordenes: result.data.length
      });

      logger.info(`Excel exportado exitosamente: ${filePath}`);

      // Enviar por email
      const emailResult = await emailService.sendSalesReport(filePath, dateStr, {
        productos: products.length,
        ordenes: result.data.length,
        total: totalConImpuesto
      });

      if (emailResult.success) {
        logger.info(`Email enviado exitosamente`);
      } else {
        logger.warn(`No se pudo enviar email: ${emailResult.error}`);
      }

      return {
        success: true,
        filePath,
        productos: products.length,
        ordenes: result.data.length,
        total: totalConImpuesto,
        emailSent: emailResult.success
      };

    } catch (error) {
      logger.error('Error en exportación automática:', error);
      return { success: false, error: error.message };
    }
  }

  /**
   * Genera el archivo Excel en formato Marketman
   */
  async generateExcel(dateStr, products, porCategoria, totales) {
    // Formatear fecha como DD/MM/YYYY
    const [year, month, day] = dateStr.split('-');
    const formattedDate = `${day}/${month}/${year}`;

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
      ['Location name', 'Domani Providencia'],
      ['Begin date', formattedDate],
      ['End date', formattedDate],
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

    XLSX.utils.book_append_sheet(wb, ws, 'Ventas');

    // Guardar archivo
    const fileName = `ventas_domani_${dateStr}.xlsx`;
    const filePath = path.join(this.exportDir, fileName);

    XLSX.writeFile(wb, filePath);

    return filePath;
  }

  /**
   * Ejecuta la exportación manualmente (para testing)
   */
  async runManualExport(date = null) {
    if (date) {
      // Exportar fecha específica
      const dateStr = date;
      logger.info(`Exportación manual para fecha: ${dateStr}`);

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

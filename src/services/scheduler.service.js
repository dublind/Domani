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
   * Exporta las ventas del día anterior para todos los restaurantes configurados.
   * Es invocada automáticamente por el cron diario a las 8:00 AM (Chile).
   * @returns {{ success: boolean, results: Array }} Resultado por restaurante
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
    for (let i = 0; i < locations.length; i++) {
      const location = locations[i];
      logger.info(`=== Procesando: ${location.name} ===`);
      const result = await this.exportLocationSales(location, dateStr);
      results.push({ location: location.name, ...result });

      // Pausa de 90 segundos entre restaurantes para respetar el rate limit de Toteat (1 req/min)
      if (i < locations.length - 1) {
        logger.info(`Esperando 90 segundos antes del siguiente restaurante...`);
        await new Promise(resolve => setTimeout(resolve, 90000));
      }
    }

    return { success: true, results };
  }

  /**
   * Exporta las ventas de un restaurante específico para una fecha.
   * Intenta el endpoint /sales primero; si no retorna datos, cae a /collection.
   * Genera el Excel, sube a MarketMan (si tiene BuyerGuid) y envía el email.
   * @param {{ name: string, toteat: object, marketman: { buyerGuid: string|null } }} location
   * @param {string} dateStr - Fecha en formato YYYY-MM-DD
   * @returns {{ success: boolean, filePath?: string, productos?: number, ordenes?: number, total?: number, emailSent?: boolean, marketmanUploaded?: boolean, error?: string }}
   */
  async exportLocationSales(location, dateStr) {
    try {
      const toteatService = new ToteatService(location.toteat);

      // Intentar /sales primero; si falla, usar /collection como fallback
      let products = null;
      let ordenesCount = 0;
      const salesResult = await toteatService.getSales(dateStr);

      if (salesResult.success && salesResult.data && salesResult.data.length > 0) {
        logger.info(`[${location.name}] Usando endpoint /sales`);
        products = toteatService.parseSalesToProducts(salesResult.data);
        ordenesCount = salesResult.data.length;
      } else {
        logger.info(`[${location.name}] /sales falló (${salesResult.message}), intentando /collection...`);
        try {
          const collResult = await toteatService.getCollection(dateStr);
          if (collResult.success && collResult.data) {
            logger.info(`[${location.name}] Usando endpoint /collection`);
            products = toteatService.parseCollectionToProducts(collResult.data);
            ordenesCount = products.length;
          }
        } catch (collErr) {
          logger.error(`[${location.name}] /collection también falló: ${collErr.message}`);
          return { success: false, error: salesResult.message || collErr.message };
        }
      }

      let soldProducts = products || [];

      try {
        const menuResult = await toteatService.getProducts();
        if (menuResult.success && menuResult.data) {
          const allProducts = toteatService.parseProducts(menuResult.data);
          const mergedProductsMap = new Map();
          
          allProducts.forEach(p => mergedProductsMap.set(String(p.codigo), { ...p }));
          
          soldProducts.forEach(p => {
            const codigo = String(p.codigo);
            if (mergedProductsMap.has(codigo)) {
              const ep = mergedProductsMap.get(codigo);
              ep.cantidad += p.cantidad;
              ep.ventaSinImpuesto += p.ventaSinImpuesto;
              ep.ventaConImpuesto += p.ventaConImpuesto;
            } else {
              mergedProductsMap.set(codigo, { ...p });
            }
          });
          
          products = Array.from(mergedProductsMap.values());
          logger.info(`[${location.name}] Productos de menu combinados con ventas: total ${products.length} productos`);
        } else {
          logger.warn(`[${location.name}] No se pudo obtener el menu completo, procediendo solo con ventas`);
        }
      } catch (err) {
        logger.error(`[${location.name}] Error al obtener/combinar menu: ${err.message}`);
      }

      // Filtrar a todos en general. Si no hay productos (ni siquiera de menu), error.
      if (!products || products.length === 0) {
        logger.warn(`[${location.name}] No hay ventas ni productos para el ${dateStr}`);
        return { success: false, error: 'No hay ventas ni productos para esta fecha' };
      }
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
        ordenes: ordenesCount
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
        ordenes: ordenesCount,
        total: totalConImpuesto
      });

      return {
        success: true,
        filePath,
        productos: products.length,
        ordenes: ordenesCount,
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
   * Genera el archivo Excel en formato MarketMan para un restaurante y período.
   * Agrupa productos por nombre, suma cantidades y totales, y ordena por cantidad descendente.
   * El archivo se guarda en /data/exports/ con el nombre ventas_<restaurante>_<fecha>.xlsx
   * @param {string} startDate - Fecha inicio (YYYY-MM-DD)
   * @param {Array} products - Array de productos parseados desde Toteat
   * @param {Object} porCategoria - Totales agrupados por categoría
   * @param {{ totalSinImpuesto: number, totalConImpuesto: number }} totales - Totales generales
   * @param {string|null} endDate - Fecha fin (YYYY-MM-DD), null si es un solo día
   * @param {string} locationName - Nombre del restaurante (se usa en el Excel y en el nombre del archivo)
   * @returns {string} Ruta absoluta del archivo generado
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
    const safeName = locationName.replace(/[^a-zA-Z0-9]/g, '_').toLowerCase();
    const fileName = endDate && endDate !== startDate
      ? `ventas_${safeName}_${startDate}_a_${endDate}.xlsx`
      : `ventas_${safeName}_${startDate}.xlsx`;
    const filePath = path.join(this.exportDir, fileName);

    XLSX.writeFile(wb, filePath);

    return filePath;
  }

  /**
   * Exporta ventas de un rango de fechas a Excel para un restaurante específico.
   * Usado desde el endpoint GET /api/export/download-range?start=&end=&loc=
   * @param {string} startDate - Fecha inicio (YYYY-MM-DD)
   * @param {string} endDate - Fecha fin (YYYY-MM-DD)
   * @param {string|number} locIndex - Índice del restaurante (1-based, por orden en el .env). Default: 1
   * @returns {{ success: boolean, filePath?: string, productos?: number, ordenes?: number, total?: number, error?: string }}
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

    let soldProducts = toteatService.parseSalesToProducts(result.data);
    
    let products = soldProducts;
    try {
      const menuResult = await toteatService.getProducts();
      if (menuResult.success && menuResult.data) {
        const allProducts = toteatService.parseProducts(menuResult.data);
        const mergedProductsMap = new Map();
        
        allProducts.forEach(p => mergedProductsMap.set(String(p.codigo), { ...p }));
        
        soldProducts.forEach(p => {
          const codigo = String(p.codigo);
          if (mergedProductsMap.has(codigo)) {
            const ep = mergedProductsMap.get(codigo);
            ep.cantidad += p.cantidad;
            ep.ventaSinImpuesto += p.ventaSinImpuesto;
            ep.ventaConImpuesto += p.ventaConImpuesto;
          } else {
            mergedProductsMap.set(codigo, { ...p });
          }
        });
        
        products = Array.from(mergedProductsMap.values());
      }
    } catch (err) {
      logger.error(`Error combinando menu en rango: ${err.message}`);
    }
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
   * Ejecuta la exportación manual para todos los restaurantes en una fecha específica.
   * Llamado desde los endpoints /api/export, /api/export/trigger y /api/export/download.
   * Si no se pasa fecha, exporta el día de ayer.
   * @param {string|null} date - Fecha en formato YYYY-MM-DD, o null para exportar ayer
   * @returns {{ success: boolean, results: Array }}
   */
  async runManualExport(date = null) {
    const yesterday = new Date();
    yesterday.setDate(yesterday.getDate() - 1);
    const dateStr = date || yesterday.toISOString().split('T')[0];

    logger.info(`Exportación manual para fecha: ${dateStr}`);

    const locations = getLocations();
    if (locations.length === 0) {
      return { success: false, error: 'No hay restaurantes configurados' };
    }

    const results = [];
    for (let i = 0; i < locations.length; i++) {
      const location = locations[i];
      logger.info(`=== Procesando: ${location.name} ===`);
      const result = await this.exportLocationSales(location, dateStr);
      results.push({ location: location.name, ...result });

      // Pausa de 90 segundos entre restaurantes para respetar el rate limit de Toteat (1 req/min)
      if (i < locations.length - 1) {
        logger.info(`Esperando 90 segundos antes del siguiente restaurante...`);
        await new Promise(resolve => setTimeout(resolve, 90000));
      }
    }

    return { success: true, results };
  }
}

module.exports = new SchedulerService();

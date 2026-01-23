const express = require('express');
const cron = require('node-cron');
const fs = require('fs');
const path = require('path');
const multer = require('multer');
const config = require('./config/config');
const logger = require('./utils/logger');
const syncService = require('./services/sync.service');
const toteatService = require('./services/toteat.service');
const collectionParser = require('./services/collection-parser.service');

// Configurar multer para subida de archivos
const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    const uploadDir = path.join(__dirname, '..', 'data', 'uploads');
    if (!fs.existsSync(uploadDir)) {
      fs.mkdirSync(uploadDir, { recursive: true });
    }
    cb(null, uploadDir);
  },
  filename: (req, file, cb) => {
    cb(null, `upload-${Date.now()}.csv`);
  }
});
const upload = multer({ storage });

// Crear directorio de logs si no existe
const logsDir = path.join(__dirname, '..', 'logs');
if (!fs.existsSync(logsDir)) {
  fs.mkdirSync(logsDir);
}

// Crear aplicación Express
const app = express();
app.use(express.json());

// Health check endpoint
app.get('/health', (req, res) => {
  res.json({
    status: 'ok',
    service: 'Toteat API Sync',
    timestamp: new Date().toISOString()
  });
});

// Status endpoint
app.get('/api/status', (req, res) => {
  const status = syncService.getStatus();
  res.json(status);
});

// Test connections endpoint
app.get('/api/test-connections', async (req, res) => {
  try {
    const result = await syncService.testConnections();
    res.json(result);
  } catch (error) {
    logger.error('Error en test de conexión:', error);
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

// Manual sync endpoint - obtener datos de Toteat
app.post('/api/sync', async (req, res) => {
  try {
    logger.info('Obteniendo datos de collection de Toteat');
    const { date } = req.body;
    const syncDate = date ? new Date(date) : null;
    
    const result = await syncService.getDailySalesFromToteat(syncDate);
    res.json(result);
  } catch (error) {
    logger.error('Error obteniendo datos:', error);
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

// Get Toteat sales collection
app.get('/api/toteat/sales', async (req, res) => {
  try {
    const { date } = req.query;
    const salesDate = date ? new Date(date) : null;
    
    const result = await syncService.getDailySalesFromToteat(salesDate);
    res.json(result);
  } catch (error) {
    logger.error('Error obteniendo collection:', error);
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

// Página HTML para subir CSV de ventas Toteat
app.get('/upload', (req, res) => {
  res.send(`
    <!DOCTYPE html>
    <html lang="es">
    <head>
      <meta charset="UTF-8">
      <meta name="viewport" content="width=device-width, initial-scale=1.0">
      <title>Procesar CSV Ventas - Toteat</title>
      <style>
        body { font-family: Arial, sans-serif; max-width: 1200px; margin: 30px auto; padding: 20px; background: #f0f0f0; }
        h1 { color: #2e7d32; }
        .upload-form { background: white; padding: 30px; border-radius: 10px; margin: 20px 0; box-shadow: 0 2px 5px rgba(0,0,0,0.1); }
        .form-group { margin: 15px 0; }
        label { display: block; margin-bottom: 5px; font-weight: bold; }
        input[type="text"], input[type="date"] { padding: 10px; width: 250px; border: 1px solid #ddd; border-radius: 5px; }
        input[type="file"] { margin: 15px 0; padding: 10px; }
        button { background: #4CAF50; color: white; padding: 12px 30px; border: none; border-radius: 5px; cursor: pointer; font-size: 16px; margin-right: 10px; }
        button:hover { background: #45a049; }
        .btn-download { background: #2196F3; }
        .btn-download:hover { background: #1976D2; }
        #result { margin-top: 20px; padding: 20px; background: white; border-radius: 10px; display: none; box-shadow: 0 2px 5px rgba(0,0,0,0.1); }
        table { width: 100%; border-collapse: collapse; margin: 15px 0; font-size: 14px; }
        th, td { border: 1px solid #ddd; padding: 8px; text-align: left; }
        th { background: #4CAF50; color: white; }
        tr:nth-child(even) { background: #f9f9f9; }
        .header-info { background: #e8f5e9; padding: 15px; border-radius: 5px; margin-bottom: 20px; }
        .header-info p { margin: 5px 0; }
        .total-row { font-weight: bold; background: #c8e6c9 !important; }
        .error { color: red; }
        .loading { color: #666; font-style: italic; }
        .info-box { background: #fff3e0; padding: 15px; border-radius: 5px; margin: 15px 0; border-left: 4px solid #ff9800; }
      </style>
    </head>
    <body>
      <h1>Procesar CSV de Ventas Toteat</h1>

      <div class="upload-form">
        <div class="info-box">
          <strong>Formato esperado:</strong> CSV con columnas ID, Producto, Cantidad, Valor Venta, Descuentos, Costo
        </div>

        <div class="form-group">
          <label>Nombre del Local:</label>
          <input type="text" id="locationName" value="Domani Providencia" placeholder="Ej: Domani Granaderos">
        </div>

        <div class="form-group">
          <label>Fecha del Reporte:</label>
          <input type="date" id="reportDate" value="${new Date().toISOString().split('T')[0]}">
        </div>

        <div class="form-group">
          <label>Archivo CSV:</label>
          <input type="file" id="csvFile" accept=".csv">
        </div>

        <button onclick="uploadCSV()">Procesar CSV</button>
        <button class="btn-download" onclick="downloadExcel()" id="btnDownload" style="display:none;">Descargar Excel</button>
      </div>

      <div id="result"></div>

      <script>
        let lastResult = null;

        async function uploadCSV() {
          const fileInput = document.getElementById('csvFile');
          const resultDiv = document.getElementById('result');
          const locationName = document.getElementById('locationName').value || 'Sin nombre';
          const reportDate = document.getElementById('reportDate').value || new Date().toISOString().split('T')[0];

          if (!fileInput.files[0]) {
            alert('Selecciona un archivo CSV');
            return;
          }

          resultDiv.style.display = 'block';
          resultDiv.innerHTML = '<p class="loading">Procesando...</p>';

          const formData = new FormData();
          formData.append('csv', fileInput.files[0]);
          formData.append('locationName', locationName);
          formData.append('reportDate', reportDate);

          try {
            const response = await fetch('/api/process-sales-csv', {
              method: 'POST',
              body: formData
            });
            const data = await response.json();

            if (data.success) {
              lastResult = data;
              document.getElementById('btnDownload').style.display = 'inline-block';

              let html = '<div class="header-info">';
              html += '<p><strong>Location name:</strong> ' + data.header.locationName + '</p>';
              html += '<p><strong>Begin date:</strong> ' + data.header.beginDate + '</p>';
              html += '<p><strong>End date:</strong> ' + data.header.endDate + '</p>';
              html += '<p><strong>Total revenue excl. tax:</strong> $' + data.header.totalRevenueExclTax.toLocaleString() + '</p>';
              html += '<p><strong>Ingresos totales inc. impuesto:</strong> $' + data.header.totalRevenueInclTax.toLocaleString() + '</p>';
              html += '</div>';

              html += '<table>';
              html += '<tr><th>ELEMENTO DE MENÚ</th><th>Menu item code</th><th>Menu item list price</th><th>Quantity sold</th><th>Sales total excl. tax</th><th>Ventas totales inc. impuesto</th><th>Categoría</th></tr>';

              data.items.forEach(item => {
                html += '<tr>';
                html += '<td>' + item.producto + '</td>';
                html += '<td>' + item.codigo + '</td>';
                html += '<td>$' + item.precioUnitario.toLocaleString() + '</td>';
                html += '<td>' + item.cantidad + '</td>';
                html += '<td>$' + item.ventaSinImpuesto.toLocaleString() + '</td>';
                html += '<td>$' + item.ventaConImpuesto.toLocaleString() + '</td>';
                html += '<td>' + item.categoria + '</td>';
                html += '</tr>';
              });

              html += '</table>';
              html += '<p><strong>Total productos:</strong> ' + data.items.length + '</p>';

              resultDiv.innerHTML = html;
            } else {
              resultDiv.innerHTML = '<p class="error">Error: ' + data.error + '</p>';
            }
          } catch (error) {
            resultDiv.innerHTML = '<p class="error">Error: ' + error.message + '</p>';
          }
        }

        function downloadExcel() {
          if (!lastResult) return;

          // Crear CSV para Excel
          let csv = 'Location name,' + lastResult.header.locationName + '\\n';
          csv += 'Begin date,' + lastResult.header.beginDate + '\\n';
          csv += 'End date,' + lastResult.header.endDate + '\\n';
          csv += 'Total revenue excl. tax,' + lastResult.header.totalRevenueExclTax + '\\n';
          csv += 'Ingresos totales inc. impuesto,' + lastResult.header.totalRevenueInclTax + '\\n';
          csv += '\\n';
          csv += 'ELEMENTO DE MENÚ,Menu item code,Menu item list price,Quantity sold,Sales total excl. tax,Ventas totales inc. impuesto,Categoría\\n';

          lastResult.items.forEach(item => {
            csv += '"' + item.producto + '",' + item.codigo + ',' + item.precioUnitario + ',' + item.cantidad + ',' + item.ventaSinImpuesto + ',' + item.ventaConImpuesto + ',"' + item.categoria + '"\\n';
          });

          // Descargar
          const blob = new Blob(['\\ufeff' + csv], { type: 'text/csv;charset=utf-8;' });
          const link = document.createElement('a');
          link.href = URL.createObjectURL(blob);
          link.download = 'resumen_ventas_' + lastResult.header.beginDate + '.csv';
          link.click();
        }
      </script>
    </body>
    </html>
  `);
});

// Endpoint para procesar CSV de ventas Toteat (formato: ID, Producto, Cantidad, Valor Venta, Descuentos, Costo)
app.post('/api/process-sales-csv', upload.single('csv'), async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ success: false, error: 'No se recibió archivo' });
    }

    const locationName = req.body.locationName || 'Sin nombre';
    const reportDate = req.body.reportDate || new Date().toISOString().split('T')[0];

    logger.info(`Procesando CSV de ventas: ${req.file.filename}`);

    // Leer y parsear el CSV
    let csvContent = fs.readFileSync(req.file.path, 'utf8');
    // Remover BOM si existe
    csvContent = csvContent.replace(/^\uFEFF/, '');

    const lines = csvContent.split('\n').filter(line => line.trim());

    if (lines.length < 2) {
      return res.status(400).json({ success: false, error: 'El CSV está vacío o no tiene datos' });
    }

    // Parsear encabezados
    const headers = lines[0].split(',').map(h => h.trim().replace(/"/g, '').toLowerCase());

    // Detectar columnas
    const idIdx = headers.findIndex(h => h === 'id' || h.includes('codigo') || h.includes('code'));
    const productoIdx = headers.findIndex(h => h.includes('producto') || h.includes('product') || h.includes('nombre'));
    const cantidadIdx = headers.findIndex(h => h.includes('cantidad') || h.includes('quantity') || h.includes('qty'));
    const valorVentaIdx = headers.findIndex(h => h.includes('valor venta') || h.includes('venta') || h.includes('sales') || h.includes('total'));
    const descuentosIdx = headers.findIndex(h => h.includes('descuento') || h.includes('discount'));
    const costoIdx = headers.findIndex(h => h.includes('costo') || h.includes('cost'));

    const items = [];
    let totalSinImpuesto = 0;
    let totalConImpuesto = 0;

    // Procesar cada línea
    for (let i = 1; i < lines.length; i++) {
      // Parsear considerando comas dentro de comillas
      const values = [];
      let current = '';
      let inQuotes = false;

      for (const char of lines[i]) {
        if (char === '"') {
          inQuotes = !inQuotes;
        } else if (char === ',' && !inQuotes) {
          values.push(current.trim());
          current = '';
        } else {
          current += char;
        }
      }
      values.push(current.trim());

      if (values.length < 4) continue;

      const id = values[idIdx] || '';
      const producto = values[productoIdx]?.replace(/"/g, '') || '';
      const cantidad = parseInt(values[cantidadIdx]?.replace(/[^0-9-]/g, '') || '0');
      const valorVenta = parseFloat(values[valorVentaIdx]?.replace(/[^0-9.-]/g, '').replace(',', '.') || '0');
      const descuentos = parseFloat(values[descuentosIdx]?.replace(/[^0-9.-]/g, '').replace(',', '.') || '0');
      const costo = parseFloat(values[costoIdx]?.replace(/[^0-9.-]/g, '').replace(',', '.') || '0');

      // Calcular precio unitario (valor venta / cantidad)
      const precioUnitario = cantidad > 0 ? Math.round(valorVenta / cantidad) : 0;

      // Calcular venta con impuesto (19% IVA Chile)
      const ventaConImpuesto = Math.round(valorVenta * 1.19);

      // Inferir categoría basada en el nombre del producto
      let categoria = 'General';
      const nombreLower = producto.toLowerCase();
      if (nombreLower.includes('pizza') || nombreLower.includes('margherita') || nombreLower.includes('pepperoni') || nombreLower.includes('caprichosisima') || nombreLower.includes('tartufo') || nombreLower.includes('marinara') || nombreLower.includes('putanesca') || nombreLower.includes('fonduta') || nombreLower.includes('brisket') || nombreLower.includes('gambere') || nombreLower.includes('rucula') || nombreLower.includes('rúcula')) {
        categoria = 'Pizzas';
      } else if (nombreLower.includes('birra') || nombreLower.includes('cerveza') || nombreLower.includes('schop') || nombreLower.includes('stella') || nombreLower.includes('peroni') || nombreLower.includes('leyenda') || nombreLower.includes('estrella')) {
        categoria = 'Cervezas';
      } else if (nombreLower.includes('coca') || nombreLower.includes('fanta') || nombreLower.includes('ginger') || nombreLower.includes('tonica') || nombreLower.includes('gaseosa') || nombreLower.includes('agua') || nombreLower.includes('vital')) {
        categoria = 'Bebidas';
      } else if (nombreLower.includes('spritz') || nombreLower.includes('negroni') || nombreLower.includes('aperol') || nombreLower.includes('campari') || nombreLower.includes('sangria') || nombreLower.includes('sangría') || nombreLower.includes('frozen') || nombreLower.includes('gin') || nombreLower.includes('pisco') || nombreLower.includes('fernet') || nombreLower.includes('jack') || nombreLower.includes('disaronno') || nombreLower.includes('limoncello') || nombreLower.includes('chambord') || nombreLower.includes('mocktail')) {
        categoria = 'Cócteles';
      } else if (nombreLower.includes('jugo') || nombreLower.includes('limonada')) {
        categoria = 'Jugos';
      } else if (nombreLower.includes('insalata') || nombreLower.includes('ensalada')) {
        categoria = 'Ensaladas';
      } else if (nombreLower.includes('gnocchi') || nombreLower.includes('ñoquis') || nombreLower.includes('ñoqui')) {
        categoria = 'Pastas';
      } else if (nombreLower.includes('gelato') || nombreLower.includes('tiramisú') || nombreLower.includes('tiramisu') || nombreLower.includes('affogato')) {
        categoria = 'Postres';
      } else if (nombreLower.includes('espresso') || nombreLower.includes('americano') || nombreLower.includes('capuccino') || nombreLower.includes('cafe') || nombreLower.includes('café') || nombreLower.includes('te ') || nombreLower.includes('infusion')) {
        categoria = 'Cafetería';
      } else if (nombreLower.includes('panetti') || nombreLower.includes('panecillo') || nombreLower.includes('tavola') || nombreLower.includes('provolone') || nombreLower.includes('burrata') || nombreLower.includes('carpaccio') || nombreLower.includes('croccantina')) {
        categoria = 'Entradas';
      } else if (nombreLower.includes('extra') || nombreLower.includes('aderezo') || nombreLower.includes('dip') || nombreLower.includes('agr.')) {
        categoria = 'Extras';
      } else if (nombreLower.includes('colacion')) {
        categoria = 'Colaciones';
      } else if (nombreLower.includes('combo') || nombreLower.includes('felice') || nombreLower.includes('promo')) {
        categoria = 'Promociones';
      }

      totalSinImpuesto += valorVenta;
      totalConImpuesto += ventaConImpuesto;

      items.push({
        producto,
        codigo: id,
        precioUnitario,
        cantidad,
        ventaSinImpuesto: valorVenta,
        ventaConImpuesto,
        categoria
      });
    }

    // Eliminar archivo temporal
    fs.unlinkSync(req.file.path);

    res.json({
      success: true,
      header: {
        locationName,
        beginDate: reportDate,
        endDate: reportDate,
        totalRevenueExclTax: Math.round(totalSinImpuesto),
        totalRevenueInclTax: Math.round(totalConImpuesto)
      },
      items
    });

  } catch (error) {
    logger.error('Error procesando CSV de ventas:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

// Endpoint para subir y procesar CSV
app.post('/api/upload-csv', upload.single('csv'), async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ success: false, error: 'No se recibió archivo' });
    }

    logger.info(`Procesando CSV: ${req.file.filename}`);

    // Leer y parsear el CSV
    const csvContent = fs.readFileSync(req.file.path, 'utf8');
    const lines = csvContent.split('\n').filter(line => line.trim());

    if (lines.length < 2) {
      return res.status(400).json({ success: false, error: 'El CSV está vacío o no tiene datos' });
    }

    // Parsear encabezados y datos
    const headers = lines[0].split(',').map(h => h.trim().replace(/"/g, '').toLowerCase());
    const records = [];

    for (let i = 1; i < lines.length; i++) {
      const values = lines[i].split(',').map(v => v.trim().replace(/"/g, ''));
      const record = {};
      headers.forEach((header, index) => {
        record[header] = values[index] || '';
      });
      records.push(record);
    }

    // Calcular resumen
    const summary = {
      totalRecords: records.length,
      grandTotal: 0,
      byPaymentMethod: {},
      byShift: {},
      byCaja: {}
    };

    // Buscar columnas (flexible)
    const montoKey = headers.find(h => h.includes('monto') || h.includes('amount') || h.includes('total'));
    const metodoKey = headers.find(h => h.includes('método') || h.includes('metodo') || h.includes('pago') || h.includes('payment'));
    const turnoKey = headers.find(h => h.includes('turno') || h.includes('shift'));
    const cajaKey = headers.find(h => h.includes('caja') || h.includes('register'));

    records.forEach(record => {
      const monto = parseFloat(record[montoKey]?.replace(/[^0-9.-]/g, '') || 0);
      const metodo = record[metodoKey] || 'Sin especificar';
      const turno = record[turnoKey] || 'Sin turno';
      const caja = record[cajaKey] || 'Sin caja';

      summary.grandTotal += monto;

      if (!summary.byPaymentMethod[metodo]) summary.byPaymentMethod[metodo] = 0;
      summary.byPaymentMethod[metodo] += monto;

      if (!summary.byShift[turno]) summary.byShift[turno] = 0;
      summary.byShift[turno] += monto;

      if (!summary.byCaja[caja]) summary.byCaja[caja] = 0;
      summary.byCaja[caja] += monto;
    });

    // Formatear resultado
    const result = {
      success: true,
      summary: {
        totalRecords: summary.totalRecords,
        grandTotal: summary.grandTotal,
        byPaymentMethod: Object.entries(summary.byPaymentMethod).map(([method, total]) => ({
          method,
          total,
          percentage: ((total / summary.grandTotal) * 100).toFixed(2) + '%'
        })).sort((a, b) => b.total - a.total),
        byShift: Object.entries(summary.byShift).map(([shift, total]) => ({
          shift,
          total
        })),
        byCaja: Object.entries(summary.byCaja).map(([caja, total]) => ({
          caja,
          total
        }))
      }
    };

    // Eliminar archivo temporal
    fs.unlinkSync(req.file.path);

    res.json(result);

  } catch (error) {
    logger.error('Error procesando CSV:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

// Export to CSV
app.get('/api/toteat/sales/csv', async (req, res) => {
  try {
    const { date } = req.query;
    const salesDate = date ? new Date(date) : null;
    const dateStr = date || new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString().split('T')[0];

    logger.info(`Exportando collection a CSV para ${dateStr}`);
    
    const collectionData = await toteatService.getDailySalesReport(salesDate);
    const parsedCollection = collectionParser.parseCollection(collectionData, dateStr);
    const csvString = collectionParser.exportToCSV(parsedCollection);

    // Configurar headers para descarga
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="collection-${dateStr}.csv"`);
    res.send('\uFEFF' + csvString); // BOM para Excel

  } catch (error) {
    logger.error('Error exportando a CSV:', error);
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

// Configurar tarea programada (cron job) - Obtener datos de Toteat diariamente
const scheduledTask = cron.schedule(config.cron.schedule, async () => {
  try {
    logger.info('Ejecutando obtención de datos programada');
    await syncService.getDailySalesFromToteat();
    logger.info('Obtención de datos completada');
  } catch (error) {
    logger.error('Error en obtención de datos programada:', error);
  }
}, {
  scheduled: true,
  timezone: "America/Mexico_City"
});

// Iniciar servidor
const PORT = config.server.port;

app.listen(PORT, async () => {
  logger.info(`Servidor iniciado en puerto ${PORT}`);
  logger.info(`Ambiente: ${config.server.env}`);
  logger.info(`Cron schedule: ${config.cron.schedule}`);

  // Probar conexiones al iniciar
  logger.info('Iniciando prueba de conexiones');
  try {
    const connections = await syncService.testConnections();
    if (connections.services?.toteat?.mode === 'local') {
      logger.info('📁 Modo LOCAL activado - usando archivo de datos');
      logger.info('Para usar la API real, cambia TOTEAT_USE_LOCAL_FILE=false en .env');
    } else if (connections.success) {
      logger.info('✅ Conexión con Toteat exitosa');
    } else {
      logger.warn('⚠️  Conexión con Toteat falló. Revisa las credenciales.');
    }
  } catch (error) {
    logger.warn('⚠️  No se pudo probar la conexión al iniciar:', error.message);
  }

  logger.info('Servicio de extracción de datos Toteat listo');
});

// Manejo de errores no capturados
process.on('unhandledRejection', (reason, promise) => {
  logger.error('Unhandled Rejection:', { reason, promise });
});

process.on('uncaughtException', (error) => {
  logger.error('Uncaught Exception:', error);
  process.exit(1);
});

// Manejo de señales de terminación
process.on('SIGTERM', () => {
  logger.info('SIGTERM recibido. Cerrando aplicación...');
  scheduledTask.stop();
  process.exit(0);
});

process.on('SIGINT', () => {
  logger.info('SIGINT recibido. Cerrando aplicación...');
  scheduledTask.stop();
  process.exit(0);
});

module.exports = app;

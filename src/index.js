const express = require('express');
const fs = require('fs');
const path = require('path');
const config = require('./config/config');
const logger = require('./utils/logger');
const toteatService = require('./services/toteat.service');
const schedulerService = require('./services/scheduler.service');
const emailService = require('./services/email.service');

// Crear directorio de logs si no existe
const logsDir = path.join(__dirname, '..', 'logs');
if (!fs.existsSync(logsDir)) {
  fs.mkdirSync(logsDir);
}

// Crear aplicacion Express
const app = express();
app.use(express.json());

// Ruta principal - redirige al panel
app.get('/', (req, res) => {
  res.redirect('/panel');
});

// Health check endpoint
app.get('/health', (req, res) => {
  res.json({
    status: 'ok',
    service: 'Domani Ventas API',
    timestamp: new Date().toISOString()
  });
});

// Panel principal - solo API Toteat
app.get('/panel', (req, res) => {
  res.send(`
    <!DOCTYPE html>
    <html lang="es">
    <head>
      <meta charset="UTF-8">
      <meta name="viewport" content="width=device-width, initial-scale=1.0">
      <title>Ventas Toteat - Domani</title>
      <style>
        body { font-family: Arial, sans-serif; max-width: 1200px; margin: 30px auto; padding: 20px; background: #f0f0f0; }
        h1 { color: #2e7d32; }
        h2 { color: #1976D2; margin-top: 0; }
        .section { background: white; padding: 25px; border-radius: 10px; margin: 20px 0; box-shadow: 0 2px 5px rgba(0,0,0,0.1); }
        .form-group { margin: 15px 0; }
        label { display: block; margin-bottom: 5px; font-weight: bold; }
        input[type="date"] { padding: 10px; width: 250px; border: 1px solid #ddd; border-radius: 5px; }
        button { padding: 12px 30px; border: none; border-radius: 5px; cursor: pointer; font-size: 16px; margin-right: 10px; margin-top: 10px; }
        .btn-primary { background: #4CAF50; color: white; }
        .btn-primary:hover { background: #45a049; }
        .btn-api { background: #FF5722; color: white; }
        .btn-api:hover { background: #E64A19; }
        .btn-download { background: #2196F3; color: white; }
        .btn-download:hover { background: #1976D2; }
        #result { margin-top: 20px; padding: 20px; background: white; border-radius: 10px; display: none; box-shadow: 0 2px 5px rgba(0,0,0,0.1); }
        table { width: 100%; border-collapse: collapse; margin: 15px 0; font-size: 14px; }
        th, td { border: 1px solid #ddd; padding: 8px; text-align: left; }
        th { background: #4CAF50; color: white; }
        tr:nth-child(even) { background: #f9f9f9; }
        .header-info { background: #e8f5e9; padding: 15px; border-radius: 5px; margin-bottom: 20px; }
        .header-info p { margin: 5px 0; }
        .error { color: red; }
        .loading { color: #666; font-style: italic; }
        .info-box { background: #ffebee; padding: 15px; border-radius: 5px; margin: 15px 0; border-left: 4px solid #f44336; }
      </style>
    </head>
    <body>
      <h1>Ventas Toteat - Domani</h1>

      <div class="section">
        <h2>Obtener Ventas desde API Toteat</h2>
        <div class="info-box">
          <strong>Nota:</strong> La API de Toteat tiene limite de 1 solicitud por minuto. Los datos vienen agrupados por turnos.
        </div>

        <div class="form-group">
          <label>Fecha a consultar:</label>
          <input type="date" id="apiDate" value="${new Date().toISOString().split('T')[0]}">
        </div>

        <button class="btn-api" onclick="fetchFromAPI()">Obtener Ventas</button>
        <button class="btn-primary" onclick="testAPI()">Probar Conexion</button>
        <button class="btn-download" onclick="downloadExcel()" id="btnDownload" style="display:none;">Descargar Excel</button>
      </div>

      <div id="result"></div>

      <script>
        let lastDate = null;

        async function testAPI() {
          const resultDiv = document.getElementById('result');
          resultDiv.style.display = 'block';
          resultDiv.innerHTML = '<p class="loading">Probando conexion con Toteat...</p>';

          try {
            const response = await fetch('/api/toteat/test');
            const data = await response.json();
            if (data.connected) {
              resultDiv.innerHTML = '<p style="color:green;font-weight:bold;">Conexion exitosa con API Toteat</p>';
            } else {
              resultDiv.innerHTML = '<p class="error">Error: ' + (data.error || 'No se pudo conectar') + '</p>';
            }
          } catch (error) {
            resultDiv.innerHTML = '<p class="error">Error: ' + error.message + '</p>';
          }
        }

        async function fetchFromAPI() {
          const resultDiv = document.getElementById('result');
          const apiDate = document.getElementById('apiDate').value;
          lastDate = apiDate;

          resultDiv.style.display = 'block';
          resultDiv.innerHTML = '<p class="loading">Obteniendo datos de Toteat... (puede tardar unos segundos)</p>';

          try {
            const response = await fetch('/api/toteat/ventas?date=' + apiDate);
            const data = await response.json();
            displayResult(data);
          } catch (error) {
            resultDiv.innerHTML = '<p class="error">Error: ' + error.message + '</p>';
          }
        }

        function displayResult(data) {
          const resultDiv = document.getElementById('result');
          if (data.success) {
            document.getElementById('btnDownload').style.display = 'inline-block';

            let html = '<div class="header-info">';
            html += '<p><strong>Location name:</strong> ' + data.header.locationName + '</p>';
            html += '<p><strong>Fecha:</strong> ' + data.header.beginDate + '</p>';
            html += '<p><strong>Total sin impuesto:</strong> $' + data.header.totalRevenueExclTax.toLocaleString() + '</p>';
            html += '<p><strong>Total con impuesto:</strong> $' + data.header.totalRevenueInclTax.toLocaleString() + '</p>';
            html += '</div>';

            if (data.items && data.items.length > 0) {
              html += '<table>';
              html += '<tr><th>Producto</th><th>Codigo</th><th>Precio Unit.</th><th>Cantidad</th><th>Venta sin IVA</th><th>Venta con IVA</th><th>Categoria</th></tr>';
              data.items.forEach(item => {
                html += '<tr>';
                html += '<td>' + item.producto + '</td>';
                html += '<td>' + item.codigo + '</td>';
                html += '<td>$' + (item.precioUnitario || 0).toLocaleString() + '</td>';
                html += '<td>' + item.cantidad + '</td>';
                html += '<td>$' + (item.ventaSinImpuesto || 0).toLocaleString() + '</td>';
                html += '<td>$' + (item.ventaConImpuesto || 0).toLocaleString() + '</td>';
                html += '<td>' + item.categoria + '</td>';
                html += '</tr>';
              });
              html += '</table>';
              html += '<p><strong>Total productos:</strong> ' + data.items.length + '</p>';
            } else {
              html += '<p>No se encontraron items detallados para esta fecha.</p>';
            }

            resultDiv.innerHTML = html;
          } else {
            resultDiv.innerHTML = '<p class="error">Error: ' + data.error + '</p>';
          }
        }

        async function downloadExcel() {
          if (!lastDate) return;
          try {
            const response = await fetch('/api/export/download?date=' + lastDate);
            if (!response.ok) throw new Error('Error generando Excel');
            const blob = await response.blob();
            const link = document.createElement('a');
            link.href = URL.createObjectURL(blob);
            link.download = 'ventas_domani_' + lastDate + '.xlsx';
            link.click();
          } catch (error) {
            alert('Error descargando Excel: ' + error.message);
          }
        }
      </script>
    </body>
    </html>
  `);
});

// Endpoint para obtener ventas desde API Toteat (usa /sales con ini/end)
app.get('/api/toteat/ventas', async (req, res) => {
  try {
    const { date } = req.query;
    const targetDate = date || new Date().toISOString().split('T')[0];

    logger.info(`Obteniendo ventas de Toteat para: ${targetDate}`);

    const result = await toteatService.getSales(targetDate);

    if (!result.success) {
      return res.status(400).json({ success: false, error: result.message });
    }

    // Parsear ventas a productos
    const items = toteatService.parseSalesToProducts(result.data);

    // Calcular totales
    const totalSinImpuesto = items.reduce((sum, p) => sum + (p.ventaSinImpuesto || 0), 0);
    const totalConImpuesto = items.reduce((sum, p) => sum + (p.ventaConImpuesto || 0), 0);

    // Agrupar por categoría para resumen
    const porCategoria = {};
    items.forEach(p => {
      if (!porCategoria[p.categoria]) {
        porCategoria[p.categoria] = { cantidad: 0, total: 0 };
      }
      porCategoria[p.categoria].cantidad += p.cantidad;
      porCategoria[p.categoria].total += p.ventaConImpuesto;
    });

    const resumen = Object.entries(porCategoria)
      .map(([categoria, data]) => ({ categoria, ...data }))
      .sort((a, b) => b.total - a.total);

    const hasData = items.length > 0;

    res.json({
      success: true,
      header: {
        locationName: 'Domani (API Toteat)',
        beginDate: targetDate,
        endDate: targetDate,
        totalRevenueExclTax: totalSinImpuesto,
        totalRevenueInclTax: totalConImpuesto
      },
      resumen,
      items,
      hasData,
      mensaje: hasData
        ? `Total: $${totalConImpuesto.toLocaleString('es-CL')} (${items.length} productos en ${result.data.length} órdenes)`
        : 'No se encontraron ventas para esta fecha.'
    });

  } catch (error) {
    logger.error('Error obteniendo ventas de Toteat:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

// Test conexion Toteat
app.get('/api/toteat/test', async (req, res) => {
  try {
    const result = await toteatService.testConnection();
    res.json(result);
  } catch (error) {
    res.status(500).json({ connected: false, error: error.message });
  }
});

// Endpoint para ver estructura raw de Toteat (DIAGNOSTICO)
app.get('/api/toteat/raw', async (req, res) => {
  try {
    const { date } = req.query;
    const targetDate = date || new Date().toISOString().split('T')[0];

    const result = await toteatService.getCollection(targetDate);

    if (!result.success) {
      return res.status(400).json({ success: false, error: result.message });
    }

    // Devolver datos raw sin procesar para diagnostico
    res.json({
      success: true,
      rawData: result.data,
      date: targetDate
    });

  } catch (error) {
    logger.error('Error en endpoint raw:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

// Endpoint de diagnostico - prueba todos los endpoints de Toteat
app.get('/api/toteat/diagnose', async (req, res) => {
  try {
    const { date } = req.query;
    const targetDate = date || new Date().toISOString().split('T')[0];

    logger.info(`Ejecutando diagnostico de endpoints Toteat para: ${targetDate}`);

    const results = await toteatService.diagnoseEndpoints(targetDate);

    res.json({
      success: true,
      date: targetDate,
      endpoints: results
    });

  } catch (error) {
    logger.error('Error en diagnostico:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

// Endpoint para obtener ventas detalladas por producto
app.get('/api/toteat/sales', async (req, res) => {
  try {
    const { date } = req.query;
    const targetDate = date || new Date().toISOString().split('T')[0];

    logger.info(`Obteniendo ventas de Toteat para: ${targetDate}`);

    const result = await toteatService.getSales(targetDate);

    if (!result.success) {
      return res.json({
        success: false,
        error: result.message
      });
    }

    // Parsear ventas a productos
    const products = toteatService.parseSalesToProducts(result.data);

    // Calcular totales
    const totalSinImpuesto = products.reduce((sum, p) => sum + (p.ventaSinImpuesto || 0), 0);
    const totalConImpuesto = products.reduce((sum, p) => sum + (p.ventaConImpuesto || 0), 0);

    // Agrupar por categoría para resumen
    const porCategoria = {};
    products.forEach(p => {
      if (!porCategoria[p.categoria]) {
        porCategoria[p.categoria] = { cantidad: 0, total: 0 };
      }
      porCategoria[p.categoria].cantidad += p.cantidad;
      porCategoria[p.categoria].total += p.ventaConImpuesto;
    });

    const resumen = Object.entries(porCategoria)
      .map(([categoria, data]) => ({ categoria, ...data }))
      .sort((a, b) => b.total - a.total);

    res.json({
      success: true,
      header: {
        locationName: 'Domani (API Toteat)',
        beginDate: targetDate,
        endDate: targetDate,
        totalRevenueExclTax: totalSinImpuesto,
        totalRevenueInclTax: totalConImpuesto
      },
      resumen,
      items: products,
      ordenes: result.data.length,
      mensaje: `Total: $${totalConImpuesto.toLocaleString('es-CL')} (${products.length} productos en ${result.data.length} órdenes)`
    });

  } catch (error) {
    logger.error('Error obteniendo ventas:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

// Endpoint para exportar ventas a Excel (manual)
app.get('/api/export', async (req, res) => {
  try {
    const { date } = req.query;
    // Si no se especifica fecha, usa ayer
    let targetDate = date;
    if (!targetDate) {
      const yesterday = new Date();
      yesterday.setDate(yesterday.getDate() - 1);
      targetDate = yesterday.toISOString().split('T')[0];
    }

    logger.info(`Exportación manual solicitada para: ${targetDate}`);

    const result = await schedulerService.runManualExport(targetDate);

    if (!result.success) {
      return res.status(400).json({ success: false, error: result.error });
    }

    res.json({
      success: true,
      mensaje: `Excel generado exitosamente`,
      archivo: result.filePath,
      productos: result.productos,
      ordenes: result.ordenes,
      total: result.total
    });

  } catch (error) {
    logger.error('Error en exportación manual:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

// Endpoint para probar configuración de email
app.get('/api/email/test', async (req, res) => {
  try {
    const result = await emailService.testConnection();
    res.json(result);
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// Endpoint para ejecutar exportación manual y enviar email
app.get('/api/export/trigger', async (req, res) => {
  try {
    const { date } = req.query;
    logger.info(`Ejecutando exportación manual trigger${date ? ` para fecha: ${date}` : ''}`);
    const result = await schedulerService.runManualExport(date || null);
    res.json(result);
  } catch (error) {
    logger.error('Error en trigger de exportación:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

// Endpoint para descargar el Excel generado
app.get('/api/export/download', async (req, res) => {
  try {
    const { date } = req.query;
    let targetDate = date;
    if (!targetDate) {
      const yesterday = new Date();
      yesterday.setDate(yesterday.getDate() - 1);
      targetDate = yesterday.toISOString().split('T')[0];
    }

    const result = await schedulerService.runManualExport(targetDate);

    if (!result.success) {
      return res.status(400).json({ success: false, error: result.error });
    }

    res.download(result.filePath);

  } catch (error) {
    logger.error('Error descargando Excel:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

// Iniciar servidor
const PORT = config.server.port;

app.listen(PORT, () => {
  logger.info(`Servidor iniciado en puerto ${PORT}`);
  logger.info(`Ambiente: ${config.server.env}`);
  logger.info('Domani Ventas API listo');
  logger.info(`Accede a http://localhost:${PORT}/panel`);

  // Iniciar tareas programadas
  schedulerService.start();
  logger.info('Exportación automática programada: 1:00 PM Chile (testing)');
});

// Manejo de errores no capturados
process.on('unhandledRejection', (reason, promise) => {
  logger.error('Unhandled Rejection:', { reason, promise });
});

process.on('uncaughtException', (error) => {
  logger.error('Uncaught Exception:', error);
  process.exit(1);
});

module.exports = app;

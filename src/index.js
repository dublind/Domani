const express = require('express');
const fs = require('fs');
const path = require('path');
const config = require('./config/config');
const logger = require('./utils/logger');
const toteatService = require('./services/toteat.service');
const schedulerService = require('./services/scheduler.service');
const emailService = require('./services/email.service');
const marketmanService = require('./services/marketman.service');

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
        * { margin: 0; padding: 0; box-sizing: border-box; }
        body { font-family: 'Segoe UI', Arial, sans-serif; background: linear-gradient(135deg, #1a1a2e 0%, #16213e 50%, #0f3460 100%); min-height: 100vh; padding: 30px 20px; color: #e0e0e0; }
        .container { max-width: 1200px; margin: 0 auto; }
        .header { text-align: center; margin-bottom: 30px; }
        .header h1 { font-size: 2.2em; color: #fff; letter-spacing: 1px; }
        .header h1 span { color: #e94560; }
        .header p { color: #8892b0; margin-top: 5px; font-size: 14px; }
        .card { background: rgba(255,255,255,0.05); backdrop-filter: blur(10px); border: 1px solid rgba(255,255,255,0.1); padding: 30px; border-radius: 16px; margin-bottom: 20px; }
        .form-row { display: flex; align-items: flex-end; gap: 15px; flex-wrap: wrap; }
        .form-group { flex: 0 0 auto; }
        .form-group label { display: block; margin-bottom: 8px; font-size: 13px; color: #8892b0; text-transform: uppercase; letter-spacing: 1px; }
        input[type="date"] { padding: 12px 16px; width: 220px; border: 1px solid rgba(255,255,255,0.15); border-radius: 10px; background: rgba(255,255,255,0.08); color: #fff; font-size: 15px; outline: none; transition: border-color 0.3s; }
        input[type="date"]:focus { border-color: #e94560; }
        input[type="date"]::-webkit-calendar-picker-indicator { filter: invert(1); }
        .btn { padding: 12px 28px; border: none; border-radius: 10px; cursor: pointer; font-size: 15px; font-weight: 600; transition: all 0.3s; display: inline-flex; align-items: center; gap: 8px; }
        .btn-fetch { background: linear-gradient(135deg, #e94560, #c81d4e); color: white; }
        .btn-fetch:hover { transform: translateY(-2px); box-shadow: 0 6px 20px rgba(233,69,96,0.4); }
        .btn-test { background: rgba(255,255,255,0.1); color: #8892b0; border: 1px solid rgba(255,255,255,0.15); }
        .btn-test:hover { background: rgba(255,255,255,0.15); color: #fff; }
        .btn-download { background: linear-gradient(135deg, #0ea5e9, #0284c7); color: white; display: none; }
        .btn-download:hover { transform: translateY(-2px); box-shadow: 0 6px 20px rgba(14,165,233,0.4); }
        #result { margin-top: 20px; display: none; }
        .stats-grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(200px, 1fr)); gap: 15px; margin-bottom: 20px; }
        .stat-card { background: rgba(255,255,255,0.05); border: 1px solid rgba(255,255,255,0.08); border-radius: 12px; padding: 20px; text-align: center; }
        .stat-card .label { font-size: 12px; color: #8892b0; text-transform: uppercase; letter-spacing: 1px; }
        .stat-card .value { font-size: 1.6em; font-weight: 700; color: #fff; margin-top: 5px; }
        .stat-card .value.green { color: #4ade80; }
        .stat-card .value.blue { color: #60a5fa; }
        .stat-card .value.red { color: #e94560; }
        table { width: 100%; border-collapse: collapse; margin: 15px 0; font-size: 13px; }
        th { background: rgba(233,69,96,0.2); color: #e94560; padding: 12px 10px; text-align: left; font-size: 11px; text-transform: uppercase; letter-spacing: 1px; border-bottom: 2px solid rgba(233,69,96,0.3); }
        td { padding: 10px; border-bottom: 1px solid rgba(255,255,255,0.05); color: #ccd6f6; }
        tr:hover td { background: rgba(255,255,255,0.03); }
        .error { color: #f87171; background: rgba(248,113,113,0.1); padding: 15px; border-radius: 10px; border: 1px solid rgba(248,113,113,0.2); }
        .loading { color: #8892b0; padding: 30px; text-align: center; font-size: 16px; }
        .total-row { font-weight: 700; color: #fff; }
        @media (max-width: 600px) { .form-row { flex-direction: column; } input[type="date"] { width: 100%; } .btn { width: 100%; justify-content: center; } }
      </style>
    </head>
    <body>
      <div class="container">
        <div class="header">
          <h1>Domani <span>Ventas</span></h1>
          <p>Panel de consulta de ventas - Toteat API</p>
        </div>

        <div class="card">
          <div class="form-row">
            <div class="form-group">
              <label>Fecha inicio</label>
              <input type="date" id="startDate">
            </div>
            <div class="form-group">
              <label>Fecha fin</label>
              <input type="date" id="endDate">
            </div>
            <button class="btn btn-fetch" onclick="fetchFromAPI()">Obtener Ventas</button>
            <button class="btn btn-test" onclick="testAPI()">Probar Conexion</button>
            <button class="btn btn-download" onclick="downloadExcel()" id="btnDownload">Descargar Excel</button>
          </div>
        </div>

        <div id="result"></div>
      </div>

      <script>
        let lastStart = null;
        let lastEnd = null;

        // Establecer rango por defecto: ultimos 7 dias
        (function() {
          const today = new Date();
          const weekAgo = new Date();
          weekAgo.setDate(today.getDate() - 7);
          document.getElementById('endDate').value = today.toISOString().split('T')[0];
          document.getElementById('startDate').value = weekAgo.toISOString().split('T')[0];
        })();

        async function testAPI() {
          const resultDiv = document.getElementById('result');
          resultDiv.style.display = 'block';
          resultDiv.innerHTML = '<p class="loading">Probando conexion con Toteat...</p>';

          try {
            const response = await fetch('/api/toteat/test');
            const data = await response.json();
            if (data.connected) {
              resultDiv.innerHTML = '<div class="card" style="border-color:rgba(74,222,128,0.3);"><p style="color:#4ade80;font-weight:bold;text-align:center;font-size:18px;">Conexion exitosa con API Toteat</p></div>';
            } else {
              resultDiv.innerHTML = '<div class="error">Error: ' + (data.error || 'No se pudo conectar') + '</div>';
            }
          } catch (error) {
            resultDiv.innerHTML = '<div class="error">Error: ' + error.message + '</div>';
          }
        }

        async function fetchFromAPI() {
          const resultDiv = document.getElementById('result');
          const startDate = document.getElementById('startDate').value;
          const endDate = document.getElementById('endDate').value;
          lastStart = startDate;
          lastEnd = endDate;

          if (!startDate || !endDate) {
            resultDiv.style.display = 'block';
            resultDiv.innerHTML = '<div class="error">Selecciona fecha inicio y fecha fin</div>';
            return;
          }

          if (startDate > endDate) {
            resultDiv.style.display = 'block';
            resultDiv.innerHTML = '<div class="error">La fecha inicio debe ser anterior a la fecha fin</div>';
            return;
          }

          resultDiv.style.display = 'block';
          resultDiv.innerHTML = '<p class="loading">Obteniendo datos de Toteat...</p>';

          try {
            const response = await fetch('/api/toteat/ventas?start=' + startDate + '&end=' + endDate);
            const data = await response.json();
            displayResult(data);
          } catch (error) {
            resultDiv.innerHTML = '<div class="error">Error: ' + error.message + '</div>';
          }
        }

        function displayResult(data) {
          const resultDiv = document.getElementById('result');
          if (data.success) {
            document.getElementById('btnDownload').style.display = 'inline-flex';

            const totalItems = data.items ? data.items.length : 0;
            const rangeLabel = data.header.beginDate === data.header.endDate
              ? data.header.beginDate
              : data.header.beginDate + ' a ' + data.header.endDate;

            let html = '<div class="stats-grid">';
            html += '<div class="stat-card"><div class="label">Rango</div><div class="value blue" style="font-size:1em;">' + rangeLabel + '</div></div>';
            html += '<div class="stat-card"><div class="label">Productos</div><div class="value">' + totalItems + '</div></div>';
            html += '<div class="stat-card"><div class="label">Total sin IVA</div><div class="value green">$' + data.header.totalRevenueExclTax.toLocaleString('es-CL') + '</div></div>';
            html += '<div class="stat-card"><div class="label">Total con IVA</div><div class="value red">$' + data.header.totalRevenueInclTax.toLocaleString('es-CL') + '</div></div>';
            html += '</div>';

            if (data.items && data.items.length > 0) {
              html += '<div class="card">';
              html += '<table>';
              html += '<tr><th>Producto</th><th>Codigo</th><th>Precio Unit.</th><th>Cantidad</th><th>Venta sin IVA</th><th>Venta con IVA</th><th>Categoria</th></tr>';
              data.items.forEach(item => {
                html += '<tr>';
                html += '<td>' + item.producto + '</td>';
                html += '<td>' + item.codigo + '</td>';
                html += '<td>$' + (item.precioUnitario || 0).toLocaleString('es-CL') + '</td>';
                html += '<td>' + item.cantidad + '</td>';
                html += '<td>$' + (item.ventaSinImpuesto || 0).toLocaleString('es-CL') + '</td>';
                html += '<td>$' + (item.ventaConImpuesto || 0).toLocaleString('es-CL') + '</td>';
                html += '<td>' + item.categoria + '</td>';
                html += '</tr>';
              });
              html += '</table>';
              html += '</div>';
            } else {
              html += '<div class="card"><p style="text-align:center;color:#8892b0;">No se encontraron ventas para este rango.</p></div>';
            }

            resultDiv.innerHTML = html;
          } else {
            resultDiv.innerHTML = '<div class="error">Error: ' + data.error + '</div>';
          }
        }

        async function downloadExcel() {
          if (!lastStart || !lastEnd) return;
          try {
            const response = await fetch('/api/export/download-range?start=' + lastStart + '&end=' + lastEnd);
            if (!response.ok) throw new Error('Error generando Excel');
            const blob = await response.blob();
            const link = document.createElement('a');
            link.href = URL.createObjectURL(blob);
            link.download = 'ventas_domani_' + lastStart + '_a_' + lastEnd + '.xlsx';
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
    const { start, end, date } = req.query;
    const startDate = start || date || new Date().toISOString().split('T')[0];
    const endDate = end || startDate;

    logger.info(`Obteniendo ventas de Toteat para: ${startDate} a ${endDate}`);

    const result = await toteatService.getSales(startDate, endDate);

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
        beginDate: startDate,
        endDate: endDate,
        totalRevenueExclTax: totalSinImpuesto,
        totalRevenueInclTax: totalConImpuesto
      },
      resumen,
      items,
      hasData,
      mensaje: hasData
        ? `Total: $${totalConImpuesto.toLocaleString('es-CL')} (${items.length} productos en ${result.data.length} órdenes)`
        : 'No se encontraron ventas para este rango.'
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

// MarketMan: test de conexión
app.get('/api/marketman/test', async (req, res) => {
  try {
    const result = await marketmanService.testConnection();
    res.json(result);
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// MarketMan: obtener cuentas autorizadas (para ver el BuyerGuid)
app.get('/api/marketman/accounts', async (req, res) => {
  try {
    const axios = require('axios');
    const token = await marketmanService.getAccessToken();
    const response = await axios.post(
      'https://api.marketman.com/v3/buyers/partneraccounts/GetAuthorisedAccounts',
      {},
      { headers: { AUTH_TOKEN: token, 'Content-Type': 'application/json' } }
    );
    res.json(response.data);
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

// Endpoint para descargar Excel de un rango de fechas
app.get('/api/export/download-range', async (req, res) => {
  try {
    const { start, end } = req.query;
    if (!start || !end) {
      return res.status(400).json({ success: false, error: 'Se requieren parametros start y end' });
    }

    logger.info(`Descargando Excel rango: ${start} a ${end}`);

    const result = await schedulerService.runRangeExport(start, end);

    if (!result.success) {
      return res.status(400).json({ success: false, error: result.error });
    }

    res.download(result.filePath);

  } catch (error) {
    logger.error('Error descargando Excel rango:', error);
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

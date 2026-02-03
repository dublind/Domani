const express = require('express');
const fs = require('fs');
const path = require('path');
const multer = require('multer');
const XLSX = require('xlsx');
const config = require('./config/config');
const logger = require('./utils/logger');
const toteatService = require('./services/toteat.service');
const schedulerService = require('./services/scheduler.service');
const emailService = require('./services/email.service');

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

// Crear aplicacion Express
const app = express();
app.use(express.json());

// Ruta principal - redirige a upload
app.get('/', (req, res) => {
  res.redirect('/upload');
});

// Health check endpoint
app.get('/health', (req, res) => {
  res.json({
    status: 'ok',
    service: 'Toteat CSV Processor',
    timestamp: new Date().toISOString()
  });
});

// Pagina HTML para procesar ventas Toteat
app.get('/upload', (req, res) => {
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
        input[type="text"], input[type="date"] { padding: 10px; width: 250px; border: 1px solid #ddd; border-radius: 5px; }
        input[type="file"] { margin: 15px 0; padding: 10px; }
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
        .info-box { background: #fff3e0; padding: 15px; border-radius: 5px; margin: 15px 0; border-left: 4px solid #ff9800; }
        .info-api { background: #ffebee; border-left-color: #f44336; }
        .tabs { display: flex; gap: 10px; margin-bottom: 20px; }
        .tab { padding: 10px 20px; background: #ddd; border-radius: 5px 5px 0 0; cursor: pointer; }
        .tab.active { background: white; font-weight: bold; }
        .tab-content { display: none; }
        .tab-content.active { display: block; }
      </style>
    </head>
    <body>
      <h1>Ventas Toteat - Domani</h1>

      <div class="section">
        <div class="tabs">
          <div class="tab active" onclick="showTab('csv')">Subir CSV</div>
          <div class="tab" onclick="showTab('api')">API Toteat</div>
        </div>

        <!-- Tab CSV -->
        <div id="tab-csv" class="tab-content active">
          <h2>Procesar CSV de Ventas</h2>
          <div class="info-box">
            <strong>Formato esperado:</strong> CSV exportado de Toteat con columnas: Elemento de Menu, Codigo, Cantidad, Ingresos Excl. IVA, etc.
          </div>

          <div class="form-group">
            <label>Nombre del Local:</label>
            <input type="text" id="locationName" value="Domani Providencia">
          </div>

          <div class="form-group">
            <label>Fecha del Reporte:</label>
            <input type="date" id="reportDate" value="${new Date().toISOString().split('T')[0]}">
          </div>

          <div class="form-group">
            <label>Archivo CSV:</label>
            <input type="file" id="csvFile" accept=".csv">
          </div>

          <button class="btn-primary" onclick="uploadCSV()">Procesar CSV</button>
        </div>

        <!-- Tab API -->
        <div id="tab-api" class="tab-content">
          <h2>Obtener desde API Toteat</h2>
          <div class="info-box info-api">
            <strong>Nota:</strong> La API de Toteat tiene limite de 1 solicitud por minuto. Los datos vienen agrupados por turnos.
          </div>

          <div class="form-group">
            <label>Fecha a consultar:</label>
            <input type="date" id="apiDate" value="${new Date().toISOString().split('T')[0]}">
          </div>

          <button class="btn-api" onclick="fetchFromAPI()">Obtener de API Toteat</button>
          <button class="btn-primary" onclick="testAPI()">Probar Conexion</button>
        </div>

        <button class="btn-download" onclick="downloadExcel()" id="btnDownload" style="display:none;">Descargar Excel</button>
      </div>

      <div id="result"></div>

      <script>
        let lastResult = null;

        function showTab(tab) {
          document.querySelectorAll('.tab').forEach(t => t.classList.remove('active'));
          document.querySelectorAll('.tab-content').forEach(t => t.classList.remove('active'));
          document.querySelector('.tab:nth-child(' + (tab === 'csv' ? '1' : '2') + ')').classList.add('active');
          document.getElementById('tab-' + tab).classList.add('active');
        }

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
            const response = await fetch('/api/process-sales-csv', { method: 'POST', body: formData });
            const data = await response.json();
            displayResult(data);
          } catch (error) {
            resultDiv.innerHTML = '<p class="error">Error: ' + error.message + '</p>';
          }
        }

        function displayResult(data) {
          const resultDiv = document.getElementById('result');
          if (data.success) {
            lastResult = data;
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
              html += '<p>No se encontraron items detallados. Los totales vienen de la API.</p>';
            }

            resultDiv.innerHTML = html;
          } else {
            resultDiv.innerHTML = '<p class="error">Error: ' + data.error + '</p>';
          }
        }

        async function downloadExcel() {
          if (!lastResult) return;
          try {
            const response = await fetch('/api/generate-excel', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ header: lastResult.header, items: lastResult.items })
            });
            if (!response.ok) throw new Error('Error generando Excel');
            const blob = await response.blob();
            const link = document.createElement('a');
            link.href = URL.createObjectURL(blob);
            link.download = 'ventas_' + lastResult.header.beginDate + '.xlsx';
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

// Endpoint para procesar CSV de ventas Toteat
app.post('/api/process-sales-csv', upload.single('csv'), async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ success: false, error: 'No se recibio archivo' });
    }

    const locationName = req.body.locationName || 'Sin nombre';
    const reportDate = req.body.reportDate || new Date().toISOString().split('T')[0];

    logger.info(`Procesando CSV de ventas: ${req.file.filename}`);

    // Leer y parsear el CSV
    let csvContent = fs.readFileSync(req.file.path, 'utf8');
    csvContent = csvContent.replace(/^\uFEFF/, ''); // Remover BOM

    const lines = csvContent.split('\n').filter(line => line.trim());

    if (lines.length < 2) {
      return res.status(400).json({ success: false, error: 'El CSV esta vacio o no tiene datos' });
    }

    // Parsear encabezados
    const headers = lines[0].split(',').map(h => h.trim().replace(/"/g, '').toLowerCase());

    // Detectar columnas (compatible con formato Toteat)
    const idIdx = headers.findIndex(h => h.includes('codigo') || h.includes('código') || h === 'id' || h.includes('pos'));
    const productoIdx = headers.findIndex(h => h.includes('elemento') || h.includes('producto') || h.includes('menu') || h.includes('menú'));
    const cantidadIdx = headers.findIndex(h => h.includes('cantidad') || h.includes('quantity') || h.includes('qty'));
    const ventaExclIdx = headers.findIndex(h => h.includes('excl') || h.includes('sin iva') || h.includes('valor venta'));
    const ventaInclIdx = headers.findIndex(h => h.includes('incl') || h.includes('con iva') || h.includes('renta'));

    const items = [];
    let totalSinImpuesto = 0;
    let totalConImpuesto = 0;

    // Procesar cada linea
    for (let i = 1; i < lines.length; i++) {
      const values = parseCSVLine(lines[i]);
      if (values.length < 4) continue;

      const id = values[idIdx] || '';
      const producto = values[productoIdx]?.replace(/"/g, '') || '';
      const cantidad = parseInt(values[cantidadIdx]?.replace(/[^0-9-]/g, '') || '0');

      // Parsear montos (formato chileno: punto separador miles, coma decimal)
      const ventaSinImpuesto = parseMontoChileno(values[ventaExclIdx]);
      const ventaConImpuesto = ventaInclIdx >= 0 ? parseMontoChileno(values[ventaInclIdx]) : Math.round(ventaSinImpuesto * 1.19);

      const precioUnitario = cantidad > 0 ? Math.round(ventaSinImpuesto / cantidad) : 0;
      const categoria = inferirCategoria(producto);

      totalSinImpuesto += ventaSinImpuesto;
      totalConImpuesto += ventaConImpuesto;

      items.push({
        producto,
        codigo: id,
        precioUnitario,
        cantidad,
        ventaSinImpuesto,
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

// Endpoint para generar Excel en formato Marketman
app.post('/api/generate-excel', (req, res) => {
  try {
    const { header, items } = req.body;

    if (!header || !items) {
      return res.status(400).json({ success: false, error: 'Datos incompletos' });
    }

    // Formatear fecha como DD/MM/YYYY
    const formattedDate = header.beginDate.split('-').reverse().join('/');

    // Agrupar productos por nombre y sumar cantidades/totales
    const productosAgrupados = {};
    for (const item of items) {
      const key = item.producto;
      if (!productosAgrupados[key]) {
        productosAgrupados[key] = {
          producto: item.producto,
          codigo: item.codigo,
          precioUnitario: item.precioUnitario || 0,
          cantidad: 0,
          ventaSinImpuesto: 0,
          ventaConImpuesto: 0,
          categoria: item.categoria
        };
      }
      productosAgrupados[key].cantidad += item.cantidad;
      productosAgrupados[key].ventaSinImpuesto += item.ventaSinImpuesto;
      productosAgrupados[key].ventaConImpuesto += item.ventaConImpuesto;
    }

    // Convertir a array y ordenar por cantidad descendente
    const productosOrdenados = Object.values(productosAgrupados)
      .sort((a, b) => b.cantidad - a.cantidad);

    // Formato Marketman
    const data = [
      ['Location name', 'Domani Providencia'],
      ['Begin date', formattedDate],
      ['End date', formattedDate],
      ['Total revenue excl. tax', header.totalRevenueExclTax],
      ['Ingresos totales inc. impuesto', header.totalRevenueInclTax],
      [],
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

    // Crear workbook y worksheet
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

    // Generar buffer
    const buffer = XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' });

    // Enviar archivo
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', `attachment; filename="ventas_domani_${header.beginDate}.xlsx"`);
    res.send(buffer);

  } catch (error) {
    logger.error('Error generando Excel:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

// Funcion para parsear linea CSV considerando comillas
function parseCSVLine(line) {
  const values = [];
  let current = '';
  let inQuotes = false;

  for (const char of line) {
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
  return values;
}

// Funcion para parsear monto en formato chileno ($ 1.234.567,00)
function parseMontoChileno(valor) {
  if (!valor) return 0;
  // Remover $, espacios, y convertir formato chileno a numero
  const limpio = valor.replace(/[$\s]/g, '').replace(/\./g, '').replace(',', '.');
  return parseFloat(limpio) || 0;
}

// Funcion para inferir categoria basada en nombre del producto
function inferirCategoria(producto) {
  const nombreLower = producto.toLowerCase();

  // AGREGADO - productos extras, aderezos, agregados
  if (nombreLower.includes('(*extra)') || nombreLower.includes('*extra') || nombreLower.includes('aderezo') || nombreLower.includes('agr.') || nombreLower.includes('dip') || nombreLower.includes('de regalo')) {
    return 'AGREGADO';
  }
  // PIZZAS
  if (nombreLower.includes('pizza') || nombreLower.includes('margherita') || nombreLower.includes('pepperoni') ||
      nombreLower.includes('caprichosisima') || nombreLower.includes('tartufo') || nombreLower.includes('marinara') ||
      nombreLower.includes('putanesca') || nombreLower.includes('fonduta') || nombreLower.includes('brisket') ||
      nombreLower.includes('gamberetti') || nombreLower.includes('rucula') || nombreLower.includes('rúcula') ||
      nombreLower.includes('bambino') || nombreLower.includes('kevin bacon') || nombreLower.includes('chilli honey') ||
      nombreLower.includes('top domani') || nombreLower.includes('gloria') || nombreLower.includes('felice') ||
      nombreLower.includes('duo felici') || nombreLower.includes('due felici')) {
    return 'PIZZAS 🍕';
  }
  // ANTIPASTOS Y ENSALADAS
  if (nombreLower.includes('insalata') || nombreLower.includes('ensalada') || nombreLower.includes('panetti') ||
      nombreLower.includes('panecillo') || nombreLower.includes('tavola') || nombreLower.includes('provolone') ||
      nombreLower.includes('burrata') || nombreLower.includes('carpaccio') || nombreLower.includes('croccantina') ||
      nombreLower.includes('gnocchi') || nombreLower.includes('ñoqui')) {
    return 'ANTIPASTOS Y ENSALADAS 🥗';
  }
  // CERVEZAS
  if (nombreLower.includes('birra') || nombreLower.includes('cerveza') || nombreLower.includes('schop') ||
      nombreLower.includes('stella') || nombreLower.includes('peroni') || nombreLower.includes('leyenda') ||
      nombreLower.includes('estrella') || nombreLower.includes('chelada') || nombreLower.includes('michelada')) {
    return 'CERVEZAS TODAS🍺';
  }
  // AGUAS JUGOS & BEBIDAS
  if (nombreLower.includes('coca') || nombreLower.includes('fanta') || nombreLower.includes('ginger') ||
      nombreLower.includes('tonica') || nombreLower.includes('gaseosa') || nombreLower.includes('agua') ||
      nombreLower.includes('vital') || nombreLower.includes('pellegrino') || nombreLower.includes('panna') ||
      nombreLower.includes('jugo') || nombreLower.includes('limonada')) {
    return 'AGUAS JUGOS & BEBIDAS';
  }
  // SPRITZ & COCKTAILS
  if (nombreLower.includes('spritz') || nombreLower.includes('negroni') || nombreLower.includes('aperol') ||
      nombreLower.includes('campari') || nombreLower.includes('sangria') || nombreLower.includes('sangría') ||
      nombreLower.includes('frozen') || nombreLower.includes('limoncello') || nombreLower.includes('chambord') ||
      nombreLower.includes('mocktail') || nombreLower.includes('disaronno fizz')) {
    return 'SPRITZ & COCKTAILS Y ACUERDATE';
  }
  // VINOS & ESPUMANTES
  if (nombreLower.includes('vino') || nombreLower.includes('espumante') || nombreLower.includes('champagne') ||
      nombreLower.includes('prosecco') || nombreLower.includes('wine')) {
    return 'VINOS & ESPUMANTES';
  }
  // ESPIRITUOSAS Y DESTILADOS
  if (nombreLower.includes('gin') || nombreLower.includes('pisco') || nombreLower.includes('fernet') ||
      nombreLower.includes('jack') || nombreLower.includes('whisky') || nombreLower.includes('vodka') ||
      nombreLower.includes('ron') || nombreLower.includes('tequila')) {
    return 'ESPIRITUOSAS Y DESTILADOS';
  }
  // DOLCE
  if (nombreLower.includes('gelato') || nombreLower.includes('tiramisú') || nombreLower.includes('tiramisu') ||
      nombreLower.includes('affogato') || nombreLower.includes('dolce') || nombreLower.includes('postre')) {
    return 'DOLCE 🍦';
  }
  // CAFETERIA
  if (nombreLower.includes('espresso') || nombreLower.includes('americano') || nombreLower.includes('capuccino') ||
      nombreLower.includes('cafe') || nombreLower.includes('café') || nombreLower.includes('lavazza') ||
      nombreLower.includes('te ') || nombreLower.includes('infusion') || nombreLower.includes('dilmah')) {
    return 'Cafeteria';
  }
  // DELIVERY
  if (nombreLower.includes('delivery') || nombreLower.includes('despacho') || nombreLower.includes('colacion')) {
    return 'DELIVERY';
  }

  return 'OTROS';
}

// Iniciar servidor
const PORT = config.server.port;

app.listen(PORT, () => {
  logger.info(`Servidor iniciado en puerto ${PORT}`);
  logger.info(`Ambiente: ${config.server.env}`);
  logger.info('Servicio de procesamiento CSV Toteat listo');
  logger.info(`Accede a http://localhost:${PORT}/upload para subir CSV`);

  // Iniciar tareas programadas
  schedulerService.start();
  logger.info('Exportación automática programada: 11:50 AM Chile (testing)');
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

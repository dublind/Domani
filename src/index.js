const express = require('express');
const fs = require('fs');
const path = require('path');
const config = require('./config/config');
const logger = require('./utils/logger');
const ToteatService = require('./services/toteat.service');
const schedulerService = require('./services/scheduler.service');
const emailService = require('./services/email.service');
const marketmanService = require('./services/marketman.service');
const { getLocations } = require('./config/locations');

// Crear directorio de logs si no existe
const logsDir = path.join(__dirname, '..', 'logs');
if (!fs.existsSync(logsDir)) {
  fs.mkdirSync(logsDir);
}

// Crear aplicacion Express
const app = express();
app.use(express.json());

// Helper: obtener ToteatService para un índice de restaurante (1-based)
function getToteatForLocation(locIndex) {
  const locations = getLocations();
  const idx = parseInt(locIndex || '1', 10) - 1;
  const location = locations[Math.max(0, Math.min(idx, locations.length - 1))];
  return { service: new ToteatService(location ? location.toteat : {}), location };
}

// Ruta principal - redirige al panel
app.get('/', (req, res) => {
  res.redirect('/panel');
});

// API: listar restaurantes disponibles
app.get('/api/locations', (req, res) => {
  const locations = getLocations();
  res.json({
    success: true,
    locations: locations.map((loc, i) => ({
      index: i + 1,
      name: loc.name,
      hasMarketman: !!loc.marketman.buyerGuid
    }))
  });
});

// Panel principal
app.get('/panel', (req, res) => {
  const locations = getLocations();
  const locationOptions = locations.map((loc, i) =>
    `<option value="${i + 1}">${loc.name}</option>`
  ).join('');

  res.send(`
    <!DOCTYPE html>
    <html lang="es">
    <head>
      <meta charset="UTF-8">
      <meta name="viewport" content="width=device-width, initial-scale=1.0">
      <title>Domani - Panel de Ventas</title>
      <style>
        :root {
          --red:       #C8102E;
          --red-dark:  #9B0D22;
          --red-light: #E63950;
          --white:     #FFFFFF;
          --off-white: #FAF7F5;
          --gray-100:  #F5F0EE;
          --gray-200:  #E8E0DC;
          --gray-500:  #9A8A85;
          --gray-700:  #4A3F3B;
          --gray-900:  #1E1410;
        }
        * { margin: 0; padding: 0; box-sizing: border-box; }
        body {
          font-family: 'Segoe UI', Arial, sans-serif;
          background: var(--off-white);
          min-height: 100vh;
          color: var(--gray-900);
        }

        /* ── Top bar ── */
        .topbar {
          background: var(--red);
          padding: 0 30px;
          display: flex;
          align-items: center;
          justify-content: space-between;
          height: 60px;
          box-shadow: 0 2px 12px rgba(200,16,46,0.3);
        }
        .topbar-brand {
          display: flex;
          align-items: center;
          gap: 12px;
          text-decoration: none;
        }
        .topbar-logo {
          width: 38px;
          height: 38px;
          background: var(--white);
          border-radius: 8px;
          display: flex;
          align-items: center;
          justify-content: center;
          font-size: 20px;
        }
        .topbar-name {
          font-size: 1.3em;
          font-weight: 700;
          color: var(--white);
          letter-spacing: 1px;
        }
        .topbar-name span { opacity: 0.75; font-weight: 400; font-size: 0.75em; margin-left: 6px; }
        .topbar-status {
          font-size: 12px;
          color: rgba(255,255,255,0.8);
          background: rgba(255,255,255,0.15);
          padding: 4px 12px;
          border-radius: 20px;
        }

        /* ── Layout ── */
        .page { max-width: 1280px; margin: 0 auto; padding: 28px 20px 60px; }

        /* ── Section title ── */
        .section-title {
          font-size: 11px;
          font-weight: 700;
          letter-spacing: 1.5px;
          text-transform: uppercase;
          color: var(--gray-500);
          margin-bottom: 12px;
        }

        /* ── Filter card ── */
        .filter-card {
          background: var(--white);
          border-radius: 16px;
          padding: 24px 28px;
          box-shadow: 0 1px 4px rgba(0,0,0,0.08);
          margin-bottom: 24px;
          display: flex;
          flex-wrap: wrap;
          gap: 16px;
          align-items: flex-end;
        }
        .form-group { display: flex; flex-direction: column; gap: 6px; }
        .form-group label {
          font-size: 11px;
          font-weight: 600;
          text-transform: uppercase;
          letter-spacing: 1px;
          color: var(--gray-500);
        }
        select, input[type="date"] {
          padding: 10px 14px;
          border: 1.5px solid var(--gray-200);
          border-radius: 10px;
          background: var(--white);
          color: var(--gray-900);
          font-size: 14px;
          outline: none;
          transition: border-color 0.2s;
          min-width: 180px;
        }
        select:focus, input[type="date"]:focus { border-color: var(--red); }
        input[type="date"]::-webkit-calendar-picker-indicator {
          cursor: pointer;
          opacity: 0.6;
        }
        select { cursor: pointer; }

        /* ── Buttons ── */
        .btn-group { display: flex; gap: 10px; flex-wrap: wrap; }
        .btn {
          padding: 10px 22px;
          border: none;
          border-radius: 10px;
          cursor: pointer;
          font-size: 14px;
          font-weight: 600;
          transition: all 0.2s;
          display: inline-flex;
          align-items: center;
          gap: 8px;
          white-space: nowrap;
        }
        .btn-primary {
          background: var(--red);
          color: var(--white);
        }
        .btn-primary:hover { background: var(--red-dark); transform: translateY(-1px); box-shadow: 0 4px 14px rgba(200,16,46,0.35); }
        .btn-secondary {
          background: var(--gray-100);
          color: var(--gray-700);
          border: 1.5px solid var(--gray-200);
        }
        .btn-secondary:hover { background: var(--gray-200); }
        .btn-download {
          background: var(--white);
          color: var(--red);
          border: 1.5px solid var(--red);
          display: none;
        }
        .btn-download:hover { background: var(--red); color: var(--white); }
        .btn:disabled { opacity: 0.5; cursor: not-allowed; transform: none !important; box-shadow: none !important; }

        /* ── Stats grid ── */
        .stats-grid {
          display: grid;
          grid-template-columns: repeat(auto-fit, minmax(200px, 1fr));
          gap: 16px;
          margin-bottom: 24px;
        }
        .stat-card {
          background: var(--white);
          border-radius: 14px;
          padding: 22px 20px;
          box-shadow: 0 1px 4px rgba(0,0,0,0.07);
          border-left: 4px solid transparent;
        }
        .stat-card.red   { border-left-color: var(--red); }
        .stat-card.green { border-left-color: #22C55E; }
        .stat-card.blue  { border-left-color: #3B82F6; }
        .stat-card.gray  { border-left-color: var(--gray-200); }
        .stat-label { font-size: 11px; font-weight: 600; letter-spacing: 1px; text-transform: uppercase; color: var(--gray-500); margin-bottom: 8px; }
        .stat-value { font-size: 1.7em; font-weight: 700; color: var(--gray-900); line-height: 1; }
        .stat-value.small { font-size: 1.1em; }

        /* ── Table card ── */
        .table-card {
          background: var(--white);
          border-radius: 16px;
          box-shadow: 0 1px 4px rgba(0,0,0,0.07);
          overflow: hidden;
          margin-bottom: 24px;
        }
        .table-card-header {
          padding: 18px 24px;
          border-bottom: 1px solid var(--gray-200);
          display: flex;
          align-items: center;
          justify-content: space-between;
        }
        .table-card-header h3 { font-size: 15px; font-weight: 700; color: var(--gray-900); }
        .badge {
          background: var(--red);
          color: var(--white);
          font-size: 11px;
          font-weight: 700;
          padding: 3px 10px;
          border-radius: 20px;
        }
        .table-wrap { overflow-x: auto; }
        table { width: 100%; border-collapse: collapse; font-size: 13px; }
        thead th {
          background: var(--gray-100);
          color: var(--gray-500);
          padding: 11px 14px;
          text-align: left;
          font-size: 11px;
          font-weight: 700;
          text-transform: uppercase;
          letter-spacing: 0.8px;
          white-space: nowrap;
          border-bottom: 1px solid var(--gray-200);
        }
        tbody td {
          padding: 11px 14px;
          border-bottom: 1px solid var(--gray-100);
          color: var(--gray-700);
        }
        tbody tr:last-child td { border-bottom: none; }
        tbody tr:hover td { background: var(--gray-100); }
        td.num { text-align: right; font-variant-numeric: tabular-nums; }
        td.cat span {
          background: rgba(200,16,46,0.08);
          color: var(--red);
          font-size: 11px;
          font-weight: 600;
          padding: 2px 8px;
          border-radius: 6px;
        }

        /* ── Feedback states ── */
        .msg-loading {
          text-align: center;
          padding: 50px 20px;
          color: var(--gray-500);
          font-size: 15px;
        }
        .msg-loading .spinner {
          width: 30px; height: 30px;
          border: 3px solid var(--gray-200);
          border-top-color: var(--red);
          border-radius: 50%;
          animation: spin 0.8s linear infinite;
          margin: 0 auto 14px;
        }
        @keyframes spin { to { transform: rotate(360deg); } }
        .msg-error {
          background: #FEF2F2;
          border: 1px solid #FECACA;
          color: #DC2626;
          padding: 16px 20px;
          border-radius: 12px;
          font-size: 14px;
        }
        .msg-empty {
          text-align: center;
          padding: 40px;
          color: var(--gray-500);
          font-size: 14px;
        }
        .msg-success {
          background: #F0FDF4;
          border: 1px solid #BBF7D0;
          color: #16A34A;
          padding: 16px 20px;
          border-radius: 12px;
          font-size: 14px;
          font-weight: 600;
        }

        /* ── Responsive ── */
        @media (max-width: 640px) {
          .topbar { padding: 0 16px; }
          .page { padding: 16px 12px 40px; }
          .filter-card { padding: 18px; }
          select, input[type="date"] { min-width: 100%; width: 100%; }
          .btn { width: 100%; justify-content: center; }
          .btn-group { flex-direction: column; }
        }
      </style>
    </head>
    <body>

      <!-- Top bar -->
      <div class="topbar">
        <div class="topbar-brand">
          <div class="topbar-logo">🍕</div>
          <div class="topbar-name">Domani <span>Panel de Ventas</span></div>
        </div>
        <div class="topbar-status" id="statusBadge">Cargando...</div>
      </div>

      <div class="page">

        <!-- Filtros -->
        <div class="section-title">Consulta de Ventas</div>
        <div class="filter-card">
          <div class="form-group">
            <label>Restaurante</label>
            <select id="locationSelect">
              ${locationOptions}
            </select>
          </div>
          <div class="form-group">
            <label>Fecha inicio</label>
            <input type="date" id="startDate">
          </div>
          <div class="form-group">
            <label>Fecha fin</label>
            <input type="date" id="endDate">
          </div>
          <div class="btn-group">
            <button class="btn btn-primary" onclick="fetchVentas()" id="btnFetch">
              <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><circle cx="11" cy="11" r="8"/><path d="m21 21-4.35-4.35"/></svg>
              Consultar
            </button>
            <button class="btn btn-secondary" onclick="testConexion()">Probar conexión</button>
            <button class="btn btn-download" onclick="downloadExcel()" id="btnDownload">
              <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg>
              Descargar Excel
            </button>
          </div>
        </div>

        <!-- Contenido dinámico -->
        <div id="result"></div>

      </div>

      <script>
        let lastStart = null, lastEnd = null, lastLoc = '1';

        // Fechas por defecto: últimos 7 días
        (function() {
          const today = new Date();
          const weekAgo = new Date();
          weekAgo.setDate(today.getDate() - 7);
          document.getElementById('endDate').value   = today.toISOString().split('T')[0];
          document.getElementById('startDate').value = weekAgo.toISOString().split('T')[0];
        })();

        // Estado de conexión
        (async function() {
          const badge = document.getElementById('statusBadge');
          try {
            const r = await fetch('/health');
            const d = await r.json();
            badge.textContent = d.status === 'ok' ? 'Servidor activo' : 'Error';
            badge.style.background = d.status === 'ok' ? 'rgba(255,255,255,0.18)' : 'rgba(220,38,38,0.4)';
          } catch(e) {
            badge.textContent = 'Sin conexión';
          }
        })();

        function setLoading(msg) {
          document.getElementById('result').innerHTML =
            '<div class="msg-loading"><div class="spinner"></div>' + msg + '</div>';
          document.getElementById('btnFetch').disabled = true;
        }

        function clearLoading() {
          document.getElementById('btnFetch').disabled = false;
        }

        async function testConexion() {
          setLoading('Probando conexión con Toteat...');
          try {
            const loc = document.getElementById('locationSelect').value;
            const r = await fetch('/api/toteat/test?loc=' + loc);
            const d = await r.json();
            document.getElementById('result').innerHTML = d.connected
              ? '<div class="msg-success">Conexión exitosa con API Toteat</div>'
              : '<div class="msg-error">Error: ' + (d.error || 'No se pudo conectar') + '</div>';
          } catch(e) {
            document.getElementById('result').innerHTML = '<div class="msg-error">Error: ' + e.message + '</div>';
          }
          clearLoading();
        }

        async function fetchVentas() {
          const startDate = document.getElementById('startDate').value;
          const endDate   = document.getElementById('endDate').value;
          const loc       = document.getElementById('locationSelect').value;
          const locName   = document.getElementById('locationSelect').options[document.getElementById('locationSelect').selectedIndex].text;

          if (!startDate || !endDate) {
            document.getElementById('result').innerHTML = '<div class="msg-error">Selecciona fecha inicio y fecha fin</div>';
            return;
          }
          if (startDate > endDate) {
            document.getElementById('result').innerHTML = '<div class="msg-error">La fecha inicio debe ser anterior o igual a la fecha fin</div>';
            return;
          }

          lastStart = startDate; lastEnd = endDate; lastLoc = loc;
          document.getElementById('btnDownload').style.display = 'none';
          setLoading('Obteniendo ventas de ' + locName + '...');

          try {
            const r = await fetch('/api/toteat/ventas?start=' + startDate + '&end=' + endDate + '&loc=' + loc);
            const d = await r.json();
            renderResult(d, locName);
          } catch(e) {
            document.getElementById('result').innerHTML = '<div class="msg-error">Error: ' + e.message + '</div>';
          }
          clearLoading();
        }

        function fmt(n) { return '$' + Math.round(n).toLocaleString('es-CL'); }

        function renderResult(data, locName) {
          const res = document.getElementById('result');

          if (!data.success) {
            res.innerHTML = '<div class="msg-error">Error: ' + data.error + '</div>';
            return;
          }

          document.getElementById('btnDownload').style.display = 'inline-flex';

          const rangeLabel = data.header.beginDate === data.header.endDate
            ? data.header.beginDate
            : data.header.beginDate + ' → ' + data.header.endDate;

          // Stats
          let html = '<div class="stats-grid">';
          html += statCard('Restaurante', locName, 'gray', true);
          html += statCard('Período', rangeLabel, 'blue', true);
          html += statCard('Productos', (data.items || []).length, 'gray');
          html += statCard('Total sin IVA', fmt(data.header.totalRevenueExclTax), 'green', true);
          html += statCard('Total con IVA', fmt(data.header.totalRevenueInclTax), 'red', true);
          html += '</div>';

          // Resumen por categoría
          if (data.resumen && data.resumen.length > 0) {
            html += '<div class="table-card" style="margin-bottom:20px;">';
            html += '<div class="table-card-header"><h3>Resumen por Categoría</h3><span class="badge">' + data.resumen.length + ' categorías</span></div>';
            html += '<div class="table-wrap"><table>';
            html += '<thead><tr><th>Categoría</th><th style="text-align:right">Unidades</th><th style="text-align:right">Total con IVA</th></tr></thead><tbody>';
            data.resumen.forEach(r => {
              html += '<tr>';
              html += '<td class="cat"><span>' + r.categoria + '</span></td>';
              html += '<td class="num">' + r.cantidad.toLocaleString('es-CL') + '</td>';
              html += '<td class="num">' + fmt(r.total) + '</td>';
              html += '</tr>';
            });
            html += '</tbody></table></div></div>';
          }

          // Detalle por producto
          if (data.items && data.items.length > 0) {
            html += '<div class="table-card">';
            html += '<div class="table-card-header"><h3>Detalle por Producto</h3><span class="badge">' + data.items.length + ' ítems</span></div>';
            html += '<div class="table-wrap"><table>';
            html += '<thead><tr><th>Producto</th><th>Código</th><th style="text-align:right">Precio Unit.</th><th style="text-align:right">Cantidad</th><th style="text-align:right">Venta sin IVA</th><th style="text-align:right">Venta con IVA</th><th>Categoría</th></tr></thead><tbody>';
            data.items.forEach(item => {
              html += '<tr>';
              html += '<td><strong>' + item.producto + '</strong></td>';
              html += '<td style="color:var(--gray-500);font-size:12px">' + (item.codigo || '—') + '</td>';
              html += '<td class="num">' + fmt(item.precioUnitario || 0) + '</td>';
              html += '<td class="num">' + item.cantidad + '</td>';
              html += '<td class="num">' + fmt(item.ventaSinImpuesto || 0) + '</td>';
              html += '<td class="num" style="font-weight:600">' + fmt(item.ventaConImpuesto || 0) + '</td>';
              html += '<td class="cat"><span>' + item.categoria + '</span></td>';
              html += '</tr>';
            });
            html += '</tbody></table></div></div>';
          } else {
            html += '<div class="table-card"><div class="msg-empty">No se encontraron ventas para este rango.</div></div>';
          }

          res.innerHTML = html;
        }

        function statCard(label, value, color, small) {
          return '<div class="stat-card ' + color + '">'
            + '<div class="stat-label">' + label + '</div>'
            + '<div class="stat-value' + (small ? ' small' : '') + '">' + value + '</div>'
            + '</div>';
        }

        async function downloadExcel() {
          if (!lastStart || !lastEnd) return;
          try {
            const r = await fetch('/api/export/download-range?start=' + lastStart + '&end=' + lastEnd + '&loc=' + lastLoc);
            if (!r.ok) throw new Error('Error generando Excel');
            const blob = await r.blob();
            const link = document.createElement('a');
            link.href = URL.createObjectURL(blob);
            link.download = 'ventas_domani_' + lastStart + '_a_' + lastEnd + '.xlsx';
            link.click();
          } catch(e) {
            alert('Error: ' + e.message);
          }
        }
      </script>
    </body>
    </html>
  `);
});

// Endpoint para obtener ventas desde API Toteat — soporta parámetro loc
app.get('/api/toteat/ventas', async (req, res) => {
  try {
    const { start, end, date, loc } = req.query;
    const startDate = start || date || new Date().toISOString().split('T')[0];
    const endDate = end || startDate;

    const { service: toteatService, location } = getToteatForLocation(loc);
    logger.info(`[${location ? location.name : 'LOC1'}] Ventas: ${startDate} a ${endDate}`);

    const result = await toteatService.getSales(startDate, endDate);

    if (!result.success) {
      return res.status(400).json({ success: false, error: result.message });
    }

    const items = toteatService.parseSalesToProducts(result.data);
    const totalSinImpuesto = items.reduce((sum, p) => sum + (p.ventaSinImpuesto || 0), 0);
    const totalConImpuesto = items.reduce((sum, p) => sum + (p.ventaConImpuesto || 0), 0);

    const porCategoria = {};
    items.forEach(p => {
      if (!porCategoria[p.categoria]) porCategoria[p.categoria] = { cantidad: 0, total: 0 };
      porCategoria[p.categoria].cantidad += p.cantidad;
      porCategoria[p.categoria].total += p.ventaConImpuesto;
    });

    const resumen = Object.entries(porCategoria)
      .map(([categoria, data]) => ({ categoria, ...data }))
      .sort((a, b) => b.total - a.total);

    res.json({
      success: true,
      header: {
        locationName: location ? location.name : 'Domani',
        beginDate: startDate,
        endDate: endDate,
        totalRevenueExclTax: totalSinImpuesto,
        totalRevenueInclTax: totalConImpuesto
      },
      resumen,
      items,
      hasData: items.length > 0,
      mensaje: items.length > 0
        ? `Total: $${totalConImpuesto.toLocaleString('es-CL')} (${items.length} productos en ${result.data.length} órdenes)`
        : 'No se encontraron ventas para este rango.'
    });

  } catch (error) {
    logger.error('Error obteniendo ventas de Toteat:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

// Test conexion Toteat — soporta parámetro loc
app.get('/api/toteat/test', async (req, res) => {
  try {
    const { service: toteatService } = getToteatForLocation(req.query.loc);
    const result = await toteatService.testConnection();
    res.json(result);
  } catch (error) {
    res.status(500).json({ connected: false, error: error.message });
  }
});

// Diagnostico Toteat
app.get('/api/toteat/diagnose', async (req, res) => {
  try {
    const { date, loc } = req.query;
    const targetDate = date || new Date().toISOString().split('T')[0];
    const { service: toteatService } = getToteatForLocation(loc);
    const results = await toteatService.diagnoseEndpoints(targetDate);
    res.json({ success: true, date: targetDate, endpoints: results });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// Endpoint para exportar ventas a Excel (manual)
app.get('/api/export', async (req, res) => {
  try {
    const { date } = req.query;
    let targetDate = date;
    if (!targetDate) {
      const yesterday = new Date();
      yesterday.setDate(yesterday.getDate() - 1);
      targetDate = yesterday.toISOString().split('T')[0];
    }
    logger.info(`Exportación manual solicitada para: ${targetDate}`);
    const result = await schedulerService.runManualExport(targetDate);
    if (!result.success) return res.status(400).json({ success: false, error: result.error });
    res.json({ success: true, mensaje: 'Excel generado exitosamente', archivo: result.filePath, productos: result.productos, ordenes: result.ordenes, total: result.total });
  } catch (error) {
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

// MarketMan: obtener cuentas autorizadas
app.get('/api/marketman/accounts', async (req, res) => {
  try {
    const accounts = await marketmanService.getAuthorisedAccounts();
    const tokenDetails = await marketmanService.getTokenDetails();
    res.json({ accounts, tokenDetails });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// Trigger de exportación manual
app.get('/api/export/trigger', async (req, res) => {
  try {
    const { date } = req.query;
    logger.info(`Ejecutando exportación manual trigger${date ? ` para fecha: ${date}` : ''}`);
    const result = await schedulerService.runManualExport(date || null);
    res.json(result);
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// Descargar Excel (fecha simple)
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
    if (!result.success) return res.status(400).json({ success: false, error: result.error });
    res.download(result.filePath);
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// Descargar Excel de rango de fechas — soporta parámetro loc
app.get('/api/export/download-range', async (req, res) => {
  try {
    const { start, end, loc } = req.query;
    if (!start || !end) return res.status(400).json({ success: false, error: 'Se requieren parametros start y end' });
    logger.info(`Descargando Excel rango: ${start} a ${end}`);
    const result = await schedulerService.runRangeExport(start, end, loc);
    if (!result.success) return res.status(400).json({ success: false, error: result.error });
    res.download(result.filePath);
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// Health check
app.get('/health', (req, res) => {
  res.json({ status: 'ok', service: 'Domani Ventas API', timestamp: new Date().toISOString() });
});

// Iniciar servidor
const PORT = config.server.port;

app.listen(PORT, () => {
  logger.info(`Servidor iniciado en puerto ${PORT}`);
  logger.info(`Ambiente: ${config.server.env}`);
  logger.info('Domani Ventas API listo');
  logger.info(`Accede a http://localhost:${PORT}/panel`);

  schedulerService.start();
  logger.info('Exportacion automatica programada: 8:00 AM Chile');

  marketmanService.validateBuyerGuid().catch(err => {
    logger.error(`MarketMan: error en validacion inicial: ${err.message}`);
  });
});

process.on('unhandledRejection', (reason, promise) => {
  logger.error('Unhandled Rejection:', { reason, promise });
});

process.on('uncaughtException', (error) => {
  logger.error('Uncaught Exception:', error);
  process.exit(1);
});

module.exports = app;

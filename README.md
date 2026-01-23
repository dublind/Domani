# Domani API - Integración Toteat → Marketman

Sistema automático de sincronización de ventas desde Toteat a Marketman para el restaurante Domani en Santiago, Chile.

## 🚀 Características

- ✅ Descarga automática de ventas desde Toteat API
- ✅ Agrupación de ventas por producto (ganancias del día)
- ✅ Sincronización automática con Marketman
- ✅ Soporte para carga manual de archivos CSV
- ✅ Mapeo de productos Toteat → Marketman
- ✅ Estadísticas de ventas en tiempo real
- ✅ Exportación de reportes a CSV
- ✅ Tareas programadas (cron jobs)

## 📋 Requisitos

- Node.js 14 o superior
- Token de API de Toteat con permisos activados
- Credenciales de API de Marketman

## 🔧 Instalación

```bash
# Clonar el repositorio
git clone <repo-url>
cd Domani_api

# Instalar dependencias
npm install

# Configurar variables de entorno
cp .env.example .env
# Edita .env con tus credenciales
```

## ⚙️ Configuración

Edita el archivo `.env` con tus credenciales:

```env
# Toteat API
TOTEAT_API_KEY=tu_token_de_toteat
TOTEAT_LOCAL_ID=1

# Marketman API
MARKETMAN_API_KEY=tu_api_key_marketman
MARKETMAN_LOCATION_ID=tu_location_id

# Servidor
PORT=3000
NODE_ENV=development

# Cron (sincronización automática diaria a las 6 AM)
CRON_SCHEDULE=0 6 * * *
```

## 🚀 Uso

### Iniciar el servidor

```bash
npm run dev
```

El servidor estará disponible en: http://localhost:3000

### Sincronización automática

```bash
# Sincronizar ventas de ayer
node sync-auto-toteat.js

# Sincronizar fecha específica
node sync-auto-toteat.js 2026-01-20

# Solo ver estadísticas (sin sincronizar)
node sync-auto-toteat.js --stats

# Solo descargar CSV (sin sincronizar)
node sync-auto-toteat.js --download
```

## 📡 Endpoints API

### Toteat API Endpoints

#### Verificar conexión con Toteat
```
GET /api/toteat/connection
```

#### Obtener ventas por producto
```
GET /api/toteat/sales/products?date=2026-01-20
```
Si no se especifica fecha, retorna ventas de ayer.

#### Obtener estadísticas de ventas
```
GET /api/toteat/sales/stats?date=2026-01-20
```
Retorna: total de productos, cantidades, ventas, descuentos, costos, ganancias, margen, top productos.

#### Descargar CSV de ventas
```
GET /api/toteat/sales/csv?date=2026-01-20
```
Descarga archivo CSV con ventas agrupadas por producto.

#### Sincronizar ventas a Marketman
```
POST /api/toteat/sync
Content-Type: application/json

{
  "date": "2026-01-20"  // Opcional, por defecto usa ayer
}
```

### Endpoints CSV (método alternativo)

#### Subir CSV de Toteat
```bash
POST /api/csv/upload
Content-Type: multipart/form-data

file: archivo.csv
autoSync: true
```

### Endpoints de Sistema

#### Estado del sistema
```
GET /api/status
```

#### Ver historial de sincronizaciones
```
GET /api/sync/history?limit=10
```

#### Ver productos sin mapeo
```
GET /api/mapping/unmapped
```

#### Estadísticas de mapeo
```
GET /api/mapping/stats
```

#### Recargar mapeo de productos
```
POST /api/mapping/reload
```

## 📊 Ejemplo de Respuesta

### GET /api/toteat/sales/stats

```json
{
  "success": true,
  "stats": {
    "date": "2026-01-20",
    "location": "Domani",
    "totalProducts": 45,
    "totalQuantity": 234,
    "totalSales": 1250000,
    "totalDiscounts": 50000,
    "netSales": 1200000,
    "totalCost": 400000,
    "profit": 800000,
    "profitMargin": "66.67%",
    "topProducts": [
      {
        "id": "1190",
        "name": "MARGHERITA",
        "quantity": 18,
        "totalSales": 142300,
        "discounts": -64900
      }
    ]
  }
}
```

## 🗂️ Estructura del Proyecto

```
Domani_api/
├── src/
│   ├── index.js                          # Servidor Express y endpoints
│   ├── config/
│   │   ├── config.js                     # Configuración general
│   │   └── product-mapping.json         # Mapeo Toteat → Marketman
│   ├── services/
│   │   ├── toteat.service.js            # Cliente API Toteat
│   │   ├── toteat-transformer.service.js # Transformación de datos
│   │   ├── marketman.service.js         # Cliente API Marketman
│   │   ├── sync.service.js              # Lógica de sincronización
│   │   ├── mapping.service.js           # Mapeo de productos
│   │   ├── csv-parser.service.js        # Parser de CSV
│   │   └── file-upload.service.js       # Manejo de archivos
│   └── utils/
│       ├── logger.js                     # Sistema de logs
│       ├── transformer.js                # Transformaciones
│       └── validator.js                  # Validaciones
├── sync-auto-toteat.js                   # Script de sincronización
├── .env.example                          # Variables de entorno ejemplo
├── package.json                          # Dependencias
└── README.md                             # Este archivo
```

## 📝 Mapeo de Productos

Edita `src/config/product-mapping.json` para mapear productos de Toteat a Marketman:

```json
{
  "1190": {
    "marketmanId": "MM-001",
    "marketmanName": "Pizza Margherita",
    "category": "Pizzas"
  }
}
```

## 🔄 Sincronización Automática

El sistema ejecuta sincronizaciones automáticas según el `CRON_SCHEDULE` configurado en `.env`.

Por defecto: Todos los días a las 6:00 AM.

## 🐛 Troubleshooting

### Error: "Token sin permisos de API"

Tu token de Toteat no tiene permisos activados. Contacta a `soporte@toteat.com`:

```
Asunto: Activar Permisos de API para Token

Hola equipo de Toteat,

Necesito activar permisos de API para mi token:
- Token: [tu_token]
- Local ID: [tu_local_id]
- Endpoint: https://toteatdev.appspot.com/mw/or/1.0/sales

Actualmente recibo error "Not Authorized".

Gracias.
```

### El servidor no inicia

```bash
# Verificar que el puerto 3000 esté disponible
# O cambiar PORT en .env

# Verificar que las dependencias estén instaladas
npm install
```

### Productos sin mapear

Ver productos sin mapeo:
```
GET /api/mapping/unmapped
```

Agregar mapeos en `src/config/product-mapping.json`.

## 📧 Soporte

- **Toteat API**: soporte@toteat.com
- **Marketman API**: support@marketman.com

## 📄 Licencia

Propietario: Restaurante Domani, Santiago de Chile

---

**Desarrollado para automatizar la gestión de inventario del restaurante Domani** 🍕

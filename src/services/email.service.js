const nodemailer = require('nodemailer');
const logger = require('../utils/logger');

// Configuración de email desde variables de entorno
const EMAIL_CONFIG = {
  host: process.env.SMTP_HOST || 'smtp.gmail.com',
  port: parseInt(process.env.SMTP_PORT) || 587,
  secure: process.env.SMTP_SECURE === 'true',
  user: process.env.SMTP_USER || '',
  password: process.env.SMTP_PASSWORD || '',
  from: process.env.EMAIL_FROM || 'Domani Ventas <noreply@domani.cl>',
  to: process.env.EMAIL_TO || ''
};

class EmailService {
  constructor() {
    this.transporter = null;
    this.initTransporter();
  }

  /**
   * Inicializa el transporter de nodemailer
   */
  initTransporter() {
    if (!EMAIL_CONFIG.user || !EMAIL_CONFIG.password) {
      logger.warn('Email no configurado: falta SMTP_USER o SMTP_PASSWORD');
      return;
    }

    this.transporter = nodemailer.createTransport({
      host: EMAIL_CONFIG.host,
      port: EMAIL_CONFIG.port,
      secure: EMAIL_CONFIG.secure,
      auth: {
        user: EMAIL_CONFIG.user,
        pass: EMAIL_CONFIG.password
      }
    });

    logger.info('Servicio de email inicializado');
  }

  /**
   * Envía el Excel de ventas por email
   * @param {string} filePath - Ruta al archivo Excel
   * @param {string} dateStr - Fecha de las ventas (YYYY-MM-DD)
   * @param {Object} stats - Estadísticas de la exportación
   */
  async sendSalesReport(filePath, dateStr, stats = {}) {
    if (!this.transporter) {
      logger.error('No se puede enviar email: transporter no configurado');
      return { success: false, error: 'Email no configurado' };
    }

    if (!EMAIL_CONFIG.to) {
      logger.error('No se puede enviar email: falta EMAIL_TO');
      return { success: false, error: 'Destinatario no configurado' };
    }

    const [year, month, day] = dateStr.split('-');
    const formattedDate = `${day}/${month}/${year}`;
    const fileName = `ventas_domani_${dateStr}.xlsx`;

    try {
      const mailOptions = {
        from: EMAIL_CONFIG.from,
        to: EMAIL_CONFIG.to,
        subject: `📊 Ventas Domani - ${formattedDate}`,
        html: `
          <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
            <h2 style="color: #333;">Reporte de Ventas - Domani Providencia</h2>
            <p>Adjunto encontrarás el reporte de ventas del <strong>${formattedDate}</strong>.</p>

            <div style="background: #f5f5f5; padding: 15px; border-radius: 8px; margin: 20px 0;">
              <h3 style="margin-top: 0; color: #555;">Resumen:</h3>
              <ul style="list-style: none; padding: 0;">
                <li>📦 <strong>Productos vendidos:</strong> ${stats.productos || 'N/A'}</li>
                <li>🧾 <strong>Órdenes procesadas:</strong> ${stats.ordenes || 'N/A'}</li>
                <li>💰 <strong>Total con impuesto:</strong> $${(stats.total || 0).toLocaleString('es-CL')}</li>
              </ul>
            </div>

            <p style="color: #666; font-size: 12px;">
              Este es un correo automático generado por el sistema de ventas de Domani.<br>
              El archivo está en formato compatible con Marketman.
            </p>
          </div>
        `,
        attachments: [
          {
            filename: fileName,
            path: filePath
          }
        ]
      };

      const info = await this.transporter.sendMail(mailOptions);
      logger.info(`Email enviado exitosamente: ${info.messageId}`);

      return {
        success: true,
        messageId: info.messageId
      };

    } catch (error) {
      logger.error('Error enviando email:', error.message);
      return {
        success: false,
        error: error.message
      };
    }
  }

  /**
   * Prueba la conexión de email
   */
  async testConnection() {
    if (!this.transporter) {
      return { success: false, error: 'Transporter no configurado' };
    }

    try {
      await this.transporter.verify();
      return { success: true, message: 'Conexión SMTP verificada' };
    } catch (error) {
      return { success: false, error: error.message };
    }
  }
}

module.exports = new EmailService();

const nodemailer = require('nodemailer');
const logger = require('../utils/logger');

class EmailService {
  constructor() {
    this.transporter = null;
  }

  /**
   * Obtiene la configuración de email desde variables de entorno
   */
  getConfig() {
    return {
      host: process.env.SMTP_HOST || 'smtp.gmail.com',
      port: parseInt(process.env.SMTP_PORT) || 587,
      secure: process.env.SMTP_SECURE === 'true',
      user: process.env.SMTP_USER || '',
      password: process.env.SMTP_PASSWORD || '',
      from: process.env.EMAIL_FROM || process.env.SMTP_USER || '',
      to: process.env.EMAIL_TO || ''
    };
  }

  /**
   * Crea o recrea el transporter con la configuración actual
   */
  createTransporter() {
    const config = this.getConfig();

    if (!config.user || !config.password) {
      logger.warn(`Email no configurado: SMTP_USER=${config.user ? 'set' : 'empty'}, SMTP_PASSWORD=${config.password ? 'set' : 'empty'}`);
      return null;
    }

    return nodemailer.createTransport({
      host: config.host,
      port: config.port,
      secure: config.secure,
      auth: {
        user: config.user,
        pass: config.password
      }
    });
  }

  /**
   * Envía el Excel de ventas por email
   */
  async sendSalesReport(filePath, dateStr, stats = {}) {
    const config = this.getConfig();
    const transporter = this.createTransporter();

    if (!transporter) {
      logger.error('No se puede enviar email: transporter no configurado');
      return { success: false, error: 'Email no configurado' };
    }

    if (!config.to) {
      logger.error('No se puede enviar email: falta EMAIL_TO');
      return { success: false, error: 'Destinatario no configurado' };
    }

    const [year, month, day] = dateStr.split('-');
    const formattedDate = `${day}/${month}/${year}`;
    const fileName = `ventas_domani_${dateStr}.xlsx`;

    try {
      const mailOptions = {
        from: config.from,
        to: config.to,
        subject: `Ventas Domani - ${formattedDate}`,
        html: `
          <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
            <h2 style="color: #333;">Reporte de Ventas - Domani Providencia</h2>
            <p>Adjunto encontrarás el reporte de ventas del <strong>${formattedDate}</strong>.</p>

            <div style="background: #f5f5f5; padding: 15px; border-radius: 8px; margin: 20px 0;">
              <h3 style="margin-top: 0; color: #555;">Resumen:</h3>
              <ul style="list-style: none; padding: 0;">
                <li><strong>Productos vendidos:</strong> ${stats.productos || 'N/A'}</li>
                <li><strong>Ordenes procesadas:</strong> ${stats.ordenes || 'N/A'}</li>
                <li><strong>Total con impuesto:</strong> $${(stats.total || 0).toLocaleString('es-CL')}</li>
              </ul>
            </div>

            <p style="color: #666; font-size: 12px;">
              Este es un correo automatico generado por el sistema de ventas de Domani.<br>
              El archivo esta en formato compatible con Marketman.
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

      const info = await transporter.sendMail(mailOptions);
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
    const config = this.getConfig();
    const transporter = this.createTransporter();

    if (!transporter) {
      return {
        success: false,
        error: 'Transporter no configurado',
        debug: {
          smtp_user_set: !!config.user,
          smtp_password_set: !!config.password,
          smtp_host: config.host,
          smtp_port: config.port
        }
      };
    }

    try {
      await transporter.verify();
      return { success: true, message: 'Conexión SMTP verificada' };
    } catch (error) {
      return { success: false, error: error.message };
    }
  }
}

module.exports = new EmailService();

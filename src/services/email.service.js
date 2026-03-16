const nodemailer = require('nodemailer');
const logger = require('../utils/logger');

class EmailService {

  createTransport() {
    const host = process.env.SMTP_HOST;
    const user = process.env.SMTP_USER;
    const pass = process.env.SMTP_PASSWORD;

    if (!host || !user || !pass) {
      logger.warn('Email no configurado: falta SMTP_HOST, SMTP_USER o SMTP_PASSWORD');
      return null;
    }

    return nodemailer.createTransport({
      host,
      port: parseInt(process.env.SMTP_PORT || '587'),
      secure: process.env.SMTP_SECURE === 'true',
      auth: { user, pass }
    });
  }

  async sendSalesReport(filePath, dateStr, stats = {}) {
    const transporter = this.createTransport();

    if (!transporter) {
      logger.error('No se puede enviar email: SMTP no configurado');
      return { success: false, error: 'Email no configurado' };
    }

    const to = process.env.EMAIL_TO;
    if (!to) {
      logger.error('No se puede enviar email: falta EMAIL_TO');
      return { success: false, error: 'Destinatario no configurado' };
    }

    const [year, month, day] = dateStr.split('-');
    const formattedDate = `${day}/${month}/${year}`;
    const fileName = `ventas_domani_${dateStr}.xlsx`;

    try {
      await transporter.sendMail({
        from: process.env.EMAIL_FROM || process.env.SMTP_USER,
        to: to.split(',').map(e => e.trim()),
        subject: `Ventas Domani - ${formattedDate}`,
        html: `
          <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
            <h2 style="color: #333;">Reporte de Ventas - Domani Providencia</h2>
            <p>Adjunto encontraras el reporte de ventas del <strong>${formattedDate}</strong>.</p>
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
        attachments: [{ filename: fileName, path: filePath }]
      });

      logger.info('Email enviado exitosamente');
      return { success: true };

    } catch (error) {
      logger.error('Error enviando email:', error.message);
      return { success: false, error: error.message };
    }
  }

  async testConnection() {
    const transporter = this.createTransport();

    if (!transporter) {
      return { success: false, error: 'SMTP no configurado' };
    }

    try {
      await transporter.verify();
      return { success: true, message: 'Conexion SMTP verificada correctamente' };
    } catch (error) {
      return { success: false, error: error.message };
    }
  }
}

module.exports = new EmailService();

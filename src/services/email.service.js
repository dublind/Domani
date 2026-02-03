const { Resend } = require('resend');
const fs = require('fs');
const logger = require('../utils/logger');

class EmailService {
  constructor() {
    this.resend = null;
  }

  /**
   * Obtiene la configuración de email desde variables de entorno
   */
  getConfig() {
    return {
      apiKey: process.env.RESEND_API_KEY || '',
      from: process.env.EMAIL_FROM || 'Domani Ventas <onboarding@resend.dev>',
      to: process.env.EMAIL_TO || ''
    };
  }

  /**
   * Crea el cliente de Resend
   */
  createClient() {
    const config = this.getConfig();

    if (!config.apiKey) {
      logger.warn('Email no configurado: falta RESEND_API_KEY');
      return null;
    }

    return new Resend(config.apiKey);
  }

  /**
   * Envía el Excel de ventas por email
   */
  async sendSalesReport(filePath, dateStr, stats = {}) {
    const config = this.getConfig();
    const resend = this.createClient();

    if (!resend) {
      logger.error('No se puede enviar email: Resend no configurado');
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
      // Leer el archivo y convertir a base64
      const fileBuffer = fs.readFileSync(filePath);
      const fileBase64 = fileBuffer.toString('base64');

      // Separar destinatarios
      const recipients = config.to.split(',').map(e => e.trim());

      const { data, error } = await resend.emails.send({
        from: config.from,
        to: recipients,
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
        attachments: [
          {
            filename: fileName,
            content: fileBase64
          }
        ]
      });

      if (error) {
        logger.error('Error enviando email:', error.message);
        return { success: false, error: error.message };
      }

      logger.info(`Email enviado exitosamente: ${data.id}`);
      return { success: true, messageId: data.id };

    } catch (error) {
      logger.error('Error enviando email:', error.message);
      return { success: false, error: error.message };
    }
  }

  /**
   * Prueba la conexión de email
   */
  async testConnection() {
    const config = this.getConfig();
    const resend = this.createClient();

    if (!resend) {
      return {
        success: false,
        error: 'Resend no configurado',
        debug: {
          api_key_set: !!config.apiKey,
          email_to: config.to
        }
      };
    }

    try {
      // Enviar email de prueba
      const recipients = config.to ? config.to.split(',').map(e => e.trim()) : ['isalinasg06@gmail.com'];

      const { data, error } = await resend.emails.send({
        from: config.from,
        to: recipients,
        subject: 'Test - Domani Ventas',
        html: '<p>Conexion de email verificada correctamente.</p>'
      });

      if (error) {
        return { success: false, error: error.message };
      }

      return { success: true, message: 'Email de prueba enviado', messageId: data.id };
    } catch (error) {
      return { success: false, error: error.message };
    }
  }
}

module.exports = new EmailService();

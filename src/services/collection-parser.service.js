const logger = require('../utils/logger');

/**
 * Servicio para procesar datos de cajas/collection de Toteat
 * Transforma la estructura de turnos, cajas y métodos de pago
 */
class CollectionParserService {
  /**
   * Parsea los datos de collection de Toteat
   * @param {Object} collectionData - Datos de collection desde Toteat
   * @param {String} date - Fecha del reporte
   * @returns {Object} - Datos procesados y estructurados
   */
  parseCollection(collectionData, date) {
    try {
      logger.info('Procesando datos de collection de Toteat');

      const result = {
        date: date,
        restaurantId: collectionData.restaurantID,
        localId: collectionData.localID,
        summary: {
          totalShifts: 0,
          totalRegisters: 0,
          totalAmount: 0,
          paymentMethods: []
        },
        shifts: [],
        errors: []
      };

      // Procesar los turnos (shifts)
      const shifts = collectionData.shifts || {};
      
      for (const shiftId in shifts) {
        const shift = shifts[shiftId];
        const shiftData = {
          shiftId: shiftId,
          shiftName: shift.name,
          registers: [],
          totalAmount: 0
        };

        // Procesar los registros/cajas (registers) dentro del turno
        const registers = shift.registers || {};
        
        for (const registerId in registers) {
          const registerArray = registers[registerId];
          
          if (Array.isArray(registerArray)) {
            for (const registerData of registerArray) {
              const register = {
                registerId: registerId,
                registerName: registerData.registerName || registerData.resgisterName, // API tiene typo
                finalAmount: registerData.finalAmount || 0,
                initialAmount: registerData.initialAmount || 0,
                openedDate: registerData.openedDate,
                closedDate: registerData.closedDate,
                paymentMethods: []
              };

              // Procesar métodos de pago
              const paymentMethods = registerData.paymentMethods || [];
              for (const payment of paymentMethods) {
                // Limpiar valores que pueden venir con comas
                const amount = this.parseAmount(payment.amount);
                
                const paymentData = {
                  paymentMethodId: payment.paymentMethodID,
                  paymentMethod: payment.paymentMethod?.trim(),
                  amount: amount
                };

                register.paymentMethods.push(paymentData);
                register.finalAmount += amount;
              }

              shiftData.registers.push(register);
              shiftData.totalAmount += register.finalAmount;
            }
          }
        }

        result.shifts.push(shiftData);
        result.summary.totalShifts++;
        result.summary.totalRegisters += shiftData.registers.length;
        result.summary.totalAmount += shiftData.totalAmount;
      }

      // Consolidar métodos de pago
      const paymentMethodsMap = new Map();
      
      for (const shift of result.shifts) {
        for (const register of shift.registers) {
          for (const payment of register.paymentMethods) {
            const key = `${payment.paymentMethodId}-${payment.paymentMethod}`;
            
            if (paymentMethodsMap.has(key)) {
              const existing = paymentMethodsMap.get(key);
              existing.totalAmount += payment.amount;
            } else {
              paymentMethodsMap.set(key, {
                paymentMethodId: payment.paymentMethodId,
                paymentMethod: payment.paymentMethod,
                totalAmount: payment.amount
              });
            }
          }
        }
      }

      result.summary.paymentMethods = Array.from(paymentMethodsMap.values());

      logger.info(`Collection procesado: ${result.summary.totalShifts} turnos, ${result.summary.totalRegisters} cajas, ${result.summary.paymentMethods.length} métodos de pago`);
      logger.info(`Total: $${result.summary.totalAmount}`);

      return result;

    } catch (error) {
      logger.error('Error procesando collection:', error);
      throw new Error(`Error al procesar collection: ${error.message}`);
    }
  }

  /**
   * Parsea un monto que puede venir con coma decimal o como número
   * @param {string|number} amount - Monto a parsear
   * @returns {number} - Monto parseado
   */
  parseAmount(amount) {
    if (typeof amount === 'number') {
      return amount;
    }

    if (typeof amount === 'string') {
      // Remover comas finales y espacios
      let cleaned = amount.trim().replace(/,+$/, '');
      // Convertir a número
      const parsed = parseFloat(cleaned);
      return isNaN(parsed) ? 0 : parsed;
    }

    return 0;
  }

  /**
   * Genera un resumen simple de cajas y montos
   * @param {Object} parsedCollection - Collection ya procesado
   * @returns {Object} - Resumen simplificado
   */
  generateSummary(parsedCollection) {
    const summary = {
      date: parsedCollection.date,
      restaurantId: parsedCollection.restaurantId,
      totalAmount: parsedCollection.summary.totalAmount,
      totalShifts: parsedCollection.summary.totalShifts,
      totalRegisters: parsedCollection.summary.totalRegisters,
      paymentBreakdown: parsedCollection.summary.paymentMethods.map(pm => ({
        method: pm.paymentMethod,
        amount: pm.totalAmount,
        percentage: (pm.totalAmount / parsedCollection.summary.totalAmount * 100).toFixed(2) + '%'
      }))
    };

    return summary;
  }

  /**
   * Exporta los datos a CSV
   * @param {Object} parsedCollection - Collection ya procesado
   * @returns {string} - CSV string
   */
  exportToCSV(parsedCollection) {
    let csv = 'Fecha,Turno,Caja,Método de Pago,Monto\n';

    for (const shift of parsedCollection.shifts) {
      for (const register of shift.registers) {
        for (const payment of register.paymentMethods) {
          csv += `${parsedCollection.date},${shift.shiftName},"${register.registerName}",${payment.paymentMethod},${payment.amount}\n`;
        }
      }
    }

    return csv;
  }
}

module.exports = new CollectionParserService();

 /**
   * Obtiene el AUTH_TOKEN de MarketMan (lo cachea hasta que expira)
   */
  async getAccessToken() {
    if (this.accessToken && this.tokenExpiry && new Date() < this.tokenExpiry) {
      return this.accessToken;
    }

    const response = await axios.post(`${BASE_URL}/buyers/auth/GetToken`, {
      APIKey: this.apiKey,
      APIPassword: this.apiPassword
    });

    if (!response.data || !response.data.Token) {
      throw new Error(`MarketMan auth fallida: ${JSON.stringify(response.data)}`);
    }

    this.accessToken = response.data.Token;
    this.tokenExpiry = new Date(response.data.ExpireDateUTC);
    logger.info('MarketMan: token obtenido correctamente');
    return this.accessToken;
  }

  /**
   * Sube las ventas del dia a MarketMan via POS API
   * Flujo: Container -> Categorias -> Menu Items -> Checks
   * @param {string} startDate - Fecha inicio YYYY-MM-DD
   * @param {string} endDate - Fecha fin YYYY-MM-DD
   * @param {Array} products - Productos parseados de Toteat
   * @param {Object} totales - { totalSinImpuesto, totalConImpuesto }
   */
  async uploadSales(startDate, endDate, products, totales, buyerGuidOverride = null) {
    const originalBuyerGuid = this.buyerGuid;
    if (buyerGuidOverride) this.buyerGuid = buyerGuidOverride;

    if (!this.apiKey || !this.apiPassword || !this.buyerGuid) {
      this.buyerGuid = originalBuyerGuid;
      logger.warn('MarketMan: credenciales no configuradas, se omite upload');
      return { success: false, error: 'Credenciales de MarketMan no configuradas' };
    }

    try {
      const token = await this.getAccessToken();

      const fromDateUTC = `${startDate.replace(/-/g, '/')} 00:00:00`;
      const toDateUTC = `${startDate.replace(/-/g, '/')} 23:59:59`;
      const containerID = startDate.replace(/-/g, '');

      // Sanitizar productos antes de enviarlos

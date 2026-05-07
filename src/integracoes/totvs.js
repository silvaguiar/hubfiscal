const axios = require('axios');
const qs = require('qs');

class TotvsClient {
  constructor(config) {
    let baseUrl = config.totvs_base_url || '';
    baseUrl = baseUrl.replace(/\/+$/, ''); 
    baseUrl = baseUrl.replace(/\/api\/totvsmoda.*$/, ''); 
    
    this.baseUrl = baseUrl;
    this.user = config.totvs_user;
    this.password = config.totvs_password;
    this.clientId = config.totvs_client_id;
    this.clientSecret = config.totvs_client_secret;
    this.branch = config.totvs_branch;
    this.grantType = config.totvs_grant_type || 'password';
    this.accessToken = config.totvs_token;
  }

  async obterToken() {
    if (!this.baseUrl) throw new Error('Base URL TOTVS não configurada.');
    const url = `${this.baseUrl}/api/totvsmoda/authorization/v2/token`;
    
    const payload = {
      Grant_type: this.grantType,
      Client_id: this.clientId,
      Client_secret: this.clientSecret,
      Username: this.user,
      Password: this.password,
      Branch: this.branch
    };

    try {
      console.log(`🔑 Solicitando token TOTVS: ${url}`);
      const response = await axios.post(url, qs.stringify(payload), {
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        timeout: 15000 
      });

      if (response.data && response.data.access_token) {
        this.accessToken = response.data.access_token;
        return this.accessToken;
      }
      throw new Error('Resposta da TOTVS não contém access_token');
    } catch (err) {
      const errorMsg = err.response?.data?.message || err.response?.data || err.message;
      console.error('Erro ao obter token TOTVS:', errorMsg);
      throw new Error(`Erro de Autenticação TOTVS: ${errorMsg}`);
    }
  }

  async _getHeaders() {
    if (!this.accessToken) await this.obterToken();
    return {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${this.accessToken}`
    };
  }

  async buscarInvoices(filtros) {
    const url = `${this.baseUrl}/api/totvsmoda/fiscal/v2/invoices/search`;
    let allInvoices = [];
    let currentPage = 1;
    let hasMore = true;
    const pageSize = 100;

    console.log(`🚀 Iniciando varredura via API (Padrão Postman): ${filtros.startDate} a ${filtros.endDate}`);

    while (hasMore) {
      // Seguindo exatamente a estrutura JSON que funciona no Postman do usuário
      const payload = {
        filter: {
          change: {
            startDate: filtros.startDate,
            endDate: filtros.endDate
          },
          branchCodeList: this.branch ? [parseInt(this.branch)] : [],
          invoiceStatusList: ["E"],
          eletronicInvoiceStatusList: ["A"],
          origin: 1
        },
        page: currentPage,
        pageSize: pageSize
      };

      try {
        const headers = await this._getHeaders();
        const response = await axios.post(url, payload, { headers, timeout: 30000 });
        const data = response.data;
        
        const pageItems = data.items || data.data || [];
        allInvoices = allInvoices.concat(pageItems);

        console.log(`   📄 Página ${currentPage}: ${pageItems.length} notas encontradas.`);

        if (data.hasNext || (pageItems.length === pageSize && pageItems.length > 0)) {
          currentPage++;
        } else {
          hasMore = false;
        }
        if (currentPage > 500) hasMore = false;

      } catch (err) {
        if (err.response?.status === 401) {
          console.log('🔄 Token expirado, renovando...');
          await this.obterToken();
          continue; 
        }
        const errorDetail = err.response?.data?.message || err.response?.data || err.message;
        throw new Error(`Erro na consulta TOTVS: ${JSON.stringify(errorDetail)}`);
      }
    }

    return { data: allInvoices };
  }

  async exportarXml(chave) {
    const url = `${this.baseUrl}/api/totvsmoda/fiscal/v2/xml-contents/${chave}`;
    try {
      const headers = await this._getHeaders();
      const response = await axios.get(url, { headers, timeout: 20000 });
      
      if (response.data && response.data.mainInvoiceXml) {
        // A TOTVS retorna o XML em Base64. Precisamos decodificar.
        const base64Content = response.data.mainInvoiceXml;
        const xmlTexto = Buffer.from(base64Content, 'base64').toString('utf8');
        return xmlTexto;
      }
      return null;
    } catch (err) {
      if (err.response?.status === 401) {
        await this.obterToken();
        const headers = await this._getHeaders();
        const retryResponse = await axios.get(url, { headers });
        if (retryResponse.data?.mainInvoiceXml) {
          return Buffer.from(retryResponse.data.mainInvoiceXml, 'base64').toString('utf8');
        }
      }
      return null;
    }
  }
}

module.exports = TotvsClient;

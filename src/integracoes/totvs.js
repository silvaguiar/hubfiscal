const axios = require('axios');
const qs = require('qs');

// Cache global de token TOTVS em memória
const totvsTokenCache = {};

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
    // Inicializa o cache com os valores do banco se ainda não existir
    if (!totvsTokenCache[this.clientId]) {
      totvsTokenCache[this.clientId] = {
        token: config.totvs_token || null,
        expiry: config.totvs_token_expiry ? parseInt(config.totvs_token_expiry) : null
      };
    } else {
      if (config.totvs_token && (!totvsTokenCache[this.clientId].expiry || parseInt(config.totvs_token_expiry) > totvsTokenCache[this.clientId].expiry)) {
        totvsTokenCache[this.clientId].token = config.totvs_token;
        totvsTokenCache[this.clientId].expiry = parseInt(config.totvs_token_expiry);
      }
    }
    this.onTokenUpdated = config.onTokenUpdated || null;
  }

  get accessToken() {
    return totvsTokenCache[this.clientId] ? totvsTokenCache[this.clientId].token : null;
  }

  set accessToken(val) {
    if (!totvsTokenCache[this.clientId]) totvsTokenCache[this.clientId] = {};
    totvsTokenCache[this.clientId].token = val;
  }

  get tokenExpiry() {
    return totvsTokenCache[this.clientId] ? totvsTokenCache[this.clientId].expiry : null;
  }

  set tokenExpiry(val) {
    if (!totvsTokenCache[this.clientId]) totvsTokenCache[this.clientId] = {};
    totvsTokenCache[this.clientId].expiry = val;
  }

  async obterToken() {
    if (!this.baseUrl) throw new Error('Base URL TOTVS não configurada.');

    // Se o token existe e não expirou, reutiliza para evitar requisições de autenticação redundantes
    if (this.accessToken && this.tokenExpiry && Date.now() < this.tokenExpiry) {
      return this.accessToken;
    }

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
        
        // TOTVS Moda token expira em 24h, usamos 23h como margem de segurança (82800s)
        const expiresIn = response.data.expires_in || 82800;
        this.tokenExpiry = Date.now() + (expiresIn - 60) * 1000;

        if (this.onTokenUpdated) {
          this.onTokenUpdated(this.accessToken, String(this.tokenExpiry)).catch(err => {
            console.error('Erro ao persistir token da TOTVS:', err.message);
          });
        }

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
    let allInvoices = [];
    let currentPage = 1;
    let hasMore = true;
    const pageSize = 100;

    console.log(`🚀 Iniciando varredura via API (Padrão Postman): ${filtros.startDate} a ${filtros.endDate}`);

    while (hasMore) {
      const result = await this.buscarInvoicesPage(filtros, currentPage, pageSize);
      allInvoices = allInvoices.concat(result.data);
      console.log(`   📄 Página ${currentPage}: ${result.data.length} notas encontradas.`);

      if (result.hasNext && currentPage < 500) {
        currentPage++;
      } else {
        hasMore = false;
      }
    }

    return { data: allInvoices };
  }

  async buscarInvoicesPage(filtros, page = 1, pageSize = 20) {
    const url = `${this.baseUrl}/api/totvsmoda/fiscal/v2/invoices/search`;

    const filter = {
      change: {
        startDate: filtros.startDate,
        endDate: filtros.endDate
      },
      invoiceStatusList: ["E"],
      eletronicInvoiceStatusList: ["A", "C", "D"],
      origin: 1
    };

    // Só envia branchCodeList se estiver configurado — array vazio retorna 0 resultados no TOTVS
    if (this.branch) {
      filter.branchCodeList = [parseInt(this.branch)];
    }

    const payload = { filter, page, pageSize };

    console.log(`📤 TOTVS payload (pág ${page}):`, JSON.stringify(payload));

    try {
      const headers = await this._getHeaders();
      const response = await axios.post(url, payload, { headers, timeout: 30000 });
      const data = response.data;
      const pageItems = data.items || data.data || [];
      const hasNext = data.hasNext || (pageItems.length === pageSize && pageItems.length > 0);
      return { data: pageItems, hasNext };
    } catch (err) {
      if (err.response?.status === 401) {
        console.log('🔄 Token expirado, renovando...');
        await this.obterToken();
        return this.buscarInvoicesPage(filtros, page, pageSize);
      }
      const errorDetail = err.response?.data?.message || err.response?.data || err.message;
      throw new Error(`Erro na consulta TOTVS: ${JSON.stringify(errorDetail)}`);
    }
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

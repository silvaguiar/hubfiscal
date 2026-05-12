/**
 * Domínio Sistemas (Thomson Reuters) — API Client
 * 
 * Implementa autenticação OAuth 2.0 e envio de XMLs de NF-e
 * para o sistema contábil Domínio via API REST.
 */
const axios = require('axios');
const FormData = require('form-data');

class DominioClient {
  constructor(config) {
    this.authUrl = (config.dominio_auth_url || 'https://auth.thomsonreuters.com/oauth/token').replace(/\/+$/, '').trim();
    this.apiUrl = (config.dominio_api_url || 'https://api.onvio.com.br').replace(/\/+$/, '').trim();
    this.clientId = (config.dominio_client_id || '').trim();
    this.clientSecret = (config.dominio_client_secret || '').trim();
    this.integrationKey = (config.dominio_integration_key || '').trim();
    this.accessToken = null;
    this.tokenExpiry = null;
  }

  /**
   * Obtém token de acesso OAuth 2.0
   */
  async obterToken() {
    if (!this.clientId || !this.clientSecret) {
      throw new Error('Client ID e Client Secret do Domínio não configurados.');
    }

    try {
      const axios = require('axios');
      const credentials = Buffer.from(`${this.clientId}:${this.clientSecret}`).toString('base64');
      const response = await axios.post(this.authUrl, 
        new URLSearchParams({
          grant_type: 'client_credentials',
          audience: '409f91f6-dc17-44c8-a5d8-e0a1bafd8b67'
        }).toString(),
        {
          headers: { 
            'Content-Type': 'application/x-www-form-urlencoded',
            'Authorization': `Basic ${credentials}`
          },
          timeout: 15000
        }
      );

      if (response.data && response.data.access_token) {
        this.accessToken = response.data.access_token;
        const expiresIn = response.data.expires_in || 3600;
        this.tokenExpiry = Date.now() + (expiresIn - 60) * 1000;
        return this.accessToken;
      }

      throw new Error('Resposta do Domínio não contém access_token.');
    } catch (err) {
      const errorMsg = err.response?.data?.error_description 
                    || err.response?.data?.message 
                    || err.response?.data 
                    || err.message;
      throw new Error(`Erro de Autenticação Domínio: ${typeof errorMsg === 'object' ? JSON.stringify(errorMsg) : errorMsg}`);
    }
  }

  /**
   * Ativa a chave de integração gerada pelo contador, trocando-a pelo JWT definitivo.
   */
  async ativarChave(chaveBruta) {
    await this.obterToken();
    const axios = require('axios');
    const url = `${this.apiUrl}/dominio/integration/v1/activation/enable`;
    try {
      const response = await axios.post(url, {}, {
        headers: {
          'Authorization': `Bearer ${this.accessToken}`,
          'x-integration-key': chaveBruta
        }
      });
      
      // A API retorna um objeto, precisamos extrair a string da chave gerada
      if (typeof response.data === 'object' && response.data.integrationKey) {
        return String(response.data.integrationKey);
      }
      return String(response.data || chaveBruta);
    } catch (err) {
      if (err.response?.status === 404 || err.response?.data?.code === '404 NOT_FOUND') {
        // Se retornar 404, significa que essa chave NÃO é de ativação (já foi ativada ou já é a chave final).
        // Vamos retornar a chave bruta original para que o sistema use ela mesma.
        return String(chaveBruta);
      }
      const errorMsg = err.response?.data?.message || err.response?.data?.error || err.message;
      throw new Error(`Falha ao ativar chave no Domínio: ${typeof errorMsg === 'object' ? JSON.stringify(errorMsg) : errorMsg}`);
    }
  }

  /**
   * Retorna headers autenticados para requisições usando a Chave de Integração
   */
  async _getHeaders(contentType = 'application/json') {
    if (!this.accessToken || (this.tokenExpiry && Date.now() >= this.tokenExpiry)) {
      await this.obterToken();
    }

    if (this.integrationKey && typeof this.integrationKey === 'string' && !this.integrationKey.startsWith('eyJ')) {
      this.integrationKey = await this.ativarChave(this.integrationKey);
    } else if (typeof this.integrationKey === 'object') {
      this.integrationKey = this.integrationKey.integrationKey || String(this.integrationKey);
    }

    const headers = {
      'Authorization': `Bearer ${this.accessToken}`,
      'x-integration-key': this.integrationKey
    };

    if (contentType) {
      headers['Content-Type'] = contentType;
    }

    return headers;
  }

  /**
   * Envia um único XML de NF-e para o Domínio
   * @param {string} xmlContent - Conteúdo XML completo da nota
   * @param {object} metadata - Informações adicionais (chave, número, etc.)
   * @returns {object} Resultado do envio
   */
  async enviarXml(xmlContent, metadata = {}) {
    if (!xmlContent || xmlContent.trim() === '') {
      throw new Error('XML vazio ou inválido.');
    }

    const url = `${this.apiUrl}/dominio/invoice/v3/batches`; // Endereço Onvio/Domínio para upload de notas

    try {
      const form = new FormData();
      form.append('file[]', Buffer.from(xmlContent, 'utf-8'), {
        filename: `NFe_${metadata.chave || 'unknown'}.xml`,
        contentType: 'application/xml'
      });
      form.append('query', JSON.stringify({ boxeFile: false }), { contentType: 'application/json' });

      if (metadata.tipo) {
        form.append('documentType', metadata.tipo === 'entrada' ? 'INPUT' : 'OUTPUT');
      }

      const headers = await this._getHeaders(null);
      const response = await axios.post(url, form, {
        headers: {
          ...headers,
          ...form.getHeaders()
        },
        timeout: 30000,
        maxContentLength: 50 * 1024 * 1024,
        maxBodyLength: 50 * 1024 * 1024
      });

      return {
        success: true,
        data: response.data,
        status: response.status,
        batchId: response.data?.batchId || response.data?.id || null
      };
    } catch (err) {
      // Se token expirou, renova e tenta novamente
      if (err.response?.status === 401) {
        await this.obterToken();
        return this.enviarXml(xmlContent, metadata);
      }

      const errorDetail = err.response?.data?.message 
                       || err.response?.data?.error 
                       || err.response?.data 
                       || err.message;

      return {
        success: false,
        error: typeof errorDetail === 'object' ? JSON.stringify(errorDetail) : errorDetail,
        status: err.response?.status || 0
      };
    }
  }

  /**
   * Envia múltiplos XMLs em lote (batch upload)
   * @param {Array} xmlFiles - Array de { xml, chave, tipo }
   * @returns {object} Resultado do envio em lote
   */
  async enviarLote(xmlFiles) {
    if (!xmlFiles || xmlFiles.length === 0) {
      throw new Error('Nenhum arquivo XML para enviar.');
    }

    const url = `${this.apiUrl}/dominio/invoice/v3/batches`;

    try {
      const form = new FormData();

      xmlFiles.forEach((file, index) => {
        form.append('file[]', Buffer.from(file.xml, 'utf-8'), {
          filename: `NFe_${file.chave || index}.xml`,
          contentType: 'application/xml'
        });
      });
      form.append('query', JSON.stringify({ boxeFile: false }), { contentType: 'application/json' });

      const headers = await this._getHeaders(null);
      const response = await axios.post(url, form, {
        headers: {
          ...headers,
          ...form.getHeaders()
        },
        timeout: 120000,
        maxContentLength: 100 * 1024 * 1024,
        maxBodyLength: 100 * 1024 * 1024
      });

      return {
        success: true,
        data: response.data,
        batchId: response.data?.batchId || response.data?.id || null,
        total: xmlFiles.length
      };
    } catch (err) {
      if (err.response?.status === 401) {
        await this.obterToken();
        return this.enviarLote(xmlFiles);
      }

      const errorDetail = err.response?.data?.message 
                       || err.response?.data?.error 
                       || err.response?.data 
                       || err.message;

      return {
        success: false,
        error: typeof errorDetail === 'object' ? JSON.stringify(errorDetail) : errorDetail,
        status: err.response?.status || 0
      };
    }
  }

  /**
   * Testa a conexão com o Domínio e já tenta ativar a chave caso ela não seja um JWT.
   */
  async testarConexao() {
    try {
      await this.obterToken();
      if (this.integrationKey && !this.integrationKey.startsWith('eyJ')) {
        // Tenta ativar
        const novaChave = await this.ativarChave(this.integrationKey);
        return { success: true, message: 'Conexão estabelecida e chave ativada com sucesso!', novaChave };
      }
      return { success: true, message: 'Conexão com Domínio estabelecida com sucesso!' };
    } catch (err) {
      return { success: false, message: err.message };
    }
  }
}

module.exports = DominioClient;

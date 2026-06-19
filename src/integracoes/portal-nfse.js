/**
 * Client REST para o Portal Nacional de NFS-e (ADN - Ambiente de Dados Nacional)
 * Autenticação via certificado A1 (.pfx) com mTLS (RFC 8705)
 * Documentação: https://adn.nfse.gov.br/docs/index.html
 *               https://adn.producaorestrita.nfse.gov.br/contribuintes/docs/index.html
 */
const axios = require('axios');
const https = require('https');

const BASE_URLS = {
  producao: 'https://adn.nfse.gov.br',
  homologacao: 'https://adn.producaorestrita.nfse.gov.br'
};

class PortalNfseClient {
  constructor({ cnpj, ambiente, certificadoBase64, certificadoSenha }) {
    this.cnpj = cnpj.replace(/\D/g, '');
    this.baseUrl = BASE_URLS[ambiente] || BASE_URLS.producao;
    this.certificadoBase64 = certificadoBase64;
    this.certificadoSenha = certificadoSenha;
    this._token = null;
    this._tokenExpiry = 0;
    this._agent = null;
  }

  _createAgent() {
    if (this._agent) return this._agent;
    const pfxBuffer = Buffer.from(this.certificadoBase64, 'base64');
    this._agent = new https.Agent({
      pfx: pfxBuffer,
      passphrase: this.certificadoSenha,
      rejectUnauthorized: false,
      minVersion: 'TLSv1.2'
    });
    return this._agent;
  }

  async _getToken(logFn) {
    if (this._token && Date.now() < this._tokenExpiry) return this._token;

    const agent = this._createAgent();
    const tokenUrl = `${this.baseUrl}/contribuintes/autenticacao/token`;
    if (logFn) logFn(`[debug] POST token → ${tokenUrl}`);

    const resp = await axios.post(
      tokenUrl,
      'grant_type=client_credentials',
      {
        httpsAgent: agent,
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        timeout: 30000
      }
    );

    if (logFn) logFn(`[debug] Token resp keys: ${Object.keys(resp.data || {}).join(', ')}`);
    this._token = resp.data.access_token || resp.data.token || resp.data.access_Token;
    this._tokenExpiry = Date.now() + ((resp.data.expires_in || resp.data.expiresIn || 3600) - 60) * 1000;
    if (logFn) logFn(`[debug] Token obtido: ${this._token ? 'sim' : 'NAO (campo não encontrado)'}`);
    return this._token;
  }

  async _get(path, params = {}, logFn) {
    const token = await this._getToken(logFn);
    const url = `${this.baseUrl}${path}`;
    if (logFn) logFn(`[debug] GET ${url} params=${JSON.stringify(params)}`);
    const resp = await axios.get(url, {
      httpsAgent: this._createAgent(),
      headers: { Authorization: `Bearer ${token}` },
      params,
      timeout: 30000
    });
    if (logFn) logFn(`[debug] GET ${url} → status ${resp.status} | keys: ${Object.keys(resp.data || {}).join(', ')} | raw: ${JSON.stringify(resp.data).substring(0, 300)}`);
    return resp.data;
  }

  _buildChave(nfse) {
    const inf = nfse.infNfse || nfse;
    if (inf.Id) return inf.Id;
    if (nfse.chaveNfse) return nfse.chaveNfse;
    const cnpj = (inf.prestador?.cpfCnpj || '').replace(/\D/g, '').padStart(14, '0');
    const num = String(inf.numero || '0').padStart(15, '0');
    const comp = String(inf.competencia || '').replace(/\D/g, '').substring(0, 6);
    return `NFSE${cnpj}${num}${comp}`;
  }

  _normalize(nfse, tipo) {
    const inf = nfse.infNfse || nfse;
    const prestador = inf.prestador || {};
    const tomador = inf.tomador || {};
    const valor = inf.servico?.valor || inf.valor || {};

    return {
      chave_acesso: this._buildChave(nfse),
      numero_nf: String(inf.numero || ''),
      serie: String(inf.serie || '1'),
      data_emissao: inf.dataHoraEmissao || inf.dataEmissao || null,
      valor_total: parseFloat(valor.valorServicos || valor.valorLiquidoNfse || 0),
      emitente_cnpj: (prestador.cpfCnpj || prestador.cnpj || '').replace(/\D/g, ''),
      emitente_nome: prestador.razaoSocial || prestador.nomeFantasia || '',
      destinatario_cnpj: (tomador.cpfCnpj || tomador.cnpj || '').replace(/\D/g, ''),
      destinatario_nome: tomador.razaoSocial || tomador.nomeFantasia || '',
      tipo,
      situacao: 'autorizada',
      schema_type: 'nfse',
      nsu: null,
      xml_completo: JSON.stringify(nfse)
    };
  }

  /**
   * Baixa NFS-e via NSU (igual ao DF-e da NF-e SEFAZ).
   * Filtra por CNPJ prestador/tomador e por período de data de emissão.
   * @param {string} dataInicio  formato YYYY-MM-DD
   * @param {string} dataFim     formato YYYY-MM-DD
   * @param {number} ultNsu      último NSU processado (default 0)
   */
  async consultarTudo(dataInicio, dataFim, ultNsu = 0, logFn) {
    const log = logFn || (msg => console.log(msg));
    log(`[NFS-e] CNPJ ${this.cnpj} | ${dataInicio} → ${dataFim} | ultNSU: ${ultNsu}`);

    const documentos = [];
    let nsuAtual = ultNsu;
    const inicio = new Date(dataInicio);
    const fim = new Date(dataFim + 'T23:59:59');

    while (true) {
      let resp;
      try {
        resp = await this._get(`/contribuintes/DFe/${nsuAtual}`, {}, log);
      } catch (err) {
        log(`[debug] DFe/${nsuAtual} erro HTTP ${err.response?.status}: ${err.message}`);
        if (err.response?.status === 404) break;
        throw err;
      }

      const lista = resp.DFe || resp.dfe || resp.lista || resp.items || resp.data || resp.documentos || [];
      log(`[debug] DFe/${nsuAtual} lista: ${lista.length} itens | keys: ${Object.keys(resp || {}).join(', ')}`);
      if (!Array.isArray(lista) || lista.length === 0) break;

      for (const item of lista) {
        const nfse = item.nfse || item.NFSe || item;
        const nsuItem = item.NSU || item.nsu || item.ultNSU;
        if (nsuItem) nsuAtual = Math.max(nsuAtual, parseInt(nsuItem));

        // Detecta tipo pelo CNPJ
        const cnpjPrestador = (nfse?.infNfse?.prestador?.cpfCnpj || nfse?.prestador?.cpfCnpj || '').replace(/\D/g, '');
        const tipo = cnpjPrestador === this.cnpj ? 'saida' : 'entrada';

        // Filtra por período
        const dataEmissao = nfse?.infNfse?.dataHoraEmissao || nfse?.dataHoraEmissao || nfse?.dataEmissao;
        if (dataEmissao) {
          const d = new Date(dataEmissao);
          if (d < inicio || d > fim) continue;
        }

        documentos.push(this._normalize(nfse, tipo));
      }

      // Verifica se há mais páginas via maxNSU/ultNSU retornados
      const maxNSU = resp.maxNSU || resp.ultNSU || resp.NSUmax;
      if (!maxNSU || nsuAtual >= parseInt(maxNSU)) break;

      await new Promise(r => setTimeout(r, 500));
    }

    const emitidas = documentos.filter(d => d.tipo === 'saida');
    const recebidas = documentos.filter(d => d.tipo === 'entrada');
    console.log(`[NFS-e]   Emitidas: ${emitidas.length} | Recebidas: ${recebidas.length}`);

    return documentos;
  }
}

module.exports = PortalNfseClient;

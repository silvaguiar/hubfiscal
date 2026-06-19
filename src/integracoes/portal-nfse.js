/**
 * Client REST para o Portal Nacional de NFS-e (Nota Fiscal de Serviço Eletrônica)
 * Autenticação via certificado A1 (.pfx) com OAuth2 client_credentials (mTLS)
 * Documentação: https://www.nfse.gov.br/EmissorNacional/
 */
const axios = require('axios');
const https = require('https');

const BASE_URLS = {
  producao: 'https://nfse.receita.fazenda.gov.br',
  homologacao: 'https://hnfse.receita.fazenda.gov.br'
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

  async _getToken() {
    if (this._token && Date.now() < this._tokenExpiry) return this._token;

    const agent = this._createAgent();
    const resp = await axios.post(
      `${this.baseUrl}/autenticacao/token`,
      'grant_type=client_credentials',
      {
        httpsAgent: agent,
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        timeout: 30000
      }
    );

    this._token = resp.data.access_token;
    this._tokenExpiry = Date.now() + ((resp.data.expires_in || 3600) - 60) * 1000;
    return this._token;
  }

  async _get(path, params = {}) {
    const token = await this._getToken();
    const resp = await axios.get(`${this.baseUrl}${path}`, {
      httpsAgent: this._createAgent(),
      headers: { Authorization: `Bearer ${token}` },
      params,
      timeout: 30000
    });
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

  async _consultarPaginado(path, params, tipo) {
    const documentos = [];
    let pagina = 1;
    const totalPorPagina = 50;

    while (true) {
      const resp = await this._get(path, { ...params, pagina, totalRegistros: totalPorPagina });
      const lista = resp.nfse || resp.lista || resp.data || resp.items || [];

      if (!Array.isArray(lista) || lista.length === 0) break;

      for (const item of lista) documentos.push(this._normalize(item, tipo));

      const totalPaginas = resp.totalPaginas || resp.paginacao?.totalPaginas;
      if (!totalPaginas || pagina >= totalPaginas || lista.length < totalPorPagina) break;
      pagina++;
      await new Promise(r => setTimeout(r, 500));
    }

    return documentos;
  }

  async consultarTudo(dataInicio, dataFim) {
    console.log(`[NFS-e] Consultando CNPJ ${this.cnpj} | ${dataInicio} → ${dataFim}`);

    const emitidas = await this._consultarPaginado(
      '/nfse/emitidas',
      { cpfCnpj: this.cnpj, dataInicio, dataFim },
      'saida'
    );
    console.log(`[NFS-e]   Emitidas: ${emitidas.length}`);

    const recebidas = await this._consultarPaginado(
      '/nfse/recebidas',
      { cpfCnpj: this.cnpj, dataInicio, dataFim },
      'entrada'
    );
    console.log(`[NFS-e]   Recebidas: ${recebidas.length}`);

    return [...emitidas, ...recebidas];
  }
}

module.exports = PortalNfseClient;

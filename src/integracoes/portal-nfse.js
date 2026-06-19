/**
 * Client REST para o Portal Nacional de NFS-e (ADN - Ambiente de Dados Nacional)
 * Autenticação via mTLS puro (certificado A1 no handshake TLS, sem OAuth2)
 * Documentação: https://adn.nfse.gov.br/docs/index.html
 */
const axios = require('axios');
const https = require('https');
const zlib = require('zlib');
const { XMLParser } = require('fast-xml-parser');

const BASE_URLS = {
  producao: 'https://adn.nfse.gov.br',
  homologacao: 'https://adn.producaorestrita.nfse.gov.br'
};

const xmlParser = new XMLParser({ ignoreAttributes: false, attributeNamePrefix: '@_', parseTagValue: true });

class PortalNfseClient {
  constructor({ cnpj, ambiente, certificadoBase64, certificadoSenha }) {
    this.cnpj = cnpj.replace(/\D/g, '');
    this.baseUrl = BASE_URLS[ambiente] || BASE_URLS.producao;
    this.certificadoBase64 = certificadoBase64;
    this.certificadoSenha = certificadoSenha;
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

  async _get(path, params = {}, logFn) {
    const url = `${this.baseUrl}${path}`;
    if (logFn) logFn(`[debug] GET ${url}`);
    const resp = await axios.get(url, {
      httpsAgent: this._createAgent(),
      params,
      timeout: 30000
    });
    if (logFn) logFn(`[debug] status ${resp.status} | StatusProcessamento: ${resp.data?.StatusProcessamento} | LoteDFe: ${resp.data?.LoteDFe?.length ?? 0} docs`);
    return resp.data;
  }

  _descomprimirXml(arqBase64) {
    const buf = Buffer.from(arqBase64, 'base64');
    // Tenta GZip primeiro, senão assume texto puro
    try {
      return zlib.gunzipSync(buf).toString('utf-8');
    } catch {
      return buf.toString('utf-8');
    }
  }

  _normalize(item, logFn) {
    const chave = item.ChaveAcesso || '';
    const nsu = item.NSU;

    try {
      const xml = this._descomprimirXml(item.ArquivoXml || '');
      const doc = xmlParser.parse(xml);

      // Navega pela estrutura NFS-e nacional (pode variar)
      const nfse = doc?.CompNfse?.Nfse?.InfNfse
        || doc?.NFSe?.InfNfse
        || doc?.InfNfse
        || doc?.nfse?.infNfse
        || {};

      const prestador = nfse.PrestadorServico || nfse.prestador || {};
      const tomador = nfse.TomadorServico || nfse.tomador || {};
      const servico = nfse.Servico || nfse.servico || {};
      const valores = servico.Valores || servico.valor || {};

      const cnpjPrestador = String(
        prestador?.IdentificacaoPrestador?.CpfCnpj?.Cnpj
        || prestador?.cpfCnpj
        || prestador?.Cnpj
        || ''
      ).replace(/\D/g, '');

      const tipo = cnpjPrestador === this.cnpj ? 'saida' : 'entrada';

      return {
        chave_acesso: chave,
        numero_nf: String(nfse.Numero || nfse.numero || ''),
        serie: String(nfse.Serie || nfse.serie || '1'),
        data_emissao: nfse.DataEmissao || nfse.dataEmissao || null,
        valor_total: parseFloat(valores.ValorServicos || valores.valorServicos || 0),
        emitente_cnpj: cnpjPrestador,
        emitente_nome: String(prestador?.RazaoSocial || prestador?.razaoSocial || ''),
        destinatario_cnpj: String(
          tomador?.IdentificacaoTomador?.CpfCnpj?.Cnpj
          || tomador?.cpfCnpj
          || tomador?.Cnpj
          || ''
        ).replace(/\D/g, ''),
        destinatario_nome: String(tomador?.RazaoSocial || tomador?.razaoSocial || ''),
        tipo,
        situacao: 'autorizada',
        schema_type: 'nfse',
        nsu: nsu ? parseInt(nsu) : null,
        xml_completo: xml
      };
    } catch (err) {
      if (logFn) logFn(`[debug] Erro ao parsear NSU ${nsu}: ${err.message}`);
      // Retorna com os dados mínimos disponíveis no envelope
      return {
        chave_acesso: chave,
        numero_nf: '',
        serie: '1',
        data_emissao: null,
        valor_total: 0,
        emitente_cnpj: '',
        emitente_nome: '',
        destinatario_cnpj: '',
        destinatario_nome: '',
        tipo: 'entrada',
        situacao: 'autorizada',
        schema_type: 'nfse',
        nsu: nsu ? parseInt(nsu) : null,
        xml_completo: ''
      };
    }
  }

  /**
   * Baixa NFS-e via NSU sequencial (padrão ADN).
   * Filtra por CNPJ prestador/tomador e por período de data de emissão.
   */
  async consultarTudo(dataInicio, dataFim, ultNsu = 0, logFn) {
    const log = logFn || (msg => console.log(msg));
    log(`[NFS-e] CNPJ ${this.cnpj} | ${dataInicio} → ${dataFim} | ultNSU: ${ultNsu}`);

    const documentos = [];
    let nsuAtual = ultNsu;
    const inicio = new Date(dataInicio);
    const fim = new Date(dataFim + 'T23:59:59');
    const POR_PAGINA = 50;

    while (true) {
      let resp;
      try {
        resp = await this._get(`/contribuintes/DFe/${nsuAtual}`, {}, log);
      } catch (err) {
        log(`[debug] DFe/${nsuAtual} erro HTTP ${err.response?.status}: ${err.message}`);
        if (err.response?.status === 404) break;
        throw err;
      }

      const lote = resp.LoteDFe || [];
      if (!Array.isArray(lote) || lote.length === 0) {
        log(`[debug] Nenhum documento retornado (StatusProcessamento: ${resp.StatusProcessamento})`);
        break;
      }

      for (const item of lote) {
        const nsuItem = parseInt(item.NSU || 0);
        if (nsuItem > nsuAtual) nsuAtual = nsuItem;

        const doc = this._normalize(item, log);

        // Filtra por período
        if (doc.data_emissao) {
          const d = new Date(doc.data_emissao);
          if (d < inicio || d > fim) continue;
        }

        // Inclui apenas documentos do CNPJ desta empresa (emitente ou destinatário)
        const cnpjOk = doc.emitente_cnpj === this.cnpj || doc.destinatario_cnpj === this.cnpj;
        if (!cnpjOk && doc.emitente_cnpj) continue;

        documentos.push(doc);
      }

      log(`[debug] Lote NSU ${nsuAtual}: ${lote.length} recebidos, ${documentos.length} acumulados`);

      // Para quando recebe menos que o máximo por página (última página)
      if (lote.length < POR_PAGINA) break;

      await new Promise(r => setTimeout(r, 500));
    }

    const emitidas = documentos.filter(d => d.tipo === 'saida').length;
    const recebidas = documentos.filter(d => d.tipo === 'entrada').length;
    log(`[NFS-e] Total: ${documentos.length} (${emitidas} emitidas, ${recebidas} recebidas)`);

    return documentos;
  }
}

module.exports = PortalNfseClient;

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

      // Estrutura NFS-e Nacional (novo padrão SPED - http://www.sped.fazenda.gov.br/nfse)
      const infNFSe = doc?.NFSe?.infNFSe || {};
      const infDPS  = infNFSe?.DPS?.infDPS || {};
      const emit    = infNFSe?.emit || infDPS?.prest || {};
      const toma    = infDPS?.toma || {};
      const dpsVal  = infDPS?.valores || {};

      const cnpjEmit = String(emit.CNPJ || '').replace(/\D/g, '');
      const tipo = cnpjEmit === this.cnpj ? 'saida' : 'entrada';

      return {
        chave_acesso: chave,
        numero_nf:   String(infNFSe.nNFSe || infDPS.nDPS || ''),
        serie:       String(infDPS.serie || '1'),
        data_emissao: infDPS.dhEmi || infNFSe.dhProc || null,
        valor_total:  parseFloat(dpsVal?.vServPrest?.vServ || infNFSe?.valores?.vBC || 0),
        emitente_cnpj: cnpjEmit,
        emitente_nome: String(emit.xNome || emit.xFant || ''),
        destinatario_cnpj: String(toma.CNPJ || '').replace(/\D/g, ''),
        destinatario_nome: String(toma.xNome || ''),
        tipo,
        situacao:    'autorizada',
        schema_type: 'nfse',
        nsu: nsu ? parseInt(nsu) : null,
        xml_completo: xml
      };
    } catch (err) {
      if (logFn) logFn(`[debug] Erro ao parsear NSU ${nsu}: ${err.message}`);
      return {
        chave_acesso: chave, numero_nf: '', serie: '1', data_emissao: null, valor_total: 0,
        emitente_cnpj: '', emitente_nome: '', destinatario_cnpj: '', destinatario_nome: '',
        tipo: 'entrada', situacao: 'autorizada', schema_type: 'nfse',
        nsu: nsu ? parseInt(nsu) : null, xml_completo: ''
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

        // Log da estrutura XML do primeiro doc para diagnóstico
        if (documentos.length === 0 && lote.indexOf(item) === 0) {
          try {
            const xmlRaw = this._descomprimirXml(item.ArquivoXml || '');
            const docParsed = xmlParser.parse(xmlRaw);
            log(`[debug] XML root keys: ${Object.keys(docParsed).join(', ')}`);
            const rootKey = Object.keys(docParsed)[0];
            log(`[debug] XML[${rootKey}] keys: ${Object.keys(docParsed[rootKey] || {}).join(', ')}`);
            log(`[debug] XML raw (500): ${xmlRaw.substring(0, 500)}`);
          } catch (e) { log(`[debug] Erro ao logar XML: ${e.message}`); }
        }

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

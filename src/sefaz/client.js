const axios = require('axios');
const https = require('https');
const fs = require('fs');
const path = require('path');
const pako = require('pako');
const soapBuilder = require('./soap-builder');
const xmlParser = require('./xml-parser');

const ENDPOINTS = {
  producao: 'https://www1.nfe.fazenda.gov.br/NFeDistribuicaoDFe/NFeDistribuicaoDFe.asmx',
  homologacao: 'https://hom1.nfe.fazenda.gov.br/NFeDistribuicaoDFe/NFeDistribuicaoDFe.asmx'
};

const SOAP_ACTION = 'http://www.portalfiscal.inf.br/nfe/wsdl/NFeDistribuicaoDFe/nfeDistDFeInteresse';

class SefazClient {
  constructor(config) {
    this.cnpj = config.cnpj.replace(/\D/g, '');
    this.uf = config.uf;
    this.ambiente = config.ambiente || 'producao';
    this.certificadoBase64 = config.certificadoBase64;
    this.certificadoSenha = config.certificadoSenha;
    this.httpsAgent = null;
  }

  /**
   * Initialize HTTPS agent with PFX certificate
   */
  _createAgent() {
    if (this.httpsAgent) return this.httpsAgent;

    if (!this.certificadoBase64) {
      throw new Error('Certificado digital A1 não configurado (Base64 ausente)');
    }

    const pfxBuffer = Buffer.from(this.certificadoBase64, 'base64');

    this.httpsAgent = new https.Agent({
      pfx: pfxBuffer,
      passphrase: this.certificadoSenha,
      rejectUnauthorized: false,
      minVersion: 'TLSv1.2'
    });

    return this.httpsAgent;
  }

  /**
   * Send SOAP request to SEFAZ
   */
  async _sendRequest(soapXml) {
    const agent = this._createAgent();
    const url = ENDPOINTS[this.ambiente];

    try {
      const response = await axios.post(url, soapXml, {
        httpsAgent: agent,
        headers: {
          'Content-Type': 'application/soap+xml; charset=utf-8',
          'SOAPAction': SOAP_ACTION
        },
        timeout: 60000,
        maxContentLength: 50 * 1024 * 1024
      });

      return response.data;
    } catch (err) {
      if (err.response) {
        throw new Error(`SEFAZ retornou erro ${err.response.status}: ${err.response.statusText}`);
      } else if (err.code === 'ECONNREFUSED') {
        throw new Error('Conexão recusada pela SEFAZ. Verifique o certificado.');
      } else if (err.code === 'ERR_TLS_CERT_ALTNAME_INVALID' || err.message.includes('certificate')) {
        throw new Error('Erro no certificado digital. Verifique se o certificado A1 é válido e a senha está correta.');
      } else {
        throw new Error(`Erro na comunicação com SEFAZ: ${err.message}`);
      }
    }
  }

  /**
   * Decompress base64+gzip document content
   */
  _decompressDocument(base64Content) {
    try {
      const buffer = Buffer.from(base64Content, 'base64');
      const decompressed = pako.inflate(buffer);
      return new TextDecoder('utf-8').decode(decompressed);
    } catch (err) {
      console.error('Erro ao descomprimir documento:', err.message);
      return null;
    }
  }

  /**
   * Query NF-e by sequential NSU (distNSU)
   * Returns batch of documents from the given NSU
   */
  async consultarDistNSU(ultimoNSU = '000000000000000') {
    const ufCode = soapBuilder.UF_CODES[this.uf] || this.uf;
    const soapXml = soapBuilder.buildDistNSU(this.cnpj, ufCode, ultimoNSU, this.ambiente);

    console.log(`📡 Consultando SEFAZ - distNSU a partir de ${ultimoNSU}...`);

    const responseXml = await this._sendRequest(soapXml);
    const response = xmlParser.parseDistribuicaoResponse(responseXml);

    // Normaliza tudo para string (fast-xml-parser retorna elementos numéricos como number)
    const cStat   = String(response.cStat   || '');
    const xMotivo = String(response.xMotivo || '');
    const ultNSU  = String(response.ultNSU  || '0').padStart(15, '0');
    const maxNSU  = String(response.maxNSU  || '0').padStart(15, '0');

    console.log(`   Status: ${cStat} - ${xMotivo}`);
    console.log(`   ultNSU: ${ultNSU} | maxNSU: ${maxNSU}`);

    const result = {
      status: cStat,
      motivo: xMotivo,
      ultNSU,
      maxNSU,
      documentos: []
    };

    if (cStat === '138') {
      // 138 = Documento(s) localizado(s)
      const docs = xmlParser.extractDocuments(response.loteDistDFeInt);
      console.log(`   📦 ${docs.length} doc(s) no lote`);

      for (const doc of docs) {
        const xmlContent = this._decompressDocument(doc.content);
        if (!xmlContent) continue;

        let parsed = null;
        if (doc.schema && doc.schema.includes('resNFe')) {
          parsed = xmlParser.parseResNFe(xmlContent, this.cnpj);
          if (parsed) parsed.schema_type = 'resNFe';
        } else if (doc.schema && doc.schema.includes('procNFe')) {
          parsed = xmlParser.parseNFeXml(xmlContent, this.cnpj);
          if (parsed) parsed.schema_type = 'procNFe';
        } else if (doc.schema && doc.schema.includes('resEvento')) {
          const evento = xmlParser.parseResEvento(xmlContent);
          if (evento) console.log(`   📋 Evento: ${evento.descEvento} - Chave: ${evento.chave_acesso}`);
          continue;
        } else {
          parsed = xmlParser.parseNFeXml(xmlContent, this.cnpj);
          if (!parsed) parsed = xmlParser.parseResNFe(xmlContent, this.cnpj);
        }

        if (parsed) {
          parsed.nsu = doc.nsu;
          parsed.xml_completo = xmlContent;
          result.documentos.push(parsed);
        } else {
          console.log(`   ⚠️ Não foi possível parsear doc NSU=${doc.nsu} schema=${doc.schema}`);
        }
      }

      console.log(`   📄 ${result.documentos.length} documento(s) processado(s)`);

    } else if (cStat === '656') {
      // 656 = Consumo Indevido
      console.log(`   ⚠️ Consumo indevido. Aguarde ~1 hora. ultNSU disponível: ${ultNSU}`);
      result.consumoIndevido = true;

    } else if (cStat === '137') {
      console.log('   ✅ Nenhum documento novo');

    } else {
      console.log(`   ℹ️ Status: ${cStat} - ${xMotivo}`);
    }

    return result;
  }

  /**
   * Query specific NF-e by access key (consChNFe)
   */
  async consultarChaveNFe(chaveNFe) {
    const ufCode = soapBuilder.UF_CODES[this.uf] || this.uf;
    const soapXml = soapBuilder.buildConsChNFe(this.cnpj, ufCode, chaveNFe, this.ambiente);

    console.log(`📡 Consultando NF-e pela chave: ${chaveNFe}...`);

    const responseXml = await this._sendRequest(soapXml);
    const response = xmlParser.parseDistribuicaoResponse(responseXml);

    if (response.cStat === '138') {
      const docs = xmlParser.extractDocuments(response.loteDistDFeInt);
      for (const doc of docs) {
        const xmlContent = this._decompressDocument(doc.content);
        if (!xmlContent) continue;

        const parsed = xmlParser.parseNFeXml(xmlContent, this.cnpj)
          || xmlParser.parseResNFe(xmlContent, this.cnpj);

        if (parsed) {
          parsed.nsu = doc.nsu;
          parsed.xml_completo = xmlContent;
          return parsed;
        }
      }
    }

    return { status: response.cStat, motivo: response.xMotivo };
  }

  /**
   * Full sync - query all documents from last NSU
   * Handles pagination automatically (SEFAZ returns max 50 docs per request)
   */
  async sincronizarTudo(ultimoNSU = '000000000000000', onProgress = null) {
    let currentNSU = ultimoNSU;
    let allDocuments = [];
    let hasMore = true;
    let requestCount = 0;
    const MAX_REQUESTS = 100; // Safety limit

    while (hasMore && requestCount < MAX_REQUESTS) {
      requestCount++;

      try {
        const result = await this.consultarDistNSU(currentNSU);

        if (result.status === '138') {
          allDocuments = allDocuments.concat(result.documentos);
          currentNSU = result.ultNSU;

          if (onProgress) {
            onProgress({
              requestCount,
              documentsFound: allDocuments.length,
              currentNSU,
              maxNSU: result.maxNSU
            });
          }

          // Check if there are more documents
          hasMore = result.ultNSU !== result.maxNSU && result.maxNSU !== '0' && result.maxNSU !== undefined;

          // SEFAZ requires minimum 1 second between requests
          if (hasMore) {
            await this._sleep(1500);
          }
        } else if (result.status === '137') {
          // 137 = Nenhum documento localizado, mas salvar o NSU retornado
          console.log('   ✅ Nenhum documento novo encontrado');
          if (result.ultNSU && result.ultNSU !== '0') currentNSU = result.ultNSU;
          hasMore = false;
        } else if (result.status === '656') {
          // 656 = Consumo indevido - salvar ultNSU para retomar depois
          if (result.ultNSU && result.ultNSU !== '0') currentNSU = result.ultNSU;
          console.log(`   ⚠️ Consumo indevido. Retome após 1 hora. NSU salvo: ${currentNSU}`);
          hasMore = false;
        } else {
          console.log(`   ⚠️ Status inesperado: ${result.status} - ${result.motivo}`);
          hasMore = false;
        }
      } catch (err) {
        console.error(`   ❌ Erro na requisição ${requestCount}: ${err.message}`);
        hasMore = false;
      }
    }

    return {
      documentos: allDocuments,
      ultimoNSU: currentNSU,
      totalRequests: requestCount
    };
  }

  _sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
  }
}

module.exports = SefazClient;

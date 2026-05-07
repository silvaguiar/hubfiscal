const { XMLParser } = require('fast-xml-parser');

const parserOptions = {
  ignoreAttributes: false,
  attributeNamePrefix: '@_',
  textNodeName: '#text',
  parseAttributeValue: false,
  parseTagValue: false,
  trimValues: true,
  isArray: (name) => {
    // Force arrays for elements that can have multiple entries
    return ['det', 'docZip', 'vol', 'dup', 'infProt'].includes(name);
  }
};

const parser = new XMLParser(parserOptions);

/**
 * Parse SEFAZ DistribuiçãoDFe response
 */
function parseDistribuicaoResponse(xmlResponse) {
  const parsed = parser.parse(xmlResponse);

  // Navigate through SOAP envelope
  const body = parsed['soap:Envelope']?.['soap:Body']
    || parsed['env:Envelope']?.['env:Body']
    || parsed['soap12:Envelope']?.['soap12:Body']
    || {};

  const result = body['nfeDistDFeInteresseResponse']?.['nfeDistDFeInteresseResult']
    || body['nfeDistDFeInteresseResponse']?.['retDistDFeInt']
    || {};

  const retDistDFeInt = result['retDistDFeInt'] || result;

  return {
    tpAmb:          retDistDFeInt['tpAmb'],
    verAplic:       retDistDFeInt['verAplic'],
    cStat:          String(retDistDFeInt['cStat']   || ''),
    xMotivo:        String(retDistDFeInt['xMotivo'] || ''),
    dhResp:         retDistDFeInt['dhResp'],
    ultNSU:         String(retDistDFeInt['ultNSU']  || '0'),
    maxNSU:         String(retDistDFeInt['maxNSU']  || '0'),
    loteDistDFeInt: retDistDFeInt['loteDistDFeInt']
  };
}

/**
 * Extract documents from loteDistDFeInt
 */
function extractDocuments(loteDistDFeInt) {
  if (!loteDistDFeInt) return [];

  let docs = loteDistDFeInt['docZip'];
  if (!docs) return [];
  if (!Array.isArray(docs)) docs = [docs];

  return docs.map(doc => ({
    nsu: doc['@_NSU'],
    schema: doc['@_schema'],
    content: doc['#text'] || doc
  }));
}

/**
 * Parse NF-e XML and extract key fields
 */
function parseNFeXml(xmlContent, cnpjProprio) {
  try {
    const parsed = parser.parse(xmlContent);

    // Try different root elements
    const nfeProc = parsed['nfeProc'] || parsed['NFe'] || parsed;
    const NFe = nfeProc['NFe'] || nfeProc;
    const infNFe = NFe?.['infNFe'] || {};
    const ide = infNFe['ide'] || {};
    const emit = infNFe['emit'] || {};
    const dest = infNFe['dest'] || {};
    const total = infNFe['total']?.['ICMSTot'] || {};

    const emitCnpj = (emit['CNPJ'] || emit['CPF'] || '').toString();
    const destCnpj = (dest['CNPJ'] || dest['CPF'] || '').toString();
    const cnpjLimpo = cnpjProprio.replace(/\D/g, '');

    // Determine if it's entrada or saida
    let tipo = 'entrada';
    if (emitCnpj === cnpjLimpo) {
      tipo = 'saida';
    }

    // Extract chave de acesso
    let chaveAcesso = infNFe['@_Id'] || '';
    chaveAcesso = chaveAcesso.replace(/^NFe/, '');

    // Format date
    let dataEmissao = ide['dhEmi'] || ide['dEmi'] || '';

    // Extract model from access key (digits 21-22)
    const modelo = chaveAcesso.substring(20, 22);

    // Formata o nome do destinatário
    let destNome = dest['xNome'] || dest['xFant'] || '';
    if (!destNome || destNome.trim() === '' || destNome.trim() === '-' || destNome.trim() === '_') {
      destNome = 'Consumidor Final';
    }

    return {
      chave_acesso: chaveAcesso,
      numero_nf: (ide['nNF'] || '').toString(),
      serie: (ide['serie'] || '').toString(),
      data_emissao: dataEmissao,
      valor_total: parseFloat(total['vNF'] || 0),
      emitente_cnpj: emitCnpj,
      emitente_nome: emit['xNome'] || emit['xFant'] || '',
      destinatario_cnpj: destCnpj,
      destinatario_nome: destNome,
      tipo,
      situacao: 'autorizada',
      xml_completo: xmlContent,
      schema_type: modelo // 55, 65, 57...
    };
  } catch (err) {
    console.error('Erro ao parsear XML da NF-e:', err.message);
    return null;
  }
}

/**
 * Parse resNFe (NF-e summary from DistribuiçãoDFe)
 */
function parseResNFe(xmlContent, cnpjProprio) {
  try {
    const parsed = parser.parse(xmlContent);
    const resNFe = parsed['resNFe'] || parsed;

    const emitCnpj = (resNFe['CNPJ'] || resNFe['CPF'] || '').toString();
    const cnpjLimpo = cnpjProprio.replace(/\D/g, '');

    let tipo = 'entrada';
    if (emitCnpj === cnpjLimpo) {
      tipo = 'saida';
    }

    let destNome = '';
    if (tipo === 'saida') {
       destNome = 'Consumidor Final';
    }

    return {
      chave_acesso: (resNFe['chNFe'] || '').toString(),
      numero_nf: '',
      serie: '',
      data_emissao: resNFe['dhEmi'] || '',
      valor_total: parseFloat(resNFe['vNF'] || 0),
      emitente_cnpj: emitCnpj,
      emitente_nome: resNFe['xNome'] || '',
      destinatario_cnpj: tipo === 'entrada' ? cnpjLimpo : '',
      destinatario_nome: destNome,
      tipo,
      situacao: resNFe['cSitNFe'] === '1' ? 'autorizada' : (resNFe['cSitNFe'] === '2' ? 'denegada' : 'cancelada'),
      xml_completo: xmlContent,
      schema_type: 'resNFe'
    };
  } catch (err) {
    console.error('Erro ao parsear resNFe:', err.message);
    return null;
  }
}

/**
 * Parse resEvento (event summary)
 */
function parseResEvento(xmlContent) {
  try {
    const parsed = parser.parse(xmlContent);
    const resEvento = parsed['resEvento'] || parsed;

    return {
      type: 'evento',
      chave_acesso: (resEvento['chNFe'] || '').toString(),
      tipoEvento: resEvento['tpEvento'],
      descEvento: resEvento['xEvento'] || '',
      dataEvento: resEvento['dhEvento'] || ''
    };
  } catch (err) {
    return null;
  }
}

module.exports = {
  parseDistribuicaoResponse,
  extractDocuments,
  parseNFeXml,
  parseResNFe,
  parseResEvento
};

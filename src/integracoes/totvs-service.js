const TotvsClient = require('./totvs');
const xmlParser = require('../sefaz/xml-parser');
const fs = require('fs');
const path = require('path');

class TotvsService {
  constructor(db) {
    this.db = db;
    this.logPath = path.join(__dirname, '..', '..', 'totvs_sync.log');
  }

  writeLog(msg) {
    const time = new Date().toLocaleTimeString();
    const line = `[${time}] ${msg}\n`;
    fs.appendFileSync(this.logPath, line);
    console.log(line.trim());
  }

  async extrair(empresaId, dataReferencia) {
    if (fs.existsSync(this.logPath)) fs.unlinkSync(this.logPath);
    
    let empresas = [];
    let isGlobal = false;
    let config = {};

    if (empresaId === null || empresaId === 0 || empresaId === '0') {
      isGlobal = true;
      const todas = await this.db.getEmpresas();
      empresas = todas.filter(e => e.totvs_ativo === true || e.totvs_ativo === 'true' || e.totvs_ativo == 1);
      if (empresas.length === 0) throw new Error('Nenhuma empresa ativa para sincronização TOTVS.');
      
      const globalConfig = await this.db.getConfig() || {};
      config = { ...globalConfig };
      // Se a global não tiver configurada, tenta usar as credenciais da primeira empresa ativa
      if (!config.totvs_base_url || config.totvs_base_url.trim() === '') {
        config = { ...empresas[0] };
      }
    } else {
      const empresa = await this.db.getEmpresaById(empresaId);
      if (!empresa) throw new Error('Empresa não encontrada');
      empresas = [empresa];
      const globalConfig = await this.db.getConfig() || {};
      config = { ...empresa };
      if (!config.totvs_base_url || config.totvs_base_url.trim() === '') {
        config.totvs_base_url = globalConfig.totvs_base_url;
        config.totvs_user = globalConfig.totvs_user;
        config.totvs_password = globalConfig.totvs_password;
        config.totvs_client_id = globalConfig.totvs_client_id;
        config.totvs_client_secret = globalConfig.totvs_client_secret;
        config.totvs_grant_type = globalConfig.totvs_grant_type;
        config.totvs_branch = empresa.totvs_branch; 
      }
    }

    config.onTokenUpdated = async (token, expiry) => {
      if (!isGlobal && empresaId) {
        await this.db.updateEmpresaTokens(empresaId, {
          totvs_token: token,
          totvs_token_expiry: expiry
        });
        const empresa = await this.db.getEmpresaById(empresaId);
        const globalConfig = await this.db.getConfig() || {};
        if (globalConfig.id && (!empresa.totvs_client_id || empresa.totvs_client_id.trim() === '')) {
          await this.db.updateGlobalTokens({
            totvs_token: token,
            totvs_token_expiry: expiry
          });
        }
      } else if (isGlobal) {
        const globalConfig = await this.db.getConfig() || {};
        if (globalConfig.id) {
          await this.db.updateGlobalTokens({
            totvs_token: token,
            totvs_token_expiry: expiry
          });
        }
      }
    };

    const client = new TotvsClient(config);
    let startDate, endDate;
    if (dataReferencia.length === 10) {
      // É um dia específico (YYYY-MM-DD)
      startDate = `${dataReferencia}T00:00:00.000Z`;
      endDate = `${dataReferencia}T23:59:59.999Z`;
    } else {
      // É um mês inteiro (YYYY-MM)
      const [ano, mes] = dataReferencia.split('-');
      const ultimoDia = new Date(ano, mes, 0).getDate();
      startDate = `${dataReferencia}-01T00:00:00.000Z`;
      endDate = `${dataReferencia}-${ultimoDia}T23:59:59.999Z`;
    }

    const labelLog = isGlobal ? 'TODAS AS EMPRESAS ATIVAS' : empresas[0].razao_social;
    this.writeLog(`🚀 Iniciando para ${labelLog} (${dataReferencia})`);

    try {
      await client.obterToken();
      const cnpjs = empresas.map(e => e.cnpj);
      const searchResult = await client.buscarInvoices({ personCpfCnpjList: cnpjs, startDate, endDate });
      const invoices = searchResult.data || [];
      
      this.writeLog(`✅ TOTVS retornou ${invoices.length} registros.`);

      if (invoices.length > 0) {
        this.writeLog(`🔍 Estrutura COMPLETA da 1ª nota: ${JSON.stringify(invoices[0])}`);
      }

      // Mapeamento rápido de CNPJ limpo para empresa correspondente
      const empMap = {};
      empresas.forEach(e => {
        empMap[e.cnpj.replace(/\D/g, '')] = e;
      });

      let salvos = 0, pulados = 0, erros = 0, ignorados = 0;
      let relatorioLog = `Relatório de Extração TOTVS\nData: ${new Date().toLocaleString()}\nPeríodo Referência: ${dataReferencia}\n\n`;
      let logSemChave = "--- NOTAS SEM CHAVE VÁLIDA NA TOTVS (Não importadas) ---\n";
      let logJaExistentes = "\n--- NOTAS IGNORADAS (Já existiam no banco de dados) ---\n";

      for (let i = 0; i < invoices.length; i++) {
        const inv = invoices[i];
        
        let chaveRaw = inv.accessKey || 
                       inv.eletronicInvoiceAccessKey || 
                       (inv.eletronic ? inv.eletronic.accessKey : null) ||
                       (inv.eletronic ? inv.eletronic.eletronicInvoiceAccessKey : null) ||
                       inv.invoiceAccessKey || 
                       inv.chNFe || 
                       inv.chaveAcesso;

        const chave = (chaveRaw || '').toString().trim();
        
        if (!chave || chave.length < 40) {
           ignorados++;
           logSemChave += `[Item ${i+1}] Seq TOTVS: ${inv.invoiceSequence || inv.invoiceCode || 'N/A'} | Emissão: ${inv.issueDate || 'N/A'} | Chave recebida: ${chaveRaw || 'NENHUMA'}\n`;
           continue;
        }

        try {
          const existente = await this.db.getNotaByChave(chave);
          if (existente) {
            this.writeLog(`⏩ Nota ${chave.substring(0,10)}... já existe no banco. Pulando.`);
            pulados++;
            logJaExistentes += `Chave: ${chave} | Emissão: ${inv.issueDate || 'N/A'} | Seq TOTVS: ${inv.invoiceSequence || inv.invoiceCode || 'N/A'}\n`;
            continue; 
          }

          this.writeLog(`📥 [${i+1}/${invoices.length}] Baixando XML da TOTVS: ${chave}`);
          const xmlContent = await client.exportarXml(chave);
          
          if (xmlContent) {
            // Tenta usar a CNPJ da primeira empresa do map como fallback pro interpretador de XML
            const firstEmpCnpj = empresas[0].cnpj;
            let parsed = xmlParser.parseNFeXml(xmlContent, firstEmpCnpj);
            if (!parsed) parsed = xmlParser.parseResNFe(xmlContent, firstEmpCnpj);

            if (parsed) {
              parsed.xml_completo = xmlContent;
              parsed.tipo = 'saida';
              
              if (parsed.data_emissao && parsed.data_emissao.includes('T')) {
                parsed.data_emissao = parsed.data_emissao.split('T')[0];
              }

              // Associa a nota à empresa correta pelo CNPJ emitente ou destinatário
              const cnpjEmit = (parsed.emitente_cnpj || '').replace(/\D/g, '');
              const cnpjDest = (parsed.destinatario_cnpj || '').replace(/\D/g, '');
              const empAlvo = empMap[cnpjEmit] || empMap[cnpjDest] || empresas[0];

              this.writeLog(`💾 Salvando Nota ${parsed.numero_nf} para Empresa: ${empAlvo.razao_social} (ID: ${empAlvo.id})`);
              await this.db.insertNota(parsed, empAlvo.id);
              salvos++;
            } else {
              this.writeLog(`❌ Erro interpretar XML: ${chave}`);
              erros++;
            }
          } else {
            this.writeLog(`⚠️ XML não disponível na TOTVS para a chave: ${chave}`);
            erros++;
          }
        } catch (err) {
          this.writeLog(`❌ Falha no processamento da nota ${chave}: ${err.message}`);
          erros++;
        }
      }

      if (ignorados > 0 || pulados > 0) {
        try {
          const dataPath = path.join(__dirname, '..', '..', 'data');
          if (!fs.existsSync(dataPath)) fs.mkdirSync(dataPath, { recursive: true });
          
          if (ignorados === 0) logSemChave = "";
          if (pulados === 0) logJaExistentes = "";
          
          fs.writeFileSync(path.join(dataPath, 'totvs_invalidas.txt'), relatorioLog + logSemChave + logJaExistentes);
        } catch(e) { console.error('Erro ao salvar log de invalidas', e); }
      }

      this.writeLog(`🏁 Fim: ${salvos} novos, ${pulados} já existiam, ${erros} falhas, ${ignorados} sem chave válida.`);
      return { success: true, encontradas: invoices.length, salvas: salvos, puladas: pulados, erros, ignorados };
    } catch (err) {
      this.writeLog(`❌ Erro: ${err.message}`);
      throw err;
    }
  }
}

module.exports = TotvsService;

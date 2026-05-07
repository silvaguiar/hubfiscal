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

  async extrair(empresaId, mesReferencia) {
    if (fs.existsSync(this.logPath)) fs.unlinkSync(this.logPath);
    
    const empresa = this.db.getEmpresaById(empresaId);
    if (!empresa) throw new Error('Empresa não encontrada');

    const globalConfig = this.db.getConfig() || {};
    let config = { ...empresa };

    // Regra simples: Se a empresa não tem URL própria, usa TUDO do global (exceto o que for específico da empresa)
    if (!config.totvs_base_url || config.totvs_base_url.trim() === '') {
      config.totvs_base_url = globalConfig.totvs_base_url;
      config.totvs_user = globalConfig.totvs_user;
      config.totvs_password = globalConfig.totvs_password;
      config.totvs_client_id = globalConfig.totvs_client_id;
      config.totvs_client_secret = globalConfig.totvs_client_secret;
      config.totvs_grant_type = globalConfig.totvs_grant_type;
      
      // IMPORTANTE: Mantemos o totvs_branch da EMPRESA, pois cada filial tem o seu
      config.totvs_branch = empresa.totvs_branch; 
    }

    const client = new TotvsClient(config);
    const [ano, mes] = mesReferencia.split('-');
    const ultimoDia = new Date(ano, mes, 0).getDate();
    const startDate = `${mesReferencia}-01T00:00:00.000Z`;
    const endDate = `${mesReferencia}-${ultimoDia}T23:59:59.999Z`;

    this.writeLog(`🚀 Iniciando para ${empresa.razao_social} (${mesReferencia})`);

    try {
      await client.obterToken();
      const searchResult = await client.buscarInvoices({ personCpfCnpjList: [empresa.cnpj], startDate, endDate });
      const invoices = searchResult.data || [];
      
      this.writeLog(`✅ TOTVS retornou ${invoices.length} registros.`);

      if (invoices.length > 0) {
        // LOG COMPLETO para não termos mais dúvidas
        this.writeLog(`🔍 Estrutura COMPLETA da 1ª nota: ${JSON.stringify(invoices[0])}`);
      }

      let salvos = 0, pulados = 0, erros = 0, ignorados = 0;
      let relatorioLog = `Relatório de Extração TOTVS\nData: ${new Date().toLocaleString()}\nEmpresa: ${empresa.razao_social} (ID: ${empresa.id})\nMês Referência: ${mesReferencia}\n\n`;
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
          const existente = this.db.getNotaByChave(chave);
          if (existente) {
            this.writeLog(`⏩ Nota ${chave.substring(0,10)}... já existe no banco. Pulando.`);
            pulados++;
            logJaExistentes += `Chave: ${chave} | Emissão: ${inv.issueDate || 'N/A'} | Seq TOTVS: ${inv.invoiceSequence || inv.invoiceCode || 'N/A'}\n`;
            continue; 
          }

          this.writeLog(`📥 [${i+1}/${invoices.length}] Baixando XML da TOTVS: ${chave}`);
          const xmlContent = await client.exportarXml(chave);
          
          if (xmlContent) {
            let parsed = xmlParser.parseNFeXml(xmlContent, empresa.cnpj);
            if (!parsed) parsed = xmlParser.parseResNFe(xmlContent, empresa.cnpj);

            if (parsed) {
              parsed.xml_completo = xmlContent;
              parsed.tipo = 'saida';
              
              if (parsed.data_emissao && parsed.data_emissao.includes('T')) {
                parsed.data_emissao = parsed.data_emissao.split('T')[0];
              }

              this.writeLog(`💾 Salvando Nota ${parsed.numero_nf} para Empresa ID: ${empresa.id}`);
              this.db.insertNota(parsed, empresa.id);
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

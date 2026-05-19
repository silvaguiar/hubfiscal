/**
 * Domínio Service — Orquestra o envio de notas fiscais para o Domínio
 * 
 * Suporta envio individual, em lote, e reenvio de notas com erro.
 * Utiliza o DominioClient para comunicação com a API.
 */
const DominioClient = require('./dominio');
const fs = require('fs');
const path = require('path');

class DominioService {
  constructor(db) {
    this.db = db;
    this.logPath = path.join(__dirname, '..', '..', 'dominio_sync.log');
  }

  writeLog(msg) {
    const time = new Date().toLocaleTimeString();
    const line = `[${time}] ${msg}\n`;
    fs.appendFileSync(this.logPath, line);
    console.log(line.trim());
  }

  /**
   * Monta o client usando config da empresa + config global como fallback
   */
  _buildClient(empresa, globalConfig = {}) {
    const config = {
      dominio_client_id: empresa.dominio_client_id || globalConfig.dominio_client_id || '',
      dominio_client_secret: empresa.dominio_client_secret || globalConfig.dominio_client_secret || '',
      dominio_integration_key: empresa.dominio_integration_key || '',
      dominio_auth_url: empresa.dominio_auth_url || globalConfig.dominio_auth_url || '',
      dominio_api_url: empresa.dominio_api_url || globalConfig.dominio_api_url || '',
      
      // Carrega os tokens persistidos no banco
      dominio_token: empresa.dominio_token || globalConfig.dominio_token || null,
      dominio_token_expiry: empresa.dominio_token_expiry || globalConfig.dominio_token_expiry || null,
      
      // Callback para atualizar o banco ao gerar um token novo
      onTokenUpdated: async (token, expiry) => {
        if (empresa.id) {
          await this.db.updateEmpresaTokens(empresa.id, {
            dominio_token: token,
            dominio_token_expiry: expiry
          });
        }
        // Se estiver usando credenciais globais, também atualiza as globais
        if (globalConfig.id && (!empresa.dominio_client_id || empresa.dominio_client_id.trim() === '')) {
          await this.db.updateGlobalTokens({
            dominio_token: token,
            dominio_token_expiry: expiry
          });
        }
      }
    };

    return new DominioClient(config);
  }

  /**
   * Envia notas pendentes de uma empresa para o Domínio
   * @param {number} empresaId - ID da empresa
   * @param {object} filtros - { dataInicio, dataFim, tipo, reenviar }
   * @returns {object} Resultado do envio
   */
  async enviar(empresaId, filtros = {}) {
    // Limpa log anterior
    if (fs.existsSync(this.logPath)) fs.unlinkSync(this.logPath);

    const empresa = await this.db.getEmpresaById(empresaId);
    if (!empresa) throw new Error('Empresa não encontrada');
    if (!empresa.dominio_ativo) throw new Error('Integração Domínio não está ativa para esta empresa.');

    const globalConfig = await this.db.getConfig() || {};
    const client = this._buildClient(empresa, globalConfig);

    // Busca notas para enviar
    const notas = await this.db.getNotasParaDominio(empresaId, filtros);

    this.writeLog(`🚀 Iniciando envio para Domínio: ${empresa.razao_social || empresa.cnpj}`);
    this.writeLog(`📋 ${notas.length} nota(s) para enviar.`);

    if (notas.length === 0) {
      this.writeLog('✅ Nenhuma nota pendente para envio.');
      return { success: true, enviadas: 0, erros: 0, total: 0 };
    }

    // Testa conexão primeiro
    this.writeLog('🔑 Testando conexão com o Domínio...');
    const testeConexao = await client.testarConexao();
    if (!testeConexao.success) {
      this.writeLog(`❌ Falha na conexão: ${testeConexao.message}`);
      throw new Error(`Falha na conexão com Domínio: ${testeConexao.message}`);
    }
    this.writeLog('✅ Conexão OK. Iniciando envio...');

    let enviadas = 0;
    let errosCount = 0;
    const BATCH_SIZE = 10; // Enviar em lotes de 10

    // O envio individual é o método mais confiável na API da Domínio, garantindo que
    // cada nota seja processada com sucesso real (e não de forma silenciosa/assíncrona que esconde erros).
    for (let i = 0; i < notas.length; i++) {
      const nota = notas[i];

      if (!nota.xml_completo || nota.xml_completo.trim() === '') {
        this.writeLog(`⚠️ [${i + 1}/${notas.length}] Nota ${nota.numero_nf || nota.chave_acesso} sem XML. Pulando.`);
        await this.db.updateDominioStatus(nota.id, 'erro', 'XML não disponível');
        errosCount++;
        continue;
      }

      this.writeLog(`📤 [${i + 1}/${notas.length}] Enviando NF ${nota.numero_nf || 'S/N'} — Chave: ${nota.chave_acesso.substring(0, 15)}...`);

      try {
        // Marca como "enviando" antes
        await this.db.updateDominioStatus(nota.id, 'enviando');

        const result = await client.enviarXml(nota.xml_completo, {
          chave: nota.chave_acesso,
          tipo: nota.tipo,
          numero: nota.numero_nf
        });

        if (result.success) {
          await this.db.updateDominioStatus(nota.id, 'enviado', null, result.batchId);
          this.writeLog(`✅ NF ${nota.numero_nf || 'S/N'} enviada com sucesso.`);
          enviadas++;
        } else {
          await this.db.updateDominioStatus(nota.id, 'erro', result.error);
          this.writeLog(`❌ Erro ao enviar NF ${nota.numero_nf || 'S/N'}: ${result.error}`);
          errosCount++;
        }
      } catch (err) {
        await this.db.updateDominioStatus(nota.id, 'erro', err.message);
        this.writeLog(`❌ Exceção ao enviar NF ${nota.numero_nf || 'S/N'}: ${err.message}`);
        errosCount++;
      }

      // Delay entre envios para não sobrecarregar a API
      if (i < notas.length - 1) {
        await new Promise(r => setTimeout(r, 500));
      }
    }

    this.writeLog(`\n🏁 Envio finalizado: ${enviadas} enviada(s), ${errosCount} erro(s), ${notas.length} total.`);
    return { success: true, enviadas, erros: errosCount, total: notas.length };
  }

  /**
   * Testa a conexão com o Domínio para uma empresa
   */
  async testarConexao(empresaId) {
    const empresa = await this.db.getEmpresaById(empresaId);
    if (!empresa) throw new Error('Empresa não encontrada');
    const globalConfig = await this.db.getConfig() || {};
    const client = this._buildClient(empresa, globalConfig);
    const result = await client.testarConexao();
    
    if (result.novaChave && result.novaChave !== empresa.dominio_integration_key) {
      // Salva a chave final ativada (JWT) no banco
      empresa.dominio_integration_key = result.novaChave;
      await this.db.updateEmpresa(empresaId, empresa);
    }
    
    return result;
  }
}

module.exports = DominioService;

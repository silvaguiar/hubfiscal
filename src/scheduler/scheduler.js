/**
 * Scheduler Engine — Motor de agendamento com node-cron
 * Carrega jobs do banco de dados e os executa conforme expressão cron
 */
const cron = require('node-cron');
const { executarTotvsJob } = require('./jobs/totvs.job');
const { executarDominioJob } = require('./jobs/dominio.job');
const { executarPortalNfseJob } = require('./jobs/portal-nfse.job');

class Scheduler {
  constructor(db) {
    this.db = db;
    this.jobs = new Map(); // agendamento_id → cron task
  }

  /**
   * Inicializa o scheduler carregando todos os agendamentos ativos do banco
   */
  async inicializar() {
    console.log('⏰ Iniciando motor de agendamento...');
    await this.recarregar();
    this._registrarPurgeAutomatico();
  }

  _registrarPurgeAutomatico() {
    // Dias 1 e 16 de cada mês às 02:00 — exclui notas enviadas há mais de 15 dias
    cron.schedule('0 2 1,16 * *', async () => {
      try {
        const total = await this.db.purgarNotasEnviadas();
        console.log(`🧹 [AUTO-PURGE] ${total} nota(s) enviadas removidas automaticamente.`);
      } catch (err) {
        console.error('❌ [AUTO-PURGE] Erro na limpeza automática:', err.message);
      }
    }, { scheduled: true, timezone: 'America/Sao_Paulo' });

    console.log('🧹 [AUTO-PURGE] Limpeza automática agendada (dias 1 e 16 às 02:00).');
  }

  /**
   * Para todos os jobs e recarrega do banco
   */
  async recarregar() {
    // Para jobs existentes
    for (const [id, task] of this.jobs) {
      task.stop();
    }
    this.jobs.clear();

    // Recarrega agendamentos ativos
    const agendamentosAll = await this.db.getAgendamentos();
    const agendamentos = agendamentosAll.filter(a => a.ativo);
    
    for (const ag of agendamentos) {
      this._registrarJob(ag);
    }

    console.log(`⏰ Scheduler: ${agendamentos.length} job(s) ativo(s) carregados.`);
  }

  /**
   * Registra um único job cron
   */
  _registrarJob(agendamento) {
    const expressao = agendamento.cron_expressao || '0 6 * * *';

    if (!cron.validate(expressao)) {
      console.warn(`⚠️ [SCHEDULER] Expressão cron inválida para job ${agendamento.id}: "${expressao}"`);
      return;
    }

    const task = cron.schedule(expressao, async () => {
      console.log(`⏰ [SCHEDULER] Disparando job ${agendamento.tipo} (empresa_id: ${agendamento.empresa_id})`);
      try {
        // Recarrega o agendamento do banco antes de executar (pode ter sido atualizado)
        const ag = await this.db.getAgendamentoById(agendamento.id);
        if (!ag || !ag.ativo) return;
        await this.executarAgora(ag);
      } catch (err) {
        console.error(`[SCHEDULER] Erro na execução automática do job ${agendamento.id}:`, err.message);
      }
    }, {
      scheduled: true,
      timezone: 'America/Sao_Paulo'
    });

    this.jobs.set(agendamento.id, task);
    console.log(`✅ [SCHEDULER] Job registrado: ${agendamento.tipo} | Empresa ${agendamento.empresa_id} | Cron: ${expressao}`);
  }

  /**
   * Executa um job imediatamente (uso manual ou automático)
   */
  async executarAgora(agendamento) {
    await this.db.updateAgendamentoStatus(agendamento.id, 'executando', null);
    
    if (agendamento.tipo === 'totvs_sync') {
      return executarTotvsJob(this.db, agendamento);
    } else if (agendamento.tipo === 'dominio_envio') {
      return executarDominioJob(this.db, agendamento);
    } else if (agendamento.tipo === 'portal_nfse') {
      return executarPortalNfseJob(this.db, agendamento);
    } else {
      throw new Error(`Tipo de job desconhecido: ${agendamento.tipo}`);
    }
  }

  /**
   * Para todos os jobs (para shutdown do servidor)
   */
  parar() {
    for (const [id, task] of this.jobs) {
      task.stop();
    }
    this.jobs.clear();
    console.log('⏰ Scheduler parado.');
  }
}

module.exports = Scheduler;

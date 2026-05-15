/**
 * Job: Envio automático ao Domínio
 * Envia notas pendentes para o sistema contábil Domínio
 */
const DominioService = require('../../integracoes/dominio-service');

async function executarDominioJob(db, agendamento) {
  const inicio = Date.now();

  try {
    const empresa = db.getEmpresaById(agendamento.empresa_id);
    if (!empresa || !empresa.dominio_ativo) {
      throw new Error('Empresa não encontrada ou integração Domínio não está ativa.');
    }

    console.log(`[SCHEDULER][DOMÍNIO] Empresa ${empresa.razao_social || empresa.cnpj} — Enviando pendentes...`);

    const service = new DominioService(db);
    // enviar(empresaId, filtros) — filtros vazios = busca todas as pendentes
    const result = await service.enviar(agendamento.empresa_id, {});

    const notas_enviadas = result.enviadas || 0;
    const detalhes = JSON.stringify(result);

    db.updateAgendamentoStatus(agendamento.id, 'sucesso', detalhes);
    db.registrarLogExecucao({
      agendamento_id: agendamento.id,
      empresa_id: agendamento.empresa_id,
      tipo: 'dominio_envio',
      status: 'sucesso',
      notas_encontradas: result.total || 0,
      notas_inseridas: 0,
      notas_enviadas,
      detalhes,
      duracao_ms: Date.now() - inicio
    });

    console.log(`[SCHEDULER][DOMÍNIO] ✅ Concluído: ${notas_enviadas} nota(s) enviada(s).`);
    return { notas_enviadas };

  } catch (err) {
    console.error(`[SCHEDULER][DOMÍNIO] ❌ Erro:`, err.message);
    db.updateAgendamentoStatus(agendamento.id, 'erro', err.message);
    db.registrarLogExecucao({
      agendamento_id: agendamento.id,
      empresa_id: agendamento.empresa_id,
      tipo: 'dominio_envio',
      status: 'erro',
      notas_encontradas: 0,
      notas_inseridas: 0,
      notas_enviadas: 0,
      detalhes: err.message,
      duracao_ms: Date.now() - inicio
    });
    throw err;
  }
}

module.exports = { executarDominioJob };

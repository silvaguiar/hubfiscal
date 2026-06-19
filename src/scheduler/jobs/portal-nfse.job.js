/**
 * Job: Sincronização Portal Nacional NFS-e
 * Busca NFS-e emitidas e recebidas para D-N (dias de offset)
 */
const PortalNfseService = require('../../integracoes/portal-nfse-service');

async function executarPortalNfseJob(db, agendamento) {
  const logId = await db.registrarLogExecucao({
    agendamento_id: agendamento.id,
    empresa_id: agendamento.empresa_id,
    tipo: 'portal_nfse',
    status: 'executando',
    notas_encontradas: 0,
    notas_inseridas: 0,
    detalhes: 'Iniciando...',
    duracao_ms: 0
  });

  try {
    await db.updateAgendamentoStatus(agendamento.id, 'executando', 'Iniciando...');

    const diasOffset = agendamento.dias_offset || 2;
    const hoje = new Date();
    const dtInicio = new Date(hoje);
    dtInicio.setDate(hoje.getDate() - diasOffset);
    const fmt = d => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;

    console.log(`[SCHEDULER][NFS-e] D-${diasOffset} → ${fmt(dtInicio)} a ${fmt(hoje)}`);

    const service = new PortalNfseService(db);
    const result = await service.sincronizar(
      agendamento.empresa_id,
      fmt(dtInicio),
      fmt(hoje),
      logId
    );

    await db.updateAgendamentoStatus(agendamento.id, 'sucesso', JSON.stringify(result));
    console.log(`[SCHEDULER][NFS-e] ✅ ${result.encontradas} encontradas, ${result.salvas} salvas.`);
    return { notas_encontradas: result.encontradas, notas_inseridas: result.salvas };

  } catch (err) {
    console.error(`[SCHEDULER][NFS-e] ❌ Erro:`, err.message);
    await db.updateAgendamentoStatus(agendamento.id, 'erro', err.message);
    await db.updateLogExecucao(logId, { status: 'erro', detalhes: err.message, duracao_ms: 0 });
    throw err;
  }
}

module.exports = { executarPortalNfseJob };

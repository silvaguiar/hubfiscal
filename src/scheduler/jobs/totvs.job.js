/**
 * Job: Sincronização TOTVS
 * Busca NF-e no TOTVS para D-N (dias de offset)
 */
const TotvsService = require('../../integracoes/totvs-service');

async function executarTotvsJob(db, agendamento) {
  const inicio = Date.now();

  try {
    const empresa = db.getEmpresaById(agendamento.empresa_id);
    if (!empresa || !empresa.totvs_ativo) {
      throw new Error('Empresa não encontrada ou TOTVS não ativo para esta empresa.');
    }

    // Calcular o mês de referência baseado no D-N
    const diasOffset = agendamento.dias_offset || 2;
    const dataRef = new Date();
    dataRef.setDate(dataRef.getDate() - diasOffset);
    const ano = dataRef.getFullYear();
    const mes = String(dataRef.getMonth() + 1).padStart(2, '0');
    const mesReferencia = `${ano}-${mes}`; // Formato: YYYY-MM

    console.log(`[SCHEDULER][TOTVS] Empresa ${empresa.razao_social || empresa.cnpj} — D-${diasOffset} → mês ${mesReferencia}`);

    const service = new TotvsService(db);
    const result = await service.extrair(agendamento.empresa_id, mesReferencia);

    const notas_encontradas = result.encontradas || 0;
    const notas_inseridas   = result.salvas || 0;
    const detalhes = JSON.stringify(result);

    db.updateAgendamentoStatus(agendamento.id, 'sucesso', detalhes);
    db.registrarLogExecucao({
      agendamento_id: agendamento.id,
      empresa_id: agendamento.empresa_id,
      tipo: 'totvs_sync',
      status: 'sucesso',
      notas_encontradas,
      notas_inseridas,
      notas_enviadas: 0,
      detalhes,
      duracao_ms: Date.now() - inicio
    });

    console.log(`[SCHEDULER][TOTVS] ✅ ${notas_encontradas} encontradas, ${notas_inseridas} inseridas.`);
    return { notas_encontradas, notas_inseridas };

  } catch (err) {
    console.error(`[SCHEDULER][TOTVS] ❌ Erro:`, err.message);
    db.updateAgendamentoStatus(agendamento.id, 'erro', err.message);
    db.registrarLogExecucao({
      agendamento_id: agendamento.id,
      empresa_id: agendamento.empresa_id,
      tipo: 'totvs_sync',
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

module.exports = { executarTotvsJob };

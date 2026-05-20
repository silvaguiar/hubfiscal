/**
 * Job: Sincronização TOTVS
 * Busca NF-e no TOTVS para D-N (dias de offset)
 */
const TotvsService = require('../../integracoes/totvs-service');

async function executarTotvsJob(db, agendamento) {
  try {
    await db.updateAgendamentoStatus(agendamento.id, 'executando', 'Iniciando...');

    if (agendamento.empresa_id) {
      const empresa = await db.getEmpresaById(agendamento.empresa_id);
      if (!empresa || (!empresa.totvs_ativo && empresa.totvs_ativo !== 1 && empresa.totvs_ativo !== '1')) {
        throw new Error('Empresa não encontrada ou TOTVS não ativo para esta empresa.');
      }
    }

    const diasOffset = agendamento.dias_offset || 2;
    const dataRef = new Date();
    dataRef.setDate(dataRef.getDate() - diasOffset);
    const dataExata = `${dataRef.getFullYear()}-${String(dataRef.getMonth() + 1).padStart(2, '0')}-${String(dataRef.getDate()).padStart(2, '0')}`;

    console.log(`[SCHEDULER][TOTVS] D-${diasOffset} → Data: ${dataExata}`);

    // service.extrair() já cria e gerencia seu próprio log em logs_execucao
    const service = new TotvsService(db);
    const result = await service.extrair(agendamento.empresa_id, dataExata);

    const detalhes = JSON.stringify(result);
    await db.updateAgendamentoStatus(agendamento.id, 'sucesso', detalhes);

    console.log(`[SCHEDULER][TOTVS] ✅ ${result.encontradas || 0} encontradas, ${result.salvas || 0} inseridas.`);
    return { notas_encontradas: result.encontradas || 0, notas_inseridas: result.salvas || 0 };

  } catch (err) {
    console.error(`[SCHEDULER][TOTVS] ❌ Erro:`, err.message);
    await db.updateAgendamentoStatus(agendamento.id, 'erro', err.message);
    throw err;
  }
}

module.exports = { executarTotvsJob };

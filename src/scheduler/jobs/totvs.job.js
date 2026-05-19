/**
 * Job: Sincronização TOTVS
 * Busca NF-e no TOTVS para D-N (dias de offset)
 */
const TotvsService = require('../../integracoes/totvs-service');

async function executarTotvsJob(db, agendamento) {
  const inicio = Date.now();
  let logId = null;

  try {
    logId = await db.registrarLogExecucao({
      agendamento_id: agendamento.id,
      empresa_id: agendamento.empresa_id,
      tipo: 'totvs_sync',
      status: 'executando',
      notas_encontradas: 0,
      notas_inseridas: 0,
      notas_enviadas: 0,
      detalhes: 'Iniciando execução...',
      duracao_ms: 0
    });
    
    await db.updateAgendamentoStatus(agendamento.id, 'executando', 'Iniciando...');
 
    let label = 'Todas as Empresas Ativas';
    if (agendamento.empresa_id) {
      const empresa = await db.getEmpresaById(agendamento.empresa_id);
      if (!empresa || (!empresa.totvs_ativo && empresa.totvs_ativo !== 1 && empresa.totvs_ativo !== '1')) {
        throw new Error('Empresa não encontrada ou TOTVS não ativo para esta empresa.');
      }
      label = empresa.razao_social || empresa.cnpj;
    }
 
    // Calcular o dia exato de referência baseado no D-N
    const diasOffset = agendamento.dias_offset || 2;
    const dataRef = new Date();
    dataRef.setDate(dataRef.getDate() - diasOffset);
    const ano = dataRef.getFullYear();
    const mes = String(dataRef.getMonth() + 1).padStart(2, '0');
    const dia = String(dataRef.getDate()).padStart(2, '0');
    const dataExata = `${ano}-${mes}-${dia}`; // Formato: YYYY-MM-DD
 
    console.log(`[SCHEDULER][TOTVS] ${label} — D-${diasOffset} → Data: ${dataExata}`);
 
    const service = new TotvsService(db);
    const result = await service.extrair(agendamento.empresa_id, dataExata);

    const notas_encontradas = result.encontradas || 0;
    const notas_inseridas   = result.salvas || 0;
    const detalhes = JSON.stringify(result);

    await db.updateAgendamentoStatus(agendamento.id, 'sucesso', detalhes);
    await db.updateLogExecucao(logId, {
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
    await db.updateAgendamentoStatus(agendamento.id, 'erro', err.message);
    if (logId) {
      await db.updateLogExecucao(logId, {
        status: 'erro',
        notas_encontradas: 0,
        notas_inseridas: 0,
        notas_enviadas: 0,
        detalhes: err.message,
        duracao_ms: Date.now() - inicio
      });
    }
    throw err;
  }
}

module.exports = { executarTotvsJob };

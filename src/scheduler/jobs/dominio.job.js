/**
 * Job: Envio automático ao Domínio
 * Envia notas pendentes para o sistema contábil Domínio
 */
const DominioService = require('../../integracoes/dominio-service');

async function executarDominioJob(db, agendamento) {
  const inicio = Date.now();
  let logId = null;

  try {
    logId = await db.registrarLogExecucao({
      agendamento_id: agendamento.id,
      empresa_id: agendamento.empresa_id,
      tipo: 'dominio_envio',
      status: 'executando',
      notas_encontradas: 0,
      notas_inseridas: 0,
      notas_enviadas: 0,
      detalhes: 'Iniciando envio...',
      duracao_ms: 0
    });
    
    await db.updateAgendamentoStatus(agendamento.id, 'executando', 'Iniciando...');
 
    let empresas = [];
    let isGlobal = false;
    let label = 'Todas as Empresas Ativas';

    if (agendamento.empresa_id) {
      const empresa = await db.getEmpresaById(agendamento.empresa_id);
      if (!empresa || (!empresa.dominio_ativo && empresa.dominio_ativo !== 1 && empresa.dominio_ativo !== '1')) {
        throw new Error('Empresa não encontrada ou integração Domínio não está ativa.');
      }
      empresas = [empresa];
      label = empresa.razao_social || empresa.cnpj;
    } else {
      isGlobal = true;
      const todas = await db.getEmpresas();
      empresas = todas.filter(e => e.dominio_ativo === true || e.dominio_ativo === 'true' || e.dominio_ativo == 1);
      if (empresas.length === 0) throw new Error('Nenhuma empresa ativa com integração Domínio cadastrada.');
    }
 
    console.log(`[SCHEDULER][DOMÍNIO] ${label} — Enviando pendentes...`);

    const service = new DominioService(db);

    // Em modo lote: pré-aquece o token uma vez para o primeiro conjunto de credenciais.
    // Como o DominioClient usa cache em memória keyed por clientId, as demais empresas
    // que compartilham as mesmas credenciais reutilizarão o mesmo token automaticamente,
    // garantindo no máximo 1 geração de token por conjunto de credenciais por execução.
    if (isGlobal && empresas.length > 0) {
      console.log('[SCHEDULER][DOMÍNIO] Pré-aquecendo token antes do lote...');
      try { await service.testarConexao(empresas[0].id); } catch (_) {}
    }

    let totalEnviadas = 0;
    let totalErros = 0;
    let totalGeral = 0;
    let resultadosLote = [];

    for (const emp of empresas) {
      console.log(`[SCHEDULER][DOMÍNIO] Iniciando lote para: ${emp.razao_social}`);
      try {
        const result = await service.enviar(emp.id, {});
        totalEnviadas += result.enviadas || 0;
        totalErros += result.erros || 0;
        totalGeral += result.total || 0;
        resultadosLote.push({ empresa: emp.razao_social, success: true, ...result });
      } catch (err) {
        console.error(`[SCHEDULER][DOMÍNIO] Falha no envio da empresa ${emp.razao_social}:`, err.message);
        resultadosLote.push({ empresa: emp.razao_social, success: false, error: err.message });
      }
      // Persiste os totais parciais após cada empresa — garante que um restart
      // não zerará as contagens já registradas
      if (logId) {
        await db.updateLogExecucao(logId, {
          notas_encontradas: totalGeral,
          notas_enviadas: totalEnviadas,
          detalhes: JSON.stringify({ total: totalGeral, enviadas: totalEnviadas, erros: totalErros, lote: resultadosLote })
        }).catch(() => {});
      }
    }
 
    const detalhes = JSON.stringify({ total: totalGeral, enviadas: totalEnviadas, erros: totalErros, lote: resultadosLote });
 
    await db.updateAgendamentoStatus(agendamento.id, 'sucesso', detalhes);
    await db.updateLogExecucao(logId, {
      status: 'sucesso',
      notas_encontradas: totalGeral,
      notas_inseridas: 0,
      notas_enviadas: totalEnviadas,
      detalhes,
      duracao_ms: Date.now() - inicio
    });
 
    console.log(`[SCHEDULER][DOMÍNIO] ✅ Concluído Lote: ${totalEnviadas} nota(s) enviada(s).`);
    return { notas_enviadas: totalEnviadas };

  } catch (err) {
    console.error(`[SCHEDULER][DOMÍNIO] ❌ Erro:`, err.message);
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

module.exports = { executarDominioJob };

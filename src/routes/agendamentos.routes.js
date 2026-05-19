/**
 * Agendamentos Routes — CRUD + execução manual de jobs
 */
const express = require('express');
const router = express.Router();
const { requireAuth, requirePerfil } = require('../auth/middleware');

module.exports = function (db, scheduler) {

  // GET /api/agendamentos — lista todos os agendamentos
  router.get('/', requireAuth, async (req, res) => {
    try {
      const agendamentos = await db.getAgendamentos();
      res.json(agendamentos);
    } catch (err) { res.status(500).json({ error: err.message }); }
  });

  // POST /api/agendamentos — criar agendamento
  router.post('/', requireAuth, requirePerfil('operador', 'admin', 'master'), async (req, res) => {
    try {
      const { empresa_id, tipo, nome, cron_expressao, dias_offset, ativo } = req.body;
      if (!empresa_id || !tipo) return res.status(400).json({ error: 'empresa_id e tipo são obrigatórios.' });
      const ag = await db.createAgendamento({ empresa_id, tipo, nome, cron_expressao, dias_offset, ativo });
      scheduler.recarregar();
      res.json({ success: true, agendamento: ag });
    } catch (err) { res.status(500).json({ error: err.message }); }
  });

  // PUT /api/agendamentos/:id — atualizar agendamento
  router.put('/:id', requireAuth, requirePerfil('operador', 'admin', 'master'), async (req, res) => {
    try {
      const id = parseInt(req.params.id);
      const ag = await db.updateAgendamento(id, req.body);
      scheduler.recarregar();
      res.json({ success: true, agendamento: ag });
    } catch (err) { res.status(500).json({ error: err.message }); }
  });

  // DELETE /api/agendamentos/:id
  router.delete('/:id', requireAuth, requirePerfil('admin', 'master'), async (req, res) => {
    try {
      await db.deleteAgendamento(parseInt(req.params.id));
      scheduler.recarregar();
      res.json({ success: true });
    } catch (err) { res.status(500).json({ error: err.message }); }
  });

  // POST /api/agendamentos/:id/executar — executa o job manualmente agora
  router.post('/:id/executar', requireAuth, requirePerfil('operador', 'admin', 'master'), async (req, res) => {
    try {
      const id = parseInt(req.params.id);
      const agendamento = await db.getAgendamentoById(id);
      if (!agendamento) return res.status(404).json({ error: 'Agendamento não encontrado.' });
      
      res.json({ success: true, message: 'Execução iniciada em segundo plano.' });
      
      // Executa em background e captura erros localmente para não tentar reenviar resposta HTTP
      scheduler.executarAgora(agendamento).catch(err => {
        console.error(`[Agendamento ${id}] Erro na execução manual em background:`, err.message);
      });
    } catch (err) { 
      res.status(500).json({ error: err.message }); 
    }
  });

  // GET /api/agendamentos/logs — histórico de execuções
  router.get('/logs', requireAuth, async (req, res) => {
    try {
      const { agendamento_id, empresa_id, limite, tipo, status } = req.query;
      let logs = await db.getLogsExecucao({
        agendamento_id: agendamento_id ? parseInt(agendamento_id) : null,
        empresa_id: empresa_id ? parseInt(empresa_id) : null,
        tipo,
        status,
        limite: parseInt(limite) || 50
      });
      if (!status && Array.isArray(logs)) {
        logs = logs.filter(l => l.status !== 'in_progress');
      }
      res.json(logs);
    } catch (err) { res.status(500).json({ error: err.message }); }
  });

  return router;
};

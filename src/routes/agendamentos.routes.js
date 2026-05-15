/**
 * Agendamentos Routes — CRUD + execução manual de jobs
 */
const express = require('express');
const router = express.Router();
const { requireAuth, requirePerfil } = require('../auth/middleware');

module.exports = function (db, scheduler) {

  // GET /api/agendamentos — lista todos os agendamentos
  router.get('/', requireAuth, (req, res) => {
    try {
      const agendamentos = db.getAgendamentos();
      res.json(agendamentos);
    } catch (err) { res.status(500).json({ error: err.message }); }
  });

  // POST /api/agendamentos — criar agendamento
  router.post('/', requireAuth, requirePerfil('operador', 'admin', 'master'), (req, res) => {
    try {
      const { empresa_id, tipo, cron_expressao, dias_offset, ativo } = req.body;
      if (!empresa_id || !tipo) return res.status(400).json({ error: 'empresa_id e tipo são obrigatórios.' });
      const ag = db.createAgendamento({ empresa_id, tipo, cron_expressao, dias_offset, ativo });
      scheduler.recarregar();
      res.json({ success: true, agendamento: ag });
    } catch (err) { res.status(500).json({ error: err.message }); }
  });

  // PUT /api/agendamentos/:id — atualizar agendamento
  router.put('/:id', requireAuth, requirePerfil('operador', 'admin', 'master'), (req, res) => {
    try {
      const id = parseInt(req.params.id);
      const ag = db.updateAgendamento(id, req.body);
      scheduler.recarregar();
      res.json({ success: true, agendamento: ag });
    } catch (err) { res.status(500).json({ error: err.message }); }
  });

  // DELETE /api/agendamentos/:id
  router.delete('/:id', requireAuth, requirePerfil('admin', 'master'), (req, res) => {
    try {
      db.deleteAgendamento(parseInt(req.params.id));
      scheduler.recarregar();
      res.json({ success: true });
    } catch (err) { res.status(500).json({ error: err.message }); }
  });

  // POST /api/agendamentos/:id/executar — executa o job manualmente agora
  router.post('/:id/executar', requireAuth, requirePerfil('operador', 'admin', 'master'), async (req, res) => {
    try {
      const id = parseInt(req.params.id);
      const agendamento = db.getAgendamentoById(id);
      if (!agendamento) return res.status(404).json({ error: 'Agendamento não encontrado.' });
      
      res.json({ success: true, message: 'Execução iniciada em segundo plano.' });
      await scheduler.executarAgora(agendamento);
    } catch (err) { res.status(500).json({ error: err.message }); }
  });

  // GET /api/agendamentos/logs — histórico de execuções
  router.get('/logs', requireAuth, (req, res) => {
    try {
      const { agendamento_id, empresa_id, limite } = req.query;
      const logs = db.getLogsExecucao({
        agendamento_id: agendamento_id ? parseInt(agendamento_id) : null,
        empresa_id: empresa_id ? parseInt(empresa_id) : null,
        limite: parseInt(limite) || 50
      });
      res.json(logs);
    } catch (err) { res.status(500).json({ error: err.message }); }
  });

  return router;
};

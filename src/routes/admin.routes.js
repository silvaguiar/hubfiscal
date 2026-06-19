/**
 * Admin Routes — /api/planos e /api/clientes (apenas master)
 */
const express = require('express');
const router = express.Router();
const { requireAuth, requirePerfil } = require('../auth/middleware');

module.exports = function (db) {

  // ── PLANOS ────────────────────────────────────────────────────────────────

  // GET /api/planos
  router.get('/planos', requireAuth, requirePerfil('master'), async (req, res) => {
    try {
      const planos = await db.getPlanos();
      res.json(planos);
    } catch (err) { res.status(500).json({ error: err.message }); }
  });

  // POST /api/planos
  router.post('/planos', requireAuth, requirePerfil('master'), async (req, res) => {
    try {
      const { nome, descricao, max_empresas, preco_mensal } = req.body;
      if (!nome) return res.status(400).json({ error: 'Nome é obrigatório.' });
      if (max_empresas === undefined) return res.status(400).json({ error: 'max_empresas é obrigatório.' });
      const plano = await db.createPlano({ nome, descricao, max_empresas, preco_mensal });
      res.json({ success: true, plano });
    } catch (err) { res.status(500).json({ error: err.message }); }
  });

  // PUT /api/planos/:id
  router.put('/planos/:id', requireAuth, requirePerfil('master'), async (req, res) => {
    try {
      const plano = await db.updatePlano(parseInt(req.params.id), req.body);
      res.json({ success: true, plano });
    } catch (err) { res.status(500).json({ error: err.message }); }
  });

  // DELETE /api/planos/:id
  router.delete('/planos/:id', requireAuth, requirePerfil('master'), async (req, res) => {
    try {
      await db.deletePlano(parseInt(req.params.id));
      res.json({ success: true });
    } catch (err) { res.status(500).json({ error: err.message }); }
  });

  // ── CLIENTES ──────────────────────────────────────────────────────────────

  // GET /api/clientes
  router.get('/clientes', requireAuth, requirePerfil('master'), async (req, res) => {
    try {
      const clientes = await db.getClientes();
      res.json(clientes);
    } catch (err) { res.status(500).json({ error: err.message }); }
  });

  // GET /api/clientes/:id
  router.get('/clientes/:id', requireAuth, requirePerfil('master'), async (req, res) => {
    try {
      const cliente = await db.getClienteById(parseInt(req.params.id));
      if (!cliente) return res.status(404).json({ error: 'Cliente não encontrado.' });
      res.json(cliente);
    } catch (err) { res.status(500).json({ error: err.message }); }
  });

  // GET /api/clientes/:id/uso
  router.get('/clientes/:id/uso', requireAuth, requirePerfil('master'), async (req, res) => {
    try {
      const uso = await db.getClienteUso(parseInt(req.params.id));
      if (!uso) return res.status(404).json({ error: 'Cliente não encontrado.' });
      res.json(uso);
    } catch (err) { res.status(500).json({ error: err.message }); }
  });

  // POST /api/clientes
  router.post('/clientes', requireAuth, requirePerfil('master'), async (req, res) => {
    try {
      const { nome, email, telefone, plano_id, status, data_vencimento, observacoes } = req.body;
      if (!nome) return res.status(400).json({ error: 'Nome é obrigatório.' });
      const cliente = await db.createCliente({ nome, email, telefone, plano_id, status, data_vencimento, observacoes });
      res.json({ success: true, cliente });
    } catch (err) { res.status(500).json({ error: err.message }); }
  });

  // PUT /api/clientes/:id
  router.put('/clientes/:id', requireAuth, requirePerfil('master'), async (req, res) => {
    try {
      const cliente = await db.updateCliente(parseInt(req.params.id), req.body);
      res.json({ success: true, cliente });
    } catch (err) { res.status(500).json({ error: err.message }); }
  });

  // DELETE /api/clientes/:id
  router.delete('/clientes/:id', requireAuth, requirePerfil('master'), async (req, res) => {
    try {
      await db.deleteCliente(parseInt(req.params.id));
      res.json({ success: true });
    } catch (err) { res.status(500).json({ error: err.message }); }
  });

  return router;
};

/**
 * Users Routes — CRUD de usuários (apenas master/admin)
 */
const express = require('express');
const router = express.Router();
const { hashSenha } = require('../auth/auth');
const { requireAuth, requirePerfil } = require('../auth/middleware');

module.exports = function (db) {

  // GET /api/usuarios — lista usuários (master/admin)
  router.get('/', requireAuth, requirePerfil('admin', 'master'), async (req, res) => {
    try {
      const usuarios = await db.getUsuarios();
      // Nunca retorna o hash da senha
      res.json(usuarios.map(u => {
        let perm = {};
        try { perm = typeof u.permissoes === 'string' ? JSON.parse(u.permissoes || '{}') : (u.permissoes || {}); } catch {}
        return { id: u.id, nome: u.nome, email: u.email, perfil: u.perfil, ativo: u.ativo, ultimo_login: u.ultimo_login, created_at: u.created_at, permissoes: perm };
      }));
    } catch (err) { res.status(500).json({ error: err.message }); }
  });

  // POST /api/usuarios — criar usuário (master/admin)
  router.post('/', requireAuth, requirePerfil('admin', 'master'), async (req, res) => {
    try {
      const { nome, email, senha, perfil, permissoes } = req.body;
      if (!nome || !email || !senha) return res.status(400).json({ error: 'Nome, email e senha são obrigatórios.' });

      if (req.usuario.perfil === 'admin' && perfil === 'master') {
        return res.status(403).json({ error: 'Somente o master pode criar outro usuário master.' });
      }

      const hash = await hashSenha(senha);
      const usuario = await db.createUsuario({ nome, email: email.toLowerCase(), senha_hash: hash, perfil: perfil || 'admin', permissoes: permissoes || {} });
      res.json({ success: true, usuario: { id: usuario.id, nome: usuario.nome, email: usuario.email, perfil: usuario.perfil } });
    } catch (err) {
      if (err.message && err.message.includes('UNIQUE')) return res.status(409).json({ error: 'E-mail já cadastrado.' });
      res.status(500).json({ error: err.message });
    }
  });

  // PUT /api/usuarios/:id — atualizar usuário
  router.put('/:id', requireAuth, requirePerfil('admin', 'master'), async (req, res) => {
    try {
      const id = parseInt(req.params.id);
      const { nome, email, senha, perfil, ativo, permissoes } = req.body;

      // Admin não pode alterar um master
      const alvo = await db.getUsuarioById(id);
      if (!alvo) return res.status(404).json({ error: 'Usuário não encontrado.' });
      if (req.usuario.perfil === 'admin' && alvo.perfil === 'master') {
        return res.status(403).json({ error: 'Não é possível alterar um usuário master.' });
      }

      const update = { nome, email: email ? email.toLowerCase() : undefined, perfil, ativo };
      if (senha) update.senha_hash = await hashSenha(senha);
      if (permissoes !== undefined) update.permissoes = permissoes;

      const updated = await db.updateUsuario(id, update);
      res.json({ success: true, usuario: { id: updated.id, nome: updated.nome, email: updated.email, perfil: updated.perfil, ativo: updated.ativo } });
    } catch (err) { res.status(500).json({ error: err.message }); }
  });

  // DELETE /api/usuarios/:id — remover usuário (apenas master)
  router.delete('/:id', requireAuth, requirePerfil('master'), async (req, res) => {
    try {
      const id = parseInt(req.params.id);
      if (id === req.usuario.id) return res.status(400).json({ error: 'Você não pode excluir seu próprio usuário.' });
      await db.deleteUsuario(id);
      res.json({ success: true });
    } catch (err) { res.status(500).json({ error: err.message }); }
  });

  return router;
};

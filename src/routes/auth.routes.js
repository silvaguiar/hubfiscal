/**
 * Auth Routes — /api/auth/login, /logout, /me
 */
const express = require('express');
const router = express.Router();
const { gerarToken, hashSenha, compararSenha } = require('../auth/auth');
const { requireAuth } = require('../auth/middleware');

module.exports = function (db) {

  // POST /api/auth/login
  router.post('/login', async (req, res) => {
    try {
      const { email, senha } = req.body;
      if (!email || !senha) return res.status(400).json({ error: 'Email e senha são obrigatórios.' });

      const usuario = await db.getUsuarioByEmail(email.toLowerCase().trim());
      if (!usuario || !usuario.ativo) {
        return res.status(401).json({ error: 'Credenciais inválidas.' });
      }

      const senhaOk = await compararSenha(senha, usuario.senha_hash);
      if (!senhaOk) return res.status(401).json({ error: 'Credenciais inválidas.' });

      const payload = {
        id: usuario.id,
        nome: usuario.nome,
        email: usuario.email,
        perfil: usuario.perfil
      };

      const token = gerarToken(payload);
      await db.registrarLogin(usuario.id);

      // Cookie httpOnly seguro
      res.cookie('hubfiscal_token', token, {
        httpOnly: true,
        sameSite: 'strict',
        maxAge: 8 * 60 * 60 * 1000 // 8 horas
      });

      res.json({
        success: true,
        usuario: { id: usuario.id, nome: usuario.nome, email: usuario.email, perfil: usuario.perfil },
        token
      });
    } catch (err) {
      console.error('[AUTH] Erro no login:', err.message);
      res.status(500).json({ error: 'Erro interno.' });
    }
  });

  // POST /api/auth/logout
  router.post('/logout', async (req, res) => {
    res.clearCookie('hubfiscal_token');
    res.json({ success: true });
  });

  // GET /api/auth/me — retorna usuário atual
  router.get('/me', requireAuth, async (req, res) => {
    const usuario = await db.getUsuarioById(req.usuario.id);
    if (!usuario) return res.status(404).json({ error: 'Usuário não encontrado.' });
    res.json({
      id: usuario.id,
      nome: usuario.nome,
      email: usuario.email,
      perfil: usuario.perfil
    });
  });

  return router;
};

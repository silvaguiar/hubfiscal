/**
 * Auth Routes — /api/auth/login, /logout, /me
 */
const express = require('express');
const router = express.Router();
const { gerarToken, hashSenha, compararSenha } = require('../auth/auth');
const { requireAuth } = require('../auth/middleware');

module.exports = function (db) {

  // GET /api/auth/diagnostics — rota temporária para testar as variáveis e conexão na Vercel
  router.get('/diagnostics', async (req, res) => {
    try {
      const dbUrl = process.env.DATABASE_URL;
      const maskedUrl = dbUrl ? dbUrl.replace(/:([^@]+)@/, ':****@') : 'UNDEFINED';
      
      let dbTest = 'Not started';
      try {
        const pool = await db.getDb();
        const testRes = await pool.query('SELECT 1+1 as result');
        dbTest = `Success: ${testRes.rows[0].result}`;
      } catch (dbErr) {
        dbTest = `Failed: ${dbErr.message}`;
      }
      
      res.json({
        env: {
          DATABASE_URL_DEFINED: !!dbUrl,
          DATABASE_URL_LENGTH: dbUrl ? dbUrl.length : 0,
          DATABASE_URL_MASKED: maskedUrl,
          NODE_ENV: process.env.NODE_ENV,
          VERCEL: process.env.VERCEL
        },
        dbTest
      });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

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

      let permissoes = {};
      try { permissoes = typeof usuario.permissoes === 'string' ? JSON.parse(usuario.permissoes || '{}') : (usuario.permissoes || {}); } catch {}

      let clienteId = usuario.cliente_id || null;
      let clienteStatus = null;
      if (clienteId) {
        const cliente = await db.getClienteById(clienteId);
        clienteStatus = cliente ? cliente.status : null;
      }

      const payload = {
        id: usuario.id,
        nome: usuario.nome,
        email: usuario.email,
        perfil: usuario.perfil,
        permissoes,
        cliente_id: clienteId,
        cliente_status: clienteStatus
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
    let permissoes = {};
    try { permissoes = typeof usuario.permissoes === 'string' ? JSON.parse(usuario.permissoes || '{}') : (usuario.permissoes || {}); } catch {}

    let clienteId = usuario.cliente_id || null;
    let clienteStatus = null;
    let clienteNome = null;
    let planoNome = null;
    let maxEmpresas = null;
    if (clienteId) {
      const cliente = await db.getClienteById(clienteId);
      if (cliente) {
        clienteStatus = cliente.status;
        clienteNome = cliente.nome;
        planoNome = cliente.plano_nome;
        maxEmpresas = cliente.plano_max_empresas !== null ? parseInt(cliente.plano_max_empresas) : null;
      }
    }

    res.json({
      id: usuario.id,
      nome: usuario.nome,
      email: usuario.email,
      perfil: usuario.perfil,
      permissoes,
      cliente_id: clienteId,
      cliente_status: clienteStatus,
      cliente_nome: clienteNome,
      plano_nome: planoNome,
      max_empresas: maxEmpresas
    });
  });

  return router;
};

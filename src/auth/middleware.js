/**
 * Auth Middleware — protege rotas da API com JWT
 */
const { verificarToken } = require('./auth');

/**
 * Middleware obrigatório: rejeita se não tiver token válido
 */
function requireAuth(req, res, next) {
  try {
    const token = extrairToken(req);
    if (!token) return res.status(401).json({ error: 'Não autenticado. Faça login.' });

    const payload = verificarToken(token);
    req.usuario = payload; // { id, nome, email, perfil }
    next();
  } catch (err) {
    return res.status(401).json({ error: 'Token inválido ou expirado.' });
  }
}

/**
 * Middleware de perfil mínimo: rejeita se o perfil for insuficiente
 * Hierarquia: master > admin > operador > viewer
 */
function requirePerfil(...perfisPermitidos) {
  const hierarquia = { master: 4, admin: 3, operador: 2, viewer: 1 };
  return (req, res, next) => {
    if (!req.usuario) return res.status(401).json({ error: 'Não autenticado.' });
    const nivel = hierarquia[req.usuario.perfil] || 0;
    const minNivel = Math.min(...perfisPermitidos.map(p => hierarquia[p] || 0));
    if (nivel < minNivel) {
      return res.status(403).json({ error: 'Permissão insuficiente para esta operação.' });
    }
    next();
  };
}

function extrairToken(req) {
  // 1. Cookie httpOnly (preferencial)
  if (req.cookies && req.cookies.hubfiscal_token) return req.cookies.hubfiscal_token;
  // 2. Header Authorization Bearer
  const auth = req.headers['authorization'];
  if (auth && auth.startsWith('Bearer ')) return auth.slice(7);
  // 3. Query param (apenas para downloads)
  if (req.query && req.query.token) return req.query.token;
  return null;
}

module.exports = { requireAuth, requirePerfil };

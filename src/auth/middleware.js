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

/**
 * Níveis de permissão por módulo
 * Módulos: notas | agendamentos | empresas | dominio | totvs
 * Níveis:  none(0) | view(1) | create(2) | manage(3)
 * Se o módulo não estiver na lista do usuário → assume manage (compat. com usuários antigos)
 */
const NIVEL_MODULO = { none: 0, view: 1, create: 2, manage: 3 };

function parsePermissoes(raw) {
  if (!raw) return {};
  try { return typeof raw === 'object' ? raw : JSON.parse(raw); } catch { return {}; }
}

function requireModulo(modulo, nivel) {
  return (req, res, next) => {
    if (!req.usuario) return res.status(401).json({ error: 'Não autenticado.' });
    if (req.usuario.perfil === 'master') return next();
    const perm = parsePermissoes(req.usuario.permissoes);
    const userNivel = perm[modulo] !== undefined ? (NIVEL_MODULO[perm[modulo]] ?? 0) : NIVEL_MODULO.manage;
    if (userNivel < (NIVEL_MODULO[nivel] ?? 0)) {
      return res.status(403).json({ error: 'Sem permissão para esta operação.' });
    }
    next();
  };
}

/**
 * Bloqueia operações de escrita se o cliente estiver suspenso ou cancelado.
 * Master sempre passa. Usuários sem cliente_id (ex: admin master) também passam.
 */
function requireClienteAtivo(req, res, next) {
  if (!req.usuario) return res.status(401).json({ error: 'Não autenticado.' });
  if (req.usuario.perfil === 'master') return next();
  const status = req.usuario.cliente_status;
  if (status === 'suspenso') return res.status(403).json({ error: 'Conta suspensa. Verifique sua assinatura para continuar.' });
  if (status === 'cancelado') return res.status(403).json({ error: 'Conta cancelada. Entre em contato com o suporte.' });
  next();
}

function extrairToken(req) {
  // 1. Cookie httpOnly (preferencial)
  if (req.cookies && req.cookies.synkfiscal_token) return req.cookies.synkfiscal_token;
  // 2. Header Authorization Bearer
  const auth = req.headers['authorization'];
  if (auth && auth.startsWith('Bearer ')) return auth.slice(7);
  // 3. Query param (apenas para downloads)
  if (req.query && req.query.token) return req.query.token;
  return null;
}

module.exports = { requireAuth, requirePerfil, requireModulo, requireClienteAtivo };

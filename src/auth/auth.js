/**
 * Auth helpers — JWT generation & verification
 */
const jwt = require('jsonwebtoken');
const bcrypt = require('bcryptjs');

const JWT_SECRET = process.env.JWT_SECRET;
const JWT_EXPIRES = '8h';

if (!JWT_SECRET) {
  if (process.env.NODE_ENV === 'production') {
    throw new Error('JWT_SECRET não definido. Defina a variável de ambiente JWT_SECRET.');
  }
  console.warn('⚠️ JWT_SECRET não definido. Usando segredo padrão de desenvolvimento. Não use em produção.');
}

function gerarToken(payload) {
  return jwt.sign(payload, JWT_SECRET || 'hubfiscal_secret_change_in_production_2026', { expiresIn: JWT_EXPIRES });
}

function verificarToken(token) {
  return jwt.verify(token, JWT_SECRET || 'hubfiscal_secret_change_in_production_2026');
}

async function hashSenha(senha) {
  return bcrypt.hash(senha, 10);
}

async function compararSenha(senha, hash) {
  return bcrypt.compare(senha, hash);
}

module.exports = { gerarToken, verificarToken, hashSenha, compararSenha, JWT_SECRET };

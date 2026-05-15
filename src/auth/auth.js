/**
 * Auth helpers — JWT generation & verification
 */
const jwt = require('jsonwebtoken');
const bcrypt = require('bcryptjs');

const JWT_SECRET = process.env.JWT_SECRET || 'hubfiscal_secret_change_in_production_2026';
const JWT_EXPIRES = '8h';

function gerarToken(payload) {
  return jwt.sign(payload, JWT_SECRET, { expiresIn: JWT_EXPIRES });
}

function verificarToken(token) {
  return jwt.verify(token, JWT_SECRET);
}

async function hashSenha(senha) {
  return bcrypt.hash(senha, 10);
}

async function compararSenha(senha, hash) {
  return bcrypt.compare(senha, hash);
}

module.exports = { gerarToken, verificarToken, hashSenha, compararSenha, JWT_SECRET };

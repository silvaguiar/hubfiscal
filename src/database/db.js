const { Pool } = require('pg');
require('dotenv').config();

// Configuração do PostgreSQL (Supabase)
const pool = new Pool({
  connectionString: process.env.DATABASE_URL || process.env.SUPABASE_URL,
  ssl: process.env.NODE_ENV === 'production' ? { rejectUnauthorized: false } : false
});

async function getDb() { return pool; }
function saveDb() {} // No-op for PostgreSQL

function buildQuery(sql, params) {
  let paramCount = 1;
  const newSql = sql.replace(/\?/g, () => `$${paramCount++}`);
  // SQLite usa datetime('now'), PostgreSQL usa CURRENT_TIMESTAMP
  const pgSql = newSql.replace(/datetime\('now'\)/g, 'CURRENT_TIMESTAMP');
  return { text: pgSql, values: params || [] };
}

async function queryOne(sql, params = []) {
  const query = buildQuery(sql, params);
  const result = await pool.query(query);
  return result.rows[0] || null;
}

async function queryAll(sql, params = []) {
  const query = buildQuery(sql, params);
  const result = await pool.query(query);
  return result.rows;
}

async function runSql(sql, params = []) {
  const query = buildQuery(sql, params);
  await pool.query(query);
}

async function initialize() {
  console.log('✅ Banco de dados PostgreSQL conectado (Supabase)');
  try {
    await runSql("ALTER TABLE empresas ADD COLUMN IF NOT EXISTS totvs_token_expiry TEXT");
    await runSql("ALTER TABLE empresas ADD COLUMN IF NOT EXISTS dominio_token TEXT");
    await runSql("ALTER TABLE empresas ADD COLUMN IF NOT EXISTS dominio_token_expiry TEXT");
    
    await runSql("ALTER TABLE configuracoes ADD COLUMN IF NOT EXISTS totvs_token_expiry TEXT");
    await runSql("ALTER TABLE configuracoes ADD COLUMN IF NOT EXISTS dominio_token TEXT");
    await runSql("ALTER TABLE configuracoes ADD COLUMN IF NOT EXISTS dominio_token_expiry TEXT");

    await runSql(`CREATE TABLE IF NOT EXISTS totvs_jobs (
      id SERIAL PRIMARY KEY,
      empresa_id INTEGER,
      status TEXT NOT NULL DEFAULT 'pending',
      mes_referencia TEXT,
      current_page INTEGER DEFAULT 1,
      current_item_index INTEGER DEFAULT 0,
      page_size INTEGER DEFAULT 10,
      total_processed INTEGER DEFAULT 0,
      total_saved INTEGER DEFAULT 0,
      total_skipped INTEGER DEFAULT 0,
      total_errors INTEGER DEFAULT 0,
      detalhes TEXT DEFAULT '',
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    )`);
  } catch (err) {
    console.error('Erro ao migrar colunas de tokens ou criar tabela de jobs TOTVS:', err.message);
  }
  try {
    await runSql('ALTER TABLE agendamentos ADD COLUMN IF NOT EXISTS nome TEXT');
  } catch (err) {
    console.error('Erro ao migrar coluna nome em agendamentos:', err.message);
  }
  try {
    await runSql('ALTER TABLE logs_execucao ADD COLUMN IF NOT EXISTS notas_existentes INTEGER DEFAULT 0');
  } catch (err) {
    console.error('Erro ao migrar coluna notas_existentes em logs_execucao:', err.message);
  }
  try {
    await runSql("ALTER TABLE usuarios ADD COLUMN IF NOT EXISTS permissoes TEXT DEFAULT '{}'");
  } catch (err) {
    console.error('Erro ao migrar coluna permissoes em usuarios:', err.message);
  }
  // Ao reiniciar: deleta logs sem dados úteis (0 notas), marca como falha os com dados parciais
  try {
    await runSql(
      `DELETE FROM logs_execucao WHERE status IN ('executando', 'in_progress', 'failed') AND COALESCE(notas_encontradas, 0) = 0 AND COALESCE(notas_enviadas, 0) = 0 AND COALESCE(notas_inseridas, 0) = 0`
    );
    await runSql(
      `UPDATE logs_execucao SET status = 'failed', detalhes = COALESCE(detalhes, '') || '\n[Interrompido por reinício do servidor]' WHERE status IN ('executando', 'in_progress')`
    );
  } catch (err) {
    console.error('Erro ao limpar logs travados:', err.message);
  }
  await criarMasterSeNaoExistir();
}

async function getConfig() {
  let config = await queryOne('SELECT * FROM configuracoes ORDER BY id DESC LIMIT 1');
  if (config && (!config.totvs_base_url || config.totvs_base_url === '')) {
    const empresaComTotvs = await queryOne('SELECT totvs_base_url, totvs_user, totvs_password, totvs_client_id, totvs_client_secret, totvs_grant_type FROM empresas WHERE totvs_base_url IS NOT NULL AND totvs_base_url != \'\' LIMIT 1');
    if (empresaComTotvs) config = { ...config, ...empresaComTotvs };
  }
  if (!config) config = await queryOne('SELECT * FROM empresas WHERE ativo = 1 ORDER BY id ASC LIMIT 1');
  return config;
}

async function saveConfig(config) {
  const cnpj = (config.cnpj || '').replace(/\D/g, '');
  const existing = await queryOne('SELECT * FROM empresas WHERE cnpj = ?', [cnpj]);
  if (existing) {
    await runSql(`UPDATE empresas SET razao_social=?, uf=?, ambiente=?, certificado_nome=?, certificado_senha=?, updated_at=CURRENT_TIMESTAMP WHERE cnpj=?`, 
      [config.razao_social || '', config.uf || 'SP', config.ambiente || 'producao', config.certificado_nome || existing.certificado_nome || '', config.certificado_senha || existing.certificado_senha || '', cnpj]);
  } else {
    await runSql(`INSERT INTO empresas (cnpj, razao_social, uf, ambiente, certificado_nome, certificado_senha) VALUES (?, ?, ?, ?, ?, ?)`, 
      [cnpj, config.razao_social || '', config.uf || 'SP', config.ambiente || 'producao', config.certificado_nome || '', config.certificado_senha || '']);
  }
  return await queryOne('SELECT * FROM empresas WHERE cnpj = ?', [cnpj]);
}

async function saveTotvsGlobalConfig(data) {
  const config = await queryOne('SELECT * FROM configuracoes ORDER BY id DESC LIMIT 1');
  if (config) {
    await runSql(`UPDATE configuracoes SET totvs_base_url=?, totvs_user=?, totvs_password=?, totvs_client_id=?, totvs_client_secret=?, totvs_grant_type=?, updated_at=CURRENT_TIMESTAMP WHERE id=?`, 
      [data.totvs_base_url || '', data.totvs_user || '', data.totvs_password || '', data.totvs_client_id || '', data.totvs_client_secret || '', data.totvs_grant_type || 'password', config.id]);
  } else {
    await runSql(`INSERT INTO configuracoes (cnpj, totvs_base_url, totvs_user, totvs_password, totvs_client_id, totvs_client_secret, totvs_grant_type) VALUES (?, ?, ?, ?, ?, ?, ?)`, 
      ['00000000000000', data.totvs_base_url || '', data.totvs_user || '', data.totvs_password || '', data.totvs_client_id || '', data.totvs_client_secret || '', data.totvs_grant_type || 'password']);
  }
}

async function updateUltimoNSU(nsu, empresaId = null) {
  if (empresaId) {
    await runSql("UPDATE empresas SET ultimo_nsu=?, updated_at=CURRENT_TIMESTAMP WHERE id=?", [nsu, empresaId]);
  } else {
    const emp = await getConfig();
    if (emp) await runSql("UPDATE empresas SET ultimo_nsu=?, updated_at=CURRENT_TIMESTAMP WHERE id=?", [nsu, emp.id]);
  }
}

async function getEmpresas() { return await queryAll('SELECT * FROM empresas ORDER BY razao_social ASC'); }
async function getMatrizes() { return await queryAll("SELECT id, cnpj, razao_social, nome_fantasia FROM empresas WHERE tipo = 'matriz' ORDER BY razao_social ASC"); }
async function getEmpresaById(id) { return await queryOne('SELECT * FROM empresas WHERE id = ?', [id]); }
async function getEmpresaByCnpj(cnpj) { return await queryOne('SELECT * FROM empresas WHERE cnpj = ?', [cnpj.replace(/\D/g, '')]); }

async function createEmpresa(data) {
  const cnpj = (data.cnpj || '').replace(/\D/g, '');
  if (!cnpj) throw new Error('CNPJ é obrigatório');
  const tipo = data.tipo === 'filial' ? 'filial' : 'matriz';
  const matrizId = tipo === 'filial' && data.matriz_id ? parseInt(data.matriz_id) : null;
  await runSql(`
    INSERT INTO empresas (cnpj, razao_social, nome_fantasia, tipo, matriz_id, uf, ambiente, certificado_nome, certificado_senha, totvs_base_url, totvs_user, totvs_password, totvs_client_id, totvs_client_secret, totvs_branch, totvs_grant_type, totvs_ativo, dominio_client_id, dominio_client_secret, dominio_integration_key, dominio_ativo, dominio_auth_url, dominio_api_url)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `, [cnpj, data.razao_social || '', data.nome_fantasia || '', tipo, matrizId,
      data.uf || 'SP', data.ambiente || 'producao',
      data.certificado_nome || '', data.certificado_senha || '',
      data.totvs_base_url || '', data.totvs_user || '', data.totvs_password || '',
      data.totvs_client_id || '', data.totvs_client_secret || '', data.totvs_branch || '',
      data.totvs_grant_type || 'password', (data.totvs_ativo === true || data.totvs_ativo === 'true' || data.totvs_ativo == 1) ? 1 : 0,
      data.dominio_client_id || '', data.dominio_client_secret || '', data.dominio_integration_key || '',
      (data.dominio_ativo === true || data.dominio_ativo === 'true' || data.dominio_ativo == 1) ? 1 : 0, data.dominio_auth_url || '', data.dominio_api_url || '']);
  return await getEmpresaByCnpj(cnpj);
}

async function updateEmpresa(id, data) {
  const cnpj = data.cnpj ? data.cnpj.replace(/\D/g, '') : null;
  const existing = await getEmpresaById(id);
  if (!existing) throw new Error('Empresa não encontrada');
  const tipo = data.tipo || existing.tipo || 'matriz';
  const matrizId = tipo === 'filial' && data.matriz_id ? parseInt(data.matriz_id) : null;

  await runSql(`
    UPDATE empresas SET
      cnpj = ?, razao_social = ?, nome_fantasia = ?, tipo = ?, matriz_id = ?, uf = ?, ambiente = ?,
      certificado_nome = COALESCE(NULLIF(?, ''), certificado_nome),
      certificado_senha = COALESCE(NULLIF(?, ''), certificado_senha),
      totvs_base_url = ?, totvs_user = ?, totvs_password = ?, totvs_token = ?, 
      totvs_client_id = ?, totvs_client_secret = ?, totvs_branch = ?, totvs_grant_type = ?, totvs_ativo = ?,
      dominio_client_id = ?, dominio_client_secret = ?, dominio_integration_key = ?, dominio_ativo = ?,
      dominio_auth_url = ?, dominio_api_url = ?, updated_at = CURRENT_TIMESTAMP
    WHERE id = ?
  `, [
    cnpj || existing.cnpj, data.razao_social !== undefined ? data.razao_social : existing.razao_social,
    data.nome_fantasia !== undefined ? data.nome_fantasia : existing.nome_fantasia, tipo, matrizId,
    data.uf || existing.uf, data.ambiente || existing.ambiente, data.certificado_nome || '', data.certificado_senha || '',
    data.totvs_base_url !== undefined ? data.totvs_base_url : existing.totvs_base_url,
    data.totvs_user !== undefined ? data.totvs_user : existing.totvs_user,
    data.totvs_password !== undefined ? data.totvs_password : existing.totvs_password,
    data.totvs_token !== undefined ? data.totvs_token : existing.totvs_token,
    data.totvs_client_id !== undefined ? data.totvs_client_id : existing.totvs_client_id,
    data.totvs_client_secret !== undefined ? data.totvs_client_secret : existing.totvs_client_secret,
    data.totvs_branch !== undefined ? data.totvs_branch : existing.totvs_branch,
    data.totvs_grant_type !== undefined ? data.totvs_grant_type : existing.totvs_grant_type,
    data.totvs_ativo !== undefined ? ((data.totvs_ativo === true || data.totvs_ativo === 'true' || data.totvs_ativo == 1) ? 1 : 0) : existing.totvs_ativo,
    data.dominio_client_id !== undefined ? data.dominio_client_id : existing.dominio_client_id,
    data.dominio_client_secret !== undefined ? data.dominio_client_secret : existing.dominio_client_secret,
    data.dominio_integration_key !== undefined ? data.dominio_integration_key : existing.dominio_integration_key,
    data.dominio_ativo !== undefined ? ((data.dominio_ativo === true || data.dominio_ativo === 'true' || data.dominio_ativo == 1) ? 1 : 0) : existing.dominio_ativo,
    data.dominio_auth_url !== undefined ? data.dominio_auth_url : existing.dominio_auth_url,
    data.dominio_api_url !== undefined ? data.dominio_api_url : existing.dominio_api_url, id
  ]);
  return await getEmpresaById(id);
}

async function deleteEmpresa(id) { await runSql('DELETE FROM empresas WHERE id = ?', [id]); }
async function updateEmpresaNSU(id, nsu) { await runSql("UPDATE empresas SET ultimo_nsu=?, updated_at=CURRENT_TIMESTAMP WHERE id=?", [nsu, id]); }
async function updateEmpresaCertificado(id, nome, arquivo) { await runSql(`UPDATE empresas SET certificado_nome=?, certificado_arquivo=?, updated_at=CURRENT_TIMESTAMP WHERE id=?`, [nome, arquivo || '', id]); }
async function updateEmpresaSenha(id, senha) { await runSql(`UPDATE empresas SET certificado_senha=?, updated_at=CURRENT_TIMESTAMP WHERE id=?`, [senha, id]); }

async function insertNota(nota, empresaId = null) {
  try {
    const params = [
      empresaId ? parseInt(empresaId) : null, nota.chave_acesso || '', (nota.numero_nf || '').toString(), 
      (nota.serie || '').toString(), nota.data_emissao || null, parseFloat(nota.valor_total || 0), 
      nota.emitente_cnpj || '', nota.emitente_nome || '', nota.destinatario_cnpj || '', nota.destinatario_nome || '',
      nota.tipo || 'entrada', nota.situacao || 'autorizada', nota.nsu || null, nota.xml_completo || '', 
      nota.schema_type || (nota.chave_acesso ? nota.chave_acesso.substring(20, 22) : null)
    ];

    await runSql(`
      INSERT INTO notas_fiscais
        (empresa_id, chave_acesso, numero_nf, serie, data_emissao, valor_total,
         emitente_cnpj, emitente_nome, destinatario_cnpj, destinatario_nome,
         tipo, situacao, nsu, xml_completo, schema_type, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
      ON CONFLICT (chave_acesso) DO UPDATE SET 
         empresa_id = EXCLUDED.empresa_id, numero_nf = EXCLUDED.numero_nf, serie = EXCLUDED.serie,
         data_emissao = EXCLUDED.data_emissao, valor_total = EXCLUDED.valor_total,
         emitente_cnpj = EXCLUDED.emitente_cnpj, emitente_nome = EXCLUDED.emitente_nome,
         destinatario_cnpj = EXCLUDED.destinatario_cnpj, destinatario_nome = EXCLUDED.destinatario_nome,
         tipo = EXCLUDED.tipo, situacao = EXCLUDED.situacao, nsu = EXCLUDED.nsu,
         xml_completo = EXCLUDED.xml_completo, schema_type = EXCLUDED.schema_type, updated_at = CURRENT_TIMESTAMP
    `, params);
    return true;
  } catch (err) {
    console.error('❌ FALHA FATAL AO INSERIR NOTA:', err);
    return false;
  }
}

async function insertNotas(notas, empresaId = null) {
  let count = 0;
  for (const nota of notas) { if (await insertNota(nota, empresaId)) count++; }
  return count;
}

async function getNotas({ tipo, busca, modelo, dataInicio, dataFim, empresaId, pagina = 1, limite = 50 } = {}) {
  let where = [];
  let params = [];
  
  if (empresaId) { params.push(empresaId); where.push(`empresa_id = $${params.length}`); }
  if (tipo && tipo !== 'todos') { params.push(tipo); where.push(`tipo = $${params.length}`); }
  if (modelo && modelo !== 'todos') { params.push(modelo.toString()); where.push(`schema_type = $${params.length}`); }

  if (busca) {
    const like = `%${busca}%`;
    params.push(like); const idx = params.length;
    where.push(`(numero_nf ILIKE $${idx} OR chave_acesso ILIKE $${idx} OR emitente_nome ILIKE $${idx} OR emitente_cnpj ILIKE $${idx} OR destinatario_nome ILIKE $${idx} OR destinatario_cnpj ILIKE $${idx})`);
  }
  if (dataInicio) { params.push(dataInicio); where.push(`data_emissao >= $${params.length}`); }
  if (dataFim) { params.push(dataFim + 'T23:59:59'); where.push(`data_emissao <= $${params.length}`); }

  const whereClause = where.length > 0 ? 'WHERE ' + where.join(' AND ') : '';
  const offset = (pagina - 1) * limite;

  const countQuery = `SELECT COUNT(*) as count FROM notas_fiscais ${whereClause}`;
  const totalRow = await pool.query({ text: countQuery, values: params });
  const total = totalRow.rows[0] ? parseInt(totalRow.rows[0].count) : 0;

  params.push(limite); const limitIdx = params.length;
  params.push(offset); const offsetIdx = params.length;
  const dataQuery = `
    SELECT id, empresa_id, chave_acesso, numero_nf, serie, data_emissao, valor_total,
           emitente_cnpj, emitente_nome, destinatario_cnpj, destinatario_nome,
           tipo, situacao, nsu, schema_type, created_at,
           dominio_status, dominio_enviado_em, dominio_erro
    FROM notas_fiscais ${whereClause}
    ORDER BY data_emissao DESC, id DESC
    LIMIT $${limitIdx} OFFSET $${offsetIdx}
  `;
  const notasResult = await pool.query({ text: dataQuery, values: params });

  return { notas: notasResult.rows, total, pagina, limite, totalPaginas: Math.ceil(total / limite) };
}

async function getNotaById(id) { return await queryOne('SELECT * FROM notas_fiscais WHERE id = ?', [id]); }
async function getNotaByChave(chave) { return await queryOne('SELECT * FROM notas_fiscais WHERE chave_acesso = ?', [chave]); }
async function deleteNota(id) { await runSql('DELETE FROM notas_fiscais WHERE id = ?', [id]); }

async function getEstatisticas(empresaId = null) {
  const params = [];
  let where = '';
  if (empresaId) {
    params.push(empresaId);
    where = `WHERE empresa_id = $${params.length}`;
  }
  const total = await queryOne(`SELECT COUNT(*) as count FROM notas_fiscais ${where}`, params);
  const entradas = await queryOne(`SELECT COUNT(*) as count, COALESCE(SUM(valor_total),0) as valor FROM notas_fiscais ${where ? where + " AND tipo='entrada'" : "WHERE tipo='entrada'"}`, params);
  const saidas = await queryOne(`SELECT COUNT(*) as count, COALESCE(SUM(valor_total),0) as valor FROM notas_fiscais ${where ? where + " AND tipo='saida'" : "WHERE tipo='saida'"}`, params);
  const ultima = await queryOne(`SELECT MAX(created_at) as data FROM notas_fiscais ${where}`, params);
  return {
    total: total ? parseInt(total.count) : 0,
    entradas: { count: entradas ? parseInt(entradas.count) : 0, valor: entradas ? entradas.valor : 0 },
    saidas: { count: saidas ? parseInt(saidas.count) : 0, valor: saidas ? saidas.valor : 0 },
    ultimaImportacao: ultima ? ultima.data : null
  };
}

async function getAllNotasForExport({ tipo, dataInicio, dataFim, empresaId, modelo } = {}) {
  let where = []; let params = [];
  if (empresaId) { params.push(empresaId); where.push(`empresa_id = $${params.length}`); }
  if (tipo && tipo !== 'todos') { params.push(tipo); where.push(`tipo = $${params.length}`); }
  if (modelo && modelo !== 'todos') { params.push(modelo); where.push(`schema_type = $${params.length}`); }
  if (dataInicio) { params.push(dataInicio); where.push(`data_emissao >= $${params.length}`); }
  if (dataFim) { params.push(dataFim + 'T23:59:59'); where.push(`data_emissao <= $${params.length}`); }
  const whereClause = where.length > 0 ? 'WHERE ' + where.join(' AND ') : '';
  const result = await pool.query({ text: `SELECT * FROM notas_fiscais ${whereClause} ORDER BY data_emissao DESC`, values: params });
  return result.rows;
}

async function getUfConfigs() { return await queryAll('SELECT * FROM robos_sefaz_uf ORDER BY uf ASC'); }

async function saveUfConfig(uf, portal_url, ativo) {
  const ativoInt = (ativo === true || ativo === 'true' || ativo == 1) ? 1 : 0;
  await runSql(`
    INSERT INTO robos_sefaz_uf (uf, portal_url, ativo, updated_at) VALUES (?, ?, ?, CURRENT_TIMESTAMP)
    ON CONFLICT (uf) DO UPDATE SET portal_url=EXCLUDED.portal_url, ativo=EXCLUDED.ativo, updated_at=CURRENT_TIMESTAMP
  `, [uf, portal_url, ativoInt]);
}

async function updateDominioStatus(notaId, status, erro = null, batchId = null) {
  const now = status === 'enviado' ? new Date().toISOString() : null;
  await runSql(`
    UPDATE notas_fiscais SET dominio_status = ?, dominio_enviado_em = COALESCE(?, dominio_enviado_em), dominio_erro = ?, dominio_batch_id = COALESCE(?, dominio_batch_id), updated_at = CURRENT_TIMESTAMP WHERE id = ?
  `, [status, now, erro || '', batchId, notaId]);
}

async function getNotasParaDominio(empresaId, filtros = {}) {
  const where = ['empresa_id = $1'];
  const params = [empresaId];

  if (!filtros.reenviar) {
    // 'enviando' é incluído para recuperar notas interrompidas por restart do servidor
    where.push("(dominio_status IN ('pendente', 'enviando') OR dominio_status IS NULL)");
  } else {
    where.push("dominio_status = 'erro'");
  }

  if (filtros.dataInicio) {
    params.push(filtros.dataInicio);
    where.push(`data_emissao >= $${params.length}`);
  }
  if (filtros.dataFim) {
    params.push(filtros.dataFim + 'T23:59:59');
    where.push(`data_emissao <= $${params.length}`);
  }
  if (filtros.tipo && filtros.tipo !== 'todos') {
    params.push(filtros.tipo);
    where.push(`tipo = $${params.length}`);
  }

  const whereClause = where.length > 0 ? `WHERE ${where.join(' AND ')}` : '';
  const result = await pool.query({ text: `SELECT * FROM notas_fiscais ${whereClause} ORDER BY data_emissao DESC`, values: params });
  return result.rows;
}

async function getDominioStats(empresaId = null) {
  const params = [];
  let where = '';
  if (empresaId) {
    params.push(empresaId);
    where = `WHERE empresa_id = $${params.length}`;
  }
  const total = await queryOne(`SELECT COUNT(*) as count FROM notas_fiscais ${where}`, params);
  const enviadas = await queryOne(`SELECT COUNT(*) as count FROM notas_fiscais ${where ? where + " AND dominio_status = 'enviado'" : "WHERE dominio_status = 'enviado'"}`, params);
  const pendentes = await queryOne(`SELECT COUNT(*) as count FROM notas_fiscais ${where ? where + " AND (dominio_status = 'pendente' OR dominio_status IS NULL)" : "WHERE (dominio_status = 'pendente' OR dominio_status IS NULL)"}`, params);
  const erros = await queryOne(`SELECT COUNT(*) as count FROM notas_fiscais ${where ? where + " AND dominio_status = 'erro'" : "WHERE dominio_status = 'erro'"}`, params);
  return { total: total ? parseInt(total.count) : 0, enviadas: enviadas ? parseInt(enviadas.count) : 0, pendentes: pendentes ? parseInt(pendentes.count) : 0, erros: erros ? parseInt(erros.count) : 0 };
}

async function saveDominioGlobalConfig(data) {
  const config = await queryOne('SELECT * FROM configuracoes ORDER BY id DESC LIMIT 1');
  if (config) {
    await runSql(`UPDATE configuracoes SET dominio_client_id=?, dominio_client_secret=?, dominio_auth_url=?, dominio_api_url=?, updated_at=CURRENT_TIMESTAMP WHERE id=?`, [data.dominio_client_id || '', data.dominio_client_secret || '', data.dominio_auth_url || '', data.dominio_api_url || '', config.id]);
  } else {
    await runSql(`INSERT INTO configuracoes (cnpj, dominio_client_id, dominio_client_secret, dominio_auth_url, dominio_api_url) VALUES (?, ?, ?, ?, ?)`, ['00000000000000', data.dominio_client_id || '', data.dominio_client_secret || '', data.dominio_auth_url || '', data.dominio_api_url || '']);
  }
}

async function criarMasterSeNaoExistir() {
  try {
    const existe = await queryOne("SELECT id FROM usuarios WHERE perfil = 'master' LIMIT 1");
    if (existe) return;
    const bcrypt = require('bcryptjs');
    const senhaGerada = Math.random().toString(36).slice(-10) + Math.random().toString(36).slice(-4).toUpperCase();
    const hash = await bcrypt.hash(senhaGerada, 10);
    await runSql(`INSERT INTO usuarios (nome, email, senha_hash, perfil, ativo) VALUES (?, ?, ?, 'master', 1)`, ['Administrador Master', 'admin@hubfiscal.local', hash]);
    console.log('\\n' + '='.repeat(55));
    console.log('🔐 USUÁRIO MASTER CRIADO — ANOTE ESTAS CREDENCIAIS:');
    console.log('   Email : admin@hubfiscal.local');
    console.log(`   Senha : ${senhaGerada}`);
    console.log('   ⚠️  Esta senha é exibida apenas uma vez!');
    console.log('='.repeat(55) + '\\n');
  } catch (e) { console.error('⚠️ Erro ao criar usuário master:', e.message); }
}

async function getUsuarios() { return await queryAll('SELECT id, nome, email, perfil, ativo, ultimo_login, created_at, permissoes FROM usuarios ORDER BY perfil ASC, nome ASC'); }
async function getUsuarioById(id) { return await queryOne('SELECT * FROM usuarios WHERE id = ?', [id]); }
async function getUsuarioByEmail(email) { return await queryOne('SELECT * FROM usuarios WHERE email = ? AND ativo = 1', [email.toLowerCase()]); }
async function createUsuario(data) {
  const perm = data.permissoes ? (typeof data.permissoes === 'object' ? JSON.stringify(data.permissoes) : data.permissoes) : '{}';
  await runSql(`INSERT INTO usuarios (nome, email, senha_hash, perfil, ativo, permissoes) VALUES (?, ?, ?, ?, 1, ?)`, [data.nome, data.email, data.senha_hash, data.perfil || 'admin', perm]);
  return await getUsuarioByEmail(data.email);
}
async function updateUsuario(id, data) {
  const u = await getUsuarioById(id);
  if (!u) throw new Error('Usuário não encontrado');
  const perm = data.permissoes !== undefined ? (typeof data.permissoes === 'object' ? JSON.stringify(data.permissoes) : data.permissoes) : null;
  await runSql(`UPDATE usuarios SET nome = COALESCE(?, nome), email = COALESCE(?, email), senha_hash = COALESCE(?, senha_hash), perfil = COALESCE(?, perfil), ativo = COALESCE(?, ativo), permissoes = COALESCE(?, permissoes), updated_at = CURRENT_TIMESTAMP WHERE id = ?`,
    [data.nome || null, data.email || null, data.senha_hash || null, data.perfil || null, data.ativo !== undefined ? ((data.ativo === true || data.ativo === 'true' || data.ativo == 1) ? 1 : 0) : null, perm, id]);
  return await getUsuarioById(id);
}
async function deleteUsuario(id) { await runSql('DELETE FROM usuarios WHERE id = ?', [id]); }
async function registrarLogin(usuarioId) { await runSql("UPDATE usuarios SET ultimo_login = CURRENT_TIMESTAMP WHERE id = ?", [usuarioId]); }

async function getAgendamentos() { return await queryAll(`SELECT a.*, e.razao_social as empresa_nome, e.cnpj as empresa_cnpj FROM agendamentos a LEFT JOIN empresas e ON e.id = a.empresa_id ORDER BY a.id ASC`); }
async function getAgendamentoById(id) { return await queryOne('SELECT * FROM agendamentos WHERE id = ?', [id]); }
async function createAgendamento(data) { 
  const empId = parseInt(data.empresa_id) === 0 ? null : parseInt(data.empresa_id);
  await runSql(`INSERT INTO agendamentos (empresa_id, tipo, nome, ativo, dias_offset, cron_expressao) VALUES (?, ?, ?, ?, ?, ?)`, 
    [empId, data.tipo, data.nome || null, data.ativo !== undefined ? ((data.ativo === true || data.ativo === 'true' || data.ativo == 1) ? 1 : 0) : 1, parseInt(data.dias_offset) || 2, data.cron_expressao || '0 6 * * *']); 
  const rows = await queryAll('SELECT * FROM agendamentos ORDER BY id DESC LIMIT 1'); 
  return rows[0]; 
}
async function updateAgendamento(id, data) {
  const ag = await getAgendamentoById(id);
  if (!ag) throw new Error('Agendamento não encontrado');
  const empId = data.empresa_id !== undefined ? (parseInt(data.empresa_id) === 0 ? null : parseInt(data.empresa_id)) : ag.empresa_id;
  await runSql(`UPDATE agendamentos SET empresa_id = ?, tipo = COALESCE(?, tipo), nome = COALESCE(?, nome), ativo = COALESCE(?, ativo), dias_offset = COALESCE(?, dias_offset), cron_expressao = COALESCE(?, cron_expressao), updated_at = CURRENT_TIMESTAMP WHERE id = ?`,
    [empId, data.tipo || null, data.nome !== undefined ? data.nome : null, data.ativo !== undefined ? ((data.ativo === true || data.ativo === 'true' || data.ativo == 1) ? 1 : 0) : null, data.dias_offset !== undefined ? parseInt(data.dias_offset) : null, data.cron_expressao || null, id]);
  return await getAgendamentoById(id);
}
async function updateAgendamentoStatus(id, status, resultado) { await runSql(`UPDATE agendamentos SET ultimo_run = CURRENT_TIMESTAMP, ultimo_status = ?, ultimo_resultado = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?`, [status, resultado || null, id]); }
async function deleteAgendamento(id) { 
  await runSql('DELETE FROM logs_execucao WHERE agendamento_id = ?', [id]);
  await runSql('DELETE FROM agendamentos WHERE id = ?', [id]); 
}

async function registrarLogExecucao(data) {
  const res = await pool.query({
    text: `INSERT INTO logs_execucao (agendamento_id, empresa_id, tipo, status, notas_encontradas, notas_inseridas, notas_existentes, notas_enviadas, detalhes, duracao_ms) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10) RETURNING id`,
    values: [data.agendamento_id || null, data.empresa_id || null, data.tipo, data.status, data.notas_encontradas || 0, data.notas_inseridas || 0, data.notas_existentes || 0, data.notas_enviadas || 0, data.detalhes || null, data.duracao_ms || 0]
  });
  return res.rows[0].id;
}
async function updateLogExecucao(id, data) {
  await runSql(`UPDATE logs_execucao SET status = COALESCE(?, status), notas_encontradas = COALESCE(?, notas_encontradas), notas_inseridas = COALESCE(?, notas_inseridas), notas_existentes = COALESCE(?, notas_existentes), notas_enviadas = COALESCE(?, notas_enviadas), detalhes = COALESCE(?, detalhes), duracao_ms = COALESCE(?, duracao_ms) WHERE id = ?`,
    [data.status !== undefined ? data.status : null, data.notas_encontradas !== undefined ? data.notas_encontradas : null, data.notas_inseridas !== undefined ? data.notas_inseridas : null, data.notas_existentes !== undefined ? data.notas_existentes : null, data.notas_enviadas !== undefined ? data.notas_enviadas : null, data.detalhes !== undefined ? data.detalhes : null, data.duracao_ms !== undefined ? data.duracao_ms : null, id]);
}
async function getLogsExecucao({ agendamento_id, empresa_id, limite, tipo, status } = {}) {
  let where = []; let params = [];
  if (agendamento_id) { params.push(agendamento_id); where.push(`l.agendamento_id = $${params.length}`); }
  if (empresa_id) { params.push(empresa_id); where.push(`l.empresa_id = $${params.length}`); }
  if (tipo) { params.push(tipo); where.push(`l.tipo = $${params.length}`); }
  if (status) { params.push(status); where.push(`l.status = $${params.length}`); }
  const whereClause = where.length ? 'WHERE ' + where.join(' AND ') : '';
  params.push(parseInt(limite) || 50);
  return await pool.query({ text: `SELECT l.*, e.razao_social as empresa_nome FROM logs_execucao l LEFT JOIN empresas e ON e.id = l.empresa_id ${whereClause} ORDER BY l.executado_em DESC LIMIT $${params.length}`, values: params }).then(r => r.rows);
}

async function createTotvsJob(data) {
  const result = await pool.query({
    text: `INSERT INTO totvs_jobs (empresa_id, mes_referencia, status, current_page, current_item_index, page_size, total_processed, total_saved, total_skipped, total_errors, detalhes) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11) RETURNING *`,
    values: [data.empresa_id || null, data.mes_referencia || null, data.status || 'pending', data.current_page || 1, data.current_item_index || 0, data.page_size || 10, data.total_processed || 0, data.total_saved || 0, data.total_skipped || 0, data.total_errors || 0, data.detalhes || '']
  });
  return result.rows[0];
}

async function getTotvsJobById(id) {
  return await queryOne('SELECT * FROM totvs_jobs WHERE id = ?', [id]);
}

async function getNextTotvsJob() {
  const job = await queryOne("SELECT * FROM totvs_jobs WHERE status IN ('pending', 'processing') ORDER BY updated_at ASC, created_at ASC LIMIT 1");
  return job;
}

async function updateTotvsJob(id, data) {
  let fields = [];
  let values = [];
  if (data.status !== undefined) { fields.push('status = ?'); values.push(data.status); }
  if (data.current_page !== undefined) { fields.push('current_page = ?'); values.push(data.current_page); }
  if (data.current_item_index !== undefined) { fields.push('current_item_index = ?'); values.push(data.current_item_index); }
  if (data.page_size !== undefined) { fields.push('page_size = ?'); values.push(data.page_size); }
  if (data.total_processed !== undefined) { fields.push('total_processed = ?'); values.push(data.total_processed); }
  if (data.total_saved !== undefined) { fields.push('total_saved = ?'); values.push(data.total_saved); }
  if (data.total_skipped !== undefined) { fields.push('total_skipped = ?'); values.push(data.total_skipped); }
  if (data.total_errors !== undefined) { fields.push('total_errors = ?'); values.push(data.total_errors); }
  if (data.detalhes !== undefined) { fields.push('detalhes = ?'); values.push(data.detalhes); }
  if (fields.length === 0) return;
  fields.push('updated_at = CURRENT_TIMESTAMP');
  values.push(id);
  await runSql(`UPDATE totvs_jobs SET ${fields.join(', ')} WHERE id = ?`, values);
  return await getTotvsJobById(id);
}

async function listTotvsJobs({ status, limite } = {}) {
  let where = [];
  let params = [];
  if (status) { params.push(status); where.push(`status = $${params.length}`); }
  const whereClause = where.length ? 'WHERE ' + where.join(' AND ') : '';
  params.push(parseInt(limite) || 50);
  const result = await pool.query({ text: `SELECT * FROM totvs_jobs ${whereClause} ORDER BY created_at DESC LIMIT $${params.length}`, values: params });
  return result.rows;
}

async function updateEmpresaTokens(id, data) {
  let fields = [];
  let values = [];
  if (data.totvs_token !== undefined) { fields.push('totvs_token = ?'); values.push(data.totvs_token); }
  if (data.totvs_token_expiry !== undefined) { fields.push('totvs_token_expiry = ?'); values.push(data.totvs_token_expiry); }
  if (data.dominio_token !== undefined) { fields.push('dominio_token = ?'); values.push(data.dominio_token); }
  if (data.dominio_token_expiry !== undefined) { fields.push('dominio_token_expiry = ?'); values.push(data.dominio_token_expiry); }
  
  if (fields.length === 0) return;
  values.push(id);
  await runSql(`UPDATE empresas SET ${fields.join(', ')}, updated_at = CURRENT_TIMESTAMP WHERE id = ?`, values);
}

async function updateGlobalTokens(data) {
  const config = await queryOne('SELECT * FROM configuracoes ORDER BY id DESC LIMIT 1');
  if (!config) return;
  
  let fields = [];
  let values = [];
  if (data.totvs_token !== undefined) { fields.push('totvs_token = ?'); values.push(data.totvs_token); }
  if (data.totvs_token_expiry !== undefined) { fields.push('totvs_token_expiry = ?'); values.push(data.totvs_token_expiry); }
  if (data.dominio_token !== undefined) { fields.push('dominio_token = ?'); values.push(data.dominio_token); }
  if (data.dominio_token_expiry !== undefined) { fields.push('dominio_token_expiry = ?'); values.push(data.dominio_token_expiry); }
  
  if (fields.length === 0) return;
  values.push(config.id);
  await runSql(`UPDATE configuracoes SET ${fields.join(', ')}, updated_at = CURRENT_TIMESTAMP WHERE id = ?`, values);
}

module.exports = {
  initialize, getDb, getConfig, saveConfig, saveTotvsGlobalConfig, updateUltimoNSU, getEmpresas, getMatrizes, getEmpresaById, getEmpresaByCnpj, createEmpresa, updateEmpresa, deleteEmpresa, updateEmpresaNSU, updateEmpresaCertificado, updateEmpresaSenha, insertNota, insertNotas, getNotas, getNotaById, getNotaByChave, deleteNota, getEstatisticas, getAllNotasForExport, getUfConfigs, saveUfConfig, updateDominioStatus, getNotasParaDominio, getDominioStats, saveDominioGlobalConfig, getUsuarios, getUsuarioById, getUsuarioByEmail, createUsuario, updateUsuario, deleteUsuario, registrarLogin, getAgendamentos, getAgendamentoById, createAgendamento, updateAgendamento, updateAgendamentoStatus, deleteAgendamento, registrarLogExecucao, updateLogExecucao, getLogsExecucao, createTotvsJob, getTotvsJobById, getNextTotvsJob, updateTotvsJob, listTotvsJobs, runSql, saveDb, updateEmpresaTokens, updateGlobalTokens
};

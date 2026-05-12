const initSqlJs = require('sql.js');
const fs = require('fs');
const path = require('path');

const DB_DIR = path.join(__dirname, '..', '..', 'data');
const DB_PATH = path.join(DB_DIR, 'nfe.db');

let db = null;

async function getDb() {
  if (db) return db;
  if (!fs.existsSync(DB_DIR)) fs.mkdirSync(DB_DIR, { recursive: true });
  const SQL = await initSqlJs();
  if (fs.existsSync(DB_PATH)) {
    const buffer = fs.readFileSync(DB_PATH);
    db = new SQL.Database(buffer);
  } else {
    db = new SQL.Database();
  }
  return db;
}

function saveDb() {
  if (!db) return;
  try {
    const data = db.export();
    const buffer = Buffer.from(data);
    fs.writeFileSync(DB_PATH, buffer);
    console.log('💾 Banco de dados salvo no disco:', DB_PATH);
  } catch (err) {
    console.error('❌ ERRO CRÍTICO AO SALVAR BANCO:', err.message);
  }
}

async function initialize() {
  const conn = await getDb();

  // ── Tabela legada (mantida para não quebrar) ──────────────────────────
  conn.run(`
    CREATE TABLE IF NOT EXISTS configuracoes (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      cnpj TEXT NOT NULL,
      razao_social TEXT DEFAULT '',
      uf TEXT NOT NULL DEFAULT '35',
      ambiente TEXT NOT NULL DEFAULT 'producao',
      certificado_nome TEXT DEFAULT '',
      certificado_senha TEXT DEFAULT '',
      ultimo_nsu TEXT DEFAULT '000000000000000',
      totvs_base_url TEXT DEFAULT '',
      totvs_user TEXT DEFAULT '',
      totvs_password TEXT DEFAULT '',
      totvs_client_id TEXT DEFAULT '',
      totvs_client_secret TEXT DEFAULT '',
      totvs_grant_type TEXT DEFAULT 'password',
      totvs_token TEXT DEFAULT '',
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )
  `);

  // ── Tabela de Empresas (multi-CNPJ) ──────────────────────────────────
  conn.run(`
    CREATE TABLE IF NOT EXISTS empresas (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      cnpj TEXT UNIQUE NOT NULL,
      razao_social TEXT DEFAULT '',
      nome_fantasia TEXT DEFAULT '',
      tipo TEXT NOT NULL DEFAULT 'matriz',
      matriz_id INTEGER REFERENCES empresas(id),
      uf TEXT NOT NULL DEFAULT 'SP',
      ambiente TEXT NOT NULL DEFAULT 'producao',
      certificado_nome TEXT DEFAULT '',
      certificado_senha TEXT DEFAULT '',
      certificado_arquivo TEXT DEFAULT '',
      ultimo_nsu TEXT DEFAULT '000000000000000',
      totvs_base_url TEXT DEFAULT '',
      totvs_user TEXT DEFAULT '',
      totvs_password TEXT DEFAULT '',
      totvs_token TEXT DEFAULT '',
      totvs_client_id TEXT DEFAULT '',
      totvs_client_secret TEXT DEFAULT '',
      totvs_branch TEXT DEFAULT '',
      totvs_grant_type TEXT DEFAULT 'password',
      totvs_ativo INTEGER DEFAULT 0,
      ativo INTEGER DEFAULT 1,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )
  `);

  // ── Tabela de Notas Fiscais ───────────────────────────────────────────
  conn.run(`
    CREATE TABLE IF NOT EXISTS notas_fiscais (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      empresa_id INTEGER,
      chave_acesso TEXT UNIQUE NOT NULL,
      numero_nf TEXT,
      serie TEXT,
      data_emissao TEXT,
      valor_total REAL DEFAULT 0,
      emitente_cnpj TEXT,
      emitente_nome TEXT,
      destinatario_cnpj TEXT,
      destinatario_nome TEXT,
      tipo TEXT CHECK(tipo IN ('entrada', 'saida')),
      situacao TEXT DEFAULT 'autorizada',
      nsu TEXT,
      xml_completo TEXT,
      schema_type TEXT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )
  `);

  const indexes = [
    'CREATE INDEX IF NOT EXISTS idx_nf_empresa ON notas_fiscais(empresa_id)',
    'CREATE INDEX IF NOT EXISTS idx_nf_tipo ON notas_fiscais(tipo)',
    'CREATE INDEX IF NOT EXISTS idx_nf_emitente ON notas_fiscais(emitente_cnpj)',
    'CREATE INDEX IF NOT EXISTS idx_nf_destinatario ON notas_fiscais(destinatario_cnpj)',
    'CREATE INDEX IF NOT EXISTS idx_nf_data ON notas_fiscais(data_emissao)',
    'CREATE INDEX IF NOT EXISTS idx_nf_chave ON notas_fiscais(chave_acesso)',
    'CREATE INDEX IF NOT EXISTS idx_empresas_cnpj ON empresas(cnpj)'
  ];

  // ── Tabela de Configuração de Robôs por UF ────────────────────────────
  conn.run(`
    CREATE TABLE IF NOT EXISTS robos_sefaz_uf (
      uf TEXT PRIMARY KEY,
      portal_url TEXT DEFAULT '',
      ativo INTEGER DEFAULT 1,
      requer_captcha INTEGER DEFAULT 1,
      instrucoes TEXT DEFAULT '',
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )
  `);

  // Inserir UFs padrão
  try {
    conn.run(`INSERT OR IGNORE INTO robos_sefaz_uf (uf, portal_url) VALUES ('PB', 'https://www.receita.pb.gov.br/')`);
    conn.run(`INSERT OR IGNORE INTO robos_sefaz_uf (uf, portal_url) VALUES ('SP', 'https://www.fazenda.sp.gov.br/')`);
  } catch (e) {}

  // Migrações de colunas
  const migracoes = [
    { sql: 'ALTER TABLE notas_fiscais ADD COLUMN empresa_id INTEGER', msg: 'empresa_id em notas_fiscais' },
    { sql: "ALTER TABLE empresas ADD COLUMN nome_fantasia TEXT DEFAULT ''", msg: 'nome_fantasia em empresas' },
    { sql: "ALTER TABLE empresas ADD COLUMN tipo TEXT NOT NULL DEFAULT 'matriz'", msg: 'tipo em empresas' },
    { sql: 'ALTER TABLE empresas ADD COLUMN matriz_id INTEGER', msg: 'matriz_id em empresas' },
    { sql: "ALTER TABLE empresas ADD COLUMN totvs_base_url TEXT DEFAULT ''", msg: 'totvs_base_url em empresas' },
    { sql: "ALTER TABLE empresas ADD COLUMN totvs_user TEXT DEFAULT ''", msg: 'totvs_user em empresas' },
    { sql: "ALTER TABLE empresas ADD COLUMN totvs_password TEXT DEFAULT ''", msg: 'totvs_password em empresas' },
    { sql: "ALTER TABLE empresas ADD COLUMN totvs_token TEXT DEFAULT ''", msg: 'totvs_token em empresas' },
    { sql: "ALTER TABLE empresas ADD COLUMN totvs_client_id TEXT DEFAULT ''", msg: 'totvs_client_id em empresas' },
    { sql: "ALTER TABLE empresas ADD COLUMN totvs_client_secret TEXT DEFAULT ''", msg: 'totvs_client_secret em empresas' },
    { sql: "ALTER TABLE empresas ADD COLUMN totvs_branch TEXT DEFAULT ''", msg: 'totvs_branch em empresas' },
    { sql: "ALTER TABLE empresas ADD COLUMN totvs_grant_type TEXT DEFAULT 'password'", msg: 'totvs_grant_type em empresas' },
    { sql: 'ALTER TABLE empresas ADD COLUMN totvs_ativo INTEGER DEFAULT 0', msg: 'totvs_ativo em empresas' },
    { sql: "ALTER TABLE configuracoes ADD COLUMN totvs_base_url TEXT DEFAULT ''", msg: 'totvs_base_url em config' },
    { sql: "ALTER TABLE configuracoes ADD COLUMN totvs_user TEXT DEFAULT ''", msg: 'totvs_user em config' },
    { sql: "ALTER TABLE configuracoes ADD COLUMN totvs_password TEXT DEFAULT ''", msg: 'totvs_password em config' },
    { sql: "ALTER TABLE configuracoes ADD COLUMN totvs_client_id TEXT DEFAULT ''", msg: 'totvs_client_id em config' },
    { sql: "ALTER TABLE configuracoes ADD COLUMN totvs_client_secret TEXT DEFAULT ''", msg: 'totvs_client_secret em config' },
    { sql: "ALTER TABLE configuracoes ADD COLUMN totvs_grant_type TEXT DEFAULT 'password'", msg: 'totvs_grant_type em config' },
    { sql: "ALTER TABLE configuracoes ADD COLUMN totvs_token TEXT DEFAULT ''", msg: 'totvs_token em config' },
    // ── Domínio (Thomson Reuters) ──
    { sql: "ALTER TABLE notas_fiscais ADD COLUMN dominio_status TEXT DEFAULT 'pendente'", msg: 'dominio_status em notas_fiscais' },
    { sql: 'ALTER TABLE notas_fiscais ADD COLUMN dominio_enviado_em TEXT', msg: 'dominio_enviado_em em notas_fiscais' },
    { sql: "ALTER TABLE notas_fiscais ADD COLUMN dominio_erro TEXT DEFAULT ''", msg: 'dominio_erro em notas_fiscais' },
    { sql: "ALTER TABLE notas_fiscais ADD COLUMN dominio_batch_id TEXT DEFAULT ''", msg: 'dominio_batch_id em notas_fiscais' },
    { sql: "ALTER TABLE empresas ADD COLUMN dominio_client_id TEXT DEFAULT ''", msg: 'dominio_client_id em empresas' },
    { sql: "ALTER TABLE empresas ADD COLUMN dominio_client_secret TEXT DEFAULT ''", msg: 'dominio_client_secret em empresas' },
    { sql: "ALTER TABLE empresas ADD COLUMN dominio_integration_key TEXT DEFAULT ''", msg: 'dominio_integration_key em empresas' },
    { sql: 'ALTER TABLE empresas ADD COLUMN dominio_ativo INTEGER DEFAULT 0', msg: 'dominio_ativo em empresas' },
    { sql: "ALTER TABLE empresas ADD COLUMN dominio_auth_url TEXT DEFAULT ''", msg: 'dominio_auth_url em empresas' },
    { sql: "ALTER TABLE empresas ADD COLUMN dominio_api_url TEXT DEFAULT ''", msg: 'dominio_api_url em empresas' },
    { sql: "ALTER TABLE configuracoes ADD COLUMN dominio_client_id TEXT DEFAULT ''", msg: 'dominio_client_id em config' },
    { sql: "ALTER TABLE configuracoes ADD COLUMN dominio_client_secret TEXT DEFAULT ''", msg: 'dominio_client_secret em config' },
    { sql: "ALTER TABLE configuracoes ADD COLUMN dominio_auth_url TEXT DEFAULT ''", msg: 'dominio_auth_url em config' },
    { sql: "ALTER TABLE configuracoes ADD COLUMN dominio_api_url TEXT DEFAULT ''", msg: 'dominio_api_url em config' }
  ];
  migracoes.forEach(({ sql, msg }) => {
    try { conn.run(sql); console.log('✅ Migração: ' + msg); } catch (_) {}
  });

  indexes.forEach(sql => { try { conn.run(sql); } catch (_) {} });

  // ── Migrar registro legado para tabela empresas ───────────────────────
  try {
    const legado = queryOne('SELECT * FROM configuracoes ORDER BY id DESC LIMIT 1');
    if (legado && legado.cnpj) {
      const jaExiste = queryOne('SELECT id FROM empresas WHERE cnpj = ?', [legado.cnpj.replace(/\D/g, '')]);
      if (!jaExiste) {
        conn.run(`
          INSERT INTO empresas (cnpj, razao_social, uf, ambiente, certificado_nome, certificado_senha, ultimo_nsu)
          VALUES (?, ?, ?, ?, ?, ?, ?)
        `, [
          legado.cnpj.replace(/\D/g, ''), legado.razao_social || '',
          legado.uf || 'SP', legado.ambiente || 'producao',
          legado.certificado_nome || '', legado.certificado_senha || '',
          legado.ultimo_nsu || '000000000000000'
        ]);
        console.log('✅ Empresa migrada da configuração legada:', legado.cnpj);
      }
    }
  } catch (_) {}

  // Manutenção automática: Corrige modelos ausentes baseando-se na chave de acesso
  try {
    conn.run("UPDATE notas_fiscais SET schema_type = substr(chave_acesso, 21, 2) WHERE schema_type IS NULL OR schema_type = '' OR length(schema_type) > 3");
  } catch (e) { console.error('⚠️ Erro na manutenção de modelos:', e.message); }

  saveDb();
  console.log('✅ Banco de dados inicializado');
}

// ── Helpers ──────────────────────────────────────────────────────────────

function queryOne(sql, params = []) {
  const stmt = db.prepare(sql);
  stmt.bind(params);
  let result = null;
  if (stmt.step()) result = stmt.getAsObject();
  stmt.free();
  return result;
}

function queryAll(sql, params = []) {
  const stmt = db.prepare(sql);
  stmt.bind(params);
  const results = [];
  while (stmt.step()) results.push(stmt.getAsObject());
  stmt.free();
  return results;
}

function runSql(sql, params = []) {
  db.run(sql, params);
  saveDb();
}

// ── Configuração Legada (compatibilidade) ────────────────────────────────

function getConfig() {
  // Prioridade 1: Tabela de configurações globais
  let config = queryOne('SELECT * FROM configuracoes ORDER BY id DESC LIMIT 1');
  
  // Se a global não tem os dados da TOTVS, tenta buscar de qualquer empresa que tenha
  if (config && (!config.totvs_base_url || config.totvs_base_url === '')) {
    const empresaComTotvs = queryOne('SELECT totvs_base_url, totvs_user, totvs_password, totvs_client_id, totvs_client_secret, totvs_grant_type FROM empresas WHERE totvs_base_url IS NOT NULL AND totvs_base_url != "" LIMIT 1');
    if (empresaComTotvs) {
      config = { ...config, ...empresaComTotvs };
    }
  }

  // Fallback: Se não tem nada na configuracoes, retorna a primeira empresa ativa (legado)
  if (!config) {
    config = queryOne('SELECT * FROM empresas WHERE ativo = 1 ORDER BY id ASC LIMIT 1');
  }
  
  return config;
}

function saveConfig(config) {
  const cnpj = (config.cnpj || '').replace(/\D/g, '');
  const existing = queryOne('SELECT * FROM empresas WHERE cnpj = ?', [cnpj]);
  if (existing) {
    runSql(`
      UPDATE empresas SET razao_social=?, uf=?, ambiente=?, certificado_nome=?,
        certificado_senha=?, updated_at=datetime('now') WHERE cnpj=?
    `, [
      config.razao_social || '', config.uf || 'SP', config.ambiente || 'producao',
      config.certificado_nome || existing.certificado_nome || '',
      config.certificado_senha || existing.certificado_senha || '', cnpj
    ]);
  } else {
    runSql(`
      INSERT INTO empresas (cnpj, razao_social, uf, ambiente, certificado_nome, certificado_senha)
      VALUES (?, ?, ?, ?, ?, ?)
    `, [cnpj, config.razao_social || '', config.uf || 'SP',
        config.ambiente || 'producao', config.certificado_nome || '', config.certificado_senha || '']);
  }
  return queryOne('SELECT * FROM empresas WHERE cnpj = ?', [cnpj]);
}

function saveTotvsGlobalConfig(data) {
  let config = queryOne('SELECT * FROM configuracoes ORDER BY id DESC LIMIT 1');
  if (config) {
    runSql(`
      UPDATE configuracoes SET 
        totvs_base_url=?, totvs_user=?, totvs_password=?, 
        totvs_client_id=?, totvs_client_secret=?, totvs_grant_type=?,
        updated_at=datetime('now')
      WHERE id=?
    `, [
      data.totvs_base_url || '', data.totvs_user || '', data.totvs_password || '',
      data.totvs_client_id || '', data.totvs_client_secret || '', data.totvs_grant_type || 'password',
      config.id
    ]);
  } else {
    runSql(`
      INSERT INTO configuracoes (cnpj, totvs_base_url, totvs_user, totvs_password, totvs_client_id, totvs_client_secret, totvs_grant_type)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `, [
      '00000000000000',
      data.totvs_base_url || '', data.totvs_user || '', data.totvs_password || '',
      data.totvs_client_id || '', data.totvs_client_secret || '', data.totvs_grant_type || 'password'
    ]);
  }
}

function updateUltimoNSU(nsu, empresaId = null) {
  if (empresaId) {
    runSql("UPDATE empresas SET ultimo_nsu=?, updated_at=datetime('now') WHERE id=?", [nsu, empresaId]);
  } else {
    const emp = getConfig();
    if (emp) runSql("UPDATE empresas SET ultimo_nsu=?, updated_at=datetime('now') WHERE id=?", [nsu, emp.id]);
  }
}

// ── Empresas ─────────────────────────────────────────────────────────────

function getEmpresas() {
  return queryAll('SELECT * FROM empresas ORDER BY razao_social ASC');
}

function getMatrizes() {
  return queryAll("SELECT id, cnpj, razao_social, nome_fantasia FROM empresas WHERE tipo = 'matriz' ORDER BY razao_social ASC");
}

function getEmpresaById(id) {
  return queryOne('SELECT * FROM empresas WHERE id = ?', [id]);
}

function getEmpresaByCnpj(cnpj) {
  return queryOne('SELECT * FROM empresas WHERE cnpj = ?', [cnpj.replace(/\D/g, '')]);
}

function createEmpresa(data) {
  const cnpj = (data.cnpj || '').replace(/\D/g, '');
  if (!cnpj) throw new Error('CNPJ é obrigatório');
  const tipo = data.tipo === 'filial' ? 'filial' : 'matriz';
  const matrizId = tipo === 'filial' && data.matriz_id ? parseInt(data.matriz_id) : null;
  runSql(`
    INSERT INTO empresas (cnpj, razao_social, nome_fantasia, tipo, matriz_id, uf, ambiente, certificado_nome, certificado_senha, totvs_base_url, totvs_user, totvs_password, totvs_client_id, totvs_client_secret, totvs_branch, totvs_grant_type, totvs_ativo, dominio_client_id, dominio_client_secret, dominio_integration_key, dominio_ativo, dominio_auth_url, dominio_api_url)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `, [cnpj, data.razao_social || '', data.nome_fantasia || '', tipo, matrizId,
      data.uf || 'SP', data.ambiente || 'producao',
      data.certificado_nome || '', data.certificado_senha || '',
      data.totvs_base_url || '', data.totvs_user || '', data.totvs_password || '',
      data.totvs_client_id || '', data.totvs_client_secret || '', data.totvs_branch || '',
      data.totvs_grant_type || 'password',
      data.totvs_ativo || 0,
      data.dominio_client_id || '', data.dominio_client_secret || '',
      data.dominio_integration_key || '', data.dominio_ativo || 0,
      data.dominio_auth_url || '', data.dominio_api_url || '']);
  return getEmpresaByCnpj(cnpj);
}

function updateEmpresa(id, data) {
  const cnpj = data.cnpj ? data.cnpj.replace(/\D/g, '') : null;
  const existing = getEmpresaById(id);
  if (!existing) throw new Error('Empresa não encontrada');
  const tipo = data.tipo || existing.tipo || 'matriz';
  const matrizId = tipo === 'filial' && data.matriz_id ? parseInt(data.matriz_id) : null;

  runSql(`
    UPDATE empresas SET
      cnpj = ?, razao_social = ?, nome_fantasia = ?, tipo = ?, matriz_id = ?, uf = ?, ambiente = ?,
      certificado_nome = COALESCE(NULLIF(?, ''), certificado_nome),
      certificado_senha = COALESCE(NULLIF(?, ''), certificado_senha),
      totvs_base_url = ?, totvs_user = ?, totvs_password = ?, totvs_token = ?, 
      totvs_client_id = ?, totvs_client_secret = ?, totvs_branch = ?, totvs_grant_type = ?, totvs_ativo = ?,
      dominio_client_id = ?, dominio_client_secret = ?, dominio_integration_key = ?, dominio_ativo = ?,
      dominio_auth_url = ?, dominio_api_url = ?,
      updated_at = datetime('now')
    WHERE id = ?
  `, [
    cnpj || existing.cnpj,
    data.razao_social !== undefined ? data.razao_social : existing.razao_social,
    data.nome_fantasia !== undefined ? data.nome_fantasia : existing.nome_fantasia,
    tipo, matrizId,
    data.uf || existing.uf,
    data.ambiente || existing.ambiente,
    data.certificado_nome || '',
    data.certificado_senha || '',
    data.totvs_base_url !== undefined ? data.totvs_base_url : existing.totvs_base_url,
    data.totvs_user !== undefined ? data.totvs_user : existing.totvs_user,
    data.totvs_password !== undefined ? data.totvs_password : existing.totvs_password,
    data.totvs_token !== undefined ? data.totvs_token : existing.totvs_token,
    data.totvs_client_id !== undefined ? data.totvs_client_id : existing.totvs_client_id,
    data.totvs_client_secret !== undefined ? data.totvs_client_secret : existing.totvs_client_secret,
    data.totvs_branch !== undefined ? data.totvs_branch : existing.totvs_branch,
    data.totvs_grant_type !== undefined ? data.totvs_grant_type : existing.totvs_grant_type,
    data.totvs_ativo !== undefined ? data.totvs_ativo : existing.totvs_ativo,
    data.dominio_client_id !== undefined ? data.dominio_client_id : existing.dominio_client_id,
    data.dominio_client_secret !== undefined ? data.dominio_client_secret : existing.dominio_client_secret,
    data.dominio_integration_key !== undefined ? data.dominio_integration_key : existing.dominio_integration_key,
    data.dominio_ativo !== undefined ? data.dominio_ativo : existing.dominio_ativo,
    data.dominio_auth_url !== undefined ? data.dominio_auth_url : existing.dominio_auth_url,
    data.dominio_api_url !== undefined ? data.dominio_api_url : existing.dominio_api_url,
    id
  ]);
  return getEmpresaById(id);
}

function deleteEmpresa(id) {
  runSql('DELETE FROM empresas WHERE id = ?', [id]);
}

function updateEmpresaNSU(id, nsu) {
  runSql("UPDATE empresas SET ultimo_nsu=?, updated_at=datetime('now') WHERE id=?", [nsu, id]);
}

function updateEmpresaCertificado(id, nome, arquivo) {
  runSql(`UPDATE empresas SET certificado_nome=?, certificado_arquivo=?, updated_at=datetime('now') WHERE id=?`,
    [nome, arquivo || '', id]);
}

function updateEmpresaSenha(id, senha) {
  runSql(`UPDATE empresas SET certificado_senha=?, updated_at=datetime('now') WHERE id=?`, [senha, id]);
}

// ── Notas Fiscais ─────────────────────────────────────────────────────────

function insertNota(nota, empresaId = null) {
  try {
    const conn = db; // Usa a instância global já inicializada
    if (!conn) {
      console.error('❌ ERRO: Banco de dados não inicializado!');
      return false;
    }

    const params = [
      empresaId ? parseInt(empresaId) : null,
      nota.chave_acesso || '', 
      (nota.numero_nf || '').toString(), 
      (nota.serie || '').toString(), 
      nota.data_emissao || '',
      parseFloat(nota.valor_total || 0), 
      nota.emitente_cnpj || '', 
      nota.emitente_nome || '',
      nota.destinatario_cnpj || '', 
      nota.destinatario_nome || '',
      nota.tipo || 'entrada', 
      nota.situacao || 'autorizada',
      nota.nsu || null, 
      nota.xml_completo || '', 
      nota.schema_type || (nota.chave_acesso ? nota.chave_acesso.substring(20, 22) : null)
    ];

    conn.run(`
      INSERT OR REPLACE INTO notas_fiscais
        (empresa_id, chave_acesso, numero_nf, serie, data_emissao, valor_total,
         emitente_cnpj, emitente_nome, destinatario_cnpj, destinatario_nome,
         tipo, situacao, nsu, xml_completo, schema_type, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now'))
    `, params);
    
    saveDb();
    return true;
  } catch (err) {
    console.error('❌ FALHA FATAL AO INSERIR NOTA:', err);
    return false;
  }
}

function insertNotas(notas, empresaId = null) {
  let count = 0;
  for (const nota of notas) {
    if (insertNota(nota, empresaId)) count++;
  }
  return count;
}

function getNotas({ tipo, busca, modelo, dataInicio, dataFim, empresaId, pagina = 1, limite = 50 } = {}) {
  let where = [];
  let params = [];

  // Limpeza de emergência: Remove notas com chaves corrompidas (notação científica)
  try {
    db.run("DELETE FROM notas_fiscais WHERE chave_acesso LIKE '%e+%'");
  } catch(e) {}

  if (empresaId) { where.push('empresa_id = ?'); params.push(empresaId); }
  if (tipo && tipo !== 'todos') { where.push('tipo = ?'); params.push(tipo); }
  
  // Filtro por Modelo (schema_type)
  if (modelo && modelo !== 'todos') {
    where.push('schema_type = ?');
    params.push(modelo.toString());
  }

  if (busca) {
    where.push(`(numero_nf LIKE ? OR chave_acesso LIKE ? OR emitente_nome LIKE ? OR emitente_cnpj LIKE ? OR destinatario_nome LIKE ? OR destinatario_cnpj LIKE ?)`);
    const like = `%${busca}%`;
    params.push(like, like, like, like, like, like);
  }
  if (dataInicio) { where.push('data_emissao >= ?'); params.push(dataInicio); }
  if (dataFim) { where.push('data_emissao <= ?'); params.push(dataFim + 'T23:59:59'); }

  const whereClause = where.length > 0 ? 'WHERE ' + where.join(' AND ') : '';
  console.log(`DEBUG: Query WHERE: ${whereClause} | Params:`, params);
  const offset = (pagina - 1) * limite;

  const totalRow = queryOne(`SELECT COUNT(*) as count FROM notas_fiscais ${whereClause}`, params);
  const total = totalRow ? totalRow.count : 0;

  const notas = queryAll(`
    SELECT id, empresa_id, chave_acesso, numero_nf, serie, data_emissao, valor_total,
           emitente_cnpj, emitente_nome, destinatario_cnpj, destinatario_nome,
           tipo, situacao, nsu, schema_type, created_at,
           dominio_status, dominio_enviado_em, dominio_erro
    FROM notas_fiscais ${whereClause}
    ORDER BY data_emissao DESC, id DESC
    LIMIT ? OFFSET ?
  `, [...params, limite, offset]);

  return { notas, total, pagina, limite, totalPaginas: Math.ceil(total / limite) };
}

function getNotaById(id) {
  return queryOne('SELECT * FROM notas_fiscais WHERE id = ?', [id]);
}

function getNotaByChave(chave) {
  return queryOne('SELECT * FROM notas_fiscais WHERE chave_acesso = ?', [chave]);
}

function deleteNota(id) {
  runSql('DELETE FROM notas_fiscais WHERE id = ?', [id]);
}

function getEstatisticas(empresaId = null) {
  const filtro = empresaId ? `WHERE empresa_id = ${empresaId}` : '';
  const total = queryOne(`SELECT COUNT(*) as count FROM notas_fiscais ${filtro}`);
  const entradas = queryOne(`SELECT COUNT(*) as count, COALESCE(SUM(valor_total),0) as valor FROM notas_fiscais ${filtro ? filtro + " AND tipo='entrada'" : "WHERE tipo='entrada'"}`);
  const saidas = queryOne(`SELECT COUNT(*) as count, COALESCE(SUM(valor_total),0) as valor FROM notas_fiscais ${filtro ? filtro + " AND tipo='saida'" : "WHERE tipo='saida'"}`);
  const ultima = queryOne(`SELECT MAX(created_at) as data FROM notas_fiscais ${filtro}`);
  return {
    total: total ? total.count : 0,
    entradas: { count: entradas ? entradas.count : 0, valor: entradas ? entradas.valor : 0 },
    saidas: { count: saidas ? saidas.count : 0, valor: saidas ? saidas.valor : 0 },
    ultimaImportacao: ultima ? ultima.data : null
  };
}

function getAllNotasForExport({ tipo, dataInicio, dataFim, empresaId, modelo } = {}) {
  let where = [];
  let params = [];
  if (empresaId) { where.push('empresa_id = ?'); params.push(empresaId); }
  if (tipo && tipo !== 'todos') { where.push('tipo = ?'); params.push(tipo); }
  if (modelo && modelo !== 'todos') { where.push('schema_type = ?'); params.push(modelo); }
  if (dataInicio) { where.push('data_emissao >= ?'); params.push(dataInicio); }
  if (dataFim) { where.push('data_emissao <= ?'); params.push(dataFim + 'T23:59:59'); }
  const whereClause = where.length > 0 ? 'WHERE ' + where.join(' AND ') : '';
  return queryAll(`SELECT * FROM notas_fiscais ${whereClause} ORDER BY data_emissao DESC`, params);
}

// ── Robôs SEFAZ UF ──────────────────────────────────────
function getUfConfigs() {
  return queryAll('SELECT * FROM robos_sefaz_uf ORDER BY uf ASC');
}

function saveUfConfig(uf, portal_url, ativo) {
  runSql(`
    INSERT INTO robos_sefaz_uf (uf, portal_url, ativo, updated_at) 
    VALUES (?, ?, ?, CURRENT_TIMESTAMP)
    ON CONFLICT(uf) DO UPDATE SET 
      portal_url=excluded.portal_url, 
      ativo=excluded.ativo, 
      updated_at=CURRENT_TIMESTAMP
  `, [uf, portal_url, ativo]);
}

// ── Domínio (Thomson Reuters) ───────────────────────────

function updateDominioStatus(notaId, status, erro = null, batchId = null) {
  const now = status === 'enviado' ? new Date().toISOString() : null;
  runSql(`
    UPDATE notas_fiscais SET
      dominio_status = ?,
      dominio_enviado_em = COALESCE(?, dominio_enviado_em),
      dominio_erro = ?,
      dominio_batch_id = COALESCE(?, dominio_batch_id),
      updated_at = datetime('now')
    WHERE id = ?
  `, [status, now, erro || '', batchId, notaId]);
}

function getNotasParaDominio(empresaId, filtros = {}) {
  let where = ['empresa_id = ?'];
  let params = [empresaId];

  // Se não for reenvio, pega apenas pendentes
  if (!filtros.reenviar) {
    where.push("(dominio_status = 'pendente' OR dominio_status IS NULL)");
  } else {
    where.push("(dominio_status = 'erro')");
  }

  // Filtros opcionais
  if (filtros.dataInicio) { where.push('data_emissao >= ?'); params.push(filtros.dataInicio); }
  if (filtros.dataFim) { where.push('data_emissao <= ?'); params.push(filtros.dataFim + 'T23:59:59'); }
  if (filtros.tipo && filtros.tipo !== 'todos') { where.push('tipo = ?'); params.push(filtros.tipo); }

  const whereClause = 'WHERE ' + where.join(' AND ');
  return queryAll(`SELECT * FROM notas_fiscais ${whereClause} ORDER BY data_emissao DESC`, params);
}

function getDominioStats(empresaId = null) {
  const filtro = empresaId ? `WHERE empresa_id = ${empresaId}` : '';
  const total = queryOne(`SELECT COUNT(*) as count FROM notas_fiscais ${filtro}`);
  const enviadas = queryOne(`SELECT COUNT(*) as count FROM notas_fiscais ${filtro ? filtro + " AND dominio_status = 'enviado'" : "WHERE dominio_status = 'enviado'"}`);
  const pendentes = queryOne(`SELECT COUNT(*) as count FROM notas_fiscais ${filtro ? filtro + " AND (dominio_status = 'pendente' OR dominio_status IS NULL)" : "WHERE (dominio_status = 'pendente' OR dominio_status IS NULL)"}`);
  const erros = queryOne(`SELECT COUNT(*) as count FROM notas_fiscais ${filtro ? filtro + " AND dominio_status = 'erro'" : "WHERE dominio_status = 'erro'"}`);
  return {
    total: total ? total.count : 0,
    enviadas: enviadas ? enviadas.count : 0,
    pendentes: pendentes ? pendentes.count : 0,
    erros: erros ? erros.count : 0
  };
}

function saveDominioGlobalConfig(data) {
  let config = queryOne('SELECT * FROM configuracoes ORDER BY id DESC LIMIT 1');
  if (config) {
    runSql(`
      UPDATE configuracoes SET
        dominio_client_id=?, dominio_client_secret=?,
        dominio_auth_url=?, dominio_api_url=?,
        updated_at=datetime('now')
      WHERE id=?
    `, [
      data.dominio_client_id || '', data.dominio_client_secret || '',
      data.dominio_auth_url || '', data.dominio_api_url || '',
      config.id
    ]);
  } else {
    runSql(`
      INSERT INTO configuracoes (cnpj, dominio_client_id, dominio_client_secret, dominio_auth_url, dominio_api_url)
      VALUES (?, ?, ?, ?, ?)
    `, [
      '00000000000000',
      data.dominio_client_id || '', data.dominio_client_secret || '',
      data.dominio_auth_url || '', data.dominio_api_url || ''
    ]);
  }
}

module.exports = {
  initialize, getDb,
  getConfig, saveConfig, saveTotvsGlobalConfig, updateUltimoNSU,
  getEmpresas, getMatrizes, getEmpresaById, getEmpresaByCnpj,
  createEmpresa, updateEmpresa, deleteEmpresa,
  updateEmpresaNSU, updateEmpresaCertificado, updateEmpresaSenha,
  insertNota, insertNotas, getNotas, getNotaById, getNotaByChave,
  deleteNota, getEstatisticas, getAllNotasForExport,
  getUfConfigs, saveUfConfig,
  updateDominioStatus, getNotasParaDominio, getDominioStats, saveDominioGlobalConfig,
  runSql, saveDb
};


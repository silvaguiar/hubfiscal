CREATE TABLE configuracoes (
  id SERIAL PRIMARY KEY,
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
  dominio_client_id TEXT DEFAULT '',
  dominio_client_secret TEXT DEFAULT '',
  dominio_auth_url TEXT DEFAULT '',
  dominio_api_url TEXT DEFAULT '',
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE empresas (
  id SERIAL PRIMARY KEY,
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
  dominio_client_id TEXT DEFAULT '',
  dominio_client_secret TEXT DEFAULT '',
  dominio_integration_key TEXT DEFAULT '',
  dominio_ativo INTEGER DEFAULT 0,
  dominio_auth_url TEXT DEFAULT '',
  dominio_api_url TEXT DEFAULT '',
  ativo INTEGER DEFAULT 1,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE notas_fiscais (
  id SERIAL PRIMARY KEY,
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
  dominio_status TEXT DEFAULT 'pendente',
  dominio_enviado_em TEXT,
  dominio_erro TEXT DEFAULT '',
  dominio_batch_id TEXT DEFAULT '',
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX idx_nf_empresa ON notas_fiscais(empresa_id);
CREATE INDEX idx_nf_tipo ON notas_fiscais(tipo);
CREATE INDEX idx_nf_emitente ON notas_fiscais(emitente_cnpj);
CREATE INDEX idx_nf_destinatario ON notas_fiscais(destinatario_cnpj);
CREATE INDEX idx_nf_data ON notas_fiscais(data_emissao);
CREATE INDEX idx_nf_chave ON notas_fiscais(chave_acesso);
CREATE INDEX idx_empresas_cnpj ON empresas(cnpj);

CREATE TABLE robos_sefaz_uf (
  uf TEXT PRIMARY KEY,
  portal_url TEXT DEFAULT '',
  ativo INTEGER DEFAULT 1,
  requer_captcha INTEGER DEFAULT 1,
  instrucoes TEXT DEFAULT '',
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

INSERT INTO robos_sefaz_uf (uf, portal_url) VALUES ('PB', 'https://www.receita.pb.gov.br/') ON CONFLICT DO NOTHING;
INSERT INTO robos_sefaz_uf (uf, portal_url) VALUES ('SP', 'https://www.fazenda.sp.gov.br/') ON CONFLICT DO NOTHING;

CREATE TABLE usuarios (
  id SERIAL PRIMARY KEY,
  nome TEXT NOT NULL,
  email TEXT UNIQUE NOT NULL,
  senha_hash TEXT NOT NULL,
  perfil TEXT NOT NULL DEFAULT 'viewer',
  ativo INTEGER DEFAULT 1,
  ultimo_login TIMESTAMP,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE agendamentos (
  id SERIAL PRIMARY KEY,
  empresa_id INTEGER REFERENCES empresas(id),
  tipo TEXT NOT NULL,
  ativo INTEGER DEFAULT 1,
  dias_offset INTEGER DEFAULT 2,
  cron_expressao TEXT DEFAULT '0 6 * * *',
  ultimo_run TIMESTAMP,
  ultimo_status TEXT,
  ultimo_resultado TEXT,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE logs_execucao (
  id SERIAL PRIMARY KEY,
  agendamento_id INTEGER REFERENCES agendamentos(id),
  empresa_id INTEGER REFERENCES empresas(id),
  tipo TEXT NOT NULL,
  status TEXT NOT NULL,
  notas_encontradas INTEGER DEFAULT 0,
  notas_inseridas INTEGER DEFAULT 0,
  notas_enviadas INTEGER DEFAULT 0,
  detalhes TEXT,
  duracao_ms INTEGER,
  executado_em TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX idx_logs_agendamento ON logs_execucao(agendamento_id);
CREATE INDEX idx_logs_empresa ON logs_execucao(empresa_id);

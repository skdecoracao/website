-- CRM SK Decorações: schema inicial consolidado (banco zerado).
--
-- Nasceu de uma cópia do CRM da eKarts em 24/09/2026, só com a parte genérica:
-- leads, negociações em funil, campos por funil, tags, tarefas, anotações,
-- histórico, segmentos, compras manuais e lixeira. Usuários NÃO entram aqui
-- (senha não vai para o repositório): são criados à parte, com senha temporária.
--
-- Aplicar: npx wrangler d1 migrations apply sk-crm-db --remote

PRAGMA foreign_keys = ON;

CREATE TABLE workspaces (
  id INTEGER PRIMARY KEY,
  slug TEXT NOT NULL UNIQUE,
  nome TEXT NOT NULL,
  criado_em TEXT NOT NULL DEFAULT (datetime('now'))
);

-- Papel único por usuário (admin | operador).
CREATE TABLE users (
  id INTEGER PRIMARY KEY,
  email TEXT NOT NULL UNIQUE,
  nome TEXT NOT NULL,
  senha_hash TEXT NOT NULL,
  senha_salt TEXT NOT NULL,
  papel TEXT NOT NULL CHECK (papel IN ('admin','operador')),
  ativo INTEGER NOT NULL DEFAULT 1,
  criado_em TEXT NOT NULL DEFAULT (datetime('now'))
);

-- origem = canônica (src/origem.js); origem_original = o valor bruto recebido.
CREATE TABLE leads (
  id INTEGER PRIMARY KEY,
  workspace_id INTEGER NOT NULL REFERENCES workspaces(id),
  nome TEXT,
  email TEXT,
  telefone TEXT,
  telefone_norm TEXT,
  origem TEXT,
  origem_original TEXT,
  criado_em TEXT NOT NULL DEFAULT (datetime('now')),
  atualizado_em TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE UNIQUE INDEX idx_leads_ws_email ON leads(workspace_id, email) WHERE email IS NOT NULL AND email <> '';
CREATE INDEX idx_leads_ws_tel ON leads(workspace_id, telefone_norm) WHERE telefone_norm IS NOT NULL AND telefone_norm <> '';
CREATE INDEX idx_leads_nome ON leads(workspace_id, nome);

CREATE TABLE tags (
  id INTEGER PRIMARY KEY,
  workspace_id INTEGER NOT NULL REFERENCES workspaces(id),
  nome TEXT NOT NULL
);
CREATE UNIQUE INDEX idx_tags_ws_nome ON tags(workspace_id, nome);

CREATE TABLE lead_tags (
  lead_id INTEGER NOT NULL REFERENCES leads(id) ON DELETE CASCADE,
  tag_id INTEGER NOT NULL REFERENCES tags(id) ON DELETE CASCADE,
  PRIMARY KEY (lead_id, tag_id)
);

-- restrito_admin = 1: operador não vê o funil em lugar nenhum.
CREATE TABLE pipelines (
  id INTEGER PRIMARY KEY,
  workspace_id INTEGER NOT NULL REFERENCES workspaces(id),
  nome TEXT NOT NULL,
  ordem INTEGER NOT NULL DEFAULT 0,
  restrito_admin INTEGER NOT NULL DEFAULT 0
);

-- is_won / is_lost: mover a negociação para a etapa muda o estado dela
-- (vendida / perdida); voltar para uma etapa comum reabre.
CREATE TABLE stages (
  id INTEGER PRIMARY KEY,
  pipeline_id INTEGER NOT NULL REFERENCES pipelines(id) ON DELETE CASCADE,
  nome TEXT NOT NULL,
  ordem INTEGER NOT NULL DEFAULT 0,
  is_won INTEGER NOT NULL DEFAULT 0,
  is_lost INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX idx_stages_pipeline ON stages(pipeline_id, ordem);

CREATE TABLE deals (
  id INTEGER PRIMARY KEY,
  workspace_id INTEGER NOT NULL REFERENCES workspaces(id),
  lead_id INTEGER REFERENCES leads(id) ON DELETE SET NULL,
  pipeline_id INTEGER NOT NULL REFERENCES pipelines(id),
  stage_id INTEGER NOT NULL REFERENCES stages(id),
  titulo TEXT,
  valor REAL NOT NULL DEFAULT 0,
  qualificacao TEXT,                 -- Muito frio | Frio | Morno | Quente | Muito quente
  qualificacao_manual_at TEXT,       -- ajuste manual: o motor automático não sobrescreve
  dono_id INTEGER REFERENCES users(id),
  estado TEXT NOT NULL DEFAULT 'andamento' CHECK (estado IN ('andamento','vendida','perdida')),
  motivo_perda TEXT,
  respondendo_whatsapp INTEGER NOT NULL DEFAULT 0,
  stage_entered_at TEXT NOT NULL DEFAULT (datetime('now')),
  criado_em TEXT NOT NULL DEFAULT (datetime('now')),
  atualizado_em TEXT NOT NULL DEFAULT (datetime('now')),
  fechado_em TEXT
);
CREATE INDEX idx_deals_pipeline_stage ON deals(pipeline_id, stage_id);
CREATE INDEX idx_deals_lead ON deals(lead_id);

CREATE TABLE deal_field_defs (
  id INTEGER PRIMARY KEY,
  pipeline_id INTEGER NOT NULL REFERENCES pipelines(id) ON DELETE CASCADE,
  chave TEXT NOT NULL,
  label TEXT NOT NULL,
  tipo TEXT NOT NULL CHECK (tipo IN ('quick','text','date','number','select')),
  opcoes TEXT,                       -- JSON array para quick/select
  ordem INTEGER NOT NULL DEFAULT 0
);
CREATE UNIQUE INDEX idx_fielddef_pipe_chave ON deal_field_defs(pipeline_id, chave);

CREATE TABLE deal_field_values (
  deal_id INTEGER NOT NULL REFERENCES deals(id) ON DELETE CASCADE,
  field_def_id INTEGER NOT NULL REFERENCES deal_field_defs(id) ON DELETE CASCADE,
  valor TEXT,
  PRIMARY KEY (deal_id, field_def_id)
);

CREATE TABLE tasks (
  id INTEGER PRIMARY KEY,
  workspace_id INTEGER NOT NULL REFERENCES workspaces(id),
  deal_id INTEGER REFERENCES deals(id) ON DELETE CASCADE,
  lead_id INTEGER REFERENCES leads(id) ON DELETE CASCADE,
  titulo TEXT NOT NULL,
  descricao TEXT,
  due_at TEXT,
  feito INTEGER NOT NULL DEFAULT 0,
  criado_por INTEGER REFERENCES users(id),
  criado_em TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX idx_tasks_deal ON tasks(deal_id);
CREATE INDEX idx_tasks_lead ON tasks(lead_id);

CREATE TABLE notes (
  id INTEGER PRIMARY KEY,
  workspace_id INTEGER NOT NULL REFERENCES workspaces(id),
  deal_id INTEGER REFERENCES deals(id) ON DELETE CASCADE,
  lead_id INTEGER REFERENCES leads(id) ON DELETE CASCADE,
  corpo TEXT NOT NULL,
  autor_id INTEGER REFERENCES users(id),
  criado_em TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX idx_notes_deal ON notes(deal_id);
CREATE INDEX idx_notes_lead ON notes(lead_id);

CREATE TABLE events (
  id INTEGER PRIMARY KEY,
  workspace_id INTEGER NOT NULL REFERENCES workspaces(id),
  deal_id INTEGER REFERENCES deals(id) ON DELETE CASCADE,
  lead_id INTEGER REFERENCES leads(id) ON DELETE CASCADE,
  tipo TEXT NOT NULL,
  autor_id INTEGER REFERENCES users(id),
  payload TEXT,                      -- JSON
  criado_em TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX idx_events_deal ON events(deal_id, criado_em);
CREATE INDEX idx_events_lead ON events(lead_id, criado_em);

-- Compras registradas à mão no lead (aba Produtos). Um lead com compra aparece
-- como "Cliente".
CREATE TABLE purchases (
  id INTEGER PRIMARY KEY,
  workspace_id INTEGER NOT NULL REFERENCES workspaces(id),
  lead_id INTEGER NOT NULL REFERENCES leads(id) ON DELETE CASCADE,
  produto TEXT NOT NULL,
  valor REAL NOT NULL DEFAULT 0,
  data TEXT,
  origem TEXT NOT NULL,             -- manual
  ref_externa TEXT NOT NULL,        -- único, para idempotência
  criado_em TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX idx_purchases_lead ON purchases(lead_id);
CREATE UNIQUE INDEX idx_purchases_ref ON purchases(workspace_id, ref_externa);

CREATE TABLE segments (
  id INTEGER PRIMARY KEY,
  workspace_id INTEGER NOT NULL REFERENCES workspaces(id),
  nome TEXT NOT NULL,
  filtros TEXT NOT NULL,            -- JSON
  criado_por INTEGER REFERENCES users(id),
  criado_em TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX idx_segments_ws ON segments(workspace_id);

-- Lixeira de negociações: apagar vira snapshot JSON aqui (deal + campos +
-- tarefas + anotações + eventos) e some das tabelas vivas; restaurar recria.
-- A varredura horária apaga de vez o que passou de 30 dias (src/lixeira.js).
CREATE TABLE lixeira (
  id INTEGER PRIMARY KEY,
  workspace_id INTEGER NOT NULL,
  deal_id INTEGER NOT NULL,
  lead_id INTEGER,
  pipeline_id INTEGER NOT NULL,
  titulo TEXT,
  valor REAL NOT NULL DEFAULT 0,
  estado TEXT,
  lead_nome TEXT,
  pipeline_nome TEXT,
  stage_nome TEXT,
  snapshot TEXT NOT NULL,
  apagada_por INTEGER,
  apagada_em TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX idx_lixeira_apagada ON lixeira(apagada_em);

-- ---------------------------------------------------------------- dados iniciais
INSERT INTO workspaces (id, slug, nome) VALUES (1, 'sk', 'SK Decorações');

-- Funil "Vendas". Ganho: "Reservado (sinal pago)" (é o botão "Marcar venda") e
-- "Festa realizada"; perda: "Perdido". O nome "Orçamento enviado" também é lido
-- pelo motor de temperatura (src/qualif.js, esfria sem retorno).
INSERT INTO pipelines (id, workspace_id, nome, ordem, restrito_admin) VALUES (1, 1, 'Vendas', 0, 0);
INSERT INTO stages (pipeline_id, nome, ordem, is_won, is_lost) VALUES
  (1, 'Novo contato', 0, 0, 0),
  (1, 'Orçamento enviado', 1, 0, 0),
  (1, 'Negociando', 2, 0, 0),
  (1, 'Reservado (sinal pago)', 3, 1, 0),
  (1, 'Festa realizada', 4, 1, 0),
  (1, 'Perdido', 5, 0, 1);

-- Campos da negociação (iguais a CAMPOS_PADRAO em src/index.js, que os cria em
-- todo funil novo). O preço entre parênteses no pacote vira o valor da
-- negociação quando ela ainda está zerada.
INSERT INTO deal_field_defs (pipeline_id, chave, label, tipo, opcoes, ordem) VALUES
  (1, 'data_festa', 'Data da festa', 'date', NULL, 0),
  (1, 'tema', 'Tema', 'text', NULL, 1),
  (1, 'pacote', 'Pacote', 'select', '["Kit Festa na Mesa (R$ 85)","Kit Festa na Mesa Completo (R$ 170)","Decoração Essencial (R$ 300)","Decoração Completa (R$ 550)"]', 2),
  (1, 'entrega', 'Retirada ou montagem', 'select', '["Retirada","Montagem no local"]', 3),
  (1, 'local', 'Bairro / cidade', 'text', NULL, 4);

-- Tags iniciais. "Não quer e-mail" é a única herdada do CRM da eKarts (marca de
-- descadastro, genérica de qualquer CRM); as outras são da SK.
INSERT INTO tags (workspace_id, nome) VALUES
  (1, 'Kit Festa na Mesa'),
  (1, 'Kit Completo'),
  (1, 'Decoração Essencial'),
  (1, 'Decoração Completa'),
  (1, 'Tema fora do estoque'),
  (1, 'Instagram'),
  (1, 'Indicação'),
  (1, 'Site'),
  (1, 'Não quer e-mail');

-- Segmento pronto: quem pediu orçamento e ainda não fechou.
INSERT INTO segments (workspace_id, nome, filtros) VALUES
  (1, 'Negociações abertas', '{"negociacao":"com"}');

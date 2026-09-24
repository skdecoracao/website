// Lixeira de negociações: apagar vira snapshot JSON (deal + campos + tarefas +
// anotações + eventos) na tabela lixeira, e a deal some das tabelas vivas.
// Restaurar recria tudo a partir do snapshot; a varredura horária apaga de vez
// o que passou de LIXEIRA_DIAS. Tabela lixeira em migrations/0001_init.sql.

export const LIXEIRA_DIAS = 30;

// Move a deal para a lixeira. Devolve a linha da deal (para o evento) e o id na
// lixeira. Quem chama já validou permissão.
export async function mandaParaLixeira(db, dealId, userId) {
  const deal = await db.prepare('SELECT * FROM deals WHERE id = ?').bind(dealId).first();
  if (!deal) return null;
  const q = async (sql) => (await db.prepare(sql).bind(dealId).all()).results;
  const snapshot = {
    deal,
    fields: await q('SELECT * FROM deal_field_values WHERE deal_id = ?'),
    tasks: await q('SELECT * FROM tasks WHERE deal_id = ?'),
    notes: await q('SELECT * FROM notes WHERE deal_id = ?'),
    events: await q('SELECT * FROM events WHERE deal_id = ?'),
  };
  const nomes = await db.prepare(
    'SELECT (SELECT nome FROM leads WHERE id = ?1) lead_nome, (SELECT nome FROM pipelines WHERE id = ?2) pipeline_nome, (SELECT nome FROM stages WHERE id = ?3) stage_nome'
  ).bind(deal.lead_id, deal.pipeline_id, deal.stage_id).first();
  const r = await db.prepare(
    'INSERT INTO lixeira (workspace_id, deal_id, lead_id, pipeline_id, titulo, valor, estado, lead_nome, pipeline_nome, stage_nome, snapshot, apagada_por) VALUES (?,?,?,?,?,?,?,?,?,?,?,?)'
  ).bind(deal.workspace_id, deal.id, deal.lead_id, deal.pipeline_id, deal.titulo, deal.valor, deal.estado,
    nomes.lead_nome, nomes.pipeline_nome, nomes.stage_nome, JSON.stringify(snapshot), userId || null).run();
  // CASCADE leva campos, tarefas, anotações e eventos da deal junto.
  await db.prepare('DELETE FROM deals WHERE id = ?').bind(dealId).run();
  return { deal, lixeiraId: r.meta.last_row_id };
}

// INSERT genérico a partir de um objeto (colunas = chaves). Colunas que o
// snapshot tem e a tabela não tem mais quebrariam: não há caso hoje, e se
// houver o erro sobe para o chamador com a mensagem do D1.
async function insere(db, tabela, row) {
  const cols = Object.keys(row);
  const r = await db.prepare(`INSERT INTO ${tabela} (${cols.join(',')}) VALUES (${cols.map(() => '?').join(',')})`)
    .bind(...cols.map((c) => (row[c] === undefined ? null : row[c]))).run();
  return r.meta.last_row_id;
}

// Recria a deal a partir do snapshot. Mantém o id original se ainda estiver
// livre (assim links antigos voltam a funcionar); senão ganha id novo. Etapa
// que sumiu cai na primeira etapa do funil; lead que sumiu fica sem lead.
// Devolve { id, deal } ou lança { _400: msg } quando o funil não existe mais.
export async function restauraDaLixeira(db, row) {
  const snap = JSON.parse(row.snapshot);
  const deal = { ...snap.deal };
  const pipe = await db.prepare('SELECT id FROM pipelines WHERE id = ?').bind(deal.pipeline_id).first();
  if (!pipe) throw { _400: 'o funil dessa negociação não existe mais; não dá para restaurar' };
  const st = await db.prepare('SELECT id FROM stages WHERE id = ? AND pipeline_id = ?').bind(deal.stage_id, deal.pipeline_id).first();
  if (!st) {
    const primeira = await db.prepare('SELECT id FROM stages WHERE pipeline_id = ? ORDER BY ordem LIMIT 1').bind(deal.pipeline_id).first();
    if (!primeira) throw { _400: 'o funil dessa negociação está sem etapas; não dá para restaurar' };
    deal.stage_id = primeira.id;
  }
  if (deal.lead_id && !(await db.prepare('SELECT 1 FROM leads WHERE id = ?').bind(deal.lead_id).first())) deal.lead_id = null;
  if (deal.dono_id && !(await db.prepare('SELECT 1 FROM users WHERE id = ?').bind(deal.dono_id).first())) deal.dono_id = null;
  const idLivre = !(await db.prepare('SELECT 1 FROM deals WHERE id = ?').bind(deal.id).first());
  if (!idLivre) delete deal.id;
  deal.atualizado_em = new Date().toISOString().slice(0, 19).replace('T', ' ');
  const id = idLivre ? (await insere(db, 'deals', deal), deal.id) : await insere(db, 'deals', deal);

  for (const f of snap.fields || []) {
    if (!(await db.prepare('SELECT 1 FROM deal_field_defs WHERE id = ?').bind(f.field_def_id).first())) continue;
    const { id: _i, ...resto } = f;
    await insere(db, 'deal_field_values', { ...resto, deal_id: id });
  }
  for (const t of snap.tasks || []) { const { id: _i, ...resto } = t; await insere(db, 'tasks', { ...resto, deal_id: id }); }
  for (const n of snap.notes || []) { const { id: _i, ...resto } = n; await insere(db, 'notes', { ...resto, deal_id: id }); }
  for (const e of snap.events || []) {
    const { id: _i, ...resto } = e;
    await insere(db, 'events', { ...resto, deal_id: id, lead_id: deal.lead_id });
  }
  await db.prepare('DELETE FROM lixeira WHERE id = ?').bind(row.id).run();
  return { id, deal: { ...deal, id } };
}

// Apaga de vez o que está na lixeira há mais de LIXEIRA_DIAS. Roda na
// varredura horária. Devolve quantas linhas saíram.
export async function esvaziaLixeira(db) {
  const r = await db.prepare(`DELETE FROM lixeira WHERE apagada_em < datetime('now', '-${LIXEIRA_DIAS} days')`).run();
  return r.meta.changes || 0;
}

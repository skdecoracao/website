// Motor de temperatura (qualificação automática) do CRM.
// Escala TEXT em deals.qualificacao: nível 1..5 = Muito frio..Muito quente.
// Gatilhos na hora (entrada de lead, mover etapa, WhatsApp) ficam em index.js;
// aqui vivem os limiares, os helpers de nível e a varredura horária (cron).

import { esvaziaLixeira } from './lixeira.js';

// ---------- limiares ajustáveis ----------
export const NIVEIS = ['Muito frio', 'Frio', 'Morno', 'Quente', 'Muito quente']; // idx+1 = nível
export const NIVEL_MAX = 5;
export const WHATSAPP_MIN = 4;          // WhatsApp respondendo sobe para no mínimo este nível
export const ETAPA_RAPIDA_MIN = 4;      // avanço com menos de ETAPA_RAPIDA_H na etapa anterior vai direto para este mínimo
export const ETAPA_RAPIDA_H = 48;       // horas
export const INATIVIDADE_DIAS = 14;     // sem atividade: -1 a cada tanto de dias
// Decaimento antes do primeiro contato: [horas desde a criação, nível absoluto alvo].
export const DECAI_SEM_CONTATO = [
  [5, 4],    // 5h -> Quente
  [24, 3],   // 1 dia -> Morno
  [72, 2],   // 3 dias -> Frio
  [168, 1],  // 7 dias -> Muito frio
];
// Esfria na etapa de orçamento enviado: [horas na etapa, marca do evento].
// A etapa é achada pelo NOME (começo do nome), então renomear a etapa na tela
// desliga esta regra em silêncio.
export const ORCAMENTO_STAGE_LIKE = 'Orçamento enviado%';
export const ESFRIA_ORCAMENTO = [
  [72, 'orcamento_3d'],   // 3 dias -1
  [168, 'orcamento_7d'],  // 7 dias mais -1
];

// ---------- helpers de nível <-> label ----------
export function nivelDeLabel(label) { const i = NIVEIS.indexOf(label); return i < 0 ? 3 : i + 1; }
export function labelDeNivel(n) { return NIVEIS[Math.max(1, Math.min(NIVEL_MAX, n)) - 1]; }

const CASE_NIVEL = `(CASE qualificacao WHEN 'Muito frio' THEN 1 WHEN 'Frio' THEN 2 WHEN 'Morno' THEN 3 WHEN 'Quente' THEN 4 WHEN 'Muito quente' THEN 5 ELSE 3 END)`;
// label a partir de uma expressão de nível inteiro (limitada a 1..5)
function labelSql(nivelExpr) {
  const c = `MAX(1, MIN(${NIVEL_MAX}, ${nivelExpr}))`;
  return `(CASE ${c} WHEN 1 THEN 'Muito frio' WHEN 2 THEN 'Frio' WHEN 3 THEN 'Morno' WHEN 4 THEN 'Quente' WHEN 5 THEN 'Muito quente' END)`;
}
// base do relógio de "antes do primeiro contato": criação ou último reengajamento
const BASE_SEM_CONTATO = `MAX(criado_em, COALESCE((SELECT MAX(criado_em) FROM events e WHERE e.deal_id = deals.id AND e.tipo = 'reengajamento'), criado_em))`;
const HORAS_DESDE = (col) => `((julianday('now') - julianday(${col})) * 24)`;

// negociação na etapa inicial, sem nenhum sinal de contato
const SEM_CONTATO_WHERE = `
  estado = 'andamento' AND qualificacao_manual_at IS NULL AND respondendo_whatsapp = 0
  AND stage_id = (SELECT s.id FROM stages s WHERE s.pipeline_id = deals.pipeline_id ORDER BY s.ordem, s.id LIMIT 1)
  AND NOT EXISTS (SELECT 1 FROM events e WHERE e.deal_id = deals.id AND e.tipo = 'deal_movida')
  AND NOT EXISTS (SELECT 1 FROM notes n WHERE n.deal_id = deals.id)
  AND NOT EXISTS (SELECT 1 FROM tasks t WHERE t.deal_id = deals.id AND t.feito = 1)`;

// grava evento qualificacao_auto (SELECT set-based) e depois aplica o UPDATE, no mesmo WHERE.
async function aplica(db, where, targetLabelSql, regra, motivoSql) {
  await db.prepare(
    `INSERT INTO events (workspace_id, deal_id, lead_id, tipo, payload)
     SELECT workspace_id, id, lead_id, 'qualificacao_auto',
            json_object('regra', ?, 'motivo', ${motivoSql})
     FROM deals WHERE ${where}`).bind(regra).run();
  await db.prepare(
    `UPDATE deals SET qualificacao = ${targetLabelSql}, atualizado_em = datetime('now') WHERE ${where}`).run();
}

// ---------- varredura horária ----------
export async function varredura(db, _env) {
  // 1) decaimento antes do primeiro contato (alvos absolutos, idempotente)
  for (let i = 0; i < DECAI_SEM_CONTATO.length; i++) {
    const [h, nivel] = DECAI_SEM_CONTATO[i];
    const prox = DECAI_SEM_CONTATO[i + 1];
    const alvo = labelDeNivel(nivel);
    const idade = HORAS_DESDE(BASE_SEM_CONTATO);
    const bound = `${idade} >= ${h}` + (prox ? ` AND ${idade} < ${prox[0]}` : '');
    const where = `${SEM_CONTATO_WHERE} AND ${bound} AND qualificacao <> '${alvo}'`;
    const rotulo = { 5: '5 horas', 24: '1 dia', 72: '3 dias', 168: '7 dias' }[h] || `${h}h`;
    await aplica(db, where, `'${alvo}'`, 'sem_contato', `'Sem contato há ${rotulo}: de ' || qualificacao || ' para ${alvo}'`);
  }

  // 2) esfria na etapa de orçamento enviado (relativo, marcado por evento)
  const orcStage = `stage_id IN (SELECT id FROM stages WHERE nome LIKE '${ORCAMENTO_STAGE_LIKE}')`;
  for (const [h, regra] of ESFRIA_ORCAMENTO) {
    const marca = `NOT EXISTS (SELECT 1 FROM events e WHERE e.deal_id = deals.id AND e.tipo = 'qualificacao_auto' AND json_extract(e.payload,'$.regra') = '${regra}' AND e.criado_em >= deals.stage_entered_at)`;
    const where = `estado = 'andamento' AND qualificacao_manual_at IS NULL AND ${orcStage}
      AND ${HORAS_DESDE('stage_entered_at')} >= ${h} AND ${CASE_NIVEL} > 1 AND ${marca}`;
    const dias = h / 24;
    await aplica(db, where, labelSql(`${CASE_NIVEL} - 1`), regra,
      `'Orçamento sem retorno há ${dias} dias: de ' || qualificacao || ' para ' || ${labelSql(`${CASE_NIVEL} - 1`)}`);
  }

  // 3) inatividade: sem eventos/tarefas/notas há INATIVIDADE_DIAS, repetindo (marca por evento)
  const ultimaAtividade = `COALESCE((SELECT MAX(criado_em) FROM events e WHERE e.deal_id = deals.id AND e.tipo <> 'qualificacao_auto'), criado_em)`;
  const semInatividadeRecente = `NOT EXISTS (SELECT 1 FROM events e WHERE e.deal_id = deals.id AND e.tipo = 'qualificacao_auto' AND json_extract(e.payload,'$.regra') = 'inatividade' AND ${HORAS_DESDE('e.criado_em')} < ${INATIVIDADE_DIAS * 24})`;
  {
    const where = `estado = 'andamento' AND qualificacao_manual_at IS NULL AND ${CASE_NIVEL} > 1
      AND ${HORAS_DESDE(ultimaAtividade)} >= ${INATIVIDADE_DIAS * 24} AND ${semInatividadeRecente}`;
    await aplica(db, where, labelSql(`${CASE_NIVEL} - 1`), 'inatividade',
      `'Sem atividade há ${INATIVIDADE_DIAS} dias: de ' || qualificacao || ' para ' || ${labelSql(`${CASE_NIVEL} - 1`)}`);
  }

  // 4) lixeira de negociações: apaga de vez o que está lá há mais de 30 dias.
  //    Isolado: housekeeping nunca derruba o motor de temperatura.
  try { await esvaziaLixeira(db); } catch (e) { console.error('esvaziaLixeira:', e && e.message); }
}

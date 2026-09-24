import React, { useEffect, useRef, useState } from 'react';
import { api, QUALIF, brl, dataHora } from './api.js';

function isoDataOffset(offsetDias) {
  const d = new Date(); d.setDate(d.getDate() + offsetDias);
  return d.toISOString().slice(0, 10);
}
function dueAtLocal(dataISO, horaHHMM) {
  const [ano, mes, dia] = (dataISO || isoDataOffset(0)).split('-').map(Number);
  const [h, min] = (horaHHMM || '09:00').split(':').map(Number);
  const local = new Date(ano, mes - 1, dia, h, min);
  return local.toISOString().slice(0, 19).replace('T', ' ');
}
const DIAS_RAPIDOS_MODAL = [
  { l: 'Hoje', offset: 0 }, { l: 'Amanhã', offset: 1 }, { l: '+2 dias', offset: 2 }, { l: '+1 semana', offset: 7 },
];

// Criar tarefa sem sair do Kanban: mesmo formato (título + prazo) do que já
// existe na aba Tarefas da negociação, com botões dos títulos mais criados
// historicamente no lugar dos TITULOS_RAPIDOS fixos do Deal.
export function TaskQuickModal({ dealId, onClose, onCreated }) {
  const [titulo, setTitulo] = useState('');
  const [dataISO, setDataISO] = useState('');
  const [hora, setHora] = useState('');
  const [frequentes, setFrequentes] = useState([]);
  const [salvando, setSalvando] = useState(false);

  useEffect(() => { api.titulosFrequentes().then(setFrequentes).catch(() => setFrequentes([])); }, []);

  async function criar() {
    const t = titulo.trim();
    if (!t || salvando) return;
    setSalvando(true);
    const due_at = (dataISO || hora) ? dueAtLocal(dataISO, hora) : undefined;
    // dealId pode ser um id ou uma lista de ids (ação em lote da vista Lista)
    const ids = [].concat(dealId);
    const res = await Promise.allSettled(ids.map((id) => api.createTask({ deal_id: id, titulo: t, due_at })));
    const falhas = res.filter((r) => r.status === 'rejected').length;
    if (falhas === ids.length) { setSalvando(false); return; }
    if (falhas) alert(`${falhas} de ${ids.length} tarefas não foram criadas.`);
    onCreated();
  }

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal-card" onClick={(e) => e.stopPropagation()}>
        <h3>Nova tarefa</h3>
        {frequentes.length > 0 && (
          <div className="quick-btns">
            {frequentes.map((t) => (
              <button key={t} className={titulo === t ? 'on' : ''} onClick={() => setTitulo(t)}>{t}</button>
            ))}
          </div>
        )}
        <div className="kv">
          <input autoFocus placeholder="Título da tarefa..." value={titulo}
            onChange={(e) => setTitulo(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && criar()} />
        </div>
        <div className="quick-btns">
          {DIAS_RAPIDOS_MODAL.map((d) => (
            <button key={d.l} className={dataISO === isoDataOffset(d.offset) ? 'on' : ''} onClick={() => setDataISO(isoDataOffset(d.offset))}>{d.l}</button>
          ))}
        </div>
        <div className="kv" style={{ display: 'flex', gap: 8 }}>
          <input type="date" value={dataISO} onChange={(e) => setDataISO(e.target.value)} />
          <input type="time" value={hora} onChange={(e) => setHora(e.target.value)} />
        </div>
        <div className="modal-actions">
          <button className="btn sm" onClick={onClose}>Cancelar</button>
          <button className="btn ciano sm" disabled={!titulo.trim() || salvando} onClick={criar}>Criar tarefa</button>
        </div>
      </div>
    </div>
  );
}

// Extrai o payload do evento lead_ingerido (origem e rastreamento) de uma lista
// de eventos do lead. Usado quando o backend não devolveu lead.ingest pronto.
function ingestDeEventos(events) {
  const ev = (events || []).find((e) => e.tipo === 'lead_ingerido');
  if (!ev || !ev.payload) return null;
  try { return JSON.parse(ev.payload); } catch { return null; }
}

// Bloco "Origem" (primeiro toque do lead): origem canônica + valor bruto, página
// de entrada e rastreamento de anúncio (utm, gclid, fbclid), só o que existir.
export function OrigemBlock({ lead }) {
  if (!lead) return null;
  const ing = lead.ingest || ingestDeEventos(lead.events) || {};
  const utm = [ing.utm_source, ing.utm_medium, ing.utm_campaign, ing.utm_content, ing.utm_term].filter(Boolean).join(' / ');
  const linhas = [
    ['Página de entrada', ing.pagina_entrada || ing.pagina],
    ['Veio de', ing.referrer],
    ['UTM', utm],
    ['Campanha', ing.campanha],
    ['Clique do Google Ads', ing.gclid ? 'sim (gclid)' : null],
    ['Clique do Instagram/Facebook', ing.fbclid ? 'sim (fbclid)' : null],
    ['Primeiro acesso', ing.primeiro_acesso ? dataHora(String(ing.primeiro_acesso).slice(0, 19).replace('T', ' ')) : null],
  ].filter(([, v]) => v);
  if (!lead.origem && !lead.origem_original && !linhas.length) return null;
  return (
    <div className="origem-block">
      <h3 className="mt">Origem</h3>
      {lead.origem && (
        <div className="contato-line muted">Origem: {lead.origem}
          {lead.origem_original && lead.origem_original !== lead.origem ? ` (${lead.origem_original})` : ''}</div>
      )}
      {linhas.map(([k, v]) => <div key={k} className="contato-line muted">{k}: {v}</div>)}
    </div>
  );
}

// Modal de motivo de perda: select com os motivos ja usados + "Adicionar motivo"
// (campo livre). Confirmar exige um motivo (obrigatorio). onConfirm(motivo) faz
// a chamada; o motivo novo passa a existir na lista assim que a deal o grava.
export function LostModal({ onConfirm, onCancel }) {
  const [motivos, setMotivos] = useState(null);
  const [sel, setSel] = useState('');
  const [novo, setNovo] = useState(false);
  const [texto, setTexto] = useState('');
  const [salvando, setSalvando] = useState(false);
  useEffect(() => { api.lossReasons().then(setMotivos).catch(() => setMotivos([])); }, []);
  const motivo = (novo ? texto : sel).trim();
  async function confirmar() {
    if (!motivo || salvando) return;
    setSalvando(true);
    try { await onConfirm(motivo); } catch { setSalvando(false); }
  }
  return (
    <div className="modal-overlay" onClick={onCancel}>
      <div className="modal-card" onClick={(e) => e.stopPropagation()}>
        <h3>Motivo da perda</h3>
        <div className="kv">
          {!novo ? (
            <select autoFocus value={sel} onChange={(e) => setSel(e.target.value)}>
              <option value="">Selecione um motivo...</option>
              {(motivos || []).map((m) => <option key={m} value={m}>{m}</option>)}
            </select>
          ) : (
            <input autoFocus value={texto} placeholder="Descreva o novo motivo"
              onChange={(e) => setTexto(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && confirmar()} />
          )}
        </div>
        <button className="btn sm" style={{ marginTop: 8 }}
          onClick={() => { setNovo((v) => !v); setTexto(''); setSel(''); }}>
          {novo ? '← Escolher da lista' : '+ Adicionar motivo de perda'}
        </button>
        <div className="modal-actions">
          <button className="btn sm" onClick={onCancel}>Cancelar</button>
          <button className="btn danger sm" disabled={!motivo || salvando} onClick={confirmar}>Confirmar perda</button>
        </div>
      </div>
    </div>
  );
}

// Produtos da SK (mesmos pacotes da LP) para registrar uma compra à mão.
const PRODUTOS = ['Kit Festa na Mesa', 'Kit Festa na Mesa Completo', 'Decoração Essencial', 'Decoração Completa', 'Outro'];

export function PurchasesList({ leadId }) {
  const [compras, setCompras] = useState(null);
  const [tipo, setTipo] = useState(PRODUTOS[0]);
  const [outro, setOutro] = useState('');
  const [valor, setValor] = useState('');
  const [data, setData] = useState(() => new Date().toISOString().slice(0, 10));
  const [salvando, setSalvando] = useState(false);
  const inp = { padding: 7, border: '1px solid var(--linha)', borderRadius: 6, fontFamily: 'inherit', fontSize: 13, background: 'var(--superficie)', color: 'var(--texto)' };

  const recarrega = () => api.leadPurchases(leadId).then(setCompras).catch(() => setCompras([]));
  useEffect(() => { recarrega(); }, [leadId]);

  async function salvar() {
    const produto = tipo === 'Outro' ? outro.trim() : tipo;
    const v = Number(String(valor).replace(',', '.'));
    if (!produto || !(v > 0)) return;
    setSalvando(true);
    try {
      await api.addLeadPurchase(leadId, { produto, valor: v, data });
      setValor(''); setOutro(''); setTipo(PRODUTOS[0]);
      await recarrega();
    } finally { setSalvando(false); }
  }

  return (
    <>
      {!compras ? <p className="muted">Carregando compras...</p>
        : !compras.length ? <p className="muted">Nenhuma compra registrada.</p>
          : (
            <table className="tab compras">
              <thead><tr><th>Produto</th><th>Valor</th><th>Data</th><th>Origem</th></tr></thead>
              <tbody>
                {compras.map((c) => (
                  <tr key={c.id}><td>{c.produto}</td><td>{brl(c.valor)}</td><td>{c.data ? dataHora(c.data) : '-'}</td><td>{c.origem}</td></tr>
                ))}
              </tbody>
            </table>
          )}
      <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', alignItems: 'center', marginTop: 8 }}>
        <select value={tipo} onChange={(e) => setTipo(e.target.value)} style={inp}>
          {PRODUTOS.map((p) => <option key={p}>{p}</option>)}
        </select>
        {tipo === 'Outro' && (
          <input value={outro} onChange={(e) => setOutro(e.target.value)} placeholder="Produto" style={{ ...inp, width: 120 }} />
        )}
        <input type="number" step="0.01" min="0" value={valor} onChange={(e) => setValor(e.target.value)} placeholder="Valor R$" style={{ ...inp, width: 90 }} />
        <input type="date" value={data} onChange={(e) => setData(e.target.value)} style={inp} />
        <button className="btn ciano sm" onClick={salvar} disabled={salvando}>Adicionar</button>
      </div>
    </>
  );
}

// Nível 1..5 tolerante: aceita label canônico, número "1".."5" ou
// variantes de caixa. Desconhecido/vazio cai em Frio (2): regra "sem qualificação = Frio".
export function nivelQualif(q) {
  if (q == null || q === '') return 2;
  const s = String(q).trim();
  const i = QUALIF.findIndex((v) => v.toLowerCase() === s.toLowerCase());
  if (i >= 0) return i + 1;
  const n = parseInt(s, 10);
  if (n >= 1 && n <= 5) return n;
  return 2;
}
export function labelQualif(q) { return QUALIF[nivelQualif(q) - 1]; }

// estrelinha de qualificacao (Muito frio -> Muito quente)
export function Stars({ q }) {
  const n = nivelQualif(q);
  return <span className="stars" title={labelQualif(q)}>{'★'.repeat(n)}{'☆'.repeat(5 - n)}</span>;
}

// barra de calor: termometro frio->quente preenchido conforme o nivel 1-5.
// Mesma fonte de dado da qualificacao; so visual. Rotulo ao lado em texto pequeno.
export function HeatBar({ q, showLabel = true }) {
  const n = nivelQualif(q);
  const label = labelQualif(q);
  // Nível 5 (Muito quente) ganha efeito "pegando fogo" (CSS puro): ver .heat-fire.
  return (
    <span className={'heat' + (n === 5 ? ' heat-fire' : '')} title={label}>
      <span className="heat-track">
        <span className="heat-fill" style={{ width: (n / 5 * 100) + '%' }} />
      </span>
      {showLabel && <span className="heat-label">{label}</span>}
    </span>
  );
}

export function Loading({ children = 'Carregando...' }) {
  return <div className="loading">{children}</div>;
}

// timeline compartilhada (events)
const ROTULO = {
  deal_criada: 'Negociação criada',
  deal_movida: 'Movida de etapa',
  deal_vendida: 'Marcada como vendida',
  deal_perdida: 'Marcada como perdida',
  deal_apagada: 'Negociação apagada',
  deal_restaurada: 'Negociação restaurada da lixeira',
  whatsapp_flag: 'Sinalização de WhatsApp',
  tarefa_criada: 'Tarefa criada',
  nota: 'Anotação',
  qualificacao_auto: 'Qualificação automática',
  reengajamento: 'Reengajamento',
  deal_reaberta: 'Negociação reaberta',
  funil_editado: 'Funil editado',
  lead_ingerido: 'Lead recebido',
  reconversao: 'Reconversão',
};

export function eventoTexto(ev) {
  let p = {};
  try { p = ev.payload ? JSON.parse(ev.payload) : {}; } catch { p = {}; }
  if (ev.tipo === 'nota') return p.corpo || '';
  if (ev.tipo === 'deal_perdida') return p.motivo ? `Motivo: ${p.motivo}` : '';
  if (ev.tipo === 'deal_apagada' || ev.tipo === 'deal_restaurada') return p.titulo ? `"${p.titulo}"` : '';
  if (ev.tipo === 'whatsapp_flag') return p.on ? 'Respondendo no WhatsApp: ligado' : 'Respondendo no WhatsApp: desligado';
  if (ev.tipo === 'qualificacao_auto' || ev.tipo === 'reengajamento') return p.motivo || '';
  if (ev.tipo === 'lead_ingerido' || ev.tipo === 'reconversao') {
    const det = [p.pagina && `página ${p.pagina}`, p.botao && `botão "${p.botao}"`,
      p.referrer && `veio de ${p.referrer}`, p.utm_source && `fonte ${p.utm_source}`,
      p.utm_medium && `mídia ${p.utm_medium}`, p.utm_campaign && `campanha ${p.utm_campaign}`,
      p.campanha && `campanha ${p.campanha}`, p.gclid && 'clique do Google Ads',
      p.funil && `funil ${p.funil}`].filter(Boolean).join(', ');
    const por = p.origem_canonica && p.origem_canonica !== p.origem ? `${p.origem_canonica} (${p.origem})` : (p.origem || 'origem desconhecida');
    return `${ev.tipo === 'reconversao' ? 'Voltou por' : 'Lead entrou por'} ${por}${det ? ` (${det})` : ''}`;
  }
  return ROTULO[ev.tipo] || ev.tipo;
}

export function Timeline({ events }) {
  if (!events || !events.length) return <p className="muted">Nada por aqui ainda.</p>;
  const ord = [...events].sort((a, b) => (b.criado_em > a.criado_em ? 1 : -1));
  return (
    <ul className="timeline">
      {ord.map((ev) => (
        <li key={ev.id}>
          <div className="quando">
            <span>{ROTULO[ev.tipo] || ev.tipo}</span>
            <span className="quando-data">{dataHora(ev.criado_em)}</span>
          </div>
          <div className="corpo">{eventoTexto(ev)}</div>
        </li>
      ))}
    </ul>
  );
}

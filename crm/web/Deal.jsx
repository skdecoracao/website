import React, { useEffect, useRef, useState } from 'react';
import { useParams, useNavigate, Link } from 'react-router-dom';
import { api, brl, dataHora, waLink, soTelefone, QUALIF } from './api.js';
import { HeatBar, Loading, Timeline, PurchasesList, OrigemBlock, LostModal } from './ui.jsx';

// Títulos de tarefa em um clique (os mais comuns na rotina da SK).
const TITULOS_RAPIDOS = ['Retornar contato', 'Enviar orçamento', 'Confirmar sinal', 'Confirmar retirada ou montagem'];
const DIAS_RAPIDOS = [
  { l: 'Hoje', offset: 0 }, { l: 'Amanhã', offset: 1 }, { l: '+2 dias', offset: 2 }, { l: '+1 semana', offset: 7 },
];
const HORAS_RAPIDAS = ['10:00', '14:00', '16:00', '18:00'];

function isoData(offsetDias) {
  const d = new Date(); d.setDate(d.getDate() + offsetDias);
  return d.toISOString().slice(0, 10);
}
// combina data (YYYY-MM-DD) + hora (HH:MM) locais em due_at UTC no formato que o backend grava (datetime('now'))
function dueAt(dataISO, horaHHMM) {
  const [ano, mes, dia] = (dataISO || isoData(0)).split('-').map(Number);
  const [h, min] = (horaHHMM || '09:00').split(':').map(Number);
  const local = new Date(ano, mes - 1, dia, h, min);
  return local.toISOString().slice(0, 19).replace('T', ' ');
}

function StageBar({ pipeline, deal, onMove, onPerda }) {
  if (!pipeline) return null;
  const atualIdx = pipeline.stages.findIndex((s) => s.id === deal.stage_id);
  return (
    <div className="stagebar">
      {pipeline.stages.map((s, i) => (
        <button
          key={s.id}
          className={'step' + (s.id === deal.stage_id ? ' on' : i < atualIdx ? ' done' : '')}
          onClick={() => s.id !== deal.stage_id && (s.is_lost ? onPerda() : onMove(s.id))}
        >{s.nome}</button>
      ))}
    </div>
  );
}

function Campo({ def, valor, onSave }) {
  const [v, setV] = useState(valor ?? '');
  useEffect(() => { setV(valor ?? ''); }, [valor]);

  if (def.tipo === 'quick') {
    return (
      <div className="kv">
        <label>{def.label}</label>
        <div className="quick-btns">
          {(def.opcoes || []).map((o) => (
            <button key={o} className={String(v) === String(o) ? 'on' : ''} onClick={() => { setV(o); onSave(o); }}>{o}</button>
          ))}
        </div>
        <input value={v} onChange={(e) => setV(e.target.value)} onBlur={() => onSave(v)} placeholder="Outro valor" />
      </div>
    );
  }
  if (def.tipo === 'select') {
    return (
      <div className="kv">
        <label>{def.label}</label>
        <select value={v} onChange={(e) => { setV(e.target.value); onSave(e.target.value); }}>
          <option value="">-</option>
          {(def.opcoes || []).map((o) => <option key={o} value={o}>{o}</option>)}
        </select>
      </div>
    );
  }
  return (
    <div className="kv">
      <label>{def.label}</label>
      <input
        type={def.tipo === 'number' ? 'number' : def.tipo === 'date' ? 'date' : 'text'}
        value={v}
        onChange={(e) => setV(e.target.value)}
        onBlur={() => v !== (valor ?? '') && onSave(v)}
      />
    </div>
  );
}

export default function Deal() {
  const { id } = useParams();
  const nav = useNavigate();
  const [deal, setDeal] = useState(null);
  const [pipeline, setPipeline] = useState(null);
  const [aba, setAba] = useState('historico');
  const [nota, setNota] = useState('');
  const [novaTarefa, setNovaTarefa] = useState('');
  const [tarefaData, setTarefaData] = useState('');
  const [tarefaHora, setTarefaHora] = useState('');
  const [modalPerda, setModalPerda] = useState(false);
  // Trava de requisição em voo da criação de tarefa (ver criaTarefa). Fica AQUI,
  // antes do return antecipado de Loading: hook depois dele muda a contagem de
  // hooks entre renders e derruba a página inteira (React #310, tela branca).
  const criandoTarefa = useRef(false);

  function recarrega() { return api.deal(id).then(setDeal); }

  useEffect(() => {
    let pipes;
    api.pipelines().then((ps) => { pipes = ps; return api.deal(id); })
      .then((d) => { setDeal(d); setPipeline(pipes.find((p) => p.id === d.pipeline_id)); })
      .catch(() => nav('/kanban'));
  }, [id]);

  if (!deal) return <Loading />;
  const lead = deal.lead;
  const wa = waLink(lead.telefone);

  async function move(stageId) { await api.moveDeal(id, stageId); recarrega(); }
  async function salvaCampo(defId, valor) { await api.patchDeal(id, { fields: { [defId]: valor } }); recarrega(); }
  async function salvaDeal(patch) { await api.patchDeal(id, patch); recarrega(); }
  async function toggleWa() { await api.whatsappDeal(id, !deal.respondendo_whatsapp); recarrega(); }
  async function marcarVenda() { await api.wonDeal(id); recarrega(); }
  async function apagar() {
    if (!window.confirm(`Apagar a negociação "${deal.titulo}"? Ela fica na Lixeira por 30 dias e depois some de vez.`)) return;
    await api.deleteDeal(id);
    nav('/kanban');
  }
  async function confirmaPerda(motivo) {
    await api.lostDeal(id, motivo);
    setModalPerda(false);
    recarrega();
  }
  async function addNota() {
    if (!nota.trim()) return;
    await api.createNote({ deal_id: Number(id), corpo: nota.trim() });
    setNota(''); recarrega();
  }
  async function criaTarefa(titulo, dataISO, horaHHMM) {
    const t = (titulo || '').trim();
    if (!t || criandoTarefa.current) return;
    criandoTarefa.current = true;
    try {
      const due_at = (dataISO || horaHHMM) ? dueAt(dataISO, horaHHMM) : undefined;
      await api.createTask({ deal_id: Number(id), titulo: t, due_at });
      setNovaTarefa(''); setTarefaData(''); setTarefaHora(''); recarrega();
    } finally { criandoTarefa.current = false; }
  }
  async function addTarefa() { await criaTarefa(novaTarefa, tarefaData, tarefaHora); }
  function clicaDia(offset) { setTarefaData(isoData(offset)); }
  function clicaHora(hhmm) {
    setTarefaHora(hhmm);
    if (novaTarefa.trim()) criaTarefa(novaTarefa, tarefaData, hhmm);
  }
  function clicaTitulo(t) {
    setNovaTarefa(t);
    if (tarefaHora) criaTarefa(t, tarefaData, tarefaHora);
  }
  async function concluiTarefa(t) {
    await api.patchTask(t.id, { feito: t.feito ? 0 : 1 }); recarrega();
  }

  return (
    <div className="deal-page">
      {modalPerda && <LostModal onConfirm={confirmaPerda} onCancel={() => setModalPerda(false)} />}
      <StageBar pipeline={pipeline} deal={deal} onMove={move} onPerda={() => setModalPerda(true)} />

      <div className="deal-actions">
        <button className="btn primary" onClick={marcarVenda} disabled={deal.estado === 'vendida'}>Marcar venda</button>
        <button className="btn danger" onClick={() => setModalPerda(true)} disabled={deal.estado === 'perdida'}>Marcar perda</button>
        <label className="chip" style={{ marginLeft: 4 }}>
          <input type="checkbox" checked={!!deal.respondendo_whatsapp} onChange={toggleWa} />
          &nbsp;Respondendo no WhatsApp
        </label>
        {deal.estado === 'vendida' && <span className="badge estado-vendida">Vendida (reservada)</span>}
        {deal.estado === 'perdida' && <span className="badge estado-perdida">Perdida{deal.motivo_perda ? ': ' + deal.motivo_perda : ''}</span>}
        <button className="btn danger sm" style={{ marginLeft: 'auto' }} onClick={apagar} title="Manda para a Lixeira (30 dias para restaurar)">Apagar negociação</button>
      </div>

      <div className="deal-grid">
        {/* painel esquerdo */}
        <div className="panel">
          <div className="kv">
            <label>Título</label>
            <input defaultValue={deal.titulo || ''} onBlur={(e) => e.target.value !== (deal.titulo || '') && salvaDeal({ titulo: e.target.value })} />
            {/* barra de temperatura logo abaixo do nome/título */}
            {deal.qualificacao && <div style={{ marginTop: 8 }}><HeatBar q={deal.qualificacao} /></div>}
          </div>
          <div className="kv">
            <label>Valor (R$)</label>
            <input type="number" defaultValue={deal.valor || ''} onBlur={(e) => Number(e.target.value) !== (deal.valor || 0) && salvaDeal({ valor: Number(e.target.value) })} />
          </div>
          <div className="kv">
            <label>Qualificação</label>
            <select value={deal.qualificacao || ''} onChange={(e) => salvaDeal({ qualificacao: e.target.value })}>
              <option value="">-</option>
              {QUALIF.map((q) => <option key={q} value={q}>{q}</option>)}
            </select>
          </div>

          <h3 className="mt">Campos da negociação</h3>
          {deal.fields.map((f) => (
            <Campo key={f.id} def={f} valor={f.valor} onSave={(v) => salvaCampo(f.id, v)} />
          ))}

          <h3 className="mt">Contato</h3>
          <div className="contato-line"><strong>{lead.nome}</strong></div>
          {lead.telefone && (
            <div className="contato-line">
              📞 <a href={'tel:' + soTelefone(lead.telefone)}>{lead.telefone}</a>
              {wa && <>· <a href={wa} target="_blank" rel="noreferrer">WhatsApp</a></>}
            </div>
          )}
          {lead.email && <div className="contato-line">✉️ <a href={'mailto:' + lead.email}>{lead.email}</a></div>}
          <div className="contato-line"><Link to={'/leads/' + lead.id}>Ver página do lead →</Link></div>

          <OrigemBlock lead={lead} />
        </div>

        {/* painel direito: abas */}
        <div className="panel">
          <div className="tabs">
            <button className={aba === 'historico' ? 'on' : ''} onClick={() => setAba('historico')}>Histórico</button>
            <button className={aba === 'tarefas' ? 'on' : ''} onClick={() => setAba('tarefas')}>Tarefas</button>
            <button className={aba === 'produtos' ? 'on' : ''} onClick={() => setAba('produtos')}>Produtos</button>
          </div>

          {aba === 'historico' && (
            <>
              <div style={{ marginBottom: 16 }}>
                <textarea rows={2} placeholder="Escrever uma anotação..." value={nota} onChange={(e) => setNota(e.target.value)} style={{ width: '100%', padding: 8, border: '1px solid var(--linha)', borderRadius: 6, fontFamily: 'inherit', fontSize: 13 }} />
                <button className="btn ciano sm" style={{ marginTop: 6 }} onClick={addNota}>Adicionar anotação</button>
              </div>
              <Timeline events={deal.events} />
            </>
          )}

          {aba === 'tarefas' && (
            <>
              <div className="quick-btns">
                {TITULOS_RAPIDOS.map((t) => (
                  <button key={t} className={novaTarefa === t ? 'on' : ''} onClick={() => clicaTitulo(t)}>{t}</button>
                ))}
              </div>
              <div style={{ display: 'flex', gap: 8, marginBottom: 10 }}>
                <input placeholder="Ou digite o título da tarefa..." value={novaTarefa} onChange={(e) => setNovaTarefa(e.target.value)} style={{ flex: 1, padding: 8, border: '1px solid var(--linha)', borderRadius: 6, fontFamily: 'inherit', fontSize: 13 }} onKeyDown={(e) => e.key === 'Enter' && addTarefa()} />
                <button className="btn ciano sm" onClick={addTarefa}>Criar</button>
              </div>
              <div className="quick-btns">
                {DIAS_RAPIDOS.map((d) => (
                  <button key={d.l} className={tarefaData === isoData(d.offset) ? 'on' : ''} onClick={() => clicaDia(d.offset)}>{d.l}</button>
                ))}
              </div>
              <div className="quick-btns" style={{ marginBottom: 10 }}>
                {HORAS_RAPIDAS.map((h) => (
                  <button key={h} className={tarefaHora === h ? 'on' : ''} onClick={() => clicaHora(h)}>{h}</button>
                ))}
              </div>
              <div style={{ display: 'flex', gap: 8, marginBottom: 14 }}>
                <input type="date" value={tarefaData} onChange={(e) => setTarefaData(e.target.value)} style={{ padding: 7, border: '1px solid var(--linha)', borderRadius: 6, fontFamily: 'inherit', fontSize: 13 }} />
                <input type="time" value={tarefaHora} onChange={(e) => setTarefaHora(e.target.value)} style={{ padding: 7, border: '1px solid var(--linha)', borderRadius: 6, fontFamily: 'inherit', fontSize: 13 }} />
              </div>
              {(!deal.tasks || !deal.tasks.length) && <p className="muted">Nenhuma tarefa.</p>}
              {deal.tasks && deal.tasks.map((t) => (
                <div key={t.id} className={'task-row' + (t.feito ? ' feito' : '')}>
                  <input type="checkbox" checked={!!t.feito} onChange={() => concluiTarefa(t)} />
                  <span className="task-titulo">{t.titulo}</span>
                  {t.due_at && <span className="muted" style={{ fontSize: 12 }}>{dataHora(t.due_at)}</span>}
                </div>
              ))}
            </>
          )}

          {aba === 'produtos' && <PurchasesList leadId={lead.id} />}
        </div>
      </div>
    </div>
  );
}

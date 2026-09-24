import React, { useEffect, useState, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import { api, brl, waLink, soTelefone, QUALIF, dataCurta } from './api.js';
import { Loading, TaskQuickModal, LostModal, nivelQualif, labelQualif } from './ui.jsx';

const ESTADOS = [
  { v: 'ativas', l: 'Abertas e reservadas' },
  { v: 'andamento', l: 'Em andamento' },
  { v: 'vendida', l: 'Vendida' },
  { v: 'perdida', l: 'Perdida' },
  { v: 'todas', l: 'Todas' },
];
// Ordenacao rapida em 1 clique (pills). Server-side: o backend ordena dentro de
// cada coluna (a coluna pode vir truncada pelo limit, entao a ordem importa).
const ORDENS = [
  { v: 'proxima_festa', l: 'Festa mais próxima' },
  { v: 'temperatura', l: 'Mais quente' },
  { v: 'parado', l: 'Mais parado' },
  { v: 'recente', l: 'Recentes' },
];
const ORDEM_PADRAO = 'proxima_festa';
// ponytail: alerta de "parado" fixo em 7 dias; virar config se o Gui pedir
const ALERTA_PARADO_DIAS = 7;
const TCOR = ['var(--t1)', 'var(--t2)', 'var(--t3)', 'var(--t4)', 'var(--t5)'];

// drag do HTML5 nao serve pra dedo (so mouse) e em touch o draggable=true ainda
// atrapalha (seleciona texto / interfere no scroll do dedo antes do clique).
// Desliga no toque sem mexer no clique, que e outro listener.
const SEM_DRAG_TOQUE = typeof window !== 'undefined' && window.matchMedia && window.matchMedia('(pointer: coarse)').matches;

// Data da festa do card: campo data_festa da negociação.
function festaInfo(deal) { return infoData(deal.data_festa); }
// Pacote sem o preço entre parênteses, para caber no card.
function pacoteCurto(p) { return String(p || '').replace(/\s*\(.*\)$/, ''); }

function infoData(iso) {
  if (!iso) return null;
  const dt = new Date(String(iso).slice(0, 10) + 'T12:00:00');
  if (isNaN(dt)) return null;
  const hoje = new Date(); hoje.setHours(0, 0, 0, 0);
  // floor, não round: dt está ao meio-dia e hoje à meia-noite, então round
  // dava "em 1d" para a festa de hoje e "é hoje!" para a de ontem.
  const dias = Math.floor((dt - hoje) / 864e5);
  // ano abreviado ("/27") so quando nao e o ano corrente
  let fmt = String(dt.getDate()).padStart(2, '0') + '/' + String(dt.getMonth() + 1).padStart(2, '0');
  if (dt.getFullYear() !== hoje.getFullYear()) fmt += '/' + String(dt.getFullYear()).slice(2);
  // Festa que já passou não ganha rótulo de contagem.
  const emTxt = dias < 0 ? '' : dias === 0 ? 'é hoje!' : 'em ' + dias + 'd';
  return { dias, fmt, emTxt, urgente: dias <= 14 };
}

// Chegada do lead no card: hoje só a hora ("14:32"), senão data + hora.
function chegou(iso) {
  if (!iso) return null;
  const d = new Date(iso.replace(' ', 'T') + 'Z');
  if (isNaN(d)) return null;
  const hora = d.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });
  const hoje = new Date().toDateString() === d.toDateString();
  return hoje ? hora : d.toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit' }) + ' ' + hora;
}

// Dias na etapa atual (stage_entered_at e UTC; mover zera no backend).
function diasParado(s) {
  if (!s) return 0;
  const t = new Date(String(s).replace(' ', 'T') + 'Z');
  if (isNaN(t)) return 0;
  return Math.max(0, Math.floor((Date.now() - t) / 864e5));
}

function TempDots({ deal, size }) {
  const nivel = nivelQualif(deal.qualificacao);
  const label = labelQualif(deal.qualificacao);
  return (
    <span className="temp-dots" title={label} style={size ? { gap: 4 } : undefined}>
      {[1, 2, 3, 4, 5].map((i) => (
        <i key={i} style={{ background: i <= nivel ? TCOR[nivel - 1] : 'var(--ln)', width: size, height: size }} />
      ))}
      <span className="temp-lbl" style={nivel >= 4 ? { color: TCOR[nivel - 1] } : undefined}>{label}</span>
    </span>
  );
}

// Card: nome+valor, data da festa (info nº 1), tema+pacote, origem,
// temperatura (5 bolinhas) + tempo parado, telefone no rodapé.
function Card({ deal, onDragStart, onClick }) {
  const tel = soTelefone(deal.lead_telefone);
  const wa = waLink(deal.lead_telefone);
  const [copiado, setCopiado] = useState(false);
  const titulo = deal.titulo || deal.lead_nome || 'Sem título';
  const festa = festaInfo(deal);
  const parado = diasParado(deal.stage_entered_at);
  async function copiarTel(e) {
    e.stopPropagation();
    try { await navigator.clipboard.writeText(tel); setCopiado(true); setTimeout(() => setCopiado(false), 1500); } catch {}
  }
  return (
    <div className="card" draggable={!SEM_DRAG_TOQUE} onDragStart={onDragStart} onClick={onClick}>
      <div className="c-row c-title">
        <span className="titulo" title={titulo}>{titulo}</span>
        {deal.valor > 0 && <span className="valor">{brl(deal.valor)}</span>}
      </div>
      <div className="c-row">
        {festa ? (
          <>
            <span className="ev-chip">Festa {festa.fmt}</span>
            {festa.emTxt && <span className={'ev-em' + (festa.urgente ? ' urgente' : '')}>{festa.emTxt}</span>}
          </>
        ) : <span className="ev-sem">Sem data de festa</span>}
      </div>
      <div className="c-row c-meta">
        {deal.estado === 'perdida' && deal.motivo_perda
          ? <span className="motivo-perda" title={deal.motivo_perda}>{deal.motivo_perda}</span>
          : <span className="c-tema" title={[deal.tema, deal.pacote, deal.entrega, deal.local].filter(Boolean).join(' · ')}>
              {[deal.tema, pacoteCurto(deal.pacote)].filter(Boolean).join(' · ') || 'Sem tema'}
            </span>}
        {deal.lead_origem && <span className="origem-lbl" title={deal.lead_origem}>{deal.lead_origem}</span>}
      </div>

      <div className="c-row">
        <TempDots deal={deal} />
        <span className="par-col">
          {chegou(deal.lead_criado_em) && <span className="chegou-lbl" title={'Lead criado em ' + deal.lead_criado_em + ' UTC'}>{chegou(deal.lead_criado_em)}</span>}
          <span className={'par-chip' + (parado >= ALERTA_PARADO_DIAS ? ' alerta' : '')}>
            {parado + 'd parado'}
          </span>
        </span>
      </div>
      {deal.prox_tarefa_titulo && (
        <div className="c-row">
          <span className={'tarefa-chip' + (deal.tarefa_atrasada ? ' atrasada' : '')} title={deal.prox_tarefa_titulo}>
            {deal.prox_tarefa_titulo}{deal.prox_tarefa ? ' · ' + dataCurta(deal.prox_tarefa) : ''}
          </span>
        </div>
      )}
      <div className="c-row c-tel" onClick={(e) => tel && e.stopPropagation()}>
        {tel ? (
          <>
            <a href={wa} target="_blank" rel="noreferrer">{deal.lead_telefone}</a>
            <button className="tel-copy" title="Copiar número" onClick={copiarTel}>{copiado ? '✓' : '⧉'}</button>
          </>
        ) : <span className="ph">sem telefone</span>}
      </div>
    </div>
  );
}

// Nova negociação à mão (botão "+ Nova negociação" da barra). Escolhe um lead
// existente pela busca ou cria um novo na hora (origem "Cadastro manual", regra
// do backend). Entra no funil aberto, na etapa escolhida (padrão: a primeira).
function NovaDealModal({ pid, stages, onClose, onCreated }) {
  const [q, setQ] = useState('');
  const [achados, setAchados] = useState([]);
  const [lead, setLead] = useState(null);      // lead existente escolhido
  const [novo, setNovo] = useState(false);     // modo "criar lead novo"
  const [nome, setNome] = useState('');
  const [telefone, setTelefone] = useState('');
  const [email, setEmail] = useState('');
  const [titulo, setTitulo] = useState('');
  const [valor, setValor] = useState('');
  const [stageId, setStageId] = useState(stages[0] ? stages[0].id : '');
  const [salvando, setSalvando] = useState(false);
  const [erro, setErro] = useState('');

  useEffect(() => {
    if (lead || novo || q.trim().length < 2) { setAchados([]); return; }
    const t = setTimeout(() => {
      api.leads({ q: q.trim(), limit: 8, offset: 0 }).then((r) => setAchados(Array.isArray(r) ? r : [])).catch(() => setAchados([]));
    }, 250);
    return () => clearTimeout(t);
  }, [q, lead, novo]);

  async function criar() {
    if (salvando) return;
    setErro('');
    let leadId = lead && lead.id;
    let nomeLead = lead && lead.nome;
    if (!leadId && !novo) { setErro('Escolha um lead da busca ou crie um novo.'); return; }
    if (!leadId && !nome.trim()) { setErro('Nome do lead é obrigatório.'); return; }
    if (!stageId) { setErro('Escolha a etapa.'); return; }
    setSalvando(true);
    try {
      if (!leadId) {
        const r = await api.createLead({ nome: nome.trim(), telefone: telefone.trim() || undefined, email: email.trim() || undefined });
        leadId = r.id; nomeLead = nome.trim();
      }
      const r = await api.createDeal({
        lead_id: leadId, pipeline_id: pid, stage_id: Number(stageId),
        titulo: titulo.trim() || nomeLead || undefined,
        valor: Number(String(valor).replace(/\./g, '').replace(',', '.')) || 0,
      });
      onCreated(r.id);
    } catch (e) {
      setErro((e && e.message) || 'não deu para criar');
      setSalvando(false);
    }
  }

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal-card" onClick={(e) => e.stopPropagation()}>
        <h3>Nova negociação</h3>
        {lead ? (
          <div className="kv">
            <label>Lead</label>
            <div><span className="chip">{lead.nome || lead.email || lead.telefone}</span> <button className="btn sm" onClick={() => { setLead(null); setQ(''); }}>trocar</button></div>
          </div>
        ) : novo ? (
          <>
            <div className="kv"><label>Nome do lead</label><input autoFocus value={nome} onChange={(e) => setNome(e.target.value)} placeholder="Nome de quem está comprando" /></div>
            <div className="kv"><label>Telefone</label><input value={telefone} onChange={(e) => setTelefone(e.target.value)} placeholder="(31) 9...." /></div>
            <div className="kv"><label>E-mail</label><input value={email} onChange={(e) => setEmail(e.target.value)} placeholder="opcional" /></div>
            <button className="btn sm" onClick={() => setNovo(false)}>← buscar lead existente</button>
          </>
        ) : (
          <>
            <div className="kv">
              <label>Lead</label>
              <input autoFocus value={q} onChange={(e) => setQ(e.target.value)} placeholder="Buscar por nome, telefone ou e-mail..." />
            </div>
            {achados.length > 0 && (
              <div className="quick-btns">
                {achados.map((l) => (
                  <button key={l.id} onClick={() => { setLead(l); if (!titulo) setTitulo(l.nome || ''); }}>
                    {l.nome || 'sem nome'}{l.telefone ? ' · ' + l.telefone : ''}
                  </button>
                ))}
              </div>
            )}
            {q.trim().length >= 2 && achados.length === 0 && <p className="muted">Nenhum lead com esse texto.</p>}
            <button className="btn sm" onClick={() => { setNovo(true); if (!nome) setNome(q.trim()); }}>+ Criar lead novo</button>
          </>
        )}
        <div className="kv"><label>Título</label><input value={titulo} onChange={(e) => setTitulo(e.target.value)} placeholder="Padrão: nome do lead" /></div>
        <div className="kv"><label>Valor (R$)</label><input inputMode="decimal" value={valor} onChange={(e) => setValor(e.target.value)} placeholder="0" /></div>
        <div className="kv">
          <label>Etapa</label>
          <select className="sel" value={stageId} onChange={(e) => setStageId(e.target.value)}>
            {stages.map((s) => <option key={s.id} value={s.id}>{s.nome}</option>)}
          </select>
        </div>
        {erro && <p className="erro" style={{ margin: '8px 0 0' }}>{erro}</p>}
        <div className="modal-actions">
          <button className="btn" onClick={onClose}>Cancelar</button>
          <button className="btn primary" disabled={salvando} onClick={criar}>{salvando ? 'Criando…' : 'Criar negociação'}</button>
        </div>
      </div>
    </div>
  );
}

// Filtros e ordenacao do Kanban: guardados em sessionStorage (mesma aba) para
// sobreviver a "abrir negociacao e voltar", que desmonta o Kanban. sessionStorage
// e o pid ja usa localStorage por outro motivo (lembrar o funil entre sessoes);
// aqui o pedido e so sobreviver a navegacao dentro da mesma visita, entao
// sessionStorage evita filtro de dias atras reaparecendo sem querer.
const FILTROS_KEY = 'crm_kanban_filtros';
function filtrosSalvos() {
  try { return JSON.parse(sessionStorage.getItem(FILTROS_KEY)) || {}; } catch { return {}; }
}

export default function Kanban({ admin }) {
  const nav = useNavigate();
  const salvos = filtrosSalvos();
  const [pipelines, setPipelines] = useState(null);
  const [pid, setPid] = useState(() => Number(localStorage.getItem('crm_pid')) || 1);
  const [board, setBoard] = useState(null);
  const [estado, setEstado] = useState(salvos.estado ?? 'ativas');
  // ordem salva de antes do redesign pode ser um sort que ja nao existe nas pills
  const [ordem, setOrdem] = useState(ORDENS.some((o) => o.v === salvos.ordem) ? salvos.ordem : ORDEM_PADRAO);
  const [busca, setBusca] = useState(salvos.busca ?? '');
  const [dragId, setDragId] = useState(null);
  const [overStage, setOverStage] = useState(null);
  const [mobStage, setMobStage] = useState(null);
  // filtros extras
  const [origem, setOrigem] = useState(salvos.origem ?? '');
  const [tag, setTag] = useState(salvos.tag ?? '');
  const [temps, setTemps] = useState(salvos.temps ?? []); // multiselect de niveis
  const [dono, setDono] = useState(salvos.dono ?? '');
  // filtro rapido de tarefa: '' | 'sem' | 'com' (tarefa ABERTA, mesmo criterio
  // do chip do card). Migra o checkbox antigo "Sem tarefa" salvo na sessao.
  const [tarefaFiltro, setTarefaFiltro] = useState(salvos.tarefaFiltro ?? (salvos.flags?.semTarefa ? 'sem' : ''));
  const [flags, setFlags] = useState(salvos.flags ?? { wa: false, atrasada: false, cliente: false });
  const [maisFiltros, setMaisFiltros] = useState(false);
  const [filtrosOpen, setFiltrosOpen] = useState(false); // painel de controles no mobile
  // vista Lista: seleção múltipla + ações em lote
  const [vista, setVista] = useState(salvos.vista === 'lista' ? 'lista' : 'quadro');
  const [selIds, setSelIds] = useState(() => new Set());
  const [loteBusy, setLoteBusy] = useState(false);
  const [perdaLote, setPerdaLote] = useState(false);
  const [tarefaLote, setTarefaLote] = useState(false);
  const [novaDeal, setNovaDeal] = useState(false); // modal de nova negociação à mão
  const [tagNome, setTagNome] = useState('');

  useEffect(() => { api.pipelines().then((ps) => { setPipelines(ps); if (!ps.some((p) => p.id === pid)) setPid(ps[0]?.id || 1); }).catch(() => setPipelines([])); }, []);
  useEffect(() => {
    setBoard(null);
    setSelIds(new Set());
    localStorage.setItem('crm_pid', pid);
    api.board(pid, ordem, estado).then((b) => { setBoard(b); setMobStage((s) => s ?? b[0]?.id ?? null); }).catch(() => setBoard([]));
  }, [pid, ordem, estado]);

  useEffect(() => {
    sessionStorage.setItem(FILTROS_KEY, JSON.stringify({ estado, ordem, busca, origem, tag, temps, dono, flags, tarefaFiltro, vista }));
  }, [estado, ordem, busca, origem, tag, temps, dono, flags, tarefaFiltro, vista]);

  // opcoes de filtro derivadas do board carregado
  const { origens, tagsDisp, donos } = useMemo(() => {
    const o = new Set(), tg = new Set(), dn = new Set();
    (board || []).forEach((st) => (st.deals || []).forEach((d) => {
      if (d.lead_origem) o.add(d.lead_origem);
      (d.tags_csv || '').split(',').filter(Boolean).forEach((t) => tg.add(t));
      if (d.dono_nome) dn.add(d.dono_nome);
    }));
    return { origens: [...o].sort(), tagsDisp: [...tg].sort(), donos: [...dn].sort() };
  }, [board]);

  function toggleTemp(q) { setTemps((ts) => ts.includes(q) ? ts.filter((x) => x !== q) : [...ts, q]); }
  const temFiltro = origem || tag || temps.length || dono || tarefaFiltro || flags.wa || flags.atrasada || flags.cliente;
  function limpaFiltros() { setOrigem(''); setTag(''); setTemps([]); setDono(''); setTarefaFiltro(''); setFlags({ wa: false, atrasada: false, cliente: false }); }

  const filtrado = useMemo(() => {
    if (!board) return [];
    const q = busca.trim().toLowerCase();
    return board.map((st) => {
      let ds = st.deals || [];
      if (estado === 'ativas') ds = ds.filter((d) => d.estado !== 'perdida');
      else if (estado !== 'todas') ds = ds.filter((d) => d.estado === estado);
      if (q) ds = ds.filter((d) =>
        (d.titulo || '').toLowerCase().includes(q) ||
        (d.lead_nome || '').toLowerCase().includes(q) ||
        (d.lead_email || '').toLowerCase().includes(q));
      if (origem) ds = ds.filter((d) => d.lead_origem === origem);
      if (tag) ds = ds.filter((d) => (d.tags_csv || '').split(',').includes(tag));
      if (temps.length) ds = ds.filter((d) => temps.includes(d.qualificacao));
      if (dono) ds = ds.filter((d) => d.dono_nome === dono);
      if (flags.wa) ds = ds.filter((d) => d.respondendo_whatsapp);
      if (flags.atrasada) ds = ds.filter((d) => d.tarefa_atrasada);
      if (tarefaFiltro === 'sem') ds = ds.filter((d) => !d.prox_tarefa_titulo);
      if (tarefaFiltro === 'com') ds = ds.filter((d) => d.prox_tarefa_titulo);
      if (flags.cliente) ds = ds.filter((d) => d.cliente);
      const somaCarregada = ds.reduce((s, d) => s + (d.valor || 0), 0);
      // A coluna vem truncada pelo limit do board (etapa com milhares de deals
      // carrega só a primeira página). Sem filtro do lado do cliente, o total
      // certo é o count do servidor; com filtro, só dá pra contar o carregado.
      const filtroCliente = !!(q || origem || tag || temps.length || dono || tarefaFiltro || flags.wa || flags.atrasada || flags.cliente);
      const total = filtroCliente ? ds.length : (st.count ?? ds.length);
      const soma = filtroCliente ? somaCarregada : (st.soma ?? somaCarregada);
      return { ...st, ds, soma, total, truncado: !filtroCliente && total > ds.length };
    });
  }, [board, estado, busca, origem, tag, temps, dono, flags, tarefaFiltro]);

  // vista Lista: linhas achatadas (ordem das etapas + ordenação server-side dentro de cada uma)
  const linhas = useMemo(
    () => vista === 'lista' ? filtrado.flatMap((st) => st.ds.map((d) => ({ ...d, etapa: st.nome }))) : [],
    [vista, filtrado]);
  const selecionadas = useMemo(() => linhas.filter((l) => selIds.has(l.id)), [linhas, selIds]);

  function toggleSel(id) {
    setSelIds((s) => { const n = new Set(s); n.has(id) ? n.delete(id) : n.add(id); return n; });
  }
  function toggleTodos() {
    setSelIds(selecionadas.length === linhas.length ? new Set() : new Set(linhas.map((l) => l.id)));
  }
  // Ações em lote: reusa os endpoints unitários existentes (sem endpoint bulk no
  // backend); o navegador enfileira as chamadas. Recarrega o board no fim.
  async function emLote(itens, fn) {
    if (!itens.length || loteBusy) return;
    setLoteBusy(true);
    const res = await Promise.allSettled(itens.map(fn));
    setLoteBusy(false);
    setSelIds(new Set());
    api.board(pid, ordem, estado).then(setBoard);
    const falhas = res.filter((r) => r.status === 'rejected').length;
    if (falhas) alert(`${falhas} de ${itens.length} ações falharam.`);
  }
  function moverLote(stageId) {
    emLote(selecionadas.filter((d) => d.stage_id !== stageId).map((d) => d.id), (id) => api.moveDeal(id, stageId));
  }
  function tagLote() {
    const nome = tagNome.trim();
    if (!nome) return;
    setTagNome('');
    emLote([...new Set(selecionadas.map((d) => d.lead_id).filter(Boolean))], (leadId) => api.addLeadTag(leadId, nome));
  }
  function funilLote(pipeId) {
    emLote(selecionadas.map((d) => d.id), (id) => api.moveDealFunil(id, pipeId));
  }
  function apagaLote() {
    const n = selecionadas.length;
    if (!window.confirm(`Apagar ${n} negociaç${n > 1 ? 'ões' : 'ão'}? Vão para a Lixeira por 30 dias e depois somem de vez.`)) return;
    emLote(selecionadas.map((d) => d.id), (id) => api.deleteDeal(id));
  }


  // Arrastar para a etapa de perda ("Perdido") pede o motivo antes.
  const [perdaDrag, setPerdaDrag] = useState(null); // { id } aguardando motivo
  // mover otimista (drag & drop e lote usam o mesmo caminho)
  async function move(id, stageId) {
    const alvo = (board || []).find((s) => s.id === stageId);
    if (alvo && alvo.is_lost) { setPerdaDrag({ id }); return; }
    const origem = board.find((s) => s.deals.some((d) => d.id === id));
    if (!origem || origem.id === stageId) return;
    const deal = origem.deals.find((d) => d.id === id);
    const agora = new Date().toISOString().slice(0, 19).replace('T', ' ');
    setBoard((b) => b.map((s) => {
      if (s.id === origem.id) return { ...s, deals: s.deals.filter((d) => d.id !== id) };
      if (s.id === stageId) return { ...s, deals: [{ ...deal, stage_id: stageId, stage_entered_at: agora }, ...s.deals] };
      return s;
    }));
    try { await api.moveDeal(id, stageId); }
    catch { api.board(pid, ordem, estado).then(setBoard); }
  }

  function solta(stageId) {
    setOverStage(null);
    const id = dragId; setDragId(null);
    if (id) move(id, stageId);
  }

  if (!pipelines) return <Loading />;

  // no mobile o painel de controles fica escondido; se algo saiu do padrão, avisa no botão
  const funilPadrao = pipelines[0]?.id;
  const controleAtivo = busca.trim() !== '' || estado !== 'ativas' || ordem !== ORDEM_PADRAO || (funilPadrao != null && pid !== funilPadrao) || temFiltro;

  return (
    <>
      {tarefaLote && (
        <TaskQuickModal
          dealId={selecionadas.map((d) => d.id)}
          onClose={() => setTarefaLote(false)}
          onCreated={() => { setTarefaLote(false); setSelIds(new Set()); api.board(pid, ordem, estado).then(setBoard); }}
        />
      )}
      {perdaLote && (
        <LostModal
          onCancel={() => setPerdaLote(false)}
          onConfirm={async (motivo) => {
            setPerdaLote(false);
            // só quem está em andamento (não desfaz venda por engano na vista "Todas")
            await emLote(selecionadas.filter((d) => d.estado === 'andamento').map((d) => d.id), (id) => api.lostDeal(id, motivo));
          }}
        />
      )}
      {perdaDrag && (
        <LostModal
          onCancel={() => setPerdaDrag(null)}
          onConfirm={async (motivo) => {
            const id = perdaDrag.id;
            setPerdaDrag(null);
            await api.lostDeal(id, motivo);
            api.board(pid, ordem, estado).then(setBoard);
          }}
        />
      )}
      {novaDeal && (
        <NovaDealModal
          pid={pid}
          stages={board || []}
          onClose={() => setNovaDeal(false)}
          onCreated={(id) => { setNovaDeal(false); nav('/deals/' + id); }}
        />
      )}
      <button className="fab-nova" onClick={() => setNovaDeal(true)} disabled={!board} aria-label="Nova negociação" title="Nova negociação">+</button>
      <button className="filtros-btn" onClick={() => setFiltrosOpen((v) => !v)} aria-expanded={filtrosOpen}>
        Filtros{controleAtivo && <span className="filtros-dot" title="Filtros ativos" />}
      </button>
      <div className={'filtros' + (filtrosOpen ? ' aberto' : '')}>
        <select className="sel funil" value={pid} onChange={(e) => setPid(Number(e.target.value))}>
          {pipelines.map((p) => <option key={p.id} value={p.id}>{p.nome}</option>)}
        </select>
        <select className="sel" value={estado} onChange={(e) => setEstado(e.target.value)}>
          {ESTADOS.map((s) => <option key={s.v} value={s.v}>{s.l}</option>)}
        </select>
        <div className="sort-pills">
          <button className={vista === 'quadro' ? 'on' : ''} onClick={() => setVista('quadro')}>Quadro</button>
          <button className={vista === 'lista' ? 'on' : ''} onClick={() => setVista('lista')}>Lista</button>
        </div>
        <button className="btn primary sm" onClick={() => setNovaDeal(true)} disabled={!board}>+ Nova negociação</button>
        <div className="sort-wrap">
          <span className="sort-lbl">Ordenar:</span>
          <div className="sort-pills">
            {ORDENS.map((o) => (
              <button key={o.v} className={ordem === o.v ? 'on' : ''} onClick={() => setOrdem(o.v)}>{o.l}</button>
            ))}
          </div>
        </div>
        <div className="sort-wrap">
          <span className="sort-lbl">Tarefa:</span>
          <div className="sort-pills">
            <button className={tarefaFiltro === 'sem' ? 'on' : ''} onClick={() => setTarefaFiltro((f) => f === 'sem' ? '' : 'sem')}>Sem tarefa</button>
            <button className={tarefaFiltro === 'com' ? 'on' : ''} onClick={() => setTarefaFiltro((f) => f === 'com' ? '' : 'com')}>Com tarefa</button>
          </div>
        </div>
        <input className="busca-inp" placeholder="Buscar negociação ou lead..." value={busca} onChange={(e) => setBusca(e.target.value)} />
        <span className="chip label so-desktop" style={{ cursor: 'pointer' }} onClick={() => setMaisFiltros((v) => !v)}>
          {maisFiltros ? 'Menos filtros ▲' : 'Mais filtros ▼'}
        </span>
      </div>

      {/* filtros extras: só desktop, para não poluir o mobile */}
      {maisFiltros && (
        <div className="filtros filtros-extra so-desktop">
          <span className="chip">
            <select value={origem} onChange={(e) => setOrigem(e.target.value)}>
              <option value="">Todas as origens</option>
              {origens.map((o) => <option key={o} value={o}>{o}</option>)}
            </select>
          </span>
          <span className="chip">
            <select value={dono} onChange={(e) => setDono(e.target.value)}>
              <option value="">Todos os responsáveis</option>
              {donos.map((d) => <option key={d} value={d}>{d}</option>)}
            </select>
          </span>
          {tagsDisp.length > 0 && (
            <span className="chip">
              <select value={tag} onChange={(e) => setTag(e.target.value)}>
                <option value="">Todas as tags</option>
                {tagsDisp.map((t) => <option key={t} value={t}>{t}</option>)}
              </select>
            </span>
          )}
          <span className="temp-chips">
            {QUALIF.map((qv) => (
              <span key={qv} className={'chip temp' + (temps.includes(qv) ? ' on' : '')} onClick={() => toggleTemp(qv)}>{qv}</span>
            ))}
          </span>
          <label className="chip"><input type="checkbox" checked={flags.wa} onChange={(e) => setFlags((f) => ({ ...f, wa: e.target.checked }))} />&nbsp;WhatsApp</label>
          <label className="chip"><input type="checkbox" checked={flags.atrasada} onChange={(e) => setFlags((f) => ({ ...f, atrasada: e.target.checked }))} />&nbsp;Tarefa atrasada</label>
          <label className="chip"><input type="checkbox" checked={flags.cliente} onChange={(e) => setFlags((f) => ({ ...f, cliente: e.target.checked }))} />&nbsp;Cliente</label>
          {temFiltro ? <span className="chip label" style={{ cursor: 'pointer' }} onClick={limpaFiltros}>Limpar filtros ✕</span> : null}
        </div>
      )}

      {board && vista === 'quadro' && (
        <div className="mob-stage">
          <select value={mobStage ?? ''} onChange={(e) => setMobStage(Number(e.target.value))}>
            {filtrado.map((s) => <option key={s.id} value={s.id}>{s.nome} ({s.total})</option>)}
          </select>
        </div>
      )}

      {board && vista === 'lista' && (
        <>
          <div className="lista-wrap">
            <table className="lista">
              <thead>
                <tr>
                  <th><input type="checkbox" checked={linhas.length > 0 && selecionadas.length === linhas.length} onChange={toggleTodos} title="Selecionar tudo" /></th>
                  <th>Negociação</th><th>Etapa</th><th>Festa</th><th>Tema</th><th>Pacote</th><th>Temperatura</th><th>Parado</th><th>Tarefa</th><th>Telefone</th><th>Valor</th><th>Origem</th>
                </tr>
              </thead>
              <tbody>
                {linhas.map((d) => {
                  const festa = festaInfo(d);
                  const parado = diasParado(d.stage_entered_at);
                  return (
                    <tr key={d.id} className={selIds.has(d.id) ? 'sel' : ''} onClick={() => nav('/deals/' + d.id)}>
                      <td onClick={(e) => e.stopPropagation()}>
                        <input type="checkbox" checked={selIds.has(d.id)} onChange={() => toggleSel(d.id)} />
                      </td>
                      <td className="tit" title={d.titulo || d.lead_nome}>{d.titulo || d.lead_nome || 'Sem título'}</td>
                      <td>{d.etapa}</td>
                      <td>{festa ? <span className={festa.urgente && festa.dias >= 0 ? 'lista-urgente' : ''}>{festa.fmt}{festa.emTxt ? ' · ' + festa.emTxt : ''}</span> : <span className="ev-sem">-</span>}</td>
                      <td className="lista-corta" title={d.tema || ''}>{d.tema || '-'}</td>
                      <td className="lista-corta" title={d.pacote || ''}>{pacoteCurto(d.pacote) || '-'}</td>
                      <td><TempDots deal={d} /></td>
                      <td><span className={'par-chip' + (parado >= ALERTA_PARADO_DIAS ? ' alerta' : '')}>{parado + 'd'}</span></td>
                      <td className="lista-corta" title={d.prox_tarefa_titulo || ''}>{d.prox_tarefa_titulo || '-'}</td>
                      <td onClick={(e) => e.stopPropagation()}>
                        {soTelefone(d.lead_telefone)
                          ? <a href={waLink(d.lead_telefone)} target="_blank" rel="noreferrer">{d.lead_telefone}</a>
                          : '-'}
                      </td>
                      <td>{d.valor > 0 ? brl(d.valor) : '-'}</td>
                      <td className="lista-corta" title={d.lead_origem || ''}>{d.lead_origem || '-'}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
            {linhas.length === 0 && <div className="col-vazia">Nenhuma negociação</div>}
          </div>
          {selecionadas.length > 0 && (
            <div className="lote-bar">
              <strong>{selecionadas.length} selecionada{selecionadas.length > 1 ? 's' : ''}</strong>
              <select value="" disabled={loteBusy} onChange={(e) => e.target.value && moverLote(Number(e.target.value))}>
                <option value="">Mover para etapa...</option>
                {board.map((s) => <option key={s.id} value={s.id}>{s.nome}</option>)}
              </select>
              <select value="" disabled={loteBusy} onChange={(e) => e.target.value && funilLote(Number(e.target.value))}>
                <option value="">Mudar de funil...</option>
                {pipelines.filter((p) => p.id !== pid).map((p) => <option key={p.id} value={p.id}>{p.nome}</option>)}
              </select>
              <input list="tags-lote" placeholder="Aplicar tag..." value={tagNome} disabled={loteBusy}
                onChange={(e) => setTagNome(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && tagLote()} />
              <datalist id="tags-lote">{tagsDisp.map((t) => <option key={t} value={t} />)}</datalist>
              <button className="btn sm" disabled={!tagNome.trim() || loteBusy} onClick={tagLote}>Aplicar tag</button>
              <button className="btn sm" disabled={loteBusy} onClick={() => setTarefaLote(true)}>+ Tarefa</button>
              <button className="btn danger sm" disabled={loteBusy || !selecionadas.some((d) => d.estado === 'andamento')} onClick={() => setPerdaLote(true)}>Marcar perdida</button>
              {admin && <button className="btn danger sm" disabled={loteBusy} onClick={apagaLote}>Apagar</button>}
              <button className="btn sm" disabled={loteBusy} onClick={() => setSelIds(new Set())}>Limpar</button>
              {loteBusy && <span className="muted">Executando...</span>}
            </div>
          )}
        </>
      )}

      {!board ? <Loading /> : vista === 'lista' ? null : (
        <div className="board">
          {filtrado.map((st) => (
            <div
              key={st.id}
              className={'col' + (overStage === st.id ? ' dragover' : '') + (mobStage != null && mobStage !== st.id ? ' hide-mob' : '')}
              onDragOver={(e) => { e.preventDefault(); setOverStage(st.id); }}
              onDragLeave={() => setOverStage((s) => (s === st.id ? null : s))}
              onDrop={() => solta(st.id)}
            >
              <div className="col-head">
                <div className="nome">{st.nome}</div>
                <div className="meta" title={st.truncado ? `Mostrando ${st.ds.length} de ${st.total}` : undefined}>
                  {st.total} {st.total === 1 ? 'negociação' : 'negociações'}{st.truncado ? ` (${st.ds.length} na tela)` : ''} · {brl(st.soma)}
                </div>
              </div>
              <div className="col-body">
                {st.ds.map((d) => (
                  <Card
                    key={d.id}
                    deal={d}
                    onDragStart={() => setDragId(d.id)}
                    onClick={() => nav('/deals/' + d.id)}
                  />
                ))}
                {st.ds.length === 0 && <div className="col-vazia">Nenhuma negociação</div>}
              </div>
            </div>
          ))}
        </div>
      )}
    </>
  );
}

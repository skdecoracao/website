import React, { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { api, dataCurta } from './api.js';
import { Loading } from './ui.jsx';

// Aba Tarefas: tudo que está aberto no CRM numa tabela só, com filtros. O
// backend (/api/tasks/lista) já aplica o gate de funil restrito, então o
// operador não vê tarefa de funil que ele não pode abrir.
const STATUS = [
  { v: 'abertas', l: 'Abertas' },
  { v: 'atrasadas', l: 'Atrasadas' },
  { v: 'hoje', l: 'Para hoje' },
  { v: 'semana', l: 'Próximos 7 dias' },
  { v: 'sem_prazo', l: 'Sem prazo' },
  { v: 'feitas', l: 'Concluídas' },
  { v: 'todas', l: 'Todas' },
];
// data de hoje no fuso do navegador, no formato do input type=date
function hojeISO() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}
const ORDENS = [
  { v: 'prazo', l: 'Prazo mais próximo' },
  { v: 'prazo_desc', l: 'Prazo mais distante' },
  { v: 'criada', l: 'Criada por último' },
];

// A API moderna (navigator.clipboard) é a primeira escolha, mas ela falha em
// situações banais do dia a dia: aba sem foco no momento do clique, permissão
// negada, página aberta fora de contexto seguro. Nesses casos o caminho velho
// (textarea + execCommand) ainda copia, e é o que evita um botão que só pisca
// vermelho. Devolve true quando o número foi mesmo para a área de transferência.
async function escreveNaAreaDeTransferencia(texto) {
  try {
    await navigator.clipboard.writeText(texto);
    return true;
  } catch { /* cai no caminho velho */ }
  try {
    const ta = document.createElement('textarea');
    ta.value = texto;
    ta.setAttribute('readonly', '');
    ta.style.cssText = 'position:fixed;top:0;left:0;opacity:0';
    document.body.appendChild(ta);
    ta.select();
    const ok = document.execCommand('copy');
    ta.remove();
    return ok;
  } catch { return false; }
}

// Telefone do lead com um clique para copiar, direto na lista: quem trabalha a
// fila de tarefas liga/manda mensagem sem abrir a negociação só para pegar o
// número. Sem clipboard disponível (navegador antigo, contexto não seguro) o
// botão marca 'erro' e o número segue selecionável na tela.
function TelefoneCopiavel({ tel }) {
  const [estado, setEstado] = useState('');
  if (!tel) return null;
  async function copia() {
    setEstado(await escreveNaAreaDeTransferencia(tel) ? 'ok' : 'erro');
    setTimeout(() => setEstado(''), 1600);
  }
  return (
    <button type="button" className={'copia-tel' + (estado ? ' is-' + estado : '')} onClick={copia}
      title={estado === 'erro' ? 'Não deu para copiar' : 'Copiar ' + tel}>
      <span>{tel}</span>
      <span className="copia-tel__ico" aria-hidden="true">{estado === 'ok' ? '✓' : estado === 'erro' ? '✕' : '⧉'}</span>
      <span className="sr-only">{estado === 'ok' ? 'Telefone copiado' : 'Copiar telefone'}</span>
    </button>
  );
}

export default function Tarefas() {
  const nav = useNavigate();
  const [tarefas, setTarefas] = useState(null);
  const [pipes, setPipes] = useState([]);
  const [status, setStatus] = useState('abertas');
  const [funil, setFunil] = useState('');
  const [responsavel, setResponsavel] = useState('');
  const [busca, setBusca] = useState('');
  const [sort, setSort] = useState('prazo');
  // período pelo prazo: "Hoje" preenche de=até=hoje; os dois campos aceitam qualquer intervalo
  const [de, setDe] = useState('');
  const [ate, setAte] = useState('');
  const hoje = hojeISO();
  const ehHoje = de === hoje && ate === hoje;

  useEffect(() => { api.pipelines().then(setPipes).catch(() => setPipes([])); }, []);

  function carrega() {
    setTarefas(null);
    api.tasksLista({ status, funil, responsavel, busca: busca.trim(), sort, de, ate })
      .then(setTarefas).catch(() => setTarefas([]));
  }
  // busca digitada espera 300ms para não disparar uma consulta por tecla
  useEffect(() => { const t = setTimeout(carrega, busca ? 300 : 0); return () => clearTimeout(t); },
    [status, funil, responsavel, busca, sort, de, ate]);

  // responsáveis saem das próprias tarefas (não há endpoint de usuários para operador)
  const responsaveis = useMemo(() => [...new Set((tarefas || []).map((t) => t.criador).filter(Boolean))].sort(), [tarefas]);

  async function alterna(t) {
    setTarefas((ts) => ts.map((x) => (x.id === t.id ? { ...x, feito: t.feito ? 0 : 1 } : x)));
    try { await api.patchTask(t.id, { feito: !t.feito }); } catch { carrega(); }
  }

  const abertas = (tarefas || []).filter((t) => !t.feito).length;
  const atrasadas = (tarefas || []).filter((t) => t.atrasada).length;

  return (
    <>
      <div className="filtros">
        <span className="chip label">Status</span>
        <span className="chip">
          <select value={status} onChange={(e) => setStatus(e.target.value)}>
            {STATUS.map((s) => <option key={s.v} value={s.v}>{s.l}</option>)}
          </select>
        </span>
        <span className="chip">
          <select value={funil} onChange={(e) => setFunil(e.target.value)}>
            <option value="">Todos os funis</option>
            {pipes.map((p) => <option key={p.id} value={p.id}>{p.nome}</option>)}
          </select>
        </span>
        <span className="chip">
          <select value={responsavel} onChange={(e) => setResponsavel(e.target.value)}>
            <option value="">Todos</option>
            {responsaveis.map((r) => <option key={r} value={r}>{r}</option>)}
          </select>
        </span>
        <span className="chip">
          <select value={sort} onChange={(e) => setSort(e.target.value)}>
            {ORDENS.map((o) => <option key={o.v} value={o.v}>{o.l}</option>)}
          </select>
        </span>
        <button type="button" className={'chip chip-btn' + (ehHoje ? ' on' : '')}
          onClick={() => { setDe(ehHoje ? '' : hoje); setAte(ehHoje ? '' : hoje); }}>Hoje</button>
        <span className="chip periodo">
          <input type="date" value={de} max={ate || undefined} onChange={(e) => setDe(e.target.value)} title="Prazo a partir de" />
          <span className="muted">até</span>
          <input type="date" value={ate} min={de || undefined} onChange={(e) => setAte(e.target.value)} title="Prazo até" />
          {(de || ate) && <button type="button" className="limpa" onClick={() => { setDe(''); setAte(''); }} title="Limpar período">✕</button>}
        </span>
        <span className="chip busca">
          <input placeholder="Buscar tarefa, lead ou negociação..." value={busca} onChange={(e) => setBusca(e.target.value)} />
        </span>
      </div>

      <div className="page">
        <h2>Tarefas</h2>
        {tarefas && (
          <p className="muted resumo-tarefas">
            {tarefas.length} na lista · {abertas} abertas
            {atrasadas > 0 && <> · <strong className="txt-atrasada">{atrasadas} atrasadas</strong></>}
            {tarefas.length === 500 && <> · mostrando as 500 primeiras</>}
          </p>
        )}
        {!tarefas ? <Loading /> : !tarefas.length ? (
          <p className="muted">Nenhuma tarefa com esses filtros.</p>
        ) : (
          <table className="tab tab-tarefas">
            <thead>
              <tr>
                <th></th><th>Tarefa</th><th>Prazo</th><th>Lead</th><th>Negociação</th><th>Funil / etapa</th><th>Criada por</th>
              </tr>
            </thead>
            <tbody>
              {tarefas.map((t) => (
                <tr key={t.id} className={t.feito ? 'feita' : t.atrasada ? 'atrasada' : ''}>
                  <td>
                    <input type="checkbox" checked={!!t.feito} onChange={() => alterna(t)} title={t.feito ? 'Reabrir' : 'Concluir'} />
                  </td>
                  <td>
                    <div className="t-titulo">{t.titulo}</div>
                    {t.descricao && <div className="muted t-desc">{t.descricao}</div>}
                  </td>
                  <td className="nowrap">
                    {t.due_at ? <span className={t.atrasada ? 'txt-atrasada' : ''}>{dataCurta(t.due_at)}</span> : <span className="muted">-</span>}
                  </td>
                  <td>
                    {t.lead_id || t.deal_id ? (t.lead_nome || <span className="muted">-</span>) : <span className="muted">-</span>}
                    <TelefoneCopiavel tel={t.lead_telefone} />
                  </td>
                  <td>
                    {t.deal_id
                      ? <a href={'#'} onClick={(e) => { e.preventDefault(); nav('/deals/' + t.deal_id); }}>{t.deal_titulo || t.lead_nome || 'Negociação'}</a>
                      : <span className="muted">-</span>}
                  </td>
                  <td className="muted">{t.funil ? `${t.funil} · ${t.etapa}` : '-'}</td>
                  <td className="muted">{t.criador || '-'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </>
  );
}

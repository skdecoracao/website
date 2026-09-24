import React, { useEffect, useMemo, useState } from 'react';
import { useNavigate, Link } from 'react-router-dom';
import { api, brl } from './api.js';
import { Loading } from './ui.jsx';

// Agenda de festas: negociações pela Data da festa. A data da festa é uma data
// pura (AAAA-MM-DD), então todo cálculo aqui é com a data local do navegador,
// sem passar por UTC (toISOString mudaria o dia à noite).

const MESES = ['janeiro', 'fevereiro', 'março', 'abril', 'maio', 'junho', 'julho', 'agosto', 'setembro', 'outubro', 'novembro', 'dezembro'];
const SEMANA = ['Dom', 'Seg', 'Ter', 'Qua', 'Qui', 'Sex', 'Sáb'];
const SEMANA_LONGA = ['domingo', 'segunda-feira', 'terça-feira', 'quarta-feira', 'quinta-feira', 'sexta-feira', 'sábado'];
const ROTULO = { fechada: 'Fechada', realizada: 'Realizada', quase: 'Quase', aberta: 'Aberta' };
const MAX_DIA = 3; // cartões por dia antes do "+N"
const CELULAR = 720;

const pad = (n) => String(n).padStart(2, '0');
const iso = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const deIso = (s) => { const [a, m, d] = s.split('-').map(Number); return new Date(a, m - 1, d); };
const porExtenso = (s) => { const d = deIso(s); return `${SEMANA_LONGA[d.getDay()]}, ${d.getDate()} de ${MESES[d.getMonth()]} de ${d.getFullYear()}`; };
const pacoteCurto = (p) => String(p || '').replace(/\s*\(.*\)$/, '');

function lerLocal(chave, padrao) {
  try { const v = localStorage.getItem(chave); return v == null ? padrao : v; } catch { return padrao; }
}
function gravarLocal(chave, v) { try { localStorage.setItem(chave, v); } catch { /* sem armazenamento */ } }

function Festa({ f, compacta, onAbrir }) {
  const nome = f.lead_nome || f.titulo || 'Sem nome';
  return (
    <button className={'cal-festa cal-' + f.tipo} onClick={() => onAbrir(f.id)} title={`${ROTULO[f.tipo]}: ${f.tema || 'sem tema'} · ${nome}${f.pacote ? ' · ' + f.pacote : ''}`}>
      <span className="cal-rot">{ROTULO[f.tipo]}</span>
      <span className="cal-tema">{f.tema || 'Sem tema'}</span>
      <span className="cal-cli">{nome}{!compacta && f.pacote ? ' · ' + pacoteCurto(f.pacote) : ''}</span>
    </button>
  );
}

export default function Calendario() {
  const nav = useNavigate();
  const hojeIso = iso(new Date());
  const [pipes, setPipes] = useState(null);
  const [pid, setPid] = useState(() => Number(lerLocal('crm_cal_pid', 0)) || null);
  const [mes, setMes] = useState(() => { const d = new Date(); return new Date(d.getFullYear(), d.getMonth(), 1); });
  const [vista, setVista] = useState(() => lerLocal('crm_cal_vista', window.innerWidth < CELULAR ? 'lista' : 'mes'));
  const [etapasAtivas, setEtapasAtivas] = useState(null); // null = padrão do servidor
  const [dados, setDados] = useState(null);
  const [erro, setErro] = useState('');
  const [expandido, setExpandido] = useState(null); // dia com "+N" aberto

  useEffect(() => { api.pipelines().then((ps) => { setPipes(ps); setPid((atual) => (ps.some((p) => p.id === atual) ? atual : (ps.find((p) => p.nome === 'Vendas') || ps[0] || {}).id)); }).catch(() => setPipes([])); }, []);

  // Grade do mês: começa no domingo da semana do dia 1 e vai até o sábado da última semana.
  const grade = useMemo(() => {
    const ini = new Date(mes.getFullYear(), mes.getMonth(), 1 - mes.getDay());
    const ultimo = new Date(mes.getFullYear(), mes.getMonth() + 1, 0);
    const fim = new Date(ultimo.getFullYear(), ultimo.getMonth(), ultimo.getDate() + (6 - ultimo.getDay()));
    const dias = [];
    for (let d = new Date(ini); d <= fim; d = new Date(d.getFullYear(), d.getMonth(), d.getDate() + 1)) dias.push(iso(d));
    return { inicio: iso(ini), fim: iso(fim), dias, mesIni: iso(mes), mesFim: iso(ultimo) };
  }, [mes]);

  useEffect(() => {
    if (!pid) return;
    setDados(null); setErro(''); setExpandido(null);
    const params = { inicio: grade.inicio, fim: grade.fim, funil: pid };
    if (etapasAtivas) params.etapas = etapasAtivas.join(',');
    api.calendario(params).then(setDados).catch((e) => setErro(e.message || 'Não foi possível carregar o calendário.'));
  }, [pid, grade, etapasAtivas]);

  function trocaFunil(id) { setPid(id); setEtapasAtivas(null); gravarLocal('crm_cal_pid', id); }
  function trocaVista(v) { setVista(v); gravarLocal('crm_cal_vista', v); }
  function mudaMes(delta) { setMes((m) => new Date(m.getFullYear(), m.getMonth() + delta, 1)); }
  function irHoje() { const d = new Date(); setMes(new Date(d.getFullYear(), d.getMonth(), 1)); }
  function alternaEtapa(id) {
    const atuais = dados.etapas_ativas;
    setEtapasAtivas(atuais.includes(id) ? atuais.filter((x) => x !== id) : [...atuais, id]);
  }
  const abrir = (id) => nav('/deals/' + id);

  const porDia = useMemo(() => {
    const m = {};
    for (const f of (dados && dados.festas) || []) (m[f.data_festa] ||= []).push(f);
    return m;
  }, [dados]);

  // Resumo do mês (só os dias do mês, não os da grade vizinha).
  const resumo = useMemo(() => {
    const doMes = ((dados && dados.festas) || []).filter((f) => f.data_festa >= grade.mesIni && f.data_festa <= grade.mesFim);
    const fechadas = doMes.filter((f) => f.tipo === 'fechada' || f.tipo === 'realizada');
    return { fechadas: fechadas.length, quase: doMes.filter((f) => f.tipo === 'quase').length, valor: fechadas.reduce((s, f) => s + (Number(f.valor) || 0), 0) };
  }, [dados, grade]);

  if (!pipes) return <Loading />;
  const tituloMes = `${MESES[mes.getMonth()][0].toUpperCase() + MESES[mes.getMonth()].slice(1)} de ${mes.getFullYear()}`;
  // Lista: no mês corrente, só de hoje em diante (próximas festas); nos outros, o mês inteiro.
  const inicioLista = grade.mesIni <= hojeIso && hojeIso <= grade.mesFim ? hojeIso : grade.mesIni;
  const diasLista = Object.keys(porDia).filter((d) => d >= inicioLista && d <= grade.mesFim).sort();

  return (
    <div className="page cal">
      <div className="cal-topo">
        <h2>Calendário de festas</h2>
        <div className="cal-nav">
          <button className="btn sm" onClick={() => mudaMes(-1)} aria-label="Mês anterior">‹</button>
          <strong className="cal-mes">{tituloMes}</strong>
          <button className="btn sm" onClick={() => mudaMes(1)} aria-label="Próximo mês">›</button>
          <button className="btn sm" onClick={irHoje}>Hoje</button>
        </div>
        <div className="cal-ctrl">
          {pipes.length > 1 && (
            <select className="sel" value={pid || ''} onChange={(e) => trocaFunil(Number(e.target.value))}>
              {pipes.map((p) => <option key={p.id} value={p.id}>{p.nome}</option>)}
            </select>
          )}
          <div className="sort-pills">
            <button className={vista === 'mes' ? 'on' : ''} onClick={() => trocaVista('mes')}>Mês</button>
            <button className={vista === 'lista' ? 'on' : ''} onClick={() => trocaVista('lista')}>Lista</button>
          </div>
        </div>
      </div>

      {dados && (
        <div className="cal-filtros">
          <span className="cal-lbl">Etapas:</span>
          {dados.etapas.map((s) => (
            <label key={s.id} className={'chip cal-etapa' + (dados.etapas_ativas.includes(s.id) ? ' on' : '')}>
              <input type="checkbox" checked={dados.etapas_ativas.includes(s.id)} onChange={() => alternaEtapa(s.id)} /> {s.nome}
            </label>
          ))}
        </div>
      )}

      <div className="cal-legenda" aria-label="Legenda das cores">
        <span><i className="cal-cor cal-fechada" /> Fechada: sinal pago</span>
        <span><i className="cal-cor cal-realizada" /> Realizada: festa já feita</span>
        <span><i className="cal-cor cal-quase" /> Quase: negociando</span>
        <span><i className="cal-cor cal-aberta" /> Aberta: etapas anteriores</span>
      </div>

      {dados && (
        <div className="cal-resumo">
          <div><b>{resumo.fechadas}</b> {resumo.fechadas === 1 ? 'festa fechada' : 'festas fechadas'}</div>
          <div><b>{resumo.quase}</b> quase fechando</div>
          <div><b>{brl(resumo.valor)}</b> em festas fechadas</div>
        </div>
      )}

      {erro && <p className="erro">{erro}</p>}
      {!dados && !erro && <Loading />}

      {dados && vista === 'mes' && (
        <div className="cal-grade" role="grid">
          {SEMANA.map((d) => <div key={d} className="cal-sem" role="columnheader">{d}</div>)}
          {grade.dias.map((dia) => {
            const fs = porDia[dia] || [];
            const aberto = expandido === dia;
            const mostra = aberto ? fs : fs.slice(0, MAX_DIA);
            const fora = dia < grade.mesIni || dia > grade.mesFim;
            return (
              <div key={dia} role="gridcell" className={'cal-dia' + (fora ? ' fora' : '') + (dia === hojeIso ? ' hoje' : '')}>
                <div className="cal-num">{Number(dia.slice(8))}{dia === hojeIso && <span className="cal-hoje-lbl">hoje</span>}</div>
                {mostra.map((f) => <Festa key={f.id} f={f} compacta={fs.length > 1} onAbrir={abrir} />)}
                {fs.length > MAX_DIA && (
                  <button className="cal-mais" onClick={() => setExpandido(aberto ? null : dia)}>
                    {aberto ? 'mostrar menos' : `+${fs.length - MAX_DIA}`}
                  </button>
                )}
              </div>
            );
          })}
        </div>
      )}

      {dados && vista === 'lista' && (
        <div className="cal-lista">
          {!diasLista.length && <p className="muted">Nenhuma festa {inicioLista === hojeIso ? 'daqui até o fim do mês' : 'neste mês'} com as etapas escolhidas.</p>}
          {diasLista.map((dia) => (
            <section key={dia} className="cal-lista-dia">
              <h3>{porExtenso(dia)}{dia === hojeIso ? ' (hoje)' : ''}</h3>
              {porDia[dia].map((f) => (
                <button key={f.id} className={'cal-item cal-' + f.tipo} onClick={() => abrir(f.id)}>
                  <span className="cal-rot">{ROTULO[f.tipo]}</span>
                  <span className="cal-item-corpo">
                    <span className="cal-item-l1"><b>{f.tema || 'Sem tema'}</b> · {f.lead_nome || f.titulo || 'Sem nome'}</span>
                    <span className="cal-item-l2">{[pacoteCurto(f.pacote), f.entrega, f.local].filter(Boolean).join(' · ') || 'Pacote, entrega e bairro a definir'}</span>
                  </span>
                  <span className="cal-item-valor">{Number(f.valor) > 0 ? brl(f.valor) : '-'}</span>
                </button>
              ))}
            </section>
          ))}
        </div>
      )}

      {dados && dados.sem_data.length > 0 && (
        <div className="panel cal-semdata">
          <h3>Sem data da festa ({dados.sem_data.length})</h3>
          <p className="muted">Negociações quase fechando ou fechadas que ainda não têm a Data da festa. Abra e preencha.</p>
          <ul>
            {dados.sem_data.map((f) => (
              <li key={f.id}>
                <span className={'cal-rot cal-' + f.tipo}>{ROTULO[f.tipo]}</span>{' '}
                <Link to={'/deals/' + f.id}>{f.lead_nome || f.titulo || 'Sem nome'}</Link>
                <span className="muted"> · {f.etapa}{f.tema ? ' · ' + f.tema : ''}</span>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}

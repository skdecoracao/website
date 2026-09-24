import React, { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { api, dataCurta } from './api.js';
import { Loading } from './ui.jsx';

const LIMIT = 50;
const ORDENS = [
  { v: 'recente', l: 'Atividade mais recente' },
  { v: 'criado', l: 'Criação mais recente' },
  { v: 'nome', l: 'Nome (A a Z)' },
];

// Base de leads: filtros em lista suspensa (pedido do Gui, 10/09/2026; antes as
// tags eram uma nuvem de botões) e tabela com tags, criação e negociação aberta.
export default function Leads() {
  const nav = useNavigate();
  const [dados, setDados] = useState(null); // { itens, total }
  const [tags, setTags] = useState([]);
  const [origens, setOrigens] = useState([]);
  const [q, setQ] = useState('');
  const [tag, setTag] = useState('');
  const [origem, setOrigem] = useState('');
  const [negociacao, setNegociacao] = useState('');
  const [sort, setSort] = useState('recente');
  const [pag, setPag] = useState(0);

  useEffect(() => {
    api.tags().then(setTags).catch(() => {});
    api.leadOrigens().then(setOrigens).catch(() => {});
  }, []);
  useEffect(() => {
    setDados(null);
    const t = setTimeout(() => {
      api.leads({ q, tag, origem, negociacao, sort, limit: LIMIT, offset: pag * LIMIT, total: 1 })
        .then((r) => setDados(Array.isArray(r) ? { itens: r, total: r.length } : r))
        .catch(() => setDados({ itens: [], total: 0 }));
    }, q ? 300 : 0);
    return () => clearTimeout(t);
  }, [q, tag, origem, negociacao, sort, pag]);

  const muda = (setter) => (e) => { setPag(0); setter(e.target.value); };
  const temFiltro = q || tag || origem || negociacao;
  function limpa() { setQ(''); setTag(''); setOrigem(''); setNegociacao(''); setSort('recente'); setPag(0); }
  const leads = dados ? dados.itens : null;
  const total = dados ? dados.total : 0;
  const ini = pag * LIMIT + 1;
  const fim = Math.min(total, (pag + 1) * LIMIT);
  const paginas = Math.max(1, Math.ceil(total / LIMIT));

  return (
    <div className="page">
      <h2>Base de leads</h2>
      <div className="lista-filtros">
        <label className="lf">
          <span>Buscar</span>
          <input placeholder="Nome, e-mail ou telefone" value={q} onChange={muda(setQ)} />
        </label>
        <label className="lf">
          <span>Tag</span>
          <select value={tag} onChange={muda(setTag)}>
            <option value="">Todas</option>
            {tags.map((t) => <option key={t.id} value={t.nome}>{t.nome}</option>)}
          </select>
        </label>
        <label className="lf">
          <span>Origem</span>
          <select value={origem} onChange={muda(setOrigem)}>
            <option value="">Todas</option>
            {origens.map((o) => <option key={o} value={o}>{o}</option>)}
          </select>
        </label>
        <label className="lf">
          <span>Negociação</span>
          <select value={negociacao} onChange={muda(setNegociacao)}>
            <option value="">Todas</option>
            <option value="com">Com negociação aberta</option>
            <option value="sem">Sem negociação aberta</option>
          </select>
        </label>
        <label className="lf">
          <span>Ordenar por</span>
          <select value={sort} onChange={muda(setSort)}>
            {ORDENS.map((o) => <option key={o.v} value={o.v}>{o.l}</option>)}
          </select>
        </label>
        {temFiltro && <button className="btn sm lf-limpar" onClick={limpa}>Limpar filtros</button>}
      </div>

      {!leads ? <Loading /> : (
        <>
          <div className="lista-resumo muted">
            {total ? `Mostrando ${ini} a ${fim} de ${total.toLocaleString('pt-BR')} leads` : 'Nenhum lead'}{temFiltro ? ' com esses filtros' : ''}.
          </div>
          <div className="tab-scroll">
            <table className="tab tab-leads">
              <thead>
                <tr>
                  <th className={'ord' + (sort === 'nome' ? ' on' : '')} onClick={() => { setPag(0); setSort('nome'); }} title="Ordenar por nome">Nome</th>
                  <th>E-mail</th>
                  <th>Telefone</th>
                  <th>Origem</th>
                  <th>Tags</th>
                  <th>Negociação</th>
                  <th className={'ord' + (sort === 'criado' ? ' on' : '')} onClick={() => { setPag(0); setSort('criado'); }} title="Ordenar por criação">Criado em</th>
                </tr>
              </thead>
              <tbody>
                {leads.map((l) => (
                  <tr key={l.id} onClick={() => nav('/leads/' + l.id)}>
                    <td className="td-nome">{l.nome || <span className="muted">sem nome</span>}</td>
                    <td>{l.email}</td>
                    <td className="td-tel">{l.telefone}</td>
                    <td>{l.origem}</td>
                    <td className="td-tags" title={l.tags_csv || ''}>
                      {(l.tags_csv || '').split(', ').filter(Boolean).slice(0, 3).map((t) => <span key={t} className="tag">{t}</span>)}
                      {(l.tags_csv || '').split(', ').filter(Boolean).length > 3 && <span className="muted">+{(l.tags_csv || '').split(', ').filter(Boolean).length - 3}</span>}
                    </td>
                    <td>{l.abertas ? <span className="badge estado-vendida">{l.abertas} aberta{l.abertas > 1 ? 's' : ''}</span> : <span className="muted">—</span>}</td>
                    <td className="td-data">{dataCurta(l.criado_em)}</td>
                  </tr>
                ))}
                {!leads.length && <tr><td colSpan={7} className="muted" style={{ textAlign: 'center', padding: 30 }}>Nenhum lead encontrado.</td></tr>}
              </tbody>
            </table>
          </div>
          <div className="pager">
            <button className="btn sm" disabled={pag === 0} onClick={() => setPag((p) => p - 1)}>Anterior</button>
            <span className="muted">Página {pag + 1} de {paginas}</span>
            <button className="btn sm" disabled={pag + 1 >= paginas} onClick={() => setPag((p) => p + 1)}>Próxima</button>
          </div>
        </>
      )}
    </div>
  );
}

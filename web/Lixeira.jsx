import React, { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { api } from './api.js';
import { Loading } from './ui.jsx';

// Lixeira: negociações apagadas nos últimos 30 dias, com botão de restaurar.
// Admin e operador veem (operador não vê o que veio de funil restrito; o
// backend filtra). Depois de 30 dias a varredura horária apaga de vez.
const brl = (v) => (Number(v) || 0).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
const quando = (iso) => {
  if (!iso) return '';
  const d = new Date(iso.includes('T') ? iso : iso.replace(' ', 'T') + 'Z');
  return isNaN(d) ? iso : d.toLocaleString('pt-BR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' });
};

export default function Lixeira() {
  const nav = useNavigate();
  const [itens, setItens] = useState(null);
  const [busy, setBusy] = useState(null);
  const [erro, setErro] = useState('');

  function carrega() { return api.lixeira().then(setItens).catch(() => setItens([])); }
  useEffect(() => { carrega(); }, []);

  async function restaura(item) {
    if (!window.confirm(`Restaurar a negociação "${item.titulo || 'sem título'}"?`)) return;
    setBusy(item.id); setErro('');
    try {
      const r = await api.restauraLixeira(item.id);
      nav('/deals/' + r.id);
    } catch (e) {
      setErro((e && e.message) || 'não deu para restaurar');
      setBusy(null);
      carrega();
    }
  }

  return (
    <div className="page">
      <h2>Lixeira</h2>
      <p className="muted" style={{ marginTop: -6, marginBottom: 14 }}>
        Negociação apagada fica aqui por 30 dias e pode ser restaurada com tudo que tinha (tarefas, anotações e histórico). Depois disso some de vez.
      </p>
      {erro && <p className="erro" style={{ color: 'var(--vermelho)' }}>{erro}</p>}
      {!itens ? <Loading /> : itens.length === 0 ? <p className="muted">A lixeira está vazia.</p> : (
        <table className="tab">
          <thead><tr><th>Negociação</th><th>Lead</th><th>Funil / etapa</th><th>Valor</th><th>Apagada por</th><th>Quando</th><th>Some em</th><th></th></tr></thead>
          <tbody>
            {itens.map((it) => (
              <tr key={it.id} style={{ cursor: 'default' }}>
                <td>{it.titulo || <span className="muted">sem título</span>}{it.estado && it.estado !== 'andamento' && <span className={'badge estado-' + it.estado} style={{ marginLeft: 6 }}>{it.estado}</span>}</td>
                <td>{it.lead_nome || <span className="muted">sem lead</span>}</td>
                <td>{it.pipeline_nome || '?'}{it.stage_nome ? ' / ' + it.stage_nome : ''}</td>
                <td>{brl(it.valor)}</td>
                <td>{it.apagada_por_nome || '—'}</td>
                <td>{quando(it.apagada_em)}</td>
                <td>{it.dias_restantes <= 0 ? 'hoje' : `${it.dias_restantes} dia${it.dias_restantes > 1 ? 's' : ''}`}</td>
                <td><button className="btn sm primary" disabled={busy === it.id} onClick={() => restaura(it)}>{busy === it.id ? 'Restaurando…' : 'Restaurar'}</button></td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}

import React, { useEffect, useState } from 'react';
import { api } from './api.js';
import { Loading } from './ui.jsx';

// Gestão de tags (admin): renomear (renomear para um nome já existente MESCLA no
// backend), mesclar explicitamente várias numa só, e excluir. Tag de sistema
// (a "Site", aplicada pela entrada de leads) avisa antes de mexer.
export default function TagsManager() {
  const [tags, setTags] = useState(null);
  const [erro, setErro] = useState('');
  const [busy, setBusy] = useState(false);
  const [editId, setEditId] = useState(null);
  const [editNome, setEditNome] = useState('');
  const [sel, setSel] = useState([]);            // ids marcados para mesclar
  const [destino, setDestino] = useState('');    // id destino do merge

  function carrega() { setErro(''); api.tags().then(setTags).catch((e) => setErro(e.message)); }
  useEffect(carrega, []);

  async function acao(fn) {
    setErro(''); setBusy(true);
    try { await fn(); carrega(); }
    catch (e) { setErro(e.message); }
    finally { setBusy(false); }
  }

  function comecaEdicao(t) { setEditId(t.id); setEditNome(t.nome); }

  function salvaNome(t) {
    const novo = editNome.trim();
    setEditId(null);
    if (!novo || novo === t.nome) return;
    if (t.sistema && !window.confirm(`"${t.nome}" é uma tag de sistema, aplicada sozinha pelo formulário do site. Se renomear, os próximos leads do site voltam a receber "${t.nome}". Continuar?`)) return;
    acao(() => api.patchTag(t.id, { nome: novo, confirmar: t.sistema ? 1 : undefined }));
  }

  function exclui(t) {
    const aviso = t.sistema
      ? `"${t.nome}" é uma tag de SISTEMA, aplicada sozinha pelo formulário do site.\n\n`
      : '';
    if (!window.confirm(`${aviso}Excluir a tag "${t.nome}"? Ela será removida de ${t.leads} lead(s). Isso não apaga os leads.`)) return;
    acao(() => api.deleteTag(t.id, { confirmar: t.sistema ? 1 : undefined }));
  }

  function toggleSel(id) {
    setSel((s) => s.includes(id) ? s.filter((x) => x !== id) : [...s, id]);
  }

  function mescla() {
    const destId = Number(destino);
    const origens = sel.filter((x) => x !== destId);
    if (!destId || !origens.length) return;
    const dst = tags.find((t) => t.id === destId);
    if (!window.confirm(`Mesclar ${origens.length} tag(s) em "${dst?.nome}"? As tags de origem serão apagadas e seus leads passam a ter "${dst?.nome}".`)) return;
    acao(async () => { await api.mergeTags(destId, origens); setSel([]); setDestino(''); });
  }

  if (!tags) return <div className="panel" style={{ gridColumn: '1 / -1' }}><Loading /></div>;

  return (
    <div className="panel" style={{ gridColumn: '1 / -1' }}>
      <p className="muted" style={{ marginTop: 0 }}>Renomear para um nome já existente mescla as duas. Tags de sistema pedem confirmação.</p>
      {erro && <div className="erro">{erro}</div>}

      {sel.length > 0 && (
        <div style={{ display: 'flex', gap: 8, alignItems: 'center', margin: '8px 0', flexWrap: 'wrap' }}>
          <span className="muted">{sel.length} selecionada(s). Mesclar em</span>
          <select value={destino} onChange={(e) => setDestino(e.target.value)} style={{ padding: 6, border: '1px solid var(--linha)', borderRadius: 6 }}>
            <option value="">escolha o destino...</option>
            {tags.filter((t) => sel.includes(t.id)).map((t) => <option key={t.id} value={t.id}>{t.nome}</option>)}
          </select>
          <button className="btn ciano sm" disabled={busy || !destino} onClick={mescla}>Mesclar</button>
          <button className="btn sm" disabled={busy} onClick={() => { setSel([]); setDestino(''); }}>Limpar</button>
        </div>
      )}

      <table className="tab">
        <thead><tr><th style={{ width: 34 }}></th><th>Nome</th><th style={{ width: 80 }}>Leads</th><th style={{ width: 200 }}></th></tr></thead>
        <tbody>
          {tags.map((t) => (
            <tr key={t.id} style={{ cursor: 'default' }}>
              <td><input type="checkbox" checked={sel.includes(t.id)} onChange={() => toggleSel(t.id)} /></td>
              <td>
                {editId === t.id ? (
                  <input autoFocus defaultValue={t.nome} onChange={(e) => setEditNome(e.target.value)}
                    onBlur={() => salvaNome(t)} onKeyDown={(e) => { if (e.key === 'Enter') e.target.blur(); if (e.key === 'Escape') setEditId(null); }}
                    style={{ width: '100%', padding: 6, border: '1px solid var(--linha)', borderRadius: 6 }} />
                ) : (
                  <span>{t.nome} {t.sistema ? <span className="badge atrasada" title="Tag aplicada sozinha pelo formulário do site">sistema</span> : null}</span>
                )}
              </td>
              <td>{t.leads}</td>
              <td style={{ display: 'flex', gap: 6 }}>
                <button className="btn sm" disabled={busy} onClick={() => comecaEdicao(t)}>Renomear</button>
                <button className="btn sm danger" disabled={busy} onClick={() => exclui(t)}>Excluir</button>
              </td>
            </tr>
          ))}
          {!tags.length && <tr><td colSpan={4} className="muted" style={{ textAlign: 'center', padding: 18 }}>Nenhuma tag ainda.</td></tr>}
        </tbody>
      </table>
    </div>
  );
}

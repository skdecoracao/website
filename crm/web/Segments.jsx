import React, { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { api, QUALIF } from './api.js';
import { Loading } from './ui.jsx';
import { useAuth } from './main.jsx';

const VAZIO = { nome: '', tags: [], tags_modo: 'or', nao_tags: [], origens: [], negociacao: '', funil_id: '', etapa_id: '', comprou: false, temperatura: [], criado_de: '', criado_ate: '' };

// Editor de filtros reutilizado no criar/editar do segmento.
function Editor({ val, setVal, tags, origens, pipes }) {
  function toggle(campo, item) {
    const arr = val[campo] || [];
    setVal({ ...val, [campo]: arr.includes(item) ? arr.filter((x) => x !== item) : [...arr, item] });
  }
  const pipeSel = pipes.find((p) => p.id === Number(val.funil_id));
  return (
    <div className="seg-editor">
      <div className="kv"><label>Nome do segmento</label>
        <input value={val.nome} onChange={(e) => setVal({ ...val, nome: e.target.value })} /></div>

      <div className="kv"><label>Tags ({val.tags_modo === 'and' ? 'todas' : 'qualquer'})
        <button className="btn sm" style={{ marginLeft: 8 }} onClick={() => setVal({ ...val, tags_modo: val.tags_modo === 'and' ? 'or' : 'and' })}>
          {val.tags_modo === 'and' ? 'E (todas)' : 'OU (qualquer)'}</button></label>
        <div className="quick-btns">
          {tags.map((t) => <button key={t.id} className={val.tags.includes(t.nome) ? 'on' : ''} onClick={() => toggle('tags', t.nome)}>{t.nome}</button>)}
        </div>
      </div>

      <div className="kv"><label>NÃO tem estas tags</label>
        <div className="quick-btns">
          {tags.map((t) => <button key={t.id} className={(val.nao_tags || []).includes(t.nome) ? 'on' : ''} onClick={() => toggle('nao_tags', t.nome)}>{t.nome}</button>)}
        </div>
      </div>

      <div className="kv"><label>Origem</label>
        <div className="quick-btns">
          {origens.map((o) => <button key={o} className={(val.origens || []).includes(o) ? 'on' : ''} onClick={() => toggle('origens', o)}>{o}</button>)}
          {!origens.length && <span className="muted">Nenhuma origem cadastrada.</span>}
        </div>
      </div>

      <div className="kv"><label>Temperatura</label>
        <div className="quick-btns">
          {QUALIF.map((q) => <button key={q} className={(val.temperatura || []).includes(q) ? 'on' : ''} onClick={() => toggle('temperatura', q)}>{q}</button>)}
        </div>
      </div>

      <div className="kv"><label>Negociação aberta</label>
        <select value={val.negociacao} onChange={(e) => setVal({ ...val, negociacao: e.target.value })}>
          <option value="">Tanto faz</option><option value="com">Com negociação aberta</option><option value="sem">Sem negociação aberta</option>
        </select></div>

      <div className="kv"><label>Negociação aberta em funil / etapa</label>
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          <select value={val.funil_id} onChange={(e) => setVal({ ...val, funil_id: e.target.value, etapa_id: '' })}>
            <option value="">Qualquer funil</option>
            {pipes.map((p) => <option key={p.id} value={p.id}>{p.nome}</option>)}
          </select>
          <select value={val.etapa_id} disabled={!pipeSel} onChange={(e) => setVal({ ...val, etapa_id: e.target.value })}>
            <option value="">Qualquer etapa</option>
            {(pipeSel?.stages || []).map((s) => <option key={s.id} value={s.id}>{s.nome}</option>)}
          </select>
        </div>
      </div>

      <div className="kv"><label>Lead criado entre</label>
        <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
          <input type="date" value={val.criado_de || ''} onChange={(e) => setVal({ ...val, criado_de: e.target.value })} />
          <span className="muted">e</span>
          <input type="date" value={val.criado_ate || ''} onChange={(e) => setVal({ ...val, criado_ate: e.target.value })} />
        </div>
      </div>

      <label className="chip" style={{ marginTop: 6 }}>
        <input type="checkbox" checked={!!val.comprou} onChange={(e) => setVal({ ...val, comprou: e.target.checked })} />&nbsp;Comprou algum produto
      </label>
    </div>
  );
}

export default function Segments() {
  const nav = useNavigate();
  const { user } = useAuth();
  const admin = user.papel === 'admin';
  const [segs, setSegs] = useState(null);
  const [tags, setTags] = useState([]);
  const [origens, setOrigens] = useState([]);
  const [pipes, setPipes] = useState([]);
  const [sel, setSel] = useState(null);
  const [leads, setLeads] = useState(null);
  const [editando, setEditando] = useState(null); // objeto de filtros em edicao (ou null)

  function carrega() { api.segments().then(setSegs).catch(() => setSegs([])); }
  useEffect(() => {
    carrega();
    api.tags().then(setTags).catch(() => {});
    api.leadOrigens().then(setOrigens).catch(() => {});
    api.pipelines().then(setPipes).catch(() => {});
  }, []);

  function abre(s) {
    setSel(s); setLeads(null); setEditando(null);
    api.segmentLeads(s.id).then(setLeads).catch(() => setLeads([]));
  }
  function novo() { setEditando({ ...VAZIO }); setSel(null); }
  function edita(s) { setEditando({ nome: s.nome, ...VAZIO, ...s.filtros }); setSel(s); }
  async function salva() {
    const { nome, ...filtros } = editando;
    if (!nome.trim()) return;
    if (sel) await api.patchSegment(sel.id, { nome, filtros });
    else await api.createSegment({ nome, filtros });
    setEditando(null); carrega();
  }
  async function exclui(s) {
    if (!window.confirm('Excluir o segmento "' + s.nome + '"?')) return;
    await api.deleteSegment(s.id); setSel(null); setLeads(null); carrega();
  }

  if (!segs) return <Loading />;

  return (
    <div className="page">
      <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
        <h2 style={{ margin: 0 }}>Segmentos</h2>
        {admin && <button className="btn ciano sm" onClick={novo}>Novo segmento</button>}
      </div>

      <div className="deal-grid" style={{ padding: '16px 0' }}>
        <div className="panel">
          <h3>Salvos</h3>
          {!segs.length && <p className="muted">Nenhum segmento ainda.</p>}
          {segs.map((s) => (
            <div key={s.id} className="contato-line" style={{ justifyContent: 'space-between' }}>
              <a onClick={() => abre(s)} style={{ cursor: 'pointer' }}>{s.nome}</a>
              {admin && <span style={{ display: 'flex', gap: 6 }}>
                <button className="btn sm" onClick={() => edita(s)}>Editar</button>
                <button className="btn sm danger" onClick={() => exclui(s)}>Excluir</button>
              </span>}
            </div>
          ))}
        </div>

        <div className="panel">
          {editando ? (
            <>
              <h3>{sel ? 'Editar segmento' : 'Novo segmento'}</h3>
              <Editor val={editando} setVal={setEditando} tags={tags} origens={origens} pipes={pipes} />
              <div style={{ display: 'flex', gap: 8, marginTop: 12 }}>
                <button className="btn primary sm" onClick={salva}>Salvar</button>
                <button className="btn sm" onClick={() => setEditando(null)}>Cancelar</button>
              </div>
            </>
          ) : sel ? (
            <>
              <h3>{sel.nome}</h3>
              {!leads ? <Loading /> : (
                <table className="tab">
                  <thead><tr><th>Nome</th><th>E-mail</th><th>Telefone</th></tr></thead>
                  <tbody>
                    {leads.map((l) => (
                      <tr key={l.id} onClick={() => nav('/leads/' + l.id)}>
                        <td>{l.nome || <span className="muted">sem nome</span>}</td><td>{l.email}</td><td>{l.telefone}</td>
                      </tr>
                    ))}
                    {!leads.length && <tr><td colSpan={3} className="muted" style={{ textAlign: 'center', padding: 24 }}>Nenhum lead no segmento.</td></tr>}
                  </tbody>
                </table>
              )}
              {leads && <p className="muted" style={{ marginTop: 8 }}>{leads.length} lead(s).</p>}
            </>
          ) : <p className="muted">Selecione um segmento à esquerda ou crie um novo.</p>}
        </div>
      </div>
    </div>
  );
}

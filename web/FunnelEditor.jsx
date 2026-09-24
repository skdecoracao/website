import React, { useEffect, useState } from 'react';
import { api } from './api.js';
import { Loading } from './ui.jsx';

const TIPOS = [
  { v: 'quick', l: 'Botões rápidos' },
  { v: 'select', l: 'Lista suspensa' },
  { v: 'text', l: 'Texto' },
  { v: 'number', l: 'Número' },
  { v: 'date', l: 'Data' },
];

// slug simples para a chave interna do campo (identificador, sem acento).
function slug(s) {
  return String(s || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '') || 'campo';
}

// Move um item de um array (retorna nova ordem de ids) para reordenar via API.
function movido(arr, idx, delta) {
  const j = idx + delta;
  if (j < 0 || j >= arr.length) return null;
  const a = arr.slice();
  [a[idx], a[j]] = [a[j], a[idx]];
  return a;
}

function DeleteEtapa({ stage, outras, onCancel, onConfirm }) {
  const [destino, setDestino] = useState(outras[0]?.id || '');
  return (
    <div className="modal-overlay" onClick={onCancel}>
      <div className="modal-card" onClick={(e) => e.stopPropagation()}>
        <h3>Remover etapa "{stage.nome}"</h3>
        <p className="muted">As negociações que estiverem nesta etapa serão movidas para outra (em massa, com registro no histórico). Se a etapa estiver vazia, nada é movido.</p>
        {outras.length > 0 ? (
          <div className="kv">
            <label>Mover negociações para</label>
            <select value={destino} onChange={(e) => setDestino(Number(e.target.value))}>
              {outras.map((s) => <option key={s.id} value={s.id}>{s.nome}</option>)}
            </select>
          </div>
        ) : <p className="erro">Não há outra etapa para receber as negociações. Crie outra etapa antes de remover esta.</p>}
        <div className="modal-actions">
          <button className="btn sm" onClick={onCancel}>Cancelar</button>
          <button className="btn danger sm" disabled={!outras.length} onClick={() => onConfirm(destino)}>Remover etapa</button>
        </div>
      </div>
    </div>
  );
}

export default function FunnelEditor() {
  const [pipes, setPipes] = useState(null);
  const [pid, setPid] = useState(null);
  const [stages, setStages] = useState([]);
  const [fields, setFields] = useState([]);
  const [nome, setNome] = useState('');
  const [novaEtapa, setNovaEtapa] = useState('');
  const [novoCampo, setNovoCampo] = useState({ label: '', tipo: 'text', opcoes: '' });
  const [delStage, setDelStage] = useState(null);
  const [erro, setErro] = useState('');
  const [busy, setBusy] = useState(false);
  const [sub, setSub] = useState('etapas'); // sub-aba: etapas | campos | ajustes

  function carregaPipes() { return api.pipelines().then((ps) => { setPipes(ps); return ps; }); }
  useEffect(() => { carregaPipes().then((ps) => { if (ps.length && pid == null) setPid(ps[0].id); }).catch((e) => setErro(e.message)); }, []);

  async function carrega(id) {
    setErro('');
    const ps = pipes || (await carregaPipes());
    const pipe = ps.find((p) => p.id === id);
    setNome(pipe ? pipe.nome : '');
    setStages((pipe?.stages || []).slice().sort((a, b) => a.ordem - b.ordem));
    setFields((await api.fieldDefs(id)).slice().sort((a, b) => a.ordem - b.ordem));
  }
  useEffect(() => { if (pid != null) carrega(pid).catch((e) => setErro(e.message)); }, [pid]);

  async function guarda(fn) {
    setErro(''); setBusy(true);
    try { await fn(); await carregaPipes(); await carrega(pid); }
    catch (e) { setErro(e.message); }
    finally { setBusy(false); }
  }

  // ---- funil ----
  const salvaNome = () => guarda(() => api.patchPipeline(pid, { nome }));
  const pipe = (pipes || []).find((p) => p.id === pid);
  const toggleRestrito = (val) => guarda(() => api.patchPipeline(pid, { restrito_admin: val }));
  const novoFunil = () => {
    const n = window.prompt('Nome do novo funil? (ele nasce com etapas padrão: Para contatar, Em conversa, Proposta, Ganho)');
    if (n == null || !n.trim()) return;
    guarda(async () => { const r = await api.createPipeline({ nome: n.trim() }); setPid(r.id); });
  };

  // ---- etapas ----
  const addEtapa = () => novaEtapa.trim() && guarda(async () => { await api.createStage(pid, { nome: novaEtapa.trim(), ordem: stages.length }); setNovaEtapa(''); });
  const renomeiaEtapa = (s, nv) => nv !== s.nome && guarda(() => api.patchStage(pid, s.id, { nome: nv }));
  const marcaEtapa = (s, campo, val) => guarda(() => api.patchStage(pid, s.id, { [campo]: val }));
  const moveEtapa = (idx, delta) => { const nova = movido(stages, idx, delta); if (nova) guarda(() => api.reorderStages(pid, nova.map((s) => s.id))); };
  const removeEtapa = (destino) => { const s = delStage; setDelStage(null); guarda(() => api.deleteStage(pid, s.id, destino || undefined)); };

  // ---- campos ----
  const addCampo = () => novoCampo.label.trim() && guarda(async () => {
    const opcoes = ['quick', 'select'].includes(novoCampo.tipo) ? novoCampo.opcoes.split(',').map((x) => x.trim()).filter(Boolean) : undefined;
    await api.createFieldDef(pid, { chave: slug(novoCampo.label), label: novoCampo.label.trim(), tipo: novoCampo.tipo, opcoes, ordem: fields.length });
    setNovoCampo({ label: '', tipo: 'text', opcoes: '' });
  });
  const salvaCampo = (f, patch) => guarda(() => api.patchFieldDef(pid, f.id, patch));
  const moveCampo = (idx, delta) => { const nova = movido(fields, idx, delta); if (nova) guarda(() => api.reorderFieldDefs(pid, nova.map((f) => f.id))); };
  const removeCampo = (f) => window.confirm(`Remover o campo "${f.label}"? Os valores já preenchidos nas negociações também são apagados.`) && guarda(() => api.deleteFieldDef(pid, f.id));

  if (pipes == null) return <Loading />;

  return (
    <div className="panel" style={{ gridColumn: '1 / -1' }}>
      <div className="cfg-funil-topo">
        <div className="kv" style={{ maxWidth: 420, margin: 0 }}>
          <label>Funil</label>
          <select value={pid ?? ''} onChange={(e) => setPid(Number(e.target.value))}>
            {pipes.map((p) => <option key={p.id} value={p.id}>{p.nome}</option>)}
          </select>
        </div>
        <button className="btn ciano sm" disabled={busy} onClick={novoFunil}>Novo funil</button>
      </div>

      {erro && <div className="erro">{erro}</div>}
      {pid == null ? null : (
        <>
          <div className="tabs" style={{ marginTop: 14 }}>
            <button className={sub === 'etapas' ? 'on' : ''} onClick={() => setSub('etapas')}>Etapas ({stages.length})</button>
            <button className={sub === 'campos' ? 'on' : ''} onClick={() => setSub('campos')}>Campos ({fields.length})</button>
            <button className={sub === 'ajustes' ? 'on' : ''} onClick={() => setSub('ajustes')}>Ajustes</button>
          </div>

          {sub === 'ajustes' && (
            <>
              <div className="kv" style={{ maxWidth: 360 }}>
                <label>Título do funil</label>
                <div style={{ display: 'flex', gap: 8 }}>
                  <input value={nome} onChange={(e) => setNome(e.target.value)} />
                  <button className="btn primary sm" disabled={busy} onClick={salvaNome}>Salvar</button>
                </div>
              </div>
              <label className="chip" style={{ marginTop: 6 }}>
                <input type="checkbox" checked={!!pipe?.restrito_admin} disabled={busy} onChange={(e) => toggleRestrito(e.target.checked)} />
                &nbsp;Restrito a administradores (operadores não veem este funil nem suas negociações)
              </label>
            </>
          )}

          {sub === 'etapas' && (<>
          <p className="muted" style={{ margin: '0 0 10px' }}>As colunas do Quadro, na ordem. Marque Ganho e Perda nas etapas finais: é o que fecha a negociação.</p>
          <table className="tab">
            <thead><tr><th style={{ width: 60 }}>Ordem</th><th>Nome</th><th style={{ width: 80 }}>Ganho</th><th style={{ width: 80 }}>Perda</th><th style={{ width: 90 }}></th></tr></thead>
            <tbody>
              {stages.map((s, i) => (
                <tr key={s.id} style={{ cursor: 'default' }}>
                  <td>
                    <button className="btn sm" disabled={busy || i === 0} onClick={() => moveEtapa(i, -1)} title="Subir">↑</button>
                    <button className="btn sm" disabled={busy || i === stages.length - 1} onClick={() => moveEtapa(i, 1)} title="Descer">↓</button>
                  </td>
                  <td><input defaultValue={s.nome} onBlur={(e) => renomeiaEtapa(s, e.target.value.trim())} style={{ width: '100%', padding: 6, border: '1px solid var(--linha)', borderRadius: 6 }} /></td>
                  <td><input type="checkbox" checked={!!s.is_won} onChange={(e) => marcaEtapa(s, 'is_won', e.target.checked)} /></td>
                  <td><input type="checkbox" checked={!!s.is_lost} onChange={(e) => marcaEtapa(s, 'is_lost', e.target.checked)} /></td>
                  <td><button className="btn danger sm" disabled={busy} onClick={() => setDelStage(s)}>Remover</button></td>
                </tr>
              ))}
            </tbody>
          </table>
          <div style={{ display: 'flex', gap: 8, marginTop: 10 }}>
            <input placeholder="Nome da nova etapa..." value={novaEtapa} onChange={(e) => setNovaEtapa(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && addEtapa()} style={{ flex: 1, maxWidth: 300, padding: 7, border: '1px solid var(--linha)', borderRadius: 6 }} />
            <button className="btn ciano sm" disabled={busy} onClick={addEtapa}>Adicionar etapa</button>
          </div>
          </>)}

          {sub === 'campos' && (<>
          <p className="muted" style={{ margin: '0 0 10px' }}>Campos que aparecem na página da negociação deste funil. Botões rápidos e lista suspensa usam as opções.</p>
          <table className="tab">
            <thead><tr><th style={{ width: 60 }}>Ordem</th><th>Rótulo</th><th style={{ width: 150 }}>Tipo</th><th>Opções (botões/lista)</th><th style={{ width: 90 }}></th></tr></thead>
            <tbody>
              {fields.map((f, i) => (
                <tr key={f.id} style={{ cursor: 'default' }}>
                  <td>
                    <button className="btn sm" disabled={busy || i === 0} onClick={() => moveCampo(i, -1)} title="Subir">↑</button>
                    <button className="btn sm" disabled={busy || i === fields.length - 1} onClick={() => moveCampo(i, 1)} title="Descer">↓</button>
                  </td>
                  <td><input defaultValue={f.label} onBlur={(e) => e.target.value.trim() !== f.label && salvaCampo(f, { label: e.target.value.trim() })} style={{ width: '100%', padding: 6, border: '1px solid var(--linha)', borderRadius: 6 }} /></td>
                  <td>
                    <select value={f.tipo} onChange={(e) => salvaCampo(f, { tipo: e.target.value })}>
                      {TIPOS.map((t) => <option key={t.v} value={t.v}>{t.l}</option>)}
                    </select>
                  </td>
                  <td>
                    {['quick', 'select'].includes(f.tipo) ? (
                      <input defaultValue={(f.opcoes || []).join(', ')} placeholder="opção 1, opção 2..."
                        onBlur={(e) => salvaCampo(f, { opcoes: e.target.value.split(',').map((x) => x.trim()).filter(Boolean) })}
                        style={{ width: '100%', padding: 6, border: '1px solid var(--linha)', borderRadius: 6 }} />
                    ) : <span className="muted">—</span>}
                  </td>
                  <td><button className="btn danger sm" disabled={busy} onClick={() => removeCampo(f)}>Remover</button></td>
                </tr>
              ))}
              {!fields.length && <tr><td colSpan={5} className="muted" style={{ textAlign: 'center', padding: 18 }}>Nenhum campo neste funil.</td></tr>}
            </tbody>
          </table>
          <div style={{ display: 'flex', gap: 8, marginTop: 10, flexWrap: 'wrap', alignItems: 'center' }}>
            <input placeholder="Rótulo do novo campo..." value={novoCampo.label} onChange={(e) => setNovoCampo((c) => ({ ...c, label: e.target.value }))} style={{ flex: 1, maxWidth: 240, padding: 7, border: '1px solid var(--linha)', borderRadius: 6 }} />
            <select value={novoCampo.tipo} onChange={(e) => setNovoCampo((c) => ({ ...c, tipo: e.target.value }))} style={{ padding: 7, border: '1px solid var(--linha)', borderRadius: 6 }}>
              {TIPOS.map((t) => <option key={t.v} value={t.v}>{t.l}</option>)}
            </select>
            {['quick', 'select'].includes(novoCampo.tipo) && (
              <input placeholder="opções separadas por vírgula" value={novoCampo.opcoes} onChange={(e) => setNovoCampo((c) => ({ ...c, opcoes: e.target.value }))} style={{ flex: 1, maxWidth: 240, padding: 7, border: '1px solid var(--linha)', borderRadius: 6 }} />
            )}
            <button className="btn ciano sm" disabled={busy} onClick={addCampo}>Adicionar campo</button>
          </div>
          </>)}
        </>
      )}

      {delStage && <DeleteEtapa stage={delStage} outras={stages.filter((s) => s.id !== delStage.id)} onCancel={() => setDelStage(null)} onConfirm={removeEtapa} />}
    </div>
  );
}

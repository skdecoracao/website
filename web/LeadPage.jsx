import React, { useEffect, useState } from 'react';
import { useParams, useNavigate, Link } from 'react-router-dom';
import { api, brl, waLink, soTelefone } from './api.js';
import { Loading, Timeline, PurchasesList, OrigemBlock } from './ui.jsx';

export default function LeadPage() {
  const { id } = useParams();
  const nav = useNavigate();
  const [lead, setLead] = useState(null);
  const [novaTag, setNovaTag] = useState('');

  function recarrega() { return api.lead(id).then(setLead); }
  useEffect(() => { api.lead(id).then(setLead).catch(() => nav('/leads')); }, [id]);

  if (!lead) return <Loading />;
  const wa = waLink(lead.telefone);

  async function addTag() {
    const nome = novaTag.trim();
    if (!nome) return;
    await api.addLeadTag(id, nome); setNovaTag(''); recarrega();
  }
  async function removeTag(tagId) { await api.removeLeadTag(id, tagId); recarrega(); }

  return (
    <div className="page">
      <div style={{ marginBottom: 12 }}><Link to="/leads">← Voltar para leads</Link></div>
      <h2>{lead.nome || 'Lead sem nome'} {lead.cliente && <span className="badge cliente">Cliente</span>}</h2>

      <div className="deal-grid" style={{ padding: 0 }}>
        <div className="panel">
          <h3>Dados</h3>
          {lead.telefone && (
            <div className="contato-line">📞 <a href={'tel:' + soTelefone(lead.telefone)}>{lead.telefone}</a>
              {wa && <>· <a href={wa} target="_blank" rel="noreferrer">WhatsApp</a></>}</div>
          )}
          {lead.email && <div className="contato-line">✉️ <a href={'mailto:' + lead.email}>{lead.email}</a></div>}

          <OrigemBlock lead={lead} />

          <h3 className="mt">Tags</h3>
          <div>
            {(lead.tags || []).map((t) => (
              <span key={t.id} className="tag">{t.nome} <button onClick={() => removeTag(t.id)} title="Remover">×</button></span>
            ))}
            {!(lead.tags || []).length && <span className="muted">Sem tags.</span>}
          </div>
          <div style={{ display: 'flex', gap: 8, marginTop: 10 }}>
            <input placeholder="Nova tag..." value={novaTag} onChange={(e) => setNovaTag(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && addTag()}
              style={{ flex: 1, padding: 7, border: '1px solid var(--linha)', borderRadius: 6, fontSize: 13 }} />
            <button className="btn ciano sm" onClick={addTag}>Adicionar</button>
          </div>

          <h3 className="mt">Negociações</h3>
          {(lead.deals || []).map((d) => (
            <div key={d.id} style={{ marginBottom: 10 }}>
              <div className="contato-line">
                <Link to={'/deals/' + d.id}>{d.titulo || 'Negociação'}</Link>
                <span className="muted">· {d.pipeline_nome} / {d.stage_nome}{d.valor ? ' · ' + brl(d.valor) : ''}</span>
              </div>
              {!!(d.info_adicional || []).length && (
                <div className="muted" style={{ fontSize: 12.5, marginLeft: 2 }}>
                  {d.info_adicional.map((f, i) => <div key={i}>{f.label}: {f.valor}</div>)}
                </div>
              )}
            </div>
          ))}
          {!(lead.deals || []).length && <p className="muted">Nenhuma negociação ligada.</p>}
        </div>

        <div className="panel">
          <h3>Produtos comprados</h3>
          <PurchasesList leadId={id} />

          <h3 className="mt">Histórico</h3>
          <Timeline events={lead.events} />
        </div>
      </div>
    </div>
  );
}

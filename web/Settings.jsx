import React, { useEffect, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { api } from './api.js';
import { Loading } from './ui.jsx';
import { useAuth } from './main.jsx';
import FunnelEditor from './FunnelEditor.jsx';
import TagsManager from './TagsManager.jsx';
import UsersManager from './UsersManager.jsx';

// Configurações em sub-abas (pedido do Gui, 08/09/2026): navegação lateral no
// desktop, pílulas no celular; a aba fica na URL (?aba=) para link direto.
const ABAS = [
  { id: 'funis', nome: 'Funis', desc: 'Funis, etapas (colunas) e campos da negociação. Só administradores editam; toda mudança fica no histórico.' },
  { id: 'tags', nome: 'Tags', desc: 'Rótulos dos leads. Renomear para um nome existente junta as duas; a tag Site é aplicada sozinha pelo formulário do site e pede confirmação.' },
  { id: 'usuarios', nome: 'Usuários', desc: 'Quem acessa o CRM e com que papel. Senha temporária é mostrada uma vez só.' },
  { id: 'sistema', nome: 'Sistema', desc: 'Dados desta instância e integrações ligadas ao CRM.' },
];

// Integrações vivas (estático de propósito: mostra onde o sistema está ligado).
const INTEGRACOES = [
  { nome: 'Cloudflare', valor: 'Worker sk-crm + D1 sk-crm-db (conta SK Decorações)', status: 'ligado' },
  { nome: 'Entrada de leads', valor: 'formulário de skdecoracao.com.br via /api/ingest/lead', status: 'ligado' },
  { nome: 'Motor de temperatura', valor: 'varredura de hora em hora (cron do Worker)', status: 'ligado' },
  { nome: 'E-mail', valor: 'sem envio de e-mail (RESEND_API_KEY não configurada)', status: 'desligado' },
];

export default function Settings() {
  const { user } = useAuth();
  const [params, setParams] = useSearchParams();
  const aba = ABAS.some((a) => a.id === params.get('aba')) ? params.get('aba') : 'funis';
  const atual = ABAS.find((a) => a.id === aba);
  const [cfg, setCfg] = useState(null);
  const [erro, setErro] = useState('');

  useEffect(() => {
    api.adminConfig().then(setCfg).catch((e) => setErro(e.message));
  }, []);

  if (erro) return <div className="page"><p className="erro">{erro}</p></div>;
  if (!cfg) return <Loading />;

  return (
    <div className="page">
      <h2>Configurações</h2>
      <div className="cfg-layout">
        <nav className="cfg-nav" aria-label="Seções das configurações">
          {ABAS.map((a) => (
            <button key={a.id} className={a.id === aba ? 'on' : ''} onClick={() => setParams({ aba: a.id })}>{a.nome}</button>
          ))}
        </nav>
        <section className="cfg-conteudo">
          <header className="cfg-cabeca">
            <h3>{atual.nome}</h3>
            <p className="muted">{atual.desc}</p>
          </header>
          {aba === 'funis' && <FunnelEditor />}
          {aba === 'tags' && <TagsManager />}
          {aba === 'usuarios' && <UsersManager meId={user.id} />}
          {aba === 'sistema' && (
            <div className="cards-cfg">
              <div className="panel">
                <h3>Workspace</h3>
                <table className="tab">
                  <thead><tr><th>Nome</th><th>Slug</th></tr></thead>
                  <tbody>
                    {cfg.workspaces.map((w) => (
                      <tr key={w.id} style={{ cursor: 'default' }}><td>{w.nome}</td><td>{w.slug}</td></tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <div className="panel" style={{ gridColumn: '1 / -1' }}>
                <h3>Integrações</h3>
                <table className="tab">
                  <thead><tr><th>Serviço</th><th>Onde</th><th>Status</th></tr></thead>
                  <tbody>
                    {INTEGRACOES.map((i) => (
                      <tr key={i.nome} style={{ cursor: 'default' }}>
                        <td>{i.nome}</td><td className="muted">{i.valor}</td>
                        <td><span className={'badge ' + (i.status === 'ligado' ? 'estado-vendida' : 'atrasada')}>{i.status}</span></td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}
        </section>
      </div>
    </div>
  );
}

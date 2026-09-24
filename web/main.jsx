import React, { useEffect, useState, createContext, useContext } from 'react';
import { createRoot } from 'react-dom/client';
import { HashRouter, Routes, Route, NavLink, Navigate, useNavigate, useSearchParams } from 'react-router-dom';
import './styles.css';
import { api } from './api.js';
import { Loading } from './ui.jsx';
import Login from './Login.jsx';
import Kanban from './Kanban.jsx';
import Deal from './Deal.jsx';
import Leads from './Leads.jsx';
import LeadPage from './LeadPage.jsx';
import Settings from './Settings.jsx';
import Segments from './Segments.jsx';
import Tarefas from './Tarefas.jsx';
import Lixeira from './Lixeira.jsx';
import Relatorios from './Relatorios.jsx';

// Link direto por e-mail/telefone, para abrir o lead sem saber o id:
// #/abrir?email=x@y.com ou #/abrir?tel=31999990000 -> página do lead.
// Com id já existe: #/leads/<id> e #/deals/<id>.
function Abrir() {
  const nav = useNavigate();
  const [sp] = useSearchParams();
  const [erro, setErro] = useState('');
  useEffect(() => {
    const email = (sp.get('email') || '').trim().toLowerCase();
    const tel = (sp.get('tel') || '').replace(/\D/g, '').replace(/^0+/, '');
    const q = email || tel;
    if (!q) { setErro('Informe email= ou tel= na URL.'); return; }
    api.leads({ q, limit: 50 }).then((ls) => {
      const digitos = (t) => String(t || '').replace(/\D/g, '').replace(/^0+/, '');
      const achado = ls.find((l) => email && (l.email || '').toLowerCase() === email)
        || ls.find((l) => tel && (digitos(l.telefone).endsWith(tel) || tel.endsWith(digitos(l.telefone))))
        || ls[0];
      if (achado) nav('/leads/' + achado.id, { replace: true });
      else setErro('Nenhum lead com ' + q + ' no CRM.');
    }).catch(() => setErro('Não foi possível buscar o lead.'));
  }, []);
  return erro ? <div className="page"><p className="muted">{erro}</p></div> : <Loading>Abrindo o lead...</Loading>;
}

const AuthCtx = createContext(null);
export const useAuth = () => useContext(AuthCtx);

function TrocarSenhaModal({ onClose }) {
  const [atual, setAtual] = useState('');
  const [nova, setNova] = useState('');
  const [erro, setErro] = useState('');
  const [ok, setOk] = useState(false);
  const [busy, setBusy] = useState(false);

  async function submit(e) {
    e.preventDefault();
    setErro(''); setBusy(true);
    try {
      await api.trocarSenha(atual, nova);
      setOk(true);
    } catch (err) {
      setErro(err.status === 400 || err.status === 401 ? (err.message || 'Não foi possível trocar a senha.') : err.message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="modal-overlay" onClick={onClose}>
      <form className="modal-card" onClick={(e) => e.stopPropagation()} onSubmit={submit}>
        <h3>Trocar senha</h3>
        {ok ? (
          <>
            <p>Senha alterada com sucesso.</p>
            <button type="button" className="btn primary" onClick={onClose}>Fechar</button>
          </>
        ) : (
          <>
            <div className="field">
              <label>Senha atual</label>
              <input type="password" value={atual} onChange={(e) => setAtual(e.target.value)} autoFocus required />
            </div>
            <div className="field">
              <label>Nova senha (mínimo 8 caracteres)</label>
              <input type="password" value={nova} onChange={(e) => setNova(e.target.value)} minLength={8} required />
            </div>
            {erro && <div className="erro">{erro}</div>}
            <div className="modal-actions">
              <button type="button" className="btn sm" onClick={onClose}>Cancelar</button>
              <button className="btn primary sm" disabled={busy}>{busy ? 'Salvando...' : 'Salvar'}</button>
            </div>
          </>
        )}
      </form>
    </div>
  );
}

function Shell({ user, setUser }) {
  const nav = useNavigate();
  const admin = user.papel === 'admin';
  const [menuOpen, setMenuOpen] = useState(false);
  const [navOpen, setNavOpen] = useState(false);
  const [senhaOpen, setSenhaOpen] = useState(false);
  async function sair() {
    try { await api.logout(); } catch {}
    setUser(null);
    nav('/login');
  }
  // "Ver como": admin escolhe outro usuário e o app inteiro recarrega como ele
  // (o backend troca o usuário pelo cookie; aqui só refaz o /api/me).
  const verComoPor = user.ver_como_por;
  const [outros, setOutros] = useState(null);
  async function abreMenu() {
    setMenuOpen((v) => !v);
    if (admin && outros == null) api.adminUsers().then((us) => setOutros(us.filter((u) => u.ativo && u.id !== user.id))).catch(() => setOutros([]));
  }
  async function verComo(id) {
    setMenuOpen(false);
    await api.verComo(id);
    setUser(await api.me());
    nav('/kanban');
  }
  async function sairVerComo() {
    await api.verComoSair();
    setUser(await api.me());
    nav('/kanban');
  }
  return (
    <>
      {verComoPor && (
        <div className="ver-como-bar">
          Você está vendo o CRM como <b>{user.nome}</b> ({user.papel}). Só visualização: nada é gravado neste modo.
          <button className="btn sm" onClick={sairVerComo}>Voltar a ser {verComoPor.nome}</button>
        </div>
      )}
      <div className="topbar">
        <button
          className="hamburger"
          onClick={() => setNavOpen((v) => !v)}
          aria-label="Menu"
          aria-expanded={navOpen}
        >☰</button>
        <div
          className="brand"
          style={{ cursor: 'pointer' }}
          role="button"
          tabIndex={0}
          title="Ir para a home"
          onClick={() => nav('/kanban')}
          onKeyDown={(e) => { if (e.key === 'Enter') nav('/kanban'); }}
        >CRM <span>SK Decorações</span></div>
        <nav className={'nav' + (navOpen ? ' open' : '')} onClick={() => setNavOpen(false)}>
          <NavLink to="/kanban" className={({ isActive }) => isActive ? 'on' : ''}>Negociações</NavLink>
          <NavLink to="/leads" className={({ isActive }) => isActive ? 'on' : ''}>Leads</NavLink>
          <NavLink to="/tarefas" className={({ isActive }) => isActive ? 'on' : ''}>Tarefas</NavLink>
          <NavLink to="/segmentos" className={({ isActive }) => isActive ? 'on' : ''}>Segmentos</NavLink>
          <NavLink to="/lixeira" className={({ isActive }) => isActive ? 'on' : ''}>Lixeira</NavLink>
          {admin && <NavLink to="/relatorios" className={({ isActive }) => isActive ? 'on' : ''}>Relatórios</NavLink>}
          {admin && <NavLink to="/config" className={({ isActive }) => isActive ? 'on' : ''}>Configurações</NavLink>}
        </nav>
        <div className="spacer" />
        <div className="userbox" style={{ position: 'relative' }}>
          <span style={{ cursor: 'pointer' }} onClick={abreMenu}>{user.nome}{admin ? ' (admin)' : ''} ▾</span>
          {menuOpen && (
            <div className="user-menu" onMouseLeave={() => setMenuOpen(false)}>
              {!verComoPor && <button onClick={() => { setSenhaOpen(true); setMenuOpen(false); }}>Trocar senha</button>}
              {admin && !verComoPor && (outros || []).map((u) => (
                <button key={u.id} onClick={() => verComo(u.id)}>Ver como {u.nome} ({u.papel})</button>
              ))}
              {verComoPor && <button onClick={sairVerComo}>Voltar a ser {verComoPor.nome}</button>}
              <button onClick={sair}>Sair</button>
            </div>
          )}
        </div>
      </div>
      {senhaOpen && <TrocarSenhaModal onClose={() => setSenhaOpen(false)} />}
      <Routes>
        <Route path="/kanban" element={<Kanban admin={admin} />} />
        <Route path="/deals/:id" element={<Deal />} />
        <Route path="/leads" element={<Leads />} />
        <Route path="/leads/:id" element={<LeadPage />} />
        <Route path="/abrir" element={<Abrir />} />
        <Route path="/tarefas" element={<Tarefas />} />
        <Route path="/segmentos" element={<Segments />} />
        <Route path="/lixeira" element={<Lixeira />} />
        <Route path="/relatorios" element={admin ? <Relatorios /> : <Navigate to="/kanban" />} />
        <Route path="/config" element={admin ? <Settings /> : <Navigate to="/kanban" />} />
        <Route path="*" element={<Navigate to="/kanban" />} />
      </Routes>
    </>
  );
}

function App() {
  const [user, setUser] = useState(undefined); // undefined = carregando, null = deslogado
  useEffect(() => {
    api.me().then(setUser).catch(() => setUser(null));
  }, []);

  if (user === undefined) return <Loading>Carregando...</Loading>;

  return (
    <AuthCtx.Provider value={{ user, setUser }}>
      <Routes>
        <Route path="/login" element={user ? <Navigate to="/kanban" /> : <Login onLogin={setUser} />} />
        <Route path="/*" element={user ? <Shell user={user} setUser={setUser} /> : <Navigate to="/login" />} />
      </Routes>
    </AuthCtx.Provider>
  );
}

createRoot(document.getElementById('root')).render(
  <HashRouter><App /></HashRouter>
);

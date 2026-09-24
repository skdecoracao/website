import React, { useEffect, useState } from 'react';
import { api } from './api.js';
import { Loading } from './ui.jsx';

// Gestao de usuarios (admin): criar (senha temporaria mostrada UMA vez), trocar
// papel, ativar/desativar, resetar senha. Sem exclusao fisica. A propria conta
// nao pode ser rebaixada nem desativada (trava no backend; UI tambem esconde).
export default function UsersManager({ meId }) {
  const [users, setUsers] = useState(null);
  const [erro, setErro] = useState('');
  const [busy, setBusy] = useState(false);
  const [novo, setNovo] = useState(null);        // { nome, email, papel } em criacao
  const [senhaTemp, setSenhaTemp] = useState(null); // { email, senha } mostrada uma vez

  function carrega() { setErro(''); api.adminUsers().then(setUsers).catch((e) => setErro(e.message)); }
  useEffect(carrega, []);

  async function acao(fn) {
    setErro(''); setBusy(true);
    try { await fn(); carrega(); }
    catch (e) { setErro(e.message); }
    finally { setBusy(false); }
  }

  async function cria() {
    const email = (novo.email || '').trim();
    if (!email) { setErro('e-mail obrigatorio'); return; }
    await acao(async () => {
      const r = await api.createUser({ nome: (novo.nome || '').trim() || undefined, email, papel: novo.papel });
      setNovo(null);
      setSenhaTemp({ email, senha: r.senha_temp });
    });
  }

  function reset(u) {
    if (!window.confirm(`Gerar uma nova senha temporaria para ${u.email}? A senha atual deixa de valer.`)) return;
    acao(async () => {
      const r = await api.resetSenhaUser(u.id);
      setSenhaTemp({ email: u.email, senha: r.senha_temp });
    });
  }

  const trocaPapel = (u, papel) => acao(() => api.patchUser(u.id, { papel }));
  const toggleAtivo = (u) => acao(() => api.patchUser(u.id, { ativo: u.ativo ? false : true }));

  if (!users) return <div className="panel"><Loading /></div>;

  return (
    <div className="panel">
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'flex-end', marginBottom: 8 }}>
        {!novo && <button className="btn ciano sm" onClick={() => setNovo({ nome: '', email: '', papel: 'operador' })}>Novo usuário</button>}
      </div>
      {erro && <div className="erro">{erro}</div>}

      {senhaTemp && (
        <div className="panel" style={{ background: 'var(--superficie)', border: '1px solid var(--linha)', margin: '8px 0' }}>
          <p style={{ margin: 0 }}>Senha temporária de <b>{senhaTemp.email}</b> (anote agora, não é mostrada de novo):</p>
          <p style={{ fontFamily: 'monospace', fontSize: 18, margin: '6px 0' }}>{senhaTemp.senha}</p>
          <button className="btn sm" onClick={() => setSenhaTemp(null)}>Ok, anotei</button>
        </div>
      )}

      {novo && (
        <div className="panel" style={{ margin: '8px 0' }}>
          <div className="kv"><label>Nome</label>
            <input value={novo.nome} onChange={(e) => setNovo({ ...novo, nome: e.target.value })} /></div>
          <div className="kv"><label>E-mail</label>
            <input value={novo.email} onChange={(e) => setNovo({ ...novo, email: e.target.value })} /></div>
          <div className="kv"><label>Papel</label>
            <select value={novo.papel} onChange={(e) => setNovo({ ...novo, papel: e.target.value })}>
              <option value="operador">operador</option><option value="admin">admin</option>
            </select></div>
          <div style={{ display: 'flex', gap: 8, marginTop: 10 }}>
            <button className="btn primary sm" disabled={busy} onClick={cria}>Criar usuário</button>
            <button className="btn sm" disabled={busy} onClick={() => setNovo(null)}>Cancelar</button>
          </div>
        </div>
      )}

      <table className="tab">
        <thead><tr><th>Nome</th><th>E-mail</th><th style={{ width: 120 }}>Papel</th><th style={{ width: 90 }}>Ativo</th><th style={{ width: 110 }}></th></tr></thead>
        <tbody>
          {users.map((u) => {
            const eu = u.id === meId;
            return (
              <tr key={u.id} style={{ cursor: 'default' }}>
                <td>{u.nome}{eu ? <span className="muted"> (você)</span> : null}</td>
                <td>{u.email}</td>
                <td>
                  <select value={u.papel} disabled={busy || eu} onChange={(e) => trocaPapel(u, e.target.value)}>
                    <option value="operador">operador</option><option value="admin">admin</option>
                  </select>
                </td>
                <td>
                  <button className={'btn sm ' + (u.ativo ? '' : 'danger')} disabled={busy || eu} onClick={() => toggleAtivo(u)}>
                    {u.ativo ? 'ativo' : 'inativo'}
                  </button>
                </td>
                <td><button className="btn sm" disabled={busy} onClick={() => reset(u)}>Resetar senha</button></td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

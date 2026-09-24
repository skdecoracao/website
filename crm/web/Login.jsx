import React, { useState } from 'react';
import { api } from './api.js';

export default function Login({ onLogin }) {
  const [email, setEmail] = useState('');
  const [senha, setSenha] = useState('');
  const [erro, setErro] = useState('');
  const [busy, setBusy] = useState(false);

  async function submit(e) {
    e.preventDefault();
    setErro(''); setBusy(true);
    try {
      const u = await api.login(email.trim(), senha);
      onLogin(u);
    } catch (err) {
      setErro(err.status === 401 ? 'E-mail ou senha incorretos.' : err.message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="login-wrap">
      <form className="login-card" onSubmit={submit}>
        <div className="login-marca" aria-hidden="true">SK</div>
        <h1>CRM SK Decorações</h1>
        <p>Entre com seu e-mail e senha.</p>
        <div className="field">
          <label>E-mail</label>
          <input type="email" value={email} onChange={(e) => setEmail(e.target.value)} autoFocus required />
        </div>
        <div className="field">
          <label>Senha</label>
          <input type="password" value={senha} onChange={(e) => setSenha(e.target.value)} required />
        </div>
        {erro && <div className="erro">{erro}</div>}
        <button className="btn primary" style={{ width: '100%', marginTop: 6 }} disabled={busy}>
          {busy ? 'Entrando...' : 'Entrar'}
        </button>
      </form>
    </div>
  );
}

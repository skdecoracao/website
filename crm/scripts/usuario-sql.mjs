// Gera o SQL de criação de um usuário do CRM (hash PBKDF2 igual ao de
// hashPassword() em src/index.js). A senha vem do ambiente, nunca do argumento
// da linha de comando (que fica no histórico do shell), e o SQL sai no stdout
// para ir direto a um arquivo temporário fora do repositório:
//
//   SENHA='...' node scripts/usuario-sql.mjs email@x.com "Nome" admin > /tmp/u.sql
//   npx wrangler d1 execute sk-crm-db --remote --file /tmp/u.sql
//
// Depois de criado, senha nova ou reset é pela tela Configurações > Usuários.
import { webcrypto as crypto } from 'node:crypto';

const [email, nome, papel = 'operador'] = process.argv.slice(2);
const senha = process.env.SENHA;
if (!email || !nome || !senha || !['admin', 'operador'].includes(papel)) {
  console.error('uso: SENHA=... node scripts/usuario-sql.mjs <email> <nome> [admin|operador]');
  process.exit(1);
}

const hex = (buf) => [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, '0')).join('');
const salt = hex(crypto.getRandomValues(new Uint8Array(16)));
const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(senha), 'PBKDF2', false, ['deriveBits']);
const bits = await crypto.subtle.deriveBits(
  { name: 'PBKDF2', hash: 'SHA-256', salt: Uint8Array.from(salt.match(/../g).map((h) => parseInt(h, 16))), iterations: 100000 },
  key, 256);
const sq = (s) => "'" + String(s).replace(/'/g, "''") + "'";
console.log(`INSERT INTO users (email, nome, senha_hash, senha_salt, papel) VALUES (${sq(email.toLowerCase().trim())}, ${sq(nome)}, ${sq(hex(bits))}, ${sq(salt)}, ${sq(papel)});`);

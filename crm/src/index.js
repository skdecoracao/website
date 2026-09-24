// CRM SK Decorações. Worker único: API REST (/api/*) + SPA (assets via wrangler [assets]).
// JS puro, zero dependências. Enforcement de papel no backend (nunca so no front).

import { varredura, labelDeNivel, nivelDeLabel, WHATSAPP_MIN, ETAPA_RAPIDA_MIN, ETAPA_RAPIDA_H } from './qualif.js';
import { mandaParaLixeira, restauraDaLixeira, LIXEIRA_DIAS } from './lixeira.js';
import { normalizaOrigem, origemDeRastreio, TAG_SITE } from './origem.js';

const ITER = 100000;
const COOKIE = 'crm_sess';
const SESSION_DAYS = 30;
// Instância de um negócio só: todo dado vive no workspace 1, slug 'sk'.
const WS = 1;
const WS_SLUG = 'sk';

// ---------- util ----------
const te = new TextEncoder();
function hex(buf) { return [...new Uint8Array(buf)].map(b => b.toString(16).padStart(2, '0')).join(''); }
function fromHex(h) { return Uint8Array.from(h.match(/../g).map(x => parseInt(x, 16))); }
function b64url(bytes) {
  let s = btoa(String.fromCharCode(...bytes));
  return s.replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}
function unb64url(s) {
  s = s.replace(/-/g, '+').replace(/_/g, '/');
  return Uint8Array.from(atob(s), c => c.charCodeAt(0));
}
function json(data, status = 200, headers = {}) {
  return new Response(JSON.stringify(data), { status, headers: { 'content-type': 'application/json; charset=utf-8', ...headers } });
}
function err(status, msg) { return json({ error: msg }, status); }

async function hashPassword(password, saltHex) {
  const key = await crypto.subtle.importKey('raw', te.encode(password), 'PBKDF2', false, ['deriveBits']);
  const bits = await crypto.subtle.deriveBits({ name: 'PBKDF2', hash: 'SHA-256', salt: fromHex(saltHex), iterations: ITER }, key, 256);
  return hex(bits);
}

// Senha temporaria legivel (12 chars base62, sem confundir 0/O/1/l): mostrada
// UMA vez ao admin na criacao/reset de usuario.
function senhaTemporaria() {
  const abc = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789';
  const buf = crypto.getRandomValues(new Uint8Array(12));
  return [...buf].map((n) => abc[n % abc.length]).join('');
}

async function hmac(secret, msg) {
  const key = await crypto.subtle.importKey('raw', te.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  return new Uint8Array(await crypto.subtle.sign('HMAC', key, te.encode(msg)));
}
async function makeCookie(secret, userId) {
  const exp = Date.now() + SESSION_DAYS * 86400000;
  const payload = `${userId}.${exp}`;
  const sig = b64url(await hmac(secret, payload));
  return `${b64url(te.encode(payload))}.${sig}`;
}
async function readCookie(secret, value) {
  if (!value) return null;
  const parts = value.split('.');
  if (parts.length !== 2) return null;
  let payload;
  try { payload = new TextDecoder().decode(unb64url(parts[0])); } catch { return null; }
  const expect = b64url(await hmac(secret, payload));
  // comparacao de tempo constante
  if (expect.length !== parts[1].length) return null;
  let diff = 0;
  for (let i = 0; i < expect.length; i++) diff |= expect.charCodeAt(i) ^ parts[1].charCodeAt(i);
  if (diff !== 0) return null;
  const [userId, exp] = payload.split('.');
  if (Date.now() > Number(exp)) return null;
  return Number(userId);
}

function getCookie(req, name) {
  const h = req.headers.get('cookie') || '';
  for (const p of h.split(';')) {
    const [k, ...v] = p.trim().split('=');
    if (k === name) return v.join('=');
  }
  return null;
}
function normPhone(p) { return p ? String(p).replace(/\D/g, '').replace(/^0+/, '') : null; }

async function body(req) { try { return await req.json(); } catch { return {}; } }

// ---------- app ----------
export default {
  async fetch(req, env) {
    const url = new URL(req.url);
    // Assets (com hash no nome) sao servidos direto pelo edge com Cache-Control
    // imutavel via web/public/_headers; o Worker nem roda para eles.
    if (!url.pathname.startsWith('/api/')) return env.ASSETS.fetch(req);
    try {
      return await route(req, env, url);
    } catch (e) {
      return err(500, 'erro interno: ' + (e && e.message));
    }
  },
  // Varredura horaria do motor de temperatura (cron 0 * * * * no wrangler.toml).
  async scheduled(_event, env, ctx) {
    ctx.waitUntil(varredura(env.DB, env));
  },
};

async function route(req, env, url) {
  const secret = env.SESSION_SECRET || 'dev-insecure-secret';
  const db = env.DB;
  const p = url.pathname;
  const m = req.method;
  const seg = p.split('/').filter(Boolean); // ['api', ...]

  // --- login (sem auth) ---
  if (p === '/api/login' && m === 'POST') {
    const { email, password } = await body(req);
    if (!email || !password) return err(400, 'email e senha obrigatorios');
    const u = await db.prepare('SELECT * FROM users WHERE email = ? AND ativo = 1').bind(String(email).toLowerCase().trim()).first();
    if (!u) return err(401, 'credenciais invalidas');
    const h = await hashPassword(password, u.senha_salt);
    if (h !== u.senha_hash) return err(401, 'credenciais invalidas');
    const cookie = await makeCookie(secret, u.id);
    return json({ id: u.id, nome: u.nome, email: u.email, papel: u.papel }, 200, {
      'set-cookie': `${COOKIE}=${cookie}; HttpOnly; Secure; SameSite=Lax; Path=/; Max-Age=${SESSION_DAYS * 86400}`,
    });
  }
  if (p === '/api/logout' && m === 'POST') {
    return json({ ok: true }, 200, { 'set-cookie': `${COOKIE}=; HttpOnly; Secure; SameSite=Lax; Path=/; Max-Age=0` });
  }

  // --- ingestao de sistemas externos (token fixo, sem cookie) ---
  if (p === '/api/ingest/lead' && m === 'POST') {
    const authz = req.headers.get('authorization') || '';
    const token = authz.startsWith('Bearer ') ? authz.slice(7) : '';
    if (!env.CRM_INGEST_TOKEN || token !== env.CRM_INGEST_TOKEN) return err(401, 'token invalido');
    return ingestLead(db, await body(req));
  }
  // --- gatilho manual da varredura horária (a mesma que o cron roda), por token ---
  if (p === '/api/cron/qualificacao' && m === 'POST') {
    const authz = req.headers.get('authorization') || '';
    const token = authz.startsWith('Bearer ') ? authz.slice(7) : '';
    if (!env.CRM_INGEST_TOKEN || token !== env.CRM_INGEST_TOKEN) return err(401, 'token invalido');
    await varredura(db, env);
    return json({ ok: true });
  }
  // --- auth obrigatoria a partir daqui (cookie de sessão da SPA) ---
  const uid = await readCookie(secret, getCookie(req, COOKIE));
  if (!uid) return err(401, 'nao autenticado');
  let user = await db.prepare('SELECT id, nome, email, papel FROM users WHERE id = ? AND ativo = 1').bind(uid).first();
  if (!user) return err(401, 'sessao invalida');

  // --- "Ver como": admin enxerga o CRM como outro usuário (pedido do Gui,
  // 08/09/2026). Cookie próprio (crm_ver_como) ao lado da sessão; enquanto ele
  // existe, o resto do handler roda com o usuário alvo e o papel dele, então
  // todo gate (admin, funil restrito, menus) fica igual ao que a pessoa vê.
  // SÓ LEITURA: qualquer escrita nesse modo leva 403, para nada ficar gravado
  // em nome de quem não fez. Entrar/sair é do admin de verdade, antes da troca. ---
  const VER_COMO = 'crm_ver_como';
  if (p === '/api/admin/ver-como' && (m === 'POST' || m === 'DELETE')) {
    if (user.papel !== 'admin') return err(403, 'so admin');
    if (m === 'DELETE') return json({ ok: true }, 200, { 'set-cookie': `${VER_COMO}=; HttpOnly; Secure; SameSite=Lax; Path=/; Max-Age=0` });
    const b = await body(req);
    const alvo = await db.prepare('SELECT id, nome FROM users WHERE id = ? AND ativo = 1').bind(Number(b.user_id)).first();
    if (!alvo) return err(404, 'usuario nao encontrado');
    if (alvo.id === user.id) return err(400, 'voce ja e voce');
    await logEvent(db, WS, null, null, 'ver_como', user.id, { user_id: alvo.id, nome: alvo.nome });
    return json({ ok: true, nome: alvo.nome }, 200, { 'set-cookie': `${VER_COMO}=${alvo.id}; HttpOnly; Secure; SameSite=Lax; Path=/; Max-Age=${8 * 3600}` });
  }
  let verComoPor = null;
  const verComoId = Number(getCookie(req, VER_COMO) || 0);
  if (user.papel === 'admin' && verComoId && verComoId !== user.id) {
    const alvo = await db.prepare('SELECT id, nome, email, papel FROM users WHERE id = ? AND ativo = 1').bind(verComoId).first();
    if (alvo) { verComoPor = { id: user.id, nome: user.nome }; user = alvo; }
  }
  if (verComoPor && m !== 'GET' && p !== '/api/logout') return err(403, `modo "ver como ${user.nome}": so visualizacao. Saia do modo para alterar.`);
  const isAdmin = user.papel === 'admin';
  const requireAdmin = () => { if (!isAdmin) throw { _403: true }; };
  // Funis restritos (restrito_admin=1): operador nao acessa board/deals deles.
  const guardPipe = async (pipelineId) => {
    if (isAdmin || !pipelineId) return;
    const pi = await db.prepare('SELECT restrito_admin FROM pipelines WHERE id = ?').bind(pipelineId).first();
    if (pi && pi.restrito_admin) throw { _403: true };
  };
  // Mesmo gate, mas a partir do id da deal: fecha acesso DIRETO a deal de funil
  // restrito (GET/PATCH da deal, eventos, tarefas e notas por deal_id).
  const guardDeal = async (dealId) => {
    if (isAdmin || !dealId) return;
    const d = await db.prepare('SELECT pipeline_id FROM deals WHERE id = ?').bind(dealId).first();
    if (d) await guardPipe(d.pipeline_id);
  };
  const ws = WS;

  try {
    // gate global: export, admin, delete e escrita de pipeline sao admin-only
    if (p.startsWith('/api/export/') || p.startsWith('/api/admin/')) requireAdmin();

    if (p === '/api/me') return json({ ...user, ver_como_por: verComoPor });

    if (p === '/api/me/senha' && m === 'POST') {
      const b = await body(req);
      if (!b.senha_atual || !b.senha_nova) return err(400, 'senha atual e nova sao obrigatorias');
      if (String(b.senha_nova).length < 8) return err(400, 'nova senha precisa de no minimo 8 caracteres');
      const full = await db.prepare('SELECT senha_hash, senha_salt FROM users WHERE id = ?').bind(user.id).first();
      const h = await hashPassword(b.senha_atual, full.senha_salt);
      if (h !== full.senha_hash) return err(401, 'senha atual incorreta');
      const salt = hex(crypto.getRandomValues(new Uint8Array(16)));
      const novoHash = await hashPassword(b.senha_nova, salt);
      await db.prepare('UPDATE users SET senha_hash = ?, senha_salt = ? WHERE id = ?').bind(novoHash, salt, user.id).run();
      await logEvent(db, ws, null, null, 'senha_trocada', user.id, null);
      return json({ ok: true });
    }

    // ---------- pipelines / stages ----------
    if (p === '/api/pipelines' && m === 'GET') {
      const restr = isAdmin ? '' : ' AND restrito_admin = 0';
      const pipes = (await db.prepare(`SELECT * FROM pipelines WHERE workspace_id = ?${restr} ORDER BY ordem`).bind(ws).all()).results;
      const stages = (await db.prepare('SELECT s.* FROM stages s JOIN pipelines pi ON pi.id = s.pipeline_id WHERE pi.workspace_id = ? ORDER BY s.pipeline_id, s.ordem').bind(ws).all()).results;
      for (const pipe of pipes) pipe.stages = stages.filter(s => s.pipeline_id === pipe.id);
      return json(pipes);
    }
    if (p === '/api/pipelines' && m === 'POST') {
      requireAdmin();
      const b = await body(req);
      const nome = (b.nome || '').trim();
      if (!nome) return err(400, 'nome obrigatorio');
      const maxOrd = (await db.prepare('SELECT COALESCE(MAX(ordem),-1) mo FROM pipelines WHERE workspace_id = ?').bind(ws).first()).mo;
      const r = await db.prepare('INSERT INTO pipelines (workspace_id, nome, ordem, restrito_admin) VALUES (?,?,?,?)')
        .bind(ws, nome, b.ordem != null ? b.ordem : maxOrd + 1, b.restrito_admin ? 1 : 0).run();
      const pid = r.meta.last_row_id;
      // Etapas iniciais padrão (a última marcada como ganho, para o botão "Marcar
      // venda" ter destino). Aceita b.etapas custom: array de nomes.
      const etapas = Array.isArray(b.etapas) && b.etapas.length ? b.etapas.map((s) => String(s).trim()).filter(Boolean)
        : ['Novo contato', 'Em conversa', 'Orçamento enviado', 'Ganho'];
      for (let i = 0; i < etapas.length; i++) {
        await db.prepare('INSERT INTO stages (pipeline_id, nome, ordem, is_won) VALUES (?,?,?,?)')
          .bind(pid, etapas[i], i, i === etapas.length - 1 ? 1 : 0).run();
      }
      // Todo funil novo nasce com os campos do negócio (data da festa, tema,
      // pacote...): sem eles, mover uma negociação para cá perderia esses dados.
      await criaCamposPadrao(db, pid);
      await logEvent(db, ws, null, null, 'funil_editado', user.id, { pipeline_id: pid, acao: 'criar_funil', nome });
      return json({ id: pid }, 201);
    }
    let mm;
    if ((mm = p.match(/^\/api\/pipelines\/(\d+)\/stages$/)) && m === 'POST') {
      requireAdmin();
      const b = await body(req);
      const r = await db.prepare('INSERT INTO stages (pipeline_id, nome, ordem, is_won, is_lost) VALUES (?,?,?,?,?)')
        .bind(Number(mm[1]), b.nome, b.ordem || 0, b.is_won ? 1 : 0, b.is_lost ? 1 : 0).run();
      return json({ id: r.meta.last_row_id }, 201);
    }
    if ((mm = p.match(/^\/api\/pipelines\/(\d+)\/field-defs$/)) && m === 'GET') {
      await guardPipe(Number(mm[1]));
      const defs = (await db.prepare('SELECT * FROM deal_field_defs WHERE pipeline_id = ? ORDER BY ordem').bind(Number(mm[1])).all()).results;
      for (const d of defs) d.opcoes = d.opcoes ? JSON.parse(d.opcoes) : null;
      return json(defs);
    }

    // ---------- editor de funil (escrita so admin; grava evento de auditoria) ----------
    // Renomear funil (nao exclui funil pelo editor: fora de escopo, por decisao do Gui).
    if ((mm = p.match(/^\/api\/pipelines\/(\d+)$/)) && m === 'PATCH') {
      requireAdmin();
      const pid = Number(mm[1]); const b = await body(req);
      const pipe = await db.prepare('SELECT * FROM pipelines WHERE id = ? AND workspace_id = ?').bind(pid, ws).first();
      if (!pipe) return err(404, 'funil nao encontrado');
      if (b.nome != null) await db.prepare('UPDATE pipelines SET nome = ? WHERE id = ?').bind(b.nome, pid).run();
      if (b.restrito_admin != null) {
        await db.prepare('UPDATE pipelines SET restrito_admin = ? WHERE id = ?').bind(b.restrito_admin ? 1 : 0, pid).run();
        await logEvent(db, ws, null, null, 'funil_editado', user.id, { pipeline_id: pid, acao: 'restrito_admin', valor: b.restrito_admin ? 1 : 0 });
      }
      if (b.nome != null) await logEvent(db, ws, null, null, 'funil_editado', user.id, { pipeline_id: pid, acao: 'renomear_funil', de: pipe.nome, para: b.nome });
      return json({ ok: true });
    }
    // Reordenar etapas: { order: [stage_id,...] } na ordem desejada.
    if ((mm = p.match(/^\/api\/pipelines\/(\d+)\/stages\/reorder$/)) && m === 'POST') {
      requireAdmin();
      const pid = Number(mm[1]); const b = await body(req);
      const order = Array.isArray(b.order) ? b.order : [];
      for (let i = 0; i < order.length; i++) await db.prepare('UPDATE stages SET ordem = ? WHERE id = ? AND pipeline_id = ?').bind(i, Number(order[i]), pid).run();
      await logEvent(db, ws, null, null, 'funil_editado', user.id, { pipeline_id: pid, acao: 'reordenar_etapas', ordem: order });
      return json({ ok: true });
    }
    // Editar / remover etapa. Remover etapa com negociacoes exige etapa de destino.
    if ((mm = p.match(/^\/api\/pipelines\/(\d+)\/stages\/(\d+)$/))) {
      requireAdmin();
      const pid = Number(mm[1]); const sid = Number(mm[2]);
      const st = await db.prepare('SELECT * FROM stages WHERE id = ? AND pipeline_id = ?').bind(sid, pid).first();
      if (!st) return err(404, 'etapa nao encontrada');
      if (m === 'PATCH') {
        const b = await body(req);
        await db.prepare('UPDATE stages SET nome = COALESCE(?,nome), is_won = COALESCE(?,is_won), is_lost = COALESCE(?,is_lost), ordem = COALESCE(?,ordem) WHERE id = ?')
          .bind(b.nome ?? null, b.is_won == null ? null : (b.is_won ? 1 : 0), b.is_lost == null ? null : (b.is_lost ? 1 : 0), b.ordem ?? null, sid).run();
        await logEvent(db, ws, null, null, 'funil_editado', user.id, { pipeline_id: pid, acao: 'editar_etapa', stage_id: sid, para: b.nome ?? st.nome });
        return json({ ok: true });
      }
      if (m === 'DELETE') {
        const b = await body(req);
        const n = (await db.prepare('SELECT COUNT(*) n FROM deals WHERE stage_id = ?').bind(sid).first()).n;
        if (n > 0) {
          const destino = Number(b.destino_stage_id || 0);
          if (!destino || destino === sid) return err(400, 'etapa tem negociacoes: escolha uma etapa de destino (destino_stage_id)');
          const dst = await db.prepare('SELECT id FROM stages WHERE id = ? AND pipeline_id = ?').bind(destino, pid).first();
          if (!dst) return err(400, 'etapa de destino invalida');
          const deals = (await db.prepare('SELECT id, lead_id, workspace_id FROM deals WHERE stage_id = ?').bind(sid).all()).results;
          await db.prepare("UPDATE deals SET stage_id = ?, stage_entered_at = datetime('now'), atualizado_em = datetime('now') WHERE stage_id = ?").bind(destino, sid).run();
          for (const d of deals) await logEvent(db, d.workspace_id, d.id, d.lead_id, 'deal_movida', user.id, { de: sid, para: destino, motivo: 'Etapa removida: negociacoes movidas em massa' });
        }
        await db.prepare('DELETE FROM stages WHERE id = ?').bind(sid).run();
        await logEvent(db, ws, null, null, 'funil_editado', user.id, { pipeline_id: pid, acao: 'remover_etapa', stage_id: sid, etapa: st.nome, negociacoes_movidas: n, destino: b.destino_stage_id ?? null });
        return json({ ok: true });
      }
    }
    // Reordenar campos: { order: [field_def_id,...] }.
    if ((mm = p.match(/^\/api\/pipelines\/(\d+)\/field-defs\/reorder$/)) && m === 'POST') {
      requireAdmin();
      const pid = Number(mm[1]); const b = await body(req);
      const order = Array.isArray(b.order) ? b.order : [];
      for (let i = 0; i < order.length; i++) await db.prepare('UPDATE deal_field_defs SET ordem = ? WHERE id = ? AND pipeline_id = ?').bind(i, Number(order[i]), pid).run();
      await logEvent(db, ws, null, null, 'funil_editado', user.id, { pipeline_id: pid, acao: 'reordenar_campos', ordem: order });
      return json({ ok: true });
    }
    // Criar campo da negociacao.
    if ((mm = p.match(/^\/api\/pipelines\/(\d+)\/field-defs$/)) && m === 'POST') {
      requireAdmin();
      const pid = Number(mm[1]); const b = await body(req);
      if (!b.chave || !b.label || !b.tipo) return err(400, 'chave, label e tipo obrigatorios');
      if (!['quick', 'text', 'date', 'number', 'select'].includes(b.tipo)) return err(400, 'tipo invalido');
      const opcoes = Array.isArray(b.opcoes) && b.opcoes.length ? JSON.stringify(b.opcoes) : null;
      const r = await db.prepare('INSERT INTO deal_field_defs (pipeline_id, chave, label, tipo, opcoes, ordem) VALUES (?,?,?,?,?,?)')
        .bind(pid, b.chave, b.label, b.tipo, opcoes, b.ordem || 0).run();
      await logEvent(db, ws, null, null, 'funil_editado', user.id, { pipeline_id: pid, acao: 'criar_campo', label: b.label });
      return json({ id: r.meta.last_row_id }, 201);
    }
    // Editar / remover campo.
    if ((mm = p.match(/^\/api\/pipelines\/(\d+)\/field-defs\/(\d+)$/))) {
      requireAdmin();
      const pid = Number(mm[1]); const fid = Number(mm[2]);
      const def = await db.prepare('SELECT * FROM deal_field_defs WHERE id = ? AND pipeline_id = ?').bind(fid, pid).first();
      if (!def) return err(404, 'campo nao encontrado');
      if (m === 'PATCH') {
        const b = await body(req);
        if (b.tipo && !['quick', 'text', 'date', 'number', 'select'].includes(b.tipo)) return err(400, 'tipo invalido');
        // opcoes: undefined = nao mexe; array = grava; vazio/null = limpa.
        const opcoes = b.opcoes === undefined ? def.opcoes : (Array.isArray(b.opcoes) && b.opcoes.length ? JSON.stringify(b.opcoes) : null);
        await db.prepare('UPDATE deal_field_defs SET label = COALESCE(?,label), tipo = COALESCE(?,tipo), opcoes = ?, ordem = COALESCE(?,ordem) WHERE id = ?')
          .bind(b.label ?? null, b.tipo ?? null, opcoes, b.ordem ?? null, fid).run();
        await logEvent(db, ws, null, null, 'funil_editado', user.id, { pipeline_id: pid, acao: 'editar_campo', field_def_id: fid, label: b.label ?? def.label });
        return json({ ok: true });
      }
      if (m === 'DELETE') {
        await db.prepare('DELETE FROM deal_field_defs WHERE id = ?').bind(fid).run();
        await logEvent(db, ws, null, null, 'funil_editado', user.id, { pipeline_id: pid, acao: 'remover_campo', field_def_id: fid, label: def.label });
        return json({ ok: true });
      }
    }
    // board: contagem, soma e primeira pagina de deals por etapa
    if ((mm = p.match(/^\/api\/pipelines\/(\d+)\/board$/)) && m === 'GET') {
      const pid = Number(mm[1]);
      await guardPipe(pid);
      const limit = Math.min(Number(url.searchParams.get('limit') || 50), 500);
      // Ordenacao server-side (a coluna pode ser truncada pelo limit, entao a ordem importa).
      const ORDER = {
        recente: 'd.criado_em DESC',
        antiga: 'd.criado_em ASC',
        atividade: 'ultima_atividade DESC',
        temperatura: 'nivel DESC, d.atualizado_em DESC',
        valor: 'd.valor DESC',
        proxima_tarefa: '(prox_tarefa IS NULL), prox_tarefa ASC',
        parado: 'd.stage_entered_at ASC',
        nome: 'l.nome COLLATE NOCASE ASC',
        // "Festa mais próxima": as de hoje em diante primeiro, depois as que já
        // passaram, e as sem data no fim.
        proxima_festa: "(data_festa IS NULL), (data_festa < date('now','-3 hours')), data_festa ASC",
      };
      const orderBy = ORDER[url.searchParams.get('sort')] || ORDER.recente;
      // Filtro de estado NO SERVIDOR: sem ele o LIMIT trunca a coluna antes de o
      // front filtrar por estado, e uma etapa com muitas 'perdida' recentes empurra
      // as 'andamento' para fora do limite (bug do sumico das negociacoes). Whitelist.
      // 'ativas' (padrão da SK) = em andamento + vendidas: as colunas "Reservado"
      // e "Festa realizada" mostram as festas já fechadas junto com o funil aberto.
      const EST = { ativas: "AND d.estado != 'perdida'", andamento: "AND d.estado = 'andamento'", vendida: "AND d.estado = 'vendida'", perdida: "AND d.estado = 'perdida'", todas: '' };
      const estadoParam = url.searchParams.get('estado') || 'ativas';
      const estadoSql = EST[estadoParam] ?? EST.ativas;
      const stages = (await db.prepare('SELECT * FROM stages WHERE pipeline_id = ? ORDER BY ordem').bind(pid).all()).results;
      const nivelCase = "(CASE d.qualificacao WHEN 'Muito frio' THEN 1 WHEN 'Frio' THEN 2 WHEN 'Morno' THEN 3 WHEN 'Quente' THEN 4 WHEN 'Muito quente' THEN 5 ELSE 3 END)";
      // contagem/soma respeitam o mesmo estado exibido (em 'todas', exclui perdida como antes).
      const aggSql = estadoParam === 'todas' ? "AND d.estado != 'perdida'" : estadoSql;
      const dealsSql =
        `SELECT d.*, COALESCE(NULLIF(d.qualificacao,''),'Frio') qualificacao, l.nome lead_nome, l.email lead_email, l.telefone lead_telefone, l.origem lead_origem, l.criado_em lead_criado_em,
           ${nivelCase} nivel,
           ${CAMPOS_CARD.map((c) => `(SELECT v.valor FROM deal_field_values v JOIN deal_field_defs def ON def.id = v.field_def_id
             WHERE v.deal_id = d.id AND def.chave = '${c}') ${c},`).join('\n           ')}
           (SELECT GROUP_CONCAT(t.nome, ',') FROM lead_tags lt JOIN tags t ON t.id = lt.tag_id WHERE lt.lead_id = d.lead_id) tags_csv,
           EXISTS (SELECT 1 FROM purchases pu WHERE pu.lead_id = d.lead_id) cliente,
           (SELECT MIN(due_at) FROM tasks tk WHERE tk.deal_id = d.id AND tk.feito = 0 AND tk.due_at IS NOT NULL) prox_tarefa,
           (SELECT tk.titulo FROM tasks tk WHERE tk.deal_id = d.id AND tk.feito = 0 ORDER BY (tk.due_at IS NULL), tk.due_at LIMIT 1) prox_tarefa_titulo,
           (SELECT COUNT(*) FROM tasks tk WHERE tk.deal_id = d.id) tem_tarefa,
           (SELECT COUNT(*) FROM tasks tk WHERE tk.deal_id = d.id AND tk.feito = 0 AND tk.due_at IS NOT NULL AND tk.due_at < datetime('now')) tarefa_atrasada,
           MAX(d.atualizado_em, COALESCE((SELECT MAX(criado_em) FROM events e WHERE e.deal_id = d.id), d.criado_em)) ultima_atividade,
           u.nome dono_nome
         FROM deals d LEFT JOIN leads l ON l.id = d.lead_id
         LEFT JOIN users u ON u.id = d.dono_id
         WHERE d.stage_id = ? ${estadoSql} ORDER BY ${orderBy} LIMIT ?`;
      // Uma unica ida ao D1 (db.batch) em vez de 2 queries sequenciais por etapa:
      // corta o RTT de rede de 2N para 1 (a causa da lentidao do board).
      const stmts = [];
      for (const s of stages) {
        stmts.push(db.prepare(`SELECT COUNT(*) n, COALESCE(SUM(valor),0) soma FROM deals d WHERE d.stage_id = ? ${aggSql}`).bind(s.id));
        stmts.push(db.prepare(dealsSql).bind(s.id, limit));
      }
      const res = await db.batch(stmts);
      stages.forEach((s, i) => {
        const agg = res[i * 2].results[0];
        s.count = agg.n; s.soma = agg.soma;
        s.deals = res[i * 2 + 1].results;
      });
      return json(stages);
    }
    if ((mm = p.match(/^\/api\/stages\/(\d+)\/deals$/)) && m === 'GET') {
      const sid = Number(mm[1]);
      const st = await db.prepare('SELECT pipeline_id FROM stages WHERE id = ?').bind(sid).first();
      if (st) await guardPipe(st.pipeline_id);
      const limit = Math.min(Number(url.searchParams.get('limit') || 50), 200);
      const offset = Number(url.searchParams.get('offset') || 0);
      const rows = (await db.prepare(
        `SELECT d.*, l.nome lead_nome, l.email lead_email FROM deals d LEFT JOIN leads l ON l.id = d.lead_id
         WHERE d.stage_id = ? ORDER BY d.atualizado_em DESC LIMIT ? OFFSET ?`).bind(sid, limit, offset).all()).results;
      return json(rows);
    }

    // ---------- calendário de festas ----------
    // Negociações posicionadas pela Data da festa (campo data_festa, data pura
    // AAAA-MM-DD: compara como texto, sem converter fuso). Filtra no D1 pelo
    // intervalo pedido. Classificação pelo estado e pelas marcas da etapa, nunca
    // pelo nome: vendida na primeira etapa de ganho = 'fechada'; vendida em
    // etapa de ganho posterior ou com a festa já passada = 'realizada'; aberta
    // na última etapa comum antes do ganho = 'quase'; outras abertas = 'aberta'.
    // Perdidas e etapas de perda nunca entram.
    if (p === '/api/calendario' && m === 'GET') {
      const DATA = /^\d{4}-\d{2}-\d{2}$/;
      const inicio = url.searchParams.get('inicio') || '';
      const fim = url.searchParams.get('fim') || '';
      if (!DATA.test(inicio) || !DATA.test(fim) || inicio > fim) return err(400, 'inicio e fim obrigatorios (AAAA-MM-DD)');
      const funilQ = url.searchParams.get('funil');
      const pipe = funilQ
        ? await db.prepare('SELECT * FROM pipelines WHERE id = ? AND workspace_id = ?').bind(Number(funilQ), ws).first()
        : await db.prepare("SELECT * FROM pipelines WHERE workspace_id = ? ORDER BY (nome <> 'Vendas'), ordem, id LIMIT 1").bind(ws).first();
      if (!pipe) return err(404, 'funil nao encontrado');
      await guardPipe(pipe.id);
      const etapas = (await db.prepare('SELECT id, nome, ordem, is_won, is_lost FROM stages WHERE pipeline_id = ? ORDER BY ordem, id').bind(pipe.id).all()).results
        .filter((s) => !s.is_lost);
      const ganhos = etapas.filter((s) => s.is_won);
      const primeiroGanho = ganhos[0] || null;
      const abertas = etapas.filter((s) => !s.is_won);
      // "Quase fechando" = a última etapa comum que vem antes da primeira de ganho.
      const quase = abertas.filter((s) => !primeiroGanho || s.ordem < primeiroGanho.ordem).slice(-1)[0] || null;
      const tipoDaEtapa = (s) => (s.is_won ? (primeiroGanho && s.id === primeiroGanho.id ? 'fechada' : 'realizada') : (quase && s.id === quase.id ? 'quase' : 'aberta'));
      for (const s of etapas) { s.tipo = tipoDaEtapa(s); s.padrao = s.tipo !== 'aberta' ? 1 : 0; }
      // Etapas pedidas (?etapas=1,2,3); sem o parâmetro, as padrão.
      const pedidas = (url.searchParams.get('etapas') ?? etapas.filter((s) => s.padrao).map((s) => s.id).join(','))
        .split(',').map(Number).filter((id) => etapas.some((s) => s.id === id));
      const hoje = new Date(Date.now() - 3 * 3600000).toISOString().slice(0, 10); // dia de São Paulo
      const vazio = { funil: { id: pipe.id, nome: pipe.nome }, etapas, etapas_ativas: pedidas, hoje, festas: [], sem_data: [] };
      if (!pedidas.length) return json(vazio);
      const campo = (c) => `(SELECT v.valor FROM deal_field_values v JOIN deal_field_defs def ON def.id = v.field_def_id WHERE v.deal_id = d.id AND def.chave = '${c}') ${c}`;
      const base = `SELECT d.id, d.titulo, d.valor, d.estado, d.stage_id, l.nome lead_nome,
            ${['data_festa', 'tema', 'pacote', 'entrega', 'local'].map(campo).join(', ')}
          FROM deals d LEFT JOIN leads l ON l.id = d.lead_id
         WHERE d.pipeline_id = ? AND d.estado <> 'perdida' AND d.stage_id IN (${pedidas.map(() => '?').join(',')})`;
      const [comData, semData] = await db.batch([
        db.prepare(`SELECT * FROM (${base}) WHERE data_festa BETWEEN ? AND ? ORDER BY data_festa, id`).bind(pipe.id, ...pedidas, inicio, fim),
        // Sem data: só quem ainda vai ter festa (quase fechando e fechadas), para ela preencher.
        db.prepare(`SELECT * FROM (${base}) WHERE COALESCE(data_festa, '') = '' ORDER BY id DESC LIMIT 200`).bind(pipe.id, ...pedidas),
      ]);
      const classifica = (d) => {
        const st = etapas.find((s) => s.id === d.stage_id);
        let tipo = d.estado === 'vendida' ? (st && st.tipo === 'realizada' ? 'realizada' : 'fechada') : (st && st.tipo === 'quase' ? 'quase' : 'aberta');
        if (tipo === 'fechada' && d.data_festa && d.data_festa < hoje) tipo = 'realizada';
        return { ...d, tipo, etapa: st ? st.nome : null };
      };
      return json({
        ...vazio,
        festas: comData.results.map(classifica),
        sem_data: semData.results.map(classifica).filter((d) => d.tipo === 'quase' || d.tipo === 'fechada'),
      });
    }

    // ---------- leads ----------
    if (p === '/api/leads' && m === 'GET') {
      const q = url.searchParams.get('q');
      const tag = url.searchParams.get('tag');
      const origem = url.searchParams.get('origem');
      const negociacao = url.searchParams.get('negociacao'); // 'com' | 'sem'
      const sort = url.searchParams.get('sort') || 'recente'; // recente | nome | criado
      const limit = Math.min(Number(url.searchParams.get('limit') || 50), 200);
      const offset = Number(url.searchParams.get('offset') || 0);
      const wh = ['l.workspace_id = ?']; const args = [ws];
      if (q) { wh.push('(l.nome LIKE ? OR l.email LIKE ? OR l.telefone LIKE ?)'); const like = `%${q}%`; args.push(like, like, like); }
      let joinTag = '';
      if (tag) { joinTag = 'JOIN lead_tags lt ON lt.lead_id = l.id JOIN tags t ON t.id = lt.tag_id'; wh.push('t.nome = ?'); args.push(tag); }
      if (origem) { wh.push('l.origem = ?'); args.push(origem); }
      if (negociacao === 'com') wh.push('EXISTS (SELECT 1 FROM deals d WHERE d.lead_id = l.id AND d.estado = \'andamento\')');
      if (negociacao === 'sem') wh.push('NOT EXISTS (SELECT 1 FROM deals d WHERE d.lead_id = l.id AND d.estado = \'andamento\')');
      const ORDER = { nome: 'l.nome ASC', criado: 'l.criado_em DESC', recente: 'l.atualizado_em DESC' };
      const orderBy = ORDER[sort] || ORDER.recente;
      // Colunas extras da tabela de leads (10/09/2026): tags, negociações abertas.
      const rows = (await db.prepare(
        `SELECT DISTINCT l.*,
                (SELECT group_concat(t2.nome, ', ') FROM lead_tags lt2 JOIN tags t2 ON t2.id = lt2.tag_id WHERE lt2.lead_id = l.id) tags_csv,
                (SELECT COUNT(*) FROM deals d2 WHERE d2.lead_id = l.id AND d2.estado = 'andamento') abertas
           FROM leads l ${joinTag} WHERE ${wh.join(' AND ')} ORDER BY ${orderBy} LIMIT ? OFFSET ?`)
        .bind(...args, limit, offset).all()).results;
      // ?total=1: devolve { itens, total } para a paginação mostrar "1 a 50 de N".
      if (url.searchParams.get('total') === '1') {
        const total = (await db.prepare(`SELECT COUNT(DISTINCT l.id) n FROM leads l ${joinTag} WHERE ${wh.join(' AND ')}`).bind(...args).first()).n;
        return json({ itens: rows, total });
      }
      return json(rows);
    }
    if (p === '/api/leads' && m === 'POST') {
      const b = await body(req);
      // Lead digitado no CRM sem origem escolhida vira "Cadastro manual": quem
      // cadastra na mão está falando com a pessoa (WhatsApp, Instagram, telefone).
      const r = await db.prepare('INSERT INTO leads (workspace_id, nome, email, telefone, telefone_norm, origem, origem_original) VALUES (?,?,?,?,?,?,?)')
        .bind(ws, b.nome || null, b.email || null, b.telefone || null, normPhone(b.telefone),
          b.origem ? normalizaOrigem(b.origem) : 'Cadastro manual', b.origem || null).run();
      return json({ id: r.meta.last_row_id }, 201);
    }
    // Detalhe do lead (GET /api/leads/:id e /api/leads/por-telefone/:tel): lead +
    // tags + deals (com funil/etapa; operador não vê as de funil restrito) +
    // info adicional por deal + eventos + se já comprou.
    const detalheLead = async (id) => {
      const lead = await db.prepare('SELECT * FROM leads WHERE id = ? AND workspace_id = ?').bind(id, ws).first();
      if (!lead) return null;
      lead.tags = (await db.prepare('SELECT t.* FROM tags t JOIN lead_tags lt ON lt.tag_id = t.id WHERE lt.lead_id = ?').bind(id).all()).results;
      lead.deals = (await db.prepare(`SELECT d.*, pi.nome pipeline_nome, s.nome stage_nome FROM deals d JOIN pipelines pi ON pi.id = d.pipeline_id JOIN stages s ON s.id = d.stage_id WHERE d.lead_id = ?${isAdmin ? '' : ' AND pi.restrito_admin = 0'} ORDER BY d.id DESC`).bind(id).all()).results;
      for (const d of lead.deals) {
        d.info_adicional = (await db.prepare(
          `SELECT def.label, v.valor FROM deal_field_values v JOIN deal_field_defs def ON def.id = v.field_def_id
           WHERE v.deal_id = ? AND v.valor IS NOT NULL AND v.valor <> '' ORDER BY def.ordem`).bind(d.id).all()).results;
      }
      lead.events = (await db.prepare('SELECT * FROM events WHERE lead_id = ? ORDER BY criado_em DESC LIMIT 200').bind(id).all()).results;
      lead.cliente = !!(await db.prepare('SELECT 1 FROM purchases WHERE lead_id = ? LIMIT 1').bind(id).first());
      return lead;
    };
    // Lead pelo telefone (link direto a partir de uma conversa do WhatsApp):
    // normaliza como o ingest (só dígitos, sem zero à esquerda), tenta igual e
    // depois pelos 8 dígitos finais (com ou sem o 9, com ou sem DDD).
    if ((mm = p.match(/^\/api\/leads\/por-telefone\/([^/]+)$/)) && m === 'GET') {
      const tn = normPhone(decodeURIComponent(mm[1]));
      if (!tn || tn.length < 8) return err(400, 'telefone invalido');
      let l = await db.prepare('SELECT id FROM leads WHERE workspace_id = ? AND telefone_norm = ? ORDER BY atualizado_em DESC LIMIT 1').bind(ws, tn).first();
      if (!l) l = await db.prepare('SELECT id FROM leads WHERE workspace_id = ? AND substr(telefone_norm, -8) = ? ORDER BY atualizado_em DESC LIMIT 1').bind(ws, tn.slice(-8)).first();
      if (!l) return err(404, 'nenhum lead com esse telefone');
      return json(await detalheLead(l.id));
    }
    if ((mm = p.match(/^\/api\/leads\/(\d+)$/))) {
      const id = Number(mm[1]);
      if (m === 'GET') {
        const lead = await detalheLead(id);
        if (!lead) return err(404, 'lead nao encontrado');
        return json(lead);
      }
      if (m === 'PATCH') {
        const b = await body(req);
        const email = b.email == null ? null : String(b.email).trim().toLowerCase() || null;
        // E-mail é único por workspace: em vez de estourar 500 no índice, 409 com
        // o id do lead que já usa o e-mail (o app decide se mescla ou desiste).
        if (email) {
          const dono = await db.prepare('SELECT id FROM leads WHERE workspace_id = ? AND lower(email) = ? AND id <> ?').bind(ws, email, id).first();
          if (dono) return err(409, `e-mail ja e do lead ${dono.id}`);
        }
        await db.prepare('UPDATE leads SET nome=COALESCE(?,nome), email=COALESCE(?,email), telefone=COALESCE(?,telefone), telefone_norm=COALESCE(?,telefone_norm), origem=COALESCE(?,origem), origem_original=COALESCE(?,origem_original), atualizado_em=datetime(\'now\') WHERE id=?')
          .bind(b.nome ?? null, email, b.telefone ?? null, b.telefone ? normPhone(b.telefone) : null,
            b.origem ? normalizaOrigem(b.origem) : null, b.origem ?? null, id).run();
        return json({ ok: true });
      }
      if (m === 'DELETE') { requireAdmin(); await db.prepare('DELETE FROM leads WHERE id = ?').bind(id).run(); return json({ ok: true }); }
    }
    if ((mm = p.match(/^\/api\/leads\/(\d+)\/tags$/)) && m === 'POST') {
      const id = Number(mm[1]); const b = await body(req);
      let tagId = b.tag_id;
      if (!tagId && b.nome) {
        await db.prepare('INSERT OR IGNORE INTO tags (workspace_id, nome) VALUES (?,?)').bind(ws, b.nome).run();
        tagId = (await db.prepare('SELECT id FROM tags WHERE workspace_id = ? AND nome = ?').bind(ws, b.nome).first()).id;
      }
      await db.prepare('INSERT OR IGNORE INTO lead_tags (lead_id, tag_id) VALUES (?,?)').bind(id, tagId).run();
      return json({ ok: true });
    }
    if ((mm = p.match(/^\/api\/leads\/(\d+)\/tags\/(\d+)$/)) && m === 'DELETE') {
      await db.prepare('DELETE FROM lead_tags WHERE lead_id = ? AND tag_id = ?').bind(Number(mm[1]), Number(mm[2])).run();
      return json({ ok: true });
    }
    if ((mm = p.match(/^\/api\/leads\/(\d+)\/events$/)) && m === 'GET') {
      const rows = (await db.prepare('SELECT * FROM events WHERE lead_id = ? ORDER BY criado_em DESC LIMIT 200').bind(Number(mm[1])).all()).results;
      return json(rows);
    }

    // produtos comprados pelo lead
    if ((mm = p.match(/^\/api\/leads\/(\d+)\/purchases$/)) && m === 'GET') {
      return json((await db.prepare('SELECT * FROM purchases WHERE lead_id = ? ORDER BY data DESC').bind(Number(mm[1])).all()).results);
    }
    // compra manual: registra uma compra avulsa no lead (origem='manual').
    if ((mm = p.match(/^\/api\/leads\/(\d+)\/purchases$/)) && m === 'POST') {
      const lid = Number(mm[1]);
      const b = await body(req);
      const produto = (b.produto || '').trim();
      const valor = Number(b.valor);
      if (!produto) return err(400, 'produto obrigatorio');
      if (!(valor > 0)) return err(400, 'valor deve ser maior que zero');
      const lead = await db.prepare('SELECT workspace_id FROM leads WHERE id = ?').bind(lid).first();
      if (!lead) return err(404, 'lead nao encontrado');
      const data = (b.data || '').trim() || new Date().toISOString().slice(0, 10);
      const ref = `manual-${Date.now()}-${lid}`;
      const r = await db.prepare('INSERT INTO purchases (workspace_id, lead_id, produto, valor, data, origem, ref_externa) VALUES (?,?,?,?,?,?,?)')
        .bind(lead.workspace_id, lid, produto, valor, data, 'manual', ref).run();
      return json({ id: r.meta.last_row_id }, 201);
    }

    if (p === '/api/leads/origens' && m === 'GET') {
      const rows = (await db.prepare('SELECT DISTINCT origem FROM leads WHERE workspace_id = ? AND origem IS NOT NULL AND origem <> \'\' ORDER BY origem').bind(ws).all()).results;
      return json(rows.map(r => r.origem));
    }

    // ---------- tags ----------
    if (p === '/api/tags' && m === 'GET') {
      // Contagem de leads por tag (uma query) e flag de tag de sistema (aplicada
      // sozinha pela entrada de leads). O count é barato via LEFT JOIN.
      const rows = (await db.prepare(
        `SELECT t.*, COUNT(lt.lead_id) leads FROM tags t
         LEFT JOIN lead_tags lt ON lt.tag_id = t.id
         WHERE t.workspace_id = ? GROUP BY t.id ORDER BY t.nome`).bind(ws).all()).results;
      for (const t of rows) t.sistema = tagSistema(t.nome) ? 1 : 0;
      return json(rows);
    }
    if (p === '/api/tags' && m === 'POST') {
      const b = await body(req);
      await db.prepare('INSERT OR IGNORE INTO tags (workspace_id, nome) VALUES (?,?)').bind(ws, b.nome).run();
      const t = await db.prepare('SELECT * FROM tags WHERE workspace_id = ? AND nome = ?').bind(ws, b.nome).first();
      return json(t, 201);
    }
    // Mesclar tags explicitamente: move os vinculos de varias origens para um
    // destino e apaga as origens. { origem_ids: [..], destino_id } (admin).
    if (p === '/api/tags/merge' && m === 'POST') {
      requireAdmin();
      const b = await body(req);
      const destinoId = Number(b.destino_id);
      const origemIds = (Array.isArray(b.origem_ids) ? b.origem_ids : []).map(Number).filter((x) => x && x !== destinoId);
      if (!destinoId || !origemIds.length) return err(400, 'destino_id e origem_ids obrigatorios');
      const dst = await db.prepare('SELECT * FROM tags WHERE id = ? AND workspace_id = ?').bind(destinoId, ws).first();
      if (!dst) return err(404, 'tag de destino nao encontrada');
      for (const oid of origemIds) {
        const src = await db.prepare('SELECT * FROM tags WHERE id = ? AND workspace_id = ?').bind(oid, ws).first();
        if (!src) continue;
        await db.prepare('INSERT OR IGNORE INTO lead_tags (lead_id, tag_id) SELECT lead_id, ? FROM lead_tags WHERE tag_id = ?').bind(destinoId, oid).run();
        await db.prepare('DELETE FROM lead_tags WHERE tag_id = ?').bind(oid).run();
        await db.prepare('DELETE FROM tags WHERE id = ?').bind(oid).run();
        await logEvent(db, ws, null, null, 'tag_editada', user.id, { acao: 'mesclar', de: src.nome, para: dst.nome });
      }
      return json({ ok: true });
    }
    if ((mm = p.match(/^\/api\/tags\/(\d+)$/))) {
      requireAdmin();
      const id = Number(mm[1]);
      const tag = await db.prepare('SELECT * FROM tags WHERE id = ? AND workspace_id = ?').bind(id, ws).first();
      if (!tag) return err(404, 'tag nao encontrada');
      // Renomear. Se o novo nome ja existir (outra tag), MESCLA: move os vinculos
      // para a existente (OR IGNORE) e apaga esta. Renomear/apagar tag de sistema
      // exige confirmar=1 (o front avisa que automacoes dependem dela).
      if (m === 'PATCH') {
        const b = await body(req);
        const novo = (b.nome || '').trim();
        if (!novo) return err(400, 'nome obrigatorio');
        if (novo === tag.nome) return json({ ok: true });
        if (tagSistema(tag.nome) && !b.confirmar) return err(409, 'tag de sistema: automacoes dependem dela, confirme para prosseguir');
        const existente = await db.prepare('SELECT id FROM tags WHERE workspace_id = ? AND nome = ?').bind(ws, novo).first();
        if (existente) {
          await db.prepare('INSERT OR IGNORE INTO lead_tags (lead_id, tag_id) SELECT lead_id, ? FROM lead_tags WHERE tag_id = ?').bind(existente.id, id).run();
          await db.prepare('DELETE FROM lead_tags WHERE tag_id = ?').bind(id).run();
          await db.prepare('DELETE FROM tags WHERE id = ?').bind(id).run();
          await logEvent(db, ws, null, null, 'tag_editada', user.id, { acao: 'mesclar_por_rename', de: tag.nome, para: novo });
          return json({ ok: true, mesclada: true });
        }
        await db.prepare('UPDATE tags SET nome = ? WHERE id = ?').bind(novo, id).run();
        await logEvent(db, ws, null, null, 'tag_editada', user.id, { acao: 'renomear', de: tag.nome, para: novo });
        return json({ ok: true });
      }
      if (m === 'DELETE') {
        const b = await body(req);
        if (tagSistema(tag.nome) && !b.confirmar) return err(409, 'tag de sistema: automacoes dependem dela, confirme para prosseguir');
        await db.prepare('DELETE FROM lead_tags WHERE tag_id = ?').bind(id).run();
        await db.prepare('DELETE FROM tags WHERE id = ?').bind(id).run();
        await logEvent(db, ws, null, null, 'tag_editada', user.id, { acao: 'excluir', nome: tag.nome });
        return json({ ok: true });
      }
    }

    // ---------- deals ----------
    if (p === '/api/deals' && m === 'POST') {
      const b = await body(req);
      if (!b.pipeline_id || !b.stage_id) return err(400, 'pipeline_id e stage_id obrigatorios');
      await guardPipe(b.pipeline_id);
      const r = await db.prepare(
        'INSERT INTO deals (workspace_id, lead_id, pipeline_id, stage_id, titulo, valor, qualificacao, dono_id, stage_entered_at) VALUES (?,?,?,?,?,?,?,?,datetime(\'now\'))')
        .bind(ws, b.lead_id || null, b.pipeline_id, b.stage_id, b.titulo || null, b.valor || 0, b.qualificacao || 'Frio', b.dono_id || user.id).run();
      const id = r.meta.last_row_id;
      await logEvent(db, ws, id, b.lead_id, 'deal_criada', user.id, { stage_id: b.stage_id });
      return json({ id }, 201);
    }
    if ((mm = p.match(/^\/api\/deals\/(\d+)$/))) {
      const id = Number(mm[1]);
      if (m === 'GET') {
        const d = await db.prepare('SELECT * FROM deals WHERE id = ?').bind(id).first();
        if (!d) return err(404, 'deal nao encontrada');
        await guardPipe(d.pipeline_id);
        d.lead = d.lead_id ? await db.prepare('SELECT * FROM leads WHERE id = ?').bind(d.lead_id).first() : null;
        if (d.lead) {
          // Proveniencia: tags do lead (a LP-N vem daqui) e o payload do
          // lead_ingerido (origem/campanha/funil) para o bloco "Origem".
          d.lead.tags = (await db.prepare('SELECT t.* FROM tags t JOIN lead_tags lt ON lt.tag_id = t.id WHERE lt.lead_id = ?').bind(d.lead_id).all()).results;
          const ing = await db.prepare('SELECT payload FROM events WHERE lead_id = ? AND tipo = \'lead_ingerido\' ORDER BY criado_em ASC LIMIT 1').bind(d.lead_id).first();
          try { d.lead.ingest = ing && ing.payload ? JSON.parse(ing.payload) : null; } catch { d.lead.ingest = null; }
        }
        const defs = (await db.prepare('SELECT * FROM deal_field_defs WHERE pipeline_id = ? ORDER BY ordem').bind(d.pipeline_id).all()).results;
        const vals = (await db.prepare('SELECT * FROM deal_field_values WHERE deal_id = ?').bind(id).all()).results;
        d.fields = defs.map(def => ({ ...def, opcoes: def.opcoes ? JSON.parse(def.opcoes) : null, valor: (vals.find(v => v.field_def_id === def.id) || {}).valor ?? null }));
        // Timeline da deal = eventos da propria deal + eventos do lead (lead_ingerido
        // etc., que tem deal_id nulo), unidos e ordenados por data. Assim a origem do
        // lead aparece no historico da negociacao.
        d.events = (await db.prepare('SELECT * FROM events WHERE deal_id = ?1 OR (deal_id IS NULL AND lead_id = ?2) ORDER BY criado_em DESC LIMIT 200').bind(id, d.lead_id).all()).results;
        d.tasks = (await db.prepare('SELECT * FROM tasks WHERE deal_id = ? ORDER BY due_at').bind(id).all()).results;
        d.notes = (await db.prepare('SELECT * FROM notes WHERE deal_id = ? ORDER BY criado_em DESC').bind(id).all()).results;
        return json(d);
      }
      if (m === 'PATCH') {
        await guardDeal(id);
        const b = await body(req);
        // Mudança manual da qualificação grava marca de override: o cron não a sobrescreve.
        const manualAt = (b.qualificacao != null && b.qualificacao !== '') ? "datetime('now')" : 'qualificacao_manual_at';
        await db.prepare(`UPDATE deals SET titulo=COALESCE(?,titulo), valor=COALESCE(?,valor), qualificacao=COALESCE(?,qualificacao), dono_id=COALESCE(?,dono_id), qualificacao_manual_at=${manualAt}, atualizado_em=datetime('now') WHERE id=?`)
          .bind(b.titulo ?? null, b.valor ?? null, b.qualificacao ?? null, b.dono_id ?? null, id).run();
        // campos customizados: { fields: { field_def_id: valor } }
        if (b.fields) for (const [fid, valor] of Object.entries(b.fields)) {
          await db.prepare('INSERT INTO deal_field_values (deal_id, field_def_id, valor) VALUES (?,?,?) ON CONFLICT(deal_id, field_def_id) DO UPDATE SET valor=excluded.valor')
            .bind(id, Number(fid), valor == null ? null : String(valor)).run();
        }
        // Escolheu o pacote e a negociação ainda está sem valor: o valor vem do
        // preço do pacote. Valor digitado pela equipe nunca é sobrescrito.
        if (b.fields && b.valor == null) await valorDoPacote(db, id);
        return json({ ok: true });
      }
      if (m === 'DELETE') {
        // Apagar UMA negociação: admin e operador podem, respeitando o
        // funil restrito. O "Apagar" em lote do Quadro segue só admin na UI, e o
        // backend reforça: operador precisa de 3 s entre um apagamento e outro,
        // o que barra o laço rápido do lote sem atrapalhar o uso manual.
        await guardDeal(id);
        const d = await db.prepare('SELECT id, lead_id, titulo, pipeline_id FROM deals WHERE id = ?').bind(id).first();
        if (!d) return err(404, 'negociacao nao encontrada');
        if (!isAdmin) {
          const rec = await db.prepare("SELECT 1 FROM events WHERE tipo = 'deal_apagada' AND autor_id = ? AND criado_em > datetime('now', '-3 seconds') LIMIT 1").bind(user.id).first();
          if (rec) return err(429, 'apague uma negociacao de cada vez');
        }
        // Vai para a lixeira (snapshot JSON, 30 dias); a deal some das tabelas vivas.
        const lix = await mandaParaLixeira(db, id, user.id);
        // events.deal_id tem ON DELETE CASCADE: o registro vai no lead (deal_id nulo)
        // para sobreviver e aparecer na linha do tempo do lead.
        await logEvent(db, ws, null, d.lead_id, 'deal_apagada', user.id, { deal_id: id, titulo: d.titulo, pipeline_id: d.pipeline_id, lixeira_id: lix.lixeiraId });
        return json({ ok: true, lixeira_id: lix.lixeiraId });
      }
    }
    // Feed geral de eventos por cursor (integrações): tudo que aconteceu no
    // CRM em ordem de id. Operador não vê eventos de deal em funil restrito.
    // ?apos_id=<último id visto>&limit=&tipo=deal_movida,nota (opcional).
    if (p === '/api/events' && m === 'GET') {
      const aposId = Number(url.searchParams.get('apos_id') || 0);
      const limit = Math.min(Number(url.searchParams.get('limit') || 100), 500);
      const tipos = (url.searchParams.get('tipo') || '').split(',').map((t) => t.trim()).filter(Boolean);
      const wh = ['e.workspace_id = ?', 'e.id > ?']; const args = [ws, aposId];
      if (tipos.length) { wh.push(`e.tipo IN (${tipos.map(() => '?').join(',')})`); args.push(...tipos); }
      if (!isAdmin) wh.push('(pi.id IS NULL OR pi.restrito_admin = 0)');
      const rows = (await db.prepare(
        `SELECT e.id, e.tipo, e.criado_em, e.deal_id, d.titulo deal_titulo, d.pipeline_id, e.lead_id, l.nome lead_nome, e.autor_id, u.nome autor_nome, e.payload
           FROM events e LEFT JOIN deals d ON d.id = e.deal_id LEFT JOIN pipelines pi ON pi.id = d.pipeline_id
           LEFT JOIN leads l ON l.id = e.lead_id LEFT JOIN users u ON u.id = e.autor_id
          WHERE ${wh.join(' AND ')} ORDER BY e.id ASC LIMIT ?`).bind(...args, limit).all()).results;
      const itens = rows.map((r) => { let pl = null; try { pl = r.payload ? JSON.parse(r.payload) : null; } catch { pl = null; } return { ...r, payload: pl }; });
      return json({ itens, proximo_apos_id: itens.length ? itens[itens.length - 1].id : aposId });
    }
    // Lixeira: o que foi apagado nos últimos 30 dias, com quem apagou. Operador
    // não vê o que veio de funil restrito.
    if (p === '/api/lixeira' && m === 'GET') {
      const restr = isAdmin ? '' : ' AND (pi.restrito_admin IS NULL OR pi.restrito_admin = 0)';
      const rows = (await db.prepare(`SELECT l.id, l.deal_id, l.lead_id, l.pipeline_id, l.titulo, l.valor, l.estado, l.lead_nome, l.pipeline_nome, l.stage_nome, l.apagada_em, u.nome apagada_por_nome,
          ${LIXEIRA_DIAS} - CAST(julianday('now') - julianday(l.apagada_em) AS INTEGER) dias_restantes
        FROM lixeira l LEFT JOIN pipelines pi ON pi.id = l.pipeline_id LEFT JOIN users u ON u.id = l.apagada_por
        WHERE l.workspace_id = ?${restr} ORDER BY l.apagada_em DESC`).bind(ws).all()).results;
      return json(rows);
    }
    if ((mm = p.match(/^\/api\/lixeira\/(\d+)\/restaurar$/)) && m === 'POST') {
      const row = await db.prepare('SELECT * FROM lixeira WHERE id = ? AND workspace_id = ?').bind(Number(mm[1]), ws).first();
      if (!row) return err(404, 'nao esta na lixeira');
      await guardPipe(row.pipeline_id);
      let r;
      try { r = await restauraDaLixeira(db, row); } catch (e) { if (e && e._400) return err(400, e._400); throw e; }
      await logEvent(db, ws, r.id, r.deal.lead_id, 'deal_restaurada', user.id, { titulo: r.deal.titulo, lixeira_id: row.id, id_original: row.deal_id });
      return json({ ok: true, id: r.id });
    }
    if ((mm = p.match(/^\/api\/deals\/(\d+)\/move$/)) && m === 'POST') {
      const id = Number(mm[1]); const b = await body(req);
      const d = await db.prepare('SELECT * FROM deals WHERE id = ?').bind(id).first();
      if (!d) return err(404, 'deal nao encontrada');
      await guardPipe(d.pipeline_id);
      // Mudar de funil: pipeline_id sem stage_id = primeira etapa do funil destino.
      if (!b.stage_id && b.pipeline_id) {
        const s1 = await db.prepare('SELECT id FROM stages WHERE pipeline_id = ? ORDER BY ordem LIMIT 1').bind(Number(b.pipeline_id)).first();
        if (!s1) return err(400, 'funil sem etapas');
        b.stage_id = s1.id;
      }
      if (!b.stage_id) return err(400, 'stage_id obrigatorio');
      // A etapa destino manda no pipeline_id da deal (etapa de outro funil = troca de funil).
      const alvoSt = await db.prepare('SELECT pipeline_id, is_won, is_lost FROM stages WHERE id = ?').bind(b.stage_id).first();
      if (!alvoSt) return err(400, 'etapa inexistente');
      const trocaFunil = alvoSt.pipeline_id !== d.pipeline_id;
      if (trocaFunil) await guardPipe(alvoSt.pipeline_id);
      await db.prepare('UPDATE deals SET pipeline_id=?, stage_id=?, stage_entered_at=datetime(\'now\'), atualizado_em=datetime(\'now\') WHERE id=?').bind(alvoSt.pipeline_id, b.stage_id, id).run();
      await logEvent(db, d.workspace_id, id, d.lead_id, 'deal_movida', user.id, { de: d.stage_id, para: b.stage_id });
      // O estado acompanha a etapa: etapa de ganho ("Reservado (sinal pago)",
      // "Festa realizada") = vendida, etapa de perda ("Perdido") = perdida, e
      // voltar para uma etapa comum reabre a negociação.
      const novoEstado = alvoSt.is_won ? 'vendida' : alvoSt.is_lost ? 'perdida' : 'andamento';
      if (novoEstado !== d.estado) {
        const motivo = novoEstado === 'perdida' ? (String(b.motivo || '').trim() || 'Sem motivo informado') : null;
        await db.prepare(`UPDATE deals SET estado = ?, motivo_perda = ?, fechado_em = ${novoEstado === 'andamento' ? 'NULL' : "datetime('now')"}, atualizado_em = datetime('now') WHERE id = ?`)
          .bind(novoEstado, motivo, id).run();
        const tipoEv = { vendida: 'deal_vendida', perdida: 'deal_perdida', andamento: 'deal_reaberta' }[novoEstado];
        await logEvent(db, d.workspace_id, id, d.lead_id, tipoEv, user.id, novoEstado === 'vendida' ? { valor: d.valor } : novoEstado === 'perdida' ? { motivo } : { de_estado: d.estado });
      }
      // Esquenta: avanço de etapa (para frente) sobe +1; se ficou <48h na etapa anterior, mínimo 4.
      // Só dentro do mesmo funil: comparar ordem entre funis diferentes não faz sentido.
      if (d.estado === 'andamento' && !trocaFunil) {
        const de = await db.prepare('SELECT ordem FROM stages WHERE id=?').bind(d.stage_id).first();
        const para = await db.prepare('SELECT ordem FROM stages WHERE id=?').bind(b.stage_id).first();
        if (de && para && para.ordem > de.ordem) {
          const horas = (Date.now() - Date.parse((d.stage_entered_at || d.criado_em) + 'Z')) / 3600000;
          let nivel = nivelDeLabel(d.qualificacao) + 1;
          if (horas < ETAPA_RAPIDA_H) nivel = Math.max(nivel, ETAPA_RAPIDA_MIN);
          const alvo = labelDeNivel(nivel);
          if (alvo !== d.qualificacao) {
            await db.prepare('UPDATE deals SET qualificacao=?, qualificacao_manual_at=NULL, atualizado_em=datetime(\'now\') WHERE id=?').bind(alvo, id).run();
            await logEvent(db, d.workspace_id, id, d.lead_id, 'qualificacao_auto', null, { regra: 'avanco_etapa', motivo: `Avanço de etapa: de ${d.qualificacao} para ${alvo}` });
          }
        }
      }
      return json({ ok: true });
    }
    if ((mm = p.match(/^\/api\/deals\/(\d+)\/won$/)) && m === 'POST') {
      const id = Number(mm[1]); const b = await body(req);
      const d = await db.prepare('SELECT * FROM deals WHERE id = ?').bind(id).first();
      if (!d) return err(404, 'deal nao encontrada');
      await guardPipe(d.pipeline_id);
      const wonStage = await db.prepare('SELECT id FROM stages WHERE pipeline_id = ? AND is_won = 1 ORDER BY ordem LIMIT 1').bind(d.pipeline_id).first();
      const stageId = wonStage ? wonStage.id : d.stage_id;
      await db.prepare('UPDATE deals SET estado=?, stage_id=?, valor=COALESCE(?,valor), fechado_em=datetime(\'now\'), atualizado_em=datetime(\'now\') WHERE id=?')
        .bind('vendida', stageId, b.valor ?? null, id).run();
      await logEvent(db, d.workspace_id, id, d.lead_id, 'deal_vendida', user.id, { valor: b.valor ?? d.valor });
      return json({ ok: true });
    }
    if ((mm = p.match(/^\/api\/deals\/(\d+)\/lost$/)) && m === 'POST') {
      const id = Number(mm[1]); const b = await body(req);
      const motivo = (b.motivo || '').trim();
      if (!motivo) return err(400, 'motivo de perda obrigatorio');
      const d = await db.prepare('SELECT * FROM deals WHERE id = ?').bind(id).first();
      if (!d) return err(404, 'deal nao encontrada');
      await guardPipe(d.pipeline_id);
      // Funil com etapa de perda (is_lost, ex.: "Perdido"): a negociação vai para ela.
      const lostStage = await db.prepare('SELECT id FROM stages WHERE pipeline_id = ? AND is_lost = 1 ORDER BY ordem LIMIT 1').bind(d.pipeline_id).first();
      await db.prepare('UPDATE deals SET estado=?, motivo_perda=?, stage_id=?, fechado_em=datetime(\'now\'), atualizado_em=datetime(\'now\') WHERE id=?')
        .bind('perdida', motivo, lostStage ? lostStage.id : d.stage_id, id).run();
      await logEvent(db, d.workspace_id, id, d.lead_id, 'deal_perdida', user.id, { motivo });
      return json({ ok: true });
    }
    // Motivos de perda ja usados (popula o select do modal). DISTINCT sobre as
    // deals: e a lista viva, sem tabela extra; motivo novo aparece assim que a
    // primeira deal o usa. ponytail: sem tabela de motivos, DISTINCT ja lista.
    if (p === '/api/loss-reasons' && m === 'GET') {
      const rows = (await db.prepare(
        'SELECT DISTINCT motivo_perda FROM deals WHERE workspace_id = ? AND motivo_perda IS NOT NULL AND motivo_perda <> \'\' ORDER BY motivo_perda'
      ).bind(ws).all()).results;
      return json(rows.map((r) => r.motivo_perda));
    }
    if ((mm = p.match(/^\/api\/deals\/(\d+)\/whatsapp$/)) && m === 'POST') {
      const id = Number(mm[1]); const b = await body(req);
      const d = await db.prepare('SELECT * FROM deals WHERE id = ?').bind(id).first();
      if (!d) return err(404, 'deal nao encontrada');
      await guardPipe(d.pipeline_id);
      const on = b.on ? 1 : 0;
      await db.prepare('UPDATE deals SET respondendo_whatsapp=?, atualizado_em=datetime(\'now\') WHERE id=?').bind(on, id).run();
      await logEvent(db, d.workspace_id, id, d.lead_id, 'whatsapp_flag', user.id, { on: !!on });
      // Esquenta: WhatsApp respondendo sobe para no mínimo nível 4 e limpa override manual.
      if (on && d.estado === 'andamento' && nivelDeLabel(d.qualificacao) < WHATSAPP_MIN) {
        const alvo = labelDeNivel(WHATSAPP_MIN);
        await db.prepare('UPDATE deals SET qualificacao=?, qualificacao_manual_at=NULL, atualizado_em=datetime(\'now\') WHERE id=?').bind(alvo, id).run();
        await logEvent(db, d.workspace_id, id, d.lead_id, 'qualificacao_auto', null, { regra: 'whatsapp', motivo: `Respondendo no WhatsApp: de ${d.qualificacao} para ${alvo}` });
      }
      return json({ ok: true });
    }
    if ((mm = p.match(/^\/api\/deals\/(\d+)\/events$/)) && m === 'GET') {
      await guardDeal(Number(mm[1]));
      return json((await db.prepare('SELECT * FROM events WHERE deal_id = ? ORDER BY criado_em DESC LIMIT 200').bind(Number(mm[1])).all()).results);
    }

    // ---------- tasks ----------
    if (p === '/api/tasks' && m === 'GET') {
      const deal = url.searchParams.get('deal'); const lead = url.searchParams.get('lead');
      if (deal) await guardDeal(Number(deal));
      let sql = 'SELECT * FROM tasks WHERE workspace_id = ?'; const args = [ws];
      if (deal) { sql += ' AND deal_id = ?'; args.push(Number(deal)); }
      if (lead) { sql += ' AND lead_id = ?'; args.push(Number(lead)); }
      sql += ' ORDER BY feito, due_at';
      return json((await db.prepare(sql).bind(...args).all()).results);
    }
    // Lista geral da aba Tarefas: junta negociacao, lead e funil, com filtros.
    // Operador NAO ve tarefa de funil restrito (mesmo gate do board; sem isso a
    // aba vazaria o nome do lead e o titulo da tarefa desses funis).
    if (p === '/api/tasks/lista' && m === 'GET') {
      const q = (s) => url.searchParams.get(s) || '';
      const where = ['t.workspace_id = ?']; const args = [ws];
      if (!isAdmin) where.push('(p.id IS NULL OR p.restrito_admin = 0)');
      const st = q('status') || 'abertas';
      if (st === 'abertas') where.push('t.feito = 0');
      else if (st === 'feitas') where.push('t.feito = 1');
      else if (st === 'atrasadas') where.push("t.feito = 0 AND t.due_at IS NOT NULL AND t.due_at < datetime('now')");
      else if (st === 'hoje') where.push("t.feito = 0 AND date(t.due_at) = date('now','-3 hours')");
      else if (st === 'semana') where.push("t.feito = 0 AND t.due_at IS NOT NULL AND date(t.due_at) <= date('now','-3 hours','+7 days')");
      else if (st === 'sem_prazo') where.push('t.feito = 0 AND t.due_at IS NULL');
      // Período pelo prazo (datas YYYY-MM-DD no fuso de SP): "de" e/ou "até".
      // due_at é gravado em UTC, por isso o -3 hours antes de pegar a data.
      const DATA = /^\d{4}-\d{2}-\d{2}$/;
      if (DATA.test(q('de'))) { where.push("date(t.due_at, '-3 hours') >= ?"); args.push(q('de')); }
      if (DATA.test(q('ate'))) { where.push("date(t.due_at, '-3 hours') <= ?"); args.push(q('ate')); }
      if (q('funil')) { where.push('p.id = ?'); args.push(Number(q('funil'))); }
      if (q('responsavel')) { where.push('t.criado_por = ?'); args.push(Number(q('responsavel'))); }
      if (q('busca')) {
        where.push('(lower(t.titulo) LIKE ? OR lower(l.nome) LIKE ? OR lower(d.titulo) LIKE ?)');
        const b = '%' + q('busca').toLowerCase() + '%'; args.push(b, b, b);
      }
      // sem prazo por ultimo em qualquer ordenacao por data
      const ORD = { prazo: '(t.due_at IS NULL), t.due_at ASC', prazo_desc: '(t.due_at IS NULL), t.due_at DESC', criada: 't.criado_em DESC' };
      const orderBy = ORD[q('sort')] || ORD.prazo;
      const rows = (await db.prepare(
        `SELECT t.id, t.titulo, t.descricao, t.due_at, t.feito, t.criado_em, t.deal_id, t.lead_id,
                COALESCE(l.nome, l2.nome) lead_nome, COALESCE(l.telefone, l2.telefone) lead_telefone,
                d.titulo deal_titulo, p.nome funil, s.nome etapa, u.nome criador,
                (t.feito = 0 AND t.due_at IS NOT NULL AND t.due_at < datetime('now')) atrasada
           FROM tasks t
           LEFT JOIN deals d ON d.id = t.deal_id
           LEFT JOIN pipelines p ON p.id = d.pipeline_id
           LEFT JOIN stages s ON s.id = d.stage_id
           LEFT JOIN leads l ON l.id = d.lead_id
           LEFT JOIN leads l2 ON l2.id = t.lead_id
           LEFT JOIN users u ON u.id = t.criado_por
          WHERE ${where.join(' AND ')}
          ORDER BY ${orderBy} LIMIT 500`).bind(...args).all()).results;
      return json(rows);
    }
    // titulos de tarefa mais usados no workspace (para sugestao rapida no + do kanban)
    if (p === '/api/tasks/titulos-frequentes' && m === 'GET') {
      const rows = (await db.prepare(
        `SELECT titulo, COUNT(*) n FROM tasks WHERE workspace_id = ? AND titulo IS NOT NULL AND titulo != ''
         GROUP BY titulo ORDER BY n DESC LIMIT 6`).bind(ws).all()).results;
      return json(rows.map((r) => r.titulo));
    }
    if (p === '/api/tasks' && m === 'POST') {
      const b = await body(req);
      await guardDeal(b.deal_id);
      const r = await db.prepare('INSERT INTO tasks (workspace_id, deal_id, lead_id, titulo, descricao, due_at, criado_por) VALUES (?,?,?,?,?,?,?)')
        .bind(ws, b.deal_id || null, b.lead_id || null, b.titulo, b.descricao || null, b.due_at || null, user.id).run();
      await logEvent(db, ws, b.deal_id || null, b.lead_id || null, 'tarefa_criada', user.id, { titulo: b.titulo });
      return json({ id: r.meta.last_row_id }, 201);
    }
    if ((mm = p.match(/^\/api\/tasks\/(\d+)$/)) && m === 'PATCH') {
      const id = Number(mm[1]); const b = await body(req);
      const tk = await db.prepare('SELECT deal_id FROM tasks WHERE id = ?').bind(id).first();
      if (tk) await guardDeal(tk.deal_id);
      await db.prepare('UPDATE tasks SET titulo=COALESCE(?,titulo), descricao=COALESCE(?,descricao), due_at=COALESCE(?,due_at), feito=COALESCE(?,feito) WHERE id=?')
        .bind(b.titulo ?? null, b.descricao ?? null, b.due_at ?? null, b.feito == null ? null : (b.feito ? 1 : 0), id).run();
      return json({ ok: true });
    }

    // ---------- notes ----------
    if (p === '/api/notes' && m === 'POST') {
      const b = await body(req);
      if (!b.corpo) return err(400, 'corpo obrigatorio');
      await guardDeal(b.deal_id);
      const r = await db.prepare('INSERT INTO notes (workspace_id, deal_id, lead_id, corpo, autor_id) VALUES (?,?,?,?,?)')
        .bind(ws, b.deal_id || null, b.lead_id || null, b.corpo, user.id).run();
      await logEvent(db, ws, b.deal_id || null, b.lead_id || null, 'nota', user.id, { note_id: r.meta.last_row_id });
      return json({ id: r.meta.last_row_id }, 201);
    }

    // ---------- export (admin) ----------
    if (p === '/api/export/leads' && m === 'GET') {
      const rows = (await db.prepare('SELECT id, nome, email, telefone, origem, criado_em FROM leads WHERE workspace_id = ?').bind(ws).all()).results;
      return csv(['id', 'nome', 'email', 'telefone', 'origem', 'criado_em'], rows, 'leads.csv');
    }
    if (p === '/api/export/deals' && m === 'GET') {
      const rows = (await db.prepare('SELECT d.id, l.nome lead, pi.nome funil, s.nome etapa, d.valor, d.estado, d.qualificacao, d.criado_em FROM deals d LEFT JOIN leads l ON l.id=d.lead_id JOIN pipelines pi ON pi.id=d.pipeline_id JOIN stages s ON s.id=d.stage_id WHERE d.workspace_id = ?').bind(ws).all()).results;
      return csv(['id', 'lead', 'funil', 'etapa', 'valor', 'estado', 'qualificacao', 'criado_em'], rows, 'deals.csv');
    }

    // ---------- admin ----------
    if (p === '/api/admin/users' && m === 'GET') {
      return json((await db.prepare('SELECT id, nome, email, papel, ativo, criado_em FROM users ORDER BY id').all()).results);
    }
    // Criar usuario. Senha temporaria gerada e devolvida UMA vez (senha_temp);
    // aceita senha explicita se vier. Papel restrito a admin/operador (CHECK do banco).
    if (p === '/api/admin/users' && m === 'POST') {
      const b = await body(req);
      if (!b.email || !b.papel) return err(400, 'email e papel obrigatorios');
      if (!['admin', 'operador'].includes(b.papel)) return err(400, 'papel invalido');
      const email = String(b.email).toLowerCase().trim();
      const jaExiste = await db.prepare('SELECT id FROM users WHERE email = ?').bind(email).first();
      if (jaExiste) return err(409, 'ja existe usuario com esse e-mail');
      const senhaTemp = b.senha || senhaTemporaria();
      const salt = hex(crypto.getRandomValues(new Uint8Array(16)));
      const h = await hashPassword(senhaTemp, salt);
      const r = await db.prepare('INSERT INTO users (email, nome, senha_hash, senha_salt, papel) VALUES (?,?,?,?,?)')
        .bind(email, b.nome || email, h, salt, b.papel).run();
      await logEvent(db, ws, null, null, 'usuario_criado', user.id, { user_id: r.meta.last_row_id, email, papel: b.papel });
      return json({ id: r.meta.last_row_id, senha_temp: senhaTemp }, 201);
    }
    // Editar papel / ativar-desativar; ou resetar senha (gera temporaria nova).
    if ((mm = p.match(/^\/api\/admin\/users\/(\d+)$/)) && m === 'PATCH') {
      const id = Number(mm[1]); const b = await body(req);
      const alvo = await db.prepare('SELECT * FROM users WHERE id = ?').bind(id).first();
      if (!alvo) return err(404, 'usuario nao encontrado');
      if (b.papel && !['admin', 'operador'].includes(b.papel)) return err(400, 'papel invalido');
      // Trava de auto-bloqueio: nao rebaixar nem desativar a propria conta (evita
      // ficar sem admin ou trancar a si mesmo para fora).
      if (id === user.id) {
        if (b.papel && b.papel !== 'admin') return err(400, 'nao e possivel rebaixar a propria conta');
        if (b.ativo === false || b.ativo === 0) return err(400, 'nao e possivel desativar a propria conta');
      }
      const papel = b.papel ?? alvo.papel;
      const ativo = b.ativo == null ? alvo.ativo : (b.ativo ? 1 : 0);
      await db.prepare('UPDATE users SET papel = ?, ativo = ? WHERE id = ?').bind(papel, ativo, id).run();
      await logEvent(db, ws, null, null, 'usuario_editado', user.id, { user_id: id, papel, ativo });
      return json({ ok: true });
    }
    if ((mm = p.match(/^\/api\/admin\/users\/(\d+)\/reset-senha$/)) && m === 'POST') {
      const id = Number(mm[1]);
      const alvo = await db.prepare('SELECT id, email FROM users WHERE id = ?').bind(id).first();
      if (!alvo) return err(404, 'usuario nao encontrado');
      const senhaTemp = senhaTemporaria();
      const salt = hex(crypto.getRandomValues(new Uint8Array(16)));
      const h = await hashPassword(senhaTemp, salt);
      await db.prepare('UPDATE users SET senha_hash = ?, senha_salt = ? WHERE id = ?').bind(h, salt, id).run();
      await logEvent(db, ws, null, null, 'usuario_senha_reset', user.id, { user_id: id, email: alvo.email });
      return json({ ok: true, senha_temp: senhaTemp });
    }
    if (p === '/api/admin/config' && m === 'GET') {
      const wss = (await db.prepare('SELECT * FROM workspaces WHERE id = ?').bind(ws).all()).results;
      const users = (await db.prepare('SELECT id, nome, email, papel, ativo FROM users ORDER BY id').all()).results;
      return json({ workspaces: wss, users });
    }

    // ---------- segmentos ----------
    if (p === '/api/segments' && m === 'GET') {
      const rows = (await db.prepare('SELECT * FROM segments WHERE workspace_id = ? ORDER BY nome').bind(ws).all()).results;
      for (const s of rows) s.filtros = s.filtros ? JSON.parse(s.filtros) : {};
      return json(rows);
    }
    if (p === '/api/segments' && m === 'POST') {
      requireAdmin();
      const b = await body(req);
      if (!b.nome) return err(400, 'nome obrigatorio');
      const r = await db.prepare('INSERT INTO segments (workspace_id, nome, filtros, criado_por) VALUES (?,?,?,?)')
        .bind(ws, b.nome, JSON.stringify(b.filtros || {}), user.id).run();
      return json({ id: r.meta.last_row_id }, 201);
    }
    if ((mm = p.match(/^\/api\/segments\/(\d+)$/))) {
      const id = Number(mm[1]);
      if (m === 'GET') {
        const s = await db.prepare('SELECT * FROM segments WHERE id = ? AND workspace_id = ?').bind(id, ws).first();
        if (!s) return err(404, 'segmento nao encontrado');
        s.filtros = s.filtros ? JSON.parse(s.filtros) : {};
        return json(s);
      }
      if (m === 'PATCH') {
        requireAdmin();
        const b = await body(req);
        await db.prepare('UPDATE segments SET nome=COALESCE(?,nome), filtros=COALESCE(?,filtros) WHERE id=? AND workspace_id=?')
          .bind(b.nome ?? null, b.filtros ? JSON.stringify(b.filtros) : null, id, ws).run();
        return json({ ok: true });
      }
      if (m === 'DELETE') { requireAdmin(); await db.prepare('DELETE FROM segments WHERE id=? AND workspace_id=?').bind(id, ws).run(); return json({ ok: true }); }
    }
    if ((mm = p.match(/^\/api\/segments\/(\d+)\/leads$/)) && m === 'GET') {
      const s = await db.prepare('SELECT filtros FROM segments WHERE id = ? AND workspace_id = ?').bind(Number(mm[1]), ws).first();
      if (!s) return err(404, 'segmento nao encontrado');
      const filtros = s.filtros ? JSON.parse(s.filtros) : {};
      const { where, args } = segmentoWhere(filtros, ws, isAdmin);
      const limit = Math.min(Number(url.searchParams.get('limit') || 200), 500);
      const offset = Number(url.searchParams.get('offset') || 0);
      const rows = (await db.prepare(`SELECT DISTINCT l.* FROM leads l WHERE ${where} ORDER BY l.nome COLLATE NOCASE LIMIT ? OFFSET ?`).bind(...args, limit, offset).all()).results;
      return json(rows);
    }

    // ---------- relatórios (admin) ----------
    // Tudo agrupado pelo dia-calendario de Sao Paulo: as colunas sao gravadas em
    // UTC, entao todo filtro e todo GROUP BY passa por date(col,'-3 hours').
    // Data da venda/perda = criado_em do evento deal_vendida/deal_perdida (o
    // /won e o /lost sempre gravam o evento), nao o atualizado_em da deal.
    if (p === '/api/relatorios' && m === 'GET') {
      requireAdmin();
      const DIA_MS = 86400000;
      const soData = (ms) => new Date(ms).toISOString().slice(0, 10);
      const emMs = (s) => Date.parse(s + 'T00:00:00Z');
      const hojeSP = soData(Date.now() - 3 * 3600000);
      const dataOk = (v) => (/^\d{4}-\d{2}-\d{2}$/.test(v || '') && !isNaN(emMs(v)) ? v : null);
      const aTe = dataOk(url.searchParams.get('ate')) || hojeSP;
      const dE = dataOk(url.searchParams.get('de')) || (hojeSP.slice(0, 8) + '01');
      // Invertido pelo usuario: ordena em vez de devolver periodo vazio.
      const [de, ate] = emMs(dE) <= emMs(aTe) ? [dE, aTe] : [aTe, dE];
      const dur = Math.round((emMs(ate) - emMs(de)) / DIA_MS) + 1;
      const antAte = soData(emMs(de) - DIA_MS);
      const antDe = soData(emMs(antAte) - (dur - 1) * DIA_MS);

      // Filtros opcionais de recorte (funil e origem). Valem para os DOIS
      // periodos, entao a comparacao continua sendo mesma coisa contra mesma
      // coisa. O funil e validado contra o workspace: id de outro workspace (ou
      // lixo) vira 400 em vez de recorte vazio silencioso.
      const funilQ = url.searchParams.get('funil');
      let fFunil = null;
      if (funilQ !== null && funilQ !== '') {
        if (!/^\d+$/.test(funilQ)) return err(400, 'funil invalido');
        const pi = await db.prepare('SELECT id FROM pipelines WHERE id = ? AND workspace_id = ?').bind(Number(funilQ), ws).first();
        if (!pi) return err(404, 'funil nao encontrado');
        fFunil = pi.id;
      }
      const origemQ = url.searchParams.get('origem');
      const fOrigem = origemQ ? String(origemQ).trim() : null;

      // Os fragmentos entram sempre no FIM do WHERE, entao os binds deles vao
      // sempre no fim da lista de argumentos de cada query.
      // Origem numa query de deals sai por subconsulta correlacionada em vez de
      // JOIN: assim o mesmo fragmento serve para query com e sem join de leads,
      // sem ter que reescrever o FROM de cada uma.
      // ponytail: subconsulta por linha; com ~6k deals e leads.id sendo PK, nao
      // compensa complicar. Se a base crescer muito, virar JOIN unico.
      const ORIGEM_DE = (col) => `COALESCE(NULLIF(TRIM(${col}),''),'Sem origem')`;
      const filtroDeal = (fFunil ? ' AND d.pipeline_id = ?' : '')
        + (fOrigem ? ` AND ${ORIGEM_DE('(SELECT lf.origem FROM leads lf WHERE lf.id = d.lead_id)')} = ?` : '');
      const argsDeal = [...(fFunil ? [fFunil] : []), ...(fOrigem ? [fOrigem] : [])];
      // Lead nao pertence a funil nenhum, entao o recorte de funil NAO se aplica
      // a leads_novos (a UI avisa isso na tela). Origem sim.
      const filtroLead = fOrigem ? ` AND ${ORIGEM_DE('origem')} = ?` : '';
      const argsLead = fOrigem ? [fOrigem] : [];

      // Primeira acao HUMANA na deal (autor_id nao nulo): base do tempo de
      // resposta inicial. Recebe o workspace como primeiro bind.
      const PRIMEIRA_ACAO = `SELECT deal_id, MIN(criado_em) em FROM events
           WHERE workspace_id = ? AND deal_id IS NOT NULL AND autor_id IS NOT NULL
             AND tipo IN ('deal_movida','nota','tarefa_criada','whatsapp_flag')
           GROUP BY deal_id`;
      const FECH = (tipo, extra) => `SELECT COUNT(*) n${extra}
         FROM events e JOIN deals d ON d.id = e.deal_id
         WHERE e.workspace_id = ? AND e.tipo = '${tipo}'
           AND date(e.criado_em,'-3 hours') BETWEEN ? AND ?${filtroDeal}`;
      const AGG_VENDA = `, COALESCE(SUM(d.valor),0) valor_total, COALESCE(AVG(CASE WHEN d.valor > 0 THEN d.valor END),0) ticket_medio`;
      const CRIADAS = `SELECT COUNT(*) n FROM deals d
         WHERE d.workspace_id = ? AND date(d.criado_em,'-3 hours') BETWEEN ? AND ?${filtroDeal}`;
      const LEADS_NOVOS = `SELECT COUNT(*) n FROM leads
         WHERE workspace_id = ? AND date(criado_em,'-3 hours') BETWEEN ? AND ?${filtroLead}`;

      // ARMADILHA D1: UNION ALL com muitos ramos estoura ("too many terms in
      // compound SELECT"). Varias queries em db.batch resolvem em 1 RTT.
      const b1 = await db.batch([
        db.prepare(LEADS_NOVOS).bind(ws, de, ate, ...argsLead),
        db.prepare(LEADS_NOVOS).bind(ws, antDe, antAte, ...argsLead),
        db.prepare(CRIADAS).bind(ws, de, ate, ...argsDeal),
        db.prepare(CRIADAS).bind(ws, antDe, antAte, ...argsDeal),
        db.prepare(FECH('deal_vendida', AGG_VENDA)).bind(ws, de, ate, ...argsDeal),
        db.prepare(FECH('deal_vendida', AGG_VENDA)).bind(ws, antDe, antAte, ...argsDeal),
        db.prepare(FECH('deal_perdida', '')).bind(ws, de, ate, ...argsDeal),
        db.prepare(FECH('deal_perdida', '')).bind(ws, antDe, antAte, ...argsDeal),
      ]);

      const b2 = await db.batch([
        db.prepare('SELECT id, nome FROM pipelines WHERE workspace_id = ? ORDER BY ordem, id').bind(ws),
        db.prepare(`SELECT d.pipeline_id pid, COUNT(*) n FROM deals d WHERE d.workspace_id = ? AND date(d.criado_em,'-3 hours') BETWEEN ? AND ?${filtroDeal} GROUP BY 1`).bind(ws, de, ate, ...argsDeal),
        db.prepare(`SELECT d.pipeline_id pid, COUNT(*) n, COALESCE(SUM(d.valor),0) valor FROM events e JOIN deals d ON d.id = e.deal_id
           WHERE e.workspace_id = ? AND e.tipo = 'deal_vendida' AND date(e.criado_em,'-3 hours') BETWEEN ? AND ?${filtroDeal} GROUP BY 1`).bind(ws, de, ate, ...argsDeal),
        db.prepare(`SELECT d.pipeline_id pid, COUNT(*) n FROM events e JOIN deals d ON d.id = e.deal_id
           WHERE e.workspace_id = ? AND e.tipo = 'deal_perdida' AND date(e.criado_em,'-3 hours') BETWEEN ? AND ?${filtroDeal} GROUP BY 1`).bind(ws, de, ate, ...argsDeal),
        // Motivo vem da coluna deals.motivo_perda (o /lost a grava junto com o
        // evento e ela e a lista viva usada em /api/loss-reasons).
        db.prepare(`SELECT COALESCE(NULLIF(TRIM(d.motivo_perda),''),'Sem motivo') motivo, COUNT(*) n
           FROM events e JOIN deals d ON d.id = e.deal_id
           WHERE e.workspace_id = ? AND e.tipo = 'deal_perdida' AND date(e.criado_em,'-3 hours') BETWEEN ? AND ?${filtroDeal}
           GROUP BY 1 ORDER BY n DESC`).bind(ws, de, ate, ...argsDeal),
        db.prepare(`SELECT COALESCE(NULLIF(TRIM(origem),''),'Sem origem') o, COUNT(*) n FROM leads
           WHERE workspace_id = ? AND date(criado_em,'-3 hours') BETWEEN ? AND ?${filtroLead} GROUP BY 1`).bind(ws, de, ate, ...argsLead),
        db.prepare(`SELECT COALESCE(NULLIF(TRIM(l.origem),''),'Sem origem') o, COUNT(*) n FROM deals d
           LEFT JOIN leads l ON l.id = d.lead_id
           WHERE d.workspace_id = ? AND date(d.criado_em,'-3 hours') BETWEEN ? AND ?${filtroDeal} GROUP BY 1`).bind(ws, de, ate, ...argsDeal),
        db.prepare(`SELECT COALESCE(NULLIF(TRIM(l.origem),''),'Sem origem') o, COUNT(*) n, COALESCE(SUM(d.valor),0) valor
           FROM events e JOIN deals d ON d.id = e.deal_id LEFT JOIN leads l ON l.id = d.lead_id
           WHERE e.workspace_id = ? AND e.tipo = 'deal_vendida' AND date(e.criado_em,'-3 hours') BETWEEN ? AND ?${filtroDeal} GROUP BY 1`).bind(ws, de, ate, ...argsDeal),
        db.prepare(`SELECT COALESCE(NULLIF(TRIM(l.origem),''),'Sem origem') o, COUNT(*) n
           FROM events e JOIN deals d ON d.id = e.deal_id LEFT JOIN leads l ON l.id = d.lead_id
           WHERE e.workspace_id = ? AND e.tipo = 'deal_perdida' AND date(e.criado_em,'-3 hours') BETWEEN ? AND ?${filtroDeal} GROUP BY 1`).bind(ws, de, ate, ...argsDeal),
        // Temperatura e SNAPSHOT de agora (carteira em andamento), nao do periodo.
        db.prepare(`SELECT COALESCE(NULLIF(TRIM(d.qualificacao),''),'Sem qualificação') q, COUNT(*) n
           FROM deals d WHERE d.workspace_id = ? AND d.estado = 'andamento'${filtroDeal} GROUP BY 1`).bind(ws, ...argsDeal),
        // Deals criadas no periodo que ja fecharam, cruzadas com resposta <=24h.
        // Sem nenhuma acao humana conta como lenta (nao houve resposta).
        db.prepare(`SELECT d.estado,
             CASE WHEN pa.em IS NOT NULL AND (julianday(pa.em) - julianday(d.criado_em)) * 1440 <= 1440 THEN 1 ELSE 0 END rapida,
             COUNT(*) n
           FROM deals d LEFT JOIN (${PRIMEIRA_ACAO}) pa ON pa.deal_id = d.id
           WHERE d.workspace_id = ? AND d.estado IN ('vendida','perdida')
             AND date(d.criado_em,'-3 hours') BETWEEN ? AND ?${filtroDeal}
           GROUP BY 1, 2`).bind(ws, ws, de, ate, ...argsDeal),
      ]);

      // Serie de 12 semanas com a SEGUNDA como inicio: 'weekday 0' anda ate o
      // domingo seguinte e '-6 days' volta para a segunda daquela semana.
      // Independe do periodo selecionado (sempre as 12 semanas ate hoje).
      const hojeMs = emMs(hojeSP);
      const segAtual = hojeMs - ((new Date(hojeMs).getUTCDay() + 6) % 7) * DIA_MS;
      const serieDe = soData(segAtual - 11 * 7 * DIA_MS);
      const SEM = (col) => `date(datetime(${col},'-3 hours'),'weekday 0','-6 days')`;

      const b3 = await db.batch([
        db.prepare(`SELECT ${SEM('criado_em')} sem, COUNT(*) n FROM leads
           WHERE workspace_id = ? AND date(criado_em,'-3 hours') >= ?${filtroLead} GROUP BY 1`).bind(ws, serieDe, ...argsLead),
        db.prepare(`SELECT ${SEM('d.criado_em')} sem, COUNT(*) n FROM deals d
           WHERE d.workspace_id = ? AND date(d.criado_em,'-3 hours') >= ?${filtroDeal} GROUP BY 1`).bind(ws, serieDe, ...argsDeal),
        db.prepare(`SELECT ${SEM('e.criado_em')} sem, COUNT(*) n, COALESCE(SUM(d.valor),0) valor
           FROM events e JOIN deals d ON d.id = e.deal_id
           WHERE e.workspace_id = ? AND e.tipo = 'deal_vendida' AND date(e.criado_em,'-3 hours') >= ?${filtroDeal} GROUP BY 1`).bind(ws, serieDe, ...argsDeal),
        db.prepare(`SELECT (julianday(pa.em) - julianday(d.criado_em)) * 1440 minutos
           FROM deals d LEFT JOIN (${PRIMEIRA_ACAO}) pa ON pa.deal_id = d.id
           WHERE d.workspace_id = ? AND date(d.criado_em,'-3 hours') BETWEEN ? AND ?${filtroDeal}`).bind(ws, ws, de, ate, ...argsDeal),
        db.prepare(`SELECT (julianday(pa.em) - julianday(d.criado_em)) * 1440 minutos
           FROM deals d LEFT JOIN (${PRIMEIRA_ACAO}) pa ON pa.deal_id = d.id
           WHERE d.workspace_id = ? AND date(d.criado_em,'-3 hours') BETWEEN ? AND ?${filtroDeal}`).bind(ws, ws, antDe, antAte, ...argsDeal),
        db.prepare(`SELECT (julianday(e.criado_em) - julianday(d.criado_em)) dias
           FROM events e JOIN deals d ON d.id = e.deal_id
           WHERE e.workspace_id = ? AND e.tipo = 'deal_vendida' AND date(e.criado_em,'-3 hours') BETWEEN ? AND ?${filtroDeal}`).bind(ws, de, ate, ...argsDeal),
        db.prepare(`SELECT (julianday(e.criado_em) - julianday(d.criado_em)) dias
           FROM events e JOIN deals d ON d.id = e.deal_id
           WHERE e.workspace_id = ? AND e.tipo = 'deal_vendida' AND date(e.criado_em,'-3 hours') BETWEEN ? AND ?${filtroDeal}`).bind(ws, antDe, antAte, ...argsDeal),
      ]);

      const linhas = (r) => (r && r.results) || [];
      const um = (r) => linhas(r)[0] || {};
      const mediana = (a) => {
        if (!a.length) return null;
        const s = [...a].sort((x, y) => x - y);
        const i = s.length >> 1;
        return s.length % 2 ? s[i] : (s[i - 1] + s[i]) / 2;
      };
      const media = (a) => (a.length ? a.reduce((x, y) => x + y, 0) / a.length : null);
      const arred = (v, casas = 1) => (v == null ? null : Math.round(v * 10 ** casas) / 10 ** casas);
      // Denominador do SLA e o total de deals criadas: quem nunca recebeu acao
      // humana e falha de SLA, nao caso omitido.
      const blocoResposta = (rows) => {
        const mins = rows.filter((r) => r.minutos != null).map((r) => Number(r.minutos));
        const ate_ = (lim) => (rows.length ? Math.round((mins.filter((x) => x <= lim).length / rows.length) * 100) : null);
        return {
          total: rows.length,
          sem_resposta: rows.length - mins.length,
          mediana_min: arred(mediana(mins)),
          media_min: arred(media(mins)),
          sla_1h: ate_(60),
          sla_24h: ate_(1440),
        };
      };
      const blocoCiclo = (rows) => {
        const ds = rows.map((r) => Number(r.dias)).filter((x) => !isNaN(x));
        return { total: ds.length, mediana_dias: arred(mediana(ds)), media_dias: arred(media(ds)) };
      };

      const pipes = linhas(b2[0]);
      const porChave = (rows, chave) => new Map(rows.map((r) => [r[chave], r]));
      const fCriadas = porChave(linhas(b2[1]), 'pid');
      const fVendidas = porChave(linhas(b2[2]), 'pid');
      const fPerdidas = porChave(linhas(b2[3]), 'pid');
      const por_funil = pipes.map((pi) => ({
        pipeline_id: pi.id,
        nome: pi.nome,
        criadas: (fCriadas.get(pi.id) || {}).n || 0,
        vendidas: (fVendidas.get(pi.id) || {}).n || 0,
        perdidas: (fPerdidas.get(pi.id) || {}).n || 0,
        valor_vendido: (fVendidas.get(pi.id) || {}).valor || 0,
      })).filter((f) => f.criadas || f.vendidas || f.perdidas);

      const oLeads = porChave(linhas(b2[5]), 'o');
      const oCriadas = porChave(linhas(b2[6]), 'o');
      const oVendidas = porChave(linhas(b2[7]), 'o');
      const oPerdidas = porChave(linhas(b2[8]), 'o');
      const chavesOrigem = [...new Set([...oLeads.keys(), ...oCriadas.keys(), ...oVendidas.keys(), ...oPerdidas.keys()])];
      const origens = chavesOrigem.map((o) => ({
        origem: o,
        leads: (oLeads.get(o) || {}).n || 0,
        criadas: (oCriadas.get(o) || {}).n || 0,
        vendidas: (oVendidas.get(o) || {}).n || 0,
        perdidas: (oPerdidas.get(o) || {}).n || 0,
        valor_vendido: (oVendidas.get(o) || {}).valor || 0,
      })).sort((a, b) => b.leads - a.leads || b.criadas - a.criadas);

      const rvw = { rapida_vendida: 0, rapida_perdida: 0, lenta_vendida: 0, lenta_perdida: 0 };
      for (const r of linhas(b2[10])) {
        const k = (r.rapida ? 'rapida_' : 'lenta_') + r.estado;
        if (k in rvw) rvw[k] += r.n;
      }

      const semanas = [];
      const sLeads = porChave(linhas(b3[0]), 'sem');
      const sCriadas = porChave(linhas(b3[1]), 'sem');
      const sVendidas = porChave(linhas(b3[2]), 'sem');
      for (let i = 11; i >= 0; i--) {
        const seg = soData(segAtual - i * 7 * DIA_MS);
        semanas.push({
          semana: seg,
          leads: (sLeads.get(seg) || {}).n || 0,
          criadas: (sCriadas.get(seg) || {}).n || 0,
          vendidas: (sVendidas.get(seg) || {}).n || 0,
          valor_vendido: (sVendidas.get(seg) || {}).valor || 0,
        });
      }

      const vend = um(b1[4]); const vendAnt = um(b1[5]);
      return json({
        periodo: { de, ate, dias: dur },
        anterior: { de: antDe, ate: antAte },
        filtros: { funil: fFunil, origem: fOrigem },
        leads_novos: { valor: um(b1[0]).n || 0, anterior: um(b1[1]).n || 0 },
        negociacoes_criadas: { valor: um(b1[2]).n || 0, anterior: um(b1[3]).n || 0 },
        vendas: {
          count: vend.n || 0,
          valor_total: vend.valor_total || 0,
          ticket_medio: vend.ticket_medio || 0,
          anterior: { count: vendAnt.n || 0, valor_total: vendAnt.valor_total || 0, ticket_medio: vendAnt.ticket_medio || 0 },
        },
        perdidas: { valor: um(b1[6]).n || 0, anterior: um(b1[7]).n || 0 },
        por_funil,
        motivos_perda: linhas(b2[4]).map((r) => ({ motivo: r.motivo, count: r.n })),
        origens,
        temperatura: linhas(b2[9]).map((r) => ({ qualificacao: r.q, count: r.n })),
        resposta_vs_win: rvw,
        serie_semanal: semanas,
        resposta_inicial: { ...blocoResposta(linhas(b3[3])), anterior: blocoResposta(linhas(b3[4])) },
        ciclo_venda: { ...blocoCiclo(linhas(b3[5])), anterior: blocoCiclo(linhas(b3[6])) },
      });
    }

    return err(404, 'rota nao encontrada');
  } catch (e) {
    if (e && e._403) return err(403, 'acao restrita a administrador');
    throw e;
  }
}

function norm(s) { return String(s || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').trim(); }

// Campo do tipo select só vale se o valor for EXATAMENTE uma das opções: o
// front não exibe valor fora da lista. Fonte externa manda "kit festa na mesa"
// em minúsculo, então aqui a gente devolve a opção canônica quando o valor bate
// ignorando caixa e acento. Também aceita só o começo do nome ("Decoração
// Completa" casa com "Decoração Completa (R$ 550)").
function valorCanonico(def, valor) {
  if (valor == null) return null;
  const v = String(valor);
  if (def.tipo !== 'select' || !def.opcoes) return v;
  let opcoes; try { opcoes = JSON.parse(def.opcoes); } catch { return v; }
  if (!Array.isArray(opcoes)) return v;
  return opcoes.find((o) => norm(o) === norm(v))
    || opcoes.find((o) => norm(o).replace(/\s*\(.*\)$/, '') === norm(v)) || v;
}

// Tag aplicada sozinha pela entrada de leads (renomear/excluir pede confirmação
// extra, porque a entrada recriaria a tag com o nome antigo).
function tagSistema(nome) {
  return String(nome || '') === TAG_SITE;
}
// Monta o WHERE de um segmento (aplicado a `leads l`) a partir dos filtros JSON.
// Filtros: tags[]+tags_modo(and|or), nao_tags[], origens[], negociacao(com|sem),
// funil_id/etapa_id, criado_de/criado_ate, comprou(bool), temperatura(string ou array).
function segmentoWhere(f, ws, isAdmin = true) {
  const where = ['l.workspace_id = ?']; const args = [ws];
  const restr = isAdmin ? '' : ' AND pi.restrito_admin = 0';
  const tags = Array.isArray(f.tags) ? f.tags.filter(Boolean) : [];
  if (tags.length) {
    if ((f.tags_modo || 'or') === 'and') {
      for (const t of tags) { where.push('EXISTS (SELECT 1 FROM lead_tags lt JOIN tags tg ON tg.id=lt.tag_id WHERE lt.lead_id=l.id AND tg.nome=?)'); args.push(t); }
    } else {
      where.push(`EXISTS (SELECT 1 FROM lead_tags lt JOIN tags tg ON tg.id=lt.tag_id WHERE lt.lead_id=l.id AND tg.nome IN (${tags.map(() => '?').join(',')}))`);
      args.push(...tags);
    }
  }
  // NAO tem alguma das tags (exclui o lead que tenha qualquer uma delas).
  const naoTags = Array.isArray(f.nao_tags) ? f.nao_tags.filter(Boolean) : [];
  if (naoTags.length) {
    where.push(`NOT EXISTS (SELECT 1 FROM lead_tags lt JOIN tags tg ON tg.id=lt.tag_id WHERE lt.lead_id=l.id AND tg.nome IN (${naoTags.map(() => '?').join(',')}))`);
    args.push(...naoTags);
  }
  // Origem (multi): valores distintos existentes em leads.origem.
  const origens = Array.isArray(f.origens) ? f.origens.filter(Boolean) : [];
  if (origens.length) {
    where.push(`l.origem IN (${origens.map(() => '?').join(',')})`);
    args.push(...origens);
  }
  // Data de criacao do lead (antes/depois/entre). Datas em 'YYYY-MM-DD'.
  if (f.criado_de) { where.push('date(l.criado_em) >= date(?)'); args.push(f.criado_de); }
  if (f.criado_ate) { where.push('date(l.criado_em) <= date(?)'); args.push(f.criado_ate); }
  if (f.comprou) where.push('EXISTS (SELECT 1 FROM purchases pu WHERE pu.lead_id=l.id)');
  if (f.negociacao === 'com') where.push(`EXISTS (SELECT 1 FROM deals d JOIN pipelines pi ON pi.id=d.pipeline_id WHERE d.lead_id=l.id AND d.estado='andamento'${restr})`);
  if (f.negociacao === 'sem') where.push(`NOT EXISTS (SELECT 1 FROM deals d JOIN pipelines pi ON pi.id=d.pipeline_id WHERE d.lead_id=l.id AND d.estado='andamento'${restr})`);
  // Negociacao aberta num funil/etapa especifico (respeita restrito_admin para
  // operador: um segmento nunca vaza a existencia de deal em funil restrito).
  if (f.funil_id) {
    const cond = ['d.lead_id=l.id', "d.estado='andamento'", 'd.pipeline_id=?'];
    const extra = [Number(f.funil_id)];
    if (f.etapa_id) { cond.push('d.stage_id=?'); extra.push(Number(f.etapa_id)); }
    where.push(`EXISTS (SELECT 1 FROM deals d JOIN pipelines pi ON pi.id=d.pipeline_id WHERE ${cond.join(' AND ')}${restr})`);
    args.push(...extra);
  }
  const temp = Array.isArray(f.temperatura) ? f.temperatura.filter(Boolean) : (f.temperatura ? [f.temperatura] : []);
  if (temp.length) {
    where.push(`EXISTS (SELECT 1 FROM deals d JOIN pipelines pi ON pi.id=d.pipeline_id WHERE d.lead_id=l.id AND d.estado='andamento' AND d.qualificacao IN (${temp.map(() => '?').join(',')})${restr})`);
    args.push(...temp);
  }
  return { where: where.join(' AND '), args };
}

// Campos de rastreamento aceitos pela entrada de leads. Vão inteiros para o
// evento lead_ingerido (primeiro toque) ou reconversao (lead que voltou), que é
// de onde o bloco "Origem" da negociação e do lead lê.
const RASTREIO = ['pagina', 'pagina_entrada', 'botao', 'referrer', 'utm_source', 'utm_medium', 'utm_campaign',
  'utm_content', 'utm_term', 'fbclid', 'gclid', 'primeiro_acesso', 'campanha', 'mensagem'];
// Funil em que o lead do site cai quando quem manda não diz outro.
const FUNIL_PADRAO = 'Vendas';

// Entrada de leads de sistemas externos (formulário do site via Pages Function):
// upsert de lead (por e-mail, depois por telefone), tags, e uma negociação no
// funil (sem duplicar negociação já em andamento no mesmo funil).
async function ingestLead(db, b) {
  if (!b || !b.nome && !b.email && !b.telefone) return err(400, 'nome, email ou telefone obrigatorio');
  const ws = WS;
  const email = b.email ? String(b.email).toLowerCase().trim() : null;
  const telNorm = normPhone(b.telefone);

  let lead = null;
  if (email) lead = await db.prepare('SELECT * FROM leads WHERE workspace_id = ? AND lower(email) = ?').bind(ws, email).first();
  if (!lead && telNorm) lead = await db.prepare('SELECT * FROM leads WHERE workspace_id = ? AND telefone_norm = ?').bind(ws, telNorm).first();

  // Anúncio pago identificado pelo rastreio (gclid, fbclid, utm) vale mais que a
  // origem declarada ("site"): o formulário é do site, mas quem trouxe a pessoa
  // foi o anúncio.
  const origemCanonica = origemDeRastreio(b) || (b.origem ? normalizaOrigem(b.origem) : null);

  let leadId;
  if (lead) {
    leadId = lead.id;
    // Origem é do PRIMEIRO toque: lead que já existe não muda de origem ao
    // voltar; a volta vai para o histórico (evento 'reconversao'). Só preenche
    // quando o lead ainda não tinha origem de verdade (nula ou Desconhecido).
    const semOrigem = !lead.origem || lead.origem === 'Desconhecido';
    await db.prepare('UPDATE leads SET nome=COALESCE(?,nome), email=COALESCE(?,email), telefone=COALESCE(?,telefone), telefone_norm=COALESCE(?,telefone_norm), origem=COALESCE(?,origem), origem_original=COALESCE(?,origem_original), atualizado_em=datetime(\'now\') WHERE id=?')
      .bind(b.nome || null, email, b.telefone || null, telNorm, semOrigem ? origemCanonica : null, semOrigem ? (b.origem || null) : null, leadId).run();
  } else {
    const r = await db.prepare('INSERT INTO leads (workspace_id, nome, email, telefone, telefone_norm, origem, origem_original) VALUES (?,?,?,?,?,?,?)')
      .bind(ws, b.nome || null, email, b.telefone || null, telNorm, origemCanonica || 'Desconhecido', b.origem || null).run();
    leadId = r.meta.last_row_id;
  }

  const tagsIngest = [...new Set((Array.isArray(b.tags) ? b.tags : []).map((t) => String(t).trim()).filter(Boolean))];
  for (const tagNome of tagsIngest) {
    await db.prepare('INSERT OR IGNORE INTO tags (workspace_id, nome) VALUES (?,?)').bind(ws, tagNome).run();
    const t = await db.prepare('SELECT id FROM tags WHERE workspace_id = ? AND nome = ?').bind(ws, tagNome).first();
    if (t) await db.prepare('INSERT OR IGNORE INTO lead_tags (lead_id, tag_id) VALUES (?,?)').bind(leadId, t.id).run();
  }

  const proveniencia = { origem: b.origem || null, origem_canonica: origemCanonica, funil: b.funil || null };
  for (const k of RASTREIO) proveniencia[k] = b[k] ? String(b[k]).slice(0, 500) : null;
  await logEvent(db, ws, null, leadId, lead ? 'reconversao' : 'lead_ingerido', null, proveniencia);

  let dealId;
  const ignorados = [];
  const funilNome = b.funil === false || b.funil === '' ? null : (b.funil || FUNIL_PADRAO);
  if (funilNome) {
    const pipeline = await db.prepare('SELECT * FROM pipelines WHERE workspace_id = ? AND nome = ?').bind(ws, funilNome).first();
    if (!pipeline) return err(400, 'funil desconhecido: ' + funilNome);
    // Valor que o sistema de origem mandou entra SÓ em negociação zerada: número
    // que a equipe digitou nunca é sobrescrito por robô.
    const valorIngest = Number(b.valor) > 0 ? Number(b.valor) : null;
    const jaAndamento = await db.prepare('SELECT id FROM deals WHERE lead_id = ? AND pipeline_id = ? AND estado = \'andamento\'').bind(leadId, pipeline.id).first();
    if (jaAndamento) {
      // Voltou com negociação aberta: reesquenta para Muito quente e limpa o ajuste manual.
      dealId = jaAndamento.id;
      await db.prepare('UPDATE deals SET qualificacao = ?, qualificacao_manual_at = NULL, valor = CASE WHEN COALESCE(valor,0) = 0 THEN COALESCE(?, valor) ELSE valor END, atualizado_em = datetime(\'now\') WHERE id = ?')
        .bind(labelDeNivel(5), valorIngest, dealId).run();
      await logEvent(db, ws, dealId, leadId, 'reengajamento', null, { motivo: 'Reengajamento: ' + labelDeNivel(5) });
    } else {
      let stage = b.etapa ? await db.prepare('SELECT id FROM stages WHERE pipeline_id = ? AND nome = ?').bind(pipeline.id, b.etapa).first() : null;
      if (!stage) stage = await db.prepare('SELECT id FROM stages WHERE pipeline_id = ? ORDER BY ordem LIMIT 1').bind(pipeline.id).first();
      // Negociação nascida pelo site nasce Muito quente (nível 5): a pessoa acabou de pedir orçamento.
      const r = await db.prepare('INSERT INTO deals (workspace_id, lead_id, pipeline_id, stage_id, titulo, valor, qualificacao, stage_entered_at) VALUES (?,?,?,?,?,?,?,datetime(\'now\'))')
        .bind(ws, leadId, pipeline.id, stage.id, b.titulo || b.nome || null, valorIngest || 0, labelDeNivel(5)).run();
      dealId = r.meta.last_row_id;
      await logEvent(db, ws, dealId, leadId, 'deal_criada', null, { stage_id: stage.id, origem: 'ingest' });
    }

    // Campos valem para negociação nova E para a que já existia.
    if (b.campos && typeof b.campos === 'object') {
      const defs = (await db.prepare('SELECT * FROM deal_field_defs WHERE pipeline_id = ?').bind(pipeline.id).all()).results;
      for (const [chaveOuLabel, valor] of Object.entries(b.campos)) {
        if (valor == null || String(valor).trim() === '') continue;
        const def = defs.find((d) => d.chave === chaveOuLabel || norm(d.label) === norm(chaveOuLabel));
        // Campo sem def no funil de destino é descartado, e quem chama recebe a
        // lista de volta (campos_ignorados), além do log.
        if (!def) { ignorados.push(chaveOuLabel); continue; }
        await db.prepare('INSERT INTO deal_field_values (deal_id, field_def_id, valor) VALUES (?,?,?) ON CONFLICT(deal_id, field_def_id) DO UPDATE SET valor=excluded.valor')
          .bind(dealId, def.id, valorCanonico(def, valor)).run();
      }
      if (ignorados.length) console.warn('ingest: campos sem def no funil', pipeline.nome, ignorados.join(', '));
      if (!valorIngest) await valorDoPacote(db, dealId);
    }
  }

  return json({
    ok: true, lead_id: leadId,
    ...(dealId ? { deal_id: dealId } : {}),
    ...(ignorados.length ? { campos_ignorados: ignorados } : {}),
  }, 201);
}

// ---------- campos do negócio ----------
// Campos que todo funil da SK tem. O Kanban mostra no card os de CAMPOS_CARD.
// Pacotes e preços vêm da LP (skdecoracao.com.br); mudou o preço lá, muda aqui
// e na tela Configurações > Funis (a lista de opções do campo "Pacote").
const PACOTES = [
  'Kit Festa na Mesa (R$ 85)',
  'Kit Festa na Mesa Completo (R$ 170)',
  'Decoração Completa (R$ 550)',
];
const CAMPOS_PADRAO = [
  { chave: 'data_festa', label: 'Data da festa', tipo: 'date' },
  { chave: 'tema', label: 'Tema', tipo: 'text' },
  { chave: 'pacote', label: 'Pacote', tipo: 'select', opcoes: PACOTES },
  { chave: 'entrega', label: 'Retirada ou montagem', tipo: 'select', opcoes: ['Retirada', 'Montagem no local'] },
  { chave: 'local', label: 'Bairro / cidade', tipo: 'text' },
];
const CAMPOS_CARD = ['data_festa', 'tema', 'pacote', 'entrega', 'local'];

async function criaCamposPadrao(db, pipelineId) {
  for (let i = 0; i < CAMPOS_PADRAO.length; i++) {
    const c = CAMPOS_PADRAO[i];
    await db.prepare('INSERT OR IGNORE INTO deal_field_defs (pipeline_id, chave, label, tipo, opcoes, ordem) VALUES (?,?,?,?,?,?)')
      .bind(pipelineId, c.chave, c.label, c.tipo, c.opcoes ? JSON.stringify(c.opcoes) : null, i).run();
  }
}

// Preço do pacote escolhido ("Decoração Completa (R$ 550)" -> 550) vira o valor
// da negociação, mas só enquanto ela estiver zerada.
async function valorDoPacote(db, dealId) {
  const r = await db.prepare(
    `SELECT d.valor, v.valor pacote FROM deals d
       JOIN deal_field_defs def ON def.pipeline_id = d.pipeline_id AND def.chave = 'pacote'
       JOIN deal_field_values v ON v.deal_id = d.id AND v.field_def_id = def.id
      WHERE d.id = ?`).bind(dealId).first();
  if (!r || Number(r.valor) > 0 || !r.pacote) return;
  const m = /R\$\s*([\d.]+(?:,\d{1,2})?)/.exec(r.pacote);
  if (!m) return;
  const preco = Number(m[1].replace(/\./g, '').replace(',', '.'));
  if (preco > 0) await db.prepare("UPDATE deals SET valor = ?, atualizado_em = datetime('now') WHERE id = ?").bind(preco, dealId).run();
}

async function logEvent(db, ws, dealId, leadId, tipo, autorId, payload) {
  await db.prepare('INSERT INTO events (workspace_id, deal_id, lead_id, tipo, autor_id, payload) VALUES (?,?,?,?,?,?)')
    .bind(ws, dealId || null, leadId || null, tipo, autorId || null, payload ? JSON.stringify(payload) : null).run();
}

function csv(cols, rows, filename) {
  const esc = v => { const s = v == null ? '' : String(v); return /[",\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s; };
  const lines = [cols.join(',')];
  for (const r of rows) lines.push(cols.map(c => esc(r[c])).join(','));
  return new Response('﻿' + lines.join('\n'), {
    headers: { 'content-type': 'text/csv; charset=utf-8', 'content-disposition': `attachment; filename="${filename}"` },
  });
}
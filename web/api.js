// Wrapper de fetch: sempre com cookie de sessao, sempre JSON, erro vira throw.
async function req(method, path, body) {
  const opt = { method, credentials: 'same-origin', headers: {} };
  if (body !== undefined) {
    opt.headers['content-type'] = 'application/json';
    opt.body = JSON.stringify(body);
  }
  const r = await fetch('/api' + path, opt);
  if (r.status === 401) {
    // sessao expirou: manda pro login
    if (!path.startsWith('/me') && !path.startsWith('/login')) {
      window.location.hash = '#/login';
    }
    throw new ApiError(401, 'Sessão expirada');
  }
  const ct = r.headers.get('content-type') || '';
  const data = ct.includes('json') ? await r.json() : await r.text();
  if (!r.ok) throw new ApiError(r.status, (data && data.error) || 'Erro ' + r.status);
  return data;
}

export class ApiError extends Error {
  constructor(status, msg) { super(msg); this.status = status; }
}

export const api = {
  login: (email, password) => req('POST', '/login', { email, password }),
  logout: () => req('POST', '/logout'),
  me: () => req('GET', '/me'),
  trocarSenha: (senha_atual, senha_nova) => req('POST', '/me/senha', { senha_atual, senha_nova }),

  pipelines: () => req('GET', '/pipelines'),
  fieldDefs: (pid) => req('GET', `/pipelines/${pid}/field-defs`),

  // editor de funil (admin)
  patchPipeline: (pid, b) => req('PATCH', `/pipelines/${pid}`, b),
  createStage: (pid, b) => req('POST', `/pipelines/${pid}/stages`, b),
  patchStage: (pid, sid, b) => req('PATCH', `/pipelines/${pid}/stages/${sid}`, b),
  deleteStage: (pid, sid, destino_stage_id) => req('DELETE', `/pipelines/${pid}/stages/${sid}`, destino_stage_id ? { destino_stage_id } : {}),
  reorderStages: (pid, order) => req('POST', `/pipelines/${pid}/stages/reorder`, { order }),
  createFieldDef: (pid, b) => req('POST', `/pipelines/${pid}/field-defs`, b),
  patchFieldDef: (pid, fid, b) => req('PATCH', `/pipelines/${pid}/field-defs/${fid}`, b),
  deleteFieldDef: (pid, fid) => req('DELETE', `/pipelines/${pid}/field-defs/${fid}`),
  reorderFieldDefs: (pid, order) => req('POST', `/pipelines/${pid}/field-defs/reorder`, { order }),
  board: (pid, sort, estado) => req('GET', `/pipelines/${pid}/board?limit=300` + (sort ? `&sort=${sort}` : '') + (estado ? `&estado=${estado}` : '')),

  deal: (id) => req('GET', `/deals/${id}`),
  createDeal: (b) => req('POST', '/deals', b),
  patchDeal: (id, b) => req('PATCH', `/deals/${id}`, b),
  moveDeal: (id, stage_id) => req('POST', `/deals/${id}/move`, { stage_id }),
  moveDealFunil: (id, pipeline_id) => req('POST', `/deals/${id}/move`, { pipeline_id }),
  deleteDeal: (id) => req('DELETE', `/deals/${id}`),
  lixeira: () => req('GET', '/lixeira'),
  restauraLixeira: (id) => req('POST', `/lixeira/${id}/restaurar`),
  wonDeal: (id, valor) => req('POST', `/deals/${id}/won`, valor != null ? { valor } : {}),
  lostDeal: (id, motivo) => req('POST', `/deals/${id}/lost`, { motivo }),
  lossReasons: () => req('GET', '/loss-reasons'),
  whatsappDeal: (id, on) => req('POST', `/deals/${id}/whatsapp`, { on }),

  leads: (params) => req('GET', '/leads?' + new URLSearchParams(params).toString()),
  createLead: (b) => req('POST', '/leads', b),
  leadOrigens: () => req('GET', '/leads/origens'),
  lead: (id) => req('GET', `/leads/${id}`),
  patchLead: (id, b) => req('PATCH', `/leads/${id}`, b),
  addLeadTag: (id, nome) => req('POST', `/leads/${id}/tags`, { nome }),
  removeLeadTag: (id, tagId) => req('DELETE', `/leads/${id}/tags/${tagId}`),
  tags: () => req('GET', '/tags'),
  patchTag: (id, b) => req('PATCH', `/tags/${id}`, b),
  deleteTag: (id, b) => req('DELETE', `/tags/${id}`, b || {}),
  mergeTags: (destino_id, origem_ids) => req('POST', '/tags/merge', { destino_id, origem_ids }),
  leadPurchases: (id) => req('GET', `/leads/${id}/purchases`),
  addLeadPurchase: (id, b) => req('POST', `/leads/${id}/purchases`, b),

  segments: () => req('GET', '/segments'),
  segment: (id) => req('GET', `/segments/${id}`),
  createSegment: (b) => req('POST', '/segments', b),
  patchSegment: (id, b) => req('PATCH', `/segments/${id}`, b),
  deleteSegment: (id) => req('DELETE', `/segments/${id}`),
  segmentLeads: (id) => req('GET', `/segments/${id}/leads`),

  tasks: (params) => req('GET', '/tasks?' + new URLSearchParams(params).toString()),
  tasksLista: (params) => req('GET', '/tasks/lista?' + new URLSearchParams(params).toString()),
  createTask: (b) => req('POST', '/tasks', b),
  patchTask: (id, b) => req('PATCH', `/tasks/${id}`, b),
  titulosFrequentes: () => req('GET', '/tasks/titulos-frequentes'),
  createNote: (b) => req('POST', '/notes', b),

  // editor de funil: criar funil e alternar restricao a admins
  createPipeline: (b) => req('POST', '/pipelines', b),

  relatorios: (de, ate, funil, origem) => req('GET', '/relatorios?' + new URLSearchParams({
    de, ate, ...(funil ? { funil } : {}), ...(origem ? { origem } : {}),
  }).toString()),

  adminConfig: () => req('GET', '/admin/config'),
  adminUsers: () => req('GET', '/admin/users'),
  verComo: (user_id) => req('POST', '/admin/ver-como', { user_id }),
  verComoSair: () => req('DELETE', '/admin/ver-como'),
  createUser: (b) => req('POST', '/admin/users', b),
  patchUser: (id, b) => req('PATCH', `/admin/users/${id}`, b),
  resetSenhaUser: (id) => req('POST', `/admin/users/${id}/reset-senha`),
};

// ---- formatadores ----
export const brl = (n) =>
  (Number(n) || 0).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });

export function dataHora(s) {
  if (!s) return '';
  const d = new Date(s.replace(' ', 'T') + 'Z');
  if (isNaN(d)) return s;
  return d.toLocaleString('pt-BR', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' });
}

export function dataCurta(s) {
  if (!s) return '';
  const d = new Date(s.replace(' ', 'T') + 'Z');
  if (isNaN(d)) return s;
  return d.toLocaleString('pt-BR', { day: '2-digit', month: '2-digit' });
}

export function soTelefone(t) {
  return (t || '').replace(/\D/g, '');
}
export function waLink(t) {
  const n = soTelefone(t);
  return n ? `https://wa.me/${n.startsWith('55') ? n : '55' + n}` : null;
}

export const QUALIF = ['Muito frio', 'Frio', 'Morno', 'Quente', 'Muito quente'];

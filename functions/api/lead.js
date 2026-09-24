// POST /api/lead: recebe o formulário de contato da LP e repassa ao CRM
// (crm.skdecoracao.com.br/api/ingest/lead).
//
// O token do CRM fica SÓ aqui, como segredo do projeto Pages (variável
// CRM_INGEST_TOKEN); o navegador nunca o vê. O formulário continua abrindo o
// WhatsApp do mesmo jeito, com ou sem esta função: falha aqui não atrapalha a
// cliente, só deixa de registrar o lead no CRM.

const CRM_URL = 'https://crm.skdecoracao.com.br/api/ingest/lead';

// Campos de rastreamento aceitos (primeiro acesso guardado pelo main.js).
const RASTREIO = ['pagina', 'pagina_entrada', 'referrer', 'utm_source', 'utm_medium', 'utm_campaign',
  'utm_content', 'utm_term', 'fbclid', 'gclid', 'primeiro_acesso'];

const resposta = (status, corpo) => new Response(JSON.stringify(corpo), {
  status,
  headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' },
});

const texto = (v, max) => String(v == null ? '' : v).trim().slice(0, max);

export async function onRequestPost({ request, env }) {
  let b;
  try { b = await request.json(); } catch { return resposta(400, { ok: false, erro: 'json inválido' }); }
  if (!b || typeof b !== 'object') return resposta(400, { ok: false, erro: 'corpo inválido' });

  // Armadilha para robô (campo escondido "apelido"): responde como se tivesse
  // dado certo e não repassa nada.
  if (texto(b.apelido, 200) !== '') return resposta(200, { ok: true });

  const nome = texto(b.nome, 120);
  const telefone = texto(b.telefone, 30);
  const digitos = telefone.replace(/\D/g, '');
  const email = texto(b.email, 160).toLowerCase();
  const tema = texto(b.tema, 200);
  if (nome.length < 2) return resposta(400, { ok: false, erro: 'nome' });
  if (digitos.length < 10 || digitos.length > 13) return resposta(400, { ok: false, erro: 'telefone' });
  if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(email)) return resposta(400, { ok: false, erro: 'email' });

  if (!env.CRM_INGEST_TOKEN) return resposta(503, { ok: false, erro: 'CRM não configurado' });

  const r = { origem: 'site', funil: 'Vendas', tags: ['Site'], nome, telefone, email: email || undefined, botao: 'formulario' };
  if (tema) {
    r.campos = { tema };
    r.mensagem = tema;
  }
  const rastreio = b.rastreio && typeof b.rastreio === 'object' ? b.rastreio : {};
  for (const k of RASTREIO) {
    const v = texto(rastreio[k], 500);
    if (v) r[k] = v;
  }

  let crm;
  try {
    crm = await fetch(CRM_URL, {
      method: 'POST',
      headers: { authorization: `Bearer ${env.CRM_INGEST_TOKEN}`, 'content-type': 'application/json' },
      body: JSON.stringify(r),
    });
  } catch (e) {
    console.error('lead: CRM fora do ar', e && e.message);
    return resposta(502, { ok: false, erro: 'CRM indisponível' });
  }
  if (!crm.ok) {
    console.error('lead: CRM respondeu', crm.status, await crm.text().catch(() => ''));
    return resposta(502, { ok: false, erro: 'CRM recusou' });
  }
  return resposta(200, { ok: true });
}

export function onRequest() {
  return resposta(405, { ok: false, erro: 'use POST' });
}

// Origem de lead: um vocabulário curto e fixo, para filtro e relatório não
// virarem uma lista de grafias. Este é o único lugar que conhece o mapa.
//
// Duas entradas:
//   normalizaOrigem(bruto)  -> texto livre ("instagram", "indicacao") vira a canônica;
//   origemDeRastreio(b)     -> clique de anúncio (gclid, fbclid, utm pago) e busca
//                              orgânica, lidos dos campos de rastreamento do site.

export const ORIGENS_CANONICAS = [
  'Site', 'Meta Ads', 'Google Ads', 'Google Orgânico', 'Instagram', 'Facebook',
  'WhatsApp', 'Indicação', 'E-mail', 'Cadastro manual', 'Desconhecido',
];

// Tag que a entrada de leads do site aplica sozinha (ver functions/api/lead.js
// no repositório da LP). Marcada como "tag de sistema" na tela de tags.
export const TAG_SITE = 'Site';

const MAPA = {
  'Site': ['site', 'lp', 'landing', 'formulario', 'formulário', 'skdecoracao.com.br', 'direto'],
  'Meta Ads': ['meta ads', 'meta-ads', 'metaads', 'facebook ads', 'instagram ads', 'meta'],
  'Google Ads': ['google ads', 'google-ads', 'googleads', 'adwords', 'gads'],
  'Google Orgânico': ['google orgânico', 'google organico', 'google', 'busca', 'busca orgânica'],
  'Instagram': ['instagram', 'ig', 'insta', 'instagram bio', 'bio'],
  'Facebook': ['facebook', 'fb'],
  'WhatsApp': ['whatsapp', 'wa', 'zap'],
  'Indicação': ['indicação', 'indicacao', 'indicou', 'amiga', 'cliente'],
  'E-mail': ['e-mail', 'email'],
  'Cadastro manual': ['cadastro manual', 'manual', 'loja'],
};

const LOOKUP = new Map();
for (const [canonica, brutos] of Object.entries(MAPA)) {
  LOOKUP.set(chave(canonica), canonica);
  for (const bruto of brutos) LOOKUP.set(chave(bruto), canonica);
}
function chave(v) {
  return String(v).trim().toLowerCase().replace(/[+|_]/g, ' ').replace(/\s+/g, ' ');
}

export function normalizaOrigem(bruto) {
  if (bruto == null || String(bruto).trim() === '') return 'Desconhecido';
  return LOOKUP.get(chave(bruto)) || 'Desconhecido';
}

const PAGO = /^(cpc|ppc|paid|pago|ads?|paidsocial|paid[-_ ]social|cpm)$/i;

// Canal a partir do rastreamento do primeiro toque. Devolve null quando o
// rastreamento não diz nada (aí vale a origem declarada por quem mandou).
export function origemDeRastreio(b = {}) {
  const src = String(b.utm_source || '').trim().toLowerCase();
  const med = String(b.utm_medium || '').trim().toLowerCase();
  if (b.gclid || (/google/.test(src) && PAGO.test(med))) return 'Google Ads';
  // fbclid sozinho NÃO prova anúncio: o Instagram e o Facebook põem fbclid em
  // todo link clicado dentro deles, inclusive o da bio. Pago é só com utm pago.
  if (/(facebook|instagram|meta|^fb$|^ig$)/.test(src)) {
    if (PAGO.test(med)) return 'Meta Ads';
    return /instagram|^ig$/.test(src) ? 'Instagram' : 'Facebook';
  }
  if (src) {
    const c = normalizaOrigem(src);
    if (c !== 'Desconhecido') return c;
  }
  const ref = String(b.referrer || '').toLowerCase();
  if (/google\./.test(ref)) return 'Google Orgânico';
  if (/instagram\.com/.test(ref)) return 'Instagram';
  if (/facebook\.com|fb\.com/.test(ref)) return 'Facebook';
  return null;
}

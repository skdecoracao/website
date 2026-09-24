// Trava de conta Cloudflare: roda antes de todo deploy e migration
// (npm run deploy / npm run migra).
//
// Este CRM mora na conta da SK Decorações. O login do wrangler desta máquina é
// da eKarts, então publicar "com o login" poria o CRM da SK dentro da conta
// errada. Por isso a regra aqui é o inverso da do CRM da eKarts: é OBRIGATÓRIO
// ter CLOUDFLARE_API_TOKEN (o token da SK) e CLOUDFLARE_ACCOUNT_ID no ambiente,
// e o token precisa enxergar exatamente a conta esperada.

const CONTA_ESPERADA = 'f34a691822e7992e1719428ed1ff279a'; // SK Decorações

function morre(motivo) {
  console.error('\n  DEPLOY BLOQUEADO: ' + motivo);
  console.error('  Rode antes:');
  console.error('    set -a; . ~/.secrets/duarte.env; set +a');
  console.error('    export CLOUDFLARE_API_TOKEN="$CLOUDFLARE_SARAH_CRM_TOKEN"');
  console.error('    export CLOUDFLARE_ACCOUNT_ID="$CLOUDFLARE_SARAH_ACCOUNT_ID"\n');
  process.exit(1);
}

const token = process.env.CLOUDFLARE_API_TOKEN;
const contaEnv = process.env.CLOUDFLARE_ACCOUNT_ID;
if (!token) morre('CLOUDFLARE_API_TOKEN não está no ambiente (sem ele o wrangler usaria o login da eKarts).');
if (contaEnv !== CONTA_ESPERADA) morre(`CLOUDFLARE_ACCOUNT_ID é "${contaEnv || ''}", e este repositório é da conta ${CONTA_ESPERADA}.`);

// Token de conta (cfat_) é verificado na rota da conta; token de usuário, na do usuário.
const r = await fetch(`https://api.cloudflare.com/client/v4/accounts/${CONTA_ESPERADA}`, {
  headers: { Authorization: `Bearer ${token}` },
});
const d = await r.json().catch(() => ({}));
if (!d.success || d.result?.id !== CONTA_ESPERADA) {
  morre('o token do ambiente não enxerga a conta da SK Decorações: ' + JSON.stringify(d.errors || d));
}
console.log(`  conta confirmada: ${d.result.name} (${CONTA_ESPERADA})`);

#!/bin/sh
# Publica a LP no Cloudflare Pages da Sarah (projeto sk-decoracoes).
# Monta uma pasta dist só com o que é público e envia com o wrangler.
# As Pages Functions (functions/, ex.: /api/lead que repassa o formulário ao
# CRM) NÃO vão dentro de dist: o wrangler pages deploy compila a pasta
# functions/ do diretório onde roda, que é a raiz deste repositório.
set -e
cd "$(dirname "$0")"
rm -rf dist && mkdir dist
cp -R index.html assets robots.txt sitemap.xml llms.txt _headers google7e5729a4f7b26562.html favicon.ico favicon-48.png favicon-96.png apple-touch-icon.png icon-192.png icon-512.png site.webmanifest dist/
cp ./*[0-9a-f].txt dist/ 2>/dev/null || true
[ -f functions/api/lead.js ] || { echo "faltou functions/api/lead.js"; exit 1; }
set -a; . "$HOME/.secrets/duarte.env"; set +a
CLOUDFLARE_API_TOKEN="$CLOUDFLARE_SARAH_DEPLOY_TOKEN" CLOUDFLARE_ACCOUNT_ID="$CLOUDFLARE_SARAH_ACCOUNT_ID" \
  npx -y wrangler@latest pages deploy dist --project-name sk-decoracoes --branch main --commit-dirty=true

# Os arquivos de assets/ não têm hash no nome e o _headers manda o navegador e a
# borda guardarem por 30 dias. Sem limpar o cache da zona, o deploy entra no ar
# mas o visitante continua recebendo o main.js antigo (visto em 24/09/2026).
curl -sf -X POST "https://api.cloudflare.com/client/v4/zones/$CLOUDFLARE_SARAH_ZONE_ID/purge_cache" \
  -H "Authorization: Bearer $CLOUDFLARE_SARAH_DEPLOY_TOKEN" -H "Content-Type: application/json" \
  -d '{"purge_everything":true}' >/dev/null && echo "cache da zona limpo" || echo "AVISO: não consegui limpar o cache da zona"

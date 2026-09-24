#!/bin/sh
# Publica a LP no Cloudflare Pages da Sarah (projeto sk-decoracoes).
# Monta uma pasta dist só com o que é público e envia com o wrangler.
set -e
cd "$(dirname "$0")"
rm -rf dist && mkdir dist
cp -R index.html assets robots.txt sitemap.xml llms.txt _headers google7e5729a4f7b26562.html dist/
cp ./*[0-9a-f].txt dist/ 2>/dev/null || true
set -a; . "$HOME/.secrets/duarte.env"; set +a
CLOUDFLARE_API_TOKEN="$CLOUDFLARE_SARAH_DEPLOY_TOKEN" CLOUDFLARE_ACCOUNT_ID="$CLOUDFLARE_SARAH_ACCOUNT_ID" \
  npx -y wrangler@latest pages deploy dist --project-name sk-decoracoes --branch main --commit-dirty=true

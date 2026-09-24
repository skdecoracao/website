#!/bin/sh
# Rodar depois que os nameservers da GoDaddy apontarem para o Cloudflare.
# 1) confere se o domínio já serve a LP  2) verifica no Search Console e envia o sitemap
# 3) faz a Vercel redirecionar tudo para o domínio novo.
set -e
cd "$(dirname "$0")"
D=https://skdecoracao.com.br
dig +short NS skdecoracao.com.br | grep -q cloudflare || { echo "Nameservers ainda não são do Cloudflare."; exit 1; }
curl -s "$D/" | grep -q 'SK Decorações' || { echo "Domínio ainda não serve a LP (SSL pode estar sendo emitido)."; exit 1; }
set -a; . "$HOME/.secrets/duarte.env"; set +a
V=/private/tmp/sk-gsc-venv; [ -x $V/bin/python ] || { python3 -m venv $V && $V/bin/pip -q install google-auth requests; }
$V/bin/python - <<'PY'
import os,urllib.parse,requests
from google.oauth2 import service_account
import google.auth.transport.requests as r
c=service_account.Credentials.from_service_account_file(os.environ['GSC_SA_KEY_FILE'],scopes=['https://www.googleapis.com/auth/siteverification','https://www.googleapis.com/auth/webmasters'])
c.refresh(r.Request()); H={'Authorization':'Bearer '+c.token}
S='https://skdecoracao.com.br/'; E=urllib.parse.quote(S,safe='')
v=requests.post('https://www.googleapis.com/siteVerification/v1/webResource?verificationMethod=META',headers=H,json={'site':{'type':'SITE','identifier':S}}); print('verificação',v.status_code)
requests.put('https://www.googleapis.com/siteVerification/v1/webResource/'+E,headers=H,json={'site':{'type':'SITE','identifier':S},'owners':[os.environ['GSC_SA_EMAIL'],'gduarte3030@gmail.com']})
print('propriedade',requests.put('https://www.googleapis.com/webmasters/v3/sites/'+E,headers=H).status_code)
print('sitemap',requests.put('https://www.googleapis.com/webmasters/v3/sites/'+E+'/sitemaps/'+urllib.parse.quote(S+'sitemap.xml',safe=''),headers=H).status_code)
PY
curl -s -o /dev/null -w "indexnow %{http_code}\n" -X POST https://api.indexnow.org/indexnow -H 'Content-Type: application/json' -d "{\"host\":\"skdecoracao.com.br\",\"key\":\"$INDEXNOW_SK_KEY\",\"keyLocation\":\"$D/$INDEXNOW_SK_KEY.txt\",\"urlList\":[\"$D/\"]}"
# Vercel vira só redirecionamento
T=$(mktemp -d); cp .vercel -R "$T/" 2>/dev/null || cp -R .vercel "$T/"
printf '{"redirects":[{"source":"/(.*)","destination":"https://skdecoracao.com.br/$1","permanent":true}]}' > "$T/vercel.json"; echo ok > "$T/index.html"
(cd "$T" && npx -y vercel@latest deploy --prod --yes >/dev/null 2>&1) && echo "vercel redirecionando"
curl -s -o /dev/null -w "vercel.app -> %{http_code} %{redirect_url}\n" https://sk-decoracoes.vercel.app/

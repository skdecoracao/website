# CRM SK Decorações: entrada de leads

`POST https://crm.skdecoracao.com.br/api/ingest/lead`

Cabeçalhos: `Authorization: Bearer <CRM_INGEST_TOKEN>` e `Content-Type: application/json`.
O token fica só em servidor (segredo do Worker e da Pages Function do site), nunca no navegador.

## Corpo

| Campo | Obrigatório | O que é |
|---|---|---|
| `nome`, `email`, `telefone` | pelo menos um | Lead é encontrado por e-mail, depois por telefone; se não existir, é criado. |
| `origem` | não | Texto livre ("site", "instagram", "indicação"). Vira a origem canônica (`src/origem.js`). |
| `funil` | não | Nome do funil. Padrão `Vendas`. `false` ou `""` só registra o lead, sem negociação. |
| `etapa` | não | Nome da etapa. Padrão: a primeira do funil. |
| `titulo`, `valor` | não | Título da negociação (padrão: nome) e valor (só entra em negociação zerada). |
| `tags` | não | Lista de nomes; tag que não existe é criada. |
| `campos` | não | `{ chave ou rótulo: valor }`. Chaves do funil Vendas: `data_festa` (AAAA-MM-DD), `tema`, `pacote`, `entrega`, `local`. |
| `pagina`, `pagina_entrada`, `botao`, `referrer`, `utm_source`, `utm_medium`, `utm_campaign`, `utm_content`, `utm_term`, `fbclid`, `gclid`, `primeiro_acesso`, `mensagem` | não | Rastreamento. Vai para o evento `lead_ingerido` (primeiro toque) ou `reconversao` e aparece no bloco "Origem". |

Regras: origem é do primeiro toque (lead que volta não muda de origem); anúncio pago identificado
por `gclid` ou `utm_medium` pago vale mais que a origem declarada; lead com negociação aberta no
mesmo funil não ganha outra, a existente reesquenta para "Muito quente"; o preço entre parênteses
do pacote vira o valor da negociação quando ela ainda está zerada.

## Resposta

`201 { "ok": true, "lead_id": 12, "deal_id": 34, "campos_ignorados": ["..."] }`
(`campos_ignorados` só aparece quando alguma chave não existe no funil). `401` token inválido,
`400` sem nome/e-mail/telefone ou funil desconhecido.

## Outras rotas por token

`POST /api/cron/qualificacao` (mesmo Bearer): roda na hora a varredura que o cron faz de hora em hora.

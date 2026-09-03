# SK Decorações, landing page

Página única em HTML, CSS e JavaScript puros. Não tem build, não tem dependência
para instalar. Basta abrir o `index.html` num servidor estático.

## Rodar localmente

```bash
python3 -m http.server 4173
# depois abra http://localhost:4173/
```

Use um servidor mesmo (e não abrir o arquivo direto pelo Finder), porque os
caminhos das imagens e do CSS começam com `/`.

## Estrutura

```
index.html            todo o conteúdo e os textos da página
assets/css/style.css  cores, fontes e layout
assets/js/main.js     menu, máscara do telefone, formulário e animações
assets/favicon.svg    ícone da aba do navegador
assets/img/           fotos do hero, dos temas e da fundadora
referencias/          artes originais da cliente, não são usadas pela página
vercel.json           configuração de publicação na Vercel
```

## Como editar os textos

Todo o texto visível está no `index.html`, na ordem em que aparece na página.
Procure pelo trecho que quer mudar e edite direto. As seções estão marcadas com
comentários em maiúsculas, por exemplo `<!-- KITS -->` e `<!-- FAQ -->`.

## Como trocar o telefone do WhatsApp

O número aparece em dois formatos:

1. **Nos links** (`https://wa.me/5531987669094?text=...`): é o número com código
   do país e DDD, sem símbolos. Está no `index.html` em vários botões e também no
   `assets/js/main.js`, na constante `TELEFONE` no topo do arquivo.
2. **No texto do rodapé e no JSON-LD**: `(31) 98766-9094` e
   `+55-31-98766-9094`, ambos no `index.html`.

Para trocar, faça uma busca por `5531987669094` e por `98766-9094` e substitua
todas as ocorrências, inclusive a constante no JavaScript.

## Como trocar os depoimentos

Os três depoimentos de hoje são **ilustrativos** e estão marcados no HTML com o
comentário `<!-- DEPOIMENTOS ILUSTRATIVOS: substituir pelos reais da cliente
antes de divulgar -->`. Substitua o texto de cada `<blockquote>` e o nome em
`.depoimento__autor` pelos depoimentos reais antes de divulgar a página.

Na faixa logo abaixo do hero, os números marcados com
`data-placeholder="confirmar com a cliente"` (por exemplo "+ de 300 festas
montadas") também precisam ser confirmados antes de ir ao ar.

## Promoção com prazo

O card **Decoração Completa** está com a promoção "de R$ 870,00 por R$ 550,00",
válida para **setembro de 2026**. A data aparece em um lugar só, no atributo
`data-promo-mes` do card, e o selo visível diz "Promoção de setembro".

Quando a promoção acabar, faça uma destas coisas:

- atualize o mês no selo e no `data-promo-mes`, ou
- remova o selo, o `<s class="kit__de">` com o valor antigo e ajuste o preço.

## Imagens

As fotos ficam em `assets/img/`. Se quiser trocar, mantenha os mesmos nomes de
arquivo e as mesmas proporções:

- `hero.jpg`, 16:9
- `tema-infantil.jpg`, `tema-rosa.jpg`, `tema-cha-bebe.jpg`, `tema-adulto.jpg`, 1:1
- `fundadora.png`, quadrada (aparece recortada em círculo)

Se alguma imagem faltar, a moldura fica em creme e mostra a descrição do `alt`,
sem quebrar o layout.

## Cores e fontes

Estão todas no topo do `assets/css/style.css`, no bloco `:root`. Mude ali e a
página inteira acompanha. Não escreva cor fixa no meio do CSS.

Observação de acessibilidade: o dourado claro `#C9A24A` não tem contraste
suficiente para texto pequeno sobre o creme. Para texto pequeno em dourado use
`--ouro-forte` (`#86671F`); para títulos grandes, `--ouro-escuro` (`#A8842F`).

## Publicação

Projeto estático, pronto para a Vercel (o `vercel.json` já vem configurado) ou
para qualquer hospedagem de arquivos estáticos, como o Cloudflare Pages.

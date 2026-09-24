/* SK Decorações, comportamentos da landing page.
   Sem dependências. Tudo degrada com elegância se algo falhar. */

(function () {
  "use strict";

  var TELEFONE = "5531987669094";

  /* ------------------------------------- Primeiro acesso (rastreamento) --- */
  /* Guarda de onde a pessoa veio NA PRIMEIRA visita (utm, clique de anúncio,
     site anterior, página de entrada) e manda junto com o formulário, para o
     CRM saber qual canal trouxe o lead. Tudo em try/catch: navegador sem
     localStorage (aba anônima, bloqueio) simplesmente segue sem isso. */

  var CHAVE_RASTREIO = "sk_primeiro_acesso";
  var CAMPOS_URL = ["utm_source", "utm_medium", "utm_campaign", "utm_content", "utm_term", "fbclid", "gclid"];

  function lerRastreio() {
    try { return JSON.parse(window.localStorage.getItem(CHAVE_RASTREIO) || "null"); } catch (e) { return null; }
  }

  (function guardarPrimeiroAcesso() {
    try {
      if (lerRastreio()) return;
      var params = new URLSearchParams(window.location.search);
      var dados = {
        referrer: document.referrer && document.referrer.indexOf(window.location.host) === -1 ? document.referrer.slice(0, 300) : "",
        pagina_entrada: window.location.pathname + window.location.search.slice(0, 300),
        primeiro_acesso: new Date().toISOString()
      };
      CAMPOS_URL.forEach(function (k) { dados[k] = (params.get(k) || "").slice(0, 300); });
      window.localStorage.setItem(CHAVE_RASTREIO, JSON.stringify(dados));
    } catch (e) { /* sem armazenamento: segue sem rastreio */ }
  })();

  /* Evento para o Cloudflare Zaraz (quando houver ferramenta configurada lá).
     Nunca manda e-mail nem telefone. */
  function rastrearEvento(nome, dados) {
    try { if (window.zaraz && typeof window.zaraz.track === "function") window.zaraz.track(nome, dados || {}); } catch (e) { /* nada */ }
  }

  /* Clique em qualquer botão do WhatsApp: evento Contact com a origem do botão
     (atributo data-zap no HTML). */
  document.addEventListener("click", function (evento) {
    var link = evento.target.closest && evento.target.closest('a[href*="wa.me"]');
    if (!link) return;
    rastrearEvento("Contact", { origem: link.getAttribute("data-zap") || "whatsapp" });
  });

  /* ---------------------------------------------------- Menu no mobile --- */

  var btnMenu = document.getElementById("btn-menu");
  var menu = document.getElementById("menu-principal");

  if (btnMenu && menu) {
    btnMenu.addEventListener("click", function () {
      var aberto = menu.classList.toggle("aberto");
      btnMenu.setAttribute("aria-expanded", aberto ? "true" : "false");
      btnMenu.setAttribute("aria-label", aberto ? "Fechar menu de navegação" : "Abrir menu de navegação");
    });

    menu.addEventListener("click", function (evento) {
      if (evento.target.closest("a")) {
        menu.classList.remove("aberto");
        btnMenu.setAttribute("aria-expanded", "false");
        btnMenu.setAttribute("aria-label", "Abrir menu de navegação");
      }
    });

    document.addEventListener("keydown", function (evento) {
      if (evento.key === "Escape" && menu.classList.contains("aberto")) {
        menu.classList.remove("aberto");
        btnMenu.setAttribute("aria-expanded", "false");
        btnMenu.focus();
      }
    });
  }

  /* ------------------------------------------ Imagem que não carregou --- */

  function marcarFalhaDeImagem(img) {
    var caixa = img.closest("[data-moldura]");
    if (!caixa) return;
    caixa.setAttribute("data-legenda", img.getAttribute("alt") || "Imagem da decoração");
    caixa.classList.add("sem-img");
  }

  Array.prototype.forEach.call(document.querySelectorAll("[data-moldura] img"), function (img) {
    img.addEventListener("error", function () { marcarFalhaDeImagem(img); });
    if (img.complete && img.naturalWidth === 0) marcarFalhaDeImagem(img);
  });

  /* -------------------------------------------- Animações de entrada --- */

  var reveals = document.querySelectorAll(".reveal");
  var semMovimento = window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches;

  function revelarTudo() {
    Array.prototype.forEach.call(reveals, function (el) { el.classList.add("visivel"); });
  }

  if (!("IntersectionObserver" in window) || semMovimento) {
    revelarTudo();
  } else {
    var observador = new IntersectionObserver(function (entradas) {
      entradas.forEach(function (entrada) {
        if (entrada.isIntersecting) {
          entrada.target.classList.add("visivel");
          observador.unobserve(entrada.target);
        }
      });
    }, { rootMargin: "0px 0px -8% 0px", threshold: 0.08 });

    Array.prototype.forEach.call(reveals, function (el) { observador.observe(el); });

    /* Rede de segurança: o observador não roda enquanto a aba está oculta,
       e alguns navegadores atrasam a primeira checagem. A varredura abaixo
       garante que nenhum trecho da página fique invisível. */
    var agendado = false;

    function varrerViewport() {
      agendado = false;
      var altura = window.innerHeight || document.documentElement.clientHeight;
      var pendentes = document.querySelectorAll(".reveal:not(.visivel)");
      Array.prototype.forEach.call(pendentes, function (el) {
        var caixa = el.getBoundingClientRect();
        if (caixa.top < altura && caixa.bottom > 0) {
          el.classList.add("visivel");
          observador.unobserve(el);
        }
      });
    }

    function agendarVarredura() {
      if (agendado) return;
      agendado = true;
      window.requestAnimationFrame(varrerViewport);
    }

    /* Rolagem e redimensionamento passam pelo rAF, que só existe com a aba
       à vista. Os demais gatilhos chamam a varredura direto, porque com a
       aba em segundo plano o rAF fica parado e o topo ficaria invisível. */
    window.addEventListener("scroll", agendarVarredura, { passive: true });
    window.addEventListener("resize", agendarVarredura);
    window.addEventListener("pageshow", varrerViewport);
    window.addEventListener("load", varrerViewport);
    document.addEventListener("visibilitychange", varrerViewport);

    /* Espera o observador fazer o trabalho dele e, se nada acontecer,
       revela o que já está na tela. */
    window.setTimeout(varrerViewport, 700);
  }

  /* ------------------------------------------------------ Ano no rodapé --- */

  var ano = document.getElementById("ano");
  if (ano) ano.textContent = String(new Date().getFullYear());

  /* ------------------------------------------- Formulário de contato --- */

  var form = document.getElementById("form-contato");
  if (!form) return;

  var campoNome = document.getElementById("nome");
  var campoZap = document.getElementById("whatsapp");
  var campoEmail = document.getElementById("email");
  var campoTema = document.getElementById("tema");
  var campoMel = document.getElementById("apelido");
  var blocoSucesso = document.getElementById("form-sucesso");
  var linkSucesso = document.getElementById("link-sucesso");

  /* Máscara (31) 99999-9999 */
  function formatarTelefone(valor) {
    var digitos = valor.replace(/\D/g, "").slice(0, 11);
    if (digitos.length === 0) return "";
    if (digitos.length <= 2) return "(" + digitos;
    if (digitos.length <= 6) return "(" + digitos.slice(0, 2) + ") " + digitos.slice(2);
    if (digitos.length <= 10) return "(" + digitos.slice(0, 2) + ") " + digitos.slice(2, 6) + "-" + digitos.slice(6);
    return "(" + digitos.slice(0, 2) + ") " + digitos.slice(2, 7) + "-" + digitos.slice(7);
  }

  campoZap.addEventListener("input", function () {
    var antes = campoZap.value;
    var depois = formatarTelefone(antes);
    if (antes !== depois) campoZap.value = depois;
  });

  function mostrarErro(campo, idErro, temErro) {
    var aviso = document.getElementById(idErro);
    if (aviso) aviso.hidden = !temErro;
    if (temErro) {
      campo.setAttribute("aria-invalid", "true");
    } else {
      campo.removeAttribute("aria-invalid");
    }
    return !temErro;
  }

  function validar() {
    var okNome = mostrarErro(campoNome, "erro-nome", campoNome.value.trim().length < 2);
    var digitos = campoZap.value.replace(/\D/g, "");
    var okZap = mostrarErro(campoZap, "erro-whatsapp", digitos.length < 10 || digitos.length > 11);
    var okEmail = mostrarErro(campoEmail, "erro-email", !/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(campoEmail.value.trim()));

    if (!okNome) { campoNome.focus(); return false; }
    if (!okZap) { campoZap.focus(); return false; }
    if (!okEmail) { campoEmail.focus(); return false; }
    return true;
  }

  form.addEventListener("submit", function (evento) {
    evento.preventDefault();

    /* Armadilha para robô: se veio preenchido, encerra em silêncio. */
    if (campoMel && campoMel.value.trim() !== "") return;

    if (!validar()) return;

    var tema = campoTema.value.trim();
    var mensagem =
      "Olá, SK Decorações! Meu nome é " + campoNome.value.trim() + ". " +
      "Quero um orçamento de decoração. " +
      "Meu WhatsApp: " + campoZap.value.trim() + ". " +
      "E-mail: " + campoEmail.value.trim() + ". " +
      "Tema/data: " + (tema !== "" ? tema : "a combinar") + ".";

    var url = "https://wa.me/" + TELEFONE + "?text=" + encodeURIComponent(mensagem);

    /* Registra o lead no CRM sem esperar a resposta: o WhatsApp abre logo em
       seguida, dê certo ou não (keepalive mantém o envio mesmo se a aba sair). */
    var rastreio = lerRastreio() || {};
    rastreio.pagina = window.location.pathname;
    try {
      window.fetch("/api/lead", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          nome: campoNome.value.trim(),
          telefone: campoZap.value.trim(),
          email: campoEmail.value.trim(),
          tema: tema,
          apelido: campoMel ? campoMel.value : "",
          rastreio: rastreio
        }),
        keepalive: true
      }).catch(function () { /* falhou: o WhatsApp abre do mesmo jeito */ });
    } catch (e) { /* navegador sem fetch: segue para o WhatsApp */ }

    rastrearEvento("Lead", tema !== "" ? { tema: tema.slice(0, 100) } : {});

    if (linkSucesso) linkSucesso.href = url;

    form.hidden = true;
    if (blocoSucesso) {
      blocoSucesso.hidden = false;
      blocoSucesso.focus();
    }

    var janela = window.open(url, "_blank", "noopener");
    if (!janela) window.location.href = url;
  });
})();

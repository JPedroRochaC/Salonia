// ============================================================
// CONFIG
// ============================================================
const SUPABASE_URL = "https://jzmvyeewfxinjryyovwa.supabase.co";
const SUPABASE_ANON_KEY =
  "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Imp6bXZ5ZWV3ZnhpbmpyeXlvdndhIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODQxNjI5NDYsImV4cCI6MjA5OTczODk0Nn0.nVrhkatd8tuhNNF7inEajxnbYNm6bB7SMIpgfpOIGk0";

const sb = supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
  global: { headers: { apikey: SUPABASE_ANON_KEY } },
});

// ============================================================
// ESTADO CENTRALIZADO
// ============================================================
const estado = {
  salao: null,
  servico: null,
  profissional: null,
  horario: null, // objeto Date (horário local)
  passo: 0,
  nomeCliente: "",
  telefoneCliente: "",
  agendamentoId: null, // preenchido após confirmar, usado pra anexar o comprovante do sinal
};

// ============================================================
// UTILS
// ============================================================
const el = (id) => document.getElementById(id);

// Converte Date local pra ISO sem converter pra UTC (evita bug de fuso horário)
function dataLocalParaISO(date) {
  const pad = (n) => String(n).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}:00`;
}

// Cria elemento com textContent seguro (evita XSS)
function criarEl(tag, classes, texto) {
  const el = document.createElement(tag);
  if (classes) el.className = classes;
  if (texto !== undefined) el.textContent = texto;
  return el;
}

// Máscara simples de telefone BR: (85) 99999-9999
function aplicarMascaraTelefone(valor) {
  return valor
    .replace(/\D/g, "")
    .replace(/^(\d{2})(\d)/, "($1) $2")
    .replace(/(\d{5})(\d)/, "$1-$2")
    .slice(0, 15);
}

// Valida telefone BR (mínimo 10 dígitos)
function validarTelefone(valor) {
  const digitos = valor.replace(/\D/g, "");
  return digitos.length >= 10 && digitos.length <= 11;
}

function mostrarErroGlobal(msg) {
  const erroEl = el("erroEnvio");
  if (!erroEl) return;
  erroEl.textContent = msg;
  erroEl.hidden = false;
}

function esconderErroGlobal() {
  const erroEl = el("erroEnvio");
  if (erroEl) erroEl.hidden = true;
}

// ============================================================
// INIT
// ============================================================
const partesUrl = window.location.pathname.split("/").filter(Boolean);
const slug = partesUrl[0];
const modoAgendar = partesUrl[1] === "agendar";
const modoPortfolio = partesUrl[1] === "portfolio";

// Aplica, na hora, a última cor conhecida desse salão (salva em visitas
// anteriores) — evita a tela de "Carregando..." piscar rosa (cor padrão)
// enquanto os dados do salão ainda estão vindo do banco.
if (slug) aplicarCoresCache(slug);

init();

async function init() {
  if (!slug) {
    mostrarNaoEncontrado();
    return;
  }

  const { data, error } = await sb
    .from("saloes")
    .select("*")
    .eq("slug", slug)
    .maybeSingle();

  if (error) {
    console.error("Erro ao buscar salão:", error);
    mostrarNaoEncontrado();
    return;
  }
  if (!data) {
    mostrarNaoEncontrado();
    return;
  }

  // campo "ativo" pode não existir ainda em salões antigos — só bloqueia se for explicitamente false
  if (data.ativo === false) {
    mostrarInativo(data);
    return;
  }

  estado.salao = data;

  aplicarPersonalizacao();
  montarMenu();
  configurarMenuHamburguer();
  configurarIara();

  el("loadingState").hidden = true;
  el("app").hidden = false;

  el("viewHome").hidden = true;
  el("viewWizard").hidden = true;
  el("viewPortfolio").hidden = true;

  if (modoAgendar) {
    el("viewWizard").hidden = false;
    document.title = `Agendar — ${estado.salao.nome}`;
    definirMetaDescricao(
      `Agende seu horário no ${estado.salao.nome} em poucos cliques.`,
    );
    iniciarWizard();
  } else if (modoPortfolio) {
    el("viewPortfolio").hidden = false;
    document.title = `Portfólio — ${estado.salao.nome}`;
    definirMetaDescricao(`Veja fotos dos trabalhos do ${estado.salao.nome}.`);
    montarPaginaPortfolio();
  } else {
    el("viewHome").hidden = false;
    document.title = estado.salao.nome;
    definirMetaDescricao(
      `Agende seu horário no ${estado.salao.nome}. ${estado.salao.endereco || ""}`.trim(),
    );
    montarHome();
  }
}

function mostrarNaoEncontrado() {
  el("loadingState").hidden = true;
  el("notFoundState").hidden = false;
}

function mostrarInativo(salao) {
  el("loadingState").hidden = true;
  if (salao?.nome) {
    el("inactiveNome").textContent = `${salao.nome} pausou os agendamentos`;
  }
  el("inactiveState").hidden = false;
}

// Atualiza a <meta name="description"> pra SEO básico por página
function definirMetaDescricao(texto) {
  const metaEl = el("metaDescricao");
  if (metaEl) metaEl.setAttribute("content", texto);
}

// ============================================================
// PERSONALIZAÇÃO
// ============================================================

// Mistura duas cores hex. quantidadeB=0 devolve corA puro, quantidadeB=1 devolve corB puro.
// Serve pra derivar tons (cards, hover) a partir das 2 cores que a dona escolhe,
// sem precisar de mais campos no banco.
function misturarCores(corA, corB, quantidadeB) {
  const hexParaRgb = (hex) => {
    const limpo = hex.replace("#", "");
    const cheio =
      limpo.length === 3
        ? limpo
            .split("")
            .map((c) => c + c)
            .join("")
        : limpo;
    const bigint = parseInt(cheio, 16);
    return [(bigint >> 16) & 255, (bigint >> 8) & 255, bigint & 255];
  };
  const rgbParaHex = (r, g, b) =>
    "#" +
    [r, g, b]
      .map((v) =>
        Math.round(Math.min(255, Math.max(0, v)))
          .toString(16)
          .padStart(2, "0"),
      )
      .join("");

  try {
    const [r1, g1, b1] = hexParaRgb(corA);
    const [r2, g2, b2] = hexParaRgb(corB);
    return rgbParaHex(
      r1 + (r2 - r1) * quantidadeB,
      g1 + (g2 - g1) * quantidadeB,
      b1 + (b2 - b1) * quantidadeB,
    );
  } catch {
    return corA; // cor inválida: não quebra a página, só ignora a mistura
  }
}

// Diz se uma cor hex é "clara" ou "escura" (luminância perceptiva),
// pra decidir se o texto por cima dela deve ser escuro ou claro.
function corEhClara(hex) {
  try {
    const limpo = hex.replace("#", "");
    const cheio =
      limpo.length === 3
        ? limpo
            .split("")
            .map((c) => c + c)
            .join("")
        : limpo;
    const bigint = parseInt(cheio, 16);
    const r = (bigint >> 16) & 255;
    const g = (bigint >> 8) & 255;
    const b = bigint & 255;
    const luminancia = (r * 299 + g * 587 + b * 114) / 1000; // 0 (preto) a 255 (branco)
    return luminancia > 150;
  } catch {
    return true; // cor inválida: assume claro, que é o comportamento padrão de hoje
  }
}

function chaveCorCache(slugSalao) {
  return `salao_cores_${slugSalao}`;
}

// Aplica só as variáveis de cor (usado tanto com os dados reais do salão
// quanto com o cache salvo de uma visita anterior, antes do banco responder)
function aplicarCoresVisuais(corDestaque, corFundo) {
  const accent = corDestaque || "#d10505";
  document.documentElement.style.setProperty("--accent", accent);
  document.documentElement.style.setProperty(
    "--accent-hover",
    misturarCores(accent, "#000000", 0.15),
  );

  const fundo = corFundo || "#ffaaaa";
  document.documentElement.style.setProperty("--pink", fundo);
  document.documentElement.style.setProperty(
    "--cream",
    misturarCores(fundo, "#ffffff", 0.6),
  );

  if (corEhClara(fundo)) {
    document.documentElement.style.setProperty("--brown", "#141414");
    document.documentElement.style.setProperty(
      "--brown-soft",
      "rgba(20, 20, 20, 0.62)",
    );
    document.documentElement.style.setProperty(
      "--border-soft",
      "rgba(20, 20, 20, 0.12)",
    );
    document.documentElement.style.setProperty(
      "--border-strong",
      "rgba(20, 20, 20, 0.22)",
    );
  } else {
    document.documentElement.style.setProperty("--brown", "#ffffff");
    document.documentElement.style.setProperty(
      "--brown-soft",
      "rgba(255, 255, 255, 0.72)",
    );
    document.documentElement.style.setProperty(
      "--border-soft",
      "rgba(255, 255, 255, 0.14)",
    );
    document.documentElement.style.setProperty(
      "--border-strong",
      "rgba(255, 255, 255, 0.28)",
    );
  }
}

// Lê o cache de cores dessa slug (se existir) e já aplica, antes da busca no banco
function aplicarCoresCache(slugSalao) {
  try {
    const cache = localStorage.getItem(chaveCorCache(slugSalao));
    if (!cache) return;
    const { cor_destaque, cor_fundo } = JSON.parse(cache);
    aplicarCoresVisuais(cor_destaque, cor_fundo);
  } catch {
    // cache corrompido ou localStorage indisponível: ignora, mantém o padrão
  }
}

// Salva as cores reais desse salão pra próxima visita já nascer com a cor certa
function salvarCoresCache(slugSalao, corDestaque, corFundo) {
  try {
    localStorage.setItem(
      chaveCorCache(slugSalao),
      JSON.stringify({ cor_destaque: corDestaque, cor_fundo: corFundo }),
    );
  } catch {
    // localStorage indisponível (modo privado etc.): sem problema, só não guarda
  }
}

// ============================================================
// HORÁRIO DE FUNCIONAMENTO (por dia da semana)
// ============================================================
// Modelo novo: salao.horarios_excecao guarda, pra cada dia da semana
// (chave "0" a "6", igual Date.getDay(): 0=domingo...6=sábado), se o salão
// abre nesse dia e o horário próprio dele:
//   { "1": { aberto: true, abertura: "09:00", fechamento: "19:00" },
//     "6": { aberto: true, abertura: "09:00", fechamento: "14:00" },
//     "0": { aberto: false } }
// Se essa configuração ainda não existir (salão antigo, configurado antes
// dessa mudança), caímos pro modelo antigo: um horário único
// (horario_abertura/horario_fechamento) aplicado aos dias marcados em
// dias_funcionamento.
const DIAS_ABREV = ["Dom", "Seg", "Ter", "Qua", "Qui", "Sex", "Sáb"];

const NOMES_DIAS_PARA_INDICE = {
  domingo: 0,
  dom: 0,
  segunda: 1,
  "segunda-feira": 1,
  seg: 1,
  terca: 2,
  "terca-feira": 2,
  ter: 2,
  quarta: 3,
  "quarta-feira": 3,
  qua: 3,
  quinta: 4,
  "quinta-feira": 4,
  qui: 4,
  sexta: 5,
  "sexta-feira": 5,
  sex: 5,
  sabado: 6,
  "sabado-feira": 6,
  sab: 6,
};

function removerAcentos(texto) {
  return texto.normalize("NFD").replace(/[\u0300-\u036f]/g, "");
}

// (modelo antigo) converte dias_funcionamento, em qualquer formato salvo,
// numa lista de índices 0-6
function normalizarDiasFuncionamento(dias) {
  if (!Array.isArray(dias) || dias.length === 0) return [];
  const indices = dias
    .map((item) => {
      if (typeof item === "number") return item;
      if (typeof item === "string") {
        const limpo = removerAcentos(item.trim().toLowerCase());
        if (/^\d+$/.test(limpo)) return Number(limpo);
        return NOMES_DIAS_PARA_INDICE[limpo] ?? null;
      }
      return null;
    })
    .filter((d) => d !== null && d >= 0 && d <= 6);
  return [...new Set(indices)];
}

// Devolve { aberto, abertura, fechamento } pro dia da semana pedido (0-6),
// já resolvendo modelo novo vs. modelo antigo.
function obterHorarioDoDia(salao, diaSemana) {
  const porDia = salao?.horarios_excecao;

  if (porDia && typeof porDia === "object" && !Array.isArray(porDia)) {
    const config = porDia[diaSemana] ?? porDia[String(diaSemana)];
    if (config) {
      return {
        aberto: config.aberto !== false,
        abertura: (config.abertura || salao.horario_abertura || "").slice(0, 5),
        fechamento: (config.fechamento || salao.horario_fechamento || "").slice(0, 5),
      };
    }
  }

  // modelo antigo (fallback)
  const diasAntigos = normalizarDiasFuncionamento(salao?.dias_funcionamento);
  const semRestricao =
    typeof salao?.dias_funcionamento === "string" || diasAntigos.length === 0;

  return {
    aberto: semRestricao || diasAntigos.includes(diaSemana),
    abertura: (salao?.horario_abertura || "").slice(0, 5),
    fechamento: (salao?.horario_fechamento || "").slice(0, 5),
  };
}

function salaoAbreNoDia(salao, date) {
  return obterHorarioDoDia(salao, date.getDay()).aberto;
}

// Monta um texto único juntando os dias com o mesmo horário, tipo:
// "Seg a Sex: 09:00 às 19:00 · Sáb: 09:00 às 14:00"
function formatarHorarioSemana(salao) {
  const infos = [];
  for (let d = 0; d <= 6; d++) infos.push(obterHorarioDoDia(salao, d));

  if (infos.every((info) => !info.aberto)) return "Fechado";

  const assinatura = (info) =>
    info.aberto ? `${info.abertura}|${info.fechamento}` : "fechado";

  const visitado = new Array(7).fill(false);
  const grupos = [];

  for (let d = 0; d <= 6; d++) {
    if (visitado[d] || !infos[d].aberto) continue;
    const chave = assinatura(infos[d]);
    let fim = d;
    visitado[d] = true;
    while (
      infos[(fim + 1) % 7]?.aberto &&
      assinatura(infos[(fim + 1) % 7]) === chave &&
      !visitado[(fim + 1) % 7]
    ) {
      fim = (fim + 1) % 7;
      visitado[fim] = true;
    }
    grupos.push({ inicio: d, fim, abertura: infos[d].abertura, fechamento: infos[d].fechamento });
  }

  return grupos
    .map((g) => {
      const diasTexto =
        g.inicio === g.fim
          ? DIAS_ABREV[g.inicio]
          : `${DIAS_ABREV[g.inicio]} a ${DIAS_ABREV[g.fim]}`;
      return `${diasTexto}: ${g.abertura} às ${g.fechamento}`;
    })
    .join(" · ");
}

function aplicarPersonalizacao() {
  const { salao } = estado;

  // cor de destaque (topbar, botões, dots) — o hover fica um pouco mais escuro
  // automaticamente, pra não precisar de mais um campo no banco só pra isso.
  // cor de fundo da página — e o "--cream", usado em quase todo card/superfície
  // (drawer do menu, resumo, Pix, portfólio, etc.), passa a ser um tom mais claro
  // dessa mesma cor, em vez de ficar fixo.
  aplicarCoresVisuais(salao.cor_destaque, salao.cor_fundo);
  salvarCoresCache(slug, salao.cor_destaque || "#d10505", salao.cor_fundo || "#ffaaaa");

  // nome do salão
  el("salaoNome").textContent = salao.nome;

  // logo (topbar)
  if (salao.logo_url) {
    el("salaoLogo").src = salao.logo_url;
    el("salaoLogo").alt = salao.nome;
    el("salaoLogo").hidden = false;
  }

  // ícone da aba do navegador (favicon) e título — usa a mesma logo/nome
  // configurados na Personalização, em vez de ficar genérico
  if (salao.logo_url) {
    el("favicon").href = salao.logo_url;
  }
  if (salao.nome) {
    document.title = salao.nome;
  }
}

// ============================================================
// MENU
// ============================================================
function montarMenu() {
  const { salao } = estado;
  el("menuEndereco").textContent = salao.endereco || "Não informado";
  el("menuHorario").textContent = formatarHorarioSemana(salao);
  montarRedesSociais();
  carregarPortfolio();
  el("menuPortfolioLink").href = `/${slug}/portfolio`;
}

// Lê o jsonb "redes_sociais" do salão, ex: { instagram: "meusalao", whatsapp: "5585999999999" }
// Aceita tanto um handle/telefone puro quanto uma URL completa já pronta.
function montarRedesSociais() {
  const redes = estado.salao.redes_sociais || {};
  let algumaVisivel = false;

  if (redes.instagram) {
    const valor = String(redes.instagram).trim();
    const link = el("menuInstagram");
    link.href = valor.startsWith("http")
      ? valor
      : `https://instagram.com/${valor.replace(/^@/, "")}`;
    link.hidden = false;
    algumaVisivel = true;
  }

  if (redes.whatsapp) {
    const digitos = String(redes.whatsapp).replace(/\D/g, "");
    const link = el("menuWhatsapp");
    link.href = `https://wa.me/${digitos}`;
    link.hidden = false;
    algumaVisivel = true;
  }

  el("menuRedesSecao").hidden = !algumaVisivel;
}

async function carregarPortfolio() {
  const { data, error } = await sb
    .from("portfolio")
    .select("*")
    .eq("salao_id", estado.salao.id)
    .order("ordem")
    .limit(6); // só uma prévia aqui; a página /portfolio mostra todas

  const container = el("menuPortfolio");
  container.innerHTML = "";

  if (error) {
    console.error("Erro ao carregar portfólio:", error);
    el("menuPortfolioVazio").hidden = false;
    return;
  }

  if (!data || data.length === 0) {
    el("menuPortfolioVazio").hidden = false;
    el("menuPortfolioLink").hidden = true;
    return;
  }

  data.forEach((foto) => {
    const img = document.createElement("img");
    img.src = foto.imagem_url;
    img.alt = foto.descricao || "";
    container.appendChild(img);
  });

  el("menuPortfolioLink").hidden = false;
}

// ============================================================
// PÁGINA DE PORTFÓLIO (/:slug/portfolio)
// ============================================================
async function montarPaginaPortfolio() {
  const { salao } = estado;
  el("portfolioTitulo").textContent = `Portfólio — ${salao.nome}`;
  el("portfolioVoltarBtn").href = `/${slug}`;
  el("portfolioAgendarBtn").href = `/${slug}/agendar`;
  el("portfolioAgendarBtnTop").href = `/${slug}/agendar`;

  if (salao.logo_url) {
    el("portfolioLogo").src = salao.logo_url;
    el("portfolioLogo").alt = salao.nome;
    el("portfolioLogo").hidden = false;
  }

  const container = el("portfolioFotos");
  container.innerHTML = "";

  const { data, error } = await sb
    .from("portfolio")
    .select("*")
    .eq("salao_id", salao.id)
    .order("ordem");

  if (error) {
    console.error("Erro ao carregar portfólio:", error);
    el("portfolioVazio").textContent =
      "Erro ao carregar o portfólio. Recarregue a página.";
    el("portfolioVazio").hidden = false;
    return;
  }

  if (!data || data.length === 0) {
    el("portfolioVazio").hidden = false;
    return;
  }

  estado.fotosPortfolio = data;

  data.forEach((foto, indice) => {
    const item = criarEl("button", "portfolio-item");
    item.type = "button";
    const img = document.createElement("img");
    img.src = foto.imagem_url;
    img.alt = foto.descricao || "";
    img.loading = "lazy";
    item.appendChild(img);
    if (foto.descricao) {
      item.appendChild(criarEl("p", null, foto.descricao));
    }
    item.addEventListener("click", () => abrirLightbox(indice));
    container.appendChild(item);
  });

  configurarLightbox();
}

// ============================================================
// LIGHTBOX DO PORTFÓLIO
// ============================================================
let lightboxIndiceAtual = 0;

function abrirLightbox(indice) {
  lightboxIndiceAtual = indice;
  mostrarFotoLightbox();
  el("portfolioLightbox").hidden = false;
}

function fecharLightbox() {
  el("portfolioLightbox").hidden = true;
}

function mostrarFotoLightbox() {
  const fotos = estado.fotosPortfolio || [];
  const foto = fotos[lightboxIndiceAtual];
  if (!foto) return;
  el("lightboxImg").src = foto.imagem_url;
  el("lightboxImg").alt = foto.descricao || "";
  el("lightboxLegenda").textContent = foto.descricao || "";
}

function lightboxAnterior() {
  const fotos = estado.fotosPortfolio || [];
  lightboxIndiceAtual = (lightboxIndiceAtual - 1 + fotos.length) % fotos.length;
  mostrarFotoLightbox();
}

function lightboxProximo() {
  const fotos = estado.fotosPortfolio || [];
  lightboxIndiceAtual = (lightboxIndiceAtual + 1) % fotos.length;
  mostrarFotoLightbox();
}

function configurarLightbox() {
  if (estado.lightboxConfigurado) return; // listeners só precisam ser presos uma vez
  estado.lightboxConfigurado = true;

  el("lightboxFechar").addEventListener("click", fecharLightbox);
  el("lightboxAnterior").addEventListener("click", lightboxAnterior);
  el("lightboxProximo").addEventListener("click", lightboxProximo);

  el("portfolioLightbox").addEventListener("click", (e) => {
    if (e.target === el("portfolioLightbox")) fecharLightbox(); // clicou fora da foto
  });

  document.addEventListener("keydown", (e) => {
    if (el("portfolioLightbox").hidden) return;
    if (e.key === "Escape") fecharLightbox();
    if (e.key === "ArrowLeft") lightboxAnterior();
    if (e.key === "ArrowRight") lightboxProximo();
  });
}

function configurarMenuHamburguer() {
  const drawer = el("menuDrawer");
  const overlay = el("menuOverlay");

  const abrir = () => {
    drawer.classList.add("aberto");
    overlay.hidden = false;
  };
  const fechar = () => {
    drawer.classList.remove("aberto");
    overlay.hidden = true;
  };

  el("menuBtn").addEventListener("click", abrir);
  el("menuCloseBtn").addEventListener("click", fechar);
  overlay.addEventListener("click", fechar);
}

// ============================================================
// HOME
// ============================================================
function montarHome() {
  const { salao } = estado;
  if (salao.logo_url) {
    el("heroLogo").src = salao.logo_url;
    el("heroLogo").hidden = false;
  }
  el("heroNome").textContent = salao.nome;
  el("heroEndereco").textContent = salao.endereco || "";
  el("heroHorario").textContent = `Aberto ${formatarHorarioSemana(salao)}`;
  el("agendarBtn").href = `/${slug}/agendar`;
}

// ============================================================
// WIZARD
// ============================================================
async function iniciarWizard() {
  document
    .querySelectorAll(".wizard-back")
    .forEach((btn) => btn.addEventListener("click", voltarPasso));

  // máscara de telefone
  el("inputTelefone").addEventListener("input", (e) => {
    e.target.value = aplicarMascaraTelefone(e.target.value);
  });
  el("btnContinuarServico").addEventListener("click", () => {
    carregarProfissionais();
    irParaPasso(1);
  });
  el("btnContinuarProfissional").addEventListener("click", () =>
    irParaPasso(2),
  );

  el("inputData").min = new Date().toISOString().slice(0, 10);
  el("inputData").addEventListener("change", carregarHorarios);
  el("btnContinuarHorario").addEventListener("click", () => irParaPasso(3));
  el("btnContinuarDados").addEventListener("click", validarDados);
  el("btnConfirmar").addEventListener("click", confirmarAgendamento);

  configurarPagamentoSinal();

  await carregarServicos();
}

function irParaPasso(indice) {
  document.querySelectorAll(".wizard-step[data-step]").forEach((s) => {
    s.hidden = s.dataset.step !== String(indice);
  });
  document.querySelectorAll(".step-dot").forEach((dot) => {
    dot.classList.toggle("active", dot.dataset.stepDot === String(indice));
  });
  estado.passo = indice;
  esconderErroGlobal();
  window.scrollTo(0, 0);
}

function voltarPasso() {
  irParaPasso(Math.max(0, estado.passo - 1));
}

function selecionarCard(containerSelector, btnClicado) {
  document
    .querySelectorAll(`${containerSelector} .option-card`)
    .forEach((c) => c.classList.remove("selected"));
  btnClicado.classList.add("selected");
}

async function carregarServicos() {
  const container = el("listaServicos");
  container.innerHTML = "";
  container.appendChild(criarEl("p", "menu-vazio", "Carregando serviços..."));

  const { data, error } = await sb
    .from("servicos")
    .select("*")
    .eq("salao_id", estado.salao.id)
    .eq("ativo", true)
    .order("nome");

  container.innerHTML = "";
  el("btnContinuarServico").hidden = true;
  el("btnContinuarServico").disabled = true;

  if (error) {
    console.error("Erro ao carregar serviços:", error);
    container.appendChild(
      criarEl(
        "p",
        "menu-vazio",
        "Erro ao carregar serviços. Recarregue a página.",
      ),
    );
    return;
  }

  if (!data || data.length === 0) {
    container.appendChild(
      criarEl("p", "menu-vazio", "Nenhum serviço disponível."),
    );
    return;
  }

  data.forEach((servico) => {
    const btn = document.createElement("button");
    btn.className = "option-card";

    const nome = criarEl("strong", null, servico.nome);
    const info = criarEl(
      "span",
      null,
      `${servico.duracao_minutos}min — R$ ${Number(servico.preco).toFixed(2)}`,
    );
    btn.appendChild(nome);
    btn.appendChild(info);

    btn.addEventListener("click", () => {
      estado.servico = servico;
      estado.profissional = null;
      estado.horario = null;
      selecionarCard("#listaServicos", btn);
      el("btnContinuarServico").hidden = false;
      el("btnContinuarServico").disabled = false;
    });

    container.appendChild(btn);
  });
}

async function carregarProfissionais() {
  const container = el("listaProfissionais");
  container.innerHTML = "";
  container.appendChild(
    criarEl("p", "menu-vazio", "Carregando profissionais..."),
  );

  const { data, error } = await sb
    .from("profissional_servicos")
    .select("profissional:profissionais(*)")
    .eq("servico_id", estado.servico.id);

  container.innerHTML = "";
  el("btnContinuarProfissional").hidden = true;
  el("btnContinuarProfissional").disabled = true;

  if (error) {
    console.error("Erro ao carregar profissionais:", error);
    container.appendChild(
      criarEl(
        "p",
        "menu-vazio",
        "Erro ao carregar profissionais. Tente novamente.",
      ),
    );
    return;
  }

  const ativos = (data || [])
    .map((row) => row.profissional)
    .filter((p) => p && p.ativo);

  if (ativos.length === 0) {
    container.appendChild(
      criarEl(
        "p",
        "menu-vazio",
        "Nenhuma profissional disponível para esse serviço.",
      ),
    );
    return;
  }

  ativos.forEach((prof) => {
    const btn = document.createElement("button");
    btn.className = "option-card";
    btn.appendChild(criarEl("strong", null, prof.nome));

    btn.addEventListener("click", () => {
      estado.profissional = prof;
      estado.horario = null;
      selecionarCard("#listaProfissionais", btn);
      el("btnContinuarProfissional").hidden = false;
      el("btnContinuarProfissional").disabled = false;
    });

    container.appendChild(btn);
  });
}

async function carregarHorarios() {
  const dataValor = el("inputData").value;
  if (!dataValor) return;

  const container = el("listaHorarios");
  container.innerHTML = "";
  el("semHorarios").hidden = true;
  el("semHorarios").textContent = "Nenhum horário livre nesse dia.";
  el("btnContinuarHorario").hidden = true;

  // datas no fuso local (sem conversão UTC)
  const inicioDia = new Date(`${dataValor}T00:00:00`);
  const fimDia = new Date(`${dataValor}T23:59:59`);

  if (!salaoAbreNoDia(estado.salao, inicioDia)) {
    el("semHorarios").textContent =
      "O salão não abre nesse dia. Escolha outra data.";
    el("semHorarios").hidden = false;
    return;
  }

  container.appendChild(
    criarEl("p", "menu-vazio", "Calculando horários disponíveis..."),
  );

  const { data: ocupados, error } = await sb
    .from("agenda_publica")
    .select("data_hora, duracao_minutos")
    .eq("profissional_id", estado.profissional.id)
    .gte("data_hora", dataLocalParaISO(inicioDia))
    .lte("data_hora", dataLocalParaISO(fimDia));

  container.innerHTML = "";

  if (error) {
    console.error("Erro ao carregar horários:", error);
    container.appendChild(
      criarEl("p", "menu-vazio", "Erro ao carregar horários. Tente novamente."),
    );
    return;
  }

  const { salao, servico } = estado;
  const infoDia = obterHorarioDoDia(salao, inicioDia.getDay());
  const [horaAb, minAb] = infoDia.abertura.split(":").map(Number);
  const [horaFe, minFe] = infoDia.fechamento.split(":").map(Number);

  const abertura = new Date(`${dataValor}T00:00:00`);
  abertura.setHours(horaAb, minAb, 0, 0);

  const fechamento = new Date(`${dataValor}T00:00:00`);
  fechamento.setHours(horaFe, minFe, 0, 0);

  const duracao = servico.duracao_minutos;
  const intervalo = 30;

  const blocosOcupados = (ocupados || []).map((o) => {
    const ini = new Date(o.data_hora);
    const fim = new Date(ini.getTime() + o.duracao_minutos * 60000);
    return [ini, fim];
  });

  const livres = [];
  let cursor = new Date(abertura);

  while (cursor.getTime() + duracao * 60000 <= fechamento.getTime()) {
    const fimSlot = new Date(cursor.getTime() + duracao * 60000);
    const conflita = blocosOcupados.some(
      ([ini, fim]) => cursor < fim && fimSlot > ini,
    );
    if (!conflita) livres.push(new Date(cursor));
    cursor = new Date(cursor.getTime() + intervalo * 60000);
  }

  if (livres.length === 0) {
    el("semHorarios").hidden = false;
    return;
  }

  livres.forEach((h) => {
    const btn = document.createElement("button");
    btn.className = "slot-btn";
    btn.textContent = h.toLocaleTimeString("pt-BR", {
      hour: "2-digit",
      minute: "2-digit",
    });
    btn.addEventListener("click", () => {
      estado.horario = h;
      document
        .querySelectorAll(".slot-btn")
        .forEach((b) => b.classList.remove("selected"));
      btn.classList.add("selected");
      el("btnContinuarHorario").hidden = false;
    });
    container.appendChild(btn);
  });
}

function validarDados() {
  const nome = el("inputNome").value.trim();
  const telefone = el("inputTelefone").value.trim();

  if (nome.length < 2) {
    alert("Por favor, insira seu nome completo.");
    return;
  }

  if (!validarTelefone(telefone)) {
    alert("Por favor, insira um WhatsApp válido com DDD.");
    return;
  }

  estado.nomeCliente = nome;
  estado.telefoneCliente = telefone;

  const { servico, profissional, horario, salao } = estado;
  el("resumoServico").textContent = servico.nome;
  el("resumoProfissional").textContent = profissional.nome;
  el("resumoData").textContent = horario.toLocaleDateString("pt-BR");
  el("resumoHorario").textContent = horario.toLocaleTimeString("pt-BR", {
    hour: "2-digit",
    minute: "2-digit",
  });
  el("resumoValor").textContent = `R$ ${Number(servico.preco).toFixed(2)}`;
  el("avisoSinal").hidden = !salao.exige_sinal;

  irParaPasso(4);
}

async function confirmarAgendamento() {
  const btn = el("btnConfirmar");
  btn.disabled = true;
  btn.textContent = "Enviando...";
  esconderErroGlobal();

  const {
    salao,
    servico,
    profissional,
    horario,
    nomeCliente,
    telefoneCliente,
  } = estado;

  try {
    const response = await fetch("/agendamento", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        salao_id: salao.id,
        nome: nomeCliente,
        telefone: telefoneCliente.replace(/\D/g, ""),
        profissional_id: profissional.id,
        servico_id: servico.id,
        data_hora: dataLocalParaISO(horario),
        duracao_minutos: servico.duracao_minutos,
        valor: servico.preco,
        status: salao.exige_sinal
          ? "aguardando_pagamento"
          : "aguardando_confirmacao",
      }),
    });

    const resultado = await response.json();

    if (!response.ok || !resultado.ok) {
      console.error("Erro no agendamento:", resultado);
      mostrarErroGlobal(
        resultado.erro ||
          "Não foi possível confirmar o agendamento. Tente novamente.",
      );
      btn.disabled = false;
      btn.textContent = "Solicitar agendamento";
      return;
    }

    estado.agendamentoId = resultado.agendamento_id || null;
    btn.disabled = false;
    btn.textContent = "Solicitar agendamento";

    if (salao.exige_sinal) {
      prepararTelaPagamento();
      irParaPasso("pagamento");
    } else {
      el("mensagemFinal").textContent =
        `${salao.nome} vai confirmar seu horário em breve pelo WhatsApp.`;
      el("voltarInicioBtn").href = `/${slug}`;
      irParaPasso("concluido");
    }
  } catch (err) {
    console.error("Erro inesperado:", err);
    mostrarErroGlobal(
      "Não foi possível conectar ao servidor. Tente novamente.",
    );
    btn.disabled = false;
    btn.textContent = "Solicitar agendamento";
  }
}

// ============================================================
// PAGAMENTO DO SINAL (PIX + COMPROVANTE)
// ============================================================

// Preenche a chave Pix e o valor do sinal. Se o salão não tiver valor_sinal
// configurado, cai de volta pro preço do serviço (assumindo sinal = valor integral).
function prepararTelaPagamento() {
  const { salao, servico } = estado;
  el("pixChave").textContent =
    salao.chave_pix || "Chave não configurada — fale com o salão.";

  const valorSinal =
    salao.valor_sinal != null
      ? Number(salao.valor_sinal)
      : Number(servico.preco);
  el("pixValor").textContent = `R$ ${valorSinal.toFixed(2)}`;

  // sem o id do agendamento não dá pra vincular o comprovante com segurança,
  // então some com o upload e deixa só a opção de enviar depois pelo WhatsApp
  el("comprovanteBloco").hidden = !estado.agendamentoId;

  el("inputComprovante").value = "";
  el("uploadLabelTexto").textContent = "Escolher arquivo (foto ou PDF)";
  el("inputComprovante")
    .closest(".upload-label")
    .classList.remove("tem-arquivo");
  esconderErroPagamento();
  const btnEnviar = el("btnEnviarComprovante");
  btnEnviar.disabled = false;
  btnEnviar.textContent = "Enviar comprovante";
}

function configurarPagamentoSinal() {
  el("btnCopiarPix").addEventListener("click", () => {
    const chave = estado.salao?.chave_pix;
    if (!chave) return;
    navigator.clipboard.writeText(chave).then(() => {
      const btn = el("btnCopiarPix");
      const original = btn.textContent;
      btn.textContent = "Copiado!";
      setTimeout(() => {
        btn.textContent = original;
      }, 1500);
    });
  });

  el("inputComprovante").addEventListener("change", (e) => {
    const arquivo = e.target.files[0];
    const label = e.target.closest(".upload-label");
    if (arquivo) {
      el("uploadLabelTexto").textContent = arquivo.name;
      label.classList.add("tem-arquivo");
    } else {
      el("uploadLabelTexto").textContent = "Escolher arquivo (foto ou PDF)";
      label.classList.remove("tem-arquivo");
    }
  });

  el("btnEnviarComprovante").addEventListener("click", enviarComprovante);
  el("btnPularComprovante").addEventListener("click", pularComprovante);
}

function mostrarErroPagamento(msg) {
  const erroEl = el("erroPagamento");
  erroEl.textContent = msg;
  erroEl.hidden = false;
}

function esconderErroPagamento() {
  el("erroPagamento").hidden = true;
}

// Sobe o comprovante pro Storage (bucket "comprovantes") e vincula ao
// agendamento via RPC "anexar_comprovante" (precisa existir no backend).
async function enviarComprovante() {
  const arquivo = el("inputComprovante").files[0];
  esconderErroPagamento();

  if (!arquivo) {
    mostrarErroPagamento("Selecione um arquivo antes de enviar.");
    return;
  }

  const btn = el("btnEnviarComprovante");
  btn.disabled = true;
  btn.textContent = "Enviando...";

  const extensao = (arquivo.name.split(".").pop() || "jpg").toLowerCase();
  const caminho = `${slug}/${estado.agendamentoId}-${Date.now()}.${extensao}`;

  const { error: erroUpload } = await sb.storage
    .from("comprovantes")
    .upload(caminho, arquivo);

  if (erroUpload) {
    console.error("Erro ao enviar comprovante:", erroUpload);
    mostrarErroPagamento(
      "Não foi possível enviar o comprovante. Tente novamente.",
    );
    btn.disabled = false;
    btn.textContent = "Enviar comprovante";
    return;
  }

  const { data: urlData } = sb.storage
    .from("comprovantes")
    .getPublicUrl(caminho);

  const { error: erroRpc } = await sb.rpc("anexar_comprovante", {
    p_agendamento_id: estado.agendamentoId,
    p_comprovante_url: urlData.publicUrl,
  });

  if (erroRpc) {
    console.error("Erro ao anexar comprovante:", erroRpc);
    mostrarErroPagamento(
      "Comprovante enviado, mas houve um erro ao vincular. Avise o salão pelo WhatsApp.",
    );
    btn.disabled = false;
    btn.textContent = "Enviar comprovante";
    return;
  }

  el("mensagemFinal").textContent =
    `Recebemos seu comprovante! ${estado.salao.nome} vai confirmar seu horário em breve.`;
  el("voltarInicioBtn").href = `/${slug}`;
  irParaPasso("concluido");
}

function pularComprovante() {
  el("mensagemFinal").textContent =
    `${estado.salao.nome} vai confirmar seu horário após o pagamento antecipado. Você pode enviar o comprovante depois pelo WhatsApp.`;
  el("voltarInicioBtn").href = `/${slug}`;
  irParaPasso("concluido");
}

// ============================================================
// IARA WIDGET
// ============================================================
function configurarIara() {
  const widget = el("iaraWidget");
  const painel = el("iaraPanel");
  widget.hidden = false;

  let carregado = false;

  el("iaraFab").addEventListener("click", async () => {
    const abrindo = painel.hidden;
    painel.hidden = !abrindo;
    if (abrindo && !carregado) {
      carregado = true;
      await carregarPerguntasIara();
    }
  });

  el("iaraCloseBtn").addEventListener("click", () => {
    painel.hidden = true;
  });
}

async function carregarPerguntasIara() {
  const body = el("iaraBody");
  body.innerHTML = "";
  body.appendChild(criarEl("p", "menu-vazio", "Carregando..."));

  const { data, error } = await sb
    .from("perguntas_frequentes")
    .select("*")
    .eq("salao_id", estado.salao.id)
    .eq("ativo", true)
    .order("ordem");

  body.innerHTML = "";

  if (error) {
    console.error("Erro ao carregar perguntas da Iara:", error);
    body.appendChild(
      criarEl("p", "menu-vazio", "Erro ao carregar. Tente novamente."),
    );
    return;
  }

  if (!data || data.length === 0) {
    body.appendChild(
      criarEl("p", "menu-vazio", "Nenhuma pergunta cadastrada ainda."),
    );
    return;
  }

  const intro = criarEl("p", null, "Oi! Posso ajudar com:");
  intro.style.fontSize = "0.85rem";
  intro.style.color = "var(--brown-soft)";
  body.appendChild(intro);

  data.forEach((p) => {
    const btn = criarEl("button", "iara-widget-option", p.pergunta);
    btn.addEventListener("click", () => {
      body.innerHTML = "";
      const back = criarEl("button", "iara-widget-back", "← Voltar");
      back.addEventListener("click", carregarPerguntasIara);
      const pergunta = criarEl("p", "iara-widget-question", p.pergunta);
      const resposta = criarEl("p", "iara-widget-answer", p.resposta);
      body.appendChild(back);
      body.appendChild(pergunta);
      body.appendChild(resposta);
    });
    body.appendChild(btn);
  });
}
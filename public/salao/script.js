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

// Cria elemento com textContent seguro (evita XSS)
function criarEl(tag, classes, texto) {
  const elemento = document.createElement(tag);
  if (classes) elemento.className = classes;
  if (texto !== undefined) elemento.textContent = texto;
  return elemento;
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

  if (error || !data) {
    if (error) console.error("Erro ao buscar salão:", error);
    mostrarNaoEncontrado();
    return;
  }

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
      `Agende seu horário no ${estado.salao.nome} em poucos cliques.`
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
      `Agende seu horário no ${estado.salao.nome}. ${estado.salao.endereco || ""}`.trim()
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

function definirMetaDescricao(texto) {
  const metaEl = el("metaDescricao");
  if (metaEl) metaEl.setAttribute("content", texto);
}

// ============================================================
// PERSONALIZAÇÃO DA MARCA (NOME E LOGO)
// ============================================================
function aplicarPersonalizacao() {
  const { salao } = estado;

  el("salaoNome").textContent = salao.nome;

  if (salao.logo_url) {
    el("salaoLogo").src = salao.logo_url;
    el("salaoLogo").alt = salao.nome;
    el("salaoLogo").hidden = false;
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
  el("menuHorario").textContent = "Varia por profissional — confira ao agendar";
  montarRedesSociais();
  carregarPortfolio();
  el("menuPortfolioLink").href = `/${slug}/portfolio`;
}

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
    .limit(6);

  const container = el("menuPortfolio");
  container.innerHTML = "";

  if (error || !data || data.length === 0) {
    if (error) console.error("Erro ao carregar portfólio:", error);
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
// PÁGINA DE PORTFÓLIO
// ============================================================
async function montarPaginaPortfolio() {
  const { salao } = estado;
  el("portfolioTitulo").textContent = `Portfólio — ${salao.nome}`;
  el("portfolioVoltarBtn").href = `/${slug}`;
  el("portfolioAgendarBtn").href = `/${slug}/agendar`;

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
// LIGHTBOX
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
  if (estado.lightboxConfigurado) return;
  estado.lightboxConfigurado = true;

  el("lightboxFechar").addEventListener("click", fecharLightbox);
  el("lightboxAnterior").addEventListener("click", lightboxAnterior);
  el("lightboxProximo").addEventListener("click", lightboxProximo);

  el("portfolioLightbox").addEventListener("click", (e) => {
    if (e.target === el("portfolioLightbox")) fecharLightbox();
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
  el("agendarBtn").href = `/${slug}/agendar`;
}

// ============================================================
// WIZARD
// ============================================================
async function iniciarWizard() {
  document
    .querySelectorAll(".wizard-back")
    .forEach((btn) => btn.addEventListener("click", voltarPasso));

  el("inputTelefone").addEventListener("input", (e) => {
    e.target.value = aplicarMascaraTelefone(e.target.value);
  });
  el("btnContinuarServico").addEventListener("click", () => {
    carregarProfissionais();
    irParaPasso(1);
  });
  el("btnContinuarProfissional").addEventListener("click", () =>
    irParaPasso(2)
  );

  el("inputData").min = new Date().toISOString().slice(0, 10);
  el("inputData").addEventListener("change", carregarHorarios);
  el("btnContinuarHorario").addEventListener("click", () => irParaPasso(3));
  el("btnContinuarDados").addEventListener("click", validarDados);
  el("btnConfirmar").addEventListener("click", confirmarAgendamento);

  el("inputReferencia").addEventListener("change", (e) => {
    const arquivo = e.target.files[0];
    if (arquivo) mostrarPreviewReferencia(arquivo);
  });
  el("btnRemoverReferencia").addEventListener("click", removerReferencia);

  configurarCopiarPixConfirmacao();

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
      criarEl("p", "menu-vazio", "Erro ao carregar serviços. Recarregue a página.")
    );
    return;
  }

  if (!data || data.length === 0) {
    container.appendChild(criarEl("p", "menu-vazio", "Nenhum serviço disponível."));
    return;
  }

  data.forEach((servico) => {
    const btn = document.createElement("button");
    btn.className = "option-card";

    const nome = criarEl("strong", null, servico.nome);
    const info = criarEl(
      "span",
      null,
      `${servico.duracao_minutos}min — R$ ${Number(servico.preco).toFixed(2)}`
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
  container.appendChild(criarEl("p", "menu-vazio", "Carregando profissionais..."));

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
      criarEl("p", "menu-vazio", "Erro ao carregar profissionais. Tente novamente.")
    );
    return;
  }

  const ativos = (data || [])
    .map((row) => row.profissional)
    .filter((p) => p && p.ativo);

  if (ativos.length === 0) {
    container.appendChild(
      criarEl("p", "menu-vazio", "Nenhuma profissional disponível para esse serviço.")
    );
    return;
  }

  ativos.forEach((prof) => {
    const btn = document.createElement("button");
    btn.className = "option-card option-card-prof";

    if (prof.foto_url) {
      const foto = document.createElement("img");
      foto.src = prof.foto_url;
      foto.alt = prof.nome;
      foto.className = "prof-foto";
      btn.appendChild(foto);
    } else {
      const avatar = criarEl("div", "prof-avatar", prof.nome.charAt(0).toUpperCase());
      btn.appendChild(avatar);
    }

    const info = criarEl("div", "prof-info");
    info.appendChild(criarEl("strong", null, prof.nome));
    btn.appendChild(info);

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

  const inicioDia = new Date(`${dataValor}T00:00:00`);
  const fimDia = new Date(`${dataValor}T23:59:59`);

  const { profissional } = estado;
  const diaSemana = inicioDia.getDay();
  const grade = profissional?.horarios_disponiveis || {};
  const horariosDoDia = grade[diaSemana] ?? grade[String(diaSemana)] ?? [];

  if (horariosDoDia.length === 0) {
    el("semHorarios").textContent =
      "Sem horários disponíveis nesse dia. Escolha outra data.";
    el("semHorarios").hidden = false;
    return;
  }

  container.appendChild(
    criarEl("p", "menu-vazio", "Calculando horários disponíveis...")
  );

  const { data: ocupados, error } = await sb
    .from("agenda_publica")
    .select("data_hora")
    .eq("profissional_id", profissional.id)
    .gte("data_hora", inicioDia.toISOString())
    .lte("data_hora", fimDia.toISOString());

  container.innerHTML = "";

  if (error) {
    console.error("Erro ao carregar horários:", error);
    container.appendChild(
      criarEl("p", "menu-vazio", "Erro ao carregar horários. Tente novamente.")
    );
    return;
  }

  const horariosOcupados = new Set(
    (ocupados || []).map((o) => {
      const d = new Date(o.data_hora);
      const pad = (n) => String(n).padStart(2, "0");
      return `${pad(d.getHours())}:${pad(d.getMinutes())}`;
    })
  );

  const livres = [...horariosDoDia]
    .filter((h) => !horariosOcupados.has(h))
    .sort();

  if (livres.length === 0) {
    el("semHorarios").hidden = false;
    return;
  }

  livres.forEach((horaTexto) => {
    const btn = document.createElement("button");
    btn.className = "slot-btn";
    btn.textContent = horaTexto;
    btn.addEventListener("click", () => {
      const [h, m] = horaTexto.split(":").map(Number);
      const dataHorario = new Date(`${dataValor}T00:00:00`);
      dataHorario.setHours(h, m, 0, 0);
      estado.horario = dataHorario;
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

  const valorSinalResumo = calcularValorSinal(servico);
  const exigeSinal = valorSinalResumo !== null;

  el("avisoSinal").hidden = !exigeSinal;
  if (exigeSinal) {
    el("avisoSinal").textContent =
      `Este serviço exige sinal de R$ ${valorSinalResumo.toFixed(2)} para confirmar o horário.`;
  }

  el("pixBloco").hidden = !exigeSinal;
  el("avisoComprovante").hidden = !exigeSinal;
  if (exigeSinal) {
    el("pixValorConfirmacao").textContent = `R$ ${valorSinalResumo.toFixed(2)}`;
    el("pixChaveConfirmacao").textContent =
      salao.chave_pix || "Chave não configurada — fale com o salão.";
    el("pixTitularConfirmacao").textContent = salao.titular_pix || "";
    el("pixTitularConfirmacao").hidden = !salao.titular_pix;
  }

  irParaPasso(4);
}

// ============================================================
// CONFIRMAÇÃO VIA WHATSAPP
// ============================================================
// Redireciona o navegador do cliente direto pro WhatsApp do salão,
// já com a mensagem de confirmação pronta. Retorna true se conseguiu
// redirecionar (número do salão configurado); false se não tinha
// número — nesse caso quem chamou deve mostrar a tela final normal.
function irParaWhatsapp() {
  const { salao, servico, profissional, horario, nomeCliente } = estado;

  const numero = String(salao?.redes_sociais?.whatsapp || "").replace(/\D/g, "");
  if (!numero || !horario) return false;

  const dataTexto = horario.toLocaleDateString("pt-BR");
  const horaTexto = horario.toLocaleTimeString("pt-BR", {
    hour: "2-digit",
    minute: "2-digit",
  });

  let mensagem =
    `Olá! Gostaria de confirmar meu agendamento:\n\n` +
    `Nome: ${nomeCliente}\n` +
    `Serviço: ${servico?.nome || ""}\n` +
    `Profissional: ${profissional?.nome || ""}\n` +
    `Data: ${dataTexto}\n` +
    `Horário: ${horaTexto}`;

  const valorSinal = calcularValorSinal(servico);
  if (valorSinal !== null) {
    mensagem +=
      `\n\nSinal: R$ ${valorSinal.toFixed(2)}\n` +
      `Chave Pix: ${salao?.chave_pix || "combinar com o salão"}\n` +
      `Já vou enviar o comprovante do pagamento por aqui.`;
  }

  window.location.href = `https://wa.me/${numero}?text=${encodeURIComponent(mensagem)}`;
  return true;
}

// ============================================================
// FOTO DE REFERÊNCIA (opcional, no passo de confirmação)
// ============================================================
function mostrarPreviewReferencia(arquivo) {
  esconderErroReferencia();
  const leitor = new FileReader();
  leitor.onload = (e) => {
    el("referenciaPreview").src = e.target.result;
    el("referenciaPreviewWrap").hidden = false;
    el("referenciaLabel").hidden = true;
  };
  leitor.readAsDataURL(arquivo);
}

function removerReferencia() {
  el("inputReferencia").value = "";
  el("referenciaPreview").src = "";
  el("referenciaPreviewWrap").hidden = true;
  el("referenciaLabel").hidden = false;
}

function mostrarErroReferencia(msg) {
  const erroEl = el("erroReferencia");
  erroEl.textContent = msg;
  erroEl.hidden = false;
}

function esconderErroReferencia() {
  el("erroReferencia").hidden = true;
}

// Envia a foto (se a cliente escolheu uma) pela API. Não trava o fluxo
// principal: se der erro aqui, o agendamento em si já foi confirmado normalmente.
async function enviarFotoReferenciaSeHouver(agendamentoId) {
  const arquivo = el("inputReferencia").files[0];
  if (!arquivo) return;

  try {
    const dados = new FormData();
    dados.append("arquivo", arquivo);
    dados.append("telefone", estado.telefoneCliente.replace(/\D/g, ""));

    const resposta = await fetch(`/agendamento/${agendamentoId}/referencia`, {
      method: "POST",
      body: dados,
    });
    const resultado = await resposta.json();

    if (!resposta.ok || !resultado.ok) {
      console.error("Erro ao enviar foto de referência:", resultado);
      mostrarErroReferencia(
        "Não deu pra enviar a foto, mas seu agendamento já foi confirmado. Pode mandar a foto pelo WhatsApp."
      );
    }
  } catch (err) {
    console.error("Erro inesperado ao enviar foto de referência:", err);
  }
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
        data_hora: horario.toISOString(),
      }),
    });

    const resultado = await response.json();

    if (!response.ok || !resultado.ok) {
      console.error("Erro no agendamento:", resultado);
      mostrarErroGlobal(
        resultado.erro || "Não foi possível confirmar o agendamento. Tente novamente."
      );
      btn.disabled = false;
      btn.textContent = "Solicitar agendamento";
      return;
    }

    estado.agendamentoId = resultado.agendamento_id || null;

    if (estado.agendamentoId && el("inputReferencia").files[0]) {
      btn.textContent = "Enviando foto...";
      await enviarFotoReferenciaSeHouver(estado.agendamentoId);
    }

    btn.disabled = false;
    btn.textContent = "Solicitar agendamento";

    if (!irParaWhatsapp()) {
      el("mensagemFinal").textContent = servicoCobraSinal(servico)
        ? `${salao.nome} vai confirmar seu horário após o pagamento do sinal. Envie o comprovante pelo WhatsApp.`
        : `${salao.nome} vai confirmar seu horário em breve pelo WhatsApp.`;
      el("voltarInicioBtn").href = `/${slug}`;
      irParaPasso("concluido");
    }
  } catch (err) {
    console.error("Erro inesperado:", err);
    mostrarErroGlobal("Não foi possível conectar ao servidor. Tente novamente.");
    btn.disabled = false;
    btn.textContent = "Solicitar agendamento";
  }
}

// ============================================================
// PAGAMENTO DO SINAL
// ============================================================
// Calcula quanto o cliente deve pagar de sinal pra este serviço.
// Regras (configuradas por serviço, no admin):
// - servico.cobra_sinal === false  -> não cobra sinal (retorna null)
// - servico.tipo_cobranca_sinal === "percentual" -> % em cima de servico.preco
// - servico.tipo_cobranca_sinal === "fixo" (ou não informado) -> valor fixo
function calcularValorSinal(servico) {
  if (!servico || servico.cobra_sinal === false) return null;

  if (servico.tipo_cobranca_sinal === "percentual") {
    const percentual = Number(servico.percentual_sinal || 0);
    return Number((Number(servico.preco) * (percentual / 100)).toFixed(2));
  }

  // tipo "fixo" (default): usa o valor fixo configurado no serviço;
  // se por algum motivo não tiver valor fixo salvo, cai pro preço cheio
  // do serviço, mantendo o comportamento antigo como fallback de segurança.
  return servico.valor_sinal_fixo != null
    ? Number(servico.valor_sinal_fixo)
    : Number(servico.preco);
}

function servicoCobraSinal(servico) {
  return calcularValorSinal(servico) !== null;
}

function configurarCopiarPixConfirmacao() {
  el("btnCopiarPixConfirmacao").addEventListener("click", () => {
    const chave = estado.salao?.chave_pix;
    if (!chave) return;
    navigator.clipboard.writeText(chave).then(() => {
      const btn = el("btnCopiarPixConfirmacao");
      const original = btn.textContent;
      btn.textContent = "Copiado!";
      setTimeout(() => {
        btn.textContent = original;
      }, 1500);
    });
  });
}

// ============================================================
// IARA WIDGET
// ============================================================
function configurarIara() {
  const widget = el("iaraWidget");
  const painel = el("iaraPanel");
  const tooltip = el("iaraTooltip");
  widget.hidden = false;

  const sumirTooltip = () => {
    if (tooltip) tooltip.hidden = true;
  };
  const mostrarTooltip = () => {
    if (tooltip) tooltip.hidden = false;
    setTimeout(sumirTooltip, 5000);
  };

  // some sozinho depois de 5s na primeira vez, pra não ficar poluindo a tela
  setTimeout(sumirTooltip, 5000);

  let carregado = false;

  el("iaraFab").addEventListener("click", async () => {
    sumirTooltip();
    const abrindo = painel.hidden;
    painel.hidden = !abrindo;
    if (abrindo && !carregado) {
      carregado = true;
      await carregarPerguntasIara();
    }
    if (!abrindo) {
      // fechou clicando de novo no fab: tooltip volta depois de um tempinho
      setTimeout(mostrarTooltip, 1500);
    }
  });

  el("iaraCloseBtn").addEventListener("click", () => {
    painel.hidden = true;
    setTimeout(mostrarTooltip, 1500);
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
      criarEl("p", "menu-vazio", "Erro ao carregar. Tente novamente.")
    );
    return;
  }

  if (!data || data.length === 0) {
    body.appendChild(
      criarEl("p", "menu-vazio", "Nenhuma pergunta cadastrada ainda.")
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

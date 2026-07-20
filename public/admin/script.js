const el = (id) => document.getElementById(id);

const estado = {
  salao: null,
};

// ============================================================
// HELPERS
// ============================================================
async function chamarApi(caminho, opcoes = {}) {
  const resp = await fetch(caminho, {
    credentials: "include",
    headers: { "Content-Type": "application/json" },
    ...opcoes,
  });
  const dados = await resp.json().catch(() => ({}));
  if (!resp.ok) {
    throw new Error(dados.erro || "Erro inesperado. Tente novamente.");
  }
  return dados;
}

function formatarMoeda(valor) {
  return Number(valor || 0).toLocaleString("pt-BR", {
    style: "currency",
    currency: "BRL",
  });
}

function hexParaRgb(hex) {
  const limpo = (hex || "").replace("#", "");
  const normalizado =
    limpo.length === 3
      ? limpo.split("").map((c) => c + c).join("")
      : limpo.padEnd(6, "0");
  const bigint = parseInt(normalizado, 16) || 0;
  return { r: (bigint >> 16) & 255, g: (bigint >> 8) & 255, b: bigint & 255 };
}

// mistura duas cores (peso 0 = cor1 pura, 1 = cor2 pura)
function misturarCores(hex1, hex2, peso) {
  const c1 = hexParaRgb(hex1);
  const c2 = hexParaRgb(hex2);
  const r = Math.round(c1.r + (c2.r - c1.r) * peso);
  const g = Math.round(c1.g + (c2.g - c1.g) * peso);
  const b = Math.round(c1.b + (c2.b - c1.b) * peso);
  return `rgb(${r}, ${g}, ${b})`;
}

// ============================================================
// LOGIN / SESSÃO
// ============================================================
async function verificarSessao() {
  try {
    const { salao } = await chamarApi("/admin/auth/me");
    estado.salao = salao;
    mostrarPainel();
  } catch {
    mostrarLogin();
  }
}

function mostrarLogin() {
  el("loginScreen").hidden = false;
  el("painel").hidden = true;
}

function mostrarPainel() {
  el("loginScreen").hidden = true;
  el("painel").hidden = false;

  el("sidebarNomeSalao").textContent = estado.salao.nome || "Meu salão";
  el("sidebarPlano").textContent = estado.salao.plano || "";
  if (estado.salao.logo_url) {
    el("sidebarLogo").src = estado.salao.logo_url;
    el("sidebarLogo").hidden = false;
  }

  aplicarCoresAoVivo(estado.salao.cor_destaque, estado.salao.cor_fundo);
  carregarDashboard();
  preencherFormPersonalizacao();
}

// Aplica as cores escolhidas pela dona do salão no próprio painel — assim
// ela vê (e o painel some junto) a mesma cor que aparece pro cliente.
// Nada de cor fixa "solta": até o fundo escuro do menu lateral é derivado
// da cor de destaque escolhida (só mais escura, pra manter o texto legível).
function aplicarCoresAoVivo(corDestaque, corFundo) {
  const accent = corDestaque || "#0e7c66";
  const fundo = corFundo || "#f5f4f1";

  document.documentElement.style.setProperty("--accent", accent);
  document.documentElement.style.setProperty(
    "--accent-hover",
    misturarCores(accent, "#000000", 0.15),
  );
  document.documentElement.style.setProperty("--bg", fundo);
  document.documentElement.style.setProperty(
    "--sidebar-bg",
    misturarCores(accent, "#000000", 0.6),
  );
}

el("loginForm").addEventListener("submit", async (e) => {
  e.preventDefault();
  const btn = el("btnLogin");
  btn.disabled = true;
  btn.textContent = "Entrando...";
  el("loginErro").hidden = true;

  try {
    const { salao } = await chamarApi("/admin/auth/login", {
      method: "POST",
      body: JSON.stringify({
        email: el("loginEmail").value.trim(),
        senha: el("loginSenha").value,
      }),
    });
    estado.salao = salao;
    mostrarPainel();
  } catch (err) {
    el("loginErro").textContent = err.message;
    el("loginErro").hidden = false;
  } finally {
    btn.disabled = false;
    btn.textContent = "Entrar";
  }
});

el("btnLogout").addEventListener("click", async () => {
  await chamarApi("/admin/auth/logout", { method: "POST" }).catch(() => {});
  estado.salao = null;
  mostrarLogin();
});

// ============================================================
// NAVEGAÇÃO ENTRE ABAS
// ============================================================
document.querySelectorAll(".nav-item").forEach((btn) => {
  btn.addEventListener("click", () => {
    if (btn.classList.contains("nav-item-bloqueado")) return;

    document
      .querySelectorAll(".nav-item")
      .forEach((b) => b.classList.remove("active"));
    btn.classList.add("active");

    const aba = btn.dataset.aba;
    document
      .querySelectorAll(".aba")
      .forEach((secao) => (secao.hidden = secao.dataset.abaConteudo !== aba));

    if (aba === "faq") carregarFaq();
    if (aba === "agendamentos") carregarAgendamentos();
  });
});

// ============================================================
// DASHBOARD
// ============================================================
async function carregarDashboard() {
  try {
    const dados = await chamarApi("/admin/api/dashboard");

    el("statFaturamento").textContent = formatarMoeda(dados.faturamentoMes);
    el("statConfirmados").textContent = dados.confirmadosMes;
    el("statTotal").textContent = dados.totalAgendamentosMes;
    el("statTicket").textContent = formatarMoeda(dados.ticketMedio);

    const lista = el("proximosLista");
    lista.innerHTML = "";

    if (!dados.proximosAgendamentos || dados.proximosAgendamentos.length === 0) {
      el("proximosVazio").hidden = false;
    } else {
      el("proximosVazio").hidden = true;
      dados.proximosAgendamentos.forEach((ag) => {
        const item = document.createElement("div");
        item.className = "proximo-item";

        const dataFormatada = new Date(ag.data_hora).toLocaleString("pt-BR", {
          day: "2-digit",
          month: "2-digit",
          hour: "2-digit",
          minute: "2-digit",
        });

        item.innerHTML = `
          <div>
            <strong>${ag.clientes?.nome || "Cliente"}</strong> — ${ag.servicos?.nome || ""}
            <div class="proximo-data">${dataFormatada} · ${ag.profissionais?.nome || ""}</div>
          </div>
          <span>${formatarMoeda(ag.valor)}</span>
        `;
        lista.appendChild(item);
      });
    }
  } catch (err) {
    console.error("Erro ao carregar dashboard:", err);
  }
}

// ============================================================
// PERSONALIZAÇÃO
// ============================================================
const DIAS_ABREV = ["Dom", "Seg", "Ter", "Qua", "Qui", "Sex", "Sáb"];

function preencherFormPersonalizacao() {
  const s = estado.salao;

  el("campoNome").value = s.nome || "";
  el("campoTelefone").value = s.telefone || "";
  el("campoEndereco").value = s.endereco || "";
  el("campoLogoUrl").value = s.logo_url || "";
  atualizarPreviewLogo();

  el("campoCorDestaque").value = s.cor_destaque || "#0e7c66";
  el("campoCorFundo").value = s.cor_fundo || "#ffaaaa";

  const redes = s.redes_sociais || {};
  el("campoInstagram").value = redes.instagram || "";
  el("campoWhatsappRedes").value = redes.whatsapp || "";

  montarTabelaHorarios(s);

  el("campoExigeSinal").checked = !!s.exige_sinal;
  el("campoValorSinal").value = s.valor_sinal ?? "";
  el("campoChavePix").value = s.chave_pix || "";
  atualizarBlocoSinal();

  el("campoAtivo").checked = s.ativo !== false;
}

// ---- Tabela de horário por dia ----
function montarTabelaHorarios(salao) {
  const porDia = salao.horarios_excecao && typeof salao.horarios_excecao === "object"
    ? salao.horarios_excecao
    : {};

  // valores antigos, usados só como sugestão inicial pra quem ainda não
  // configurou nada no modelo novo
  const abAntigo = (salao.horario_abertura || "09:00").slice(0, 5);
  const feAntigo = (salao.horario_fechamento || "19:00").slice(0, 5);
  const diasAntigos = new Set(
    Array.isArray(salao.dias_funcionamento) ? salao.dias_funcionamento.map(Number) : [1, 2, 3, 4, 5],
  );

  const container = el("tabelaHorarios");
  container.innerHTML = "";

  for (let d = 0; d <= 6; d++) {
    const config = porDia[d] ?? porDia[String(d)];
    const aberto = config ? config.aberto !== false : diasAntigos.has(d);
    const abertura = (config?.abertura || abAntigo).slice(0, 5);
    const fechamento = (config?.fechamento || feAntigo).slice(0, 5);

    const linha = document.createElement("div");
    linha.className = "linha-horario-dia" + (aberto ? "" : " dia-fechado");
    linha.dataset.dia = d;

    linha.innerHTML = `
      <label class="dia-toggle">
        <input type="checkbox" class="dia-aberto" ${aberto ? "checked" : ""} />
        ${DIAS_ABREV[d]}
      </label>
      <input type="time" class="input dia-abertura" value="${abertura}" ${aberto ? "" : "disabled"} />
      <input type="time" class="input dia-fechamento" value="${fechamento}" ${aberto ? "" : "disabled"} />
    `;

    const checkbox = linha.querySelector(".dia-aberto");
    checkbox.addEventListener("change", () => {
      const ligado = checkbox.checked;
      linha.classList.toggle("dia-fechado", !ligado);
      linha.querySelector(".dia-abertura").disabled = !ligado;
      linha.querySelector(".dia-fechamento").disabled = !ligado;
    });

    container.appendChild(linha);
  }
}

function lerTabelaHorarios() {
  const porDia = {};
  document.querySelectorAll(".linha-horario-dia").forEach((linha) => {
    const dia = linha.dataset.dia;
    const aberto = linha.querySelector(".dia-aberto").checked;
    porDia[dia] = aberto
      ? {
          aberto: true,
          abertura: linha.querySelector(".dia-abertura").value,
          fechamento: linha.querySelector(".dia-fechamento").value,
        }
      : { aberto: false };
  });
  return porDia;
}

// ---- Logo (upload de arquivo) ----
function atualizarPreviewLogo() {
  const url = el("campoLogoUrl").value.trim();
  if (url) {
    el("previewLogo").src = url;
    el("previewLogo").hidden = false;
  } else {
    el("previewLogo").hidden = true;
  }
}

el("campoLogoArquivo").addEventListener("change", async () => {
  const arquivo = el("campoLogoArquivo").files[0];
  if (!arquivo) return;

  const status = el("logoStatus");
  status.textContent = "Enviando...";

  const formData = new FormData();
  formData.append("arquivo", arquivo);

  try {
    const resp = await fetch("/admin/api/upload/logo", {
      method: "POST",
      credentials: "include",
      body: formData,
    });
    const dados = await resp.json();
    if (!resp.ok) throw new Error(dados.erro || "Erro ao enviar imagem.");

    el("campoLogoUrl").value = dados.url;
    atualizarPreviewLogo();
    status.textContent = "Imagem enviada. Clique em \"Salvar alterações\" pra confirmar.";
  } catch (err) {
    status.textContent = err.message;
  }
});

// ---- Sinal / cores / disponibilidade ----
function atualizarBlocoSinal() {
  el("blocoSinal").hidden = !el("campoExigeSinal").checked;
}

el("campoExigeSinal").addEventListener("change", atualizarBlocoSinal);

// preview ao vivo: já aplica a cor no painel assim que a dona mexe no seletor
el("campoCorDestaque").addEventListener("input", () => {
  aplicarCoresAoVivo(el("campoCorDestaque").value, el("campoCorFundo").value);
});
el("campoCorFundo").addEventListener("input", () => {
  aplicarCoresAoVivo(el("campoCorDestaque").value, el("campoCorFundo").value);
});

el("formPersonalizacao").addEventListener("submit", async (e) => {
  e.preventDefault();
  const btn = el("btnSalvarPersonalizacao");
  btn.disabled = true;
  btn.textContent = "Salvando...";
  el("personalizacaoErro").hidden = true;
  el("personalizacaoSucesso").hidden = true;

  const corpo = {
    nome: el("campoNome").value.trim(),
    telefone: el("campoTelefone").value.trim(),
    endereco: el("campoEndereco").value.trim(),
    logo_url: el("campoLogoUrl").value.trim() || null,
    cor_destaque: el("campoCorDestaque").value,
    cor_fundo: el("campoCorFundo").value,
    redes_sociais: {
      instagram: el("campoInstagram").value.trim(),
      whatsapp: el("campoWhatsappRedes").value.trim(),
    },
    horarios_excecao: lerTabelaHorarios(),
    exige_sinal: el("campoExigeSinal").checked,
    valor_sinal: el("campoValorSinal").value
      ? Number(el("campoValorSinal").value)
      : null,
    chave_pix: el("campoChavePix").value.trim() || null,
    ativo: el("campoAtivo").checked,
  };

  try {
    const { salao } = await chamarApi("/admin/api/salao", {
      method: "PUT",
      body: JSON.stringify(corpo),
    });
    estado.salao = salao;
    el("personalizacaoSucesso").hidden = false;
    el("sidebarNomeSalao").textContent = salao.nome || "Meu salão";
    if (salao.logo_url) {
      el("sidebarLogo").src = salao.logo_url;
      el("sidebarLogo").hidden = false;
    }
  } catch (err) {
    el("personalizacaoErro").textContent = err.message;
    el("personalizacaoErro").hidden = false;
  } finally {
    btn.disabled = false;
    btn.textContent = "Salvar alterações";
  }
});

// ============================================================
// FAQ (Iara)
// ============================================================
async function carregarFaq() {
  const lista = el("listaFaq");
  lista.innerHTML = "";

  try {
    const { perguntas } = await chamarApi("/admin/api/faq");

    if (!perguntas || perguntas.length === 0) {
      el("faqVazio").hidden = false;
      return;
    }
    el("faqVazio").hidden = true;

    perguntas.forEach((p, indice) => {
      const item = document.createElement("div");
      item.className = "faq-item" + (p.ativo ? "" : " faq-inativo");

      item.innerHTML = `
        <div class="faq-item-texto">
          <strong>${escaparHtml(p.pergunta)}</strong>
          <p>${escaparHtml(p.resposta)}</p>
        </div>
        <div class="faq-item-acoes">
          <button data-acao="subir" ${indice === 0 ? "disabled" : ""}>▲ Subir</button>
          <button data-acao="descer" ${indice === perguntas.length - 1 ? "disabled" : ""}>▼ Descer</button>
          <button data-acao="editar">Editar</button>
          <button data-acao="toggle">${p.ativo ? "Desativar" : "Ativar"}</button>
          <button data-acao="excluir">Excluir</button>
        </div>
      `;

      item.querySelector('[data-acao="subir"]').addEventListener("click", () =>
        moverFaq(p.id, "cima"),
      );
      item.querySelector('[data-acao="descer"]').addEventListener("click", () =>
        moverFaq(p.id, "baixo"),
      );
      item.querySelector('[data-acao="editar"]').addEventListener("click", () =>
        editarFaq(p),
      );
      item.querySelector('[data-acao="toggle"]').addEventListener("click", () =>
        alternarAtivoFaq(p),
      );
      item.querySelector('[data-acao="excluir"]').addEventListener("click", () =>
        excluirFaq(p.id),
      );

      lista.appendChild(item);
    });
  } catch (err) {
    console.error("Erro ao carregar FAQ:", err);
  }
}

function escaparHtml(texto) {
  const div = document.createElement("div");
  div.textContent = texto || "";
  return div.innerHTML;
}

function editarFaq(pergunta) {
  el("faqEditandoId").value = pergunta.id;
  el("faqPergunta").value = pergunta.pergunta;
  el("faqResposta").value = pergunta.resposta;
  el("btnSalvarFaq").textContent = "Salvar edição";
  el("btnCancelarEdicaoFaq").hidden = false;
  el("faqPergunta").scrollIntoView({ behavior: "smooth", block: "center" });
}

function cancelarEdicaoFaq() {
  el("faqEditandoId").value = "";
  el("formFaq").reset();
  el("btnSalvarFaq").textContent = "Adicionar pergunta";
  el("btnCancelarEdicaoFaq").hidden = true;
}

el("btnCancelarEdicaoFaq").addEventListener("click", cancelarEdicaoFaq);

async function alternarAtivoFaq(pergunta) {
  try {
    await chamarApi(`/admin/api/faq/${pergunta.id}`, {
      method: "PUT",
      body: JSON.stringify({ ativo: !pergunta.ativo }),
    });
    carregarFaq();
  } catch (err) {
    alert(err.message);
  }
}

async function moverFaq(id, direcao) {
  try {
    await chamarApi(`/admin/api/faq/${id}/mover`, {
      method: "POST",
      body: JSON.stringify({ direcao }),
    });
    carregarFaq();
  } catch (err) {
    alert(err.message);
  }
}

async function excluirFaq(id) {
  if (!confirm("Excluir essa pergunta? Não dá pra desfazer.")) return;
  try {
    await chamarApi(`/admin/api/faq/${id}`, { method: "DELETE" });
    carregarFaq();
  } catch (err) {
    alert(err.message);
  }
}

el("formFaq").addEventListener("submit", async (e) => {
  e.preventDefault();
  const btn = el("btnSalvarFaq");
  const idEditando = el("faqEditandoId").value;
  btn.disabled = true;
  el("faqErro").hidden = true;

  const corpo = {
    pergunta: el("faqPergunta").value.trim(),
    resposta: el("faqResposta").value.trim(),
  };

  try {
    if (idEditando) {
      await chamarApi(`/admin/api/faq/${idEditando}`, {
        method: "PUT",
        body: JSON.stringify(corpo),
      });
    } else {
      await chamarApi("/admin/api/faq", {
        method: "POST",
        body: JSON.stringify(corpo),
      });
    }
    cancelarEdicaoFaq();
    carregarFaq();
  } catch (err) {
    el("faqErro").textContent = err.message;
    el("faqErro").hidden = false;
  } finally {
    btn.disabled = false;
  }
});

// ============================================================
// AGENDAMENTOS
// ============================================================
const ROTULOS_STATUS = {
  aguardando_pagamento: "Aguardando pagamento",
  aguardando_confirmacao: "Aguardando confirmação",
  confirmado: "Confirmado",
  concluido: "Concluído",
  cancelado: "Cancelado",
};

function hojeISO() {
  return new Date().toISOString().slice(0, 10);
}

if (!el("filtroData").value) el("filtroData").value = hojeISO();

el("filtroData").addEventListener("change", carregarAgendamentos);
el("filtroStatus").addEventListener("change", carregarAgendamentos);

async function carregarAgendamentos() {
  const lista = el("listaAgendamentos");
  lista.innerHTML = "";
  el("agendamentosVazio").hidden = true;

  const data = el("filtroData").value || hojeISO();
  const status = el("filtroStatus").value;

  const params = new URLSearchParams({ data });
  if (status) params.set("status", status);

  try {
    const { agendamentos } = await chamarApi(`/admin/api/agendamentos?${params}`);

    if (!agendamentos || agendamentos.length === 0) {
      el("agendamentosVazio").hidden = false;
      return;
    }

    agendamentos.forEach((ag) => renderizarAgendamento(ag, lista));
  } catch (err) {
    console.error("Erro ao carregar agendamentos:", err);
  }
}

function renderizarAgendamento(ag, container) {
  const item = document.createElement("div");
  item.className = "agendamento-item";

  const hora = new Date(ag.data_hora).toLocaleTimeString("pt-BR", {
    hour: "2-digit",
    minute: "2-digit",
  });

  const telefoneLimpo = (ag.clientes?.telefone || "").replace(/\D/g, "");
  const linkWhatsapp = telefoneLimpo
    ? `<a href="https://wa.me/55${telefoneLimpo}" target="_blank" rel="noopener">${escaparHtml(ag.clientes?.telefone || "")}</a>`
    : "";

  const rotulo = ROTULOS_STATUS[ag.status] || ag.status;

  item.innerHTML = `
    <div class="agendamento-info">
      <span class="agendamento-hora">${hora}</span>
      <span class="agendamento-cliente">
        <strong>${escaparHtml(ag.clientes?.nome || "Cliente")}</strong>
        ${linkWhatsapp ? " · " + linkWhatsapp : ""}
      </span>
      <span class="agendamento-detalhe">
        ${escaparHtml(ag.servicos?.nome || "")} com ${escaparHtml(ag.profissionais?.nome || "")} · ${formatarMoeda(ag.valor)}
      </span>
      ${
        ag.comprovante_url
          ? `<span class="agendamento-comprovante"><a href="${ag.comprovante_url}" target="_blank" rel="noopener">Ver comprovante</a></span>`
          : ""
      }
    </div>
    <div class="agendamento-lado">
      <span class="status-badge status-${ag.status}">${rotulo}</span>
      <div class="agendamento-acoes"></div>
    </div>
  `;

  const acoes = item.querySelector(".agendamento-acoes");

  const botao = (texto, novoStatus, classe = "") => {
    const b = document.createElement("button");
    b.className = `btn-mini ${classe}`;
    b.textContent = texto;
    b.addEventListener("click", () => mudarStatusAgendamento(ag.id, novoStatus));
    return b;
  };

  if (ag.status === "aguardando_pagamento" || ag.status === "aguardando_confirmacao") {
    acoes.appendChild(botao("Confirmar", "confirmado", "btn-mini-primary"));
    acoes.appendChild(botao("Cancelar", "cancelado", "btn-mini-perigo"));
  } else if (ag.status === "confirmado") {
    acoes.appendChild(botao("Marcar concluído", "concluido", "btn-mini-primary"));
    acoes.appendChild(botao("Cancelar", "cancelado", "btn-mini-perigo"));
  }

  container.appendChild(item);
}

async function mudarStatusAgendamento(id, novoStatus) {
  try {
    await chamarApi(`/admin/api/agendamentos/${id}/status`, {
      method: "PUT",
      body: JSON.stringify({ status: novoStatus }),
    });
    carregarAgendamentos();
  } catch (err) {
    alert(err.message);
  }
}

// ============================================================
// INIT
// ============================================================
verificarSessao();
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
  el("headerNomeSalao").textContent = estado.salao.nome || "Meu salão";
  if (estado.salao.logo_url) {
    el("sidebarLogo").src = estado.salao.logo_url;
    el("sidebarLogo").hidden = false;
    el("headerLogo").src = estado.salao.logo_url;
    el("headerLogo").hidden = false;
  }

  carregarDashboard();
  preencherFormPersonalizacao();
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
// MENU MOBILE (drawer)
// ============================================================
function abrirMenuMobile() {
  el("painel").classList.add("sidebar-aberta");
  el("sidebarOverlay").hidden = false;
}

function fecharMenuMobile() {
  el("painel").classList.remove("sidebar-aberta");
  el("sidebarOverlay").hidden = true;
}

el("btnAbrirMenu").addEventListener("click", abrirMenuMobile);
el("btnFecharMenu").addEventListener("click", fecharMenuMobile);
el("sidebarOverlay").addEventListener("click", fecharMenuMobile);
document.addEventListener("keydown", (e) => {
  if (e.key === "Escape") fecharMenuMobile();
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
    if (aba === "servicos") carregarServicosEProfissionais();
    if (aba === "portfolio") carregarPortfolio();

    fecharMenuMobile(); // no celular, trocar de aba já fecha o drawer sozinho
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

  const redes = s.redes_sociais || {};
  el("campoInstagram").value = redes.instagram || "";
  el("campoWhatsappRedes").value = redes.whatsapp || "";

  el("campoExigeSinal").checked = !!s.exige_sinal;
  el("campoValorSinal").value = s.valor_sinal ?? "";
  el("campoChavePix").value = s.chave_pix || "";
  atualizarBlocoSinal();

  el("campoAtivo").checked = s.ativo !== false;
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

// ---- Sinal / disponibilidade ----
function atualizarBlocoSinal() {
  el("blocoSinal").hidden = !el("campoExigeSinal").checked;
}

el("campoExigeSinal").addEventListener("change", atualizarBlocoSinal);

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
    redes_sociais: {
      instagram: el("campoInstagram").value.trim(),
      whatsapp: el("campoWhatsappRedes").value.trim(),
    },
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
// SUB-ABAS (Serviços / Profissionais)
// ============================================================
document.querySelectorAll(".sub-aba-item").forEach((btn) => {
  btn.addEventListener("click", () => {
    document.querySelectorAll(".sub-aba-item").forEach((b) => b.classList.remove("active"));
    btn.classList.add("active");

    const sub = btn.dataset.subAba;
    document
      .querySelectorAll(".sub-aba")
      .forEach((secao) => (secao.hidden = secao.dataset.subAbaConteudo !== sub));

    if (sub === "horariosDisponiveisSub") carregarSeletorHorarios();
  });
});

let estadoServicos = []; // guardado em memória pra montar os checkboxes dos profissionais

async function carregarServicosEProfissionais() {
  await carregarServicos();
  await carregarProfissionais();
  montarCheckboxesServicos();
}

// ---- SERVIÇOS ----
async function carregarServicos() {
  const lista = el("listaServicosAdmin");
  lista.innerHTML = "";

  try {
    const { servicos } = await chamarApi("/admin/api/servicos");
    estadoServicos = servicos || [];

    if (estadoServicos.length === 0) {
      el("servicosVazio").hidden = false;
    } else {
      el("servicosVazio").hidden = true;
      estadoServicos.forEach((s) => {
        const item = document.createElement("div");
        item.className = "item-card" + (s.ativo ? "" : " item-inativo");
        item.innerHTML = `
          <div class="item-card-texto">
            <strong>${escaparHtml(s.nome)}</strong>
            <span>${s.duracao_minutos} min · ${formatarMoeda(s.preco)}</span>
          </div>
          <div class="item-card-acoes">
            <button class="btn-mini" data-acao="editar">Editar</button>
            <button class="btn-mini" data-acao="toggle">${s.ativo ? "Desativar" : "Ativar"}</button>
            <button class="btn-mini btn-mini-perigo" data-acao="excluir">Excluir</button>
          </div>
        `;
        item.querySelector('[data-acao="editar"]').addEventListener("click", () => editarServico(s));
        item.querySelector('[data-acao="toggle"]').addEventListener("click", () => alternarAtivoServico(s));
        item.querySelector('[data-acao="excluir"]').addEventListener("click", () => excluirServico(s.id));
        lista.appendChild(item);
      });
    }
  } catch (err) {
    console.error("Erro ao carregar serviços:", err);
  }
}

function editarServico(s) {
  el("servicoEditandoId").value = s.id;
  el("servicoNome").value = s.nome;
  el("servicoDuracao").value = s.duracao_minutos;
  el("servicoPreco").value = s.preco;
  el("btnSalvarServico").textContent = "Salvar edição";
  el("btnCancelarEdicaoServico").hidden = false;
}

function cancelarEdicaoServico() {
  el("servicoEditandoId").value = "";
  el("formServico").reset();
  el("btnSalvarServico").textContent = "Adicionar serviço";
  el("btnCancelarEdicaoServico").hidden = true;
}
el("btnCancelarEdicaoServico").addEventListener("click", cancelarEdicaoServico);

async function alternarAtivoServico(s) {
  try {
    await chamarApi(`/admin/api/servicos/${s.id}`, {
      method: "PUT",
      body: JSON.stringify({ ativo: !s.ativo }),
    });
    carregarServicos();
  } catch (err) {
    alert(err.message);
  }
}

async function excluirServico(id) {
  if (!confirm("Excluir esse serviço? Não dá pra desfazer.")) return;
  try {
    await chamarApi(`/admin/api/servicos/${id}`, { method: "DELETE" });
    carregarServicos();
  } catch (err) {
    alert(err.message);
  }
}

el("formServico").addEventListener("submit", async (e) => {
  e.preventDefault();
  const btn = el("btnSalvarServico");
  const idEditando = el("servicoEditandoId").value;
  btn.disabled = true;
  el("servicoErro").hidden = true;

  const corpo = {
    nome: el("servicoNome").value.trim(),
    duracao_minutos: Number(el("servicoDuracao").value),
    preco: Number(el("servicoPreco").value),
  };

  try {
    if (idEditando) {
      await chamarApi(`/admin/api/servicos/${idEditando}`, {
        method: "PUT",
        body: JSON.stringify(corpo),
      });
    } else {
      await chamarApi("/admin/api/servicos", {
        method: "POST",
        body: JSON.stringify(corpo),
      });
    }
    cancelarEdicaoServico();
    carregarServicos();
  } catch (err) {
    el("servicoErro").textContent = err.message;
    el("servicoErro").hidden = false;
  } finally {
    btn.disabled = false;
  }
});

// ---- PROFISSIONAIS ----
async function carregarProfissionais() {
  const lista = el("listaProfissionaisAdmin");
  lista.innerHTML = "";

  try {
    const { profissionais } = await chamarApi("/admin/api/profissionais");

    if (!profissionais || profissionais.length === 0) {
      el("profissionaisVazio").hidden = false;
    } else {
      el("profissionaisVazio").hidden = true;
      profissionais.forEach((p) => {
        const nomesServicos = estadoServicos
          .filter((s) => p.servico_ids.includes(s.id))
          .map((s) => s.nome)
          .join(", ") || "Nenhum serviço vinculado";

        const item = document.createElement("div");
        item.className = "item-card" + (p.ativo ? "" : " item-inativo");
        item.innerHTML = `
          <img class="item-card-foto" src="${p.foto_url || ""}" alt="" onerror="this.style.visibility='hidden'" />
          <div class="item-card-texto">
            <strong>${escaparHtml(p.nome)}</strong>
            <span>${escaparHtml(nomesServicos)}</span>
          </div>
          <div class="item-card-acoes">
            <button class="btn-mini" data-acao="editar">Editar</button>
            <button class="btn-mini" data-acao="toggle">${p.ativo ? "Desativar" : "Ativar"}</button>
            <button class="btn-mini btn-mini-perigo" data-acao="excluir">Excluir</button>
          </div>
        `;
        item.querySelector('[data-acao="editar"]').addEventListener("click", () => editarProfissional(p));
        item.querySelector('[data-acao="toggle"]').addEventListener("click", () => alternarAtivoProfissional(p));
        item.querySelector('[data-acao="excluir"]').addEventListener("click", () => excluirProfissional(p.id));
        lista.appendChild(item);
      });
    }
  } catch (err) {
    console.error("Erro ao carregar profissionais:", err);
  }
}

function montarCheckboxesServicos(idsMarcados = []) {
  const container = el("profissionalServicosCheckboxes");
  container.innerHTML = "";
  estadoServicos.forEach((s) => {
    const label = document.createElement("label");
    label.innerHTML = `
      <input type="checkbox" value="${s.id}" ${idsMarcados.includes(s.id) ? "checked" : ""} />
      ${escaparHtml(s.nome)}
    `;
    container.appendChild(label);
  });
}

function editarProfissional(p) {
  el("profissionalEditandoId").value = p.id;
  el("profissionalNome").value = p.nome;
  el("profissionalFotoUrl").value = p.foto_url || "";
  if (p.foto_url) {
    el("previewFotoProfissional").src = p.foto_url;
    el("previewFotoProfissional").hidden = false;
  } else {
    el("previewFotoProfissional").hidden = true;
  }
  montarCheckboxesServicos(p.servico_ids);
  el("btnSalvarProfissional").textContent = "Salvar edição";
  el("btnCancelarEdicaoProfissional").hidden = false;
}

function cancelarEdicaoProfissional() {
  el("profissionalEditandoId").value = "";
  el("formProfissional").reset();
  el("profissionalFotoUrl").value = "";
  el("previewFotoProfissional").hidden = true;
  el("profissionalFotoStatus").textContent = "";
  montarCheckboxesServicos([]);
  el("btnSalvarProfissional").textContent = "Adicionar profissional";
  el("btnCancelarEdicaoProfissional").hidden = true;
}
el("btnCancelarEdicaoProfissional").addEventListener("click", cancelarEdicaoProfissional);

el("profissionalFotoArquivo").addEventListener("change", async () => {
  const arquivo = el("profissionalFotoArquivo").files[0];
  if (!arquivo) return;
  const status = el("profissionalFotoStatus");
  status.textContent = "Enviando...";

  const formData = new FormData();
  formData.append("arquivo", arquivo);

  try {
    const resp = await fetch("/admin/api/upload/imagem?pasta=profissionais", {
      method: "POST",
      credentials: "include",
      body: formData,
    });
    const dados = await resp.json();
    if (!resp.ok) throw new Error(dados.erro || "Erro ao enviar imagem.");

    el("profissionalFotoUrl").value = dados.url;
    el("previewFotoProfissional").src = dados.url;
    el("previewFotoProfissional").hidden = false;
    status.textContent = "Foto enviada.";
  } catch (err) {
    status.textContent = err.message;
  }
});

async function alternarAtivoProfissional(p) {
  try {
    await chamarApi(`/admin/api/profissionais/${p.id}`, {
      method: "PUT",
      body: JSON.stringify({ ativo: !p.ativo }),
    });
    carregarProfissionais();
  } catch (err) {
    alert(err.message);
  }
}

async function excluirProfissional(id) {
  if (!confirm("Excluir esse profissional? Não dá pra desfazer.")) return;
  try {
    await chamarApi(`/admin/api/profissionais/${id}`, { method: "DELETE" });
    carregarProfissionais();
  } catch (err) {
    alert(err.message);
  }
}

el("formProfissional").addEventListener("submit", async (e) => {
  e.preventDefault();
  const btn = el("btnSalvarProfissional");
  const idEditando = el("profissionalEditandoId").value;
  btn.disabled = true;
  el("profissionalErro").hidden = true;

  const servicoIdsMarcados = [
    ...document.querySelectorAll("#profissionalServicosCheckboxes input:checked"),
  ].map((cb) => cb.value);

  const corpo = {
    nome: el("profissionalNome").value.trim(),
    foto_url: el("profissionalFotoUrl").value || null,
  };

  try {
    let profissionalId = idEditando;

    if (idEditando) {
      await chamarApi(`/admin/api/profissionais/${idEditando}`, {
        method: "PUT",
        body: JSON.stringify(corpo),
      });
    } else {
      const { profissional } = await chamarApi("/admin/api/profissionais", {
        method: "POST",
        body: JSON.stringify(corpo),
      });
      profissionalId = profissional.id;
    }

    await chamarApi(`/admin/api/profissionais/${profissionalId}/servicos`, {
      method: "PUT",
      body: JSON.stringify({ servico_ids: servicoIdsMarcados }),
    });

    cancelarEdicaoProfissional();
    carregarProfissionais();
  } catch (err) {
    el("profissionalErro").textContent = err.message;
    el("profissionalErro").hidden = false;
  } finally {
    btn.disabled = false;
  }
});

// ============================================================
// PORTFÓLIO
// ============================================================
let portfolioArquivoUrlPendente = null;

el("portfolioFotoArquivo").addEventListener("change", async () => {
  const arquivo = el("portfolioFotoArquivo").files[0];
  if (!arquivo) return;
  const status = el("portfolioStatus");
  status.textContent = "Enviando...";

  const formData = new FormData();
  formData.append("arquivo", arquivo);

  try {
    const resp = await fetch("/admin/api/upload/imagem?pasta=portfolio", {
      method: "POST",
      credentials: "include",
      body: formData,
    });
    const dados = await resp.json();
    if (!resp.ok) throw new Error(dados.erro || "Erro ao enviar imagem.");

    portfolioArquivoUrlPendente = dados.url;

    await chamarApi("/admin/api/portfolio", {
      method: "POST",
      body: JSON.stringify({
        imagem_url: dados.url,
        descricao: el("portfolioDescricao").value.trim(),
      }),
    });

    status.textContent = "Foto adicionada.";
    el("portfolioDescricao").value = "";
    el("portfolioFotoArquivo").value = "";
    carregarPortfolio();
  } catch (err) {
    status.textContent = err.message;
  }
});

async function carregarPortfolio() {
  const grid = el("gridPortfolio");
  grid.innerHTML = "";

  try {
    const { fotos } = await chamarApi("/admin/api/portfolio");

    if (!fotos || fotos.length === 0) {
      el("portfolioVazioAdmin").hidden = false;
      return;
    }
    el("portfolioVazioAdmin").hidden = true;

    fotos.forEach((foto, indice) => {
      const card = document.createElement("div");
      card.className = "portfolio-card";
      card.innerHTML = `
        <img src="${foto.imagem_url}" alt="" />
        <div class="portfolio-card-corpo">
          <input type="text" class="input" value="${escaparAtributoHtml(foto.descricao || "")}" placeholder="Descrição" />
          <div class="portfolio-card-acoes">
            <button data-acao="subir" ${indice === 0 ? "disabled" : ""}>▲</button>
            <button data-acao="descer" ${indice === fotos.length - 1 ? "disabled" : ""}>▼</button>
            <button data-acao="excluir">Excluir</button>
          </div>
        </div>
      `;

      const inputDescricao = card.querySelector("input");
      inputDescricao.addEventListener("change", () => salvarDescricaoPortfolio(foto.id, inputDescricao.value));
      card.querySelector('[data-acao="subir"]').addEventListener("click", () => moverPortfolio(foto.id, "cima"));
      card.querySelector('[data-acao="descer"]').addEventListener("click", () => moverPortfolio(foto.id, "baixo"));
      card.querySelector('[data-acao="excluir"]').addEventListener("click", () => excluirPortfolio(foto.id));

      grid.appendChild(card);
    });
  } catch (err) {
    console.error("Erro ao carregar portfólio:", err);
  }
}

function escaparAtributoHtml(texto) {
  return escaparHtml(texto).replace(/"/g, "&quot;");
}

async function salvarDescricaoPortfolio(id, descricao) {
  try {
    await chamarApi(`/admin/api/portfolio/${id}`, {
      method: "PUT",
      body: JSON.stringify({ descricao }),
    });
  } catch (err) {
    alert(err.message);
  }
}

async function moverPortfolio(id, direcao) {
  try {
    await chamarApi(`/admin/api/portfolio/${id}/mover`, {
      method: "POST",
      body: JSON.stringify({ direcao }),
    });
    carregarPortfolio();
  } catch (err) {
    alert(err.message);
  }
}

async function excluirPortfolio(id) {
  if (!confirm("Excluir essa foto? Não dá pra desfazer.")) return;
  try {
    await chamarApi(`/admin/api/portfolio/${id}`, { method: "DELETE" });
    carregarPortfolio();
  } catch (err) {
    alert(err.message);
  }
}

// ============================================================
// HORÁRIOS DISPONÍVEIS (por profissional)
// ============================================================
let profissionaisParaHorarios = [];

async function carregarSeletorHorarios() {
  const select = el("horarioProfissionalSelect");

  try {
    const { profissionais } = await chamarApi("/admin/api/profissionais");
    profissionaisParaHorarios = profissionais || [];

    if (profissionaisParaHorarios.length === 0) {
      select.innerHTML = "";
      el("gradeHorarios").innerHTML = "";
      el("gradeHorariosVazio").hidden = false;
      return;
    }
    el("gradeHorariosVazio").hidden = true;

    select.innerHTML = profissionaisParaHorarios
      .map((p) => `<option value="${p.id}">${escaparHtml(p.nome)}</option>`)
      .join("");

    montarGradeHorarios(profissionaisParaHorarios[0]);
  } catch (err) {
    console.error("Erro ao carregar profissionais pra horários:", err);
  }
}

el("horarioProfissionalSelect").addEventListener("change", () => {
  const profissional = profissionaisParaHorarios.find(
    (p) => p.id === el("horarioProfissionalSelect").value,
  );
  if (profissional) montarGradeHorarios(profissional);
});

function montarGradeHorarios(profissional) {
  const grade = el("gradeHorarios");
  grade.innerHTML = "";

  const horarios = profissional.horarios_disponiveis || {};

  for (let d = 0; d <= 6; d++) {
    const lista = horarios[d] ?? horarios[String(d)] ?? [];

    const linha = document.createElement("div");
    linha.className = "linha-grade-dia";
    linha.dataset.dia = d;

    linha.innerHTML = `
      <div class="linha-grade-dia-topo">
        <span class="linha-grade-dia-nome">${DIAS_ABREV[d]}</span>
        <div class="linha-grade-dia-add">
          <input type="time" class="input input-novo-horario" />
          <button type="button" data-acao="adicionar">+ Adicionar</button>
        </div>
      </div>
      <div class="chips-horarios"></div>
    `;

    renderizarChipsHorario(linha, lista, profissional.id, d);

    linha.querySelector('[data-acao="adicionar"]').addEventListener("click", () => {
      const input = linha.querySelector(".input-novo-horario");
      if (!input.value) return;
      adicionarHorario(profissional.id, d, input.value);
      input.value = "";
    });

    grade.appendChild(linha);
  }
}

function renderizarChipsHorario(linha, lista, profissionalId, dia) {
  const container = linha.querySelector(".chips-horarios");
  container.innerHTML = "";

  if (!lista || lista.length === 0) {
    container.innerHTML = '<span class="chips-horarios-vazio">Nenhum horário — não atende nesse dia</span>';
    return;
  }

  [...lista].sort().forEach((hora) => {
    const chip = document.createElement("span");
    chip.className = "chip-horario";
    chip.innerHTML = `${hora} <button type="button" aria-label="Remover">×</button>`;
    chip.querySelector("button").addEventListener("click", () => {
      removerHorario(profissionalId, dia, hora);
    });
    container.appendChild(chip);
  });
}

function pegarProfissionalAtual() {
  const id = el("horarioProfissionalSelect").value;
  return profissionaisParaHorarios.find((p) => p.id === id);
}

async function salvarHorariosProfissional(profissional) {
  try {
    await chamarApi(`/admin/api/profissionais/${profissional.id}/horarios`, {
      method: "PUT",
      body: JSON.stringify({ horarios_disponiveis: profissional.horarios_disponiveis }),
    });
  } catch (err) {
    alert(err.message);
  }
}

function adicionarHorario(profissionalId, dia, hora) {
  const profissional = pegarProfissionalAtual();
  if (!profissional || profissional.id !== profissionalId) return;

  const horarios = profissional.horarios_disponiveis || {};
  const listaAtual = horarios[dia] ?? horarios[String(dia)] ?? [];

  if (!listaAtual.includes(hora)) {
    horarios[dia] = [...listaAtual, hora].sort();
    profissional.horarios_disponiveis = horarios;
    salvarHorariosProfissional(profissional);
  }

  montarGradeHorarios(profissional);
}

function removerHorario(profissionalId, dia, hora) {
  const profissional = pegarProfissionalAtual();
  if (!profissional || profissional.id !== profissionalId) return;

  const horarios = profissional.horarios_disponiveis || {};
  const listaAtual = horarios[dia] ?? horarios[String(dia)] ?? [];

  horarios[dia] = listaAtual.filter((h) => h !== hora);
  profissional.horarios_disponiveis = horarios;
  salvarHorariosProfissional(profissional);

  montarGradeHorarios(profissional);
}

// ============================================================
// INIT
// ============================================================
verificarSessao();
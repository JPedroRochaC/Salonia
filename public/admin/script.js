const el = (id) => document.getElementById(id);

const estado = {
  salao: null,
};

// ============================================================
// PWA — registro do service worker + atualização automática
// ============================================================
if ("serviceWorker" in navigator) {
  window.addEventListener("load", () => {
    navigator.serviceWorker
      .register("/admin/sw.js")
      .then((registro) => {
        // Se já tinha um service worker novo esperando (ex.: você abriu o
        // painel numa aba durante um deploy), manda ele assumir na hora.
        if (registro.waiting) {
          registro.waiting.postMessage({ tipo: "SKIP_WAITING" });
        }

        registro.addEventListener("updatefound", () => {
          const novoWorker = registro.installing;
          if (!novoWorker) return;
          novoWorker.addEventListener("statechange", () => {
            if (novoWorker.state === "installed" && navigator.serviceWorker.controller) {
              novoWorker.postMessage({ tipo: "SKIP_WAITING" });
            }
          });
        });
      })
      .catch((err) => console.error("Erro ao registrar service worker:", err));

    // Quando o novo service worker assume o controle, recarrega a página
    // uma vez pra já exibir a versão nova (evita ficar preso numa versão
    // antiga em cache).
    let recarregandoPorAtualizacao = false;
    navigator.serviceWorker.addEventListener("controllerchange", () => {
      if (recarregandoPorAtualizacao) return;
      recarregandoPorAtualizacao = true;
      window.location.reload();
    });
  });
}

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
// NOTIFICAÇÕES PUSH
// ============================================================

// Web Push exige que a chave VAPID pública seja convertida desse jeito
// (formato padrão, não é nada específico do Salonia).
function urlBase64ToUint8Array(base64String) {
  const padding = "=".repeat((4 - (base64String.length % 4)) % 4);
  const base64 = (base64String + padding).replace(/-/g, "+").replace(/_/g, "/");
  const rawData = window.atob(base64);
  return Uint8Array.from([...rawData].map((char) => char.charCodeAt(0)));
}

async function atualizarBotaoNotificacoes() {
  const botao = el("btnNotificacoes");
  if (!botao) return;

  if (!("serviceWorker" in navigator) || !("PushManager" in window)) {
    botao.hidden = true;
    return;
  }

  if (Notification.permission === "denied") {
    botao.textContent = "🔕 Notificações bloqueadas no navegador";
    botao.disabled = true;
    return;
  }

  const registro = await navigator.serviceWorker.ready;
  const inscricaoAtual = await registro.pushManager.getSubscription();

  botao.textContent = inscricaoAtual
    ? "🔔 Notificações ativadas"
    : "🔔 Ativar notificações";
}

async function ativarNotificacoes() {
  const botao = el("btnNotificacoes");
  try {
    const permissao = await Notification.requestPermission();
    if (permissao !== "granted") {
      alert("Pra receber notificações, você precisa permitir no navegador.");
      return;
    }

    const registro = await navigator.serviceWorker.ready;

    let inscricao = await registro.pushManager.getSubscription();
    if (!inscricao) {
      const { publicKey } = await chamarApi("/admin/api/push/vapid-public-key");
      inscricao = await registro.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: urlBase64ToUint8Array(publicKey),
      });
    }

    await chamarApi("/admin/api/push/subscribe", {
      method: "POST",
      body: JSON.stringify(inscricao.toJSON()),
    });

    if (botao) botao.textContent = "🔔 Notificações ativadas";
  } catch (err) {
    console.error("Erro ao ativar notificações:", err);
    // TEMPORÁRIO PRA DIAGNÓSTICO — depois de descobrir a causa, reverte
    // essa linha pra mensagem genérica de novo.
    alert("Erro ao ativar notificações: " + (err?.message || err));
  }
}

el("btnNotificacoes")?.addEventListener("click", ativarNotificacoes);

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
  atualizarBotaoNotificacoes();
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
    el("statHoje").textContent = dados.agendamentosHoje;
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
        item.className = "agendamento-item";

        const dataFormatada = new Date(ag.data_hora).toLocaleString("pt-BR", {
          day: "2-digit",
          month: "2-digit",
          hour: "2-digit",
          minute: "2-digit",
        });

        const rotulo = ROTULOS_STATUS[ag.status] || ag.status;

        item.innerHTML = `
          <div class="agendamento-info">
            <span class="agendamento-cliente">
              <strong>${escaparHtml(ag.clientes?.nome || "Cliente")}</strong>
            </span>
            <span class="agendamento-detalhe">
              ${dataFormatada} · ${escaparHtml(ag.servicos?.nome || "")} · ${formatarMoeda(ag.valor)}
            </span>
          </div>
          <div class="agendamento-lado">
            <span class="status-badge status-${ag.status}">${rotulo}</span>
          </div>
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
// AGENDAMENTOS (calendário semanal)
// ============================================================
const ROTULOS_STATUS = {
  aguardando_pagamento: "Aguardando pagamento",
  aguardando_confirmacao: "Aguardando confirmação",
  confirmado: "Confirmado",
  concluido: "Concluído",
  cancelado: "Cancelado",
};

// Precisa bater com --cal-hora-altura definido em style.css
const ROW_HEIGHT_PX = 60;
const DIAS_SEMANA = ["DOM", "SEG", "TER", "QUA", "QUI", "SEX", "SÁB"];
const MESES_ABREV = ["jan", "fev", "mar", "abr", "mai", "jun", "jul", "ago", "set", "out", "nov", "dez"];

// Qualquer dia dentro da semana atualmente exibida
let semanaReferencia = new Date();

// Índice (0-6) do dia escolhido na visão "1 dia por vez" do mobile.
// null = ainda não escolhido -> assume hoje (se estiver na semana) ou domingo.
let diaSelecionadoIndice = null;

// Guarda o último resultado buscado para poder re-renderizar (troca de dia,
// virar a tela, redimensionar a janela) sem precisar buscar tudo de novo.
let ultimoResultadoSemana = null;

const mediaMobile = window.matchMedia("(max-width: 820px)");

function ehMobile() {
  return mediaMobile.matches;
}

mediaMobile.addEventListener("change", () => {
  if (ultimoResultadoSemana) {
    renderizarCalendarioSemana(ultimoResultadoSemana.dias, ultimoResultadoSemana.eventosPorDia);
  }
});

function formatarDataISO(data) {
  const ano = data.getFullYear();
  const mes = String(data.getMonth() + 1).padStart(2, "0");
  const dia = String(data.getDate()).padStart(2, "0");
  return `${ano}-${mes}-${dia}`;
}

function inicioDaSemana(data) {
  const d = new Date(data);
  d.setHours(0, 0, 0, 0);
  d.setDate(d.getDate() - d.getDay());
  return d;
}

function mesmoDia(a, b) {
  return (
    a.getFullYear() === b.getFullYear() &&
    a.getMonth() === b.getMonth() &&
    a.getDate() === b.getDate()
  );
}

el("btnSemanaAnterior").addEventListener("click", () => navegarCalendario(-1));
el("btnSemanaProxima").addEventListener("click", () => navegarCalendario(1));
el("btnSemanaHoje").addEventListener("click", () => {
  semanaReferencia = new Date();
  diaSelecionadoIndice = null; // recalculado no render: cai em "hoje"
  carregarAgendamentos();
});
el("filtroStatus").addEventListener("change", carregarAgendamentos);

// No mobile navega 1 dia por vez (combina com a visão de 1 dia); no
// desktop navega semana inteira. Só busca de novo na API quando a
// navegação cruza pra uma semana diferente da que já está carregada.
function navegarCalendario(direcao) {
  if (ehMobile() && diaSelecionadoIndice !== null) {
    const novoIndice = diaSelecionadoIndice + direcao;

    if (novoIndice < 0) {
      semanaReferencia = new Date(semanaReferencia);
      semanaReferencia.setDate(semanaReferencia.getDate() - 7);
      diaSelecionadoIndice = 6;
      carregarAgendamentos();
    } else if (novoIndice > 6) {
      semanaReferencia = new Date(semanaReferencia);
      semanaReferencia.setDate(semanaReferencia.getDate() + 7);
      diaSelecionadoIndice = 0;
      carregarAgendamentos();
    } else {
      diaSelecionadoIndice = novoIndice;
      if (ultimoResultadoSemana) {
        renderizarCalendarioSemana(ultimoResultadoSemana.dias, ultimoResultadoSemana.eventosPorDia);
      }
    }
    return;
  }

  semanaReferencia = new Date(semanaReferencia);
  semanaReferencia.setDate(semanaReferencia.getDate() + direcao * 7);
  diaSelecionadoIndice = null;
  carregarAgendamentos();
}

async function carregarAgendamentos() {
  const grid = el("calendarioSemana");
  const vazio = el("agendamentosVazio");
  vazio.hidden = true;

  const inicio = inicioDaSemana(semanaReferencia);
  const diasDaSemana = [];
  for (let i = 0; i < 7; i++) {
    const d = new Date(inicio);
    d.setDate(inicio.getDate() + i);
    diasDaSemana.push(d);
  }

  const status = el("filtroStatus").value;
  grid.innerHTML = '<p class="cal-vazia-semana">Carregando…</p>';

  try {
    // A API só filtra por um dia por vez — buscamos os 7 dias em paralelo
    const resultadosPorDia = await Promise.all(
      diasDaSemana.map((d) => {
        const params = new URLSearchParams({ data: formatarDataISO(d) });
        if (status) params.set("status", status);
        return chamarApi(`/admin/api/agendamentos?${params}`)
          .then((r) => r.agendamentos || [])
          .catch(() => []);
      })
    );

    const totalEventos = resultadosPorDia.reduce((soma, lista) => soma + lista.length, 0);
    vazio.hidden = totalEventos > 0;

    renderizarCalendarioSemana(diasDaSemana, resultadosPorDia);
  } catch (err) {
    console.error("Erro ao carregar agendamentos:", err);
    grid.innerHTML = '<p class="cal-vazia-semana">Não foi possível carregar os agendamentos.</p>';
  }
}

function capitalizar(texto) {
  return texto.charAt(0).toUpperCase() + texto.slice(1);
}

// No mobile (1 dia por vez) mostra o dia por extenso; no desktop (semana
// inteira) mostra o intervalo da semana.
function atualizarRotulo(dias, mobile) {
  const rotulo = el("calendarioRotuloSemana");

  if (mobile) {
    const d = dias[diaSelecionadoIndice] || dias[0];
    const nomeDia = capitalizar(d.toLocaleDateString("pt-BR", { weekday: "long" }));
    rotulo.textContent = `${nomeDia}, ${d.getDate()} de ${MESES_ABREV[d.getMonth()]}.`;
    return;
  }

  const inicioSemana = dias[0];
  const fimSemana = dias[6];
  const mesmoMes = inicioSemana.getMonth() === fimSemana.getMonth();

  rotulo.textContent = mesmoMes
    ? `${inicioSemana.getDate()} – ${fimSemana.getDate()} de ${MESES_ABREV[fimSemana.getMonth()]}. de ${fimSemana.getFullYear()}`
    : `${inicioSemana.getDate()} de ${MESES_ABREV[inicioSemana.getMonth()]}. – ${fimSemana.getDate()} de ${MESES_ABREV[fimSemana.getMonth()]}. de ${fimSemana.getFullYear()}`;
}

function renderizarCalendarioSemana(dias, eventosPorDia) {
  ultimoResultadoSemana = { dias, eventosPorDia };

  const grid = el("calendarioSemana");
  const hoje = new Date();

  renderizarChipsDias(dias, hoje);

  const mobile = ehMobile();

  // No mobile mostramos só o dia escolhido (mais legível que espremer 7
  // colunas numa tela pequena); no desktop mostramos a semana inteira.
  let indicesParaExibir = [0, 1, 2, 3, 4, 5, 6];
  if (mobile) {
    if (diaSelecionadoIndice === null) {
      const indiceHoje = dias.findIndex((d) => mesmoDia(d, hoje));
      diaSelecionadoIndice = indiceHoje !== -1 ? indiceHoje : 0;
    }
    indicesParaExibir = [diaSelecionadoIndice];
  }

  grid.classList.toggle("calendario-semana--dia-unico", indicesParaExibir.length === 1);
  grid.style.setProperty("--cal-num-dias", indicesParaExibir.length);
  atualizarRotulo(dias, mobile);
  el("btnSemanaAnterior").setAttribute("aria-label", mobile ? "Dia anterior" : "Semana anterior");
  el("btnSemanaProxima").setAttribute("aria-label", mobile ? "Próximo dia" : "Próxima semana");

  // Intervalo de horas exibido: 6h–22h fixo, só alargado se algum
  // agendamento da semana cair fora dessa faixa (mantém a mesma faixa ao
  // trocar de dia no mobile, pra não "pular" a régua de horários).
  let horaMin = 6;
  let horaMax = 22;
  eventosPorDia.flat().forEach((ag) => {
    const inicioEvento = new Date(ag.data_hora);
    const fimEvento = new Date(inicioEvento.getTime() + ag.duracao_minutos * 60000);
    horaMin = Math.min(horaMin, inicioEvento.getHours());
    const horaFimArredondada = fimEvento.getMinutes() > 0 ? fimEvento.getHours() + 1 : fimEvento.getHours();
    horaMax = Math.max(horaMax, horaFimArredondada);
  });

  const totalHoras = horaMax - horaMin;

  let cabecalhoHtml = '<div class="cal-canto"></div>';
  indicesParaExibir.forEach((indiceDia) => {
    const d = dias[indiceDia];
    const ehHoje = mesmoDia(d, hoje);
    cabecalhoHtml += `
      <div class="cal-dia-cabecalho${ehHoje ? " cal-dia-cabecalho-hoje" : ""}">
        <span class="cal-dia-nome">${DIAS_SEMANA[d.getDay()]}</span>
        <span class="cal-dia-numero">${d.getDate()}</span>
      </div>`;
  });

  let horasHtml = "";
  for (let h = horaMin; h < horaMax; h++) {
    horasHtml += `<div class="cal-hora-label" data-hora="${h}"><span>${String(h).padStart(2, "0")}:00</span></div>`;
  }

  let colunasHtml = "";
  indicesParaExibir.forEach((indiceDia) => {
    const d = dias[indiceDia];
    const ehHoje = mesmoDia(d, hoje);
    const eventos = calcularLayoutEventos(eventosPorDia[indiceDia] || []);

    let eventosHtml = "";
    eventos.forEach(({ ag, coluna, totalColunas }) => {
      const inicioEvento = new Date(ag.data_hora);
      const minutosDesdeInicioGrid = (inicioEvento.getHours() - horaMin) * 60 + inicioEvento.getMinutes();
      const top = (minutosDesdeInicioGrid / 60) * ROW_HEIGHT_PX;
      const altura = Math.max((ag.duracao_minutos / 60) * ROW_HEIGHT_PX, 22);
      const largura = 100 / totalColunas;
      const esquerda = largura * coluna;
      const hora = inicioEvento.toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" });

      eventosHtml += `
        <div class="cal-evento cal-evento-${ag.status}"
             style="top:${top}px; height:${altura}px; left:calc(${esquerda}% + 2px); width:calc(${largura}% - 4px);"
             data-id="${ag.id}">
          <span class="cal-evento-hora">${hora}</span>
          <span class="cal-evento-cliente">${escaparHtml(ag.clientes?.nome || "Cliente")}</span>
          <span class="cal-evento-detalhe">${escaparHtml(ag.servicos?.nome || "")}</span>
        </div>`;
    });

    colunasHtml += `
      <div class="cal-dia-coluna${ehHoje ? " cal-dia-coluna-hoje" : ""}" style="height:${totalHoras * ROW_HEIGHT_PX}px;" data-dia="${indiceDia}">
        ${eventosHtml}
      </div>`;
  });

  grid.innerHTML = `
    <div class="cal-cabecalho">${cabecalhoHtml}</div>
    <div class="cal-corpo">
      <div class="cal-horas">${horasHtml}</div>
      <div class="cal-dias">${colunasHtml}</div>
    </div>
  `;

  const mapaEventos = {};
  eventosPorDia.flat().forEach((ag) => {
    mapaEventos[ag.id] = ag;
  });

  grid.querySelectorAll(".cal-evento").forEach((elemento) => {
    elemento.addEventListener("click", () => {
      const ag = mapaEventos[elemento.dataset.id];
      if (ag) abrirDetalheAgendamento(ag);
    });
  });

  // No mobile, ao trocar de dia sempre volta pro início da faixa (6h),
  // assim nada aparece cortado por baixo do cabeçalho fixo.
  if (mobile) {
    const alvo = grid.querySelector(`.cal-hora-label[data-hora="${horaMin}"]`);
    if (alvo) {
      requestAnimationFrame(() => alvo.scrollIntoView({ block: "start", behavior: "auto" }));
    }
  }
}

// Fileira de "abas" de dia usada só no mobile (visão de 1 dia por vez).
// No desktop fica escondida via CSS, mas montamos sempre pra já existir
// pronta quando a tela for redimensionada pra baixo de 820px.
function renderizarChipsDias(dias, hoje) {
  const container = el("calendarioDiasMobile");
  container.innerHTML = "";

  dias.forEach((d, indice) => {
    const ehHoje = mesmoDia(d, hoje);
    const ehAtivo = diaSelecionadoIndice === indice;

    const chip = document.createElement("button");
    chip.type = "button";
    chip.className = `cal-chip-dia${ehAtivo ? " cal-chip-dia-ativo" : ""}${ehHoje ? " cal-chip-dia-hoje" : ""}`;
    chip.innerHTML = `
      <span class="cal-chip-dia-nome">${DIAS_SEMANA[d.getDay()]}</span>
      <span class="cal-chip-dia-numero">${d.getDate()}</span>
    `;
    chip.addEventListener("click", () => {
      diaSelecionadoIndice = indice;
      if (ultimoResultadoSemana) {
        renderizarCalendarioSemana(ultimoResultadoSemana.dias, ultimoResultadoSemana.eventosPorDia);
      }
    });

    container.appendChild(chip);
  });
}

// Distribui, lado a lado, agendamentos que se sobrepõem no mesmo dia
// (mesma ideia do Google Calendar quando há dois horários conflitantes).
function calcularLayoutEventos(agendamentos) {
  const ordenados = [...agendamentos].sort((a, b) => new Date(a.data_hora) - new Date(b.data_hora));

  const finalDasColunas = []; // horário (ms) em que cada coluna fica livre de novo
  const posicionados = ordenados.map((ag) => {
    const inicio = new Date(ag.data_hora).getTime();
    const fim = inicio + ag.duracao_minutos * 60000;

    let coluna = finalDasColunas.findIndex((fimColuna) => fimColuna <= inicio);
    if (coluna === -1) {
      coluna = finalDasColunas.length;
      finalDasColunas.push(fim);
    } else {
      finalDasColunas[coluna] = fim;
    }

    return { ag, coluna };
  });

  const totalColunas = Math.max(finalDasColunas.length, 1);
  return posicionados.map((p) => ({ ...p, totalColunas }));
}

function abrirDetalheAgendamento(ag) {
  const corpo = el("agendamentoPopoverCorpo");

  const hora = new Date(ag.data_hora).toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" });
  const dataFormatada = new Date(ag.data_hora).toLocaleDateString("pt-BR", {
    weekday: "long",
    day: "2-digit",
    month: "long",
  });

  const telefoneLimpo = (ag.clientes?.telefone || "").replace(/\D/g, "");
  const linkWhatsapp = telefoneLimpo
    ? `<a href="https://wa.me/55${telefoneLimpo}" target="_blank" rel="noopener">${escaparHtml(ag.clientes?.telefone || "")}</a>`
    : "";

  const rotulo = ROTULOS_STATUS[ag.status] || ag.status;

  corpo.innerHTML = `
    <h3 id="agendamentoPopoverTitulo" class="agendamento-hora" style="text-transform:capitalize; margin-bottom:6px;">
      ${dataFormatada} · ${hora}
    </h3>
    <span class="agendamento-cliente" style="display:block; margin-bottom:6px;">
      <strong>${escaparHtml(ag.clientes?.nome || "Cliente")}</strong>
      ${linkWhatsapp ? " · " + linkWhatsapp : ""}
    </span>
    <span class="agendamento-detalhe" style="display:block; margin-bottom:10px;">
      ${escaparHtml(ag.servicos?.nome || "")} com ${escaparHtml(ag.profissionais?.nome || "")} · ${formatarMoeda(ag.valor)}
    </span>
    ${
      ag.comprovante_url
        ? `<span class="agendamento-comprovante" style="display:block; margin-bottom:10px;"><a href="${ag.comprovante_url}" target="_blank" rel="noopener">Ver comprovante</a></span>`
        : ""
    }
    <span class="status-badge status-${ag.status}">${rotulo}</span>
    <div class="agendamento-acoes" id="agendamentoPopoverAcoes" style="margin-top:14px; justify-content:flex-start;"></div>
  `;

  const acoes = el("agendamentoPopoverAcoes");
  const botao = (texto, novoStatus, classe = "") => {
    const b = document.createElement("button");
    b.className = `btn-mini ${classe}`;
    b.textContent = texto;
    b.addEventListener("click", async () => {
      await mudarStatusAgendamento(ag.id, novoStatus);
      fecharDetalheAgendamento();
    });
    return b;
  };

  if (ag.status === "aguardando_pagamento" || ag.status === "aguardando_confirmacao") {
    acoes.appendChild(botao("Confirmar", "confirmado", "btn-mini-primary"));
    acoes.appendChild(botao("Cancelar", "cancelado", "btn-mini-perigo"));
  } else if (ag.status === "confirmado") {
    acoes.appendChild(botao("Marcar concluído", "concluido", "btn-mini-primary"));
    acoes.appendChild(botao("Cancelar", "cancelado", "btn-mini-perigo"));
  }

  el("agendamentoPopoverOverlay").hidden = false;
}

function fecharDetalheAgendamento() {
  el("agendamentoPopoverOverlay").hidden = true;
}

el("btnFecharAgendamentoPopover").addEventListener("click", fecharDetalheAgendamento);
el("agendamentoPopoverOverlay").addEventListener("click", (e) => {
  if (e.target === el("agendamentoPopoverOverlay")) fecharDetalheAgendamento();
});
document.addEventListener("keydown", (e) => {
  if (e.key === "Escape" && !el("agendamentoPopoverOverlay").hidden) fecharDetalheAgendamento();
});

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
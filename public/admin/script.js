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

function aplicarMascaraTelefone(valor) {
  return String(valor || "")
    .replace(/\D/g, "")
    .replace(/^(\d{2})(\d)/, "($1) $2")
    .replace(/(\d{5})(\d)/, "$1-$2")
    .slice(0, 15);
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

  const ehiOS = /iPad|iPhone|iPod/.test(navigator.userAgent) && !window.MSStream;
  const ehStandalone = window.navigator.standalone === true || window.matchMedia("(display-mode: standalone)").matches;

  if (ehiOS && !ehStandalone) {
    botao.textContent = "🔔 Notificações (PWA necessário)";
    botao.disabled = true;
    const alertIos = el("pwaIosAlert");
    if (alertIos) alertIos.hidden = false;
    return;
  } else {
    const alertIos = el("pwaIosAlert");
    if (alertIos) alertIos.hidden = true;
  }

  if (Notification.permission === "denied") {
    botao.textContent = "🔕 Notificações bloqueadas";
    botao.disabled = true;
    return;
  }

  const registro = await navigator.serviceWorker.ready;
  const inscricaoAtual = await registro.pushManager.getSubscription();

  if (inscricaoAtual) {
    botao.textContent = "🔔 Notificações ativadas";
    // Sincroniza em segundo plano pra garantir que o banco tem a inscrição atualizada
    chamarApi("/admin/api/push/subscribe", {
      method: "POST",
      body: JSON.stringify(inscricaoAtual.toJSON()),
    }).catch((err) => console.error("Erro ao sincronizar inscrição push:", err));
  } else {
    botao.textContent = "🔔 Ativar notificações";
  }
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
    const { publicKey } = await chamarApi("/admin/api/push/vapid-public-key");
    const serverKey = urlBase64ToUint8Array(publicKey);

    let inscricao = await registro.pushManager.getSubscription();
    if (inscricao) {
      // Verifica se a chave cadastrada no navegador bate com a do servidor atual
      const inscChave = inscricao.options.applicationServerKey;
      let chaveIgual = false;
      if (inscChave) {
        const arrInsc = new Uint8Array(inscChave);
        if (arrInsc.length === serverKey.length) {
          chaveIgual = arrInsc.every((v, i) => v === serverKey[i]);
        }
      }

      if (!chaveIgual) {
        console.log("Reinscrito push pois a chave pública VAPID mudou.");
        await inscricao.unsubscribe();
        inscricao = null;
      }
    }

    if (!inscricao) {
      inscricao = await registro.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: serverKey,
      });
    }

    await chamarApi("/admin/api/push/subscribe", {
      method: "POST",
      body: JSON.stringify(inscricao.toJSON()),
    });

    if (botao) botao.textContent = "🔔 Notificações ativadas";
  } catch (err) {
    console.error("Erro ao ativar notificações:", err);
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

    if (aba === "dashboard") carregarDashboard();
    if (aba === "clientes") carregarClientes();
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
    el("statFaturamentoComparacao").textContent = dados.variacaoFaturamento === null
      ? "Comparação disponível no próximo mês"
      : `${dados.variacaoFaturamento >= 0 ? "↑" : "↓"} ${Math.abs(dados.variacaoFaturamento).toFixed(0)}% em relação ao mês anterior`;
    el("statHoje").textContent = dados.agendamentosHoje;
    el("statTotal").textContent = dados.totalAgendamentosMes;
    el("statTicket").textContent = formatarMoeda(dados.ticketMedio);
    el("statPendentes").textContent = dados.pendentes || 0;
    el("statCancelamentos").textContent = dados.cancelamentos || 0;
    el("statProfissionaisAtivos").textContent = dados.profissionaisAtivos || 0;

    const alertas = [...(dados.alertas || [])];
    if (dados.pendentes) alertas.unshift({ tipo: "pendencia", texto: `${dados.pendentes} confirmação(ões) ou pagamento(s) aguardando atenção.` });
    if (dados.aniversariantes?.length) alertas.push({ tipo: "aniversario", texto: `Aniversariante${dados.aniversariantes.length > 1 ? "s" : ""} de hoje: ${dados.aniversariantes.join(", ")}.` });
    el("dashboardPendenciasResumo").textContent = alertas.length ? `${alertas.length} aviso${alertas.length > 1 ? "s" : ""}` : "Tudo em dia";
    const listaAlertas = el("dashboardAlertas");
    listaAlertas.innerHTML = "";
    el("dashboardAlertasVazio").hidden = alertas.length > 0;
    alertas.slice(0, 5).forEach((alerta) => {
      const item = document.createElement("div");
      item.className = `dashboard-alerta dashboard-alerta-${alerta.tipo || "info"}`;
      item.textContent = alerta.texto;
      listaAlertas.appendChild(item);
    });
    renderizarRankingDashboard("dashboardServicosDestaque", dados.servicosDestaque, "Nenhum atendimento concluído neste mês.");
    renderizarRankingDashboard("dashboardProfissionaisDestaque", dados.profissionaisDestaque, "Nenhum atendimento concluído neste mês.");

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
        const clicavel = ag.status === "aguardando_pagamento" || ag.status === "aguardando_confirmacao";

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
            ${
              ag.foto_referencia_url
                ? `<button type="button" class="btn-mini btn-mini-referencia" data-foto="/admin/api/agendamentos/${ag.id}/referencia">
     <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
       <path d="M23 19a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4l2-3h6l2 3h4a2 2 0 0 1 2 2z"/>
       <circle cx="12" cy="13" r="4"/>
     </svg>
     Referência
   </button>`
                : ""
            }
            ${
              ag.comprovante_url
                ? `<button type="button" class="btn-mini btn-mini-comprovante" data-comprovante="/admin/api/agendamentos/${ag.id}/comprovante">
     <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
       <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/>
       <path d="M14 2v6h6"/>
       <line x1="9" y1="13" x2="15" y2="13"/>
       <line x1="9" y1="17" x2="15" y2="17"/>
     </svg>
     Comprovante
   </button>`
                : ""
            }
            <span class="status-badge status-${ag.status}" ${clicavel ? 'style="cursor:pointer;" title="Clique para confirmar ou cancelar"' : ""}>${rotulo}</span>
          </div>
        `;

        const botaoFoto = item.querySelector(".btn-mini-referencia");
        if (botaoFoto) {
          botaoFoto.addEventListener("click", () => {
            window.open(botaoFoto.dataset.foto, "_blank", "noopener");
          });
        }

        const botaoComprovante = item.querySelector(".btn-mini-comprovante");
        if (botaoComprovante) {
          botaoComprovante.addEventListener("click", () => {
            window.open(botaoComprovante.dataset.comprovante, "_blank", "noopener");
          });
        }

        if (clicavel) {
          item.querySelector(".status-badge").addEventListener("click", () => abrirDetalheAgendamento(ag));
        }

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
const DIAS_ABREV = ["Domingo", "Segunda-feira", "Terça-feira", "Quarta-feira", "Quinta-feira", "Sexta-feira", "Sábado"];

function luminosidadeDaCor(hex) {
  const canais = [1, 3, 5].map((inicio) => Number.parseInt(hex.slice(inicio, inicio + 2), 16) / 255)
    .map((canal) => canal <= 0.03928 ? canal / 12.92 : ((canal + 0.055) / 1.055) ** 2.4);
  return canais[0] * 0.2126 + canais[1] * 0.7152 + canais[2] * 0.0722;
}

function renderizarRankingDashboard(id, itens, vazio) {
  const container = el(id);
  container.innerHTML = "";
  if (!itens?.length) {
    container.innerHTML = `<p class="ranking-dashboard-vazio">${vazio}</p>`;
    return;
  }
  itens.forEach((item, indice) => {
    const linha = document.createElement("div");
    linha.className = "ranking-dashboard-item";
    linha.innerHTML = `<span>${indice + 1}</span><strong>${escaparHtml(item.nome)}</strong><small>${item.quantidade} atendimento${item.quantidade === 1 ? "" : "s"}</small>`;
    container.appendChild(linha);
  });
}

document.querySelectorAll("[data-dashboard-atalho]").forEach((botao) => {
  botao.addEventListener("click", () => {
    const atalho = botao.dataset.dashboardAtalho;
    if (atalho === "clientes" || atalho === "profissionais") {
      document.querySelector(`[data-aba="${atalho === "profissionais" ? "servicos" : atalho}"]`)?.click();
      return;
    }
    document.querySelector('[data-aba="agendamentos"]')?.click();
    setTimeout(() => el(atalho === "bloqueio" ? "btnNovoBloqueio" : "btnNovoAgendamento")?.click(), 0);
  });
});

function contrasteEntreCores(corA, corB) {
  const clara = Math.max(luminosidadeDaCor(corA), luminosidadeDaCor(corB));
  const escura = Math.min(luminosidadeDaCor(corA), luminosidadeDaCor(corB));
  return (clara + 0.05) / (escura + 0.05);
}

function validarCoresPublicas(destaque, fundo) {
  const formatoValido = /^#[0-9a-f]{6}$/i;
  if (!formatoValido.test(destaque) || !formatoValido.test(fundo)) return "Escolha cores válidas.";
  if (luminosidadeDaCor(fundo) < 0.42) return "Escolha um fundo mais claro para os cartões e textos continuarem legíveis.";
  if (contrasteEntreCores(destaque, "#ffffff") < 4.5) return "A cor de destaque está clara demais para os textos brancos dos botões.";
  if (contrasteEntreCores(destaque, fundo) < 4.5) return "As duas cores têm pouco contraste. Escolha cores mais diferentes.";
  return null;
}

function atualizarStatusContrasteCores() {
  const erro = validarCoresPublicas(el("campoCorDestaque").value, el("campoCorFundo").value);
  const status = el("statusContrasteCores");
  status.textContent = erro || "Combinação aprovada: os textos e botões continuarão legíveis.";
  status.classList.toggle("status-contraste-erro", Boolean(erro));
  status.classList.toggle("status-contraste-ok", !erro);
  return erro;
}

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

  el("campoChavePix").value = s.chave_pix || "";
  el("campoTitularPix").value = s.titular_pix || "";
  el("campoCorDestaque").value = /^#[0-9a-f]{6}$/i.test(s.cor_destaque || "") ? s.cor_destaque : "#641546";
  el("campoCorFundo").value = /^#[0-9a-f]{6}$/i.test(s.cor_fundo || "") ? s.cor_fundo : "#edc2cb";
  el("linkVisualizarPagina").href = `/${s.slug}`;
  atualizarStatusContrasteCores();

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
// (removido: o sinal agora é configurado por serviço, na aba Serviços —
// ver blocoConfigSinal em #formServico. A Chave Pix continua no nível
// do salão, já que é a mesma pra todos os serviços.)

el("formPersonalizacao").addEventListener("submit", async (e) => {
  e.preventDefault();
  const btn = el("btnSalvarPersonalizacao");
  btn.disabled = true;
  btn.textContent = "Salvando...";
  el("personalizacaoErro").hidden = true;
  el("personalizacaoSucesso").hidden = true;

  const erroCores = atualizarStatusContrasteCores();
  if (erroCores) {
    el("personalizacaoErro").textContent = erroCores;
    el("personalizacaoErro").hidden = false;
    btn.disabled = false;
    btn.textContent = "Salvar alterações";
    return;
  }

  const corpo = {
    nome: el("campoNome").value.trim(),
    telefone: el("campoTelefone").value.trim(),
    endereco: el("campoEndereco").value.trim(),
    logo_url: el("campoLogoUrl").value.trim() || null,
    redes_sociais: {
      instagram: el("campoInstagram").value.trim(),
      whatsapp: el("campoWhatsappRedes").value.trim(),
    },
    chave_pix: el("campoChavePix").value.trim() || null,
    titular_pix: el("campoTitularPix").value.trim() || null,
    cor_destaque: el("campoCorDestaque").value,
    cor_fundo: el("campoCorFundo").value,
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

// Precisa bater com --cal-hora-altura definido em style.css. Uma hora maior
// deixa os atendimentos curtos legíveis, sem transformar o calendário numa
// lista apertada de texto cortado.
const ROW_HEIGHT_PX = 76;
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
    renderizarCalendarioSemana(ultimoResultadoSemana.dias, ultimoResultadoSemana.eventosPorDia, ultimoResultadoSemana.bloqueios);
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
el("filtroProfissional").addEventListener("change", carregarAgendamentos);

let filtroProfissionaisCarregado = false;

async function carregarFiltroProfissionais() {
  if (filtroProfissionaisCarregado) return;

  const select = el("filtroProfissional");
  try {
    const { profissionais } = await chamarApi("/admin/api/profissionais");
    (profissionais || [])
      .filter((profissional) => profissional.ativo)
      .forEach((profissional) => {
        const opcao = document.createElement("option");
        opcao.value = profissional.id;
        opcao.textContent = profissional.nome;
        select.appendChild(opcao);
      });
    filtroProfissionaisCarregado = true;
  } catch (err) {
    console.error("Erro ao carregar filtro de profissionais:", err);
  }
}

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
        renderizarCalendarioSemana(ultimoResultadoSemana.dias, ultimoResultadoSemana.eventosPorDia, ultimoResultadoSemana.bloqueios);
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

  await carregarFiltroProfissionais();

  const inicio = inicioDaSemana(semanaReferencia);
  const diasDaSemana = [];
  for (let i = 0; i < 7; i++) {
    const d = new Date(inicio);
    d.setDate(inicio.getDate() + i);
    diasDaSemana.push(d);
  }

  const status = el("filtroStatus").value;
  const profissionalId = el("filtroProfissional").value;
  grid.innerHTML = '<p class="cal-vazia-semana">Carregando…</p>';

  try {
    // A API só filtra por um dia por vez — buscamos os 7 dias em paralelo
    const resultadosPorDia = await Promise.all(
      diasDaSemana.map((d) => {
        const params = new URLSearchParams({ data: formatarDataISO(d) });
        if (status) params.set("status", status);
        if (profissionalId) params.set("profissional_id", profissionalId);
        return chamarApi(`/admin/api/agendamentos?${params}`)
          .then((r) => r.agendamentos || [])
          .catch(() => []);
      })
    );

    const totalEventos = resultadosPorDia.reduce((soma, lista) => soma + lista.length, 0);
    vazio.hidden = totalEventos > 0;

    const fimSemana = new Date(diasDaSemana[6]);
    fimSemana.setDate(fimSemana.getDate() + 1);
    const { bloqueios } = await chamarApi(
      `/admin/api/agendamentos/bloqueios?${new URLSearchParams({
        inicio: diasDaSemana[0].toISOString(),
        fim: fimSemana.toISOString(),
      })}`,
    );
    renderizarCalendarioSemana(diasDaSemana, resultadosPorDia, bloqueios || []);
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

function renderizarCalendarioSemana(dias, eventosPorDia, bloqueios = []) {
  ultimoResultadoSemana = { dias, eventosPorDia, bloqueios };

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
    let bloqueiosHtml = "";
    const inicioDia = new Date(d);
    inicioDia.setHours(0, 0, 0, 0);
    const fimDia = new Date(inicioDia);
    fimDia.setDate(fimDia.getDate() + 1);

    bloqueios
      .filter((bloqueio) => new Date(bloqueio.inicio) < fimDia && new Date(bloqueio.fim) > inicioDia)
      .forEach((bloqueio) => {
        const inicioVisivel = new Date(Math.max(new Date(bloqueio.inicio).getTime(), inicioDia.getTime()));
        const fimVisivel = new Date(Math.min(new Date(bloqueio.fim).getTime(), fimDia.getTime()));
        const minutosInicio = (inicioVisivel.getHours() - horaMin) * 60 + inicioVisivel.getMinutes();
        const minutosFim = (fimVisivel.getHours() - horaMin) * 60 + fimVisivel.getMinutes();
        const topBloqueio = Math.max(0, minutosInicio / 60 * ROW_HEIGHT_PX);
        const alturaBloqueio = Math.max(24, (minutosFim - minutosInicio) / 60 * ROW_HEIGHT_PX);
        const rotuloBloqueio = bloqueio.motivo || (bloqueio.profissionais?.nome
          ? `Indisponível · ${bloqueio.profissionais.nome}`
          : "Salão indisponível");

        bloqueiosHtml += `
          <button type="button" class="cal-bloqueio" data-bloqueio-id="${bloqueio.id}"
            style="top:${topBloqueio}px; height:${alturaBloqueio}px;" title="Clique para remover">
            ${escaparHtml(rotuloBloqueio)}
          </button>`;
      });

    eventos.forEach(({ ag, coluna, totalColunas }) => {
      const inicioEvento = new Date(ag.data_hora);
      const minutosDesdeInicioGrid = (inicioEvento.getHours() - horaMin) * 60 + inicioEvento.getMinutes();
      const top = (minutosDesdeInicioGrid / 60) * ROW_HEIGHT_PX;
      const altura = Math.max((ag.duracao_minutos / 60) * ROW_HEIGHT_PX, 26);
      const largura = 100 / totalColunas;
      const esquerda = largura * coluna;
      const hora = inicioEvento.toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" });

      // Usa o espaço real do cartão para decidir se cabe o detalhe completo.
      const ehCompacto = altura < 54;
      const ehMicro = altura < 34;
      const detalhe = altura >= 54
        ? `${escaparHtml(ag.servicos?.nome || "")} · ${escaparHtml(ag.profissionais?.nome || "")}`
        : "";
      eventosHtml += `
        <div class="cal-evento cal-evento-${ag.status}${ehCompacto ? " cal-evento--compacto" : ""}${ehMicro ? " cal-evento--micro" : ""}"
             style="top:${top}px; height:${altura}px; left:calc(${esquerda}% + 2px); width:calc(${largura}% - 4px);"
             data-id="${ag.id}">
          <span class="cal-evento-hora">${hora}</span>
          <span class="cal-evento-cliente">${escaparHtml(ag.clientes?.nome || "Cliente")}</span>
          ${detalhe ? `<span class="cal-evento-detalhe">${detalhe}</span>` : ""}
        </div>`;
    });

    colunasHtml += `
      <div class="cal-dia-coluna${ehHoje ? " cal-dia-coluna-hoje" : ""}" style="height:${totalHoras * ROW_HEIGHT_PX}px;" data-dia="${indiceDia}">
        ${bloqueiosHtml}
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

  grid.querySelectorAll(".cal-bloqueio").forEach((elemento) => {
    elemento.addEventListener("click", async () => {
      if (!confirm("Remover este bloqueio da agenda?")) return;
      try {
        await chamarApi(`/admin/api/agendamentos/bloqueios/${elemento.dataset.bloqueioId}`, {
          method: "DELETE",
        });
        carregarAgendamentos();
      } catch (err) {
        alert(err.message);
      }
    });
  });

  // Um clique em um espaço livre abre o novo agendamento com o horário
  // aproximado já preenchido. Eventos existentes continuam abrindo detalhes.
  grid.querySelectorAll(".cal-dia-coluna").forEach((coluna) => {
    coluna.addEventListener("click", (evento) => {
      if (evento.target.closest(".cal-evento, .cal-bloqueio")) return;

      const indiceDia = Number(coluna.dataset.dia);
      const retangulo = coluna.getBoundingClientRect();
      const minutosNoGrid = Math.max(0, evento.clientY - retangulo.top) / ROW_HEIGHT_PX * 60;
      const minutosArredondados = Math.min(
        totalHoras * 60 - 15,
        Math.max(0, Math.round(minutosNoGrid / 15) * 15),
      );
      const data = new Date(dias[indiceDia]);
      data.setHours(horaMin, 0, 0, 0);
      data.setMinutes(data.getMinutes() + minutosArredondados);
      abrirNovoAgendamento(data);
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
        renderizarCalendarioSemana(ultimoResultadoSemana.dias, ultimoResultadoSemana.eventosPorDia, ultimoResultadoSemana.bloqueios);
      }
    });

    container.appendChild(chip);
  });
}

// Distribui, lado a lado, agendamentos que se sobrepõem no mesmo dia
// (mesma ideia do Google Calendar quando há dois horários conflitantes).
function calcularLayoutEventos(agendamentos) {
  if (agendamentos.length === 0) return [];

  // 1. Ordenar por horário de início
  const ordenados = [...agendamentos].sort((a, b) => new Date(a.data_hora) - new Date(b.data_hora));

  // 2. Agrupar em clusters de sobreposição contígua
  const clusters = [];
  let clusterAtual = [];
  let fimMaxCluster = 0;

  ordenados.forEach((ag) => {
    const inicio = new Date(ag.data_hora).getTime();
    const fim = inicio + ag.duracao_minutos * 60000;

    if (clusterAtual.length === 0) {
      clusterAtual.push(ag);
      fimMaxCluster = fim;
    } else if (inicio < fimMaxCluster) {
      // Sobrepõe com o cluster atual
      clusterAtual.push(ag);
      fimMaxCluster = Math.max(fimMaxCluster, fim);
    } else {
      // Não sobrepõe, fecha o cluster atual e cria outro
      clusters.push(clusterAtual);
      clusterAtual = [ag];
      fimMaxCluster = fim;
    }
  });
  if (clusterAtual.length > 0) {
    clusters.push(clusterAtual);
  }

  // 3. Para cada cluster, distribuir em colunas
  const resultado = [];
  clusters.forEach((cluster) => {
    const colunas = []; // Array de horários de fim dos eventos em cada coluna

    const posicionadosNoCluster = cluster.map((ag) => {
      const inicio = new Date(ag.data_hora).getTime();
      const fim = inicio + ag.duracao_minutos * 60000;

      // Achar a primeira coluna livre
      let colIdx = colunas.findIndex((fimCol) => fimCol <= inicio);
      if (colIdx === -1) {
        colIdx = colunas.length;
        colunas.push(fim);
      } else {
        colunas[colIdx] = fim;
      }

      return { ag, coluna: colIdx };
    });

    const totalColunas = colunas.length;
    posicionadosNoCluster.forEach((item) => {
      resultado.push({
        ag: item.ag,
        coluna: item.coluna,
        totalColunas: totalColunas
      });
    });
  });

  return resultado;
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
        ? `<span class="agendamento-comprovante" style="display:block; margin-bottom:10px;"><a href="/admin/api/agendamentos/${ag.id}/comprovante" target="_blank" rel="noopener">Ver comprovante</a></span>`
        : ""
    }
    ${
      ag.foto_referencia_url
        ? `<span class="agendamento-foto-referencia" style="display:block; margin-bottom:10px;">
             <a href="/admin/api/agendamentos/${ag.id}/referencia" target="_blank" rel="noopener">
               <img src="/admin/api/agendamentos/${ag.id}/referencia" alt="Foto de referência enviada pelo cliente" style="max-width:120px; max-height:120px; border-radius:8px; display:block; margin-bottom:4px;" />
               Ver foto de referência
             </a>
           </span>`
        : ""
    }
    <span class="status-badge status-${ag.status}">${rotulo}</span>
    <div class="agendamento-acoes" id="agendamentoPopoverAcoes" style="margin-top:14px; justify-content:flex-start;"></div>
  `;

  const acoes = el("agendamentoPopoverAcoes");
  const botao = (texto, novoStatus, classe = "", aoMudar) => {
    const b = document.createElement("button");
    b.className = `btn-mini ${classe}`;
    b.textContent = texto;
    b.addEventListener("click", async () => {
      await mudarStatusAgendamento(ag.id, novoStatus);
      if (aoMudar) aoMudar();
      fecharDetalheAgendamento();
    });
    return b;
  };

  const enviarConfirmacaoWhatsapp = () => {
    const telefoneLimpo = (ag.clientes?.telefone || "").replace(/\D/g, "");
    if (!telefoneLimpo) return;

    const hora = new Date(ag.data_hora).toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" });
    const dataFormatada = new Date(ag.data_hora).toLocaleDateString("pt-BR", { day: "2-digit", month: "2-digit" });

    const texto = `Olá, ${ag.clientes?.nome || ""}! Seu agendamento de ${ag.servicos?.nome || "serviço"} no dia ${dataFormatada} às ${hora} foi confirmado. Te esperamos! `;

    window.open(`https://wa.me/55${telefoneLimpo}?text=${encodeURIComponent(texto)}`, "_blank", "noopener");
  };

  if (["aguardando_pagamento", "aguardando_confirmacao", "confirmado"].includes(ag.status)) {
    const reagendar = document.createElement("button");
    reagendar.className = "btn-mini";
    reagendar.textContent = "Reagendar";
    reagendar.addEventListener("click", () => {
      fecharDetalheAgendamento();
      abrirReagendar(ag);
    });
    acoes.appendChild(reagendar);
  }

  if (ag.cliente_id) {
    const verCliente = document.createElement("button");
    verCliente.className = "btn-mini";
    verCliente.textContent = "Ver cliente";
    verCliente.addEventListener("click", () => {
      fecharDetalheAgendamento();
      irParaPerfilCliente(ag.cliente_id);
    });
    acoes.appendChild(verCliente);
  }

  if (ag.status === "aguardando_pagamento" || ag.status === "aguardando_confirmacao") {
    const textoConfirmacao = ag.status === "aguardando_pagamento"
      ? (ag.comprovante_url ? "Aprovar pagamento" : "Confirmar sem comprovante")
      : "Confirmar";
    acoes.appendChild(botao(textoConfirmacao, "confirmado", "btn-mini-primary", enviarConfirmacaoWhatsapp));
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
    carregarDashboard();
  } catch (err) {
    alert(err.message);
  }
}

// ============================================================
// CLIENTES / CRM
// ============================================================
let temporizadorBuscaClientes;
let clienteSelecionadaId = null;
let clientesAtuais = [];
let indiceCampanhaInativas = 0;

function preencherCamposAniversario() {
  const dia = el("clienteAniversarioDia");
  const mes = el("clienteAniversarioMes");
  if (!dia || dia.options.length > 1) return;
  for (let numero = 1; numero <= 31; numero += 1) {
    dia.add(new Option(String(numero).padStart(2, "0"), String(numero)));
  }
  ["Janeiro", "Fevereiro", "Março", "Abril", "Maio", "Junho", "Julho", "Agosto", "Setembro", "Outubro", "Novembro", "Dezembro"]
    .forEach((nome, indice) => mes.add(new Option(nome, String(indice + 1))));
}

function formatarDataCliente(data) {
  if (!data) return "Ainda não veio ao salão";
  return new Date(data).toLocaleDateString("pt-BR", {
    timeZone: "America/Sao_Paulo",
    day: "2-digit",
    month: "short",
    year: "numeric",
  });
}

function fecharFormCliente() {
  el("formCliente").hidden = true;
  el("formCliente").reset();
  el("clienteId").value = "";
  el("clienteFormErro").hidden = true;
  document.querySelector(".cliente-informacoes-internas")?.removeAttribute("open");
}

function abrirFormCliente(cliente = null) {
  el("formCliente").hidden = false;
  el("clienteFormErro").hidden = true;
  el("clienteId").value = cliente?.id || "";
  el("clienteNome").value = cliente?.nome || "";
  el("clienteTelefone").value = aplicarMascaraTelefone(cliente?.telefone || "");
  el("clienteAniversarioDia").value = cliente?.aniversario_dia || "";
  el("clienteAniversarioMes").value = cliente?.aniversario_mes || "";
  el("clienteTags").value = (cliente?.tags || []).join(", ");
  el("clientePreferencias").value = cliente?.preferencias || "";
  el("clienteObservacoes").value = cliente?.observacoes || "";
  el("clienteAlergias").value = cliente?.alergias || "";
  el("clienteConsentimentoAlergias").checked = cliente?.consentimento_alergias === true;
  const temDadosInternos = cliente && [cliente.aniversario_dia, cliente.aniversario_mes, cliente.tags?.length, cliente.preferencias, cliente.observacoes, cliente.alergias].some(Boolean);
  document.querySelector(".cliente-informacoes-internas")?.toggleAttribute("open", Boolean(temDadosInternos));
  el("btnSalvarCliente").textContent = cliente ? "Salvar alterações" : "Salvar cliente";
  el("clienteNome").focus();
}

async function carregarClientes() {
  const lista = el("clientesLista");
  const vazio = el("clientesVazio");
  lista.innerHTML = '<p class="menu-vazio">Carregando clientes...</p>';
  vazio.hidden = true;
  el("clienteDetalhe").hidden = true;

  try {
    const params = new URLSearchParams({
      busca: el("buscaClientes").value.trim(),
      filtro: el("filtroClientes").value,
    });
    const { clientes } = await chamarApi(`/admin/api/clientes?${params}`);
    clientesAtuais = clientes;
    lista.innerHTML = "";
    vazio.hidden = clientes.length > 0;

    clientes.forEach((cliente) => {
      const item = document.createElement("button");
      item.type = "button";
      item.className = "cliente-card" + (cliente.id === clienteSelecionadaId ? " cliente-card-selecionado" : "");
      item.setAttribute("aria-pressed", String(cliente.id === clienteSelecionadaId));
      item.innerHTML = `
        <span class="cliente-card-principal">
          <strong>${escaparHtml(cliente.nome)}</strong>
          <span>${escaparHtml(aplicarMascaraTelefone(cliente.telefone))}</span>
        </span>
        <span class="cliente-card-metricas">
          <span><strong>${cliente.atendimentos}</strong> atend.</span>
          <span><strong>${formatarMoeda(cliente.gasto_total)}</strong> gasto</span>
          <span>${cliente.inativa ? "Inativa" : cliente.proximo_agendamento ? "Retorno marcado" : `Última visita: ${formatarDataCliente(cliente.ultima_visita)}`}</span>
        </span>`;
      item.addEventListener("click", () => {
        clienteSelecionadaId = cliente.id;
        lista.querySelectorAll(".cliente-card").forEach((cartao) => {
          const selecionado = cartao === item;
          cartao.classList.toggle("cliente-card-selecionado", selecionado);
          cartao.setAttribute("aria-pressed", String(selecionado));
        });
        mostrarCliente(cliente.id);
      });
      lista.appendChild(item);
    });
  } catch (err) {
    lista.innerHTML = `<p class="erro-envio">${escaparHtml(err.message)}</p>`;
  }
}

async function mostrarCliente(id) {
  const detalhe = el("clienteDetalhe");
  detalhe.hidden = false;
  detalhe.innerHTML = '<p class="cliente-selecionada-rotulo">Cliente selecionada</p><p class="menu-vazio">Carregando perfil da cliente...</p>';
  try {
    const { cliente, agendamentos } = await chamarApi(`/admin/api/clientes/${id}`);
    const telefone = aplicarMascaraTelefone(cliente.telefone);
    const whatsapp = String(cliente.telefone || "").replace(/\D/g, "");
    detalhe.innerHTML = `
      <p class="cliente-selecionada-rotulo">Cliente selecionada</p>
      <div class="cliente-detalhe-cabecalho">
        <div><h3>${escaparHtml(cliente.nome)}</h3><p>${escaparHtml(telefone)}</p></div>
        <div class="cliente-detalhe-acoes">
          ${whatsapp ? `<a class="btn btn-outline" href="https://wa.me/55${whatsapp}" target="_blank" rel="noopener">WhatsApp</a>` : ""}
          <button type="button" class="btn btn-outline" id="btnEditarCliente">Editar</button>
        </div>
      </div>
      <div class="cliente-resumo">
        <div><span>Total gasto</span><strong>${formatarMoeda(cliente.gasto_total)}</strong></div>
        <div><span>Atendimentos</span><strong>${cliente.atendimentos}</strong></div>
        <div><span>Frequência (90 dias)</span><strong>${cliente.visitas_ultimos_90_dias}</strong></div>
        <div><span>Última visita</span><strong>${formatarDataCliente(cliente.ultima_visita)}</strong></div>
      </div>
      <details class="cliente-informacoes-internas cliente-informacoes-perfil">
        <summary>Informações internas${cliente.tags?.length ? ` · ${escaparHtml(cliente.tags.join(", "))}` : ""}</summary>
        <div class="cliente-interno-conteudo">
          <p><strong>Aniversário:</strong> ${cliente.aniversario_dia && cliente.aniversario_mes ? `${String(cliente.aniversario_dia).padStart(2, "0")}/${String(cliente.aniversario_mes).padStart(2, "0")}` : "Não informado"}</p>
          <p><strong>Tags:</strong> ${cliente.tags?.length ? escaparHtml(cliente.tags.join(", ")) : "Sem tags"}</p>
          <p><strong>Preferências:</strong> ${escaparHtml(cliente.preferencias || "Não informadas")}</p>
          <p><strong>Observações:</strong> ${escaparHtml(cliente.observacoes || "Nenhuma")}</p>
          <p><strong>Alergias/restrições:</strong> ${cliente.alergias && cliente.consentimento_alergias ? escaparHtml(cliente.alergias) : "Não informadas"}</p>
        </div>
      </details>
      <details class="cliente-mesclar">
        <summary>Mesclar cadastro duplicado</summary>
        <p>O histórico desta cliente será transferido para o cadastro escolhido. Esta ação não pode ser desfeita.</p>
        <div class="cliente-mesclar-acoes"><select id="clienteMesclarDestino" class="input"><option value="">Carregando clientes...</option></select><button type="button" class="btn btn-outline" id="btnMesclarCliente">Mesclar</button></div>
      </details>
      <h3 class="secao-titulo">Histórico</h3>
      <div class="cliente-historico">
        ${agendamentos.length ? agendamentos.map((agendamento) => `
          <div class="cliente-historico-item">
            <div><strong>${escaparHtml(agendamento.servicos?.nome || "Serviço")}</strong><span>${formatarDataCliente(agendamento.data_hora)} · ${escaparHtml(agendamento.profissionais?.nome || "Profissional")}</span></div>
            <div><strong>${formatarMoeda(agendamento.valor)}</strong><span class="status-agendamento status-${agendamento.status}">${escaparHtml(ROTULOS_STATUS[agendamento.status] || agendamento.status)}</span></div>
          </div>`).join("") : '<p class="menu-vazio">Esta cliente ainda não possui atendimentos.</p>'}
      </div>`;
    detalhe.scrollIntoView({ behavior: "smooth", block: "start" });
    el("btnEditarCliente")?.addEventListener("click", () => abrirFormCliente(cliente));
    preencherOpcoesMesclagem(cliente.id);
    el("btnMesclarCliente")?.addEventListener("click", () => mesclarCliente(cliente));
  } catch (err) {
    detalhe.innerHTML = `<p class="erro-envio">${escaparHtml(err.message)}</p>`;
  }
}

async function irParaPerfilCliente(id) {
  document.querySelectorAll(".nav-item").forEach((botao) => botao.classList.toggle("active", botao.dataset.aba === "clientes"));
  document.querySelectorAll(".aba").forEach((secao) => { secao.hidden = secao.dataset.abaConteudo !== "clientes"; });
  fecharMenuMobile();
  await carregarClientes();
  await mostrarCliente(id);
}

el("btnNovaCliente")?.addEventListener("click", () => abrirFormCliente());
preencherCamposAniversario();
el("btnCancelarCliente")?.addEventListener("click", fecharFormCliente);
el("btnExportarClientes")?.addEventListener("click", () => {
  window.location.assign("/admin/api/clientes/exportar");
});

el("campoCorDestaque").addEventListener("input", atualizarStatusContrasteCores);
el("campoCorFundo").addEventListener("input", atualizarStatusContrasteCores);

async function preencherOpcoesMesclagem(clienteId) {
  const seletor = el("clienteMesclarDestino");
  if (!seletor) return;
  try {
    const { clientes } = await chamarApi("/admin/api/clientes?filtro=todos");
    seletor.innerHTML = '<option value="">Escolha o cadastro que ficará</option>';
    clientes.filter((cliente) => cliente.id !== clienteId).forEach((cliente) => {
      seletor.add(new Option(`${cliente.nome} · ${aplicarMascaraTelefone(cliente.telefone)}`, cliente.id));
    });
  } catch {
    seletor.innerHTML = '<option value="">Não foi possível carregar clientes</option>';
  }
}

async function mesclarCliente(origem) {
  const destinoId = el("clienteMesclarDestino")?.value;
  if (!destinoId) return alert("Escolha o cadastro que deve permanecer.");
  if (!confirm(`Mesclar “${origem.nome}” no cadastro selecionado? O histórico será transferido e este cadastro será removido.`)) return;
  try {
    const { cliente_id: clienteDestinoId } = await chamarApi(`/admin/api/clientes/${origem.id}/mesclar`, {
      method: "POST",
      body: JSON.stringify({ destino_id: destinoId }),
    });
    clienteSelecionadaId = clienteDestinoId;
    await carregarClientes();
    await mostrarCliente(clienteDestinoId);
  } catch (err) {
    alert(err.message);
  }
}
el("clienteTelefone")?.addEventListener("input", (evento) => {
  evento.target.value = aplicarMascaraTelefone(evento.target.value);
});
el("buscaClientes")?.addEventListener("input", () => {
  clearTimeout(temporizadorBuscaClientes);
  temporizadorBuscaClientes = setTimeout(carregarClientes, 250);
});
el("filtroClientes")?.addEventListener("change", carregarClientes);
el("formCliente")?.addEventListener("submit", async (evento) => {
  evento.preventDefault();
  const botao = el("btnSalvarCliente");
  const id = el("clienteId").value;
  const erro = el("clienteFormErro");
  botao.disabled = true;
  erro.hidden = true;
  try {
    await chamarApi(id ? `/admin/api/clientes/${id}` : "/admin/api/clientes", {
      method: id ? "PUT" : "POST",
      body: JSON.stringify({
        nome: el("clienteNome").value,
        telefone: el("clienteTelefone").value,
        aniversario_dia: el("clienteAniversarioDia").value,
        aniversario_mes: el("clienteAniversarioMes").value,
        tags: el("clienteTags").value,
        preferencias: el("clientePreferencias").value,
        observacoes: el("clienteObservacoes").value,
        alergias: el("clienteAlergias").value,
        consentimento_alergias: el("clienteConsentimentoAlergias").checked,
      }),
    });
    fecharFormCliente();
    await carregarClientes();
  } catch (err) {
    erro.textContent = err.message;
    erro.hidden = false;
  } finally {
    botao.disabled = false;
  }
});

function atualizarCampanhaInativas() {
  const inativas = clientesAtuais.filter((cliente) => cliente.inativa);
  el("campanhaContagem").textContent = inativas.length
    ? `${inativas.length} cliente(s) inativa(s) na lista atual.`
    : "Nenhuma cliente inativa na lista atual.";
  el("btnAbrirProximaCampanha").disabled = !inativas.length;
}

el("btnCampanhaInativas")?.addEventListener("click", () => {
  indiceCampanhaInativas = 0;
  el("campanhaInativas").hidden = false;
  atualizarCampanhaInativas();
});
el("btnFecharCampanha")?.addEventListener("click", () => { el("campanhaInativas").hidden = true; });
el("btnAbrirProximaCampanha")?.addEventListener("click", () => {
  const inativas = clientesAtuais.filter((cliente) => cliente.inativa);
  const cliente = inativas[indiceCampanhaInativas];
  if (!cliente) return;
  const texto = el("mensagemCampanha").value.trim().replaceAll("{nome}", cliente.nome.split(" ")[0]);
  window.open(`https://wa.me/55${String(cliente.telefone).replace(/\D/g, "")}?text=${encodeURIComponent(texto)}`, "_blank", "noopener");
  indiceCampanhaInativas += 1;
  if (indiceCampanhaInativas >= inativas.length) el("btnAbrirProximaCampanha").disabled = true;
  el("campanhaContagem").textContent = `${Math.min(indiceCampanhaInativas, inativas.length)} de ${inativas.length} conversa(s) preparada(s).`;
});

// ============================================================
// NOVO AGENDAMENTO PELO PAINEL
// ============================================================
let dadosNovoAgendamento = { servicos: [], profissionais: [] };

function fecharNovoAgendamento() {
  el("novoAgendamentoOverlay").hidden = true;
  el("novoAgendamentoErro").hidden = true;
}

function preencherProfissionaisNovoAgendamento() {
  const selectServico = el("novoAgendamentoServico");
  const selectProfissional = el("novoAgendamentoProfissional");
  const servicoId = selectServico.value;
  const profissionais = dadosNovoAgendamento.profissionais.filter(
    (profissional) => profissional.ativo && profissional.servico_ids?.includes(servicoId),
  );

  selectProfissional.innerHTML = "";
  if (profissionais.length === 0) {
    const opcao = document.createElement("option");
    opcao.value = "";
    opcao.textContent = "Nenhuma profissional disponível";
    selectProfissional.appendChild(opcao);
    selectProfissional.disabled = true;
    return;
  }

  selectProfissional.disabled = false;
  profissionais.forEach((profissional) => {
    const opcao = document.createElement("option");
    opcao.value = profissional.id;
    opcao.textContent = profissional.nome;
    selectProfissional.appendChild(opcao);
  });
}

function dataHoraLocalParaInput(data) {
  const ajustar = new Date(data.getTime() - data.getTimezoneOffset() * 60 * 1000);
  return ajustar.toISOString().slice(0, 16);
}

async function abrirNovoAgendamento(dataHoraPreenchida = null) {
  const erro = el("novoAgendamentoErro");
  erro.hidden = true;
  el("novoAgendamentoOverlay").hidden = false;

  try {
    const [{ servicos }, { profissionais }] = await Promise.all([
      chamarApi("/admin/api/servicos"),
      chamarApi("/admin/api/profissionais"),
    ]);
    dadosNovoAgendamento = {
      servicos: (servicos || []).filter((servico) => servico.ativo),
      profissionais: profissionais || [],
    };

    const selectServico = el("novoAgendamentoServico");
    selectServico.innerHTML = "";
    dadosNovoAgendamento.servicos.forEach((servico) => {
      const opcao = document.createElement("option");
      opcao.value = servico.id;
      opcao.textContent = `${servico.nome} — ${formatarMoeda(servico.preco)}`;
      selectServico.appendChild(opcao);
    });

    if (dadosNovoAgendamento.servicos.length === 0) {
      erro.textContent = "Cadastre um serviço ativo antes de criar um agendamento.";
      erro.hidden = false;
      el("btnSalvarNovoAgendamento").disabled = true;
      return;
    }

    el("btnSalvarNovoAgendamento").disabled = false;
    preencherProfissionaisNovoAgendamento();

    const agora = dataHoraPreenchida ? new Date(dataHoraPreenchida) : new Date();
    if (!dataHoraPreenchida) {
      agora.setMinutes(Math.ceil(agora.getMinutes() / 15) * 15, 0, 0);
    }
    el("novoAgendamentoDataHora").min = dataHoraLocalParaInput(new Date());
    el("novoAgendamentoDataHora").value = dataHoraLocalParaInput(agora);
  } catch (err) {
    erro.textContent = err.message || "Não foi possível carregar os dados da agenda.";
    erro.hidden = false;
    el("btnSalvarNovoAgendamento").disabled = true;
  }
}

el("btnNovoAgendamento").addEventListener("click", () => abrirNovoAgendamento());
el("btnFecharNovoAgendamento").addEventListener("click", fecharNovoAgendamento);
el("btnCancelarNovoAgendamento").addEventListener("click", fecharNovoAgendamento);
el("novoAgendamentoOverlay").addEventListener("click", (evento) => {
  if (evento.target === el("novoAgendamentoOverlay")) fecharNovoAgendamento();
});
el("novoAgendamentoServico").addEventListener("change", preencherProfissionaisNovoAgendamento);
el("novoAgendamentoTelefone").addEventListener("input", (evento) => {
  evento.target.value = aplicarMascaraTelefone(evento.target.value);
});
el("formNovoAgendamento").addEventListener("submit", async (evento) => {
  evento.preventDefault();
  const erro = el("novoAgendamentoErro");
  const botao = el("btnSalvarNovoAgendamento");
  const dataHoraLocal = el("novoAgendamentoDataHora").value;
  erro.hidden = true;

  if (!dataHoraLocal || !el("novoAgendamentoProfissional").value) {
    erro.textContent = "Escolha serviço, profissional, data e horário.";
    erro.hidden = false;
    return;
  }

  botao.disabled = true;
  botao.textContent = "Salvando...";
  try {
    await chamarApi("/admin/api/agendamentos", {
      method: "POST",
      body: JSON.stringify({
        nome: el("novoAgendamentoNome").value,
        telefone: el("novoAgendamentoTelefone").value,
        servico_id: el("novoAgendamentoServico").value,
        profissional_id: el("novoAgendamentoProfissional").value,
        data_hora: new Date(dataHoraLocal).toISOString(),
        status: el("novoAgendamentoStatus").value,
      }),
    });

    semanaReferencia = new Date(dataHoraLocal);
    diaSelecionadoIndice = null;
    el("formNovoAgendamento").reset();
    fecharNovoAgendamento();
    carregarAgendamentos();
    carregarDashboard();
  } catch (err) {
    erro.textContent = err.message || "Não foi possível salvar o agendamento.";
    erro.hidden = false;
  } finally {
    botao.disabled = false;
    botao.textContent = "Salvar agendamento";
  }
});

// ============================================================
// REAGENDAMENTO E BLOQUEIOS
// ============================================================
let agendamentoReagendando = null;
let dadosAgendaFormulario = { servicos: [], profissionais: [] };

async function carregarDadosAgendaFormulario() {
  const [{ servicos }, { profissionais }] = await Promise.all([
    chamarApi("/admin/api/servicos"),
    chamarApi("/admin/api/profissionais"),
  ]);
  dadosAgendaFormulario = {
    servicos: (servicos || []).filter((servico) => servico.ativo),
    profissionais: (profissionais || []).filter((profissional) => profissional.ativo),
  };
}

function preencherSelectServicos(selectId, selecionadoId) {
  const select = el(selectId);
  select.innerHTML = "";
  dadosAgendaFormulario.servicos.forEach((servico) => {
    const opcao = document.createElement("option");
    opcao.value = servico.id;
    opcao.textContent = `${servico.nome} — ${formatarMoeda(servico.preco)}`;
    opcao.selected = servico.id === selecionadoId;
    select.appendChild(opcao);
  });
}

function preencherSelectProfissionais(selectId, servicoId, selecionadoId) {
  const select = el(selectId);
  const profissionais = dadosAgendaFormulario.profissionais.filter(
    (profissional) => profissional.servico_ids?.includes(servicoId),
  );
  select.innerHTML = "";
  profissionais.forEach((profissional) => {
    const opcao = document.createElement("option");
    opcao.value = profissional.id;
    opcao.textContent = profissional.nome;
    opcao.selected = profissional.id === selecionadoId;
    select.appendChild(opcao);
  });
  select.disabled = profissionais.length === 0;
}

function fecharReagendar() {
  el("reagendarOverlay").hidden = true;
  el("reagendarErro").hidden = true;
  agendamentoReagendando = null;
}

async function abrirReagendar(agendamento) {
  agendamentoReagendando = agendamento;
  el("reagendarOverlay").hidden = false;
  el("reagendarErro").hidden = true;
  el("reagendarCliente").textContent = `Reagendando ${agendamento.clientes?.nome || "cliente"}.`;

  try {
    await carregarDadosAgendaFormulario();
    preencherSelectServicos("reagendarServico", agendamento.servico_id);
    preencherSelectProfissionais(
      "reagendarProfissional",
      el("reagendarServico").value,
      agendamento.profissional_id,
    );
    el("reagendarDataHora").value = dataHoraLocalParaInput(new Date(agendamento.data_hora));
  } catch (err) {
    el("reagendarErro").textContent = err.message || "Não foi possível carregar os dados.";
    el("reagendarErro").hidden = false;
  }
}

el("reagendarServico").addEventListener("change", () => {
  preencherSelectProfissionais("reagendarProfissional", el("reagendarServico").value);
});
el("btnFecharReagendar").addEventListener("click", fecharReagendar);
el("btnCancelarReagendar").addEventListener("click", fecharReagendar);
el("reagendarOverlay").addEventListener("click", (evento) => {
  if (evento.target === el("reagendarOverlay")) fecharReagendar();
});
el("formReagendar").addEventListener("submit", async (evento) => {
  evento.preventDefault();
  if (!agendamentoReagendando) return;

  const erro = el("reagendarErro");
  const botao = el("btnSalvarReagendar");
  erro.hidden = true;
  botao.disabled = true;
  botao.textContent = "Salvando...";

  try {
    const dataHora = new Date(el("reagendarDataHora").value);
    await chamarApi(`/admin/api/agendamentos/${agendamentoReagendando.id}/reagendar`, {
      method: "PUT",
      body: JSON.stringify({
        servico_id: el("reagendarServico").value,
        profissional_id: el("reagendarProfissional").value,
        data_hora: dataHora.toISOString(),
      }),
    });
    semanaReferencia = dataHora;
    diaSelecionadoIndice = null;
    fecharReagendar();
    carregarAgendamentos();
    carregarDashboard();
  } catch (err) {
    erro.textContent = err.message || "Não foi possível reagendar.";
    erro.hidden = false;
  } finally {
    botao.disabled = false;
    botao.textContent = "Salvar alteração";
  }
});

function fecharBloqueio() {
  el("bloqueioOverlay").hidden = true;
  el("bloqueioErro").hidden = true;
}

async function abrirBloqueio() {
  el("bloqueioOverlay").hidden = false;
  el("bloqueioErro").hidden = true;
  try {
    await carregarDadosAgendaFormulario();
    const select = el("bloqueioProfissional");
    select.innerHTML = '<option value="">Todo o salão</option>';
    dadosAgendaFormulario.profissionais.forEach((profissional) => {
      const opcao = document.createElement("option");
      opcao.value = profissional.id;
      opcao.textContent = profissional.nome;
      select.appendChild(opcao);
    });

    const inicio = new Date();
    inicio.setMinutes(Math.ceil(inicio.getMinutes() / 15) * 15, 0, 0);
    const fim = new Date(inicio.getTime() + 60 * 60 * 1000);
    el("bloqueioInicio").value = dataHoraLocalParaInput(inicio);
    el("bloqueioFim").value = dataHoraLocalParaInput(fim);
  } catch (err) {
    el("bloqueioErro").textContent = err.message || "Não foi possível carregar profissionais.";
    el("bloqueioErro").hidden = false;
  }
}

el("btnNovoBloqueio").addEventListener("click", abrirBloqueio);
el("btnFecharBloqueio").addEventListener("click", fecharBloqueio);
el("btnCancelarBloqueio").addEventListener("click", fecharBloqueio);
el("bloqueioOverlay").addEventListener("click", (evento) => {
  if (evento.target === el("bloqueioOverlay")) fecharBloqueio();
});
el("formBloqueio").addEventListener("submit", async (evento) => {
  evento.preventDefault();
  const erro = el("bloqueioErro");
  const botao = el("btnSalvarBloqueio");
  erro.hidden = true;
  botao.disabled = true;
  botao.textContent = "Salvando...";

  try {
    await chamarApi("/admin/api/agendamentos/bloqueios", {
      method: "POST",
      body: JSON.stringify({
        profissional_id: el("bloqueioProfissional").value || null,
        inicio: new Date(el("bloqueioInicio").value).toISOString(),
        fim: new Date(el("bloqueioFim").value).toISOString(),
        motivo: el("bloqueioMotivo").value,
      }),
    });
    fecharBloqueio();
    carregarAgendamentos();
  } catch (err) {
    erro.textContent = err.message || "Não foi possível salvar o bloqueio.";
    erro.hidden = false;
  } finally {
    botao.disabled = false;
    botao.textContent = "Salvar bloqueio";
  }
});

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
            <span>${s.duracao_minutos} min · ${formatarMoeda(s.preco)}${
              s.cobra_sinal === false
                ? " · sem sinal"
                : s.tipo_cobranca_sinal === "percentual"
                  ? ` · sinal ${Number(s.percentual_sinal || 0)}%`
                  : ` · sinal ${formatarMoeda(s.valor_sinal_fixo || 0)}`
            }</span>
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
  el("painelFormServico").open = true;
  el("tituloFormServico").textContent = "Editar serviço";
  el("servicoEditandoId").value = s.id;
  el("servicoNome").value = s.nome;
  el("servicoDuracao").value = s.duracao_minutos;
  el("servicoPreco").value = s.preco;

  el("servicoCobraSinal").checked = s.cobra_sinal !== false;
  const tipoAtual = s.tipo_cobranca_sinal || "fixo";
  const radioTipo = document.querySelector(
    `input[name="servicoTipoCobranca"][value="${tipoAtual}"]`
  );
  if (radioTipo) radioTipo.checked = true;
  el("servicoValorSinalFixo").value = s.valor_sinal_fixo ?? "";
  el("servicoPercentualSinal").value = s.percentual_sinal ?? "";
  atualizarVisibilidadeSinal();

  el("btnSalvarServico").textContent = "Salvar edição";
  el("btnCancelarEdicaoServico").hidden = false;
}

function cancelarEdicaoServico() {
  el("servicoEditandoId").value = "";
  el("formServico").reset();
  atualizarVisibilidadeSinal();
  el("tituloFormServico").textContent = "Adicionar serviço";
  el("btnSalvarServico").textContent = "Adicionar serviço";
  el("btnCancelarEdicaoServico").hidden = true;
}
el("btnCancelarEdicaoServico").addEventListener("click", cancelarEdicaoServico);

// ---- SINAL: mostra/esconde os campos conforme "cobra sinal?" e o tipo escolhido ----
function atualizarVisibilidadeSinal() {
  const cobra = el("servicoCobraSinal").checked;
  el("blocoConfigSinal").hidden = !cobra;

  const tipo =
    document.querySelector('input[name="servicoTipoCobranca"]:checked')?.value ||
    "fixo";
  el("blocoValorFixo").hidden = !cobra || tipo !== "fixo";
  el("blocoPercentual").hidden = !cobra || tipo !== "percentual";
}

el("servicoCobraSinal").addEventListener("change", atualizarVisibilidadeSinal);
document
  .querySelectorAll('input[name="servicoTipoCobranca"]')
  .forEach((radio) => radio.addEventListener("change", atualizarVisibilidadeSinal));

atualizarVisibilidadeSinal();

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

  const cobraSinal = el("servicoCobraSinal").checked;
  const tipoCobranca =
    document.querySelector('input[name="servicoTipoCobranca"]:checked')?.value ||
    "fixo";

  if (cobraSinal && tipoCobranca === "fixo" && !el("servicoValorSinalFixo").value) {
    el("servicoErro").textContent = "Informe o valor fixo do sinal.";
    el("servicoErro").hidden = false;
    btn.disabled = false;
    return;
  }
  if (cobraSinal && tipoCobranca === "percentual" && !el("servicoPercentualSinal").value) {
    el("servicoErro").textContent = "Informe o percentual do sinal.";
    el("servicoErro").hidden = false;
    btn.disabled = false;
    return;
  }

  const corpo = {
    nome: el("servicoNome").value.trim(),
    duracao_minutos: Number(el("servicoDuracao").value),
    preco: Number(el("servicoPreco").value),
    cobra_sinal: cobraSinal,
    tipo_cobranca_sinal: cobraSinal ? tipoCobranca : null,
    valor_sinal_fixo:
      cobraSinal && tipoCobranca === "fixo"
        ? Number(el("servicoValorSinalFixo").value)
        : null,
    percentual_sinal:
      cobraSinal && tipoCobranca === "percentual"
        ? Number(el("servicoPercentualSinal").value)
        : null,
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
            <button class="btn-mini" data-acao="agenda">Agenda</button>
            <button class="btn-mini" data-acao="editar">Editar</button>
            <button class="btn-mini" data-acao="toggle">${p.ativo ? "Desativar" : "Ativar"}</button>
            <button class="btn-mini btn-mini-perigo" data-acao="excluir">Excluir</button>
          </div>
        `;
        item.querySelector('[data-acao="agenda"]').addEventListener("click", () => abrirAgendaProfissional(p));
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
  el("painelFormProfissional").open = true;
  el("tituloFormProfissional").textContent = "Editar profissional";
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
  el("tituloFormProfissional").textContent = "Adicionar profissional";
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

el("horarioModoAgenda").addEventListener("change", async () => {
  const profissional = pegarProfissionalAtual();
  if (!profissional) return;
  try {
    await chamarApi(`/admin/api/profissionais/${profissional.id}`, { method: "PUT", body: JSON.stringify({ modo_agenda: el("horarioModoAgenda").value }) });
    profissional.modo_agenda = el("horarioModoAgenda").value;
    montarGradeHorarios(profissional);
  } catch (err) { alert(err.message); }
});

function montarGradeHorarios(profissional) {
  el("horarioModoAgenda").value = profissional.modo_agenda || "semanal";
  const flexivel = profissional.modo_agenda === "flexivel";
  el("gradeHorarios").hidden = flexivel;
  el("agendaFlexivel").hidden = !flexivel;
  el("horariosDescricao").textContent = flexivel
    ? "Publique horários em datas reais. A página pública mostra somente os próximos 7 dias."
    : "Defina os períodos de trabalho. Os horários de agendamento são calculados automaticamente conforme cada serviço.";
  if (flexivel) return montarAgendaFlexivel(profissional);
  const grade = el("gradeHorarios");
  grade.innerHTML = "";

  const horarios = obterHorariosSemanais(profissional);

  const formulario = document.createElement("div");
  formulario.className = "periodo-trabalho-form";
  formulario.innerHTML = `
    <strong>Adicionar período de trabalho</strong>
    <p>Ex.: de segunda a sexta, das 09:00 às 18:00.</p>
    <p class="periodo-trabalho-aviso"><strong>Tem pausa para almoço?</strong> Divida o dia em dois períodos: por exemplo, 09:00 às 12:00 e depois 13:00 às 18:00. Assim nenhum horário será oferecido durante a pausa.</p>
    <div class="periodo-trabalho-campos">
      <label>Do dia<select class="input" data-campo="inicio-dia">${DIAS_ABREV.map((dia, indice) => `<option value="${indice}">${dia}</option>`).join("")}</select></label>
      <label>Até o dia<select class="input" data-campo="fim-dia">${DIAS_ABREV.map((dia, indice) => `<option value="${indice}" ${indice === 5 ? "selected" : ""}>${dia}</option>`).join("")}</select></label>
      <label>Início<input class="input" type="time" data-campo="inicio" value="09:00" /></label>
      <label>Fim<input class="input" type="time" data-campo="fim" value="18:00" /></label>
      <button type="button" class="btn btn-outline" data-acao="adicionar-periodo">+ Adicionar período</button>
    </div>
  `;
  formulario.querySelector('[data-acao="adicionar-periodo"]').addEventListener("click", () => {
    const inicioDia = Number(formulario.querySelector('[data-campo="inicio-dia"]').value);
    const fimDia = Number(formulario.querySelector('[data-campo="fim-dia"]').value);
    const inicio = formulario.querySelector('[data-campo="inicio"]').value;
    const fim = formulario.querySelector('[data-campo="fim"]').value;
    if (!inicio || !fim || inicio >= fim) return alert("Informe um início anterior ao fim do expediente.");
    if (fimDia < inicioDia) return alert("Escolha um intervalo de dias em ordem, por exemplo segunda até sexta.");
    for (let dia = inicioDia; dia <= fimDia; dia++) adicionarPeriodoTrabalho(profissional, dia, { inicio, fim }, false);
    salvarHorariosProfissional(profissional).then(() => montarGradeHorarios(profissional));
  });
  grade.appendChild(formulario);

  const titulo = document.createElement("h3");
  titulo.className = "periodo-trabalho-titulo";
  titulo.textContent = "Como ficou a semana";
  grade.appendChild(titulo);
  for (let d = 0; d <= 6; d++) {
    const linha = document.createElement("div");
    linha.className = "linha-grade-dia";
    linha.innerHTML = `<div class="linha-grade-dia-topo"><span class="linha-grade-dia-nome">${DIAS_ABREV[d]}</span></div><div class="chips-horarios"></div>`;
    renderizarPeriodosTrabalho(linha, horarios[d] ?? horarios[String(d)] ?? [], profissional.id, d);
    grade.appendChild(linha);
  }
}

async function abrirAgendaProfissional(profissional) {
  try {
    const { profissionais } = await chamarApi("/admin/api/profissionais");
    profissionaisParaHorarios = profissionais || [];
    const profissionalAtual = profissionaisParaHorarios.find((item) => item.id === profissional.id);
    if (!profissionalAtual) throw new Error("Profissional não encontrada.");

    const seletor = el("horarioProfissionalSelect");
    seletor.innerHTML = `<option value="${profissionalAtual.id}">${escaparHtml(profissionalAtual.nome)}</option>`;
    seletor.value = profissionalAtual.id;
    el("tituloAgendaProfissional").textContent = profissionalAtual.nome;
    el("painelAgendaProfissional").hidden = false;
    montarGradeHorarios(profissionalAtual);
    el("painelAgendaProfissional").scrollIntoView({ behavior: "smooth", block: "start" });
  } catch (err) {
    alert(err.message);
  }
}

el("btnFecharAgendaProfissional").addEventListener("click", () => {
  el("painelAgendaProfissional").hidden = true;
  el("gradeHorarios").innerHTML = "";
  el("agendaFlexivelSemana").innerHTML = "";
});

async function montarAgendaFlexivel(profissional) {
  if (!profissional) return;
  const hoje = new Date();
  hoje.setHours(12, 0, 0, 0);
  const datas = Array.from({ length: 7 }, (_, indice) => {
    const data = new Date(hoje);
    data.setDate(data.getDate() + indice);
    return data.toISOString().slice(0, 10);
  });
  try {
    const { disponibilidades } = await chamarApi(`/admin/api/profissionais/${profissional.id}/disponibilidades?inicio=${datas[0]}&fim=${datas.at(-1)}`);
    profissional.horarios_flexiveis = datas.reduce((agenda, data) => ({ ...agenda, [data]: [] }), { ...(profissional.horarios_flexiveis || {}) });
    (disponibilidades || []).forEach((item) => { profissional.horarios_flexiveis[item.data] = [...(profissional.horarios_flexiveis[item.data] || []), String(item.hora).slice(0, 5)]; });
  } catch (err) { alert(err.message); return; }
  const container = el("agendaFlexivelSemana");
  container.innerHTML = "";
  datas.forEach((data) => {
    const dataLocal = new Date(`${data}T12:00:00`);
    const lista = profissional.horarios_flexiveis?.[data] || [];
    const linha = document.createElement("div");
    linha.className = "linha-grade-dia";
    linha.innerHTML = `<div class="linha-grade-dia-topo"><span class="linha-grade-dia-nome">${dataLocal.toLocaleDateString("pt-BR", { weekday: "long" })}</span><small>${dataLocal.toLocaleDateString("pt-BR", { day: "2-digit", month: "long" })}</small><div class="linha-grade-dia-add"><input type="time" class="input" /><button type="button">+ Adicionar</button></div></div><div class="chips-horarios"></div>`;
    renderizarChipsHorario(linha, lista, profissional, data);
    linha.querySelector("button").addEventListener("click", () => {
      const input = linha.querySelector('input[type="time"]');
      if (!input.value) return;
      salvarHorariosFlexiveis(profissional, data, [...new Set([...lista, input.value])].sort());
    });
    container.appendChild(linha);
  });
}

async function salvarHorariosFlexiveis(profissional, data, horarios) {
  try {
    await chamarApi(`/admin/api/profissionais/${profissional.id}/disponibilidades`, {
      method: "PUT", body: JSON.stringify({ inicio: data, fim: data, dias: [{ data, horarios }] }),
    });
    profissional.horarios_flexiveis = { ...(profissional.horarios_flexiveis || {}), [data]: horarios };
    montarAgendaFlexivel(profissional);
  } catch (err) { alert(err.message); }
}

function renderizarChipsHorario(linha, lista, profissional, data) {
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
      salvarHorariosFlexiveis(profissional, data, lista.filter((item) => item !== hora));
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

function adicionarPeriodoTrabalho(profissional, dia, periodo, atualizar = true) {
  const horarios = obterHorariosSemanais(profissional);
  const listaAtual = horarios[dia] ?? horarios[String(dia)] ?? [];
  const existe = listaAtual.some((item) => typeof item === "object" && item.inicio === periodo.inicio && item.fim === periodo.fim);
  if (!existe) {
    horarios[dia] = [...listaAtual, periodo].sort((a, b) => String(a.inicio || a).localeCompare(String(b.inicio || b)));
    profissional.horarios_disponiveis = horarios;
    if (atualizar) salvarHorariosProfissional(profissional);
  }
}

function renderizarPeriodosTrabalho(linha, lista, profissionalId, dia) {
  const container = linha.querySelector(".chips-horarios");
  container.innerHTML = "";
  if (!lista.length) {
    container.innerHTML = '<span class="chips-horarios-vazio">Não atende nesse dia</span>';
    return;
  }
  lista.forEach((periodo, indice) => {
    const texto = typeof periodo === "string" ? `${periodo} (horário antigo)` : `${periodo.inicio} às ${periodo.fim}`;
    const chip = document.createElement("span");
    chip.className = "chip-horario";
    chip.innerHTML = `${texto} <button type="button" aria-label="Remover período">×</button>`;
    chip.querySelector("button").addEventListener("click", () => removerPeriodoTrabalho(profissionalId, dia, indice));
    container.appendChild(chip);
  });
}

function removerPeriodoTrabalho(profissionalId, dia, indice) {
  const profissional = pegarProfissionalAtual();
  if (!profissional || profissional.id !== profissionalId) return;
  const horarios = obterHorariosSemanais(profissional);
  const listaAtual = horarios[dia] ?? horarios[String(dia)] ?? [];
  horarios[dia] = listaAtual.filter((_, itemIndice) => itemIndice !== indice);
  profissional.horarios_disponiveis = horarios;
  salvarHorariosProfissional(profissional).then(() => montarGradeHorarios(profissional));
}

function obterHorariosSemanais(profissional) {
  const valor = profissional?.horarios_disponiveis;
  if (valor && typeof valor === "object") return valor;
  if (typeof valor === "string") {
    try { return JSON.parse(valor) || {}; } catch { return {}; }
  }
  return {};
}

// ============================================================
// INIT
// ============================================================
verificarSessao();

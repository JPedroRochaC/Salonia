const el = (id) => document.getElementById(id);
let dadosIara = null;
let conversaSelecionadaId = null;

function escaparHtml(valor) {
  return String(valor || "").replace(/[&<>"']/g, (caractere) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[caractere]);
}

async function chamarApi(caminho, opcoes = {}) {
  const resposta = await fetch(caminho, { credentials: "include", headers: { "Content-Type": "application/json" }, ...opcoes });
  const dados = await resposta.json().catch(() => ({}));
  if (!resposta.ok) throw new Error(dados.erro || "Não foi possível concluir esta ação.");
  return dados;
}

function abrirAba(nome) {
  document.querySelectorAll("[data-iara-subaba]").forEach((botao) => botao.classList.toggle("active", botao.dataset.iaraSubaba === nome));
  document.querySelectorAll("[data-iara-pagina]").forEach((pagina) => { pagina.hidden = pagina.dataset.iaraPagina !== nome; });
  fecharMenuMobile();
  if (nome === "conversas") carregarConversasIara();
  document.querySelector(".iara-conteudo")?.scrollIntoView({ behavior: "smooth", block: "start" });
}

function menuMobileAberto() {
  return el("iaraMenuLateral").classList.contains("aberto");
}

function abrirMenuMobile() {
  el("iaraMenuLateral").classList.add("aberto");
  el("iaraMenuOverlay").hidden = false;
  el("btnIaraMenuToggle").setAttribute("aria-expanded", "true");
}

function fecharMenuMobile() {
  el("iaraMenuLateral").classList.remove("aberto");
  el("iaraMenuOverlay").hidden = true;
  el("btnIaraMenuToggle").setAttribute("aria-expanded", "false");
}

el("btnIaraMenuToggle").addEventListener("click", () => {
  menuMobileAberto() ? fecharMenuMobile() : abrirMenuMobile();
});
el("btnIaraAbrirDrawer").addEventListener("click", abrirMenuMobile);
el("iaraMenuOverlay").addEventListener("click", fecharMenuMobile);

function rotuloCategoria(categoria) {
  return ({ familiar: "Familiar", amigo: "Amigo", funcionario: "Funcionário", fornecedor: "Fornecedor", pessoal: "Contato pessoal", manual: "Manual" })[categoria] || "Manual";
}

async function carregarIdentidadeSalao() {
  try {
    const { salao } = await chamarApi("/admin/api/salao");
    el("iaraSalaoNome").textContent = salao?.nome || "Meu salão";
    el("iaraMobileSalaoNome").textContent = salao?.nome || "Meu salão";
    if (salao?.logo_url) {
      el("iaraSalaoLogo").src = salao.logo_url;
      el("iaraSalaoLogo").alt = `Logo do ${salao.nome || "salão"}`;
      el("iaraSalaoLogo").hidden = false;
    }
  } catch (erro) {
    console.warn("Não foi possível carregar a identidade do salão na IAra.", erro);
  }
}

function renderizarContatos(contatos) {
  const lista = el("iaraContatosLista");
  lista.innerHTML = "";
  el("iaraContatosVazio").hidden = Boolean(contatos?.length);
  (contatos || []).forEach((contato) => {
    const item = document.createElement("div");
    item.className = "iara-lista-item";
    item.innerHTML = `<div><strong>${escaparHtml(contato.nome || contato.telefone)}</strong><span>${escaparHtml(contato.telefone)} · ${rotuloCategoria(contato.categoria)}</span></div><button type="button" class="iara-remover">Remover</button>`;
    item.querySelector("button").addEventListener("click", async () => {
      await chamarApi(`/admin/api/iara/contatos-ignorados/${contato.id}`, { method: "DELETE" });
      carregarIara();
    });
    lista.appendChild(item);
  });
}

function renderizarConhecimento(automatico, manual) {
  const listaAuto = el("iaraConhecimentoAutomatico");
  listaAuto.innerHTML = "";
  (automatico || []).forEach((item) => {
    const card = document.createElement("article");
    card.className = `iara-conhecimento-item${item.ativo ? "" : " oculto"}`;
    card.innerHTML = `<div><strong>${escaparHtml(item.titulo)}</strong><span>${item.ativo ? (item.personalizado ? "Personalizado" : "Sincronizado do painel") : "Oculto da Iara"}</span><p>${escaparHtml(item.conteudo)}</p></div><div class="iara-conhecimento-acoes"><button type="button" class="iara-btn-acao iara-btn-editar">Editar</button><button type="button" class="iara-btn-acao ${item.ativo ? "iara-btn-excluir" : "iara-btn-restaurar"}">${item.ativo ? "Ocultar" : "Restaurar"}</button></div>`;
    const [editar, alternar] = card.querySelectorAll("button");
    editar.addEventListener("click", () => {
      const texto = document.createElement("textarea");
      texto.className = "iara-editor-inline";
      texto.rows = 4;
      texto.value = item.conteudo;
      const acoes = card.querySelector(".iara-conhecimento-acoes");
      acoes.innerHTML = "";
      const salvar = document.createElement("button");
      salvar.type = "button"; salvar.className = "btn btn-primary"; salvar.textContent = "Salvar";
      salvar.addEventListener("click", async () => { await chamarApi(`/admin/api/iara/conhecimento/automatico/${encodeURIComponent(item.chave)}`, { method: "PUT", body: JSON.stringify({ conteudo: texto.value, ativo: true }) }); carregarIara(); });
      acoes.append(salvar);
      card.querySelector("p").replaceWith(texto);
    });
    alternar.addEventListener("click", async () => {
      if (item.ativo) await chamarApi(`/admin/api/iara/conhecimento/automatico/${encodeURIComponent(item.chave)}`, { method: "PUT", body: JSON.stringify({ conteudo: item.conteudo, ativo: false }) });
      else await chamarApi(`/admin/api/iara/conhecimento/automatico/${encodeURIComponent(item.chave)}`, { method: "DELETE" });
      carregarIara();
    });
    listaAuto.appendChild(card);
  });

  const listaManual = el("iaraConhecimentoLista");
  listaManual.innerHTML = "";
  (manual || []).forEach((item) => {
    const card = document.createElement("div");
    card.className = "iara-lista-item";
    card.innerHTML = `<div><strong>${escaparHtml(item.titulo)}</strong><span>${escaparHtml(item.categoria)} · ${escaparHtml(item.conteudo)}</span></div><div class="iara-conhecimento-acoes"><button type="button" class="iara-btn-acao iara-btn-editar">Editar</button><button type="button" class="iara-btn-acao iara-btn-excluir">Excluir</button></div>`;
    const [editar, excluir] = card.querySelectorAll("button");
    editar.addEventListener("click", async () => {
      const titulo = window.prompt("Título da informação", item.titulo);
      if (titulo === null) return;
      const conteudo = window.prompt("Informação que a Iara deve saber", item.conteudo);
      if (conteudo === null) return;
      await chamarApi(`/admin/api/iara/conhecimento/${item.id}`, { method: "PUT", body: JSON.stringify({ titulo, conteudo }) });
      carregarIara();
    });
    excluir.addEventListener("click", async () => { if (window.confirm(`Excluir “${item.titulo}”?`)) { await chamarApi(`/admin/api/iara/conhecimento/${item.id}`, { method: "DELETE" }); carregarIara(); } });
    listaManual.appendChild(card);
  });
}

function formatarDataConversa(data) {
  if (!data) return "";
  return new Date(data).toLocaleString("pt-BR", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" });
}

function renderizarConversas(dados) {
  const lista = el("iaraConversasLista");
  const conversas = dados.conversas || [];
  conversaSelecionadaId = dados.conversa_id || null;
  lista.innerHTML = "";
  el("iaraConversasVazio").hidden = Boolean(conversas.length);
  conversas.forEach((conversa) => {
    const item = document.createElement("button");
    item.type = "button";
    item.className = `iara-conversa-item${conversa.id === conversaSelecionadaId ? " active" : ""}`;
    const nome = conversa.nome_contato || conversa.telefone;
    item.innerHTML = `<span class="iara-avatar">${escaparHtml(nome.charAt(0).toUpperCase())}</span><span class="iara-conversa-dados"><strong>${escaparHtml(nome)}</strong><small>${escaparHtml(conversa.status === "humano" ? "Atendimento humano" : conversa.status === "pausada" ? "Pausada" : "Iara atendendo")} · ${escaparHtml(formatarDataConversa(conversa.ultima_mensagem_em))}</small></span>`;
    item.addEventListener("click", () => carregarConversasIara(conversa.id));
    lista.appendChild(item);
  });

  const conversa = conversas.find((item) => item.id === conversaSelecionadaId);
  el("iaraChatVazio").hidden = Boolean(conversa);
  el("iaraChatConteudo").hidden = !conversa;
  if (!conversa) return;
  el("iaraChatNome").textContent = conversa.nome_contato || conversa.telefone;
  el("iaraChatTelefone").textContent = conversa.telefone;
  el("btnIaraStatusConversa").textContent = conversa.status === "humano" ? "Retornar para Iara" : "Pausar Iara";
  el("btnIaraStatusConversa").dataset.status = conversa.status;
  const mensagens = el("iaraChatMensagens");
  mensagens.innerHTML = "";
  (dados.mensagens || []).forEach((mensagem) => {
    const bolha = document.createElement("div");
    bolha.className = `iara-bolha ${mensagem.direcao === "saida" ? "saida" : "entrada"}`;
    bolha.innerHTML = `<p>${escaparHtml(mensagem.conteudo)}</p><small>${escaparHtml(formatarDataConversa(mensagem.criado_em))}</small>`;
    mensagens.appendChild(bolha);
  });
  mensagens.scrollTop = mensagens.scrollHeight;
}

async function carregarConversasIara(conversaId = conversaSelecionadaId) {
  try {
    const sufixo = conversaId ? `?conversa_id=${encodeURIComponent(conversaId)}` : "";
    const dados = await chamarApi(`/admin/api/iara/conversas${sufixo}`);
    renderizarConversas(dados);
  } catch (erro) {
    console.error("Erro ao carregar conversas da Iara:", erro);
  }
}

async function carregarIara() {
  try {
    const dados = await chamarApi("/admin/api/iara");
    dadosIara = dados;
    const semPlano = dados.plano === "nenhum";
    el("iaraSemPlano").hidden = !semPlano;
    el("iaraCentral").hidden = semPlano;
    if (semPlano) return;

    const config = dados.configuracao;
    const resumo = dados.resumo;
    el("iaraPlanoBadge").textContent = "Iara";
    el("btnIaraAtivar").textContent = config.ativa ? "Pausar Iara" : "Ligar Iara";
    el("iaraStatConversas").textContent = resumo.conversas_ativas;
    el("iaraStatHumano").textContent = resumo.em_atendimento_humano;
    el("iaraStatMensagens").textContent = resumo.mensagens_mes;
    el("iaraStatUso").textContent = `${resumo.mensagens_com_ia}/${resumo.limite_mensal}`;
    el("iaraUsoDetalhe").textContent = `${resumo.tokens_mes.toLocaleString("pt-BR")} tokens · Ver consumo e atividade ›`;
    el("iaraTom").value = config.tom_voz || "acolhedora";
    el("iaraMensagemInicial").value = config.mensagem_inicial || "";
    el("iaraMensagemForaHorario").value = config.mensagem_fora_horario === "Olá! No momento estamos fora do horário de atendimento. Assim que possível, nossa equipe retorna por aqui. 😊"
      ? "A equipe pode não estar disponível neste momento, mas eu sigo por aqui para ajudar com serviços, valores e agendamentos. 😊"
      : (config.mensagem_fora_horario || "");
    el("iaraMensagemTransferencia").value = config.mensagem_transferencia_humano || "";
    el("iaraEmojis").checked = config.usar_emojis;
    el("iaraTransferirHumano").checked = config.transferir_para_humano;
    el("iaraIgnorarHumano").checked = config.ignorar_atendimento_humano;
    el("iaraLimiteResposta").value = String(config.limite_caracteres_resposta || 500);
    el("iaraWhatsappStatus").textContent = config.whatsapp_status === "conectado" ? `Conectado: ${config.whatsapp_numero || "número do salão"}` : "Ainda não conectado. Você pode configurar a Iara enquanto isso.";

    const saude = [config.ativa ? "Iara está ligada e pronta para receber o WhatsApp." : "Iara está pausada. Ela não responderá até ser ligada."];
    if (!config.mensagem_inicial) saude.push("Defina uma mensagem inicial para deixar a recepção mais personalizada.");
    if (config.whatsapp_status !== "conectado") saude.push("WhatsApp ainda não conectado — a conexão oficial da Meta será liberada aqui.");
    el("iaraSaudeLista").innerHTML = saude.map((item) => `<p class="iara-saude-item"><span aria-hidden="true"></span>${escaparHtml(item)}</p>`).join("");
    renderizarContatos(dados.contatos);
    renderizarConhecimento(dados.conhecimento_automatico, dados.conhecimento);
    el("iaraTemplatesLista").innerHTML = (dados.templates || []).map((item) => `<div class="iara-lista-item"><div><strong>${escaparHtml(item.nome)}</strong><span>${escaparHtml(item.tipo)} · ${escaparHtml(item.mensagem)}</span></div></div>`).join("");

    const eventos = el("iaraEventosLista");
    eventos.innerHTML = "";
    el("iaraEventosVazio").hidden = Boolean(dados.eventos?.length);
    (dados.eventos || []).forEach((evento) => {
      const item = document.createElement("div");
      item.className = "iara-lista-item";
      item.innerHTML = `<strong>${escaparHtml(evento.descricao)}</strong><span>${new Date(evento.criado_em).toLocaleString("pt-BR", { dateStyle: "short", timeStyle: "short" })}</span>`;
      eventos.appendChild(item);
    });
    el("iaraAutomacoesPremium").innerHTML = "<h2>Automações</h2><p>Confirmações, lembretes, campanhas e recuperação de clientes serão configurados aqui.</p>";
  } catch (erro) {
    console.error("Erro ao carregar IAra:", erro);
    el("iaraSemPlano").hidden = false;
    el("iaraCentral").hidden = true;
    el("iaraAssinarMensagem").textContent = erro.message;
    el("iaraAssinarMensagem").hidden = false;
  }
}

document.querySelectorAll("[data-iara-subaba]").forEach((botao) => botao.addEventListener("click", () => abrirAba(botao.dataset.iaraSubaba)));
document.querySelectorAll("[data-iara-atalho]").forEach((botao) => botao.addEventListener("click", () => abrirAba(botao.dataset.iaraAtalho)));
el("btnIaraAssinar").addEventListener("click", () => { el("iaraAssinarMensagem").hidden = false; });
el("btnIaraConectarWhatsapp").addEventListener("click", () => alert("A conexão oficial da Meta será aberta aqui quando o Embedded Signup estiver configurado."));
el("btnIaraAtivar").addEventListener("click", async () => {
  if (!dadosIara?.configuracao) return;
  await chamarApi("/admin/api/iara/configuracao", { method: "PUT", body: JSON.stringify({ ativa: !dadosIara.configuracao.ativa }) });
  carregarIara();
});
el("formIaraConfiguracao").addEventListener("submit", async (evento) => {
  evento.preventDefault();
  const erro = el("iaraConfiguracaoErro");
  erro.hidden = true;
  try {
    await chamarApi("/admin/api/iara/configuracao", { method: "PUT", body: JSON.stringify({ tom_voz: el("iaraTom").value, mensagem_inicial: el("iaraMensagemInicial").value, mensagem_fora_horario: el("iaraMensagemForaHorario").value, mensagem_transferencia_humano: el("iaraMensagemTransferencia").value, usar_emojis: el("iaraEmojis").checked, transferir_para_humano: el("iaraTransferirHumano").checked, ignorar_atendimento_humano: el("iaraIgnorarHumano").checked, limite_caracteres_resposta: Number(el("iaraLimiteResposta").value) }) });
    carregarIara();
  } catch (e) { erro.textContent = e.message; erro.hidden = false; }
});
el("formIaraContato").addEventListener("submit", async (evento) => {
  evento.preventDefault();
  const erro = el("iaraContatoErro");
  erro.hidden = true;
  try {
    await chamarApi("/admin/api/iara/contatos-ignorados", { method: "POST", body: JSON.stringify({ nome: el("iaraContatoNome").value, telefone: el("iaraContatoTelefone").value, categoria: el("iaraContatoCategoria").value }) });
    el("formIaraContato").reset();
    carregarIara();
  } catch (e) { erro.textContent = e.message; erro.hidden = false; }
});

async function enviarTesteIara({ nome, telefone, mensagem }) {
  const erro = el("iaraTesteErro");
  erro.hidden = true;
  try {
    const dados = await chamarApi("/admin/api/iara/testar", { method: "POST", body: JSON.stringify({ nome, telefone, mensagem }) });
    conversaSelecionadaId = dados.conversa_id;
    await carregarConversasIara(dados.conversa_id);
    carregarIara();
    return true;
  } catch (e) { erro.textContent = e.message; erro.hidden = false; return false; }
}

/* LEGACY_TEST_HANDLER_START */
if (false) {
el("formIaraTeste").addEventListener("submit", async (evento) => {
  evento.preventDefault();
  const erro = el("iaraTesteErro");
  const resultado = el("iaraTesteResultado");
  erro.hidden = true;
  resultado.hidden = true;
  try {
    const dados = await chamarApi("/admin/api/iara/testar", {
      method: "POST",
      body: JSON.stringify({
        nome: el("iaraTesteNome").value,
        telefone: el("iaraTesteTelefone").value,
        mensagem: el("iaraTesteMensagem").value,
      }),
    });
    const resposta = dados.resposta || "A Iara ignoraria esta mensagem por segurança.";
    resultado.innerHTML = `<strong>Resposta da Iara</strong><p>${escaparHtml(resposta)}</p><small>Decisão: ${escaparHtml(dados.decisao?.motivo || "não informada")}</small>`;
    resultado.hidden = false;
    carregarIara();
  } catch (e) { erro.textContent = e.message; erro.hidden = false; }
});
}

el("btnIaraNovaConversa").addEventListener("click", () => { el("iaraNovaConversa").hidden = !el("iaraNovaConversa").hidden; });
el("formIaraNovaConversa").addEventListener("submit", async (evento) => {
  evento.preventDefault();
  const sucesso = await enviarTesteIara({ nome: el("iaraTesteNome").value, telefone: el("iaraTesteTelefone").value, mensagem: el("iaraTesteMensagem").value });
  if (sucesso) { evento.target.reset(); el("iaraNovaConversa").hidden = true; }
});
el("formIaraTeste").addEventListener("submit", async (evento) => {
  evento.preventDefault();
  if (!conversaSelecionadaId) return;
  const sucesso = await enviarTesteIara({ nome: el("iaraChatNome").textContent, telefone: el("iaraChatTelefone").textContent, mensagem: el("iaraChatMensagem").value });
  if (sucesso) el("iaraChatMensagem").value = "";
});
el("btnIaraStatusConversa").addEventListener("click", async () => {
  if (!conversaSelecionadaId) return;
  const status = el("btnIaraStatusConversa").dataset.status === "humano" ? "iara" : "humano";
  try {
    await chamarApi(`/admin/api/iara/conversas/${conversaSelecionadaId}/status`, { method: "PATCH", body: JSON.stringify({ status }) });
    await carregarConversasIara(conversaSelecionadaId);
    carregarIara();
  } catch (erro) { console.error("Erro ao atualizar atendimento:", erro); }
});

el("formIaraConhecimento").addEventListener("submit", async (evento) => { evento.preventDefault(); await chamarApi("/admin/api/iara/conhecimento", { method: "POST", body: JSON.stringify({ categoria: el("iaraConhecimentoCategoria").value, titulo: el("iaraConhecimentoTitulo").value, conteudo: el("iaraConhecimentoConteudo").value }) }); evento.target.reset(); carregarIara(); });
el("formIaraTemplate").addEventListener("submit", async (evento) => { evento.preventDefault(); await chamarApi("/admin/api/iara/templates", { method: "POST", body: JSON.stringify({ tipo: el("iaraTemplateTipo").value, nome: el("iaraTemplateNome").value, mensagem: el("iaraTemplateMensagem").value }) }); evento.target.reset(); carregarIara(); });

carregarIdentidadeSalao();
carregarIara();

import express from "express";
import { supabase } from "../config/supabase.js";
import { requireAuth } from "../middlewares/requireAuth.js";
import { atenderMensagemIara } from "../lib/iaraAtendimento.js";

const router = express.Router();
const PLANOS_VALIDOS = new Set(["nenhum", "ativo", "pro", "premium"]);
const CATEGORIAS_CONTATO = new Set(["familiar", "amigo", "funcionario", "fornecedor", "pessoal", "manual"]);

function padroesDaIara(nomeSalao = "seu salão") {
  return {
    nome_assistente: "Iara",
    tom_voz: "acolhedora",
    usar_emojis: true,
    transferir_para_humano: true,
    ignorar_atendimento_humano: true,
    limite_caracteres_resposta: 500,
    intervalo_minimo_segundos: 8,
    mensagem_inicial: `Olá! Eu sou a Iara, assistente virtual do ${nomeSalao}. Como posso ajudar você hoje? 😊`,
    mensagem_fora_horario: "A equipe pode não estar disponível neste momento, mas eu sigo por aqui para ajudar com serviços, valores e agendamentos. 😊",
    mensagem_transferencia_humano: "Vou chamar uma pessoa da nossa equipe para continuar com você. Só um instante 😊",
  };
}

function aplicarPadroes(configuracao, nomeSalao) {
  const padroes = padroesDaIara(nomeSalao);
  return { ...padroes, ...(configuracao || {}), ...Object.fromEntries(Object.entries(padroes).filter(([chave]) => !configuracao?.[chave])), nome_assistente: "Iara" };
}

function planoIara(salao) {
  const plano = String(salao?.plano_iara || "nenhum").toLowerCase();
  if (!PLANOS_VALIDOS.has(plano) || plano === "nenhum") return "nenhum";
  return "ativo";
}

function podeUsarIara(req) {
  return planoIara(req.salao) !== "nenhum";
}

function redesDoSalao(redes) {
  if (typeof redes === "string") {
    try { return JSON.parse(redes); } catch { return {}; }
  }
  return redes && typeof redes === "object" ? redes : {};
}

async function conhecimentoAutomaticoDoPainel(salao) {
  const [servicosResultado, profissionaisResultado, faqsResultado] = await Promise.all([
    supabase.from("servicos").select("nome, preco, duracao_minutos").eq("salao_id", salao.id).eq("ativo", true).order("nome"),
    supabase.from("profissionais").select("nome").eq("salao_id", salao.id).eq("ativo", true).order("nome"),
    supabase.from("perguntas_frequentes").select("pergunta, resposta").eq("salao_id", salao.id).eq("ativo", true).order("ordem"),
  ]);
  const erro = servicosResultado.error || profissionaisResultado.error || faqsResultado.error;
  if (erro) throw erro;
  const redes = redesDoSalao(salao.redes_sociais);
  const servicos = servicosResultado.data || [];
  const profissionais = profissionaisResultado.data || [];
  const faqs = faqsResultado.data || [];
  return [
    { chave: "endereco", titulo: "Endereço", conteudo: salao.endereco || "Endereço ainda não cadastrado.", disponivel: Boolean(salao.endereco) },
    { chave: "whatsapp", titulo: "WhatsApp", conteudo: salao.telefone || "WhatsApp ainda não cadastrado.", disponivel: Boolean(salao.telefone) },
    { chave: "instagram", titulo: "Instagram", conteudo: redes.instagram ? `@${String(redes.instagram).replace(/^@/, "")}` : "Instagram ainda não cadastrado.", disponivel: Boolean(redes.instagram) },
    { chave: "servicos", titulo: "Serviços e valores", conteudo: servicos.length ? servicos.map((item) => `${item.nome}: R$ ${Number(item.preco).toFixed(2).replace(".", ",")} · ${item.duracao_minutos} min`).join("\n") : "Nenhum serviço ativo cadastrado.", disponivel: Boolean(servicos.length) },
    { chave: "profissionais", titulo: "Profissionais", conteudo: profissionais.length ? profissionais.map((item) => item.nome).join(", ") : "Nenhuma profissional ativa cadastrada.", disponivel: Boolean(profissionais.length) },
    { chave: "faq", titulo: "Perguntas frequentes", conteudo: faqs.length ? faqs.map((item) => `${item.pergunta}\n${item.resposta}`).join("\n\n") : "Nenhuma pergunta frequente cadastrada.", disponivel: Boolean(faqs.length) },
  ];
}

async function buscarConfiguracao(salaoId, criar = false, nomeSalao = "seu salão") {
  let { data, error } = await supabase.from("iara_configuracoes").select("*").eq("salao_id", salaoId).maybeSingle();
  if (error) throw error;
  if (!data && criar) {
    const resultado = await supabase.from("iara_configuracoes").insert({ salao_id: salaoId, ...padroesDaIara(nomeSalao) }).select("*").single();
    if (resultado.error) throw resultado.error;
    data = resultado.data;
  }
  return data;
}

router.get("/", requireAuth, async (req, res) => {
  try {
    const plano = planoIara(req.salao);
    if (plano === "nenhum") return res.json({ ok: true, plano, configuracao: null, resumo: null, contatos: [], eventos: [], conhecimento: [], templates: [] });

    const inicioMes = new Date();
    inicioMes.setDate(1);
    inicioMes.setHours(0, 0, 0, 0);
    let [configuracao, contatosResultado, conversasResultado, mensagensResultado, eventosResultado, conhecimentoResultado, templatesResultado] = await Promise.all([
      buscarConfiguracao(req.salao.id, true, req.salao.nome),
      supabase.from("iara_contatos_ignorados").select("*").eq("salao_id", req.salao.id).order("criado_em", { ascending: false }),
      supabase.from("iara_conversas").select("id, status, ultima_mensagem_em").eq("salao_id", req.salao.id),
      supabase.from("iara_mensagens").select("id, usou_ia, tokens_entrada, tokens_saida").eq("salao_id", req.salao.id).gte("criado_em", inicioMes.toISOString()),
      supabase.from("iara_eventos").select("*").eq("salao_id", req.salao.id).order("criado_em", { ascending: false }).limit(12),
      supabase.from("iara_conhecimento").select("*").eq("salao_id", req.salao.id).order("categoria"),
      supabase.from("iara_templates").select("*").eq("salao_id", req.salao.id).order("tipo"),
    ]);

    if (contatosResultado.error || conversasResultado.error || mensagensResultado.error || eventosResultado.error || conhecimentoResultado.error || templatesResultado.error) {
      throw contatosResultado.error || conversasResultado.error || mensagensResultado.error || eventosResultado.error || conhecimentoResultado.error || templatesResultado.error;
    }
    configuracao = aplicarPadroes(configuracao, req.salao.nome);
    const automaticoBase = await conhecimentoAutomaticoDoPainel(req.salao);
    const conhecimentoSalvo = conhecimentoResultado.data || [];
    const sobrescritas = new Map(conhecimentoSalvo.filter((item) => String(item.categoria).startsWith("__sistema_")).map((item) => [item.categoria.replace("__sistema_", ""), item]));
    const conhecimentoAutomatico = automaticoBase.map((item) => {
      const sobrescrita = sobrescritas.get(item.chave);
      return sobrescrita ? { ...item, conteudo: sobrescrita.conteudo, ativo: sobrescrita.ativo, personalizado: sobrescrita.ativo } : { ...item, ativo: true, personalizado: false };
    });
    const mensagens = mensagensResultado.data || [];
    const conversas = conversasResultado.data || [];
    const resumo = {
      conversas_ativas: conversas.filter((item) => ["iara", "humano"].includes(item.status)).length,
      em_atendimento_humano: conversas.filter((item) => item.status === "humano").length,
      mensagens_mes: mensagens.length,
      mensagens_com_ia: mensagens.filter((item) => item.usou_ia).length,
      tokens_mes: mensagens.reduce((total, item) => total + Number(item.tokens_entrada || 0) + Number(item.tokens_saida || 0), 0),
      limite_mensal: configuracao.limite_mensal_ia,
    };
    res.json({ ok: true, plano, configuracao, resumo, contatos: contatosResultado.data || [], eventos: eventosResultado.data || [], conhecimento: conhecimentoSalvo.filter((item) => !String(item.categoria).startsWith("__sistema_")), conhecimento_automatico: conhecimentoAutomatico, templates: templatesResultado.data || [] });
  } catch (error) {
    console.error("Erro ao carregar Central IAra:", error);
    res.status(500).json({ erro: "A Central IAra ainda não está pronta. Execute a migração da IAra no Supabase." });
  }
});

router.put("/configuracao", requireAuth, async (req, res) => {
  if (!podeUsarIara(req)) return res.status(403).json({ erro: "Ative a IAra para alterar esta configuração." });
  const campos = ["ativa", "tom_voz", "usar_emojis", "mensagem_inicial", "mensagem_fora_horario", "mensagem_transferencia_humano", "transferir_para_humano", "ignorar_atendimento_humano", "limite_caracteres_resposta", "intervalo_minimo_segundos", "modelo_ia", "horarios_atendimento", "atendimento", "inteligencia", "economia", "seguranca", "ferramentas"];
  const atualizacoes = Object.fromEntries(campos.filter((campo) => Object.hasOwn(req.body, campo)).map((campo) => [campo, req.body[campo]]));
  if (atualizacoes.tom_voz !== undefined && !["acolhedora", "objetiva", "sofisticada"].includes(atualizacoes.tom_voz)) return res.status(400).json({ erro: "Tom de voz inválido." });
  if (atualizacoes.limite_caracteres_resposta !== undefined) atualizacoes.limite_caracteres_resposta = Math.max(100, Math.min(2000, Number(atualizacoes.limite_caracteres_resposta) || 500));
  if (atualizacoes.intervalo_minimo_segundos !== undefined) atualizacoes.intervalo_minimo_segundos = Math.max(0, Math.min(300, Number(atualizacoes.intervalo_minimo_segundos) || 8));
  atualizacoes.atualizado_em = new Date().toISOString();
  try {
    await buscarConfiguracao(req.salao.id, true, req.salao.nome);
    const { data, error } = await supabase.from("iara_configuracoes").update(atualizacoes).eq("salao_id", req.salao.id).select("*").single();
    if (error) throw error;
    await supabase.from("iara_eventos").insert({ salao_id: req.salao.id, tipo: "configuracao", descricao: "Configurações da IAra atualizadas." });
    res.json({ ok: true, configuracao: data });
  } catch (error) {
    console.error("Erro ao salvar configuração IAra:", error);
    res.status(500).json({ erro: "Não foi possível salvar as configurações da IAra." });
  }
});

router.post("/contatos-ignorados", requireAuth, async (req, res) => {
  if (!podeUsarIara(req)) return res.status(403).json({ erro: "Assine a IAra para gerenciar contatos ignorados." });
  const telefone = String(req.body.telefone || "").replace(/\D/g, "");
  const categoria = String(req.body.categoria || "manual");
  if (telefone.length < 10 || telefone.length > 15) return res.status(400).json({ erro: "Informe um WhatsApp válido com DDD." });
  if (!CATEGORIAS_CONTATO.has(categoria)) return res.status(400).json({ erro: "Categoria inválida." });
  const { data, error } = await supabase.from("iara_contatos_ignorados").upsert({ salao_id: req.salao.id, telefone, categoria, nome: String(req.body.nome || "").trim().slice(0, 120) || null, motivo: String(req.body.motivo || "").trim().slice(0, 240) || null }, { onConflict: "salao_id,telefone" }).select("*").single();
  if (error) return res.status(500).json({ erro: "Não foi possível salvar o contato." });
  await supabase.from("iara_eventos").insert({ salao_id: req.salao.id, tipo: "contato_ignorado", descricao: `Contato ${telefone} adicionado à lista de ignorados.` });
  res.status(201).json({ ok: true, contato: data });
});

router.delete("/contatos-ignorados/:id", requireAuth, async (req, res) => {
  if (!podeUsarIara(req)) return res.status(403).json({ erro: "Assine a IAra para gerenciar contatos ignorados." });
  const { error } = await supabase.from("iara_contatos_ignorados").delete().eq("id", req.params.id).eq("salao_id", req.salao.id);
  if (error) return res.status(500).json({ erro: "Não foi possível remover o contato." });
  res.json({ ok: true });
});

router.get("/conversas", requireAuth, async (req, res) => {
  const conversaId = req.query.conversa_id;
  try {
    const { data: conversas, error: erroConversas } = await supabase
      .from("iara_conversas")
      .select("id, telefone, nome_contato, status, ultima_mensagem_em, criado_em")
      .eq("salao_id", req.salao.id)
      .order("ultima_mensagem_em", { ascending: false })
      .limit(100);
    if (erroConversas) throw erroConversas;

    let mensagens = [];
    const selecionada = conversaId || conversas?.[0]?.id;
    if (selecionada) {
      const pertenceAoSalao = (conversas || []).some((conversa) => conversa.id === selecionada);
      if (!pertenceAoSalao) return res.status(404).json({ erro: "Conversa não encontrada." });
      const resultado = await supabase
        .from("iara_mensagens")
        .select("id, direcao, conteudo, decisao, usou_ia, criado_em")
        .eq("salao_id", req.salao.id)
        .eq("conversa_id", selecionada)
        .order("criado_em", { ascending: true })
        .limit(250);
      if (resultado.error) throw resultado.error;
      mensagens = resultado.data || [];
    }
    res.json({ ok: true, conversas: conversas || [], conversa_id: selecionada || null, mensagens });
  } catch (error) {
    console.error("Erro ao carregar conversas da Iara:", error);
    res.status(500).json({ erro: "Não foi possível carregar as conversas." });
  }
});

router.patch("/conversas/:id/status", requireAuth, async (req, res) => {
  const status = req.body.status === "iara" ? "iara" : req.body.status === "humano" ? "humano" : null;
  if (!status) return res.status(400).json({ erro: "Status inválido." });
  const { data, error } = await supabase
    .from("iara_conversas")
    .update({ status, ultima_mensagem_em: new Date().toISOString() })
    .eq("id", req.params.id)
    .eq("salao_id", req.salao.id)
    .select("id, status")
    .maybeSingle();
  if (error) return res.status(500).json({ erro: "Não foi possível atualizar o atendimento." });
  if (!data) return res.status(404).json({ erro: "Conversa não encontrada." });
  await supabase.from("iara_eventos").insert({ salao_id: req.salao.id, tipo: "atendimento", descricao: status === "humano" ? "Atendimento transferido para humano." : "Atendimento retornou para a Iara." });
  res.json({ ok: true, conversa: data });
});

// Canal seguro de teste. Usa exatamente o mesmo motor que será chamado pelo
// webhook do WhatsApp, mas não envia nada para fora enquanto a Meta não estiver
// conectada. Assim a dona consegue validar regras e respostas no próprio salão.
router.post("/testar", requireAuth, async (req, res) => {
  if (!podeUsarIara(req)) return res.status(403).json({ erro: "Ative a Iara para testar o atendimento." });
  try {
    const resultado = await atenderMensagemIara({
      salao: req.salao,
      telefone: req.body.telefone,
      nome: req.body.nome,
      mensagem: req.body.mensagem,
      grupo: req.body.grupo === true,
      enviadaPeloSalao: req.body.enviada_pelo_salao === true,
    });
    res.json({ ok: true, ...resultado });
  } catch (error) {
    console.error("Erro no teste da Iara:", error);
    res.status(400).json({ erro: error.message || "Não foi possível testar a Iara." });
  }
});

router.put("/conhecimento/automatico/:chave", requireAuth, async (req, res) => {
  if (!podeUsarIara(req)) return res.status(403).json({ erro: "Ative a Iara para alterar o conhecimento." });
  const chave = String(req.params.chave || "").replace(/[^a-z_]/g, "").slice(0, 40);
  if (!chave) return res.status(400).json({ erro: "Item de conhecimento inválido." });
  const categoria = `__sistema_${chave}`;
  try {
    const { data: existente, error: erroBusca } = await supabase.from("iara_conhecimento").select("id").eq("salao_id", req.salao.id).eq("categoria", categoria).maybeSingle();
    if (erroBusca) throw erroBusca;
    const dados = { conteudo: String(req.body.conteudo || "").trim().slice(0, 8000), ativo: req.body.ativo !== false, atualizado_em: new Date().toISOString() };
    if (!dados.conteudo && dados.ativo) return res.status(400).json({ erro: "Informe o conteúdo ou oculte este item." });
    const resultado = existente
      ? await supabase.from("iara_conhecimento").update(dados).eq("id", existente.id).eq("salao_id", req.salao.id).select("*").single()
      : await supabase.from("iara_conhecimento").insert({ salao_id: req.salao.id, categoria, titulo: chave, ...dados }).select("*").single();
    if (resultado.error) throw resultado.error;
    await supabase.from("iara_eventos").insert({ salao_id: req.salao.id, tipo: "conhecimento", descricao: `Conhecimento automático “${chave}” ${dados.ativo ? "personalizado" : "ocultado"}.` });
    res.json({ ok: true, item: resultado.data });
  } catch (error) {
    console.error("Erro ao salvar conhecimento automático:", error);
    res.status(500).json({ erro: "Não foi possível atualizar este conhecimento." });
  }
});

router.delete("/conhecimento/automatico/:chave", requireAuth, async (req, res) => {
  const categoria = `__sistema_${String(req.params.chave || "").replace(/[^a-z_]/g, "").slice(0, 40)}`;
  const { error } = await supabase.from("iara_conhecimento").delete().eq("salao_id", req.salao.id).eq("categoria", categoria);
  if (error) return res.status(500).json({ erro: "Não foi possível restaurar este item." });
  res.json({ ok: true });
});

router.put("/conhecimento/:id", requireAuth, async (req, res) => {
  const titulo = String(req.body.titulo || "").trim().slice(0, 120);
  const conteudo = String(req.body.conteudo || "").trim().slice(0, 8000);
  if (!titulo || !conteudo) return res.status(400).json({ erro: "Preencha título e informação." });
  const { data, error } = await supabase.from("iara_conhecimento").update({ titulo, conteudo, atualizado_em: new Date().toISOString() }).eq("id", req.params.id).eq("salao_id", req.salao.id).select("*").maybeSingle();
  if (error) return res.status(500).json({ erro: "Não foi possível editar a informação." });
  if (!data) return res.status(404).json({ erro: "Informação não encontrada." });
  res.json({ ok: true, item: data });
});

router.delete("/conhecimento/:id", requireAuth, async (req, res) => {
  const { error } = await supabase.from("iara_conhecimento").delete().eq("id", req.params.id).eq("salao_id", req.salao.id).not("categoria", "like", "__sistema_%");
  if (error) return res.status(500).json({ erro: "Não foi possível excluir a informação." });
  res.json({ ok: true });
});

router.post("/:recurso", requireAuth, async (req, res) => {
  if (!podeUsarIara(req)) return res.status(403).json({ erro: "Assine a IAra para usar esta área." });
  const tabela = req.params.recurso === "conhecimento" ? "iara_conhecimento" : req.params.recurso === "templates" ? "iara_templates" : null;
  if (!tabela) return res.status(404).json({ erro: "Recurso não encontrado." });
  const dados = tabela === "iara_conhecimento"
    ? { salao_id: req.salao.id, categoria: String(req.body.categoria || "extra").slice(0, 50), titulo: String(req.body.titulo || "").trim().slice(0, 120), conteudo: String(req.body.conteudo || "").trim().slice(0, 4000) }
    : { salao_id: req.salao.id, tipo: String(req.body.tipo || "geral").slice(0, 50), nome: String(req.body.nome || "").trim().slice(0, 120), mensagem: String(req.body.mensagem || "").trim().slice(0, 4000) };
  if (!dados.titulo && !dados.nome || !dados.conteudo && !dados.mensagem) return res.status(400).json({ erro: "Preencha título e conteúdo." });
  const { data, error } = await supabase.from(tabela).insert(dados).select("*").single();
  if (error) return res.status(500).json({ erro: "Não foi possível salvar." });
  await supabase.from("iara_eventos").insert({ salao_id: req.salao.id, tipo: tabela, descricao: `${tabela === "iara_conhecimento" ? "Conhecimento" : "Template"} adicionado.` });
  res.status(201).json({ ok: true, item: data });
});

export default router;

import { supabase } from "../config/supabase.js";
import { decidirAtendimentoIara } from "./iaraMotor.js";

function normalizarTelefone(valor) {
  return String(valor || "").replace(/\D/g, "");
}

function moeda(valor) {
  return Number(valor || 0).toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
}

function textoServico(servicos, mensagem) {
  const texto = String(mensagem || "").toLocaleLowerCase("pt-BR");
  const encontrado = servicos.find((servico) => texto.includes(String(servico.nome).toLocaleLowerCase("pt-BR")));
  if (encontrado) return `${encontrado.nome}: ${moeda(encontrado.preco)} · ${encontrado.duracao_minutos} min.`;
  if (!servicos.length) return "No momento não encontrei serviços cadastrados para informar.";
  return `Temos: ${servicos.slice(0, 6).map((servico) => `${servico.nome} (${moeda(servico.preco)})`).join(", ")}.`;
}

function respostaParaDecisao(decisao, contexto, mensagem) {
  if (decisao.acao === "responder_direto") return decisao.resposta;
  if (decisao.acao === "consultar_banco" && decisao.ferramenta === "servicos") return textoServico(contexto.servicos, mensagem);
  if (decisao.acao === "consultar_banco" && decisao.ferramenta === "agenda") {
    return "Claro! Para consultar horários, me diga qual serviço, profissional (se tiver preferência) e o dia que você deseja.";
  }
  if (decisao.acao === "usar_modelo") {
    const faq = (contexto.faqs || []).find((item) => {
      const palavras = String(item.pergunta || "").toLocaleLowerCase("pt-BR").split(/\W+/).filter((palavra) => palavra.length >= 4);
      const texto = String(mensagem || "").toLocaleLowerCase("pt-BR");
      return palavras.some((palavra) => texto.includes(palavra));
    });
    if (faq?.resposta) return faq.resposta;
    return "Posso ajudar com serviços, valores, profissionais, horários e agendamentos do salão. O que você gostaria de saber?";
  }
  return null;
}

function redesDoSalao(redes) {
  if (typeof redes === "string") {
    try { return JSON.parse(redes); } catch { return {}; }
  }
  return redes && typeof redes === "object" ? redes : {};
}

async function registrarEvento(salaoId, tipo, descricao) {
  const { error } = await supabase.from("iara_eventos").insert({ salao_id: salaoId, tipo, descricao });
  if (error) console.error("Erro ao registrar evento da Iara:", error);
}

async function obterConversa(salaoId, telefone, nome) {
  const { data: existente, error: erroBusca } = await supabase
    .from("iara_conversas")
    .select("*")
    .eq("salao_id", salaoId)
    .eq("telefone", telefone)
    .maybeSingle();
  if (erroBusca) throw erroBusca;
  if (existente) return existente;

  const { data, error } = await supabase
    .from("iara_conversas")
    .insert({ salao_id: salaoId, telefone, nome_contato: nome || null, status: "iara", ultima_mensagem_em: new Date().toISOString() })
    .select("*")
    .single();
  if (error) throw error;
  await registrarEvento(salaoId, "conversa", `Nova conversa iniciada com ${nome || telefone}.`);
  return data;
}

async function carregarContexto(salao) {
  const [servicosResultado, profissionaisResultado, faqsResultado, conhecimentoResultado] = await Promise.all([
    supabase.from("servicos").select("id, nome, preco, duracao_minutos").eq("salao_id", salao.id).eq("ativo", true).order("nome"),
    supabase.from("profissionais").select("id, nome").eq("salao_id", salao.id).eq("ativo", true).order("nome"),
    supabase.from("perguntas_frequentes").select("pergunta, resposta").eq("salao_id", salao.id).eq("ativo", true).order("ordem"),
    supabase.from("iara_conhecimento").select("categoria, titulo, conteudo, ativo").eq("salao_id", salao.id),
  ]);
  const erro = servicosResultado.error || profissionaisResultado.error || faqsResultado.error || conhecimentoResultado.error;
  if (erro) throw erro;
  const conhecimento = conhecimentoResultado.data || [];
  const porCategoria = Object.fromEntries(conhecimento.filter((item) => item.ativo && !String(item.categoria).startsWith("__sistema_")).map((item) => [item.categoria, item.conteudo]));
  const sistema = (chave) => conhecimento.find((item) => item.categoria === `__sistema_${chave}`);
  const valorDoSistema = (chave, padrao) => {
    const sobrescrita = sistema(chave);
    if (!sobrescrita) return padrao;
    return sobrescrita.ativo ? sobrescrita.conteudo : "";
  };
  const ativoNoSistema = (chave) => sistema(chave)?.ativo !== false;
  const redes = redesDoSalao(salao.redes_sociais);
  return {
    servicos: ativoNoSistema("servicos") ? (servicosResultado.data || []) : [],
    profissionais: ativoNoSistema("profissionais") ? (profissionaisResultado.data || []) : [],
    faqs: ativoNoSistema("faq") ? (faqsResultado.data || []) : [],
    endereco: porCategoria.endereco || valorDoSistema("endereco", salao.endereco || ""),
    instagram: porCategoria.instagram || valorDoSistema("instagram", redes.instagram || ""),
    horarios: porCategoria.horarios || "",
    conhecimento,
  };
}

export async function atenderMensagemIara({ salao, telefone, nome, mensagem, grupo = false, enviadaPeloSalao = false }) {
  const telefoneLimpo = normalizarTelefone(telefone);
  if (telefoneLimpo.length < 10 || telefoneLimpo.length > 15) throw new Error("Informe um WhatsApp válido com DDD.");

  const [{ data: configuracao, error: erroConfiguracao }, { data: ignorado, error: erroIgnorado }, contexto] = await Promise.all([
    supabase.from("iara_configuracoes").select("*").eq("salao_id", salao.id).maybeSingle(),
    supabase.from("iara_contatos_ignorados").select("id").eq("salao_id", salao.id).eq("telefone", telefoneLimpo).maybeSingle(),
    carregarContexto(salao),
  ]);
  if (erroConfiguracao || erroIgnorado) throw erroConfiguracao || erroIgnorado;
  if (!configuracao) throw new Error("Configure a Iara antes de iniciar um atendimento.");

  const conversa = await obterConversa(salao.id, telefoneLimpo, String(nome || "").trim());
  const decisao = decidirAtendimentoIara({
    mensagem,
    conversa,
    configuracao,
    contatoIgnorado: Boolean(ignorado),
    grupo,
    enviadaPeloSalao,
    dados: contexto,
  });
  const resposta = respostaParaDecisao(decisao, contexto, mensagem);
  const agora = new Date().toISOString();

  const { error: erroEntrada } = await supabase.from("iara_mensagens").insert({
    salao_id: salao.id,
    conversa_id: conversa.id,
    direcao: "entrada",
    autor: "cliente",
    conteudo: String(mensagem || "").trim(),
    decisao: decisao.motivo,
    usou_ia: false,
  });
  if (erroEntrada) throw erroEntrada;

  if (resposta) {
    const { error: erroSaida } = await supabase.from("iara_mensagens").insert({
      salao_id: salao.id,
      conversa_id: conversa.id,
      direcao: "saida",
      autor: "iara",
      conteudo: resposta,
      decisao: decisao.motivo,
      usou_ia: false,
    });
    if (erroSaida) throw erroSaida;
  }

  const atualizacao = { ultima_mensagem_em: agora };
  if (decisao.marcarAvisoForaContexto) atualizacao.aviso_fora_contexto_enviado = true;
  if (decisao.acao === "ignorar" && decisao.motivo === "fora_do_contexto_reincidente") atualizacao.status = "pausada";
  const { error: erroAtualizacao } = await supabase.from("iara_conversas").update(atualizacao).eq("id", conversa.id);
  if (erroAtualizacao) throw erroAtualizacao;

  await registrarEvento(salao.id, resposta ? "resposta" : "ignorado", resposta ? `Iara respondeu: ${decisao.motivo}.` : `Iara ignorou: ${decisao.motivo}.`);
  return { resposta, decisao, conversa_id: conversa.id, contexto: decisao.acao === "consultar_banco" ? decisao.ferramenta : null };
}

const ASSUNTOS_FORA_DO_SALAO = /\b(pol[ií]tica|elei[cç][aã]o|presidente|futebol|jogo|time|relig[iã]o|igreja|namoro|relacionamento|fofoca|not[ií]cia)\b/i;
const SPAM = /(.)\1{8,}|https?:\/\/\S+/i;

export function decidirAtendimentoIara({ mensagem, conversa = {}, configuracao = {}, contatoIgnorado = false, grupo = false, enviadaPeloSalao = false, dados = {} }) {
  const texto = String(mensagem || "").trim();
  if (!texto || grupo || enviadaPeloSalao || contatoIgnorado) return { acao: "ignorar", motivo: grupo ? "grupo" : enviadaPeloSalao ? "proprio_numero" : contatoIgnorado ? "contato_ignorado" : "vazia" };
  if (SPAM.test(texto)) return { acao: "ignorar", motivo: "spam" };
  if (configuracao.ativa === false) return { acao: "ignorar", motivo: "iara_pausada" };
  if (conversa.status === "humano" && configuracao.ignorar_atendimento_humano !== false) return { acao: "ignorar", motivo: "atendimento_humano" };
  if (ASSUNTOS_FORA_DO_SALAO.test(texto)) {
    if (conversa.aviso_fora_contexto_enviado) return { acao: "ignorar", motivo: "fora_do_contexto_reincidente" };
    return { acao: "responder_direto", motivo: "fora_do_contexto", resposta: "Consigo ajudar com serviços, valores e agendamentos do salão 😊", marcarAvisoForaContexto: true };
  }
  const normalizado = texto.toLowerCase();
  if (/endere[cç]o|localiza[cç][aã]o|como chegar/.test(normalizado) && dados.endereco) return { acao: "responder_direto", motivo: "endereco_banco", resposta: dados.endereco };
  if (/instagram|rede social/.test(normalizado) && dados.instagram) return { acao: "responder_direto", motivo: "redes_banco", resposta: dados.instagram };
  if (/hor[aá]rio.*funciona|abre|fecha/.test(normalizado) && dados.horarios) return { acao: "responder_direto", motivo: "horarios_banco", resposta: dados.horarios };
  if (/pre[cç]o|valor|quanto custa/.test(normalizado) && dados.servicos?.length) return { acao: "consultar_banco", motivo: "preco_servico", ferramenta: "servicos" };
  if (/agendar|hor[aá]rio.*livre|dispon[ií]vel|reagendar|cancelar/.test(normalizado)) return { acao: "consultar_banco", motivo: "agenda", ferramenta: "agenda" };
  return { acao: "usar_modelo", motivo: "mensagem_livre", regras: ["não inventar informações", "não confirmar agenda sem consulta", "responder apenas sobre o salão", "resposta curta"] };
}

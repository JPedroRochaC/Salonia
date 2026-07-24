import express from "express";
import { supabase } from "../config/supabase.js";
import { requireAuth } from "../middlewares/requireAuth.js";

const router = express.Router();
const STATUS_CANCELADO = "cancelado";
const DIAS_INATIVIDADE = 60;

function normalizarTelefone(telefone) {
  return String(telefone || "").replace(/\D/g, "");
}

function validarCliente(nome, telefone) {
  const nomeLimpo = String(nome || "").trim().replace(/\s+/g, " ");
  const telefoneLimpo = normalizarTelefone(telefone);
  if (nomeLimpo.length < 2 || nomeLimpo.length > 120 || telefoneLimpo.length < 10 || telefoneLimpo.length > 11) {
    return { erro: "Informe nome e WhatsApp válidos." };
  }
  return { nomeLimpo, telefoneLimpo };
}

function limparTags(tags) {
  const valores = Array.isArray(tags) ? tags : String(tags || "").split(",");
  return [...new Set(valores.map((tag) => String(tag).trim().replace(/\s+/g, " ")).filter(Boolean))]
    .slice(0, 12)
    .map((tag) => tag.slice(0, 30));
}

function dadosInternosDoCorpo(corpo = {}) {
  const camposInternos = ["aniversario_dia", "aniversario_mes", "observacoes", "preferencias", "alergias", "consentimento_alergias", "tags"];
  if (!camposInternos.some((campo) => Object.prototype.hasOwnProperty.call(corpo, campo))) return {};
  const dia = corpo.aniversario_dia === "" || corpo.aniversario_dia == null ? null : Number(corpo.aniversario_dia);
  const mes = corpo.aniversario_mes === "" || corpo.aniversario_mes == null ? null : Number(corpo.aniversario_mes);
  if ((dia && !mes) || (!dia && mes) || (dia && (!Number.isInteger(dia) || dia < 1 || dia > 31 || !Number.isInteger(mes) || mes < 1 || mes > 12))) {
    return { erro: "Informe dia e mês de aniversário válidos." };
  }

  const alergias = String(corpo.alergias || "").trim().slice(0, 2000) || null;
  const consentimento = corpo.consentimento_alergias === true;
  if (alergias && !consentimento) {
    return { erro: "Registre alergias somente após o consentimento explícito da cliente." };
  }

  return {
    aniversario_dia: dia,
    aniversario_mes: mes,
    observacoes: String(corpo.observacoes || "").trim().slice(0, 4000) || null,
    preferencias: String(corpo.preferencias || "").trim().slice(0, 2000) || null,
    alergias,
    consentimento_alergias: alergias ? consentimento : false,
    consentimento_alergias_em: alergias && consentimento ? new Date().toISOString() : null,
    tags: limparTags(corpo.tags),
  };
}

const CAMPOS_CLIENTE = "id, nome, telefone, aniversario_dia, aniversario_mes, observacoes, preferencias, alergias, consentimento_alergias, consentimento_alergias_em, tags";

function resumirClientes(clientes, agendamentos) {
  const agora = new Date();
  const limiteInatividade = new Date(agora);
  limiteInatividade.setDate(limiteInatividade.getDate() - DIAS_INATIVIDADE);
  const limiteFrequencia = new Date(agora);
  limiteFrequencia.setDate(limiteFrequencia.getDate() - 90);
  const porCliente = new Map();

  for (const agendamento of agendamentos) {
    if (!porCliente.has(agendamento.cliente_id)) porCliente.set(agendamento.cliente_id, []);
    porCliente.get(agendamento.cliente_id).push(agendamento);
  }

  return clientes.map((cliente) => {
    const registros = porCliente.get(cliente.id) || [];
    const validos = registros.filter((agendamento) => agendamento.status !== STATUS_CANCELADO);
    const passados = validos.filter((agendamento) => new Date(agendamento.data_hora) <= agora);
    const futuros = validos.filter((agendamento) => new Date(agendamento.data_hora) > agora);
    const ultimaVisita = passados.reduce((maisRecente, agendamento) =>
      !maisRecente || new Date(agendamento.data_hora) > new Date(maisRecente.data_hora) ? agendamento : maisRecente,
    null);
    const proximoAgendamento = futuros.reduce((maisProximo, agendamento) =>
      !maisProximo || new Date(agendamento.data_hora) < new Date(maisProximo.data_hora) ? agendamento : maisProximo,
    null);

    return {
      ...cliente,
      atendimentos: passados.length,
      gasto_total: validos.reduce((total, agendamento) => total + Number(agendamento.valor || 0), 0),
      visitas_ultimos_90_dias: passados.filter((agendamento) => new Date(agendamento.data_hora) >= limiteFrequencia).length,
      ultima_visita: ultimaVisita?.data_hora || null,
      proximo_agendamento: proximoAgendamento?.data_hora || null,
      inativa: !proximoAgendamento && (!ultimaVisita || new Date(ultimaVisita.data_hora) < limiteInatividade),
    };
  });
}

router.get("/", requireAuth, async (req, res) => {
  const busca = String(req.query.busca || "").trim();
  const filtro = String(req.query.filtro || "todos");
  let consulta = supabase.from("clientes").select(CAMPOS_CLIENTE).eq("salao_id", req.salao.id).order("nome").limit(500);

  if (busca) {
    const termo = busca.replace(/[%_(),]/g, "");
    consulta = consulta.or(`nome.ilike.%${termo}%,telefone.ilike.%${termo}%`);
  }

  const { data: clientes, error: erroClientes } = await consulta;
  if (erroClientes) {
    console.error("Erro ao listar clientes:", erroClientes);
    return res.status(500).json({ erro: "Erro ao carregar clientes." });
  }

  const ids = (clientes || []).map((cliente) => cliente.id);
  if (!ids.length) return res.json({ ok: true, clientes: [] });

  const { data: agendamentos, error: erroAgendamentos } = await supabase
    .from("agendamentos")
    .select("cliente_id, data_hora, valor, status")
    .eq("salao_id", req.salao.id)
    .in("cliente_id", ids);
  if (erroAgendamentos) {
    console.error("Erro ao calcular indicadores dos clientes:", erroAgendamentos);
    return res.status(500).json({ erro: "Erro ao carregar histórico dos clientes." });
  }

  let resultado = resumirClientes(clientes || [], agendamentos || []);
  if (filtro === "inativos") resultado = resultado.filter((cliente) => cliente.inativa);
  res.json({ ok: true, clientes: resultado });
});

router.get("/exportar", requireAuth, async (req, res) => {
  const { data: clientes, error } = await supabase
    .from("clientes")
    .select("nome, telefone, aniversario_dia, aniversario_mes, tags")
    .eq("salao_id", req.salao.id)
    .order("nome");
  if (error) return res.status(500).json({ erro: "Erro ao exportar clientes." });

  const protegerCsv = (valor) => {
    const texto = String(valor ?? "");
    const seguro = /^[=+\-@]/.test(texto) ? `'${texto}` : texto;
    return `"${seguro.replaceAll('"', '""')}"`;
  };
  const linhas = [
    ["Nome", "WhatsApp", "Aniversário", "Tags"],
    ...(clientes || []).map((cliente) => [
      cliente.nome,
      cliente.telefone,
      cliente.aniversario_dia && cliente.aniversario_mes ? `${String(cliente.aniversario_dia).padStart(2, "0")}/${String(cliente.aniversario_mes).padStart(2, "0")}` : "",
      (cliente.tags || []).join(", "),
    ]),
  ];
  res.setHeader("Content-Type", "text/csv; charset=utf-8");
  res.setHeader("Content-Disposition", 'attachment; filename="clientes-salonia.csv"');
  res.send(`\ufeff${linhas.map((linha) => linha.map(protegerCsv).join(";")).join("\n")}`);
});

router.get("/:id", requireAuth, async (req, res) => {
  const { data: cliente, error: erroCliente } = await supabase
    .from("clientes")
    .select(CAMPOS_CLIENTE)
    .eq("id", req.params.id)
    .eq("salao_id", req.salao.id)
    .maybeSingle();
  if (erroCliente || !cliente) return res.status(404).json({ erro: "Cliente não encontrada." });

  const { data: agendamentos, error: erroAgendamentos } = await supabase
    .from("agendamentos")
    .select("id, data_hora, duracao_minutos, valor, status, servicos(nome), profissionais(nome)")
    .eq("cliente_id", cliente.id)
    .eq("salao_id", req.salao.id)
    .order("data_hora", { ascending: false });
  if (erroAgendamentos) return res.status(500).json({ erro: "Erro ao carregar histórico." });

  const [resumo] = resumirClientes([cliente], (agendamentos || []).map((agendamento) => ({ ...agendamento, cliente_id: cliente.id })));
  res.json({ ok: true, cliente: resumo, agendamentos: agendamentos || [] });
});

router.post("/", requireAuth, async (req, res) => {
  const dados = validarCliente(req.body?.nome, req.body?.telefone);
  if (dados.erro) return res.status(400).json({ erro: dados.erro });
  const dadosInternos = dadosInternosDoCorpo(req.body);
  if (dadosInternos.erro) return res.status(400).json({ erro: dadosInternos.erro });

  const { data, error } = await supabase
    .from("clientes")
    .insert({ salao_id: req.salao.id, nome: dados.nomeLimpo, telefone: dados.telefoneLimpo, ...dadosInternos })
    .select(CAMPOS_CLIENTE)
    .single();
  if (error) {
    if (error.code === "23505") return res.status(409).json({ erro: "Já existe uma cliente com este WhatsApp." });
    console.error("Erro ao criar cliente:", error);
    return res.status(500).json({ erro: "Erro ao cadastrar cliente." });
  }
  res.status(201).json({ ok: true, cliente: data });
});

router.put("/:id", requireAuth, async (req, res) => {
  const dados = validarCliente(req.body?.nome, req.body?.telefone);
  if (dados.erro) return res.status(400).json({ erro: dados.erro });
  const dadosInternos = dadosInternosDoCorpo(req.body);
  if (dadosInternos.erro) return res.status(400).json({ erro: dadosInternos.erro });

  const { data, error } = await supabase
    .from("clientes")
    .update({ nome: dados.nomeLimpo, telefone: dados.telefoneLimpo, ...dadosInternos })
    .eq("id", req.params.id)
    .eq("salao_id", req.salao.id)
    .select(CAMPOS_CLIENTE)
    .maybeSingle();
  if (error) {
    if (error.code === "23505") return res.status(409).json({ erro: "Já existe uma cliente com este WhatsApp." });
    console.error("Erro ao atualizar cliente:", error);
    return res.status(500).json({ erro: "Erro ao atualizar cliente." });
  }
  if (!data) return res.status(404).json({ erro: "Cliente não encontrada." });
  res.json({ ok: true, cliente: data });
});

router.post("/:id/mesclar", requireAuth, async (req, res) => {
  const destinoId = String(req.body?.destino_id || "");
  if (!destinoId || destinoId === req.params.id) {
    return res.status(400).json({ erro: "Escolha outra cliente para receber o histórico." });
  }

  const { data: registros, error: erroRegistros } = await supabase
    .from("clientes")
    .select(CAMPOS_CLIENTE)
    .eq("salao_id", req.salao.id)
    .in("id", [req.params.id, destinoId]);
  if (erroRegistros || registros?.length !== 2) {
    return res.status(404).json({ erro: "Não foi possível localizar as duas clientes." });
  }

  const origem = registros.find((cliente) => cliente.id === req.params.id);
  const destino = registros.find((cliente) => cliente.id === destinoId);
  const camposMesclados = {
    aniversario_dia: destino.aniversario_dia || origem.aniversario_dia || null,
    aniversario_mes: destino.aniversario_mes || origem.aniversario_mes || null,
    observacoes: destino.observacoes || origem.observacoes || null,
    preferencias: destino.preferencias || origem.preferencias || null,
    alergias: destino.alergias || origem.alergias || null,
    consentimento_alergias: Boolean(destino.alergias ? destino.consentimento_alergias : origem.consentimento_alergias),
    consentimento_alergias_em: destino.consentimento_alergias_em || origem.consentimento_alergias_em || null,
    tags: [...new Set([...(destino.tags || []), ...(origem.tags || [])])],
  };

  const { error: erroDestino } = await supabase
    .from("clientes")
    .update(camposMesclados)
    .eq("id", destino.id)
    .eq("salao_id", req.salao.id);
  if (erroDestino) return res.status(500).json({ erro: "Erro ao preparar a mesclagem." });

  const { error: erroHistorico } = await supabase
    .from("agendamentos")
    .update({ cliente_id: destino.id })
    .eq("cliente_id", origem.id)
    .eq("salao_id", req.salao.id);
  if (erroHistorico) return res.status(500).json({ erro: "Erro ao transferir o histórico." });

  const { error: erroExcluir } = await supabase
    .from("clientes")
    .delete()
    .eq("id", origem.id)
    .eq("salao_id", req.salao.id);
  if (erroExcluir) return res.status(500).json({ erro: "O histórico foi transferido, mas não foi possível remover o cadastro duplicado." });

  res.json({ ok: true, cliente_id: destino.id });
});

export default router;

import express from "express";
import multer from "multer";
import { supabase } from "../config/supabase.js";
import { notificarSalao } from "../lib/pushNotificacoes.js";

const router = express.Router();

const STATUS_AGUARDANDO_PAGAMENTO = "aguardando_pagamento";
const STATUS_AGUARDANDO_CONFIRMACAO = "aguardando_confirmacao";
const FUSO_HORARIO_SALAO = "America/Sao_Paulo";
const BUCKET_REFERENCIAS = "referencias";
const JANELA_LIMITE_MS = 10 * 60 * 1000;
const tentativasPorIp = new Map();
const TIPOS_IMAGEM_PERMITIDOS = new Set(["image/jpeg", "image/png", "image/webp"]);

const uploadReferencia = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 5 * 1024 * 1024 },
  fileFilter: (req, arquivo, callback) => {
    if (!TIPOS_IMAGEM_PERMITIDOS.has(arquivo.mimetype)) {
      return callback(new Error("Envie uma imagem JPG, PNG ou WebP."));
    }
    callback(null, true);
  },
});

function normalizarTelefone(telefone) {
  return String(telefone || "").replace(/\D/g, "");
}

function horarioNoFuso(data) {
  const partes = new Intl.DateTimeFormat("en-US", {
    timeZone: FUSO_HORARIO_SALAO,
    weekday: "short",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).formatToParts(data);

  const valor = (tipo) => partes.find((parte) => parte.type === tipo)?.value;
  const dias = { Sun: "0", Mon: "1", Tue: "2", Wed: "3", Thu: "4", Fri: "5", Sat: "6" };

  return {
    diaSemana: dias[valor("weekday")],
    hora: `${valor("hour")}:${valor("minute")}`,
  };
}

function identificarIp(req) {
  const encaminhado = req.headers["x-forwarded-for"];
  if (typeof encaminhado === "string") return encaminhado.split(",")[0].trim();
  return req.ip || req.socket.remoteAddress || "desconhecido";
}

function limitarTentativas(limite) {
  return (req, res, next) => {
    const agora = Date.now();
    const chave = `${req.path}:${identificarIp(req)}`;
    const atual = tentativasPorIp.get(chave);
    const dentroDaJanela = atual && agora - atual.inicio < JANELA_LIMITE_MS;
    const registro = dentroDaJanela ? atual : { inicio: agora, quantidade: 0 };

    registro.quantidade += 1;
    tentativasPorIp.set(chave, registro);

    if (registro.quantidade > limite) {
      const segundosRestantes = Math.ceil((JANELA_LIMITE_MS - (agora - registro.inicio)) / 1000);
      res.set("Retry-After", String(segundosRestantes));
      return res.status(429).json({
        erro: "Muitas tentativas. Aguarde alguns minutos antes de tentar novamente.",
      });
    }

    next();
  };
}

router.post("/", limitarTentativas(10), async (req, res) => {
  const {
    salao_id,
    nome,
    telefone,
    profissional_id,
    servico_id,
    data_hora,
  } = req.body;

  if (!salao_id || !nome || !telefone || !profissional_id || !servico_id || !data_hora) {
    return res.status(400).json({ erro: "Dados incompletos." });
  }

  const nomeLimpo = String(nome).trim().replace(/\s+/g, " ");
  const telefoneLimpo = normalizarTelefone(telefone);
  const dataHora = new Date(data_hora);

  if (nomeLimpo.length < 2 || nomeLimpo.length > 120) {
    return res.status(400).json({ erro: "Informe um nome válido." });
  }

  if (telefoneLimpo.length < 10 || telefoneLimpo.length > 11) {
    return res.status(400).json({ erro: "Informe um WhatsApp válido com DDD." });
  }

  if (Number.isNaN(dataHora.getTime()) || dataHora <= new Date()) {
    return res.status(400).json({ erro: "Escolha um horário futuro válido." });
  }

  try {
    // O navegador só informa quais itens escolheu. Preço, duração e status
    // são sempre derivados dos dados oficiais do salão para evitar adulteração.
    const [{ data: salao, error: erroSalao }, { data: servico, error: erroServico }, { data: profissional, error: erroProfissional }] = await Promise.all([
      supabase
        .from("saloes")
        .select("id, ativo")
        .eq("id", salao_id)
        .maybeSingle(),
      supabase
        .from("servicos")
        .select("id, duracao_minutos, preco, cobra_sinal")
        .eq("id", servico_id)
        .eq("salao_id", salao_id)
        .eq("ativo", true)
        .maybeSingle(),
      supabase
        .from("profissionais")
        .select("id, horarios_disponiveis")
        .eq("id", profissional_id)
        .eq("salao_id", salao_id)
        .eq("ativo", true)
        .maybeSingle(),
    ]);

    if (erroSalao || erroServico || erroProfissional) {
      console.error("Erro ao validar agendamento:", { erroSalao, erroServico, erroProfissional });
      return res.status(500).json({ erro: "Erro ao validar o agendamento." });
    }

    if (!salao?.ativo) {
      return res.status(404).json({ erro: "Este salão não está aceitando agendamentos." });
    }

    if (!servico || !profissional) {
      return res.status(400).json({ erro: "Serviço ou profissional indisponível." });
    }

    const { data: vinculo, error: erroVinculo } = await supabase
      .from("profissional_servicos")
      .select("profissional_id")
      .eq("profissional_id", profissional.id)
      .eq("servico_id", servico.id)
      .maybeSingle();

    if (erroVinculo) {
      console.error("Erro ao validar serviço do profissional:", erroVinculo);
      return res.status(500).json({ erro: "Erro ao validar o agendamento." });
    }

    if (!vinculo) {
      return res.status(400).json({ erro: "Esta profissional não realiza o serviço selecionado." });
    }

    const { diaSemana, hora } = horarioNoFuso(dataHora);
    const horariosDoDia =
      profissional.horarios_disponiveis?.[diaSemana] ??
      profissional.horarios_disponiveis?.[Number(diaSemana)] ??
      [];

    if (!Array.isArray(horariosDoDia) || !horariosDoDia.includes(hora)) {
      return res.status(400).json({ erro: "O horário selecionado não está mais disponível." });
    }

    const duracaoMinutos = Number(servico.duracao_minutos);
    const valor = Number(servico.preco);
    if (!Number.isFinite(duracaoMinutos) || duracaoMinutos <= 0 || !Number.isFinite(valor) || valor < 0) {
      console.error("Serviço com dados inválidos:", servico.id);
      return res.status(500).json({ erro: "O serviço selecionado está configurado incorretamente." });
    }

    const status = servico.cobra_sinal === false
      ? STATUS_AGUARDANDO_CONFIRMACAO
      : STATUS_AGUARDANDO_PAGAMENTO;

    // busca ou cria cliente
    let clienteId;
    const { data: existente, error: erroSelect } = await supabase
      .from("clientes")
      .select("id")
      .eq("salao_id", salao_id)
      .eq("telefone", telefoneLimpo)
      .maybeSingle();

    if (erroSelect) {
      console.error("Erro ao buscar cliente:", erroSelect);
      return res.status(500).json({ erro: "Erro ao verificar dados do cliente." });
    }

    if (existente) {
      clienteId = existente.id;
    } else {
      const { data: novo, error: erroInsert } = await supabase
        .from("clientes")
        .insert({ salao_id, nome: nomeLimpo, telefone: telefoneLimpo })
        .select("id")
        .single();

      if (erroInsert) {
        console.error("Erro ao criar cliente:", erroInsert);
        return res.status(500).json({ erro: "Erro ao salvar dados do cliente." });
      }
      clienteId = novo.id;
    }

    // agendamento atômico via RPC (evita race condition)
    const { data: resultado, error: erroRpc } = await supabase.rpc("agendar_horario", {
      p_salao_id: salao_id,
      p_cliente_id: clienteId,
      p_profissional_id: profissional_id,
      p_servico_id: servico_id,
      p_data_hora: dataHora.toISOString(),
      p_duracao_minutos: duracaoMinutos,
      p_valor: valor,
      p_status: status
    });

    if (erroRpc) {
      console.error("Erro na RPC:", erroRpc);
      return res.status(500).json({ erro: "Erro ao confirmar agendamento." });
    }

    if (!resultado?.ok) {
      return res.status(400).json({ erro: resultado?.erro || "Horário indisponível." });
    }

    // Dispara em segundo plano — não trava a resposta do agendamento caso
    // o envio da notificação demore ou falhe.
    notificarSalao(salao_id, {
      titulo: "Novo agendamento",
      corpo: `${nomeLimpo} marcou um horário.`,
      url: "/admin",
    }).catch((err) => console.error("Erro ao notificar novo agendamento:", err));

    res.json({ ok: true, agendamento_id: resultado.agendamento_id });

  } catch (err) {
    console.error("Erro inesperado:", err);
    res.status(500).json({ erro: "Erro interno. Tente novamente." });
  }
});

// A foto de referência é enviada pela API, e não diretamente pelo navegador
// ao Storage. Isso evita conceder escrita pública no bucket de referências.
router.post("/:id/referencia", limitarTentativas(20), (req, res) => {
  uploadReferencia.single("arquivo")(req, res, async (erroUpload) => {
    if (erroUpload) {
      return res.status(400).json({ erro: erroUpload.message });
    }
    if (!req.file) {
      return res.status(400).json({ erro: "Nenhuma imagem foi enviada." });
    }

    const telefoneLimpo = normalizarTelefone(req.body?.telefone);
    if (telefoneLimpo.length < 10 || telefoneLimpo.length > 11) {
      return res.status(400).json({ erro: "Informe o WhatsApp usado no agendamento." });
    }

    try {
      const { data: agendamento, error: erroAgendamento } = await supabase
        .from("agendamentos")
        .select("id, salao_id, clientes(telefone)")
        .eq("id", req.params.id)
        .maybeSingle();

      if (erroAgendamento) {
        console.error("Erro ao validar foto de referência:", erroAgendamento);
        return res.status(500).json({ erro: "Erro ao validar o agendamento." });
      }

      if (!agendamento || normalizarTelefone(agendamento.clientes?.telefone) !== telefoneLimpo) {
        return res.status(404).json({ erro: "Agendamento não encontrado." });
      }

      const extensao = (req.file.originalname.split(".").pop() || "jpg")
        .toLowerCase()
        .replace(/[^a-z0-9]/g, "") || "jpg";
      const caminho = `${agendamento.salao_id}/${agendamento.id}-${Date.now()}.${extensao}`;

      const { error: erroStorage } = await supabase.storage
        .from(BUCKET_REFERENCIAS)
        .upload(caminho, req.file.buffer, { contentType: req.file.mimetype });

      if (erroStorage) {
        console.error("Erro ao enviar foto de referência:", erroStorage);
        return res.status(500).json({ erro: "Erro ao enviar a imagem." });
      }

      const { error: erroAtualizacao } = await supabase
        .from("agendamentos")
        .update({ foto_referencia_url: caminho })
        .eq("id", agendamento.id)
        .eq("salao_id", agendamento.salao_id);

      if (erroAtualizacao) {
        console.error("Erro ao vincular foto de referência:", erroAtualizacao);
        return res.status(500).json({ erro: "A imagem foi enviada, mas não pôde ser vinculada." });
      }

      res.json({ ok: true });
    } catch (erro) {
      console.error("Erro inesperado ao enviar foto de referência:", erro);
      res.status(500).json({ erro: "Erro interno ao enviar a imagem." });
    }
  });
});

export default router;

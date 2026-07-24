import express from "express";
import { supabase } from "../config/supabase.js";
import { requireAuth } from "../middlewares/requireAuth.js";

const router = express.Router();

// TODO: confirmar com a RPC `agendar_horario` os valores exatos que ela usa
// pra status. Por enquanto assumimos esse conjunto — se for diferente, é só
// ajustar essa lista (e os <option> correspondentes no admin/index.html).
const STATUS_VALIDOS = [
  "aguardando_pagamento",
  "aguardando_confirmacao",
  "confirmado",
  "concluido",
  "cancelado",
];

const STATUS_INICIAIS_VALIDOS = [
  "aguardando_pagamento",
  "aguardando_confirmacao",
  "confirmado",
];

const SELECT_AGENDAMENTO =
  "id, cliente_id, servico_id, profissional_id, data_hora, duracao_minutos, valor, status, comprovante_url, foto_referencia_url, criado_em, clientes(nome, telefone), servicos(nome), profissionais(nome)";

function normalizarTelefone(telefone) {
  return String(telefone || "").replace(/\D/g, "");
}

function horarioNoFuso(data) {
  const partes = new Intl.DateTimeFormat("en-US", {
    timeZone: "America/Sao_Paulo",
    weekday: "short",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).formatToParts(data);
  const valor = (tipo) => partes.find((parte) => parte.type === tipo)?.value;
  const dias = { Sun: "0", Mon: "1", Tue: "2", Wed: "3", Thu: "4", Fri: "5", Sat: "6" };

  return { diaSemana: dias[valor("weekday")], hora: `${valor("hour")}:${valor("minute")}` };
}

router.post("/", requireAuth, async (req, res) => {
  const { nome, telefone, profissional_id, servico_id, data_hora, status } = req.body || {};
  const nomeLimpo = String(nome || "").trim().replace(/\s+/g, " ");
  const telefoneLimpo = normalizarTelefone(telefone);
  const dataHora = new Date(data_hora);
  const statusFinal = status || "confirmado";

  if (!nomeLimpo || !telefoneLimpo || !profissional_id || !servico_id || !data_hora) {
    return res.status(400).json({ erro: "Preencha cliente, serviço, profissional, data e horário." });
  }
  if (nomeLimpo.length < 2 || nomeLimpo.length > 120 || telefoneLimpo.length < 10 || telefoneLimpo.length > 11) {
    return res.status(400).json({ erro: "Informe nome e WhatsApp válidos." });
  }
  if (Number.isNaN(dataHora.getTime())) {
    return res.status(400).json({ erro: "Informe uma data e horário válidos." });
  }
  if (!STATUS_INICIAIS_VALIDOS.includes(statusFinal)) {
    return res.status(400).json({ erro: "Status inválido para criar o agendamento." });
  }

  try {
    const [{ data: servico, error: erroServico }, { data: profissional, error: erroProfissional }] = await Promise.all([
      supabase
        .from("servicos")
        .select("id, duracao_minutos, preco")
        .eq("id", servico_id)
        .eq("salao_id", req.salao.id)
        .eq("ativo", true)
        .maybeSingle(),
      supabase
        .from("profissionais")
        .select("id, horarios_disponiveis")
        .eq("id", profissional_id)
        .eq("salao_id", req.salao.id)
        .eq("ativo", true)
        .maybeSingle(),
    ]);

    if (erroServico || erroProfissional) {
      console.error("Erro ao validar agendamento administrativo:", { erroServico, erroProfissional });
      return res.status(500).json({ erro: "Erro ao validar o agendamento." });
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
    if (erroVinculo || !vinculo) {
      return res.status(400).json({ erro: "Esta profissional não realiza o serviço selecionado." });
    }

    const { diaSemana, hora } = horarioNoFuso(dataHora);
    const horariosDoDia = profissional.horarios_disponiveis?.[diaSemana] ?? [];
    if (!Array.isArray(horariosDoDia) || !horariosDoDia.includes(hora)) {
      return res.status(400).json({ erro: "A profissional não atende nesse horário." });
    }

    let clienteId;
    const { data: clienteExistente, error: erroCliente } = await supabase
      .from("clientes")
      .select("id")
      .eq("salao_id", req.salao.id)
      .eq("telefone", telefoneLimpo)
      .maybeSingle();
    if (erroCliente) throw erroCliente;

    if (clienteExistente) {
      clienteId = clienteExistente.id;
    } else {
      const { data: novoCliente, error: erroNovoCliente } = await supabase
        .from("clientes")
        .insert({ salao_id: req.salao.id, nome: nomeLimpo, telefone: telefoneLimpo })
        .select("id")
        .single();
      if (erroNovoCliente) throw erroNovoCliente;
      clienteId = novoCliente.id;
    }

    const { data: resultado, error: erroRpc } = await supabase.rpc("agendar_horario", {
      p_salao_id: req.salao.id,
      p_cliente_id: clienteId,
      p_profissional_id: profissional.id,
      p_servico_id: servico.id,
      p_data_hora: dataHora.toISOString(),
      p_duracao_minutos: Number(servico.duracao_minutos),
      p_valor: Number(servico.preco),
      p_status: statusFinal,
    });
    if (erroRpc) {
      console.error("Erro na RPC de agendamento administrativo:", erroRpc);
      return res.status(500).json({ erro: "Erro ao criar o agendamento." });
    }
    if (!resultado?.ok) {
      return res.status(409).json({ erro: resultado?.erro || "Horário indisponível." });
    }

    res.status(201).json({ ok: true, agendamento_id: resultado.agendamento_id });
  } catch (erro) {
    console.error("Erro ao criar agendamento administrativo:", erro);
    res.status(500).json({ erro: "Erro interno ao criar o agendamento." });
  }
});

router.put("/:id/reagendar", requireAuth, async (req, res) => {
  const { profissional_id, servico_id, data_hora } = req.body || {};
  const dataHora = new Date(data_hora);

  if (!profissional_id || !servico_id || !data_hora || Number.isNaN(dataHora.getTime())) {
    return res.status(400).json({ erro: "Informe serviço, profissional, data e horário válidos." });
  }

  const { data: resultado, error } = await supabase.rpc("reagendar_horario", {
    p_salao_id: req.salao.id,
    p_agendamento_id: req.params.id,
    p_profissional_id: profissional_id,
    p_servico_id: servico_id,
    p_data_hora: dataHora.toISOString(),
  });

  if (error) {
    console.error("Erro ao reagendar:", error);
    return res.status(500).json({ erro: "Erro ao reagendar o atendimento." });
  }
  if (!resultado?.ok) {
    return res.status(409).json({ erro: resultado?.erro || "Horário indisponível." });
  }

  res.json({ ok: true });
});

router.get("/bloqueios", requireAuth, async (req, res) => {
  const { inicio, fim } = req.query;
  let query = supabase
    .from("bloqueios_agenda")
    .select("id, profissional_id, inicio, fim, motivo, profissionais(nome)")
    .eq("salao_id", req.salao.id)
    .order("inicio", { ascending: true });

  if (inicio) query = query.lt("inicio", fim || "9999-12-31T23:59:59Z");
  if (fim) query = query.gt("fim", inicio || "1970-01-01T00:00:00Z");

  const { data, error } = await query;
  if (error) {
    console.error("Erro ao listar bloqueios:", error);
    return res.status(500).json({ erro: "Erro ao carregar os bloqueios." });
  }
  res.json({ ok: true, bloqueios: data || [] });
});

router.post("/bloqueios", requireAuth, async (req, res) => {
  const { profissional_id, inicio, fim, motivo } = req.body || {};
  const inicioData = new Date(inicio);
  const fimData = new Date(fim);

  if (Number.isNaN(inicioData.getTime()) || Number.isNaN(fimData.getTime()) || fimData <= inicioData) {
    return res.status(400).json({ erro: "Informe um período de bloqueio válido." });
  }

  if (profissional_id) {
    const { data: profissional, error: erroProfissional } = await supabase
      .from("profissionais")
      .select("id")
      .eq("id", profissional_id)
      .eq("salao_id", req.salao.id)
      .maybeSingle();
    if (erroProfissional || !profissional) {
      return res.status(400).json({ erro: "Profissional inválida." });
    }
  }

  const { data, error } = await supabase
    .from("bloqueios_agenda")
    .insert({
      salao_id: req.salao.id,
      profissional_id: profissional_id || null,
      inicio: inicioData.toISOString(),
      fim: fimData.toISOString(),
      motivo: String(motivo || "").trim() || null,
    })
    .select("id")
    .single();

  if (error) {
    console.error("Erro ao criar bloqueio:", error);
    return res.status(500).json({ erro: "Erro ao salvar o bloqueio." });
  }
  res.status(201).json({ ok: true, bloqueio_id: data.id });
});

router.delete("/bloqueios/:id", requireAuth, async (req, res) => {
  const { error } = await supabase
    .from("bloqueios_agenda")
    .delete()
    .eq("id", req.params.id)
    .eq("salao_id", req.salao.id);

  if (error) {
    console.error("Erro ao excluir bloqueio:", error);
    return res.status(500).json({ erro: "Erro ao remover o bloqueio." });
  }
  res.json({ ok: true });
});

router.get("/", requireAuth, async (req, res) => {
  const { data: dataFiltro, status, profissional_id: profissionalId } = req.query;

  const dia = dataFiltro || new Date().toISOString().slice(0, 10);
  const inicio = `${dia}T00:00:00`;
  const fim = `${dia}T23:59:59`;

  let query = supabase
    .from("agendamentos")
    .select(SELECT_AGENDAMENTO)
    .eq("salao_id", req.salao.id)
    .gte("data_hora", inicio)
    .lte("data_hora", fim)
    .order("data_hora", { ascending: true });

  if (status) {
  query = query.eq("status", status);
} else {
  query = query.neq("status", "cancelado");
}

  if (profissionalId) {
    query = query.eq("profissional_id", profissionalId);
  }

  const { data, error } = await query;

  if (error) {
    console.error("Erro ao listar agendamentos:", error);
    return res.status(500).json({ erro: "Erro ao carregar agendamentos." });
  }

  res.json({ ok: true, agendamentos: data });
});

router.put("/:id/status", requireAuth, async (req, res) => {
  const { status } = req.body;

  if (!STATUS_VALIDOS.includes(status)) {
    return res.status(400).json({ erro: "Status inválido." });
  }

  const { data, error } = await supabase
    .from("agendamentos")
    .update({ status })
    .eq("id", req.params.id)
    .eq("salao_id", req.salao.id) // garante que só mexe em agendamento do próprio salão
    .select(SELECT_AGENDAMENTO)
    .maybeSingle();

  if (error) {
    console.error("Erro ao atualizar status do agendamento:", error);
    return res.status(500).json({ erro: "Erro ao atualizar o agendamento." });
  }
  if (!data) {
    return res.status(404).json({ erro: "Agendamento não encontrado." });
  }

  res.json({ ok: true, agendamento: data });
});

// Entrega uma URL temporária da foto somente para a dona do salão daquele
// agendamento. Registros antigos com URL pública continuam acessíveis até
// serem migrados, sem impedir a transição para o bucket privado.
router.get("/:id/referencia", requireAuth, async (req, res) => {
  const { data: agendamento, error } = await supabase
    .from("agendamentos")
    .select("foto_referencia_url")
    .eq("id", req.params.id)
    .eq("salao_id", req.salao.id)
    .maybeSingle();

  if (error) {
    console.error("Erro ao buscar foto de referência:", error);
    return res.status(500).json({ erro: "Erro ao buscar a foto de referência." });
  }
  if (!agendamento?.foto_referencia_url) {
    return res.status(404).json({ erro: "Foto de referência não encontrada." });
  }

  const referencia = agendamento.foto_referencia_url;
  if (/^https?:\/\//i.test(referencia)) {
    return res.redirect(referencia);
  }

  const { data: assinada, error: erroAssinada } = await supabase.storage
    .from("referencias")
    .createSignedUrl(referencia, 60 * 5);

  if (erroAssinada || !assinada?.signedUrl) {
    console.error("Erro ao assinar foto de referência:", erroAssinada);
    return res.status(500).json({ erro: "Erro ao abrir a foto de referência." });
  }

  res.redirect(assinada.signedUrl);
});

// O comprovante também fica privado; a dona vê apenas por uma URL temporária.
router.get("/:id/comprovante", requireAuth, async (req, res) => {
  const { data: agendamento, error } = await supabase
    .from("agendamentos")
    .select("comprovante_url")
    .eq("id", req.params.id)
    .eq("salao_id", req.salao.id)
    .maybeSingle();
  if (error) return res.status(500).json({ erro: "Erro ao buscar o comprovante." });
  if (!agendamento?.comprovante_url) return res.status(404).json({ erro: "Comprovante não encontrado." });

  const comprovante = agendamento.comprovante_url;
  if (/^https?:\/\//i.test(comprovante)) return res.redirect(comprovante);
  const { data: assinada, error: erroAssinada } = await supabase.storage
    .from("comprovantes")
    .createSignedUrl(comprovante, 60 * 5);
  if (erroAssinada || !assinada?.signedUrl) {
    console.error("Erro ao assinar comprovante:", erroAssinada);
    return res.status(500).json({ erro: "Erro ao abrir o comprovante." });
  }
  res.redirect(assinada.signedUrl);
});

export default router;

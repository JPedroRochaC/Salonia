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

const SELECT_AGENDAMENTO =
  "id, data_hora, duracao_minutos, valor, status, comprovante_url, foto_referencia_url, criado_em, clientes(nome, telefone), servicos(nome), profissionais(nome)";

router.get("/", requireAuth, async (req, res) => {
  const { data: dataFiltro, status } = req.query;

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

export default router;

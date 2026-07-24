import express from "express";
import { supabase } from "../config/supabase.js";
import { requireAuth } from "../middlewares/requireAuth.js";

const router = express.Router();

// TODO: confirmar com a RPC `agendar_horario` quais são todos os valores
// possíveis de `agendamentos.status`. Por enquanto, consideramos "faturamento"
// só os agendamentos com esses status (ajustar assim que soubermos o enum real).
const STATUS_QUE_CONTAM_COMO_FATURAMENTO = ["confirmado", "concluido"];

router.get("/", requireAuth, async (req, res) => {
  const salaoId = req.salao.id;

  const hoje = new Date();
  const inicioMes = new Date(hoje.getFullYear(), hoje.getMonth(), 1);
  const inicioMesISO = inicioMes.toISOString();

  const { data: agendamentosMes, error } = await supabase
    .from("agendamentos")
    .select("valor, status, data_hora")
    .eq("salao_id", salaoId)
    .gte("data_hora", inicioMesISO);

  if (error) {
    console.error("Erro ao buscar dashboard:", error);
    return res.status(500).json({ erro: "Erro ao calcular o dashboard." });
  }

  const lista = agendamentosMes || [];

  const faturamentoMes = lista
    .filter((a) => STATUS_QUE_CONTAM_COMO_FATURAMENTO.includes(a.status))
    .reduce((soma, a) => soma + Number(a.valor || 0), 0);

  const confirmadosMes = lista.filter((a) =>
    STATUS_QUE_CONTAM_COMO_FATURAMENTO.includes(a.status),
  ).length;

  // Total de agendamentos do mês: conta todos, exceto os cancelados.
  const totalAgendamentosMes = lista.filter(
    (a) => a.status !== "cancelado",
  ).length;

  // Agendamentos de hoje: mesmo critério (todos, exceto cancelados),
  // filtrando pela data de hoje dentro da lista já buscada do mês.
  const inicioHoje = new Date(hoje.getFullYear(), hoje.getMonth(), hoje.getDate());
  const fimHoje = new Date(inicioHoje);
  fimHoje.setDate(fimHoje.getDate() + 1);

  const agendamentosHoje = lista.filter((a) => {
    if (a.status === "cancelado") return false;
    const dataAgendamento = new Date(a.data_hora);
    return dataAgendamento >= inicioHoje && dataAgendamento < fimHoje;
  }).length;

  const ticketMedio =
    confirmadosMes > 0 ? faturamentoMes / confirmadosMes : 0;

  // próximos agendamentos (hoje em diante), pra mostrar uma lista rápida
  // Regras de exibição:
  // 1. Cancelado nunca aparece nessa lista.
  // 2. Ordena por data/hora mais próxima primeiro.
  // 3. Em caso de empate no mesmo horário, confirmado/concluído aparece
  //    antes de aguardando pagamento/confirmação.
  const PRIORIDADE_STATUS = {
    confirmado: 0,
    concluido: 0,
    aguardando_pagamento: 1,
    aguardando_confirmacao: 1,
  };

  const agora = new Date().toISOString();
  const { data: proximosBrutos, error: erroProximos } = await supabase
    .from("agendamentos")
    .select(
      "id, data_hora, valor, status, foto_referencia_url, comprovante_url, clientes(nome, telefone), servicos(nome), profissionais(nome)",
    )
    .eq("salao_id", salaoId)
    .gte("data_hora", agora)
    .neq("status", "cancelado")
    .order("data_hora", { ascending: true })
    .limit(20);

  if (erroProximos) {
    console.error("Erro ao buscar próximos agendamentos:", erroProximos);
  }

  const proximos = (proximosBrutos || [])
    .sort((a, b) => {
      const diffData = new Date(a.data_hora) - new Date(b.data_hora);
      if (diffData !== 0) return diffData;
      return (PRIORIDADE_STATUS[a.status] ?? 2) - (PRIORIDADE_STATUS[b.status] ?? 2);
    })
    .slice(0, 5);

  res.json({
    ok: true,
    faturamentoMes,
    totalAgendamentosMes,
    agendamentosHoje,
    confirmadosMes,
    ticketMedio,
    proximosAgendamentos: proximos || [],
  });
});

export default router;
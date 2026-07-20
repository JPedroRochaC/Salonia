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

  const totalAgendamentosMes = lista.length;
  const confirmadosMes = lista.filter((a) =>
    STATUS_QUE_CONTAM_COMO_FATURAMENTO.includes(a.status),
  ).length;

  const ticketMedio =
    confirmadosMes > 0 ? faturamentoMes / confirmadosMes : 0;

  // próximos agendamentos (hoje em diante), pra mostrar uma lista rápida
  const agora = new Date().toISOString();
  const { data: proximos, error: erroProximos } = await supabase
    .from("agendamentos")
    .select(
      "id, data_hora, valor, status, clientes(nome), servicos(nome), profissionais(nome)",
    )
    .eq("salao_id", salaoId)
    .gte("data_hora", agora)
    .order("data_hora", { ascending: true })
    .limit(5);

  if (erroProximos) {
    console.error("Erro ao buscar próximos agendamentos:", erroProximos);
  }

  res.json({
    ok: true,
    faturamentoMes,
    totalAgendamentosMes,
    confirmadosMes,
    ticketMedio,
    proximosAgendamentos: proximos || [],
  });
});

export default router;
import express from "express";
import { supabase } from "../config/supabase.js";
import { notificarSalao } from "../lib/pushNotificacoes.js";

const router = express.Router();

router.post("/", async (req, res) => {
  const {
    salao_id,
    nome,
    telefone,
    profissional_id,
    servico_id,
    data_hora,
    duracao_minutos,
    valor,
    status
  } = req.body;

  if (!salao_id || !nome || !telefone || !profissional_id || !servico_id || !data_hora) {
    return res.status(400).json({ erro: "Dados incompletos." });
  }

  try {
    // busca ou cria cliente
    let clienteId;
    const { data: existente, error: erroSelect } = await supabase
      .from("clientes")
      .select("id")
      .eq("salao_id", salao_id)
      .eq("telefone", telefone)
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
        .insert({ salao_id, nome, telefone })
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
      p_data_hora: data_hora,
      p_duracao_minutos: duracao_minutos,
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
      corpo: `${nome} marcou um horário.`,
      url: "/admin",
    }).catch((err) => console.error("Erro ao notificar novo agendamento:", err));

    res.json({ ok: true, agendamento_id: resultado.agendamento_id });

  } catch (err) {
    console.error("Erro inesperado:", err);
    res.status(500).json({ erro: "Erro interno. Tente novamente." });
  }
});

export default router;
import express from "express";
import { supabase } from "../config/supabase.js";
import { requireAuth } from "../middlewares/requireAuth.js";

const router = express.Router();

// Campos que a própria dona do salão pode editar pelo admin.
// De propósito NÃO incluídos aqui: id, auth_user_id, slug, plano, trial_fim,
// criado_em — esses são geridos por vocês (Salonnia), não pela cliente.
const CAMPOS_EDITAVEIS = [
  "nome",
  "telefone",
  "endereco",
  "logo_url",
  "redes_sociais",
  "dias_funcionamento",
  "horario_abertura",
  "horario_fechamento",
  "horarios_excecao",
  "exige_sinal",
  "tipo_sinal",
  "valor_sinal",
  "chave_pix",
  "cor_destaque",
  "cor_fundo",
  "ativo",
];

router.get("/", requireAuth, (req, res) => {
  res.json({ ok: true, salao: req.salao });
});

router.put("/", requireAuth, async (req, res) => {
  const atualizacoes = {};

  for (const campo of CAMPOS_EDITAVEIS) {
    if (Object.prototype.hasOwnProperty.call(req.body, campo)) {
      atualizacoes[campo] = req.body[campo];
    }
  }

  if (Object.keys(atualizacoes).length === 0) {
    return res.status(400).json({ erro: "Nenhum campo válido pra atualizar." });
  }

  // Se o horário por dia veio nessa atualização, deriva automaticamente os
  // campos antigos (dias_funcionamento / horario_abertura / horario_fechamento)
  // a partir dele — assim eles continuam consistentes pra qualquer coisa que
  // ainda dependa do modelo antigo.
  if (atualizacoes.horarios_excecao && typeof atualizacoes.horarios_excecao === "object") {
    const porDia = atualizacoes.horarios_excecao;
    const diasAbertos = [];
    let primeiraAbertura = null;
    let ultimoFechamento = null;

    for (let d = 0; d <= 6; d++) {
      const config = porDia[d] ?? porDia[String(d)];
      if (config?.aberto) {
        diasAbertos.push(d);
        if (config.abertura && (!primeiraAbertura || config.abertura < primeiraAbertura)) {
          primeiraAbertura = config.abertura;
        }
        if (config.fechamento && (!ultimoFechamento || config.fechamento > ultimoFechamento)) {
          ultimoFechamento = config.fechamento;
        }
      }
    }

    atualizacoes.dias_funcionamento = diasAbertos;
    if (primeiraAbertura) atualizacoes.horario_abertura = primeiraAbertura;
    if (ultimoFechamento) atualizacoes.horario_fechamento = ultimoFechamento;
  }

  const { data, error } = await supabase
    .from("saloes")
    .update(atualizacoes)
    .eq("id", req.salao.id)
    .select()
    .single();

  if (error) {
    console.error("Erro ao atualizar salão:", error);
    return res.status(500).json({ erro: "Erro ao salvar as alterações." });
  }

  res.json({ ok: true, salao: data });
});

export default router;
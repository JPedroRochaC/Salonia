import express from "express";
import { supabase } from "../config/supabase.js";
import { requireAuth } from "../middlewares/requireAuth.js";

const router = express.Router();

// Campos que a própria dona do salão pode editar pelo admin.
// De propósito NÃO incluídos aqui: id, auth_user_id, slug, plano, trial_fim,
// criado_em — esses são geridos por vocês (Salonnia), não pela cliente.
// Nota: horário de atendimento NÃO fica mais aqui — cada profissional tem a
// própria grade (ver routes/profissionaisRoutes.js, campo horarios_disponiveis).
const CAMPOS_EDITAVEIS = [
  "nome",
  "telefone",
  "endereco",
  "logo_url",
  "redes_sociais",
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
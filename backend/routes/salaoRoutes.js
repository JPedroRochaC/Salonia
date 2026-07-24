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
  "titular_pix",
  "cor_destaque",
  "cor_fundo",
  "ativo",
];

function luminosidadeDaCor(hex) {
  const canais = [1, 3, 5].map((inicio) => parseInt(hex.slice(inicio, inicio + 2), 16) / 255)
    .map((canal) => canal <= 0.03928 ? canal / 12.92 : ((canal + 0.055) / 1.055) ** 2.4);
  return canais[0] * 0.2126 + canais[1] * 0.7152 + canais[2] * 0.0722;
}

function contrasteEntreCores(corA, corB) {
  const clara = Math.max(luminosidadeDaCor(corA), luminosidadeDaCor(corB));
  const escura = Math.min(luminosidadeDaCor(corA), luminosidadeDaCor(corB));
  return (clara + 0.05) / (escura + 0.05);
}

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

  for (const campo of ["cor_destaque", "cor_fundo"]) {
    if (campo in atualizacoes && !/^#[0-9a-fA-F]{6}$/.test(String(atualizacoes[campo]))) {
      return res.status(400).json({ erro: "Informe uma cor válida." });
    }
  }
  const destaque = atualizacoes.cor_destaque || req.salao.cor_destaque || "#641546";
  const fundo = atualizacoes.cor_fundo || req.salao.cor_fundo || "#edc2cb";
  if (luminosidadeDaCor(fundo) < 0.42 || contrasteEntreCores(destaque, "#ffffff") < 4.5 || contrasteEntreCores(destaque, fundo) < 4.5) {
    return res.status(400).json({ erro: "Essa combinação de cores não tem contraste suficiente para a página pública." });
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

import express from "express";
import { supabase } from "../config/supabase.js";
import { requireAuth } from "../middlewares/requireAuth.js";

const router = express.Router();

router.get("/", requireAuth, async (req, res) => {
  const { data, error } = await supabase
    .from("portfolio")
    .select("*")
    .eq("salao_id", req.salao.id)
    .order("ordem", { ascending: true });

  if (error) {
    console.error("Erro ao listar portfólio:", error);
    return res.status(500).json({ erro: "Erro ao carregar o portfólio." });
  }

  res.json({ ok: true, fotos: data });
});

router.post("/", requireAuth, async (req, res) => {
  const { imagem_url, descricao } = req.body;

  if (!imagem_url) {
    return res.status(400).json({ erro: "Envie uma imagem primeiro." });
  }

  const { data: ultima } = await supabase
    .from("portfolio")
    .select("ordem")
    .eq("salao_id", req.salao.id)
    .order("ordem", { ascending: false })
    .limit(1)
    .maybeSingle();

  const proximaOrdem = (ultima?.ordem ?? -1) + 1;

  const { data, error } = await supabase
    .from("portfolio")
    .insert({
      salao_id: req.salao.id,
      imagem_url,
      descricao: descricao?.trim() || null,
      ordem: proximaOrdem,
    })
    .select()
    .single();

  if (error) {
    console.error("Erro ao adicionar foto:", error);
    return res.status(500).json({ erro: "Erro ao salvar a foto." });
  }

  res.json({ ok: true, foto: data });
});

router.put("/:id", requireAuth, async (req, res) => {
  const { descricao } = req.body;

  const { data, error } = await supabase
    .from("portfolio")
    .update({ descricao: descricao?.trim() || null })
    .eq("id", req.params.id)
    .eq("salao_id", req.salao.id)
    .select()
    .maybeSingle();

  if (error) {
    console.error("Erro ao atualizar foto:", error);
    return res.status(500).json({ erro: "Erro ao salvar as alterações." });
  }
  if (!data) {
    return res.status(404).json({ erro: "Foto não encontrada." });
  }

  res.json({ ok: true, foto: data });
});

router.delete("/:id", requireAuth, async (req, res) => {
  const { error } = await supabase
    .from("portfolio")
    .delete()
    .eq("id", req.params.id)
    .eq("salao_id", req.salao.id);

  if (error) {
    console.error("Erro ao excluir foto:", error);
    return res.status(500).json({ erro: "Erro ao excluir a foto." });
  }

  res.json({ ok: true });
});

router.post("/:id/mover", requireAuth, async (req, res) => {
  const { direcao } = req.body; // "cima" | "baixo"

  const { data: todas, error: erroTodas } = await supabase
    .from("portfolio")
    .select("id, ordem")
    .eq("salao_id", req.salao.id)
    .order("ordem", { ascending: true });

  if (erroTodas) {
    console.error("Erro ao mover foto:", erroTodas);
    return res.status(500).json({ erro: "Erro ao reordenar." });
  }

  const indiceAtual = todas.findIndex((f) => f.id === req.params.id);
  if (indiceAtual === -1) {
    return res.status(404).json({ erro: "Foto não encontrada." });
  }

  const indiceVizinho = direcao === "cima" ? indiceAtual - 1 : indiceAtual + 1;
  if (indiceVizinho < 0 || indiceVizinho >= todas.length) {
    return res.json({ ok: true });
  }

  const atual = todas[indiceAtual];
  const vizinho = todas[indiceVizinho];

  await Promise.all([
    supabase
      .from("portfolio")
      .update({ ordem: vizinho.ordem })
      .eq("id", atual.id)
      .eq("salao_id", req.salao.id),
    supabase
      .from("portfolio")
      .update({ ordem: atual.ordem })
      .eq("id", vizinho.id)
      .eq("salao_id", req.salao.id),
  ]);

  res.json({ ok: true });
});

export default router;

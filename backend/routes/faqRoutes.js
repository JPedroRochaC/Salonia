import express from "express";
import { supabase } from "../config/supabase.js";
import { requireAuth } from "../middlewares/requireAuth.js";

const router = express.Router();

router.get("/", requireAuth, async (req, res) => {
  const { data, error } = await supabase
    .from("perguntas_frequentes")
    .select("*")
    .eq("salao_id", req.salao.id)
    .order("ordem", { ascending: true });

  if (error) {
    console.error("Erro ao listar FAQ:", error);
    return res.status(500).json({ erro: "Erro ao carregar as perguntas." });
  }

  res.json({ ok: true, perguntas: data });
});

router.post("/", requireAuth, async (req, res) => {
  const { pergunta, resposta } = req.body;

  if (!pergunta?.trim() || !resposta?.trim()) {
    return res.status(400).json({ erro: "Preencha a pergunta e a resposta." });
  }

  const { data: ultima } = await supabase
    .from("perguntas_frequentes")
    .select("ordem")
    .eq("salao_id", req.salao.id)
    .order("ordem", { ascending: false })
    .limit(1)
    .maybeSingle();

  const proximaOrdem = (ultima?.ordem ?? -1) + 1;

  const { data, error } = await supabase
    .from("perguntas_frequentes")
    .insert({
      salao_id: req.salao.id,
      pergunta: pergunta.trim(),
      resposta: resposta.trim(),
      ordem: proximaOrdem,
      ativo: true,
    })
    .select()
    .single();

  if (error) {
    console.error("Erro ao criar pergunta:", error);
    return res.status(500).json({ erro: "Erro ao salvar a pergunta." });
  }

  res.json({ ok: true, pergunta: data });
});

router.put("/:id", requireAuth, async (req, res) => {
  const { pergunta, resposta, ativo } = req.body;
  const atualizacoes = {};

  if (pergunta !== undefined) atualizacoes.pergunta = pergunta.trim();
  if (resposta !== undefined) atualizacoes.resposta = resposta.trim();
  if (ativo !== undefined) atualizacoes.ativo = !!ativo;

  if (Object.keys(atualizacoes).length === 0) {
    return res.status(400).json({ erro: "Nenhum campo válido pra atualizar." });
  }

  const { data, error } = await supabase
    .from("perguntas_frequentes")
    .update(atualizacoes)
    .eq("id", req.params.id)
    .eq("salao_id", req.salao.id) // garante que só edita pergunta do próprio salão
    .select()
    .maybeSingle();

  if (error) {
    console.error("Erro ao atualizar pergunta:", error);
    return res.status(500).json({ erro: "Erro ao salvar as alterações." });
  }
  if (!data) {
    return res.status(404).json({ erro: "Pergunta não encontrada." });
  }

  res.json({ ok: true, pergunta: data });
});

router.delete("/:id", requireAuth, async (req, res) => {
  const { error } = await supabase
    .from("perguntas_frequentes")
    .delete()
    .eq("id", req.params.id)
    .eq("salao_id", req.salao.id);

  if (error) {
    console.error("Erro ao excluir pergunta:", error);
    return res.status(500).json({ erro: "Erro ao excluir a pergunta." });
  }

  res.json({ ok: true });
});

// troca a ordem dessa pergunta com a vizinha (pra cima ou pra baixo)
router.post("/:id/mover", requireAuth, async (req, res) => {
  const { direcao } = req.body; // "cima" | "baixo"

  const { data: todas, error: erroTodas } = await supabase
    .from("perguntas_frequentes")
    .select("id, ordem")
    .eq("salao_id", req.salao.id)
    .order("ordem", { ascending: true });

  if (erroTodas) {
    console.error("Erro ao mover pergunta:", erroTodas);
    return res.status(500).json({ erro: "Erro ao reordenar." });
  }

  const indiceAtual = todas.findIndex((p) => p.id === req.params.id);
  if (indiceAtual === -1) {
    return res.status(404).json({ erro: "Pergunta não encontrada." });
  }

  const indiceVizinho = direcao === "cima" ? indiceAtual - 1 : indiceAtual + 1;
  if (indiceVizinho < 0 || indiceVizinho >= todas.length) {
    return res.json({ ok: true }); // já tá na ponta, não faz nada
  }

  const atual = todas[indiceAtual];
  const vizinho = todas[indiceVizinho];

  await Promise.all([
    supabase
      .from("perguntas_frequentes")
      .update({ ordem: vizinho.ordem })
      .eq("id", atual.id)
      .eq("salao_id", req.salao.id),
    supabase
      .from("perguntas_frequentes")
      .update({ ordem: atual.ordem })
      .eq("id", vizinho.id)
      .eq("salao_id", req.salao.id),
  ]);

  res.json({ ok: true });
});

export default router;

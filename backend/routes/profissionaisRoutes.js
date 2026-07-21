import express from "express";
import { supabase } from "../config/supabase.js";
import { requireAuth } from "../middlewares/requireAuth.js";

const router = express.Router();

router.get("/", requireAuth, async (req, res) => {
  const { data: profissionais, error } = await supabase
    .from("profissionais")
    .select("*")
    .eq("salao_id", req.salao.id)
    .order("criado_em", { ascending: true });

  if (error) {
    console.error("Erro ao listar profissionais:", error);
    return res.status(500).json({ erro: "Erro ao carregar os profissionais." });
  }

  const ids = (profissionais || []).map((p) => p.id);
  let vinculos = [];

  if (ids.length > 0) {
    const { data, error: erroVinculos } = await supabase
      .from("profissional_servicos")
      .select("profissional_id, servico_id")
      .in("profissional_id", ids);

    if (erroVinculos) {
      console.error("Erro ao listar vínculos profissional/serviço:", erroVinculos);
    } else {
      vinculos = data;
    }
  }

  const profissionaisComServicos = profissionais.map((p) => ({
    ...p,
    servico_ids: vinculos.filter((v) => v.profissional_id === p.id).map((v) => v.servico_id),
  }));

  res.json({ ok: true, profissionais: profissionaisComServicos });
});

router.post("/", requireAuth, async (req, res) => {
  const { nome, foto_url } = req.body;

  if (!nome?.trim()) {
    return res.status(400).json({ erro: "Preencha o nome." });
  }

  const { data, error } = await supabase
    .from("profissionais")
    .insert({
      salao_id: req.salao.id,
      nome: nome.trim(),
      foto_url: foto_url || null,
      ativo: true,
    })
    .select()
    .single();

  if (error) {
    console.error("Erro ao criar profissional:", error);
    return res.status(500).json({ erro: "Erro ao salvar o profissional." });
  }

  res.json({ ok: true, profissional: { ...data, servico_ids: [] } });
});

router.put("/:id", requireAuth, async (req, res) => {
  const { nome, foto_url, ativo } = req.body;
  const atualizacoes = {};

  if (nome !== undefined) atualizacoes.nome = nome.trim();
  if (foto_url !== undefined) atualizacoes.foto_url = foto_url || null;
  if (ativo !== undefined) atualizacoes.ativo = !!ativo;

  if (Object.keys(atualizacoes).length === 0) {
    return res.status(400).json({ erro: "Nenhum campo válido pra atualizar." });
  }

  const { data, error } = await supabase
    .from("profissionais")
    .update(atualizacoes)
    .eq("id", req.params.id)
    .eq("salao_id", req.salao.id)
    .select()
    .maybeSingle();

  if (error) {
    console.error("Erro ao atualizar profissional:", error);
    return res.status(500).json({ erro: "Erro ao salvar as alterações." });
  }
  if (!data) {
    return res.status(404).json({ erro: "Profissional não encontrado." });
  }

  res.json({ ok: true, profissional: data });
});

router.delete("/:id", requireAuth, async (req, res) => {
  const { error } = await supabase
    .from("profissionais")
    .delete()
    .eq("id", req.params.id)
    .eq("salao_id", req.salao.id);

  if (error) {
    console.error("Erro ao excluir profissional:", error);
    return res.status(409).json({
      erro:
        "Não deu pra excluir — esse profissional já tem agendamentos vinculados. Desative em vez de excluir.",
    });
  }

  res.json({ ok: true });
});

// substitui a lista de serviços que esse profissional realiza
router.put("/:id/servicos", requireAuth, async (req, res) => {
  const { servico_ids } = req.body;

  const { data: profissional } = await supabase
    .from("profissionais")
    .select("id")
    .eq("id", req.params.id)
    .eq("salao_id", req.salao.id)
    .maybeSingle();

  if (!profissional) {
    return res.status(404).json({ erro: "Profissional não encontrado." });
  }

  // garante que só vincula serviços do mesmo salão (mesmo que o front mande
  // um id de outro salão por engano/manipulação)
  const { data: servicosValidos } = await supabase
    .from("servicos")
    .select("id")
    .eq("salao_id", req.salao.id)
    .in("id", Array.isArray(servico_ids) ? servico_ids : []);

  const idsValidos = (servicosValidos || []).map((s) => s.id);

  const { error: erroDelete } = await supabase
    .from("profissional_servicos")
    .delete()
    .eq("profissional_id", profissional.id);

  if (erroDelete) {
    console.error("Erro ao atualizar serviços do profissional:", erroDelete);
    return res.status(500).json({ erro: "Erro ao salvar." });
  }

  if (idsValidos.length > 0) {
    const { error: erroInsert } = await supabase.from("profissional_servicos").insert(
      idsValidos.map((servico_id) => ({
        profissional_id: profissional.id,
        servico_id,
      })),
    );

    if (erroInsert) {
      console.error("Erro ao vincular serviços:", erroInsert);
      return res.status(500).json({ erro: "Erro ao salvar." });
    }
  }

  res.json({ ok: true, servico_ids: idsValidos });
});

// substitui a grade de horários disponíveis desse profissional.
// Formato esperado: { "0": ["08:00","10:00"], "1": [], ... } — chaves "0" a
// "6" (domingo a sábado, igual Date.getDay() no front público), cada uma com
// a lista de horários específicos que ela atende naquele dia.
router.put("/:id/horarios", requireAuth, async (req, res) => {
  const { horarios_disponiveis } = req.body;

  if (!horarios_disponiveis || typeof horarios_disponiveis !== "object") {
    return res.status(400).json({ erro: "Formato de horários inválido." });
  }

  // validação simples: só aceita chaves "0"-"6" e valores em formato HH:MM
  const regexHora = /^([01]\d|2[0-3]):[0-5]\d$/;
  const limpo = {};

  for (let d = 0; d <= 6; d++) {
    const lista = horarios_disponiveis[d] ?? horarios_disponiveis[String(d)];
    if (!Array.isArray(lista)) continue;
    limpo[d] = [...new Set(lista.filter((h) => regexHora.test(h)))].sort();
  }

  const { data, error } = await supabase
    .from("profissionais")
    .update({ horarios_disponiveis: limpo })
    .eq("id", req.params.id)
    .eq("salao_id", req.salao.id)
    .select()
    .maybeSingle();

  if (error) {
    console.error("Erro ao salvar horários do profissional:", error);
    return res.status(500).json({ erro: "Erro ao salvar os horários." });
  }
  if (!data) {
    return res.status(404).json({ erro: "Profissional não encontrado." });
  }

  res.json({ ok: true, profissional: data });
});

export default router;

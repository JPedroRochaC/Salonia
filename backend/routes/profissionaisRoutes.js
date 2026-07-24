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
  const { nome, foto_url, ativo, modo_agenda } = req.body;
  const atualizacoes = {};

  if (nome !== undefined) atualizacoes.nome = nome.trim();
  if (foto_url !== undefined) atualizacoes.foto_url = foto_url || null;
  if (ativo !== undefined) atualizacoes.ativo = !!ativo;
  if (modo_agenda !== undefined) {
    if (!['semanal', 'flexivel'].includes(modo_agenda)) return res.status(400).json({ erro: "Modo de agenda inválido." });
    atualizacoes.modo_agenda = modo_agenda;
  }

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

// Substitui os períodos semanais de trabalho. Cada dia aceita períodos como
// { inicio: "09:00", fim: "18:00" }. Listas antigas de horários específicos
// continuam aceitas para não quebrar agendas já cadastradas.
router.put("/:id/horarios", requireAuth, async (req, res) => {
  const { horarios_disponiveis } = req.body;

  if (!horarios_disponiveis || typeof horarios_disponiveis !== "object") {
    return res.status(400).json({ erro: "Formato de horários inválido." });
  }

  // Aceita chaves "0"-"6" (domingo a sábado), horários antigos HH:MM e
  // períodos de trabalho válidos.
  const regexHora = /^([01]\d|2[0-3]):[0-5]\d$/;
  const limpo = {};

  for (let d = 0; d <= 6; d++) {
    const lista = horarios_disponiveis[d] ?? horarios_disponiveis[String(d)];
    if (!Array.isArray(lista)) continue;
    const chaves = new Set();
    limpo[d] = lista.flatMap((item) => {
      if (typeof item === "string" && regexHora.test(item)) {
        const chave = `hora:${item}`;
        if (chaves.has(chave)) return [];
        chaves.add(chave);
        return [item];
      }
      if (!item || typeof item !== "object" || !regexHora.test(item.inicio) || !regexHora.test(item.fim) || item.inicio >= item.fim) return [];
      const chave = `periodo:${item.inicio}-${item.fim}`;
      if (chaves.has(chave)) return [];
      chaves.add(chave);
      return [{ inicio: item.inicio, fim: item.fim }];
    }).sort((a, b) => String(a.inicio || a).localeCompare(String(b.inicio || b)));
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

// Horários de datas reais, usados no modo flexível. A grade recebida substitui
// apenas o intervalo enviado — datas antigas ficam preservadas para histórico.
router.put("/:id/disponibilidades", requireAuth, async (req, res) => {
  const { inicio, fim, dias } = req.body || {};
  if (!/^\d{4}-\d{2}-\d{2}$/.test(inicio || "") || !/^\d{4}-\d{2}-\d{2}$/.test(fim || "") || !Array.isArray(dias)) {
    return res.status(400).json({ erro: "Informe o período e os horários por data." });
  }
  const { data: profissional } = await supabase.from("profissionais").select("id").eq("id", req.params.id).eq("salao_id", req.salao.id).maybeSingle();
  if (!profissional) return res.status(404).json({ erro: "Profissional não encontrada." });

  const regexHora = /^([01]\d|2[0-3]):[0-5]\d$/;
  const registros = dias.flatMap((dia) => {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(dia?.data || "") || dia.data < inicio || dia.data > fim) return [];
    return [...new Set((dia.horarios || []).filter((hora) => regexHora.test(hora)))].map((hora) => ({
      salao_id: req.salao.id, profissional_id: profissional.id, data: dia.data, hora,
    }));
  });

  const { error: erroExcluir } = await supabase
    .from("disponibilidades_profissional")
    .delete()
    .eq("profissional_id", profissional.id)
    .gte("data", inicio)
    .lte("data", fim);
  if (erroExcluir) return res.status(500).json({ erro: "Erro ao atualizar a agenda flexível." });
  if (registros.length) {
    const { error: erroInserir } = await supabase.from("disponibilidades_profissional").insert(registros);
    if (erroInserir) return res.status(500).json({ erro: "Erro ao salvar os horários." });
  }
  res.json({ ok: true });
});

router.get("/:id/disponibilidades", requireAuth, async (req, res) => {
  const { inicio, fim } = req.query;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(inicio || "") || !/^\d{4}-\d{2}-\d{2}$/.test(fim || "")) {
    return res.status(400).json({ erro: "Informe um período válido." });
  }
  const { data, error } = await supabase.from("disponibilidades_profissional")
    .select("data, hora").eq("profissional_id", req.params.id).eq("salao_id", req.salao.id).gte("data", inicio).lte("data", fim).order("data").order("hora");
  if (error) return res.status(500).json({ erro: "Erro ao carregar os horários." });
  res.json({ ok: true, disponibilidades: data || [] });
});

export default router;

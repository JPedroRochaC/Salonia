import express from "express";
import { supabase } from "../config/supabase.js";
import { requireAuth } from "../middlewares/requireAuth.js";

const router = express.Router();

router.get("/", requireAuth, async (req, res) => {
  const { data, error } = await supabase
    .from("servicos")
    .select("*")
    .eq("salao_id", req.salao.id)
    .order("criado_em", { ascending: true });

  if (error) {
    console.error("Erro ao listar serviços:", error);
    return res.status(500).json({ erro: "Erro ao carregar os serviços." });
  }

  res.json({ ok: true, servicos: data });
});

router.post("/", requireAuth, async (req, res) => {
  const {
    nome,
    duracao_minutos,
    preco,
    cobra_sinal,
    tipo_cobranca_sinal,
    valor_sinal_fixo,
    percentual_sinal,
  } = req.body;

  if (!nome?.trim() || !duracao_minutos || preco === undefined || preco === null) {
    return res.status(400).json({ erro: "Preencha nome, duração e preço." });
  }

  const cobraSinal = cobra_sinal !== false; // default: cobra sinal
  const tipoCobranca = cobraSinal ? (tipo_cobranca_sinal || "fixo") : null;

  if (cobraSinal && tipoCobranca === "fixo" && (valor_sinal_fixo === undefined || valor_sinal_fixo === null || valor_sinal_fixo === "")) {
    return res.status(400).json({ erro: "Informe o valor fixo do sinal." });
  }
  if (cobraSinal && tipoCobranca === "percentual" && (percentual_sinal === undefined || percentual_sinal === null || percentual_sinal === "")) {
    return res.status(400).json({ erro: "Informe o percentual do sinal." });
  }
  if (cobraSinal && tipoCobranca !== "fixo" && tipoCobranca !== "percentual") {
    return res.status(400).json({ erro: "Tipo de cobrança do sinal inválido." });
  }

  const { data, error } = await supabase
    .from("servicos")
    .insert({
      salao_id: req.salao.id,
      nome: nome.trim(),
      duracao_minutos: Number(duracao_minutos),
      preco: Number(preco),
      ativo: true,
      cobra_sinal: cobraSinal,
      tipo_cobranca_sinal: tipoCobranca,
      valor_sinal_fixo:
        cobraSinal && tipoCobranca === "fixo" ? Number(valor_sinal_fixo) : null,
      percentual_sinal:
        cobraSinal && tipoCobranca === "percentual" ? Number(percentual_sinal) : null,
    })
    .select()
    .single();

  if (error) {
    console.error("Erro ao criar serviço:", error);
    return res.status(500).json({ erro: "Erro ao salvar o serviço." });
  }

  res.json({ ok: true, servico: data });
});

router.put("/:id", requireAuth, async (req, res) => {
  const {
    nome,
    duracao_minutos,
    preco,
    ativo,
    cobra_sinal,
    tipo_cobranca_sinal,
    valor_sinal_fixo,
    percentual_sinal,
  } = req.body;
  const atualizacoes = {};

  if (nome !== undefined) atualizacoes.nome = nome.trim();
  if (duracao_minutos !== undefined) atualizacoes.duracao_minutos = Number(duracao_minutos);
  if (preco !== undefined) atualizacoes.preco = Number(preco);
  if (ativo !== undefined) atualizacoes.ativo = !!ativo;

  // O sinal só é processado quando o form de serviço manda esse bloco
  // (o botão de ativar/desativar manda só { ativo }, sem tocar no sinal).
  if (cobra_sinal !== undefined) {
    const cobraSinal = cobra_sinal !== false;
    const tipoCobranca = cobraSinal ? (tipo_cobranca_sinal || "fixo") : null;

    if (
      cobraSinal &&
      tipoCobranca === "fixo" &&
      (valor_sinal_fixo === undefined || valor_sinal_fixo === null || valor_sinal_fixo === "")
    ) {
      return res.status(400).json({ erro: "Informe o valor fixo do sinal." });
    }
    if (
      cobraSinal &&
      tipoCobranca === "percentual" &&
      (percentual_sinal === undefined || percentual_sinal === null || percentual_sinal === "")
    ) {
      return res.status(400).json({ erro: "Informe o percentual do sinal." });
    }
    if (cobraSinal && tipoCobranca !== "fixo" && tipoCobranca !== "percentual") {
      return res.status(400).json({ erro: "Tipo de cobrança do sinal inválido." });
    }

    atualizacoes.cobra_sinal = cobraSinal;
    atualizacoes.tipo_cobranca_sinal = tipoCobranca;
    atualizacoes.valor_sinal_fixo =
      cobraSinal && tipoCobranca === "fixo" ? Number(valor_sinal_fixo) : null;
    atualizacoes.percentual_sinal =
      cobraSinal && tipoCobranca === "percentual" ? Number(percentual_sinal) : null;
  }

  if (Object.keys(atualizacoes).length === 0) {
    return res.status(400).json({ erro: "Nenhum campo válido pra atualizar." });
  }

  const { data, error } = await supabase
    .from("servicos")
    .update(atualizacoes)
    .eq("id", req.params.id)
    .eq("salao_id", req.salao.id)
    .select()
    .maybeSingle();

  if (error) {
    console.error("Erro ao atualizar serviço:", error);
    return res.status(500).json({ erro: "Erro ao salvar as alterações." });
  }
  if (!data) {
    return res.status(404).json({ erro: "Serviço não encontrado." });
  }

  res.json({ ok: true, servico: data });
});

router.delete("/:id", requireAuth, async (req, res) => {
  const { error } = await supabase
    .from("servicos")
    .delete()
    .eq("id", req.params.id)
    .eq("salao_id", req.salao.id);

  if (error) {
    // provavelmente esse serviço já tem agendamentos ligados a ele (FK)
    console.error("Erro ao excluir serviço:", error);
    return res.status(409).json({
      erro:
        "Não deu pra excluir — esse serviço já tem agendamentos vinculados. Desative ele em vez de excluir.",
    });
  }

  res.json({ ok: true });
});

export default router;
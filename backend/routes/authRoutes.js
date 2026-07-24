import express from "express";
import { supabase, supabaseAuth } from "../config/supabase.js";
import { requireAuth } from "../middlewares/requireAuth.js";

const router = express.Router();

const SETE_DIAS_MS = 1000 * 60 * 60 * 24 * 7;

router.post("/login", async (req, res) => {
  const { email, senha } = req.body;

  if (!email || !senha) {
    return res.status(400).json({ erro: "Informe email e senha." });
  }

  const { data, error } = await supabaseAuth.auth.signInWithPassword({
    email,
    password: senha,
  });

  if (error || !data?.session) {
    return res.status(401).json({ erro: "Email ou senha inválidos." });
  }

  const { data: salao, error: erroSalao } = await supabase
    .from("saloes")
    .select("id, nome, slug, logo_url, cor_destaque, cor_fundo, plano, ativo")
    .eq("auth_user_id", data.user.id)
    .maybeSingle();

  if (erroSalao || !salao) {
    // login válido no Supabase Auth, mas sem salão vinculado — não deixa entrar
    return res
      .status(403)
      .json({ erro: "Essa conta não está vinculada a nenhum salão." });
  }

  res.cookie("salonnia_token", data.session.access_token, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    maxAge: SETE_DIAS_MS,
  });

  res.json({ ok: true, salao });
});

router.post("/logout", (req, res) => {
  res.clearCookie("salonnia_token");
  res.json({ ok: true });
});

// usado pelo front do admin pra saber se a sessão ainda é válida (ex: ao
// recarregar a página) e pra pegar os dados básicos do salão logado
router.get("/me", requireAuth, (req, res) => {
  const { id, nome, slug, logo_url, cor_destaque, cor_fundo, plano, ativo } =
    req.salao;
  res.json({ ok: true, salao: { id, nome, slug, logo_url, cor_destaque, cor_fundo, plano, ativo } });
});

export default router;

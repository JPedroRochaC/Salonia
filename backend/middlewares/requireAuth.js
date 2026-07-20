import { supabase } from "../config/supabase.js";

// Protege rotas do admin: confirma que existe um token de sessão válido
// (Supabase Auth) e que esse usuário está vinculado a um salão. Depois disso,
// toda rota protegida pode confiar em `req.salao` — nunca em salao_id vindo
// do body/query do navegador.
export async function requireAuth(req, res, next) {
  const token = req.cookies?.salonnia_token;

  if (!token) {
    return res.status(401).json({ erro: "Não autenticado." });
  }

  const { data: userData, error: erroUser } = await supabase.auth.getUser(token);

  if (erroUser || !userData?.user) {
    return res.status(401).json({ erro: "Sessão inválida ou expirada." });
  }

  const { data: salao, error: erroSalao } = await supabase
    .from("saloes")
    .select("*")
    .eq("auth_user_id", userData.user.id)
    .maybeSingle();

  if (erroSalao || !salao) {
    return res
      .status(403)
      .json({ erro: "Essa conta não está vinculada a nenhum salão." });
  }

  req.salao = salao;
  next();
}
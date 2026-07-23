import express from "express";
import { supabase } from "../config/supabase.js";
import { requireAuth } from "../middlewares/requireAuth.js";
import { VAPID_PUBLIC_KEY } from "../config/webpush.js";

const router = express.Router();

// O frontend chama isso pra saber com qual chave pública montar a inscrição.
router.get("/vapid-public-key", requireAuth, (req, res) => {
  res.json({ ok: true, publicKey: VAPID_PUBLIC_KEY });
});

// Salva (ou atualiza) a inscrição de notificação do navegador do admin logado.
router.post("/subscribe", requireAuth, async (req, res) => {
  const { endpoint, keys } = req.body || {};

  if (!endpoint || !keys?.p256dh || !keys?.auth) {
    return res.status(400).json({ erro: "Inscrição push inválida." });
  }

  const { error } = await supabase.from("push_subscriptions").upsert(
    {
      salao_id: req.salao.id,
      endpoint,
      p256dh: keys.p256dh,
      auth: keys.auth,
    },
    { onConflict: "endpoint" },
  );

  if (error) {
    console.error("Erro ao salvar inscrição push:", error);
    return res.status(500).json({ erro: "Erro ao salvar inscrição de notificação." });
  }

  res.json({ ok: true });
});

// Remove a inscrição (quando o admin desativa notificações).
router.post("/unsubscribe", requireAuth, async (req, res) => {
  const { endpoint } = req.body || {};
  if (!endpoint) return res.status(400).json({ erro: "Endpoint não informado." });

  const { error } = await supabase
    .from("push_subscriptions")
    .delete()
    .eq("endpoint", endpoint)
    .eq("salao_id", req.salao.id);

  if (error) {
    console.error("Erro ao remover inscrição push:", error);
    return res.status(500).json({ erro: "Erro ao cancelar notificações." });
  }

  res.json({ ok: true });
});

export default router;

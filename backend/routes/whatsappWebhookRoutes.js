import crypto from "node:crypto";
import express from "express";
import { supabase } from "../config/supabase.js";
import { atenderMensagemIara } from "../lib/iaraAtendimento.js";
import { enviarTextoWhatsApp } from "../lib/whatsappCloud.js";

const router = express.Router();

function assinaturaValida(req) {
  const segredo = process.env.META_APP_SECRET;
  const assinatura = req.get("x-hub-signature-256");
  if (!segredo || !assinatura || !Buffer.isBuffer(req.body)) return false;
  const esperada = `sha256=${crypto.createHmac("sha256", segredo).update(req.body).digest("hex")}`;
  const recebida = Buffer.from(assinatura);
  const calculada = Buffer.from(esperada);
  return recebida.length === calculada.length && crypto.timingSafeEqual(recebida, calculada);
}

router.get("/", (req, res) => {
  const modo = req.query["hub.mode"];
  const token = req.query["hub.verify_token"];
  const desafio = req.query["hub.challenge"];
  if (modo === "subscribe" && token && token === process.env.META_WEBHOOK_VERIFY_TOKEN) return res.status(200).send(desafio);
  return res.sendStatus(403);
});

async function processarMensagem(phoneNumberId, mensagem, numeroExibicao) {
  if (mensagem.type !== "text" || !mensagem.text?.body || !mensagem.from) return;
  const { data: configuracao, error: erroConfiguracao } = await supabase
    .from("iara_configuracoes")
    .select("salao_id, whatsapp_phone_number_id")
    .eq("whatsapp_phone_number_id", phoneNumberId)
    .maybeSingle();
  if (erroConfiguracao || !configuracao) {
    console.warn("Webhook recebido para um número ainda não conectado à Iara.", { phoneNumberId, erroConfiguracao });
    return;
  }
  await supabase.from("iara_configuracoes").update({ whatsapp_status: "conectado", whatsapp_numero: numeroExibicao || null, atualizado_em: new Date().toISOString() }).eq("salao_id", configuracao.salao_id);
  const { data: salao, error: erroSalao } = await supabase.from("saloes").select("*").eq("id", configuracao.salao_id).maybeSingle();
  if (erroSalao || !salao) throw erroSalao || new Error("Salão da Iara não encontrado.");

  const resultado = await atenderMensagemIara({
    salao,
    telefone: mensagem.from,
    nome: mensagem.profile?.name || null,
    mensagem: mensagem.text.body,
    grupo: false,
    enviadaPeloSalao: false,
  });
  if (resultado.resposta) await enviarTextoWhatsApp({ phoneNumberId, destinatario: mensagem.from, texto: resultado.resposta });
}

router.post("/", async (req, res) => {
  if (!assinaturaValida(req)) return res.sendStatus(401);
  let evento;
  try { evento = JSON.parse(req.body.toString("utf8")); } catch { return res.sendStatus(400); }
  res.status(200).send("EVENT_RECEIVED");

  const alteracoes = evento.entry?.flatMap((entrada) => entrada.changes || []) || [];
  for (const alteracao of alteracoes) {
    const valor = alteracao.value;
    const phoneNumberId = valor?.metadata?.phone_number_id;
    for (const mensagem of valor?.messages || []) {
      const contato = (valor?.contacts || []).find((item) => item.wa_id === mensagem.from);
      processarMensagem(phoneNumberId, { ...mensagem, profile: contato?.profile }, valor?.metadata?.display_phone_number).catch((erro) => console.error("Erro no webhook da Iara:", erro));
    }
  }
});

export default router;

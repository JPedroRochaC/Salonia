const VERSAO_PADRAO = "v23.0";

export async function enviarTextoWhatsApp({ phoneNumberId, destinatario, texto }) {
  const token = process.env.META_WHATSAPP_ACCESS_TOKEN;
  if (!token) throw new Error("META_WHATSAPP_ACCESS_TOKEN não configurado.");
  if (!phoneNumberId) throw new Error("Número do WhatsApp não conectado à Iara.");

  const resposta = await fetch(`https://graph.facebook.com/${process.env.META_GRAPH_VERSION || VERSAO_PADRAO}/${phoneNumberId}/messages`, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      messaging_product: "whatsapp",
      to: String(destinatario).replace(/\D/g, ""),
      type: "text",
      text: { preview_url: false, body: String(texto).slice(0, 4096) },
    }),
  });
  const dados = await resposta.json().catch(() => ({}));
  if (!resposta.ok) throw new Error(dados?.error?.message || "A Meta recusou o envio da mensagem.");
  return dados;
}

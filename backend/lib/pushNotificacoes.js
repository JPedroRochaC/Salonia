import { supabase } from "../config/supabase.js";
import { webpush } from "../config/webpush.js";

/**
 * Envia uma notificação push pra todos os dispositivos inscritos de um salão.
 * @param {string} salaoId
 * @param {{ titulo: string, corpo: string, url?: string }} conteudo
 */
export async function notificarSalao(salaoId, { titulo, corpo, url = "/admin" }) {
  const { data: inscricoes, error } = await supabase
    .from("push_subscriptions")
    .select("id, endpoint, p256dh, auth")
    .eq("salao_id", salaoId);

  if (error) {
    console.error("Erro ao buscar inscrições push do salão:", error);
    return;
  }

  if (!inscricoes || inscricoes.length === 0) return;

  const payload = JSON.stringify({ titulo, corpo, url });

  const idsParaRemover = [];

  await Promise.all(
    inscricoes.map(async (inscricao) => {
      const subscription = {
        endpoint: inscricao.endpoint,
        keys: { p256dh: inscricao.p256dh, auth: inscricao.auth },
      };

      try {
        await webpush.sendNotification(subscription, payload);
      } catch (err) {
        // 404/410 = inscrição expirada (navegador desinstalou o PWA, limpou
        // permissão etc.) — nesses casos, removemos do banco.
        if (err.statusCode === 404 || err.statusCode === 410) {
          idsParaRemover.push(inscricao.id);
        } else {
          console.error("Erro ao enviar push:", err.statusCode, err.body);
        }
      }
    }),
  );

  if (idsParaRemover.length > 0) {
    await supabase.from("push_subscriptions").delete().in("id", idsParaRemover);
  }
}

/**
 * Envia a mesma notificação pra todos os salões que têm ao menos uma
 * inscrição ativa. Usado pelo lembrete semanal.
 * @param {{ titulo: string, corpo: string, url?: string }} conteudo
 */
export async function notificarTodosSaloes(conteudo) {
  const { data: saloesComInscricao, error } = await supabase
    .from("push_subscriptions")
    .select("salao_id");

  if (error) {
    console.error("Erro ao listar salões com inscrição push:", error);
    return;
  }

  const idsUnicos = [...new Set((saloesComInscricao || []).map((s) => s.salao_id))];

  await Promise.all(idsUnicos.map((salaoId) => notificarSalao(salaoId, conteudo)));
}

import webpush from "web-push";

// As chaves VAPID identificam o seu servidor perante os navegadores.
// São lidas do .env — veja o arquivo INSTRUCOES.md pra saber os valores
// gerados especificamente pra esse projeto.
const VAPID_PUBLIC_KEY = process.env.VAPID_PUBLIC_KEY;
const VAPID_PRIVATE_KEY = process.env.VAPID_PRIVATE_KEY;

if (!VAPID_PUBLIC_KEY || !VAPID_PRIVATE_KEY) {
  console.warn(
    "⚠️  VAPID_PUBLIC_KEY / VAPID_PRIVATE_KEY não configuradas no .env — notificações push não vão funcionar.",
  );
} else {
  webpush.setVapidDetails(
    // "mailto" é exigido pelo padrão Web Push, mas não precisa ser um email
    // real monitorado — é só um contato de referência caso algum provedor
    // de push (Chrome, Firefox etc.) precise reportar abuso.
    "mailto:contato@salonia.app",
    VAPID_PUBLIC_KEY,
    VAPID_PRIVATE_KEY,
  );
}

export { webpush, VAPID_PUBLIC_KEY };

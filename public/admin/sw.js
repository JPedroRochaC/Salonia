/* ============================================================
   SALONIA — Service worker do painel admin
   Estratégia: network-first pra tudo (HTML/JS/CSS/API) — sempre tenta
   buscar a versão mais nova primeiro, só usa o cache como fallback se
   estiver offline. Isso resolve o problema clássico de PWA "não atualiza
   sozinho": qualquer alteração que você fizer aparece já no próximo
   carregamento da página, sem precisar limpar cache manualmente.
   Só os ícones (que praticamente nunca mudam) ficam em cache-first.
   ============================================================ */

// Só precisa mudar esse número se um dia quiser forçar uma limpeza total
// de cache antigo — no dia a dia não precisa tocar aqui.
const CACHE_VERSION = "salonia-v1";
const CACHE_ESTATICO = `${CACHE_VERSION}-estatico`;

const ARQUIVOS_ESTATICOS = [
  "/admin/manifest.json",
  "/admin/icons/icon-192.png",
  "/admin/icons/icon-512.png",
  "/admin/icons/icon-maskable-512.png",
];

self.addEventListener("install", (evento) => {
  // Ativa o service worker novo assim que ele termina de instalar, sem
  // esperar todas as abas antigas fecharem.
  self.skipWaiting();
  evento.waitUntil(
    caches.open(CACHE_ESTATICO).then((cache) => cache.addAll(ARQUIVOS_ESTATICOS))
  );
});

self.addEventListener("activate", (evento) => {
  evento.waitUntil(
    caches
      .keys()
      .then((nomes) =>
        Promise.all(
          nomes
            .filter((nome) => nome.startsWith("salonia-") && nome !== CACHE_ESTATICO)
            .map((nome) => caches.delete(nome))
        )
      )
      .then(() => self.clients.claim())
  );
});

self.addEventListener("message", (evento) => {
  if (evento.data && evento.data.tipo === "SKIP_WAITING") {
    self.skipWaiting();
  }
});

self.addEventListener("fetch", (evento) => {
  const req = evento.request;
  if (req.method !== "GET") return;

  const ehIcone = req.url.includes("/admin/icons/");

  if (ehIcone) {
    // Ícones: cache primeiro (não mudam quase nunca), com a rede como
    // reforço se ainda não estiver em cache.
    evento.respondWith(caches.match(req).then((resposta) => resposta || fetch(req)));
    return;
  }

  // Tudo o mais (HTML, script.js, style.css, chamadas de API): busca na
  // rede primeiro. Só cai pro cache se estiver offline.
  evento.respondWith(
    fetch(req)
      .then((resposta) => {
        const copia = resposta.clone();
        caches
          .open(CACHE_ESTATICO)
          .then((cache) => cache.put(req, copia))
          .catch(() => {});
        return resposta;
      })
      .catch(() => caches.match(req))
  );
});

// ============================================================
// NOTIFICAÇÕES PUSH
// ============================================================

self.addEventListener("push", (evento) => {
  let dados = { titulo: "Salonia", corpo: "Você tem uma novidade.", url: "/admin" };

  try {
    if (evento.data) dados = { ...dados, ...evento.data.json() };
  } catch (err) {
    console.error("Erro ao ler payload da notificação push:", err);
  }

  const opcoes = {
    body: dados.corpo,
    icon: "/admin/icons/icon-192.png",
    badge: "/admin/icons/icon-192.png",
    data: { url: dados.url || "/admin" },
  };

  evento.waitUntil(self.registration.showNotification(dados.titulo, opcoes));
});

self.addEventListener("notificationclick", (evento) => {
  evento.notification.close();
  const url = evento.notification.data?.url || "/admin";

  evento.waitUntil(
    self.clients.matchAll({ type: "window", includeUncontrolled: true }).then((janelas) => {
      // Se já tem uma aba do admin aberta, foca nela em vez de abrir outra.
      const abaExistente = janelas.find((janela) => janela.url.includes("/admin"));
      if (abaExistente) return abaExistente.focus();
      return self.clients.openWindow(url);
    }),
  );
});
import "dotenv/config";
import express from "express";
import cors from "cors";
import cookieParser from "cookie-parser";
import path from "path";
import { fileURLToPath } from "url";
import { readFile } from "node:fs/promises";
import cron from "node-cron";

import agendamentoRoutes from "./routes/agendamentoRoutes.js";
import authRoutes from "./routes/authRoutes.js";
import salaoRoutes from "./routes/salaoRoutes.js";
import dashboardRoutes from "./routes/dashboardRoutes.js";
import uploadRoutes from "./routes/uploadRoutes.js";
import faqRoutes from "./routes/faqRoutes.js";
import agendamentosAdminRoutes from "./routes/agendamentosAdminRoutes.js";
import clientesRoutes from "./routes/clientesRoutes.js";
import servicosRoutes from "./routes/servicosRoutes.js";
import profissionaisRoutes from "./routes/profissionaisRoutes.js";
import portfolioRoutes from "./routes/portfolioRoutes.js";
import pushRoutes from "./routes/pushRoutes.js";
import { notificarSaloesComAgendaFlexivel } from "./lib/pushNotificacoes.js";
import { supabase } from "./config/supabase.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const caminhoPaginaSalao = path.join(__dirname, "..", "public", "salao", "index.html");
let templatePaginaSalao;

function escaparHtml(texto) {
  return String(texto || "").replace(/[&<>'"]/g, (caractere) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", "'": "&#39;", '"': "&quot;" })[caractere]);
}

async function enviarPaginaSalao(req, res) {
  const { data: salao } = await supabase
    .from("saloes")
    .select("nome, endereco, logo_url")
    .eq("slug", req.params.slug)
    .maybeSingle();

  if (!templatePaginaSalao) templatePaginaSalao = await readFile(caminhoPaginaSalao, "utf8");
  if (!salao) return res.status(404).send(templatePaginaSalao.replaceAll("__SALONIA_TITULO__", "Salão não encontrado"));

  const host = String(req.headers["x-forwarded-host"] || req.get("host")).split(",")[0].trim();
  const protocolo = String(req.headers["x-forwarded-proto"] || req.protocol).split(",")[0].trim();
  const url = `${protocolo}://${host}/${req.params.slug}`;
  const titulo = `${salao.nome} — Agendamento online`;
  const descricao = `Agende seu horário no ${salao.nome}${salao.endereco ? ` · ${salao.endereco}` : ""}.`;
  const imagem = salao.logo_url || `${protocolo}://${host}/admin/icons/icon-512.png`;
  const pagina = templatePaginaSalao
    .replaceAll("__SALONIA_TITULO__", escaparHtml(titulo))
    .replaceAll("__SALONIA_DESCRICAO__", escaparHtml(descricao))
    .replaceAll("__SALONIA_IMAGEM__", escaparHtml(imagem))
    .replaceAll("__SALONIA_URL__", escaparHtml(url));
  res.type("html").send(pagina);
}

const app = express();

app.use(cors());
app.use(express.json());
app.use(cookieParser());

// pasta public fica um nível acima de backend/
app.use(express.static(path.join(__dirname, "..", "public")));

app.use("/agendamento", agendamentoRoutes);

// rotas do admin (autenticadas)
app.use("/admin/auth", authRoutes);
app.use("/admin/api/salao", salaoRoutes);
app.use("/admin/api/dashboard", dashboardRoutes);
app.use("/admin/api/upload", uploadRoutes);
app.use("/admin/api/faq", faqRoutes);
app.use("/admin/api/agendamentos", agendamentosAdminRoutes);
app.use("/admin/api/clientes", clientesRoutes);
app.use("/admin/api/servicos", servicosRoutes);
app.use("/admin/api/profissionais", profissionaisRoutes);
app.use("/admin/api/portfolio", portfolioRoutes);
app.use("/admin/api/push", pushRoutes);

app.get("/api", (req, res) => {
    res.json({ status: "Salonia App online 🚀" });
});

// rotas do salão por slug
app.get("/:slug/agendar", enviarPaginaSalao);

app.get("/:slug/portfolio", enviarPaginaSalao);

app.get("/:slug", enviarPaginaSalao);

const PORT = process.env.PORT || 3000;

app.listen(PORT, () => {
    console.log(`Salonnia App rodando na porta ${PORT}`);
});

// Lembrete semanal: todo domingo às 17h, avisa os salões com
// notificações ativadas pra darem uma olhada na agenda da semana.
// Ajuste o horário/dia mudando o padrão cron abaixo (minuto hora dia-do-mês mês dia-da-semana).
cron.schedule(
  "0 17 * * 0",
  async () => {
    console.log("Enviando lembrete de agendas flexíveis...");
    await notificarSaloesComAgendaFlexivel({
      titulo: "Publique os horários da próxima semana",
      corpo: "Sua agenda flexível mostra apenas os próximos 7 dias. Revise os horários para não pausar os agendamentos.",
      url: "/admin",
    });
  },
  { timezone: "America/Sao_Paulo" },
);

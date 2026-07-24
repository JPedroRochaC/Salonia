import "dotenv/config";
import express from "express";
import cors from "cors";
import cookieParser from "cookie-parser";
import path from "path";
import { fileURLToPath } from "url";
import cron from "node-cron";

import agendamentoRoutes from "./routes/agendamentoRoutes.js";
import authRoutes from "./routes/authRoutes.js";
import salaoRoutes from "./routes/salaoRoutes.js";
import dashboardRoutes from "./routes/dashboardRoutes.js";
import uploadRoutes from "./routes/uploadRoutes.js";
import faqRoutes from "./routes/faqRoutes.js";
import agendamentosAdminRoutes from "./routes/agendamentosAdminRoutes.js";
import servicosRoutes from "./routes/servicosRoutes.js";
import profissionaisRoutes from "./routes/profissionaisRoutes.js";
import portfolioRoutes from "./routes/portfolioRoutes.js";
import pushRoutes from "./routes/pushRoutes.js";
import { notificarTodosSaloes } from "./lib/pushNotificacoes.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

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
app.use("/admin/api/servicos", servicosRoutes);
app.use("/admin/api/profissionais", profissionaisRoutes);
app.use("/admin/api/portfolio", portfolioRoutes);
app.use("/admin/api/push", pushRoutes);

app.get("/api", (req, res) => {
    res.json({ status: "Salonia App online 🚀" });
});

// rotas do salão por slug
app.get("/:slug/agendar", (req, res) => {
    res.sendFile(path.join(__dirname, "..", "public", "salao", "index.html"));
});

app.get("/:slug/portfolio", (req, res) => {
    res.sendFile(path.join(__dirname, "..", "public", "salao", "index.html"));
});

app.get("/:slug", (req, res) => {
    res.sendFile(path.join(__dirname, "..", "public", "salao", "index.html"));
});

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
    console.log("Enviando lembrete semanal de agenda...");
    await notificarTodosSaloes({
      titulo: "Atualize sua agenda da semana",
      corpo: "Dá uma olhada nos agendamentos e horários disponíveis dessa semana.",
      url: "/admin",
    });
  },
  { timezone: "America/Sao_Paulo" },
);
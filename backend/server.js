import "dotenv/config";
import express from "express";
import cors from "cors";
import cookieParser from "cookie-parser";
import path from "path";
import { fileURLToPath } from "url";

import agendamentoRoutes from "./routes/agendamentoRoutes.js";
import authRoutes from "./routes/authRoutes.js";
import salaoRoutes from "./routes/salaoRoutes.js";
import dashboardRoutes from "./routes/dashboardRoutes.js";
import uploadRoutes from "./routes/uploadRoutes.js";
import faqRoutes from "./routes/faqRoutes.js";
import agendamentosAdminRoutes from "./routes/agendamentosAdminRoutes.js";

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

app.get("/api", (req, res) => {
    res.json({ status: "Salonnia App online 🚀" });
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
import express from "express";
import multer from "multer";
import { supabase } from "../config/supabase.js";
import { requireAuth } from "../middlewares/requireAuth.js";

const router = express.Router();

// guarda o arquivo em memória (não em disco) — ele é repassado direto pro
// Supabase Storage e descartado
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 5 * 1024 * 1024 }, // 5MB
  fileFilter: (req, file, cb) => {
    if (!file.mimetype.startsWith("image/")) {
      return cb(new Error("Envie um arquivo de imagem (jpg, png, webp...)."));
    }
    cb(null, true);
  },
});

// Nome do bucket no Supabase Storage. Precisa existir e estar público
// (Storage → New bucket → "uploads", marcar "Public bucket").
const BUCKET = "uploads";

router.post("/logo", requireAuth, (req, res) => {
  upload.single("arquivo")(req, res, async (erroUpload) => {
    if (erroUpload) {
      return res.status(400).json({ erro: erroUpload.message });
    }
    if (!req.file) {
      return res.status(400).json({ erro: "Nenhum arquivo enviado." });
    }

    const extensao = req.file.originalname.split(".").pop() || "png";
    const caminho = `logos/${req.salao.id}.${extensao}`;

    const { error: erroStorage } = await supabase.storage
      .from(BUCKET)
      .upload(caminho, req.file.buffer, {
        contentType: req.file.mimetype,
        upsert: true, // sobrescreve se já existir logo desse salão
      });

    if (erroStorage) {
      console.error("Erro ao enviar logo:", erroStorage);
      return res.status(500).json({ erro: "Erro ao enviar a imagem." });
    }

    const { data: urlPublica } = supabase.storage
      .from(BUCKET)
      .getPublicUrl(caminho);

    // adiciona um parâmetro pra "quebrar" cache do navegador quando a logo
    // é trocada (senão o navegador pode continuar mostrando a antiga)
    const urlComVersao = `${urlPublica.publicUrl}?v=${Date.now()}`;

    res.json({ ok: true, url: urlComVersao });
  });
});

// Upload genérico — usado pra foto de profissional e fotos de portfólio
// (diferente da logo: aqui cada envio gera um arquivo novo, nunca sobrescreve,
// porque pode ter várias fotos por salão).
// Uso: POST /admin/api/upload/imagem?pasta=profissionais
//      POST /admin/api/upload/imagem?pasta=portfolio
router.post("/imagem", requireAuth, (req, res) => {
  upload.single("arquivo")(req, res, async (erroUpload) => {
    if (erroUpload) {
      return res.status(400).json({ erro: erroUpload.message });
    }
    if (!req.file) {
      return res.status(400).json({ erro: "Nenhum arquivo enviado." });
    }

    const pasta = (req.query.pasta || "geral").replace(/[^a-z0-9_-]/gi, "");
    const extensao = req.file.originalname.split(".").pop() || "jpg";
    const nomeUnico = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}.${extensao}`;
    const caminho = `${pasta}/${req.salao.id}/${nomeUnico}`;

    const { error: erroStorage } = await supabase.storage
      .from(BUCKET)
      .upload(caminho, req.file.buffer, {
        contentType: req.file.mimetype,
      });

    if (erroStorage) {
      console.error("Erro ao enviar imagem:", erroStorage);
      return res.status(500).json({ erro: "Erro ao enviar a imagem." });
    }

    const { data: urlPublica } = supabase.storage
      .from(BUCKET)
      .getPublicUrl(caminho);

    res.json({ ok: true, url: urlPublica.publicUrl });
  });
});

export default router;

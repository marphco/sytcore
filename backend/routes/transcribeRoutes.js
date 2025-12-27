import express from "express";
import multer from "multer";
import fs from "fs";
import path from "path";
import { getOpenAIClient } from "../services/openaiClient.js";

const router = express.Router();

const UPLOAD_DIR = path.join(process.cwd(), "uploads");
if (!fs.existsSync(UPLOAD_DIR)) fs.mkdirSync(UPLOAD_DIR);

// ✅ Multer in memory (così rinominiamo noi con estensione)
const upload = multer({ storage: multer.memoryStorage() });

// ✅ helper: mime → estensione
function getExtFromMime(mime = "") {
  if (mime.includes("webm")) return "webm";
  if (mime.includes("ogg")) return "ogg";
  if (mime.includes("wav")) return "wav";
  if (mime.includes("mpeg")) return "mp3";
  if (mime.includes("mp4")) return "mp4";
  if (mime.includes("m4a")) return "m4a";
  return "webm"; // fallback
}

router.post("/transcribe-file", upload.single("audio"), async (req, res) => {
  try {
    console.log("✅ /transcribe-file called");

    if (!req.file) {
      return res.status(400).json({ success: false, error: "Missing audio file" });
    }

    const mimeType = req.file.mimetype || "";
    const ext = getExtFromMime(mimeType);

    // ✅ salva file con estensione corretta
    const filename = `voice-${Date.now()}.${ext}`;
    const filePath = path.join(UPLOAD_DIR, filename);

    fs.writeFileSync(filePath, req.file.buffer);

    console.log("📦 file saved:", filePath);
    console.log("🎛 mimeType:", mimeType);

    const client = getOpenAIClient();

    const transcription = await client.audio.transcriptions.create({
      file: fs.createReadStream(filePath),
      model: "gpt-4o-mini-transcribe",
    });

    // ✅ cleanup
    fs.unlinkSync(filePath);

    return res.json({
      success: true,
      transcript: transcription.text,
    });
  } catch (err) {
    console.error("🔥 TRANSCRIBE ERROR:", err);
    return res.status(500).json({
      success: false,
      error: err.message || "Transcription failed",
    });
  }
});

export default router;

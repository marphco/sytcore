import express from "express";
import fs from "fs";
import path from "path";
import { getOpenAIClient } from "../services/openaiClient.js";

const router = express.Router();

/**
 * POST /api/transcribe
 * body: { audioUrl: "http://localhost:5050/uploads/...." }
 */
router.post("/transcribe", async (req, res) => {
  try {
    // create client only when endpoint is called
    const client = getOpenAIClient();

    const { audioUrl } = req.body;

    if (!audioUrl) {
      return res
        .status(400)
        .json({ success: false, error: "audioUrl missing" });
    }

    const filename = audioUrl.split("/uploads/")[1];
    if (!filename) {
      return res
        .status(400)
        .json({ success: false, error: "Invalid audioUrl" });
    }

    const filePath = path.join("uploads", filename);

    if (!fs.existsSync(filePath)) {
      return res
        .status(404)
        .json({ success: false, error: "Audio file not found" });
    }

    const transcription = await client.audio.transcriptions.create({
      file: fs.createReadStream(filePath),
      model: "gpt-4o-mini-transcribe",
    });

    return res.json({
      success: true,
      transcript: transcription.text,
    });
  } catch (err) {
    console.error(err);

    if (err.message?.includes("OPENAI_API_KEY")) {
      return res.status(500).json({
        success: false,
        error: "Missing OPENAI_API_KEY in backend/.env",
      });
    }

    return res
      .status(500)
      .json({ success: false, error: "Transcription failed" });
  }
});

export default router;

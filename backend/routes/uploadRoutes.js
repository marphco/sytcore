import express from "express";
import multer from "multer";
import fs from "fs";

const router = express.Router();

// Ensure uploads folder exists
if (!fs.existsSync("uploads")) fs.mkdirSync("uploads");

// Multer storage config
const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, "uploads"),
  filename: (req, file, cb) => {
    const unique = Date.now() + "-" + Math.round(Math.random() * 1e9);
    cb(null, `${unique}-${file.originalname}`);
  },
});

// Optional: filter accepted file types (we keep it permissive for MVP)
const upload = multer({ storage });

/**
 * POST /api/upload
 * form-data:
 * - audio: file (optional)
 * - photos: multiple files (optional)
 */
router.post(
  "/upload",
  upload.fields([
    { name: "audio", maxCount: 1 },
    { name: "photos", maxCount: 10 },
  ]),
  (req, res) => {
    try {
      const audio = req.files?.audio?.[0] || null;
      const photos = req.files?.photos || [];

      const baseUrl = `${req.protocol}://${req.get("host")}`;

      res.json({
        success: true,
        audioUrl: audio ? `${baseUrl}/uploads/${audio.filename}` : null,
        photoUrls: photos.map((p) => `${baseUrl}/uploads/${p.filename}`),
      });
    } catch (err) {
      console.error(err);
      res.status(500).json({ success: false, error: "Upload failed" });
    }
  }
);

export default router;

import express from "express";
import cors from "cors";
import dotenv from "dotenv";
import uploadRoutes from "./routes/uploadRoutes.js";
import transcribeRoutes from "./routes/transcribeRoutes.js";

dotenv.config();

const app = express();

app.use(cors());
app.use(express.json());

// serve uploaded files
app.use("/uploads", express.static("uploads"));

// routes
app.use("/api", uploadRoutes);
app.use("/api", transcribeRoutes);

app.get("/", (req, res) => {
  res.send("SYTCORE API running ✅");
});

const PORT = Number(process.env.PORT);

if (!PORT) {
  throw new Error("PORT missing in Railway environment");
}

app.listen(PORT, "0.0.0.0", () => {
  console.log(`✅ Backend running on port ${PORT}`);
});

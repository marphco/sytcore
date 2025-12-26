import express from "express";
import cors from "cors";
import dotenv from "dotenv";
import uploadRoutes from "./routes/uploadRoutes.js";

dotenv.config();

const app = express();

app.use(cors());
app.use(express.json());

// serve uploaded files
app.use("/uploads", express.static("uploads"));

// routes
app.use("/api", uploadRoutes);

app.get("/", (req, res) => {
  res.send("SYTCORE API running ✅");
});

const PORT = process.env.PORT || 5050;

app.listen(PORT, () => {
  console.log(`✅ Backend running on port ${PORT}`);
});

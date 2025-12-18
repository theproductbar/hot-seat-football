const express = require("express");
const path = require("path");
const fs = require("fs");
const fetch = require("node-fetch");
const csv = require("csv-parser");
const { Readable } = require("stream");

const app = express();

/* =========================
   🔧 EDIT THESE TWO URLS
   ========================= */
const PLAYERS_SHEET_URL =
  "https://docs.google.com/spreadsheets/d/e/2PACX-1vRIMCJ5p9eKQVDF6JJDQtmVReVKAfBCONhJREqwIbZhGCQhXWzS_mgsvj5R1aKVSPijcQnwHZp5Ou9h/pub?gid=0&single=true&output=csv";

const RECEIVERS_SHEET_URL =
  "https://docs.google.com/spreadsheets/d/e/2PACX-1vTtu7v4mJGbM04kyQMYKWp2Lm5utgZV9nPF8oqRUU23vLTW6NFGGLohOC7RW126eX59snf0aHEBlOcp/pub?gid=0&single=true&output=csv";

/* =========================
   Static files
   ========================= */
const PUBLIC_DIR = path.join(__dirname, "public");
app.use(express.static(PUBLIC_DIR));

/* =========================
   ✅ Explicit pages (fixes /admin.html 404 on Vercel)
   ========================= */
app.get("/", (req, res) => {
  res.sendFile(path.join(PUBLIC_DIR, "index.html"));
});

app.get("/index.html", (req, res) => {
  res.sendFile(path.join(PUBLIC_DIR, "index.html"));
});

app.get("/admin.html", (req, res) => {
  res.sendFile(path.join(PUBLIC_DIR, "admin.html"));
});

/* =========================
   Random Image (UNCHANGED)
   ========================= */
app.get("/api/random-image", (req, res) => {
  const type = (req.query.type || "QB").toLowerCase();

  const folder =
    type === "receiver"
      ? path.join(__dirname, "public", "images", "Receiver")
      : path.join(__dirname, "public", "images", "QB");

  let files;
  try {
    files = fs.readdirSync(folder).filter(f =>
      /\.(png|jpg|jpeg|webp)$/i.test(f)
    );
  } catch {
    return res.status(500).json({ error: "Image folder not found" });
  }

  if (!files.length)
    return res.status(500).json({ error: "No images found" });

  const pick = files[Math.floor(Math.random() * files.length)];
  res.json({
    url: `/images/${type === "receiver" ? "Receiver" : "QB"}/${pick}`
  });
});

/* =========================
   CSV helper
   ========================= */
async function readCSV(url, column) {
  const res = await fetch(url);
  if (!res.ok) throw new Error("Failed to fetch CSV");

  const text = await res.text();
  const values = [];

  return new Promise((resolve, reject) => {
    Readable.from(text)
      .pipe(csv())
      .on("data", row => {
        if (row[column]) values.push(String(row[column]).trim());
      })
      .on("end", () => resolve(values))
      .on("error", reject);
  });
}

/* =========================
   Random Player (QB PASS)
   ========================= */
app.get("/api/random-player", async (req, res) => {
  try {
    const players = await readCSV(PLAYERS_SHEET_URL, "name");
    if (!players.length)
      return res.status(500).json({ error: "No players found" });

    res.json({
      name: players[Math.floor(Math.random() * players.length)]
    });
  } catch (err) {
    res.status(500).json({
      error: "Failed to read players sheet",
      details: err.message
    });
  }
});

/* =========================
   Random Receiver Catch
   ========================= */
app.get("/api/random-catch", async (req, res) => {
  try {
    const catches = await readCSV(RECEIVERS_SHEET_URL, "catch");
    if (!catches.length)
      return res.status(500).json({ error: "No catches found" });

    res.json({
      catch: catches[Math.floor(Math.random() * catches.length)]
    });
  } catch (err) {
    res.status(500).json({
      error: "Failed to read receivers sheet",
      details: err.message
    });
  }
});

/* =========================
   Health check
   ========================= */
app.get("/api/health", (_, res) => {
  res.json({ ok: true });
});

/* =========================
   Start server
   ========================= */
const PORT = process.env.PORT || 3000;
app.listen(PORT, () =>
  console.log(`Server running on http://localhost:${PORT}`)
);
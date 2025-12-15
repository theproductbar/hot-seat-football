// ===============================
// REQUIRED IMPORTS
// ===============================
const express = require("express");
const path = require("path");
const fs = require("fs");
const csv = require("csv-parser"); // ✅ FIXES csv is not defined

const app = express();
const PORT = process.env.PORT || 3000;

// ===============================
// STATIC FILES
// ===============================
app.use(express.static(path.join(__dirname, "public")));

// ===============================
// HELPER: READ CSV FILE
// ===============================
function readCsv(filePath) {
  return new Promise((resolve, reject) => {
    const rows = [];

    fs.createReadStream(filePath)
      .on("error", reject)
      .pipe(csv())
      .on("data", (row) => rows.push(row))
      .on("end", () => resolve(rows))
      .on("error", reject);
  });
}

function getFirstValue(row) {
  if (!row) return null;
  const key = Object.keys(row)[0];
  return row[key] ? String(row[key]).trim() : null;
}

// ===============================
// RANDOM IMAGE (SINGLE)
// ===============================
app.get("/api/random-image", (req, res) => {
  const type = (req.query.type || "QB").toLowerCase();

  const folder =
    type === "receiver"
      ? path.join(__dirname, "public", "images", "Receiver")
      : path.join(__dirname, "public", "images", "QB");

  let files;
  try {
    files = fs
      .readdirSync(folder)
      .filter((f) => /\.(png|jpg|jpeg|webp)$/i.test(f));
  } catch (err) {
    return res.status(500).json({
      error: "Folder not found",
      folder
    });
  }

  if (!files.length) {
    return res.status(500).json({ error: "No images found" });
  }

  const pick = files[Math.floor(Math.random() * files.length)];
  res.json({
    url: `/images/${type === "receiver" ? "Receiver" : "QB"}/${pick}`
  });
});

// ===============================
// RANDOM IMAGE BATCH (CASINO SPIN)
// ===============================
app.get("/api/random-image-batch", (req, res) => {
  const type = (req.query.type || "QB").toLowerCase();
  const n = Math.min(parseInt(req.query.n || "60", 10), 200);

  const folder =
    type === "receiver"
      ? path.join(__dirname, "public", "images", "Receiver")
      : path.join(__dirname, "public", "images", "QB");

  let files;
  try {
    files = fs
      .readdirSync(folder)
      .filter((f) => /\.(png|jpg|jpeg|webp)$/i.test(f));
  } catch (err) {
    return res.status(500).json({
      error: "Folder not found",
      folder
    });
  }

  if (!files.length) {
    return res.status(500).json({ error: "No images found" });
  }

  const urls = Array.from({ length: n }, () => {
    const pick = files[Math.floor(Math.random() * files.length)];
    return `/images/${type === "receiver" ? "Receiver" : "QB"}/${pick}`;
  });

  res.json({ urls });
});

// ===============================
// RANDOM PLAYER (players.csv)
// ===============================
app.get("/api/random-player", async (req, res) => {
  try {
    const filePath = path.join(__dirname, "players.csv");
    const rows = await readCsv(filePath);

    if (!rows.length) {
      return res.status(500).json({ error: "players.csv is empty" });
    }

    const row = rows[Math.floor(Math.random() * rows.length)];
    const name =
      row.name ||
      row.player ||
      row.Player ||
      row.Name ||
      getFirstValue(row);

    if (!name) {
      return res.status(500).json({
        error: "No valid player name found",
        sample: row
      });
    }

    res.json({ name });
  } catch (err) {
    res.status(500).json({
      error: "Failed to read players.csv",
      details: err.message
    });
  }
});

// ===============================
// RANDOM CATCH (Receiver.csv)
// ===============================
app.get("/api/random-catch", async (req, res) => {
  try {
    const filePath = path.join(__dirname, "Receiver.csv");
    const rows = await readCsv(filePath);

    if (!rows.length) {
      return res.status(500).json({ error: "Receiver.csv is empty" });
    }

    const row = rows[Math.floor(Math.random() * rows.length)];
    const catchText =
      row.catch ||
      row.result ||
      row.play ||
      row.Catch ||
      row.Result ||
      getFirstValue(row);

    if (!catchText) {
      return res.status(500).json({
        error: "No valid catch text found",
        sample: row
      });
    }

    res.json({ catch: catchText });
  } catch (err) {
    res.status(500).json({
      error: "Failed to read Receiver.csv",
      details: err.message
    });
  }
});

// ===============================
// START SERVER
// ===============================
app.listen(PORT, () => {
  console.log(`✅ Server running at http://localhost:${PORT}`);
});
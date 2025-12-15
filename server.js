const express = require("express");
const path = require("path");
const fs = require("fs");

const app = express();
const PORT = process.env.PORT || 3000;

// Serve your front-end + images
app.use(express.static(path.join(__dirname, "public")));

// -----------------------------
// HELPERS
// -----------------------------
function firstExistingPath(...paths) {
  for (const p of paths) {
    if (fs.existsSync(p)) return p;
  }
  return null;
}

// Normalize keys: trim + lower + remove BOM
function normalizeKey(k) {
  return String(k || "")
    .replace(/^\uFEFF/, "") // BOM
    .trim()
    .toLowerCase();
}

function pickValueFromRow(row, preferredKey) {
  if (!row || typeof row !== "object") return undefined;

  // Build normalized map
  const entries = Object.entries(row).map(([k, v]) => [normalizeKey(k), v]);
  const map = Object.fromEntries(entries);

  // 1) preferred key
  if (preferredKey && map[preferredKey]) return String(map[preferredKey]).trim();

  // 2) first non-empty cell
  for (const [, v] of entries) {
    const val = String(v ?? "").trim();
    if (val) return val;
  }
  return undefined;
}

function getRandomFromCSV(filePath, preferredKeyLower) {
  return new Promise((resolve, reject) => {
    const rows = [];

    fs.createReadStream(filePath)
      .pipe(
        csv({
          mapHeaders: ({ header }) => normalizeKey(header),
          skipLines: 0,
        })
      )
      .on("data", (row) => rows.push(row))
      .on("end", () => {
        if (!rows.length) return reject(new Error("CSV empty"));

        // Try a few times to avoid picking an empty row
        for (let i = 0; i < 10; i++) {
          const pick = rows[Math.floor(Math.random() * rows.length)];
          const val = pickValueFromRow(pick, preferredKeyLower);
          if (val) return resolve(val);
        }

        reject(new Error("No usable value found in CSV"));
      })
      .on("error", (err) => reject(err));
  });
}

function getRandomImageFromFolder(folder, subFolder) {
  const files = fs
    .readdirSync(folder)
    .filter((f) => /\.(png|jpg|jpeg|webp)$/i.test(f));

  if (!files.length) throw new Error("No images found");

  const pick = files[Math.floor(Math.random() * files.length)];
  return `/images/${subFolder}/${pick}`;
}

// -----------------------------
// API: RANDOM SINGLE IMAGE
// -----------------------------
app.get("/api/random-image", (req, res) => {
  try {
    const type = (req.query.type || "QB").toLowerCase();

    const folder =
      type === "receiver"
        ? path.join(__dirname, "public", "images", "Receiver")
        : path.join(__dirname, "public", "images", "QB");

    const sub = type === "receiver" ? "Receiver" : "QB";

    const url = getRandomImageFromFolder(folder, sub);
    res.json({ url });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// -----------------------------
// API: RANDOM IMAGE BATCH (FAST SPIN)
// -----------------------------
app.get("/api/random-image-batch", (req, res) => {
  const type = (req.query.type || "QB").toLowerCase();
  const n = Math.min(parseInt(req.query.n || "60", 10), 200);

  const folder =
    type === "receiver"
      ? path.join(__dirname, "public", "images", "Receiver")
      : path.join(__dirname, "public", "images", "QB");

  let files = [];
  try {
    files = fs
      .readdirSync(folder)
      .filter((f) => /\.(png|jpg|jpeg|webp)$/i.test(f));
  } catch (e) {
    return res.status(500).json({ error: "Folder not found", folder });
  }

  if (!files.length) return res.status(500).json({ error: "No images found" });

  const urls = Array.from({ length: n }, () => {
    const pick = files[Math.floor(Math.random() * files.length)];
    return `/images/${type === "receiver" ? "Receiver" : "QB"}/${pick}`;
  });

  res.json({ urls });
});

// -----------------------------
// API: RANDOM PLAYER (QB PASS)
// players.csv can have column "name" OR any single column
// -----------------------------
app.get("/api/random-player", async (req, res) => {
  try {
    const playersPath = firstExistingPath(
      path.join(__dirname, "players.csv"),
      path.join(__dirname, "Players.csv")
    );
    if (!playersPath) return res.status(500).json({ error: "players.csv not found" });

    const name = await getRandomFromCSV(playersPath, "name");
    res.json({ name });
  } catch (e) {
    res.status(500).json({ error: "Failed to read players.csv", details: String(e.message || e) });
  }
});

// -----------------------------
// API: RANDOM CATCH (RECEIVER)
// Receiver.csv can have column "catch" OR any single column
// -----------------------------
app.get("/api/random-catch", async (req, res) => {
  try {
    const receiverPath = firstExistingPath(
      path.join(__dirname, "Receiver.csv"),
      path.join(__dirname, "receiver.csv")
    );
    if (!receiverPath) return res.status(500).json({ error: "Receiver.csv not found" });

    const result = await getRandomFromCSV(receiverPath, "catch");
    res.json({ catch: result });
  } catch (e) {
    res.status(500).json({ error: "Failed to read Receiver.csv", details: String(e.message || e) });
  }
});

// -----------------------------
// FALLBACK (HTML)
// -----------------------------
app.get("*", (req, res) => {
  res.sendFile(path.join(__dirname, "public", "index.html"));
});

// -----------------------------
// START SERVER
// -----------------------------
app.listen(PORT, () => {
  console.log(`Server running: http://localhost:${PORT}`);
});
const express = require("express");
<<<<<<< HEAD
const fs = require("fs");
const path = require("path");
const csv = require("csv-parser");
=======
const path = require("path");
const fs = require("fs");
>>>>>>> 8c5791d (Add files via upload)

const app = express();
const PORT = process.env.PORT || 3000;

<<<<<<< HEAD
// -----------------------------
// STATIC FILES
// -----------------------------
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
  console.log(`✅ Server running on port ${PORT}`);
=======
// Serve your front-end + images
app.use(express.static(path.join(__dirname, "public")));

// ---------- CSV helpers ----------
function loadCsvLines(filePath) {
  if (!fs.existsSync(filePath)) return [];

  const raw = fs.readFileSync(filePath, "utf8");

  // split lines, trim, remove empties
  let lines = raw
    .split(/\r?\n/)
    .map(l => l.trim())
    .filter(Boolean);

  if (lines.length === 0) return [];

  // If first line looks like a header (contains letters and not a "real" value), drop it.
  // Example header: "name" or "player"
  const first = lines[0].toLowerCase();
  if (first.includes("name") || first.includes("player") || first.includes("catch")) {
    lines = lines.slice(1);
  }

  // If CSV has commas, take first column only
  lines = lines.map(l => l.split(",")[0].trim()).filter(Boolean);

  return lines;
}

function pickRandom(arr) {
  if (!arr || arr.length === 0) return null;
  return arr[Math.floor(Math.random() * arr.length)];
}

// IMPORTANT: these match your filenames EXACTLY
const PLAYERS_CSV_PATH = path.join(__dirname, "players.csv");
const RECEIVER_CSV_PATH = path.join(__dirname, "Receiver.csv");

// Load once at startup (simple + fast)
let playersList = loadCsvLines(PLAYERS_CSV_PATH);
let catchesList = loadCsvLines(RECEIVER_CSV_PATH);

// Health check (super useful)
app.get("/api/health", (req, res) => {
  res.json({
    ok: true,
    playersCount: playersList.length,
    catchesCount: catchesList.length,
    playersFile: fs.existsSync(PLAYERS_CSV_PATH),
    receiverFile: fs.existsSync(RECEIVER_CSV_PATH),
  });
});

// Random player
app.get("/api/random-player", (req, res) => {
  // Reload on each call (optional) so you can edit CSV without restarting:
  playersList = loadCsvLines(PLAYERS_CSV_PATH);

  const name = pickRandom(playersList);
  if (!name) return res.status(500).json({ error: "No players found in players.csv" });

  res.json({ name });
});

// Random catch
app.get("/api/random-catch", (req, res) => {
  // Reload on each call (optional) so you can edit CSV without restarting:
  catchesList = loadCsvLines(RECEIVER_CSV_PATH);

  const c = pickRandom(catchesList);
  if (!c) return res.status(500).json({ error: "No catches found in Receiver.csv" });

  res.json({ catch: c });
});

// Random image (QB or Receiver)
app.get("/api/random-image", (req, res) => {
  const type = (req.query.type || "QB").toString();

  const folder =
    type.toLowerCase() === "receiver"
      ? path.join(__dirname, "public", "images", "Receiver")
      : path.join(__dirname, "public", "images", "QB");

  if (!fs.existsSync(folder)) {
    return res.status(500).json({ error: `Folder not found: ${folder}` });
  }

  const files = fs
    .readdirSync(folder)
    .filter(f => /\.(png|jpg|jpeg|webp)$/i.test(f));

  if (files.length === 0) {
    return res.status(500).json({ error: `No images in: ${folder}` });
  }

  const file = pickRandom(files);
  const url = `/images/${type.toLowerCase() === "receiver" ? "Receiver" : "QB"}/${file}`;
  res.json({ url });
});

app.listen(PORT, () => {
  console.log(`Server running: http://localhost:${PORT}`);
>>>>>>> 8c5791d (Add files via upload)
});
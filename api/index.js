const express = require("express");
const path = require("path");
const fs = require("fs");
const fetch = require("node-fetch");
const csv = require("csv-parser");
const { Readable } = require("stream");
const { google } = require("googleapis");

const app = express();
app.use(express.json());

/* =========================
   ENV helpers
   ========================= */
function mustEnv(name) {
  const v = process.env[name];
  if (!v) throw new Error(`Missing env var: ${name}`);
  return v;
}

function getServiceAccountJSON() {
  // Support either raw JSON env var OR base64 env var
  const raw = process.env.GOOGLE_SERVICE_ACCOUNT_JSON;
  const b64 = process.env.GOOGLE_SERVICE_ACCOUNT_JSON_B64;

  if (raw) return JSON.parse(raw);

  if (b64) {
    const decoded = Buffer.from(b64, "base64").toString("utf-8").trim();
    return JSON.parse(decoded);
  }

  throw new Error(
    "Missing env var: GOOGLE_SERVICE_ACCOUNT_JSON or GOOGLE_SERVICE_ACCOUNT_JSON_B64"
  );
}

const PLAYERS_SHEET_ID = mustEnv("PLAYERS_SHEET_ID");
const PLAYERS_TAB_NAME = mustEnv("PLAYERS_TAB_NAME"); // e.g. ReceiverPlayers
const RECEIVERS_SHEET_URL = mustEnv("RECEIVERS_SHEET_URL"); // published CSV URL

/* =========================
   Static files
   ========================= */
app.use(express.static(path.join(__dirname, "..", "public")));

/* =========================
   Random Image
   ========================= */
app.get("/api/random-image", (req, res) => {
  const type = (req.query.type || "QB").toLowerCase();

  const folder =
    type === "receiver"
      ? path.join(__dirname, "..", "public", "images", "Receiver")
      : path.join(__dirname, "..", "public", "images", "QB");

  let files;
  try {
    files = fs
      .readdirSync(folder)
      .filter((f) => /\.(png|jpg|jpeg|webp)$/i.test(f));
  } catch {
    return res.status(500).json({ error: "Image folder not found" });
  }

  if (!files.length) return res.status(500).json({ error: "No images found" });

  const pick = files[Math.floor(Math.random() * files.length)];
  res.json({
    url: `/images/${type === "receiver" ? "Receiver" : "QB"}/${pick}`,
  });
});

/* =========================
   Receivers (Published CSV)
   mode=normal -> column "catch"
   mode=sb     -> column "final"
   ========================= */
async function readCSV(url, column) {
  const r = await fetch(url);
  if (!r.ok) throw new Error(`Failed to fetch CSV (${r.status})`);
  const text = await r.text();

  const values = [];
  return new Promise((resolve, reject) => {
    Readable.from(text)
      .pipe(csv())
      .on("data", (row) => {
        if (row[column]) values.push(String(row[column]).trim());
      })
      .on("end", () => resolve(values))
      .on("error", reject);
  });
}

app.get("/api/random-catch", async (req, res) => {
  try {
    const mode = String(req.query.mode || "normal").toLowerCase();
    const column = mode === "sb" ? "final" : "catch";

    let results = await readCSV(RECEIVERS_SHEET_URL, column);

    // Fallback if "final" is empty/missing
    if (!results.length && column === "final") {
      results = await readCSV(RECEIVERS_SHEET_URL, "catch");
    }

    if (!results.length)
      return res.status(500).json({ error: "No catches found" });

    res.json({ catch: results[Math.floor(Math.random() * results.length)] });
  } catch (err) {
    res
      .status(500)
      .json({ error: "Failed to read receivers sheet", details: err.message });
  }
});

/* =========================
   Players (Google Sheets API) - Admin Managed
   Sheet must have header row with column name: "name"
   ========================= */
async function getSheetsClient() {
  const sa = getServiceAccountJSON();

  const auth = new google.auth.JWT({
    email: sa.client_email,
    key: sa.private_key,
    scopes: ["https://www.googleapis.com/auth/spreadsheets"],
  });

  await auth.authorize();
  return google.sheets({ version: "v4", auth });
}

function a1Range(tabName) {
  return `${tabName}!A:A`; // Column A = "name"
}

async function readPlayersFromSheet() {
  const sheets = await getSheetsClient();

  const resp = await sheets.spreadsheets.values.get({
    spreadsheetId: PLAYERS_SHEET_ID,
    range: a1Range(PLAYERS_TAB_NAME),
  });

  const rows = resp.data.values || [];

  // Expect header in first row, names below
  const names = rows
    .slice(1)
    .map((r) => (r[0] || "").trim())
    .filter(Boolean);

  // Make unique while keeping order
  const seen = new Set();
  const unique = [];
  for (const n of names) {
    const k = n.toLowerCase();
    if (!seen.has(k)) {
      seen.add(k);
      unique.push(n);
    }
  }
  return unique;
}

/* ✅ FIX HERE:
   When we delete someone, the new list can be shorter.
   Google Sheets UPDATE does NOT clear leftover old rows.
   So we CLEAR the column first, then write the new list.
*/
async function writePlayersToSheet(players) {
  const sheets = await getSheetsClient();

  // 1) Clear column A fully (removes leftovers from previous longer list)
  await sheets.spreadsheets.values.clear({
    spreadsheetId: PLAYERS_SHEET_ID,
    range: `${PLAYERS_TAB_NAME}!A:A`,
  });

  // 2) Write header + list back from the top
  const values = [["name"], ...players.map((n) => [n])];

  await sheets.spreadsheets.values.update({
    spreadsheetId: PLAYERS_SHEET_ID,
    range: `${PLAYERS_TAB_NAME}!A1`,
    valueInputOption: "RAW",
    requestBody: { values },
  });
}

/* ===== Game API uses players ===== */
app.get("/api/random-player", async (req, res) => {
  try {
    const players = await readPlayersFromSheet();
    if (!players.length)
      return res.status(500).json({ error: "No players found" });

    res.json({ name: players[Math.floor(Math.random() * players.length)] });
  } catch (err) {
    res
      .status(500)
      .json({ error: "Failed to read players sheet", details: err.message });
  }
});

/* ===== Admin API ===== */
app.get("/api/admin/receiver-players", async (req, res) => {
  try {
    const players = await readPlayersFromSheet();
    res.json({ players });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post("/api/admin/receiver-players", async (req, res) => {
  try {
    const name = String(req.body?.name || "").trim();
    if (!name) return res.status(400).json({ error: "Missing name" });

    const players = await readPlayersFromSheet();

    // prevent duplicates
    const exists = players.some((p) => p.toLowerCase() === name.toLowerCase());
    if (!exists) players.push(name);

    await writePlayersToSheet(players);

    res.json({ players });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.delete("/api/admin/receiver-players", async (req, res) => {
  try {
    const name = String(req.body?.name || "").trim();
    if (!name) return res.status(400).json({ error: "Missing name" });

    const players = await readPlayersFromSheet();
    const filtered = players.filter((p) => p.toLowerCase() !== name.toLowerCase());

    await writePlayersToSheet(filtered);

    res.json({ players: filtered });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

/* =========================
   Health check
   ========================= */
app.get("/api/health", (_, res) => res.json({ ok: true }));

module.exports = app;
const express = require("express");
const path = require("path");
const fs = require("fs");
const fetch = require("node-fetch");
const csv = require("csv-parser");
const { Readable } = require("stream");
require("dotenv").config();

const { google } = require("googleapis");

const app = express();
app.use(express.json()); // ✅ REQUIRED for POST/DELETE JSON body

/* =========================
   ENV helpers
   ========================= */
function mustEnv(name) {
  const v = process.env[name];
  if (!v) throw new Error(`Missing env var: ${name}`);
  return v;
}

const PLAYERS_SHEET_ID = mustEnv("PLAYERS_SHEET_ID");
const PLAYERS_TAB_NAME = mustEnv("PLAYERS_TAB_NAME");
const RECEIVERS_SHEET_URL = mustEnv("RECEIVERS_SHEET_URL");

// If you use base64 env var
const GOOGLE_SERVICE_ACCOUNT_JSON_B64 = process.env.GOOGLE_SERVICE_ACCOUNT_JSON_B64 || "";
// Some older versions used GOOGLE_SERVICE_ACCOUNT_JSON
const GOOGLE_SERVICE_ACCOUNT_JSON = process.env.GOOGLE_SERVICE_ACCOUNT_JSON || "";

/* =========================
   Static files
   ========================= */
app.use(express.static(path.join(__dirname, "public")));

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
    files = fs.readdirSync(folder).filter((f) => /\.(png|jpg|jpeg|webp)$/i.test(f));
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
   CSV helper (Receivers sheet)
   ========================= */
async function readCSV(url, column) {
  const res = await fetch(url);
  if (!res.ok) throw new Error("Failed to fetch CSV");

  const text = await res.text();
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

/* =========================
   Google Sheets Admin (Players sheet)
   ========================= */
function getServiceAccountJSON() {
  // Prefer base64 if present (best for .env and Vercel)
  if (GOOGLE_SERVICE_ACCOUNT_JSON_B64) {
    const decoded = Buffer.from(GOOGLE_SERVICE_ACCOUNT_JSON_B64, "base64").toString("utf-8");
    return JSON.parse(decoded);
  }
  // Fallback: raw JSON string in env
  if (GOOGLE_SERVICE_ACCOUNT_JSON) {
    return JSON.parse(GOOGLE_SERVICE_ACCOUNT_JSON);
  }
  throw new Error("Missing env var: GOOGLE_SERVICE_ACCOUNT_JSON_B64 (or GOOGLE_SERVICE_ACCOUNT_JSON)");
}

function normName(s) {
  return String(s || "")
    .trim()
    .replace(/\s+/g, " ")
    .toLowerCase();
}

function isHeaderRow(val) {
  return normName(val) === "name";
}

function getSheetsClient() {
  const sa = getServiceAccountJSON();

  const auth = new google.auth.JWT({
    email: sa.client_email,
    key: sa.private_key,
    scopes: ["https://www.googleapis.com/auth/spreadsheets"],
  });

  return google.sheets({ version: "v4", auth });
}

// ✅ Prevent double-appends when two requests hit at same time
let playersWriteLock = Promise.resolve();
function withPlayersLock(fn) {
  playersWriteLock = playersWriteLock.then(fn, fn);
  return playersWriteLock;
}

async function getPlayersList(sheets) {
  const range = `${PLAYERS_TAB_NAME}!A:A`;
  const resp = await sheets.spreadsheets.values.get({
    spreadsheetId: PLAYERS_SHEET_ID,
    range,
  });

  const rows = resp.data.values || [];
  const raw = rows.map((r) => (r && r[0] ? String(r[0]) : "")).filter(Boolean);

  // Remove header + blanks
  const cleaned = raw.filter((v) => !isHeaderRow(v) && normName(v));

  return cleaned;
}

async function appendPlayerIfMissing(sheets, name) {
  const clean = String(name || "").trim().replace(/\s+/g, " ");
  const key = normName(clean);
  if (!key) throw new Error("Missing name");

  const existing = await getPlayersList(sheets);
  const exists = existing.some((p) => normName(p) === key);

  // ✅ If it already exists, DO NOT append again
  if (exists) return { added: false, players: dedupe(existing) };

  await sheets.spreadsheets.values.append({
    spreadsheetId: PLAYERS_SHEET_ID,
    range: `${PLAYERS_TAB_NAME}!A:A`,
    valueInputOption: "RAW",
    insertDataOption: "INSERT_ROWS",
    requestBody: { values: [[clean]] },
  });

  const updated = await getPlayersList(sheets);
  return { added: true, players: dedupe(updated) };
}

async function deletePlayerAllMatches(sheets, name) {
  const clean = String(name || "").trim().replace(/\s+/g, " ");
  const key = normName(clean);
  if (!key) throw new Error("Missing name");

  // Read all values with row indexes (A:A)
  const range = `${PLAYERS_TAB_NAME}!A:A`;
  const resp = await sheets.spreadsheets.values.get({
    spreadsheetId: PLAYERS_SHEET_ID,
    range,
  });

  const rows = resp.data.values || [];
  // rows is 0-indexed array, but sheet rows are 1-indexed
  const matches = [];
  for (let i = 0; i < rows.length; i++) {
    const v = rows[i]?.[0] ? String(rows[i][0]) : "";
    if (!v) continue;
    if (isHeaderRow(v)) continue;
    if (normName(v) === key) {
      matches.push(i + 1); // row number in sheet
    }
  }

  if (!matches.length) return { deleted: 0 };

  // Delete from bottom to top so row numbers stay valid
  matches.sort((a, b) => b - a);

  // Need sheetId (numeric) to do deleteDimension
  const meta = await sheets.spreadsheets.get({ spreadsheetId: PLAYERS_SHEET_ID });
  const sheet = (meta.data.sheets || []).find((s) => s.properties.title === PLAYERS_TAB_NAME);
  if (!sheet) throw new Error(`Tab not found: ${PLAYERS_TAB_NAME}`);
  const sheetId = sheet.properties.sheetId;

  const requests = matches.map((rowNum) => ({
    deleteDimension: {
      range: {
        sheetId,
        dimension: "ROWS",
        startIndex: rowNum - 1, // 0-indexed start
        endIndex: rowNum,       // exclusive
      },
    },
  }));

  await sheets.spreadsheets.batchUpdate({
    spreadsheetId: PLAYERS_SHEET_ID,
    requestBody: { requests },
  });

  return { deleted: matches.length };
}

function dedupe(list) {
  const seen = new Set();
  const out = [];
  for (const n of list) {
    const k = normName(n);
    if (!k) continue;
    if (seen.has(k)) continue;
    seen.add(k);
    out.push(n);
  }
  return out;
}

/* =========================
   Admin API (Players)
   ========================= */
app.get("/api/admin/receiver-players", async (req, res) => {
  try {
    const sheets = getSheetsClient();
    const players = dedupe(await getPlayersList(sheets));
    res.json({ players });
  } catch (e) {
    res.status(500).json({ error: e.message || "Failed to load players" });
  }
});

app.post("/api/admin/receiver-players", async (req, res) => {
  const name = req.body?.name;
  try {
    const result = await withPlayersLock(async () => {
      const sheets = getSheetsClient();
      return appendPlayerIfMissing(sheets, name);
    });
    res.json({ ok: true, added: result.added, players: result.players });
  } catch (e) {
    res.status(400).json({ error: e.message || "Failed to add" });
  }
});

app.delete("/api/admin/receiver-players", async (req, res) => {
  // accept either JSON body or query param as fallback
  const name = req.body?.name || req.query?.name;

  try {
    const result = await withPlayersLock(async () => {
      const sheets = getSheetsClient();
      const del = await deletePlayerAllMatches(sheets, name);
      const players = dedupe(await getPlayersList(sheets));
      return { del, players };
    });

    res.json({ ok: true, deleted: result.del.deleted, players: result.players });
  } catch (e) {
    res.status(400).json({ error: e.message || "Failed to delete" });
  }
});

/* =========================
   Random Player (QB PASS) — uses Players sheet
   ========================= */
app.get("/api/random-player", async (req, res) => {
  try {
    const sheets = getSheetsClient();
    const players = dedupe(await getPlayersList(sheets));
    if (!players.length) return res.status(500).json({ error: "No players found" });
    res.json({ name: players[Math.floor(Math.random() * players.length)] });
  } catch (e) {
    res.status(500).json({ error: "Failed to read players sheet", details: e.message });
  }
});

/* =========================
   Random Receiver Catch — uses RECEIVERS_SHEET_URL CSV (separate sheet)
   ========================= */
app.get("/api/random-catch", async (req, res) => {
  try {
    const catches = await readCSV(RECEIVERS_SHEET_URL, "catch");
    if (!catches.length) return res.status(500).json({ error: "No catches found" });
    res.json({ catch: catches[Math.floor(Math.random() * catches.length)] });
  } catch (e) {
    res.status(500).json({ error: "Failed to read receivers sheet", details: e.message });
  }
});

/* =========================
   Health check
   ========================= */
app.get("/api/health", (_, res) => res.json({ ok: true }));

/* =========================
   Start server
   ========================= */
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Server running on http://localhost:${PORT}`));
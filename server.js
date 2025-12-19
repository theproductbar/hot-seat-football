require("dotenv").config();
const express = require("express");
const path = require("path");
const fs = require("fs");
const fetch = require("node-fetch");
const csv = require("csv-parser");
const { Readable } = require("stream");
const { google } = require("googleapis");

const app = express();

// ---------------------------
// Middleware
// ---------------------------
app.use(express.json({ limit: "1mb" }));
app.use(express.static(path.join(__dirname, "public")));

// ---------------------------
// Env helpers
// ---------------------------
function mustEnv(name) {
  const v = process.env[name];
  if (!v) throw new Error(`Missing env var: ${name}`);
  return v;
}

function getServiceAccountJSON() {
  // Prefer base64 (safe for Vercel env UI)
  const b64 = process.env.GOOGLE_SERVICE_ACCOUNT_JSON_B64;
  if (b64 && b64.trim()) {
    const raw = Buffer.from(b64.trim(), "base64").toString("utf-8");
    return JSON.parse(raw);
  }

  // Fallback to raw JSON if you really want it locally
  const raw = process.env.GOOGLE_SERVICE_ACCOUNT_JSON;
  if (raw && raw.trim()) return JSON.parse(raw);

  throw new Error("Missing env var: GOOGLE_SERVICE_ACCOUNT_JSON_B64 (or GOOGLE_SERVICE_ACCOUNT_JSON)");
}

const PLAYERS_SHEET_ID = mustEnv("PLAYERS_SHEET_ID");
const PLAYERS_TAB_NAME = mustEnv("PLAYERS_TAB_NAME"); // example: ReceiverPlayers
const RECEIVERS_SHEET_URL = mustEnv("RECEIVERS_SHEET_URL"); // published CSV url to the OTHER sheet

// ---------------------------
// Google Sheets client
// ---------------------------
function sheetsClient() {
  const sa = getServiceAccountJSON();

  const auth = new google.auth.JWT({
    email: sa.client_email,
    key: sa.private_key,
    scopes: ["https://www.googleapis.com/auth/spreadsheets"]
  });

  return google.sheets({ version: "v4", auth });
}

// ---------------------------
// Helper: read published CSV column (for Receiver catches)
// ---------------------------
async function readCSVColumnFromUrl(url, columnName) {
  const r = await fetch(url);
  if (!r.ok) throw new Error(`Failed to fetch CSV: ${r.status}`);

  const text = await r.text();
  const values = [];

  return new Promise((resolve, reject) => {
    Readable.from(text)
      .pipe(csv())
      .on("data", row => {
        if (row[columnName]) values.push(String(row[columnName]).trim());
      })
      .on("end", () => resolve(values.filter(Boolean)))
      .on("error", reject);
  });
}

// ---------------------------
// Random Image (QB/Receiver folders)
// ---------------------------
app.get("/api/random-image", (req, res) => {
  const type = (req.query.type || "QB").toLowerCase();

  const folder =
    type === "receiver"
      ? path.join(__dirname, "public", "images", "Receiver")
      : path.join(__dirname, "public", "images", "QB");

  let files;
  try {
    files = fs.readdirSync(folder).filter(f => /\.(png|jpg|jpeg|webp)$/i.test(f));
  } catch {
    return res.status(500).json({ error: "Image folder not found" });
  }

  if (!files.length) return res.status(500).json({ error: "No images found" });

  const pick = files[Math.floor(Math.random() * files.length)];
  res.json({
    url: `/images/${type === "receiver" ? "Receiver" : "QB"}/${pick}`
  });
});

// ---------------------------
// Game: Random Player (reads from Players sheet)
// Column A header must be: name
// ---------------------------
app.get("/api/random-player", async (req, res) => {
  try {
    const sheets = sheetsClient();

    // Read column A (name). We include header row.
    const range = `${PLAYERS_TAB_NAME}!A:A`;
    const resp = await sheets.spreadsheets.values.get({
      spreadsheetId: PLAYERS_SHEET_ID,
      range
    });

    const rows = resp.data.values || [];
    // Remove header if first cell is "name"
    const names = rows
      .map(r => (r && r[0] ? String(r[0]).trim() : ""))
      .filter(Boolean);

    const cleaned =
      names.length && names[0].toLowerCase() === "name"
        ? names.slice(1)
        : names;

    if (!cleaned.length) return res.status(500).json({ error: "No players found" });

    res.json({ name: cleaned[Math.floor(Math.random() * cleaned.length)] });
  } catch (err) {
    res.status(500).json({ error: "Failed to read players sheet", details: err.message });
  }
});

// ---------------------------
// Game: Random Catch (Receiver sheet via published CSV URL)
// Column header must be: catch
// ---------------------------
app.get("/api/random-catch", async (req, res) => {
  try {
    const catches = await readCSVColumnFromUrl(RECEIVERS_SHEET_URL, "catch");
    if (!catches.length) return res.status(500).json({ error: "No catches found" });

    res.json({ catch: catches[Math.floor(Math.random() * catches.length)] });
  } catch (err) {
    res.status(500).json({ error: "Failed to read receivers sheet", details: err.message });
  }
});

// ---------------------------
// ADMIN API (Players) — Google Sheet write
// ---------------------------

// GET list
app.get("/api/admin/receiver-players", async (req, res) => {
  try {
    const sheets = sheetsClient();
    const range = `${PLAYERS_TAB_NAME}!A:A`;
    const resp = await sheets.spreadsheets.values.get({
      spreadsheetId: PLAYERS_SHEET_ID,
      range
    });

    const rows = resp.data.values || [];
    const names = rows
      .map(r => (r && r[0] ? String(r[0]).trim() : ""))
      .filter(Boolean);

    const cleaned =
      names.length && names[0].toLowerCase() === "name"
        ? names.slice(1)
        : names;

    res.json({ players: cleaned });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST add (append)
app.post("/api/admin/receiver-players", async (req, res) => {
  try {
    const name = String(req.body?.name || "").trim();
    if (!name) return res.status(400).json({ error: "Missing name" });

    const sheets = sheetsClient();

    // Optional: prevent duplicate exact match by checking first
    const range = `${PLAYERS_TAB_NAME}!A:A`;
    const resp = await sheets.spreadsheets.values.get({
      spreadsheetId: PLAYERS_SHEET_ID,
      range
    });

    const rows = resp.data.values || [];
    const names = rows
      .map(r => (r && r[0] ? String(r[0]).trim() : ""))
      .filter(Boolean);

    const cleaned =
      names.length && names[0].toLowerCase() === "name"
        ? names.slice(1)
        : names;

    const exists = cleaned.some(n => n.toLowerCase() === name.toLowerCase());
    if (exists) {
      // Return current list (no write)
      return res.json({ ok: true, players: cleaned });
    }

    await sheets.spreadsheets.values.append({
      spreadsheetId: PLAYERS_SHEET_ID,
      range: `${PLAYERS_TAB_NAME}!A:A`,
      valueInputOption: "RAW",
      insertDataOption: "INSERT_ROWS",
      requestBody: { values: [[name]] }
    });

    // Return updated list
    const resp2 = await sheets.spreadsheets.values.get({
      spreadsheetId: PLAYERS_SHEET_ID,
      range
    });
    const rows2 = resp2.data.values || [];
    const names2 = rows2
      .map(r => (r && r[0] ? String(r[0]).trim() : ""))
      .filter(Boolean);

    const cleaned2 =
      names2.length && names2[0].toLowerCase() === "name"
        ? names2.slice(1)
        : names2;

    res.json({ ok: true, players: cleaned2 });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// DELETE remove first match (case-insensitive)
app.delete("/api/admin/receiver-players", async (req, res) => {
  try {
    const name = String(req.query?.name || "").trim();
    if (!name) return res.status(400).json({ error: "Missing name" });

    const sheets = sheetsClient();

    // Read all names
    const range = `${PLAYERS_TAB_NAME}!A:A`;
    const resp = await sheets.spreadsheets.values.get({
      spreadsheetId: PLAYERS_SHEET_ID,
      range
    });

    const rows = resp.data.values || [];
    // Find row index (1-based in Sheets). If header is row 1, data starts row 2.
    // We scan including header; if header "name" exists, we skip it for matching.
    let startRow = 1;
    let offset = 0;

    const firstCell = rows[0]?.[0] ? String(rows[0][0]).trim().toLowerCase() : "";
    const hasHeader = firstCell === "name";
    if (hasHeader) {
      startRow = 2;
      offset = 1;
    }

    const data = rows.slice(offset);
    const idx = data.findIndex(r => String(r?.[0] || "").trim().toLowerCase() === name.toLowerCase());
    if (idx === -1) {
      // Not found; return current
      const current = data.map(r => String(r?.[0] || "").trim()).filter(Boolean);
      return res.json({ ok: true, players: current });
    }

    const rowNumberToDelete = startRow + idx; // sheet row number

    // Delete that row using batchUpdate
    const sheetMeta = await sheets.spreadsheets.get({
      spreadsheetId: PLAYERS_SHEET_ID
    });

    const sheet = (sheetMeta.data.sheets || []).find(
      s => s.properties?.title === PLAYERS_TAB_NAME
    );
    if (!sheet) throw new Error("Tab not found: " + PLAYERS_TAB_NAME);

    const sheetId = sheet.properties.sheetId;

    await sheets.spreadsheets.batchUpdate({
      spreadsheetId: PLAYERS_SHEET_ID,
      requestBody: {
        requests: [
          {
            deleteDimension: {
              range: {
                sheetId,
                dimension: "ROWS",
                startIndex: rowNumberToDelete - 1, // 0-based inclusive
                endIndex: rowNumberToDelete // 0-based exclusive
              }
            }
          }
        ]
      }
    });

    // Return updated list
    const resp2 = await sheets.spreadsheets.values.get({
      spreadsheetId: PLAYERS_SHEET_ID,
      range
    });

    const rows2 = resp2.data.values || [];
    const names2 = rows2
      .slice(hasHeader ? 1 : 0)
      .map(r => String(r?.[0] || "").trim())
      .filter(Boolean);

    res.json({ ok: true, players: names2 });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ---------------------------
// Health
// ---------------------------
app.get("/api/health", (_, res) => res.json({ ok: true }));

module.exports = app;

// Local only
if (require.main === module) {
  const PORT = process.env.PORT || 3000;
  app.listen(PORT, () => console.log(`Local server running on http://localhost:${PORT}`));
}
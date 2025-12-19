const express = require("express");
const path = require("path");
const fs = require("fs");
const fetch = require("node-fetch");
const csv = require("csv-parser");
const { Readable } = require("stream");
const { google } = require("googleapis");

const app = express();

/* =========================
   Middleware
========================= */
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

/* =========================
   Static files (public/)
========================= */
app.use(express.static(path.join(__dirname, "..", "public")));

/* =========================
   ENV helpers
========================= */
function mustEnv(name) {
  const v = process.env[name];
  if (!v) throw new Error(`Missing env var: ${name}`);
  return v;
}

function getServiceAccountJSON() {
  // Prefer Base64 (best for Vercel)
  const b64 = process.env.GOOGLE_SERVICE_ACCOUNT_JSON_B64;
  if (b64 && b64.trim()) {
    const decoded = Buffer.from(b64.trim(), "base64").toString("utf8");
    return JSON.parse(decoded);
  }

  // Fallback (not recommended)
  const raw = process.env.GOOGLE_SERVICE_ACCOUNT_JSON;
  if (raw && raw.trim()) {
    const fixed = raw.replace(/\\n/g, "\n");
    return JSON.parse(fixed);
  }

  throw new Error(
    "Missing GOOGLE_SERVICE_ACCOUNT_JSON_B64 (recommended) or GOOGLE_SERVICE_ACCOUNT_JSON"
  );
}

function getSheetsClient(scopes) {
  const sa = getServiceAccountJSON();
  const auth = new google.auth.JWT(sa.client_email, null, sa.private_key, scopes);
  return google.sheets({ version: "v4", auth });
}

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

/* =========================
   CSV helper (Receivers)
========================= */
async function readCSV(url, column) {
  const r = await fetch(url);
  if (!r.ok) throw new Error("Failed to fetch CSV");

  const text = await r.text();
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
   Random Player (Google Sheet via Service Account)
   Reads column A (A2:A)
========================= */
app.get("/api/random-player", async (req, res) => {
  try {
    const SHEET_ID = mustEnv("PLAYERS_SHEET_ID");
    const TAB = mustEnv("PLAYERS_TAB_NAME");

    const sheets = getSheetsClient([
      "https://www.googleapis.com/auth/spreadsheets.readonly"
    ]);

    const range = `${TAB}!A2:A`;
    const resp = await sheets.spreadsheets.values.get({
      spreadsheetId: SHEET_ID,
      range
    });

    const rows = resp.data.values || [];
    const players = rows.map(r => (r?.[0] ? String(r[0]).trim() : "")).filter(Boolean);

    if (!players.length) return res.status(500).json({ error: "No players found" });

    res.json({ name: players[Math.floor(Math.random() * players.length)] });
  } catch (err) {
    res.status(500).json({
      error: "Failed to read players sheet",
      details: err.message
    });
  }
});

/* =========================
   Random Catch (Receivers sheet published CSV)
========================= */
const crypto = require("crypto");

app.get("/api/random-catch", async (req, res) => {
  try {
    // Always fresh (prevents any caching weirdness)
    res.setHeader("Cache-Control", "no-store, no-cache, must-revalidate, proxy-revalidate");
    res.setHeader("Pragma", "no-cache");
    res.setHeader("Expires", "0");

    const catches = await readCSV(process.env.RECEIVERS_SHEET_URL, "catch");
    if (!catches.length) return res.status(500).json({ error: "No catches found" });

    const idx = crypto.randomInt(0, catches.length);
    res.json({ catch: catches[idx] });

  } catch (err) {
    res.status(500).json({
      error: "Failed to read receivers sheet",
      details: err.message
    });
  }
});

/* =========================
   ADMIN: list players
========================= */
app.get("/api/admin/receiver-players", async (req, res) => {
  try {
    const SHEET_ID = mustEnv("PLAYERS_SHEET_ID");
    const TAB = mustEnv("PLAYERS_TAB_NAME");

    const sheets = getSheetsClient([
      "https://www.googleapis.com/auth/spreadsheets.readonly"
    ]);

    const range = `${TAB}!A2:A`;
    const resp = await sheets.spreadsheets.values.get({
      spreadsheetId: SHEET_ID,
      range
    });

    const rows = resp.data.values || [];
    const players = rows.map(r => (r?.[0] ? String(r[0]).trim() : "")).filter(Boolean);

    res.json({ players });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

/* =========================
   ADMIN: add player
   Body: { "name": "Cole" }
========================= */
app.post("/api/admin/receiver-players", async (req, res) => {
  try {
    const name = String(req.body?.name || "").trim();
    if (!name) return res.status(400).json({ error: "Missing name" });

    const SHEET_ID = mustEnv("PLAYERS_SHEET_ID");
    const TAB = mustEnv("PLAYERS_TAB_NAME");

    const sheets = getSheetsClient([
      "https://www.googleapis.com/auth/spreadsheets"
    ]);

    // Add to bottom
    await sheets.spreadsheets.values.append({
      spreadsheetId: SHEET_ID,
      range: `${TAB}!A:A`,
      valueInputOption: "RAW",
      insertDataOption: "INSERT_ROWS",
      requestBody: {
        values: [[name]]
      }
    });

    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

/* =========================
   ADMIN: delete player (all exact matches)
   Body: { "name": "Cole" }
========================= */
app.delete("/api/admin/receiver-players", async (req, res) => {
  try {
    const name = String(req.body?.name || "").trim();
    if (!name) return res.status(400).json({ error: "Missing name" });

    const SHEET_ID = mustEnv("PLAYERS_SHEET_ID");
    const TAB = mustEnv("PLAYERS_TAB_NAME");

    const sheets = getSheetsClient([
      "https://www.googleapis.com/auth/spreadsheets"
    ]);

    // 1) get sheet metadata (to find sheetId)
    const meta = await sheets.spreadsheets.get({ spreadsheetId: SHEET_ID });
    const sheet = meta.data.sheets.find(s => s.properties.title === TAB);
    if (!sheet) return res.status(404).json({ error: `Tab not found: ${TAB}` });

    const sheetId = sheet.properties.sheetId;

    // 2) get current values to find matching rows
    const valuesResp = await sheets.spreadsheets.values.get({
      spreadsheetId: SHEET_ID,
      range: `${TAB}!A2:A`
    });

    const rows = valuesResp.data.values || [];
    // rows is 0-based for A2, so actual row index = i+2
    const matches = [];
    rows.forEach((r, i) => {
      const v = r?.[0] ? String(r[0]).trim() : "";
      if (v === name) matches.push(i + 2);
    });

    if (!matches.length) return res.json({ ok: true, deleted: 0 });

    // 3) delete rows from bottom to top (so indices don't shift)
    matches.sort((a, b) => b - a);

    const requests = matches.map(rowNum => ({
      deleteDimension: {
        range: {
          sheetId,
          dimension: "ROWS",
          startIndex: rowNum - 1, // 0-based inclusive
          endIndex: rowNum // 0-based exclusive
        }
      }
    }));

    await sheets.spreadsheets.batchUpdate({
      spreadsheetId: SHEET_ID,
      requestBody: { requests }
    });

    res.json({ ok: true, deleted: matches.length });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

/* =========================
   Health check
========================= */
app.get("/api/health", (_, res) => res.json({ ok: true }));

module.exports = app;
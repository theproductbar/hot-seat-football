const express = require("express");
const path = require("path");
const fs = require("fs");
const { google } = require("googleapis");
const csvParser = require("csv-parser");
const { Readable } = require("stream");

const app = express();

// Needed for POST/DELETE JSON bodies
app.use(express.json());

// Serve static files from /public (index.html, admin.html, images, sounds)
app.use(express.static(path.join(process.cwd(), "public")));

// ----------------------------
// ENV helpers
// ----------------------------
function mustEnv(name) {
  const v = process.env[name];
  if (!v) throw new Error(`Missing env var: ${name}`);
  return v;
}

function getServiceAccountJSON() {
  const b64 = process.env.GOOGLE_SERVICE_ACCOUNT_JSON_B64;
  if (b64) {
    const jsonStr = Buffer.from(b64, "base64").toString("utf8");
    return JSON.parse(jsonStr);
  }

  const raw = process.env.GOOGLE_SERVICE_ACCOUNT_JSON;
  if (raw) return JSON.parse(raw);

  throw new Error(
    "Missing env var: GOOGLE_SERVICE_ACCOUNT_JSON_B64 (or GOOGLE_SERVICE_ACCOUNT_JSON)"
  );
}

const PLAYERS_SHEET_ID = mustEnv("PLAYERS_SHEET_ID");
const PLAYERS_TAB_NAME = mustEnv("PLAYERS_TAB_NAME");
const RECEIVERS_SHEET_URL = mustEnv("RECEIVERS_SHEET_URL"); // published CSV URL

// ----------------------------
// Google Sheets client
// ----------------------------
function getSheetsClient() {
  const sa = getServiceAccountJSON();

  const auth = new google.auth.JWT(
    sa.client_email,
    null,
    sa.private_key,
    ["https://www.googleapis.com/auth/spreadsheets"]
  );

  return google.sheets({ version: "v4", auth });
}

// ----------------------------
// CSV helper for RECEIVERS sheet (separate sheet)
// Column name must be "catch"
// ----------------------------
async function readCSV(url, column) {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Failed to fetch CSV (${res.status})`);

  const text = await res.text();
  const values = [];

  return new Promise((resolve, reject) => {
    Readable.from(text)
      .pipe(csvParser())
      .on("data", (row) => {
        if (row[column]) values.push(String(row[column]).trim());
      })
      .on("end", () => resolve(values))
      .on("error", reject);
  });
}

// ----------------------------
// Random Image
// ----------------------------
app.get("/api/random-image", (req, res) => {
  const type = String(req.query.type || "QB").toLowerCase();

  const folder =
    type === "receiver"
      ? path.join(process.cwd(), "public", "images", "Receiver")
      : path.join(process.cwd(), "public", "images", "QB");

  let files;
  try {
    files = fs.readdirSync(folder).filter((f) => /\.(png|jpg|jpeg|webp)$/i.test(f));
  } catch (e) {
    return res.status(500).json({
      error: "Image folder not found",
      details: String(e.message || e),
    });
  }

  if (!files.length) return res.status(500).json({ error: "No images found" });

  const pick = files[Math.floor(Math.random() * files.length)];
  res.json({
    url: `/images/${type === "receiver" ? "Receiver" : "QB"}/${pick}`,
  });
});

// ----------------------------
// PLAYERS sheet helpers (Admin-managed)
// Column A header must be "name"
// Data in A2:A
// ----------------------------
async function getPlayersFromSheet() {
  const sheets = getSheetsClient();
  const range = `${PLAYERS_TAB_NAME}!A2:A`;
  const r = await sheets.spreadsheets.values.get({
    spreadsheetId: PLAYERS_SHEET_ID,
    range,
  });

  const rows = r.data.values || [];
  return rows.map((x) => String(x[0] || "").trim()).filter(Boolean);
}

async function appendPlayerToSheet(name) {
  const sheets = getSheetsClient();

  // Prevent duplicates (case-insensitive)
  const existing = await getPlayersFromSheet();
  if (existing.some((p) => p.toLowerCase() === name.toLowerCase())) {
    return existing;
  }

  await sheets.spreadsheets.values.append({
    spreadsheetId: PLAYERS_SHEET_ID,
    range: `${PLAYERS_TAB_NAME}!A:A`,
    valueInputOption: "RAW",
    insertDataOption: "INSERT_ROWS",
    requestBody: { values: [[name]] },
  });

  return await getPlayersFromSheet();
}

async function deletePlayerFromSheet(name) {
  const sheets = getSheetsClient();

  // Read whole column including header to find row index
  const rangeAll = `${PLAYERS_TAB_NAME}!A:A`;
  const r = await sheets.spreadsheets.values.get({
    spreadsheetId: PLAYERS_SHEET_ID,
    range: rangeAll,
  });

  const rows = r.data.values || [];
  let matchRowIndex = -1;

  for (let i = 1; i < rows.length; i++) {
    const cell = String(rows[i]?.[0] || "").trim();
    if (cell && cell.toLowerCase() === name.toLowerCase()) {
      matchRowIndex = i;
      break;
    }
  }

  if (matchRowIndex === -1) {
    return await getPlayersFromSheet(); // nothing to delete
  }

  // Need numeric sheetId
  const meta = await sheets.spreadsheets.get({ spreadsheetId: PLAYERS_SHEET_ID });
  const sheet = (meta.data.sheets || []).find(
    (s) => s.properties?.title === PLAYERS_TAB_NAME
  );
  if (!sheet) throw new Error(`Tab not found: ${PLAYERS_TAB_NAME}`);
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
              startIndex: matchRowIndex,
              endIndex: matchRowIndex + 1,
            },
          },
        },
      ],
    },
  });

  return await getPlayersFromSheet();
}

// ----------------------------
// Random Player (Game uses this)
// ----------------------------
app.get("/api/random-player", async (req, res) => {
  try {
    const players = await getPlayersFromSheet();
    if (!players.length) return res.status(500).json({ error: "No players found" });

    res.json({ name: players[Math.floor(Math.random() * players.length)] });
  } catch (e) {
    res.status(500).json({
      error: "Failed to read players sheet",
      details: String(e.message || e),
    });
  }
});

// ----------------------------
// Admin APIs
// ----------------------------
app.get("/api/admin/receiver-players", async (req, res) => {
  try {
    const players = await getPlayersFromSheet();
    res.json({ players });
  } catch (e) {
    res.status(500).json({ error: String(e.message || e) });
  }
});

app.post("/api/admin/receiver-players", async (req, res) => {
  try {
    const name = String(req.body?.name || "").trim();
    if (!name) return res.status(400).json({ error: "Missing name" });

    const players = await appendPlayerToSheet(name);
    res.json({ ok: true, players });
  } catch (e) {
    res.status(500).json({ error: String(e.message || e) });
  }
});

app.delete("/api/admin/receiver-players", async (req, res) => {
  try {
    const name = String(req.body?.name || "").trim();
    if (!name) return res.status(400).json({ error: "Missing name" });

    const players = await deletePlayerFromSheet(name);
    res.json({ ok: true, players });
  } catch (e) {
    res.status(500).json({ error: String(e.message || e) });
  }
});

// ----------------------------
// Receiver catches (separate sheet via CSV URL)
// ----------------------------
app.get("/api/random-catch", async (req, res) => {
  try {
    const catches = await readCSV(RECEIVERS_SHEET_URL, "catch");
    if (!catches.length) return res.status(500).json({ error: "No catches found" });

    res.json({ catch: catches[Math.floor(Math.random() * catches.length)] });
  } catch (e) {
    res.status(500).json({
      error: "Failed to read receivers sheet",
      details: String(e.message || e),
    });
  }
});

// Health
app.get("/api/health", (req, res) => res.json({ ok: true }));

// IMPORTANT: Vercel serverless export (no app.listen here)
module.exports = app;
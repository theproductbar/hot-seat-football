const { google } = require("googleapis");

function mustEnv(name) {
  const v = process.env[name];
  if (!v) throw new Error(`Missing env var: ${name}`);
  return v;
}

function getServiceAccountJSON() {
  // supports either raw JSON or base64 JSON
  if (process.env.GOOGLE_SERVICE_ACCOUNT_JSON) {
    return JSON.parse(process.env.GOOGLE_SERVICE_ACCOUNT_JSON);
  }
  if (process.env.GOOGLE_SERVICE_ACCOUNT_JSON_B64) {
    const decoded = Buffer.from(process.env.GOOGLE_SERVICE_ACCOUNT_JSON_B64, "base64").toString("utf8");
    return JSON.parse(decoded);
  }
  throw new Error("Missing env var: GOOGLE_SERVICE_ACCOUNT_JSON or GOOGLE_SERVICE_ACCOUNT_JSON_B64");
}

async function getSheetsClient() {
  const sa = getServiceAccountJSON();
  const auth = new google.auth.JWT({
    email: sa.client_email,
    key: sa.private_key,
    scopes: ["https://www.googleapis.com/auth/spreadsheets"]
  });
  return google.sheets({ version: "v4", auth });
}

module.exports = async (req, res) => {
  try {
    const PLAYERS_SHEET_ID = mustEnv("PLAYERS_SHEET_ID");
    const PLAYERS_TAB_NAME = mustEnv("PLAYERS_TAB_NAME");

    const sheets = await getSheetsClient();

    const range = `${PLAYERS_TAB_NAME}!A:A`;
    const resp = await sheets.spreadsheets.values.get({
      spreadsheetId: PLAYERS_SHEET_ID,
      range
    });

    const rows = (resp.data.values || []).flat().map((x) => String(x).trim()).filter(Boolean);
    const players = rows.filter((x) => x.toLowerCase() !== "name"); // ignore header if exists

    if (!players.length) return res.status(500).json({ error: "No players found" });

    return res.status(200).json({
      name: players[Math.floor(Math.random() * players.length)]
    });
  } catch (err) {
    return res.status(500).json({ error: "Failed to read players sheet", details: err.message });
  }
};
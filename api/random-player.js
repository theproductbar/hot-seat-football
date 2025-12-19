const { google } = require("googleapis");
const { getServiceAccountJSON } = require("./_lib/serviceAccount");

function mustEnv(name) {
  const v = process.env[name];
  if (!v) throw new Error(`Missing env var: ${name}`);
  return v;
}

module.exports = async (req, res) => {
  try {
    const SHEET_ID = mustEnv("PLAYERS_SHEET_ID");
    const TAB = mustEnv("PLAYERS_TAB_NAME");

    const sa = getServiceAccountJSON();

    const auth = new google.auth.JWT(
      sa.client_email,
      null,
      sa.private_key,
      ["https://www.googleapis.com/auth/spreadsheets.readonly"]
    );

    const sheets = google.sheets({ version: "v4", auth });

    const range = `${TAB}!A2:A`; // column A, skip header

    const resp = await sheets.spreadsheets.values.get({
      spreadsheetId: SHEET_ID,
      range,
    });

    const rows = resp.data.values || [];
    const players = rows
      .map(r => (r && r[0] ? String(r[0]).trim() : ""))
      .filter(Boolean);

    if (!players.length) {
      return res.status(500).json({ error: "No players found" });
    }

    const pick = players[Math.floor(Math.random() * players.length)];
    return res.json({ name: pick });
  } catch (err) {
    return res.status(500).json({
      error: "Failed to read players sheet",
      details: err.message,
    });
  }
};
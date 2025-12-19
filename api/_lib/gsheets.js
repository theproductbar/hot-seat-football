const { google } = require("googleapis");

function getServiceAccountJSON() {
  // Supports either raw JSON or base64 JSON
  const raw = process.env.GOOGLE_SERVICE_ACCOUNT_JSON;
  const b64 = process.env.GOOGLE_SERVICE_ACCOUNT_JSON_B64;

  if (raw && raw.trim().startsWith("{")) return JSON.parse(raw);

  if (b64) {
    const decoded = Buffer.from(b64, "base64").toString("utf8");
    return JSON.parse(decoded);
  }

  throw new Error("Missing GOOGLE_SERVICE_ACCOUNT_JSON or GOOGLE_SERVICE_ACCOUNT_JSON_B64");
}

async function getSheetsClient() {
  const sa = getServiceAccountJSON();

  // IMPORTANT: private_key must contain real newlines, not "\n"
  // If it contains literal "\\n", convert them:
  if (sa.private_key && sa.private_key.includes("\\n")) {
    sa.private_key = sa.private_key.replace(/\\n/g, "\n");
  }

  const auth = new google.auth.JWT({
    email: sa.client_email,
    key: sa.private_key,
    scopes: ["https://www.googleapis.com/auth/spreadsheets"],
  });

  await auth.authorize();

  return google.sheets({ version: "v4", auth });
}

async function readColumn({ sheetId, tabName, column = "A" }) {
  const sheets = await getSheetsClient();

  const range = `${tabName}!${column}:${column}`;
  const resp = await sheets.spreadsheets.values.get({
    spreadsheetId: sheetId,
    range,
  });

  const rows = resp.data.values || [];
  // remove header + blanks
  return rows
    .map(r => (r[0] || "").trim())
    .filter((v, i) => v && i !== 0);
}

module.exports = { readColumn };
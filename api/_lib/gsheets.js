const { google } = require("googleapis");

function getServiceAccountJSON() {
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

  // Fix newline formatting if needed
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

async function getTabSheetId(sheets, spreadsheetId, tabName) {
  const meta = await sheets.spreadsheets.get({
    spreadsheetId,
    fields: "sheets(properties(sheetId,title))",
  });

  const sheet = (meta.data.sheets || []).find(
    (s) => s.properties && s.properties.title === tabName
  );

  if (!sheet) throw new Error(`Tab not found: ${tabName}`);
  return sheet.properties.sheetId;
}

async function readColumn({ sheetId, tabName, column = "A" }) {
  const sheets = await getSheetsClient();
  const range = `${tabName}!${column}:${column}`;

  const resp = await sheets.spreadsheets.values.get({
    spreadsheetId: sheetId,
    range,
  });

  const rows = resp.data.values || [];
  return rows
    .map((r) => (r[0] || "").trim())
    .filter((v, i) => v && i !== 0); // remove header
}

async function appendName({ sheetId, tabName, name }) {
  const sheets = await getSheetsClient();

  await sheets.spreadsheets.values.append({
    spreadsheetId: sheetId,
    range: `${tabName}!A:A`,
    valueInputOption: "USER_ENTERED",
    insertDataOption: "INSERT_ROWS",
    requestBody: { values: [[name]] },
  });
}

async function deleteFirstMatchByName({ sheetId, tabName, name }) {
  const sheets = await getSheetsClient();

  // Read all values in col A so we can find the row index
  const resp = await sheets.spreadsheets.values.get({
    spreadsheetId: sheetId,
    range: `${tabName}!A:A`,
  });

  const rows = resp.data.values || [];
  // rows[0] is header. Data starts at index 1 (row 2 in the sheet)
  const target = name.trim().toLowerCase();

  let matchIndex = -1; // 0-based index in "rows"
  for (let i = 1; i < rows.length; i++) {
    const v = (rows[i] && rows[i][0] ? String(rows[i][0]).trim() : "").toLowerCase();
    if (v === target) { matchIndex = i; break; }
  }

  if (matchIndex === -1) return { deleted: false };

  // Convert rows index -> sheet row index (0-based for API)
  // matchIndex in rows corresponds to the same 0-based row in the tab.
  const sheetNumericId = await getTabSheetId(sheets, sheetId, tabName);

  await sheets.spreadsheets.batchUpdate({
    spreadsheetId: sheetId,
    requestBody: {
      requests: [
        {
          deleteDimension: {
            range: {
              sheetId: sheetNumericId,
              dimension: "ROWS",
              startIndex: matchIndex,     // inclusive
              endIndex: matchIndex + 1,   // exclusive
            },
          },
        },
      ],
    },
  });

  return { deleted: true };
}

module.exports = {
  readColumn,
  appendName,
  deleteFirstMatchByName,
};
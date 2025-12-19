const { readColumn } = require("../_lib/gsheets");

module.exports = async (req, res) => {
  try {
    const sheetId = process.env.PLAYERS_SHEET_ID;
    const tabName = process.env.PLAYERS_TAB_NAME;

    if (!sheetId) return res.status(500).json({ error: "Missing env var: PLAYERS_SHEET_ID" });
    if (!tabName) return res.status(500).json({ error: "Missing env var: PLAYERS_TAB_NAME" });

    const players = await readColumn({
      sheetId,
      tabName,
      column: "A", // Column A = "name"
    });

    return res.status(200).json({ players });
  } catch (err) {
    return res.status(500).json({
      error: "Failed to load players",
      details: err.message,
    });
  }
};
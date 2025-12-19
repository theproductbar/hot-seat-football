const { readColumn, appendName, deleteFirstMatchByName } = require("../_lib/gsheets");

function mustEnv(name) {
  const v = process.env[name];
  if (!v) throw new Error(`Missing env var: ${name}`);
  return v;
}

async function readBodyJSON(req) {
  return new Promise((resolve, reject) => {
    let data = "";
    req.on("data", (chunk) => (data += chunk));
    req.on("end", () => {
      if (!data) return resolve({});
      try {
        resolve(JSON.parse(data));
      } catch (e) {
        reject(new Error("Invalid JSON body"));
      }
    });
    req.on("error", reject);
  });
}

module.exports = async (req, res) => {
  try {
    const sheetId = mustEnv("PLAYERS_SHEET_ID");
    const tabName = mustEnv("PLAYERS_TAB_NAME");

    // Always allow CORS same-origin (safe)
    res.setHeader("Content-Type", "application/json");

    if (req.method === "GET") {
      const players = await readColumn({ sheetId, tabName, column: "A" });
      return res.status(200).json({ players });
    }

    if (req.method === "POST") {
      const body = await readBodyJSON(req);
      const name = (body.name || "").trim();

      if (!name) return res.status(400).json({ error: "Missing name" });
      if (name.length > 60) return res.status(400).json({ error: "Name too long" });

      // Prevent duplicates (case-insensitive)
      const players = await readColumn({ sheetId, tabName, column: "A" });
      const exists = players.some((p) => p.trim().toLowerCase() === name.toLowerCase());
      if (!exists) {
        await appendName({ sheetId, tabName, name });
      }

      const updated = await readColumn({ sheetId, tabName, column: "A" });
      return res.status(200).json({ ok: true, players: updated });
    }

    if (req.method === "DELETE") {
      const body = await readBodyJSON(req);
      const name = (body.name || "").trim();
      if (!name) return res.status(400).json({ error: "Missing name" });

      const result = await deleteFirstMatchByName({ sheetId, tabName, name });
      if (!result.deleted) return res.status(404).json({ error: "Name not found" });

      const updated = await readColumn({ sheetId, tabName, column: "A" });
      return res.status(200).json({ ok: true, players: updated });
    }

    return res.status(405).json({ error: "Method not allowed" });
  } catch (err) {
    return res.status(500).json({
      error: "Admin API failed",
      details: err.message,
    });
  }
};
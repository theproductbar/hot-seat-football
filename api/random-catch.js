const crypto = require("crypto");

app.get("/api/random-catch", async (req, res) => {
  try {
    res.setHeader("Cache-Control", "no-store, no-cache, must-revalidate, proxy-revalidate");
    res.setHeader("Pragma", "no-cache");
    res.setHeader("Expires", "0");

    const all = await readCSV(process.env.RECEIVERS_SHEET_URL, "catch");
    if (!all.length) return res.status(500).json({ error: "No catches found" });

    const TD_RATE = 0.22; // ✅ 22% Touchdown prize odds

    const touchdowns = all.filter(x => String(x).toLowerCase().includes("touchdown"));
    const nonTD = all.filter(x => !String(x).toLowerCase().includes("touchdown"));

    // roll 0.0000–0.9999
    const roll = crypto.randomInt(0, 10000) / 10000;

    const pool = (roll < TD_RATE && touchdowns.length) ? touchdowns : nonTD;
    const idx = crypto.randomInt(0, pool.length);

    res.json({ catch: pool[idx] });

  } catch (err) {
    res.status(500).json({
      error: "Failed to read receivers sheet",
      details: err.message
    });
  }
});
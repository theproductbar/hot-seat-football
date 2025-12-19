const csv = require("csv-parser");
const { Readable } = require("stream");

async function fetchText(url) {
  const r = await fetch(url);
  if (!r.ok) throw new Error(`Failed to fetch CSV: ${r.status}`);
  return r.text();
}

async function readCSVColumn(url, column) {
  const text = await fetchText(url);
  const values = [];

  return new Promise((resolve, reject) => {
    Readable.from(text)
      .pipe(csv())
      .on("data", (row) => {
        if (row[column]) values.push(String(row[column]).trim());
      })
      .on("end", () => resolve(values))
      .on("error", reject);
  });
}

module.exports = async (req, res) => {
  try {
    const url = process.env.RECEIVERS_SHEET_URL;
    if (!url) return res.status(500).json({ error: "Missing env var: RECEIVERS_SHEET_URL" });

    const catches = await readCSVColumn(url, "catch");
    if (!catches.length) return res.status(500).json({ error: "No catches found" });

    return res.status(200).json({
      catch: catches[Math.floor(Math.random() * catches.length)]
    });
  } catch (err) {
    return res.status(500).json({ error: "Failed to read receivers sheet", details: err.message });
  }
};
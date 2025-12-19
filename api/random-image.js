const fs = require("fs");
const path = require("path");

module.exports = async (req, res) => {
  try {
    const type = String(req.query.type || "QB").toLowerCase();

    const folderName = type === "receiver" ? "Receiver" : "QB";
    const folder = path.join(process.cwd(), "public", "images", folderName);

    if (!fs.existsSync(folder)) {
      return res.status(500).json({ error: `Image folder not found: ${folderName}` });
    }

    const files = fs
      .readdirSync(folder)
      .filter((f) => /\.(png|jpg|jpeg|webp)$/i.test(f));

    if (!files.length) return res.status(500).json({ error: "No images found" });

    const pick = files[Math.floor(Math.random() * files.length)];
    return res.status(200).json({ url: `/images/${folderName}/${pick}` });
  } catch (err) {
    return res.status(500).json({ error: "random-image crashed", details: err.message });
  }
};
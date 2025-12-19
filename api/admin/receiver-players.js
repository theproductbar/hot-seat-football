// api/admin/receiver-players.js
module.exports = async (req, res) => {
  res.setHeader("Content-Type", "application/json");

  if (req.method !== "GET") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  // Temporary: confirms the function is deployed and callable.
  // Once this works on Vercel, we wire it to your Google Sheet logic.
  return res.status(200).json({ ok: true, route: "/api/admin/receiver-players" });
};
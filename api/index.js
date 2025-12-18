const app = require("../server");

// Vercel serverless handler
module.exports = (req, res) => app(req, res);
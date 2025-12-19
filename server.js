require("dotenv").config();
const app = require("./api/index");

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`Local server: http://localhost:${PORT}`);
});
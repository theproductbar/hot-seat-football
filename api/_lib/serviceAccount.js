function getServiceAccountJSON() {
  // Preferred: Base64 JSON (best for Vercel env vars)
  const b64 = process.env.GOOGLE_SERVICE_ACCOUNT_JSON_B64;
  if (b64 && b64.trim()) {
    const decoded = Buffer.from(b64.trim(), "base64").toString("utf8");
    return JSON.parse(decoded);
  }

  // Fallback: raw JSON string (not recommended)
  const raw = process.env.GOOGLE_SERVICE_ACCOUNT_JSON;
  if (raw && raw.trim()) {
    const fixed = raw.replace(/\\n/g, "\n");
    return JSON.parse(fixed);
  }

  throw new Error(
    "Missing env var: GOOGLE_SERVICE_ACCOUNT_JSON_B64 (recommended) or GOOGLE_SERVICE_ACCOUNT_JSON"
  );
}

module.exports = { getServiceAccountJSON };
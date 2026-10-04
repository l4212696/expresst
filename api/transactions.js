// Vercel / Netlify-style serverless function. npm i @neondatabase/serverless
// Env var: DATABASE_URL = your Neon connection string (server-side only, never in the HTML)
const { neon } = require("@neondatabase/serverless");
const crypto = require("crypto");
const sql = neon(process.env.DATABASE_URL);

function validIban(raw) {
  const s = String(raw || "").replace(/\s+/g, "").toUpperCase();
  if (!/^[A-Z]{2}\d{2}[A-Z0-9]{11,30}$/.test(s)) return null;
  const n = (s.slice(4) + s.slice(0, 4)).replace(/[A-Z]/g, (c) => c.charCodeAt(0) - 55);
  let r = 0;
  for (const ch of n) r = (r * 10 + Number(ch)) % 97;
  return r === 1 ? s : null;
}
function isJpeg(b64) {
  if (typeof b64 !== "string" || b64.length > 3_000_000) return false;
  const b = Buffer.from(b64.slice(0, 8), "base64");
  return b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff;
}

module.exports = async (req, res) => {
  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });
  try {
    const { phone, address, bankName, iban, consent, idFront, idBack } = req.body || {};
    const clean = validIban(iban);
    const errors = {};
    if (!/^\+?[0-9\s\-()]{7,20}$/.test(phone || "")) errors.phone = "Enter a valid phone number.";
    if (!address || address.trim().length < 8) errors.address = "Enter your full address.";
    if (!bankName || bankName.trim().length < 2) errors.bankName = "Enter your bank name.";
    if (!clean) errors.iban = "This IBAN doesn't look valid. Check for typos.";
    if (!isJpeg(idFront)) errors.idFront = "Upload the front of your ID.";
    if (!isJpeg(idBack)) errors.idBack = "Upload the back of your ID.";
    if (consent !== true) errors.consent = "You need to agree before sending.";
    if (Object.keys(errors).length) return res.status(422).json({ errors });

    await sql`CREATE TABLE IF NOT EXISTS transactions (
      id UUID PRIMARY KEY, phone TEXT NOT NULL, address TEXT NOT NULL,
      bank_name TEXT NOT NULL, iban TEXT NOT NULL,
      id_front_b64 TEXT NOT NULL, id_back_b64 TEXT NOT NULL,
      consent_at TIMESTAMPTZ NOT NULL, created_at TIMESTAMPTZ NOT NULL DEFAULT now())`;

    const id = crypto.randomUUID();
    await sql`INSERT INTO transactions
      (id, phone, address, bank_name, iban, id_front_b64, id_back_b64, consent_at)
      VALUES (${id}, ${phone.trim()}, ${address.trim()}, ${bankName.trim()}, ${clean},
              ${idFront}, ${idBack}, now())`;
    res.json({ ok: true, reference: id.slice(0, 8).toUpperCase() });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: "Something went wrong on our side. Try again in a moment." });
  }
};

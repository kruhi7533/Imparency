import crypto from "crypto";

const ALGORITHM = "aes-256-gcm";
const IV_LENGTH = 12; // recommended IV length for GCM

function getKey(): Buffer {
  const raw = process.env.BANK_DETAILS_ENCRYPTION_KEY;
  if (!raw) {
    throw new Error(
      "BANK_DETAILS_ENCRYPTION_KEY is not configured — refusing to store bank account details unencrypted."
    );
  }
  const key = Buffer.from(raw, "base64");
  if (key.length !== 32) {
    throw new Error("BANK_DETAILS_ENCRYPTION_KEY must decode to exactly 32 bytes (base64-encoded).");
  }
  return key;
}

/** Encrypts a bank account number for at-rest storage. Format: iv:authTag:ciphertext (all base64). */
export function encryptBankAccountNumber(plaintext: string): string {
  const key = getKey();
  const iv = crypto.randomBytes(IV_LENGTH);
  const cipher = crypto.createCipheriv(ALGORITHM, key, iv);
  const encrypted = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  const authTag = cipher.getAuthTag();
  return [iv.toString("base64"), authTag.toString("base64"), encrypted.toString("base64")].join(":");
}

/** Decrypts a value produced by encryptBankAccountNumber. Only ever call this from admin-facing code. */
export function decryptBankAccountNumber(ciphertext: string): string {
  const key = getKey();
  const [ivB64, authTagB64, dataB64] = ciphertext.split(":");
  if (!ivB64 || !authTagB64 || !dataB64) {
    throw new Error("Malformed encrypted bank account value.");
  }
  const decipher = crypto.createDecipheriv(ALGORITHM, key, Buffer.from(ivB64, "base64"));
  decipher.setAuthTag(Buffer.from(authTagB64, "base64"));
  const decrypted = Buffer.concat([decipher.update(Buffer.from(dataB64, "base64")), decipher.final()]);
  return decrypted.toString("utf8");
}

/** Last-4-digits mask for display without decrypting — e.g. list views. */
export function maskAccountNumber(plaintextOrLast4: string): string {
  const digits = plaintextOrLast4.replace(/\D/g, "");
  return digits.length >= 4 ? `••••${digits.slice(-4)}` : "••••";
}

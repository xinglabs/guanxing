import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";

/** Only encrypted provider credentials enter PostgreSQL; the master key stays outside it. */
export class CredentialVault {
  private readonly key: Buffer;
  constructor(secret: string) {
    if (!/^[a-f0-9]{64}$/i.test(secret))
      throw new Error("APP_SECRET must be a persistent 32-byte hex key.");
    this.key = Buffer.from(secret, "hex");
  }
  encrypt(modelId: string, value: string) {
    const iv = randomBytes(12);
    const cipher = createCipheriv("aes-256-gcm", this.key, iv);
    cipher.setAAD(Buffer.from(modelId));
    const bytes = Buffer.concat([cipher.update(value, "utf8"), cipher.final()]);
    return [
      "v1",
      iv.toString("base64url"),
      cipher.getAuthTag().toString("base64url"),
      bytes.toString("base64url"),
    ].join(":");
  }
  decrypt(modelId: string, encrypted: string) {
    const [version, iv, tag, ciphertext, extra] = encrypted.split(":");
    if (version !== "v1" || !iv || !tag || !ciphertext || extra)
      throw new Error("Invalid encrypted credential.");
    const decipher = createDecipheriv(
      "aes-256-gcm",
      this.key,
      Buffer.from(iv, "base64url"),
    );
    decipher.setAAD(Buffer.from(modelId));
    decipher.setAuthTag(Buffer.from(tag, "base64url"));
    return Buffer.concat([
      decipher.update(Buffer.from(ciphertext, "base64url")),
      decipher.final(),
    ]).toString("utf8");
  }
}

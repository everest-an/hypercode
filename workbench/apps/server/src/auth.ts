import { createHash, createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import type { Config } from "./config.ts";
import type { Store } from "./db.ts";
import { AppError } from "./errors.ts";

const digest = (value: string) => createHash("sha256").update(value).digest();
export class Auth {
  constructor(
    private readonly db: Store,
    private readonly config: Config,
    private readonly signingKey: string,
  ) {}
  private allowedKeys(): string[] {
    const ring = (this.config.accessKeys ?? []).filter(Boolean);
    if (ring.length) return ring;
    return this.config.accessKey ? [this.config.accessKey] : [];
  }
  /** One workspace per access key, so keys never share another user's data. */
  private keyOwner(accessKey: string): string {
    return "u-" + createHash("sha256").update(accessKey).digest("hex").slice(0, 12);
  }
  async session(accessKey?: string) {
    const provided = accessKey ?? "";
    if (this.config.mode === "live") {
      const matched = provided
        ? this.allowedKeys().filter((key) =>
            timingSafeEqual(digest(provided), digest(key)),
          ).length > 0
        : false;
      if (!matched) throw new AppError("Access key is incorrect", 401);
    }
    const owner =
      this.config.mode === "live" && provided
        ? this.keyOwner(provided)
        : "local-user";
    return this.issue(owner);
  }
  /** Mints a session for an owner without asking for the access key again, as a claimed pairing does. */
  async issue(owner: string, ttlMs = 24 * 60 * 60 * 1000) {
    const token = randomBytes(32).toString("base64url");
    await this.db.put("system", "sessions", {
      id: digest(token).toString("hex"),
      owner,
      expiresAt: Date.now() + ttlMs,
    });
    return { token, mode: this.config.mode, owner };
  }
  /** Drops one session by its bearer token, so switching accounts does not leave a live device behind. */
  async revoke(authorization?: string) {
    if (!authorization?.startsWith("Bearer ")) return;
    await this.db.remove("system", "sessions", digest(authorization.slice(7)).toString("hex"));
  }
  async owner(authorization?: string) {
    if (!authorization?.startsWith("Bearer ")) throw new AppError("Sign in to HyperCode", 401);
    const session = await this.db.get<{ owner: string; expiresAt: number }>(
      "system",
      "sessions",
      digest(authorization.slice(7)).toString("hex"),
    );
    if (!session || session.expiresAt < Date.now())
      throw new AppError("Session expired. Sign in again.", 401);
    return session.owner;
  }
  sign(owner: string, path: string) {
    const expires = String(Date.now() + 15 * 60 * 1000);
    const signature = createHmac("sha256", this.signingKey)
      .update(`${owner}\n${path}\n${expires}`)
      .digest("hex");
    return `${this.config.publicUrl}${path}?owner=${encodeURIComponent(owner)}&expires=${expires}&signature=${signature}`;
  }
  verify(url: URL) {
    const owner = url.searchParams.get("owner") ?? "";
    const expires = url.searchParams.get("expires") ?? "";
    const signature = url.searchParams.get("signature") ?? "";
    if (
      !owner ||
      !/^\d+$/.test(expires) ||
      Number(expires) < Date.now() ||
      !/^\w{64}$/.test(signature)
    )
      throw new AppError("Document link expired; refresh the workspace", 401);
    const expected = createHmac("sha256", this.signingKey)
      .update(`${owner}\n${url.pathname}\n${expires}`)
      .digest("hex");
    if (!timingSafeEqual(Buffer.from(expected), Buffer.from(signature)))
      throw new AppError("Invalid access link", 403);
    return owner;
  }
}
export async function createAuth(db: Store, config: Config) {
  await mkdir(config.dataDir, { recursive: true, mode: 0o700 });
  const path = join(config.dataDir, "session-signing-key");
  let key: string;
  try {
    key = await readFile(path, "utf8");
  } catch (error) {
    if (!(error instanceof Error && "code" in error && error.code === "ENOENT")) throw error;
    key = randomBytes(32).toString("base64");
    await writeFile(path, key, { mode: 0o600, flag: "wx" });
  }
  return new Auth(db, config, key);
}

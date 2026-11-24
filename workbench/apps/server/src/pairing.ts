import { randomBytes } from "node:crypto";
import { networkInterfaces } from "node:os";
import type { Config } from "./config.ts";
import { AppError } from "./errors.ts";

/** Unambiguous characters for a code someone may read out loud or type by hand. */
const ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
const CODE_LENGTH = 8;
const TTL_MS = 5 * 60 * 1000;
const MAX_CODES = 2_000;

type Entry = { owner: string; expiresAt: number };

export interface PairingCode {
  /** Grouped for display, for example `K7M2-Q9XP`. */
  code: string;
  expiresAt: number;
  /** Addresses a phone can try, best first. Empty when the server only listens on loopback. */
  urls: string[];
  /** True when no address can reach this server from another device. */
  localOnly: boolean;
}

/**
 * Short-lived, single-use codes that move an authenticated computer session onto a phone.
 *
 * A code is bound to the owner who created it, so the phone opens the same workspace rather
 * than creating a second one. It is never a long-lived credential: it expires, works once,
 * and is exchanged for an ordinary session token on the phone.
 */
export class Pairing {
  private readonly codes = new Map<string, Entry>();

  constructor(
    private readonly config: Config,
    private readonly now: () => number = Date.now,
  ) {}

  create(owner: string): PairingCode {
    this.prune();
    const code = Array.from(
      randomBytes(CODE_LENGTH),
      (byte) => ALPHABET[byte % ALPHABET.length],
    ).join("");
    const expiresAt = this.now() + TTL_MS;
    this.codes.set(code, { owner, expiresAt });
    if (this.codes.size > MAX_CODES) {
      const oldest = this.codes.keys().next();
      if (!oldest.done) this.codes.delete(oldest.value);
    }
    const { urls, localOnly } = this.addresses();
    return { code: display(code), expiresAt, urls, localOnly };
  }

  /** Consumes a code and returns the owner whose workspace the new device should open. */
  claim(input: string): string {
    const code = normalize(input);
    const entry = this.codes.get(code);
    if (!entry) throw new AppError(invalidCode, 401);
    this.codes.delete(code);
    if (entry.expiresAt < this.now()) throw new AppError(expiredCode, 401);
    return entry.owner;
  }

  private prune() {
    const now = this.now();
    for (const [code, entry] of this.codes) {
      if (entry.expiresAt < now) this.codes.delete(code);
    }
  }

  private addresses(): { urls: string[]; localOnly: boolean } {
    const publicUrl = new URL(this.config.publicUrl);
    if (!isLoopback(publicUrl.hostname)) return { urls: [publicUrl.origin], localOnly: false };
    if (isLoopbackHost(this.config.host)) return { urls: [], localOnly: true };
    const urls = lanAddresses().map((address) => `http://${address}:${this.config.port}`);
    return { urls, localOnly: urls.length === 0 };
  }
}

export const invalidCode =
  "That pairing code is not valid. Generate a new code on your computer and try again.";
export const expiredCode =
  "That pairing code expired or was already used. Generate a new code on your computer.";

export function display(code: string) {
  return `${code.slice(0, 4)}-${code.slice(4)}`;
}

export function normalize(input: string) {
  return input.toUpperCase().replace(/[^A-Z2-9]/g, "");
}

function isLoopback(hostname: string) {
  return (
    hostname === "localhost" ||
    hostname.endsWith(".localhost") ||
    hostname.startsWith("127.") ||
    hostname === "::1" ||
    hostname === "[::1]"
  );
}

function isLoopbackHost(host: string) {
  return isLoopback(host) || host === "";
}

/**
 * LAN addresses in the order a phone is most likely to reach them: ordinary home and office
 * ranges before container bridges and other virtual interfaces.
 */
export function lanAddresses() {
  const addresses = Object.values(networkInterfaces())
    .flat()
    .flatMap((entry) => (entry && !entry.internal ? [entry] : []))
    .filter((entry) => entry.family === "IPv4")
    .map((entry) => entry.address)
    .filter((address) => !address.startsWith("127.") && !address.startsWith("169.254."));
  return [...new Set(addresses)].sort((a, b) => rank(a) - rank(b));
}

function rank(address: string) {
  if (address.startsWith("192.168.")) return 0;
  if (address.startsWith("10.")) return 1;
  if (/^172\.(1[6-9]|2\d|3[01])\./.test(address)) return 2;
  return 3;
}

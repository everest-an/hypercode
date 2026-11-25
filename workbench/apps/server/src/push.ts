import { createPrivateKey, sign } from "node:crypto";
import { connect } from "node:http2";
import type { Store } from "./db.ts";
import { backgroundFailure } from "./log.ts";

export interface PushToken {
  id: string;
  token: string;
  platform?: string;
  createdAt: string;
}

const EXPO_PUSH_ENDPOINT = "https://exp.host/--/api/v2/push/send";

export async function registerPushToken(
  db: Store,
  owner: string,
  token: string,
  platform?: string,
): Promise<PushToken> {
  const value: PushToken = {
    id: token,
    token,
    platform,
    createdAt: new Date().toISOString(),
  };
  await db.put(owner, "push_tokens", value);
  return value;
}

export async function sendPush(
  db: Store,
  owner: string,
  title: string,
  body: string,
  data?: Record<string, string>,
): Promise<void> {
  try {
    const tokens = await db.list<PushToken>(owner, "push_tokens");
    const expo = tokens.filter((entry) => entry.token.startsWith("ExponentPushToken"));
    const apns = tokens.filter((entry) => /^[0-9a-f]{64}$/i.test(entry.token));
    if (expo.length > 0) {
      await fetch(EXPO_PUSH_ENDPOINT, {
        method: "POST",
        headers: { "Content-Type": "application/json", Accept: "application/json" },
        body: JSON.stringify(
          expo.map((entry) => ({ to: entry.token, title, body, data, sound: "default" as const })),
        ),
      });
    }
    if (apns.length > 0) await sendApns(apns.map((entry) => entry.token), title, body, data);
  } catch (error) {
    backgroundFailure("push.send", error);
  }
}

function apnsAuth(): { jwt: string; topic: string; host: string } | undefined {
  const keyId = process.env.APNS_KEY_ID;
  const teamId = process.env.APNS_TEAM_ID;
  const topic = process.env.APNS_BUNDLE_ID;
  const encoded = process.env.APNS_KEY_P8_BASE64;
  const p8 = encoded ? Buffer.from(encoded, "base64").toString("utf8") : process.env.APNS_KEY_P8;
  if (!keyId || !teamId || !topic || !p8) return undefined;
  const header = Buffer.from(JSON.stringify({ alg: "ES256", kid: keyId })).toString("base64url");
  const claims = Buffer.from(
    JSON.stringify({ iss: teamId, iat: Math.floor(Date.now() / 1000) }),
  ).toString("base64url");
  const input = `${header}.${claims}`;
  const signature = sign("sha256", Buffer.from(input), {
    key: createPrivateKey(p8),
    dsaEncoding: "ieee-p1363",
  }).toString("base64url");
  return {
    jwt: `${input}.${signature}`,
    topic,
    host: process.env.APNS_HOST ?? "https://api.push.apple.com",
  };
}

async function sendApns(
  tokens: string[],
  title: string,
  body: string,
  data?: Record<string, string>,
): Promise<void> {
  const auth = apnsAuth();
  if (!auth) return;
  const payload = JSON.stringify({
    aps: { alert: { title, body }, sound: "default" },
    ...data,
  });
  const client = connect(auth.host);
  try {
    await Promise.all(
      tokens.map(
        (token) =>
          new Promise<void>((resolve) => {
            const request = client.request({
              ":method": "POST",
              ":path": `/3/device/${token}`,
              "apns-topic": auth.topic,
              "apns-push-type": "alert",
              "apns-priority": "10",
              authorization: `bearer ${auth.jwt}`,
              "content-type": "application/json",
            });
            request.on("response", (headers) => {
              const status = headers[":status"];
              if (status !== 200) backgroundFailure("push.apns", new Error(`status ${status}`));
              request.close();
              resolve();
            });
            request.on("error", () => resolve());
            request.end(payload);
          }),
      ),
    );
  } finally {
    client.close();
  }
}

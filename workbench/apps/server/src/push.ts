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
    const messages = tokens
      .filter((entry) => entry.token.startsWith("ExponentPushToken"))
      .map((entry) => ({
        to: entry.token,
        title,
        body,
        data,
        sound: "default" as const,
      }));
    if (messages.length === 0) return;
    await fetch(EXPO_PUSH_ENDPOINT, {
      method: "POST",
      headers: { "Content-Type": "application/json", Accept: "application/json" },
      body: JSON.stringify(messages),
    });
  } catch (error) {
    backgroundFailure("push.send", error);
  }
}

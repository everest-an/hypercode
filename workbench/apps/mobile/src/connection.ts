import * as FileSystem from "expo-file-system/legacy";
import { Platform } from "react-native";

/** A computer this phone has paired with. The token is a session, not the workspace access key. */
export interface SavedConnection {
  url: string;
  token: string;
}

const FILE = "hypercode-connection.json";
const WEB_KEY = "hypercode.connection.v1";

/** Reads the last paired computer, so a relaunch opens the workspace instead of the pairing screen. */
export async function loadConnection(): Promise<SavedConnection | undefined> {
  try {
    const raw =
      Platform.OS === "web"
        ? globalThis.localStorage?.getItem(WEB_KEY)
        : await FileSystem.readAsStringAsync(await filePath());
    return raw ? decode(raw) : undefined;
  } catch {
    return undefined;
  }
}

export async function saveConnection(connection: SavedConnection) {
  const raw = JSON.stringify(connection);
  if (Platform.OS === "web") {
    globalThis.localStorage?.setItem(WEB_KEY, raw);
    return;
  }
  const path = await filePath();
  await FileSystem.writeAsStringAsync(path, raw);
}

export async function clearConnection() {
  if (Platform.OS === "web") {
    globalThis.localStorage?.removeItem(WEB_KEY);
    return;
  }
  const path = await filePath();
  await FileSystem.deleteAsync(path, { idempotent: true });
}

async function filePath() {
  if (!FileSystem.documentDirectory)
    throw new Error("This device has no storage directory for the connection.");
  return `${FileSystem.documentDirectory}${FILE}`;
}

function decode(raw: string): SavedConnection | undefined {
  const value: unknown = JSON.parse(raw);
  if (!value || typeof value !== "object") return undefined;
  if (!("url" in value) || typeof value.url !== "string") return undefined;
  if (!("token" in value) || typeof value.token !== "string") return undefined;
  return { url: value.url, token: value.token };
}

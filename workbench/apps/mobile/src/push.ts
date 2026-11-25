import * as Notifications from "expo-notifications";
import { Platform } from "react-native";
import type { MuseApi } from "./api";

Notifications.setNotificationHandler({
  handleNotification: async () => ({
    shouldShowBanner: true,
    shouldShowList: true,
    shouldPlaySound: true,
    shouldSetBadge: false,
  }),
});

export async function registerPush(api: MuseApi): Promise<void> {
  if (Platform.OS === "web") return;
  try {
    const existing = await Notifications.getPermissionsAsync();
    const granted = existing.granted ? existing : await Notifications.requestPermissionsAsync();
    if (!granted.granted) return;
    const token = await readToken();
    if (!token) return;
    await api.request("/api/push/register", { token, platform: Platform.OS });
  } catch {
    return;
  }
}

async function readToken(): Promise<string | undefined> {
  const expo = await Notifications.getExpoPushTokenAsync().catch(() => undefined);
  if (expo?.data) return expo.data;
  const device = await Notifications.getDevicePushTokenAsync().catch(() => undefined);
  return device?.data ? String(device.data) : undefined;
}

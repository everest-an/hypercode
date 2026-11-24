import { ArrowLeft, ScanLine } from "lucide-react-native";
import { useState } from "react";
import { ScrollView, Text, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import {
  claimPairing,
  createSession,
  ServerUnreachableError,
  SessionStatusError,
  suggestedApiUrl,
} from "./api";
import type { SavedConnection } from "./connection";
import type { PairingTarget } from "./pairing";
import { hostOf, normalizeCode, normalizeServerUrl } from "./pairing";
import { Button, Card, colors, ErrorNotice, Field, Mascot, s } from "./ui";

/**
 * The first screen a phone sees. Cloud login (workspace address + access key) is the primary
 * path, so a phone can reach a hosted workspace with no computer running. Pairing stays as the
 * fallback for self-hosted setups that show a QR code on their own machine.
 */
export function ConnectScreen(props: {
  scanned?: PairingTarget;
  initialUrl?: string;
  notice?: string;
  /** Start on the access-key path, for a browser that is already the computer. */
  initialKeyMode?: boolean;
  onConnected: (connection: SavedConnection) => void;
  onCancel?: () => void;
}) {
  const [url, setUrl] = useState(props.scanned?.url ?? props.initialUrl ?? suggestedApiUrl);
  const [code, setCode] = useState(props.scanned?.code ?? "");
  const [accessKey, setAccessKey] = useState("");
  const [keyMode, setKeyMode] = useState(props.initialKeyMode ?? true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  const connect = async () => {
    const server = normalizeServerUrl(url);
    if (!server) {
      setError("Enter the computer's address, for example 192.168.1.20:8787.");
      return;
    }
    setBusy(true);
    setError("");
    try {
      if (keyMode) {
        const session = await createSession(server, accessKey || undefined);
        props.onConnected({ url: server, token: session.token });
        return;
      }
      if (!normalizeCode(code)) {
        setError("Enter the code shown under the QR code on your computer.");
        return;
      }
      const candidates = [server, ...(props.scanned?.alternates ?? [])];
      let lastError: unknown;
      for (const candidate of candidates) {
        try {
          const session = await claimPairing(candidate, code);
          props.onConnected({ url: candidate, token: session.token });
          return;
        } catch (e) {
          lastError = e;
          if (!(e instanceof ServerUnreachableError)) throw e;
        }
      }
      throw lastError;
    } catch (e) {
      setError(readableError(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: colors.canvas }}>
      <ScrollView
        contentContainerStyle={{
          flexGrow: 1,
          alignItems: "center",
          justifyContent: "center",
          padding: 24,
        }}
        keyboardShouldPersistTaps="handled"
      >
        <View style={{ width: "100%", maxWidth: 430, gap: 20 }}>
          {props.onCancel && (
            <Button small icon={ArrowLeft} onPress={props.onCancel} style={{ alignSelf: "flex-start" }}>
              Back to workspace
            </Button>
          )}
          <View style={{ alignItems: "center", gap: 8 }}>
            <Mascot size={72} />
            <Text
              style={{
                fontSize: 30,
                color: colors.text,
                letterSpacing: -1,
                fontWeight: "500",
                textAlign: "center",
              }}
            >
              Connect to your computer
            </Text>
            <Text style={[s.muted, { textAlign: "center" }]}>
              Open HyperCode on your computer, then Apps → Connect your phone. Scan the code with
              your Camera app, or type it below.
            </Text>
          </View>
          <Card style={{ gap: 4 }}>
            <ErrorNotice error={error || props.notice} />
            {props.scanned && (
              <View style={[s.row, { gap: 9, marginBottom: 14 }]}>
                <View style={s.iconBox}>
                  <ScanLine size={20} color={colors.blueDark} />
                </View>
                <Text style={[s.muted, { flex: 1 }]}>
                  Code scanned for {hostOf(props.scanned.url)}. Check the address, then connect.
                </Text>
              </View>
            )}
            <Field
              label="Workspace address"
              value={url}
              onChangeText={setUrl}
              autoCapitalize="none"
              autoCorrect={false}
              keyboardType="url"
              placeholder="acme.cloud.awareliquid.ai"
            />
            {keyMode ? (
              <Field
                label="Workspace access key"
                value={accessKey}
                onChangeText={setAccessKey}
                secureTextEntry
                autoCapitalize="none"
                placeholder="Paste the access key from your welcome email"
              />
            ) : (
              <Field
                label="Pairing code"
                value={code}
                onChangeText={setCode}
                autoCapitalize="characters"
                autoCorrect={false}
                placeholder="K7M2-Q9XP"
              />
            )}
            <Button primary busy={busy} onPress={() => void connect()}>
              {keyMode ? "Open workspace" : "Connect"}
            </Button>
            <Button small onPress={() => setKeyMode(!keyMode)} style={{ alignSelf: "center" }}>
              {keyMode ? "Use a pairing code instead" : "Use an access key instead"}
            </Button>
          </Card>
          {!keyMode && (
            <Text style={[s.small, { textAlign: "center" }]}>
              The code expires after five minutes and works once. Pairing opens the same workspace
              on both devices, so chats, tasks and approvals stay together.
            </Text>
          )}
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}

function readableError(error: unknown) {
  if (error instanceof SessionStatusError) return error.message;
  if (error instanceof ServerUnreachableError) return error.message;
  return error instanceof Error ? error.message : String(error);
}



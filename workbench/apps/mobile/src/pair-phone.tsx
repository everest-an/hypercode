import { Copy, RefreshCw, Smartphone } from "lucide-react-native";
import { useCallback, useEffect, useMemo, useState } from "react";
import { ActivityIndicator, Platform, Text, View } from "react-native";
import { SvgXml } from "react-native-svg";
import { pairingLink } from "./pairing";
import { renderSVG } from "./qr";
import { Button, Card, colors, ErrorNotice, LinkRow, SectionHeading, Sheet, s } from "./ui";
import { useWorkspace } from "./workspace";

interface Code {
  code: string;
  expiresAt: number;
  urls: string[];
  localOnly: boolean;
}

/** The Apps entry point to the pairing sheet. */
export function PairPhoneCard() {
  const [open, setOpen] = useState(false);
  return (
    <>
      <SectionHeading title="Phone" />
      <Card style={{ paddingVertical: 3, backgroundColor: "#F4F5F6" }}>
        <LinkRow
          icon={Smartphone}
          title="Connect your phone"
          detail="Scan once to open this workspace on HyperCode Remote"
          onPress={() => setOpen(true)}
        />
      </Card>
      {open && <PairPhoneSheet onClose={() => setOpen(false)} />}
    </>
  );
}

/**
 * The computer side of pairing: one short-lived code, shown as a QR code. The code is
 * single-use and never exposes the workspace access key itself.
 */
export function PairPhoneSheet({ onClose }: { onClose: () => void }) {
  const { api, notify } = useWorkspace();
  const [code, setCode] = useState<Code>();
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const [now, setNow] = useState(Date.now());

  const create = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      setCode(await api.request<Code>("/api/pairing", {}));
      setNow(Date.now());
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }, [api]);

  useEffect(() => {
    void create();
  }, [create]);

  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, []);

  // Keep the code fresh while the sheet is open: an expired code on screen is a dead end.
  useEffect(() => {
    if (code && now >= code.expiresAt && !loading && !error) void create();
  }, [code, now, loading, error, create]);

  const link = useMemo(
    () => (code?.urls[0] ? pairingLink(code.urls[0], code.code, code.urls.slice(1)) : ""),
    [code],
  );
  const remaining = code ? Math.max(0, Math.ceil((code.expiresAt - now) / 1000)) : 0;
  const canCopy = Platform.OS === "web" && Boolean(globalThis.navigator?.clipboard);

  return (
    <Sheet
      title="Connect your phone"
      subtitle="Scan the code with your phone's Camera app, or enter it in HyperCode Remote."
      onClose={onClose}
    >
      <View style={{ padding: 22, gap: 18, alignItems: "center" }}>
        <ErrorNotice error={error} />
        {!code ? (
          <View
            style={{
              width: 232,
              height: 232,
              borderRadius: 18,
              backgroundColor: "#FFF",
              alignItems: "center",
              justifyContent: "center",
            }}
          >
            <ActivityIndicator color={colors.blueDark} />
          </View>
        ) : code.localOnly ? (
          <LocalOnly />
        ) : (
          <>
            {link ? <Qr value={link} /> : null}
            <View style={{ alignItems: "center", gap: 4 }}>
              <Text style={s.label}>Pairing code</Text>
              <CodeText code={code.code} />
              <Text style={[s.small, { fontVariant: ["tabular-nums"] }]}>
                {remaining > 0
                  ? `Expires in ${Math.floor(remaining / 60)}:${String(remaining % 60).padStart(2, "0")}`
                  : "Generating a fresh code…"}
              </Text>
            </View>
            {code.urls.length ? (
              <View style={{ gap: 5, alignSelf: "stretch" }}>
                <Text style={[s.label, { textAlign: "center" }]}>
                  {code.urls.length > 1 ? "Addresses the phone can try" : "Address"}
                </Text>
                {code.urls.map((url) => (
                  <Text key={url} style={[s.small, { textAlign: "center" }]} selectable>
                    {url}
                  </Text>
                ))}
              </View>
            ) : null}
          </>
        )}
        <View style={[s.row, { gap: 9 }]}>
          {code && !code.localOnly && canCopy && (
            <Button
              icon={Copy}
              onPress={() => {
                void copy(link).then(
                  () => notify("Pairing link copied"),
                  () => notify("Could not copy the link"),
                );
              }}
            >
              Copy link
            </Button>
          )}
          <Button icon={RefreshCw} busy={loading} onPress={() => void create()}>
            New code
          </Button>
        </View>
        <Text style={[s.small, { textAlign: "center", maxWidth: 420 }]}>
          The code works once and expires after five minutes. Only someone with this code can join,
          and the phone gets its own session rather than your access key.
        </Text>
      </View>
    </Sheet>
  );
}

function LocalOnly() {
  return (
    <View style={{ gap: 10, alignItems: "center", maxWidth: 440 }}>
      <View style={s.iconBox}>
        <Smartphone size={22} color={colors.blueDark} />
      </View>
      <Text style={[s.heading, { textAlign: "center" }]}>This computer is only reachable here</Text>
      <Text style={[s.muted, { textAlign: "center" }]}>
        The server listens on localhost, so a phone cannot open it yet. In live mode, set{" "}
        <Text style={{ fontWeight: "700" }}>HOST=0.0.0.0</Text> in the server’s .env and restart it,
        or put the server behind an HTTPS address. Then open this sheet again.
      </Text>
      <Text style={[s.small, { textAlign: "center" }]}>
        Both devices must be on the same network unless the address is public.
      </Text>
    </View>
  );
}

function CodeText(props: { code: string }) {
  return (
    <Text
      selectable
      style={{
        fontSize: 30,
        letterSpacing: 3,
        fontWeight: "600",
        color: colors.text,
        fontVariant: ["tabular-nums"],
      }}
    >
      {props.code}
    </Text>
  );
}

function Qr(props: { value: string }) {
  const xml = useMemo(() => renderSVG(props.value, { border: 3 }), [props.value]);
  return (
    <View
      accessible
      accessibilityRole="image"
      accessibilityLabel="Pairing QR code"
      style={{ width: 232, height: 232, backgroundColor: "#FFF", padding: 10, borderRadius: 18 }}
    >
      <SvgXml xml={xml} width="100%" height="100%" />
    </View>
  );
}

async function copy(value: string) {
  if (!value) return;
  const clipboard = globalThis.navigator?.clipboard;
  if (!clipboard) throw new Error("Clipboard is unavailable");
  await clipboard.writeText(value);
}

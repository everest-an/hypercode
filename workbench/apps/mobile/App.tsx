import { CopilotKitProvider } from "@copilotkit/react-native/headless";
import { StatusBar } from "expo-status-bar";
import {
  Bell,
  Check,
  Lightbulb,
  type LucideIcon,
  Menu,
  MessageCircle,
  PanelsTopLeft,
  Shapes,
  SquareCheck,
  X,
} from "lucide-react-native";
import { useCallback, useEffect, useMemo, useState } from "react";
import {
  ActivityIndicator,
  AppState,
  Linking,
  Modal,
  Platform,
  Pressable,
  ScrollView,
  Text,
  useWindowDimensions,
  View,
} from "react-native";
import { SafeAreaProvider, SafeAreaView } from "react-native-safe-area-context";
import type { Section, Workspace } from "../../packages/domain/src";
import {
  AgentActivityScreen,
  AgentStatus,
  AppsScreen,
  GoalsScreen,
  IdeasScreen,
} from "./src/agent-ui";
import { AgentWorkspaceProvider, useAgentWorkspace } from "./src/agent-workspace";
import {
  createSession,
  defaultApiUrl,
  MuseApi,
  revokeSession,
  ServerUnreachableError,
  SessionExpiredError,
  SessionStatusError,
} from "./src/api";
import { ChatScreen, WorkspaceTools } from "./src/chat";
import { ComputerEntry } from "./src/computer";
import { ComputerDraftProvider } from "./src/computer-drafts";
import { ConnectScreen } from "./src/connect";
import {
  clearConnection,
  loadConnection,
  type SavedConnection,
  saveConnection,
} from "./src/connection";
import { Details } from "./src/details";
import { type PairingTarget, parsePairingLink } from "./src/pairing";
import { BrowserScreen, CalendarScreen, FilesScreen, MailScreen } from "./src/screens";
import { ThreadsProvider, ThreadsSheet, useMuseThread } from "./src/threads";
import { Button, colors, ErrorNotice, IconButton, Mascot, s } from "./src/ui";
import { type Detail, useWorkspace, WorkspaceContext } from "./src/workspace";

const nav: { id: Section; label: string; icon: LucideIcon }[] = [
  { id: "chat", label: "Chat", icon: MessageCircle },
  { id: "activity", label: "Activity", icon: PanelsTopLeft },
  { id: "ideas", label: "Ideas", icon: Lightbulb },
  { id: "goals", label: "Goals", icon: SquareCheck },
  { id: "apps", label: "Apps", icon: Shapes },
];
const titles: Partial<Record<Section, { title: string; subtitle: string }>> = {
  activity: { title: "Activity", subtitle: "Plans, progress, decisions and results." },
  ideas: { title: "Ideas", subtitle: "Useful next steps, grounded in your world." },
  goals: {
    title: "Goals",
    subtitle: "Longer-term goals and things to keep an eye on.",
  },
  apps: {
    title: "Apps",
    subtitle: "Connections, capabilities and what your agent remembers.",
  },
  connections: { title: "Apps", subtitle: "Connections and capabilities." },
  mail: { title: "Mail", subtitle: "The conversations behind your work." },
  calendar: { title: "Calendar", subtitle: "Time for what matters." },
  browser: { title: "Browser", subtitle: "Your connected browsing sessions." },
  files: { title: "Files", subtitle: "Documents, forms and filled copies." },
};
export default function App() {
  const [connection, setConnection] = useState<SavedConnection>();
  const [lastUrl, setLastUrl] = useState<string>();
  const [scanned, setScanned] = useState<PairingTarget>();
  const [notice, setNotice] = useState("");
  const [keyFirst, setKeyFirst] = useState(false);
  const [ready, setReady] = useState(false);

  // A QR code opened with the Camera app arrives as a deep link, including on a cold start.
  useEffect(() => {
    const receive = (value: string | null) => {
      const target = value ? parsePairingLink(value) : undefined;
      if (target) setScanned(target);
    };
    const subscription = Linking.addEventListener("url", (event) => receive(event.url));
    return () => subscription.remove();
  }, []);

  useEffect(() => {
    void (async () => {
      const initial = await Linking.getInitialURL().catch(() => null);
      const paired = initial ? parsePairingLink(initial) : undefined;
      if (paired) setScanned(paired);
      const saved = await loadConnection();
      if (saved) {
        setConnection(saved);
        setLastUrl(saved.url);
      } else if ((Platform.OS === "web" || process.env.EXPO_PUBLIC_API_URL) && !paired) {
        // The browser on the computer is already trusted, and a store build knows its own hosted
        // server: keep opening that workspace without a key, exactly as it did before pairing.
        try {
          const session = await createSession(defaultApiUrl);
          const next = { url: defaultApiUrl, token: session.token };
          setConnection(next);
          setLastUrl(next.url);
          void saveConnection(next).catch(() => {});
        } catch (e) {
          if (e instanceof ServerUnreachableError) setNotice(e.message);
          else if (e instanceof SessionStatusError) {
            setNotice("This workspace needs an access key or a pairing code.");
            setKeyFirst(true);
          }
        }
      }
      setReady(true);
    })();
  }, []);

  const connected = useCallback(
    (next: SavedConnection) => {
      if (connection && connection.token !== next.token)
        void revokeSession(connection.url, connection.token).catch(() => {});
      setConnection(next);
      setLastUrl(next.url);
      setScanned(undefined);
      setNotice("");
      void saveConnection(next).catch(() => {});
    },
    [connection],
  );

  const disconnect = useCallback(
    (message = "") => {
      if (connection) void revokeSession(connection.url, connection.token).catch(() => {});
      setConnection(undefined);
      setScanned(undefined);
      setNotice(message);
      void clearConnection().catch(() => {});
    },
    [connection],
  );

  const expire = useCallback(
    () => disconnect("Your session expired. Pair this phone with your computer again."),
    [disconnect],
  );

  return (
    <SafeAreaProvider>
      <StatusBar style="dark" />
      {!ready ? (
        <SafeAreaView
          style={{
            flex: 1,
            backgroundColor: colors.canvas,
            alignItems: "center",
            justifyContent: "center",
            gap: 18,
          }}
        >
          <Mascot size={56} />
          <ActivityIndicator color={colors.blueDark} />
        </SafeAreaView>
      ) : scanned ? (
        <ConnectScreen
          key={`${scanned.url} ${scanned.code}`}
          scanned={scanned}
          notice={notice}
          onConnected={connected}
          onCancel={connection ? () => setScanned(undefined) : undefined}
        />
      ) : connection ? (
        <CopilotKitProvider
          runtimeUrl={`${connection.url}/api/copilotkit`}
          headers={{ Authorization: `Bearer ${connection.token}` }}
        >
          <WorkspaceApp
            connection={connection}
            onExpired={expire}
            onDisconnect={() => disconnect()}
          />
        </CopilotKitProvider>
      ) : (
        <ConnectScreen
          initialUrl={lastUrl}
          notice={notice}
          initialKeyMode={keyFirst}
          onConnected={connected}
        />
      )}
    </SafeAreaProvider>
  );
}
function WorkspaceApp({
  connection,
  onExpired,
  onDisconnect,
}: {
  connection: SavedConnection;
  onExpired: () => void;
  onDisconnect: () => void;
}) {
  const api = useMemo(
    () => new MuseApi(connection.token, connection.url, onExpired),
    [connection, onExpired],
  );
  const [workspace, setWorkspace] = useState<Workspace>();
  const [section, setSection] = useState<Section>("chat");
  const [detail, setDetail] = useState<Detail>();
  const [toast, setToast] = useState("");
  const [error, setError] = useState("");
  const [prompt, setPrompt] = useState<{ id: number; text: string }>();
  const refresh = useCallback(async () => {
    const snapshot = await api.request<Workspace>("/api/workspace");
    setWorkspace(snapshot);
    setError("");
  }, [api]);
  // 401 由 MuseApi 的 onUnauthorized 退回登录屏；这里还要清掉上一次快照，
  // 否则过期后界面继续显示"已连接"的样子，点哪都失败却没有解释
  const fail = useCallback((e: unknown) => {
    if (e instanceof SessionExpiredError) setWorkspace(undefined);
    setError(e instanceof Error ? e.message : String(e));
  }, []);
  useEffect(() => {
    void refresh().catch(fail);
  }, [refresh, fail]);
  useEffect(() => {
    const listener = AppState.addEventListener("change", (state) => {
      if (state === "active") void refresh().catch(fail);
    });
    return () => listener.remove();
  }, [refresh, fail]);
  useEffect(() => {
    if (!toast) return;
    const timer = setTimeout(() => setToast(""), 5500);
    return () => clearTimeout(timer);
  }, [toast]);
  const navigate = useCallback(
    (next: Section) =>
      setSection(next === "today" ? "chat" : next === "connections" ? "apps" : next),
    [],
  );
  const open = useCallback((next: Detail) => setDetail(next), []);
  const close = useCallback(() => setDetail(undefined), []);
  const ask = useCallback((text: string) => {
    setPrompt({ id: Date.now(), text });
    setSection("chat");
  }, []);
  if (!workspace)
    return (
      <SafeAreaView
        style={{
          flex: 1,
          backgroundColor: colors.canvas,
          alignItems: "center",
          justifyContent: "center",
          padding: 24,
          gap: 18,
        }}
      >
        <Mascot size={56} />
        {error ? (
          <>
            <ErrorNotice error={error} />
            <Button onPress={() => void refresh().catch((e) => setError(String(e)))}>
              Try again
            </Button>
            <Button small onPress={onDisconnect}>
              Connect another computer
            </Button>
          </>
        ) : (
          <>
            <ActivityIndicator color={colors.blueDark} />
            <Text style={s.muted}>Opening your workspace…</Text>
          </>
        )}
      </SafeAreaView>
    );
  return (
    <WorkspaceContext.Provider
      value={{
        workspace,
        api,
        section,
        navigate,
        refresh,
        open,
        close,
        notify: setToast,
        ask,
        serverUrl: connection.url,
        disconnect: onDisconnect,
      }}
    >
      <AgentWorkspaceProvider>
        <ComputerDraftProvider key={connection.token}>
          <ThreadsProvider>
            <WorkspaceShell
              detail={detail}
              toast={toast}
              clearToast={() => setToast("")}
              error={error}
              prompt={prompt}
            />
          </ThreadsProvider>
        </ComputerDraftProvider>
      </AgentWorkspaceProvider>
    </WorkspaceContext.Provider>
  );
}
function WorkspaceShell({
  detail,
  toast,
  clearToast,
  error,
  prompt,
}: {
  detail?: Detail;
  toast: string;
  clearToast: () => void;
  error: string;
  prompt?: { id: number; text: string };
}) {
  const { workspace, section, navigate, open } = useWorkspace();
  const { data } = useAgentWorkspace();
  const {
    selection,
    visited,
    mainId,
    loading: threadsLoading,
    error: threadsError,
    retry: retryThreads,
    enabled: richThreads,
  } = useMuseThread();
  const [threadsOpen, setThreadsOpen] = useState(false);
  const { width } = useWindowDimensions();
  const desktop = width >= 900;
  const pending =
    (data?.notifications.filter((n) => !n.read).length || 0) +
    workspace.actions.filter((a) => a.status === "awaiting_review").length;
  const activeTask =
    data?.tasks.find(
      (task) => task.status === "waiting_approval" || task.status === "waiting_input",
    ) || data?.tasks.find((task) => task.status === "running");
  const agentName = data?.identity.name || "HyperCode";
  const status = activeTask
    ? activeTask.status === "waiting_approval"
      ? `Ready to review · ${activeTask.title}`
      : activeTask.status === "waiting_input"
        ? `Needs your input · ${activeTask.title}`
        : activeTask.plan.find((step) => step.status === "running")?.title || activeTask.title
    : data?.tasks.some((task) => task.status === "queued")
      ? "Picking up your next task…"
      : "Here when you need me";
  const title = titles[section] || titles.apps;
  const Screen =
    section === "mail"
      ? MailScreen
      : section === "calendar"
        ? CalendarScreen
        : section === "browser"
          ? BrowserScreen
          : section === "files"
            ? FilesScreen
            : section === "activity"
              ? AgentActivityScreen
              : section === "ideas"
                ? IdeasScreen
                : section === "goals"
                  ? GoalsScreen
                  : AppsScreen;
  const utility = ["mail", "calendar", "browser", "files"].includes(section);
  return (
    <>
      <WorkspaceTools />
      <SafeAreaView style={{ flex: 1, backgroundColor: colors.canvas }} edges={["top", "bottom"]}>
        <View style={{ flex: 1, width: "100%", maxWidth: 760, alignSelf: "center" }}>
          <View
            style={{
              height: desktop ? 146 : 122,
              paddingTop: desktop ? 14 : 2,
              marginHorizontal: 20,
            }}
          >
            <View style={{ position: "absolute", left: 0, top: 16 }}>
              <IconButton
                icon={Menu}
                label="Open conversations and menu"
                onPress={() => setThreadsOpen(true)}
              />
            </View>
            <View style={{ alignItems: "center", gap: 1 }}>
              <Pressable
                accessibilityRole="button"
                accessibilityLabel={`Open ${agentName} activity and approvals`}
                onPress={() => navigate("activity")}
                style={({ pressed }) => ({
                  alignItems: "center",
                  maxWidth: "70%",
                  opacity: pressed ? 0.65 : 1,
                })}
              >
                <Mascot size={desktop ? 58 : 49} variant={data?.identity.avatar} />
                <Text
                  style={{
                    fontSize: 16,
                    fontWeight: "600",
                    color: colors.text,
                    letterSpacing: -0.4,
                  }}
                >
                  {agentName}
                </Text>
                <Text
                  numberOfLines={1}
                  style={{ fontSize: 11, color: colors.muted, marginBottom: 6 }}
                >
                  {status}
                </Text>
              </Pressable>
              {section === "chat" && <ComputerEntry />}
            </View>
            <View style={{ position: "absolute", right: 0, top: 16 }}>
              <IconButton
                icon={Bell}
                label={`Notifications, ${pending} unread or pending`}
                onPress={() => open({ type: "notifications" })}
              />
              {pending > 0 && (
                <View
                  pointerEvents="none"
                  style={{
                    width: 6,
                    height: 6,
                    borderRadius: 4,
                    position: "absolute",
                    top: 7,
                    right: 9,
                    backgroundColor: colors.blueDark,
                  }}
                />
              )}
            </View>
          </View>
          <View style={{ flex: 1, minHeight: 0 }}>
            {section !== "chat" && (
              <ScrollView
                key={section}
                showsVerticalScrollIndicator={false}
                contentContainerStyle={{ paddingHorizontal: desktop ? 42 : 22, paddingBottom: 28 }}
                keyboardShouldPersistTaps="handled"
              >
                {utility && (
                  <Button
                    small
                    style={{ alignSelf: "flex-start", marginBottom: 18 }}
                    onPress={() => navigate("apps")}
                  >
                    Back to Apps
                  </Button>
                )}
                <Text style={[s.title, { fontSize: 25, marginBottom: 22 }]}>{title?.title}</Text>
                <ErrorNotice error={error} />
                <Screen />
              </ScrollView>
            )}
            <View
              style={{
                display: section === "chat" ? "flex" : "none",
                flex: 1,
                paddingHorizontal: desktop ? 42 : 17,
              }}
            >
              <AgentStatus />
              {richThreads ? (
                <>
                  <ErrorNotice error={threadsError} />
                  {threadsError ? (
                    <Button onPress={retryThreads}>Retry main chat</Button>
                  ) : threadsLoading ? (
                    <ActivityIndicator color={colors.blueDark} />
                  ) : null}
                  {!threadsLoading && selection.id !== mainId && (
                    <Text style={[s.small, { textAlign: "center", marginBottom: 8 }]}>
                      Side chat
                    </Text>
                  )}
                  {visited.map((thread) => (
                    <View
                      key={thread.id}
                      style={{ display: selection.id === thread.id ? "flex" : "none", flex: 1 }}
                    >
                      <ChatScreen
                        thread={thread}
                        active={section === "chat" && selection.id === thread.id}
                        prompt={selection.id === thread.id ? prompt : undefined}
                      />
                    </View>
                  ))}
                </>
              ) : (
                <ChatScreen prompt={prompt} active={section === "chat"} />
              )}
            </View>
          </View>
          <View
            style={{
              paddingHorizontal: 22,
              paddingTop: 10,
              paddingBottom: desktop ? 22 : 7,
              alignItems: "center",
            }}
          >
            <View
              style={{
                flexDirection: "row",
                width: "100%",
                maxWidth: 370,
                padding: 5,
                backgroundColor: "#FFF",
                borderRadius: 40,
                shadowColor: "#132631",
                shadowOffset: { width: 0, height: 2 },
                shadowOpacity: 0.07,
                shadowRadius: 18,
                elevation: 3,
                borderWidth: 1,
                borderColor: "#F8F8F8",
              }}
            >
              {nav.map((item) => {
                const active = section === item.id || (item.id === "apps" && utility);
                return (
                  <Pressable
                    key={item.id}
                    accessibilityRole="tab"
                    accessibilityLabel={item.label}
                    accessibilityState={{ selected: active }}
                    onPress={() => navigate(item.id)}
                    style={{
                      flex: 1,
                      height: 47,
                      alignItems: "center",
                      justifyContent: "center",
                      backgroundColor: active ? "#F0F1F2" : "transparent",
                      borderRadius: 28,
                    }}
                  >
                    <item.icon size={23} strokeWidth={1.8} color={colors.text} />
                  </Pressable>
                );
              })}
            </View>
          </View>
        </View>
        {/* 详情弹层是 Modal（web 上是 portal），普通绝对定位再高的 zIndex 也在它下面；
            所以提示也走 Modal——条件挂载让它的 portal 后建，才压得住先开的弹层 */}
        {!!toast && (
          <Modal transparent animationType="none" visible onRequestClose={clearToast}>
            <View
              pointerEvents="box-none"
              style={{
                position: "absolute",
                bottom: 94,
                left: 20,
                right: 20,
                alignItems: "center",
              }}
            >
              <View
                style={[
                  s.row,
                  {
                    gap: 10,
                    padding: 14,
                    backgroundColor: colors.text,
                    borderRadius: 20,
                    maxWidth: 560,
                  },
                ]}
              >
                <Check size={16} color={colors.blue} />
                <Text style={{ color: "#FFF", fontSize: 13, flexShrink: 1 }}>{toast}</Text>
                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel="Dismiss notification"
                  onPress={clearToast}
                >
                  <X size={16} color="#FFF" />
                </Pressable>
              </View>
            </View>
          </Modal>
        )}
        {threadsOpen && <ThreadsSheet onClose={() => setThreadsOpen(false)} />}
        {detail && (
          <Details
            key={
              detail.type === "task"
                ? detail.taskId
                : detail.type === "file"
                  ? detail.file.id
                  : detail.type === "browser"
                    ? detail.browser.id
                    : detail.type === "mail"
                      ? detail.mail.id
                      : detail.type === "review"
                        ? detail.action.id
                        : detail.type === "email"
                          ? JSON.stringify(detail.draft)
                          : detail.type === "event"
                            ? detail.event?.id || "event-new"
                            : detail.type
            }
            detail={detail}
          />
        )}
      </SafeAreaView>
    </>
  );
}

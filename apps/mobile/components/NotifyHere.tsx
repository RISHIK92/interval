import { type } from "@interval/tokens";
import { useEffect, useState } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import { currentPush, disablePush, enablePush } from "../lib/push";
import { useColors } from "./theme";

const SAID = {
  blocked:
    "Notifications are blocked in Settings. Turn them on there to get them here.",
  "not-on-plan": "Notifications aren't on your plan.",
  failed: "Couldn't turn notifications on. Try again in a moment.",
} as const;

// P4-W19-S04a: Profile's "Notify me on this phone".
export function NotifyHere() {
  const c = useColors();
  const [token, setToken] = useState<string | null>(null);
  const [said, setSaid] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  // On or off as the phone stands, so Turn off survives a restart (and a downgrade:
  // removing needs no capability, ADR-0036).
  useEffect(() => {
    let live = true;
    currentPush()
      .then((found) => {
        if (live) setToken(found);
      })
      .catch((error: unknown) => {
        console.warn("push: state unknown", error);
      });
    return () => {
      live = false;
    };
  }, []);

  const turnOn = async () => {
    setBusy(true);
    try {
      const result = await enablePush();
      if (result.status === "on") {
        setToken(result.token);
        setSaid("Notifications are on.");
      } else setSaid(SAID[result.status]);
    } catch (error) {
      console.warn("push: not turned on", error);
      setSaid(SAID.failed);
    } finally {
      setBusy(false);
    }
  };
  const turnOff = async (current: string) => {
    setBusy(true);
    try {
      if (await disablePush(current)) {
        setToken(null);
        setSaid(null);
      } else setSaid("Couldn't turn notifications off. Try again in a moment.");
    } catch (error) {
      console.warn("push: not turned off", error);
      setSaid("Couldn't turn notifications off. Try again in a moment.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <View style={styles.box}>
      {said === null ? null : (
        <Text accessibilityRole="alert" style={{ color: c["ink-muted"] }}>
          {said}
        </Text>
      )}
      <Pressable
        accessibilityRole="button"
        disabled={busy}
        onPress={() => void (token === null ? turnOn() : turnOff(token))}
        style={[styles.button, { borderColor: c.hairline }]}
      >
        <Text style={{ color: c.ink, fontWeight: type.section.weight }}>
          {token === null ? "Notify me on this phone" : "Turn off"}
        </Text>
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  box: { marginTop: 16, gap: 8 },
  button: {
    borderWidth: 1,
    borderRadius: 999,
    padding: 12,
    alignItems: "center",
    alignSelf: "flex-start",
    paddingHorizontal: 20,
  },
});

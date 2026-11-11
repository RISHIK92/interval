import { PUSH_HOURS, type PushPreferences } from "@interval/api-client";
import { useEffect, useState } from "react";
import { Pressable, StyleSheet, Switch, Text, View } from "react-native";
import { readPushSettings, savePushSettings } from "../lib/push";
import { useColors } from "./theme";

// P4-W24-S01 (Q-P4-13; owner, 2026-11-11): which pushes, each off until turned on, and
// the one hour of the day for any of them. Every change saves at once; a plan without
// push (403) shows nothing.
const KINDS = [
  {
    key: "dailyChallenge",
    name: "Daily challenge",
    what: "When today's challenge is still unplayed.",
  },
  {
    key: "pathReminder",
    name: "Path reminders",
    what: "After two days without a reading on your path.",
  },
  {
    key: "digest",
    name: "Your break is ready",
    what: "When your feed has something you haven't opened.",
  },
] as const;

const at = (hour: number) => `${String(hour).padStart(2, "0")}:00`;

export function PushSettings() {
  const c = useColors();
  const [saved, setSaved] = useState<PushPreferences | null>(null);
  // One save at a time (each sends the whole state): the controls wait, and a failure
  // goes back to what the server last confirmed.
  const [saving, setSaving] = useState(false);
  const [status, setStatus] = useState<string | null>(null);
  useEffect(() => {
    void readPushSettings().then((read) => {
      if (read.status === "ok") setSaved(read.value);
    });
  }, []);
  if (saved === null) return null;

  const change = (next: PushPreferences) => {
    const confirmed = saved;
    setSaved(next);
    setSaving(true);
    setStatus(null);
    void savePushSettings(next).then((ok) => {
      if (!ok) {
        setSaved(confirmed);
        setStatus("Couldn’t save. Try again.");
      }
      setSaving(false);
    });
  };
  const step = (by: number) => {
    const hour = saved.hour + by;
    if (hour >= PUSH_HOURS.min && hour <= PUSH_HOURS.max)
      change({ ...saved, hour });
  };
  const round = [styles.round, { borderColor: c.hairline }];

  return (
    <View style={styles.box}>
      <Text
        accessibilityRole="header"
        style={[styles.heading, { color: c.ink }]}
      >
        Notifications
      </Text>
      <Text style={{ color: c["ink-muted"] }}>
        At most one a day, at the hour you pick, never between 21:00 and 08:00.
      </Text>
      {KINDS.map((kind) => (
        <View key={kind.key} style={styles.row}>
          <View style={styles.text}>
            <Text style={[styles.name, { color: c.ink }]}>{kind.name}</Text>
            <Text style={{ color: c["ink-muted"] }}>{kind.what}</Text>
          </View>
          <Switch
            accessibilityLabel={kind.name}
            accessibilityHint={kind.what}
            disabled={saving}
            value={saved[kind.key]}
            onValueChange={(on) => {
              change({ ...saved, [kind.key]: on });
            }}
          />
        </View>
      ))}
      <View style={styles.row}>
        <Text style={[styles.name, styles.text, { color: c.ink }]}>At</Text>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Earlier"
          disabled={saving || saved.hour <= PUSH_HOURS.min}
          style={round}
          onPress={() => {
            step(-1);
          }}
        >
          <Text style={{ color: c.ink }}>−</Text>
        </Pressable>
        <Text
          accessibilityLabel={`Hour ${at(saved.hour)}`}
          // Said again after Earlier or Later.
          accessibilityLiveRegion="polite"
          style={{ color: c.ink }}
        >
          {at(saved.hour)}
        </Text>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Later"
          disabled={saving || saved.hour >= PUSH_HOURS.max}
          style={round}
          onPress={() => {
            step(1);
          }}
        >
          <Text style={{ color: c.ink }}>+</Text>
        </Pressable>
      </View>
      {status === null ? null : (
        <Text accessibilityRole="alert" style={{ color: c.ink }}>
          {status}
        </Text>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  box: { marginTop: 24, gap: 12 },
  heading: { fontSize: 18, fontWeight: "600" },
  row: { flexDirection: "row", alignItems: "center", gap: 12 },
  text: { flex: 1 },
  name: { fontWeight: "600" },
  round: {
    width: 44,
    height: 44,
    borderRadius: 22,
    borderWidth: 1,
    alignItems: "center",
    justifyContent: "center",
  },
});

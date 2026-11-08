import { type } from "@interval/tokens";
import { useState } from "react";
import {
  Linking,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import { useColors } from "../components/theme";
import { SITE, authClient } from "../lib/auth";

// P4-W19-S03 (ADR-0016, Q-P4-02): accounts come from an invite on the web; the app only
// signs in. No guests on native.
export default function SignInScreen() {
  const c = useColors();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const signIn = async () => {
    setBusy(true);
    setError(null);
    try {
      const result = await authClient.signIn.email({ email, password });
      if (result.error !== null)
        setError(
          result.error.status === 401
            ? "Wrong email or password."
            : "Couldn't sign in. Try again in a moment.",
        );
    } catch (thrown) {
      console.warn("sign in failed", thrown);
      setError("Can't reach Interval. Check your connection.");
    } finally {
      setBusy(false);
    }
  };

  const field = [
    styles.field,
    { borderColor: c.hairline, color: c.ink, backgroundColor: c.well },
  ];
  return (
    <View style={[styles.page, { backgroundColor: c.page }]}>
      <Text accessibilityRole="header" style={[styles.title, { color: c.ink }]}>
        Sign in
      </Text>
      <TextInput
        accessibilityLabel="Email"
        placeholder="Email"
        placeholderTextColor={c["ink-muted"]}
        autoCapitalize="none"
        autoComplete="email"
        keyboardType="email-address"
        value={email}
        onChangeText={setEmail}
        style={field}
      />
      <TextInput
        accessibilityLabel="Password"
        placeholder="Password"
        placeholderTextColor={c["ink-muted"]}
        secureTextEntry
        autoComplete="current-password"
        value={password}
        onChangeText={setPassword}
        style={field}
      />
      {error === null ? null : (
        <Text accessibilityRole="alert" style={{ color: c.wrong }}>
          {error}
        </Text>
      )}
      <Pressable
        accessibilityRole="button"
        disabled={busy || email === "" || password === ""}
        onPress={() => void signIn()}
        style={[styles.button, { backgroundColor: c.ink }]}
      >
        <Text style={[styles.buttonText, { color: c.page }]}>
          {busy ? "Signing in…" : "Sign in"}
        </Text>
      </Pressable>
      <Text style={{ color: c["ink-muted"] }}>
        New here? Interval is invite-only: join on the web with your invite.
      </Text>
      <Pressable
        accessibilityRole="link"
        onPress={() => void Linking.openURL(`${SITE}/join`)}
      >
        <Text style={{ color: c.select }}>Join on the web</Text>
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  page: { flex: 1, padding: 24, gap: 12, justifyContent: "center" },
  title: {
    fontSize: type.display.size,
    fontWeight: type.display.weight,
    marginBottom: 8,
  },
  field: {
    borderWidth: 1,
    borderRadius: 12,
    padding: 14,
    fontSize: type.body.size,
  },
  button: { borderRadius: 999, padding: 14, alignItems: "center" },
  buttonText: { fontWeight: type.section.weight, fontSize: type.body.size },
});

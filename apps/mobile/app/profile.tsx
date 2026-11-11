import { type } from "@interval/tokens";
import { Pressable, ScrollView, StyleSheet, Text } from "react-native";
import { NotifyHere } from "../components/NotifyHere";
import { PushSettings } from "../components/PushSettings";
import { useColors } from "../components/theme";
import { authClient } from "../lib/auth";
import { discardBooks } from "../lib/books";
import { listen } from "../lib/listen";
import { forgetThisPhone } from "../lib/push";

// P4-W19-S03: who is signed in, and Sign out. The rest of Profile arrives with its slices.
export default function ProfileScreen() {
  const c = useColors();
  const { data } = authClient.useSession();
  return (
    <ScrollView
      style={{ backgroundColor: c.page }}
      contentContainerStyle={styles.page}
    >
      <Text style={{ color: c["ink-muted"] }}>Signed in as</Text>
      <Text style={[styles.email, { color: c.ink }]}>{data?.user.email}</Text>
      <Pressable
        accessibilityRole="button"
        onPress={() => {
          // The session is cleared on the phone first; if the server can't be told,
          // its copy lapses on its own (30 days), so the failure is only logged.
          // P4-W19-S04a: the phone stops getting this account's pushes first.
          // P4-W21-S04 (DB-6): no book file outlives the session.
          // P4-W23-S02: nor does this account's audio.
          listen().reset();
          forgetThisPhone()
            .then(() => discardBooks())
            .then(() => authClient.signOut())
            .catch((error: unknown) => {
              console.warn("sign out: server not told", error);
            });
        }}
        style={[styles.button, { borderColor: c.hairline }]}
      >
        <Text style={{ color: c.ink, fontWeight: type.section.weight }}>
          Sign out
        </Text>
      </Pressable>
      <NotifyHere />
      <PushSettings />
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  page: { padding: 24, gap: 8 },
  email: { fontSize: type.section.size, fontWeight: type.section.weight },
  button: {
    marginTop: 16,
    borderWidth: 1,
    borderRadius: 999,
    padding: 12,
    alignItems: "center",
    alignSelf: "flex-start",
    paddingHorizontal: 20,
  },
});

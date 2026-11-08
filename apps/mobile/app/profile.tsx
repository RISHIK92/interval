import { type } from "@interval/tokens";
import { Pressable, StyleSheet, Text, View } from "react-native";
import { NotifyHere } from "../components/NotifyHere";
import { useColors } from "../components/theme";
import { authClient } from "../lib/auth";
import { forgetThisPhone } from "../lib/push";

// P4-W19-S03: who is signed in, and Sign out. The rest of Profile arrives with its slices.
export default function ProfileScreen() {
  const c = useColors();
  const { data } = authClient.useSession();
  return (
    <View style={[styles.page, { backgroundColor: c.page }]}>
      <Text style={{ color: c["ink-muted"] }}>Signed in as</Text>
      <Text style={[styles.email, { color: c.ink }]}>{data?.user.email}</Text>
      <Pressable
        accessibilityRole="button"
        onPress={() => {
          // The session is cleared on the phone first; if the server can't be told,
          // its copy lapses on its own (30 days), so the failure is only logged.
          // P4-W19-S04a: the phone stops getting this account's pushes first.
          forgetThisPhone()
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
    </View>
  );
}

const styles = StyleSheet.create({
  page: { flex: 1, padding: 24, gap: 8 },
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

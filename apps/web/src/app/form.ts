// What a server action hands back to its form: null before the first submit.
export type FormState = { message: string } | null;

// A field the browser sent as a file, or not at all, counts as empty.
export function textField(form: FormData, name: string): string {
  const value = form.get(name);
  return typeof value === "string" ? value : "";
}

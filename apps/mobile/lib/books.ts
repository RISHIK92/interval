import {
  BookFinished,
  BookReading,
  BooksResponse,
  ChapterEnd,
} from "@interval/api-client";
import ReactNativeBlobUtil from "react-native-blob-util";
import { api, got } from "./api";
import { authClient, SITE } from "./auth";

// P4-W21-S04 (§5F, DB-6): the user's own PDF books, from the site's API.
export const readBooks = async () =>
  got(await api("/api/books", { method: "GET" }), BooksResponse, "books");

export const readSession = async (bookId: string, session: string | null) =>
  got(
    await api(
      `/api/books/${bookId}${session === null ? "" : `?session=${session}`}`,
      { method: "GET" },
    ),
    BookReading,
    "book",
  );

// Mark done; the chapter whose last session it was, if any.
export const finishSession = async (bookId: string, sessionId: string) =>
  got(
    await api(`/api/books/${bookId}/finish`, {
      method: "POST",
      body: { sessionId },
    }),
    BookFinished,
    "book",
  );

// The place kept, as the web's KeepPlace posts it.
export async function savePlace(
  bookId: string,
  sessionId: string,
  fraction: number,
): Promise<void> {
  const response = await api(`/api/books/${bookId}/position`, {
    method: "POST",
    body: { sessionId, fraction },
  });
  if (!response.ok) console.warn("book: place not kept", response.status);
}

export const readChapter = async (bookId: string, chapterId: string) =>
  got(
    await api(`/api/books/${bookId}/checkpoint/${chapterId}`, {
      method: "GET",
    }),
    ChapterEnd,
    "chapter",
  );

export async function askCheckpoint(
  bookId: string,
  chapterId: string,
): Promise<boolean> {
  const response = await api(`/api/books/${bookId}/checkpoint/${chapterId}`, {
    method: "POST",
  });
  if (!response.ok) console.warn("chapter: not asked", response.status);
  return response.ok;
}

// The private file (DB-6), fetched with the session as the web's reader fetches it, into
// a temporary file of its own for this open. The reader deletes it when it closes; a
// failed or cancelled fetch deletes what it wrote; and any left by a killed app go at
// the next start or at sign out (discardBooks). Nothing is kept beyond the session.
const PREFIX = "book-";
export function downloadBook(bookId: string): {
  file: Promise<string>;
  cancel: () => void;
} {
  const path = `${ReactNativeBlobUtil.fs.dirs.CacheDir}/${PREFIX}${bookId}-${String(Date.now())}.pdf`;
  const stop = { asked: false };
  let request: ReturnType<
    ReturnType<typeof ReactNativeBlobUtil.config>["fetch"]
  > | null = null;
  const file = (async () => {
    const cookie = await authClient.getCookie();
    // Closed while the session was read: no fetch at all.
    if (stop.asked) throw new Error("book file: cancelled");
    request = ReactNativeBlobUtil.config({ path }).fetch(
      "GET",
      `${SITE}/api/books/${bookId}/file`,
      { cookie, "expo-origin": "interval://" },
    );
    try {
      const response = await request;
      const status = response.info().status;
      if (status !== 200) throw new Error(`book file: ${String(status)}`);
      return path;
    } catch (error) {
      await discardBook(path);
      throw error;
    }
  })();
  return {
    file,
    cancel: () => {
      stop.asked = true;
      void request?.cancel().catch((error: unknown) => {
        console.warn("book: fetch not cancelled", error);
      });
    },
  };
}

export async function discardBook(path: string): Promise<void> {
  try {
    if (await ReactNativeBlobUtil.fs.exists(path))
      await ReactNativeBlobUtil.fs.unlink(path);
  } catch (error) {
    console.warn("book: temporary file not removed", error);
  }
}

// The page a session opens at: where the reader left off in it, else its first page.
export function openingPage(reading: BookReading): number {
  const span = reading.lastPage - reading.firstPage;
  return reading.fraction === null
    ? reading.firstPage
    : reading.firstPage + Math.round(reading.fraction * span);
}

// Every book file left behind (the app killed while one was open).
export async function discardBooks(): Promise<void> {
  const dir = ReactNativeBlobUtil.fs.dirs.CacheDir;
  try {
    const names = await ReactNativeBlobUtil.fs.ls(dir);
    await Promise.all(
      names
        .filter((name) => name.startsWith(PREFIX) && name.endsWith(".pdf"))
        .map((name) => discardBook(`${dir}/${name}`)),
    );
  } catch (error) {
    console.warn("book: temporary files not cleared", error);
  }
}

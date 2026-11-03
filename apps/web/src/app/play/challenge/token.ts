import { z } from "zod";

// P3-W17-S03: a challenge link's token as Challenges.create makes it (16 random bytes,
// base64url); anything else is no challenge.
export const TOKEN = z.string().regex(/^[A-Za-z0-9_-]{22}$/);

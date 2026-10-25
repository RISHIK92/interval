// Ports (ADR-0012): what server logic and pages depend on. Adapters implement them;
// container.ts wires them. Nothing outside adapters/ imports kysely or pg.

// What a card may show (§3.2, ING-2): no summary or body text.
export type FeedCard = {
  momentId: string;
  sectionTitle: string;
  sectionNumber: number;
  sectionCount: number;
  estimatedMinutes: number;
  link: string;
  articleTitle: string;
  author: string | null;
  sourceName: string;
};

export interface FeedReader {
  list(limit: number): Promise<FeedCard[]>;
}

export interface DatabasePing {
  // Resolves when the database answers; rejects otherwise.
  ping(): Promise<void>;
}

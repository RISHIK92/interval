import { BoardResponse } from "@interval/api-client";
import { api, got } from "./api";

// P4-W21-S03 (§6.7): a board from the site's API; a 409 is a username still to pick.
export const readBoard = async (query: {
  game: string;
  scope: string;
  period: string;
}) =>
  got(
    await api(`/api/boards?${new URLSearchParams(query).toString()}`, {
      method: "GET",
    }),
    BoardResponse,
    "board",
  );

// When the return prompt asks (§5D, Q-P1-32): after a card is opened and the reader
// leaves for the publisher's tab, coming back asks once about that card. Pure, so the
// rule is tested without a browser.
export type Opened = { itemId: string; momentId: string | null };

export type PromptState = {
  open: Opened | null; // the card opened last, not yet asked about
  left: boolean; // the tab was hidden since that open
  prompt: Opened | null; // what the prompt is asking about now
};

export type PromptEvent =
  | { type: "opened"; open: Opened }
  | { type: "hidden" }
  | { type: "visible" }
  | { type: "closed" };

export const initialPrompt: PromptState = {
  open: null,
  left: false,
  prompt: null,
};

export function promptState(
  state: PromptState,
  event: PromptEvent,
): PromptState {
  switch (event.type) {
    case "opened":
      return { ...state, open: event.open, left: false };
    case "hidden":
      return state.open === null ? state : { ...state, left: true };
    case "visible":
      // Once per open: asking clears it.
      return state.open !== null && state.left
        ? { open: null, left: false, prompt: state.open }
        : state;
    case "closed":
      return { ...state, prompt: null };
  }
}

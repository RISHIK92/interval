// Where a new component goes on the canvas: the first free cell of a grid sized for the
// design's node cards, so it never lands on another one (nodes placed before the grid,
// or dragged, can sit anywhere).
const CELL = { width: 150, height: 110 };
const COLUMNS = 4;
// How far apart two cards must be, one way or the other: a card and some room.
const CLEAR = { x: CELL.width - 20, y: CELL.height - 20 };

export function freeSpot(
  taken: { position?: { x: number; y: number } | undefined }[],
): { x: number; y: number } {
  for (let i = 0; ; i++) {
    const spot = {
      x: CELL.width * (i % COLUMNS),
      y: CELL.height * Math.floor(i / COLUMNS),
    };
    const clear = taken.every((n) => {
      const at = n.position ?? { x: 0, y: 0 };
      return (
        Math.abs(at.x - spot.x) >= CLEAR.x || Math.abs(at.y - spot.y) >= CLEAR.y
      );
    });
    if (clear) return spot;
  }
}

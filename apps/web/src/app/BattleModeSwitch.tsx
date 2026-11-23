import type { BattleMode } from "../server/ports";
import { BATTLE_MODE_NAMES } from "./battle-mode";

// §6.2 (ADR-0047): the battle lobbies' mode choice, drawn as the design's segmented
// control (Play hub, web: a well with the chosen segment lifted). Still a radio group:
// the inputs are only hidden from sight, so keys and screen readers work as before. Each
// mode's detail is part of its radio's name; the chosen one's also shows beneath.
export function BattleModeSwitch({
  value,
  details,
  disabled,
  onChange,
  className = "",
}: {
  value: BattleMode;
  details: Record<BattleMode, string>; // what each mode allows, after its name
  disabled: boolean;
  onChange: (battleMode: BattleMode) => void;
  className?: string;
}) {
  return (
    <div className={`flex flex-col gap-1.5 ${className}`}>
      <fieldset
        disabled={disabled}
        className="flex gap-1 rounded-2xl bg-well p-1 disabled:opacity-60 lg:rounded-[14px]"
      >
        <legend className="sr-only">Battle mode</legend>
        {(["human", "ai"] as const).map((l) => (
          <label
            key={l}
            className="flex flex-1 cursor-pointer items-center justify-center rounded-xl px-3 py-2 text-center text-ink-muted has-checked:bg-lift has-checked:text-ink has-checked:shadow-card has-focus-visible:ring-2 has-focus-visible:ring-select has-disabled:cursor-not-allowed lg:rounded-[10px] lg:px-4"
          >
            <input
              type="radio"
              name="battleMode"
              value={l}
              checked={value === l}
              onChange={() => {
                onChange(l);
              }}
              className="sr-only"
            />
            <span className="text-[15px] font-semibold">
              {BATTLE_MODE_NAMES[l]}
            </span>
            <span className="sr-only">: {details[l]}</span>
          </label>
        ))}
      </fieldset>
      <p
        aria-hidden="true"
        className="text-[13px] text-ink-muted lg:text-right"
      >
        {BATTLE_MODE_NAMES[value]}: {details[value]}
      </p>
    </div>
  );
}

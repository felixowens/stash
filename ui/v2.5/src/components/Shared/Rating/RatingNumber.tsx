import React, { useEffect, useState } from "react";
import { Button } from "react-bootstrap";
import { Icon } from "../Icon";
import {
  faCaretDown,
  faCaretUp,
  faPencil,
  faStar,
} from "@fortawesome/free-solid-svg-icons";
import { useFocusOnce } from "src/utils/focus";
import { PatchComponent } from "src/patch";

export interface IRatingNumberProps {
  value: number | null;
  onSetRating?: (value: number | null) => void;
  disabled?: boolean;
  clickToRate?: boolean;
  // true if we should indicate that this is a rating
  withoutContext?: boolean;
}

// Ratings are stored as an integer 0-100; the decimal system shows them as
// 0.0-10.0 (value / 10).
function formatRating(value: number | null): string {
  return value == null ? "" : (value / 10).toFixed(1);
}

// Parse the raw input string back to a 0-100 rating.
//   ""        -> null      (cleared / unset)
//   invalid   -> undefined (ignore — leave the field as the user typed it)
//   otherwise -> clamped, rounded 0-100 (0 collapses to null, i.e. unset)
function parseRating(raw: string): number | null | undefined {
  const trimmed = raw.trim();
  if (trimmed === "") {
    return null;
  }
  const n = Number(trimmed);
  if (!Number.isFinite(n)) {
    return undefined;
  }
  const clamped = Math.min(10, Math.max(0, n));
  return Math.round(clamped * 10) || null;
}

// Allow only a partial decimal as it's typed (e.g. "", "7", "7.", ".5",
// "10.0"). Anything else (letters, a second dot) is rejected so the field
// never shows garbage.
const PARTIAL_DECIMAL = /^\d*\.?\d*$/;

export const RatingNumber = PatchComponent(
  "RatingNumber",
  (props: IRatingNumberProps) => {
    const [editing, setEditing] = useState(false);
    const [focused, setFocused] = useState(false);
    const [inputValue, setInputValue] = useState(() =>
      formatRating(props.value)
    );

    const [ratingRef] = useFocusOnce(editing, true);

    // Mirror the external value into the field whenever it changes — but not
    // while the user is typing, so an in-progress edit is never clobbered.
    useEffect(() => {
      if (!focused) {
        setInputValue(formatRating(props.value));
      }
    }, [props.value, focused]);

    const showTextField = !props.disabled && (editing || !props.clickToRate);

    function commit(raw: string) {
      if (!props.onSetRating) {
        return;
      }
      const rating = parseRating(raw);
      // undefined => unparseable; leave it, the blur resync will restore it.
      if (rating !== undefined && rating !== props.value) {
        props.onSetRating(rating);
      }
    }

    function handleChange(e: React.ChangeEvent<HTMLInputElement>) {
      const raw = e.target.value;
      if (raw !== "" && !PARTIAL_DECIMAL.test(raw)) {
        return;
      }
      setInputValue(raw);
      // Forms (clickToRate=false) commit live; the click-to-rate detail view
      // stages the edit and commits once, on blur, to keep it a single change.
      if (!props.clickToRate) {
        commit(raw);
      }
    }

    function handleFocus() {
      setFocused(true);
    }

    function handleBlur() {
      setFocused(false);
      if (editing) {
        setEditing(false);
      }
      commit(inputValue);
    }

    function handleKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
      if (e.key === "Enter") {
        commit(inputValue);
        e.currentTarget.blur();
      } else if (e.key === "Escape") {
        // Abandon the edit and restore the committed value.
        setInputValue(formatRating(props.value));
        e.currentTarget.blur();
      }
    }

    // +/- stepper buttons replacing the native number spinner. One step is
    // 0.1 of the displayed value (1 in the stored 0-100 scale), matching the
    // old input's step="0.1". Steps off whatever is currently in the field.
    function stepBy(delta: number) {
      if (!props.onSetRating) {
        return;
      }
      const parsed = parseRating(inputValue);
      const base = typeof parsed === "number" ? parsed : 0;
      const next = Math.min(100, Math.max(0, base + delta)) || null;
      setInputValue(formatRating(next));
      if (next !== props.value) {
        props.onSetRating(next);
      }
    }

    function renderStepper(delta: number, icon: typeof faCaretUp) {
      return (
        <Button
          variant="secondary"
          className="rating-number-step"
          // keep focus on the input so repeated clicks don't blur/commit it
          onMouseDown={(e) => e.preventDefault()}
          onClick={() => stepBy(delta)}
          tabIndex={-1}
        >
          <Icon icon={icon} />
        </Button>
      );
    }

    if (!showTextField) {
      return (
        <div className="rating-number disabled">
          {props.withoutContext && <Icon icon={faStar} />}
          <span>{Number((props.value ?? 0) / 10).toFixed(1)}</span>
          {!props.disabled && props.clickToRate && (
            <Button
              variant="minimal"
              size="sm"
              className="edit-rating-button"
              onClick={() => setEditing(true)}
            >
              <Icon className="text-primary" icon={faPencil} />
            </Button>
          )}
        </div>
      );
    }

    return (
      <div className="rating-number">
        <div className="rating-number-control">
          <input
            ref={ratingRef}
            className="text-input form-control"
            name="ratingnumber"
            type="text"
            inputMode="decimal"
            autoComplete="off"
            onChange={handleChange}
            onFocus={handleFocus}
            onBlur={handleBlur}
            onKeyDown={handleKeyDown}
            value={inputValue}
            placeholder="0.0"
          />
          <div className="rating-number-steppers">
            {renderStepper(1, faCaretUp)}
            {renderStepper(-1, faCaretDown)}
          </div>
        </div>
      </div>
    );
  }
);

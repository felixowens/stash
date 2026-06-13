import React, { useCallback, useRef, useState } from "react";
import { Button, Form } from "react-bootstrap";
import { useIntl } from "react-intl";
import cx from "classnames";
import {
  closestCenter,
  DndContext,
  DragEndEvent,
  KeyboardSensor,
  PointerSensor,
  useSensor,
  useSensors,
} from "@dnd-kit/core";
import { restrictToParentElement } from "@dnd-kit/modifiers";
import {
  arrayMove,
  rectSortingStrategy,
  SortableContext,
  sortableKeyboardCoordinates,
  useSortable,
} from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import {
  faClipboard,
  faGripVertical,
  faLink,
  faStar,
  faTimes,
} from "@fortawesome/free-solid-svg-icons";
import { Icon } from "./Icon";
import { ImageDropzone } from "./ImageDropzone";
import { PatchComponent } from "src/patch";
import ImageUtils from "src/utils/image";
import { useToast } from "src/hooks/Toast";

// each entry pairs a stable synthetic id (for dnd-kit) with the image value —
// either an existing serve URL or a freshly-added base64 data URL.
interface IEntry {
  id: string;
  url: string;
}

let idSeq = 0;
const genId = () => `ici-${idSeq++}`;

interface IImageCollectionInput {
  // ordered list of image values (serve URLs and/or base64 data URLs);
  // index 0 is the primary
  value: string[];
  onChange: (value: string[]) => void;
  // reports encode-in-progress so a consumer can show a busy indicator
  onEncodingChange?: (busy: boolean) => void;
  disabled?: boolean;
  acceptSVG?: boolean;
}

const SortableTile: React.FC<{
  id: string;
  url: string;
  isPrimary: boolean;
  disabled: boolean;
  onRemove: () => void;
  onMakePrimary: () => void;
}> = ({ id, url, isPrimary, disabled, onRemove, onMakePrimary }) => {
  const intl = useIntl();
  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({ id, disabled });

  const style: React.CSSProperties = {
    transform: CSS.Transform.toString(transform),
    transition,
  };

  // keep button presses from starting a drag
  const stop = (e: React.PointerEvent | React.MouseEvent) =>
    e.stopPropagation();

  return (
    <div
      ref={setNodeRef}
      style={style}
      className={cx("ici-tile", {
        "is-primary": isPrimary,
        "is-dragging": isDragging,
      })}
      {...attributes}
      {...listeners}
    >
      <img src={url} alt="" draggable={false} />
      {isPrimary && (
        <span className="ici-tile__badge">
          {intl.formatMessage({ id: "primary" })}
        </span>
      )}
      <span className="ici-tile__grip" aria-hidden>
        <Icon icon={faGripVertical} />
      </span>
      {!disabled && (
        <div className="ici-tile__actions">
          {!isPrimary && (
            <button
              type="button"
              className="ici-tile__btn"
              title={intl.formatMessage({ id: "actions.make_primary" })}
              onPointerDown={stop}
              onClick={(e) => {
                stop(e);
                onMakePrimary();
              }}
            >
              <Icon icon={faStar} />
            </button>
          )}
          <button
            type="button"
            className="ici-tile__btn ici-tile__btn--danger"
            title={intl.formatMessage({ id: "actions.remove" })}
            onPointerDown={stop}
            onClick={(e) => {
              stop(e);
              onRemove();
            }}
          >
            <Icon icon={faTimes} />
          </button>
        </div>
      )}
    </div>
  );
};

// ImageCollectionInput is a reusable editor for an ordered image collection:
// drop/browse/paste/URL to add, drag to reorder, remove, and make-primary.
// It is value-controlled on a string[] and emits the new order via onChange.
export const ImageCollectionInput: React.FC<IImageCollectionInput> =
  PatchComponent(
    "ImageCollectionInput",
    ({
      value,
      onChange,
      onEncodingChange,
      disabled = false,
      acceptSVG = false,
    }) => {
      const intl = useIntl();
      const Toast = useToast();

      // ids kept aligned 1:1 with `value`. Same length ⇒ trust the current ids
      // (our own ops keep them in step across reorders); a length change means
      // an external edit, so pad/truncate, minting ids only where needed.
      const idsRef = useRef<string[]>([]);
      if (idsRef.current.length !== value.length) {
        idsRef.current = value.map((_, i) => idsRef.current[i] ?? genId());
      }
      const entries: IEntry[] = value.map((url, i) => ({
        id: idsRef.current[i],
        url,
      }));

      const sensors = useSensors(
        useSensor(PointerSensor, { activationConstraint: { distance: 8 } }),
        useSensor(KeyboardSensor, {
          coordinateGetter: sortableKeyboardCoordinates,
        })
      );

      const commit = useCallback(
        (next: IEntry[]) => {
          idsRef.current = next.map((e) => e.id);
          onChange(next.map((e) => e.url));
        },
        [onChange]
      );

      const append = useCallback(
        (urls: string[]) => {
          if (!urls.length) return;
          const added = urls.map((url) => ({ id: genId(), url }));
          commit([...entries, ...added]);
        },
        [commit, entries]
      );

      function onDragEnd(e: DragEndEvent) {
        const { active, over } = e;
        if (!over || active.id === over.id) return;
        const from = entries.findIndex((x) => x.id === active.id);
        const to = entries.findIndex((x) => x.id === over.id);
        if (from === -1 || to === -1) return;
        commit(arrayMove(entries, from, to));
      }

      function remove(id: string) {
        commit(entries.filter((e) => e.id !== id));
      }

      function makePrimary(id: string) {
        const from = entries.findIndex((e) => e.id === id);
        if (from <= 0) return;
        commit(arrayMove(entries, from, 0));
      }

      // paste-to-append while the editor is mounted and enabled
      ImageUtils.usePasteImage((data) => append([data]), !disabled);

      const [urlOpen, setUrlOpen] = useState(false);
      const [urlValue, setUrlValue] = useState("");
      function confirmURL() {
        const u = urlValue.trim();
        if (u) append([u]);
        setUrlValue("");
        setUrlOpen(false);
      }

      async function fromClipboard() {
        onEncodingChange?.(true);
        try {
          const data = await ImageUtils.readClipboardImage();
          if (data) append([data]);
          else
            Toast.error(intl.formatMessage({ id: "toast.clipboard_no_image" }));
        } catch (e) {
          Toast.error(e);
        } finally {
          onEncodingChange?.(false);
        }
      }

      return (
        <div
          className={cx("image-collection-input", { "is-disabled": disabled })}
        >
          <ImageDropzone
            onImagesAdded={append}
            onBusy={onEncodingChange}
            disabled={disabled}
            acceptSVG={acceptSVG}
          />

          <div className="image-collection-input__sources">
            <Button
              variant="secondary"
              size="sm"
              disabled={disabled}
              onClick={() => setUrlOpen((o) => !o)}
            >
              <Icon icon={faLink} />
              <span>{intl.formatMessage({ id: "actions.from_url" })}</span>
            </Button>
            {window.isSecureContext && (
              <Button
                variant="secondary"
                size="sm"
                disabled={disabled}
                onClick={fromClipboard}
              >
                <Icon icon={faClipboard} />
                <span>
                  {intl.formatMessage({ id: "actions.from_clipboard" })}
                </span>
              </Button>
            )}
          </div>
          {urlOpen && (
            <Form.Control
              className="image-collection-input__url text-input"
              autoFocus
              placeholder={intl.formatMessage({ id: "url" })}
              value={urlValue}
              onChange={(e: React.ChangeEvent<HTMLInputElement>) =>
                setUrlValue(e.currentTarget.value)
              }
              onBlur={confirmURL}
              onKeyDown={(e: React.KeyboardEvent<HTMLInputElement>) => {
                if (e.key === "Enter") {
                  e.preventDefault();
                  confirmURL();
                } else if (e.key === "Escape") {
                  setUrlValue("");
                  setUrlOpen(false);
                }
              }}
            />
          )}

          <DndContext
            sensors={sensors}
            collisionDetection={closestCenter}
            onDragEnd={onDragEnd}
            modifiers={[restrictToParentElement]}
          >
            <SortableContext
              items={entries.map((e) => e.id)}
              strategy={rectSortingStrategy}
            >
              <div className="image-collection-input__grid">
                {entries.map((entry, i) => (
                  <SortableTile
                    key={entry.id}
                    id={entry.id}
                    url={entry.url}
                    isPrimary={i === 0}
                    disabled={disabled}
                    onRemove={() => remove(entry.id)}
                    onMakePrimary={() => makePrimary(entry.id)}
                  />
                ))}
              </div>
            </SortableContext>
          </DndContext>
        </div>
      );
    }
  );

import React, { useCallback, useRef, useState } from "react";
import { useIntl } from "react-intl";
import cx from "classnames";
import { faImages } from "@fortawesome/free-solid-svg-icons";
import { Icon } from "./Icon";
import { PatchComponent } from "src/patch";
import ImageUtils from "src/utils/image";

interface IImageDropzone {
  // called with one or more base64 data URLs once files are dropped or picked
  onImagesAdded: (dataURLs: string[]) => void;
  // reports decode-in-progress so a consumer can show a busy indicator
  onBusy?: (busy: boolean) => void;
  multiple?: boolean;
  disabled?: boolean;
  acceptSVG?: boolean;
  className?: string;
  // optional custom inner content; falls back to the default icon + hint
  children?: React.ReactNode;
}

function acceptExtensions(acceptSVG: boolean = false) {
  return `image/*${acceptSVG ? ",.svg" : ""}`;
}

// ImageDropzone is a generic image-upload primitive: a click/keyboard/drag-drop
// target that converts the chosen files to base64 data URLs and hands them back.
// It owns no collection state — compose it with whatever manages the result.
export const ImageDropzone: React.FC<IImageDropzone> = PatchComponent(
  "ImageDropzone",
  ({
    onImagesAdded,
    onBusy,
    multiple = true,
    disabled = false,
    acceptSVG = false,
    className,
    children,
  }) => {
    const intl = useIntl();
    const inputRef = useRef<HTMLInputElement>(null);
    const [dragging, setDragging] = useState(false);
    // dragenter/dragleave fire per descendant, so depth-count to avoid flicker
    const dragDepth = useRef(0);

    const handleFiles = useCallback(
      async (files: FileList | File[] | null) => {
        if (disabled || !files || !files.length) return;
        onBusy?.(true);
        try {
          const urls = await ImageUtils.filesToDataURLs(files);
          if (urls.length) onImagesAdded(multiple ? urls : urls.slice(0, 1));
        } finally {
          onBusy?.(false);
        }
      },
      [disabled, multiple, onBusy, onImagesAdded]
    );

    function browse() {
      if (!disabled) inputRef.current?.click();
    }

    function onInputChange(e: React.ChangeEvent<HTMLInputElement>) {
      handleFiles(e.currentTarget.files);
      // reset so picking the same file again still fires change
      e.currentTarget.value = "";
    }

    function onDrop(e: React.DragEvent) {
      e.preventDefault();
      dragDepth.current = 0;
      setDragging(false);
      handleFiles(e.dataTransfer.files);
    }

    function onDragEnter(e: React.DragEvent) {
      e.preventDefault();
      if (disabled) return;
      dragDepth.current += 1;
      setDragging(true);
    }

    function onDragOver(e: React.DragEvent) {
      // must preventDefault to mark this element as a valid drop target
      e.preventDefault();
    }

    function onDragLeave(e: React.DragEvent) {
      e.preventDefault();
      dragDepth.current = Math.max(0, dragDepth.current - 1);
      if (dragDepth.current === 0) setDragging(false);
    }

    function onKeyDown(e: React.KeyboardEvent) {
      if (e.key === "Enter" || e.key === " ") {
        e.preventDefault();
        browse();
      }
    }

    return (
      <div
        className={cx("image-dropzone", className, {
          "is-dragging": dragging,
          "is-disabled": disabled,
        })}
        onClick={browse}
        onDrop={onDrop}
        onDragEnter={onDragEnter}
        onDragOver={onDragOver}
        onDragLeave={onDragLeave}
        onKeyDown={onKeyDown}
        role="button"
        tabIndex={disabled ? -1 : 0}
      >
        <input
          ref={inputRef}
          type="file"
          className="image-dropzone__input"
          accept={acceptExtensions(acceptSVG)}
          multiple={multiple}
          onChange={onInputChange}
          hidden
        />
        {children ?? (
          <div className="image-dropzone__prompt">
            <Icon icon={faImages} />
            <span>
              {intl.formatMessage({ id: "actions.drop_images_hint" })}
            </span>
          </div>
        )}
      </div>
    );
  }
);

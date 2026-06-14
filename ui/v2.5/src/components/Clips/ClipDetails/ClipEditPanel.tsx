import React, { useState } from "react";
import { Button, Form } from "react-bootstrap";
import { FormattedMessage, useIntl } from "react-intl";
import * as GQL from "src/core/generated-graphql";
import { useClipUpdate } from "src/core/StashService";
import { useToast } from "src/hooks/Toast";
import { RatingSystem } from "../../Shared/Rating/RatingSystem";
import { PerformerSelect, StudioSelect, TagSelect } from "../../Shared/Select";

interface IClipEditPanelProps {
  clip: GQL.ClipDataFragment;
  onClose?: () => void;
}

export const ClipEditPanel: React.FC<IClipEditPanelProps> = ({
  clip,
  onClose,
}) => {
  const intl = useIntl();
  const Toast = useToast();
  const [updateClip] = useClipUpdate();

  const [title, setTitle] = useState(clip.title ?? "");
  const [details, setDetails] = useState(clip.details ?? "");
  const [date, setDate] = useState(clip.date ?? "");
  const [rating100, setRating100] = useState<number | undefined>(
    clip.rating100 ?? undefined
  );
  const [organized, setOrganized] = useState(clip.organized);
  const [studioId, setStudioId] = useState<string | undefined>(clip.studio?.id);
  const [performerIds, setPerformerIds] = useState<string[]>(
    clip.performers.map((p) => p.id)
  );
  const [tagIds, setTagIds] = useState<string[]>(clip.tags.map((t) => t.id));

  const [isUpdating, setIsUpdating] = useState(false);

  async function onSave() {
    setIsUpdating(true);
    try {
      await updateClip({
        variables: {
          input: {
            id: clip.id,
            title,
            details,
            date: date || null,
            rating100: rating100 ?? null,
            organized,
            studio_id: studioId ?? null,
            performer_ids: performerIds,
            tag_ids: tagIds,
          },
        },
      });
      Toast.success(
        intl.formatMessage(
          { id: "toast.updated_entity" },
          { entity: intl.formatMessage({ id: "clip" }).toLocaleLowerCase() }
        )
      );
      onClose?.();
    } catch (e) {
      Toast.error(e);
    }
    setIsUpdating(false);
  }

  return (
    <div className="clip-edit-panel">
      <Form.Group>
        <Form.Label>
          <FormattedMessage id="title" />
        </Form.Label>
        <Form.Control
          className="text-input"
          value={title}
          onChange={(e) => setTitle(e.currentTarget.value)}
        />
      </Form.Group>

      <Form.Group>
        <Form.Label>
          <FormattedMessage id="date" />
        </Form.Label>
        <Form.Control
          className="text-input"
          placeholder="YYYY-MM-DD"
          value={date}
          onChange={(e) => setDate(e.currentTarget.value)}
        />
      </Form.Group>

      <Form.Group>
        <Form.Label>
          <FormattedMessage id="rating" />
        </Form.Label>
        <RatingSystem
          value={rating100}
          onSetRating={(v) => setRating100(v ?? undefined)}
          disabled={isUpdating}
        />
      </Form.Group>

      <Form.Group>
        <Form.Label>
          <FormattedMessage id="studio" />
        </Form.Label>
        <StudioSelect
          ids={studioId ? [studioId] : []}
          onSelect={(items) =>
            setStudioId(items.length ? items[0].id : undefined)
          }
          isClearable
          isDisabled={isUpdating}
          menuPortalTarget={document.body}
        />
      </Form.Group>

      <Form.Group>
        <Form.Label>
          <FormattedMessage id="performers" />
        </Form.Label>
        <PerformerSelect
          isMulti
          ids={performerIds}
          onSelect={(items) => setPerformerIds(items.map((i) => i.id))}
          isDisabled={isUpdating}
          menuPortalTarget={document.body}
        />
      </Form.Group>

      <Form.Group>
        <Form.Label>
          <FormattedMessage id="tags" />
        </Form.Label>
        <TagSelect
          isMulti
          ids={tagIds}
          onSelect={(items) => setTagIds(items.map((i) => i.id))}
          isDisabled={isUpdating}
          menuPortalTarget={document.body}
        />
      </Form.Group>

      <Form.Group>
        <Form.Label>
          <FormattedMessage id="details" />
        </Form.Label>
        <Form.Control
          as="textarea"
          className="text-input"
          rows={4}
          value={details}
          onChange={(e) => setDetails(e.currentTarget.value)}
        />
      </Form.Group>

      <Form.Group controlId="organized">
        <Form.Check
          type="checkbox"
          label={intl.formatMessage({ id: "organized" })}
          checked={organized}
          onChange={(e) => setOrganized(e.currentTarget.checked)}
        />
      </Form.Group>

      <div className="buttons-container">
        <Button variant="primary" onClick={onSave} disabled={isUpdating}>
          <FormattedMessage id="actions.save" />
        </Button>
        {onClose && (
          <Button
            variant="secondary"
            className="ml-2"
            onClick={onClose}
            disabled={isUpdating}
          >
            <FormattedMessage id="actions.cancel" />
          </Button>
        )}
      </div>
    </div>
  );
};

export default ClipEditPanel;

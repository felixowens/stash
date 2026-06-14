import React, { useState } from "react";
import { Form } from "react-bootstrap";
import { FormattedMessage, useIntl } from "react-intl";
import { faScissors } from "@fortawesome/free-solid-svg-icons";
import { useClipCreate } from "src/core/StashService";
import { useToast } from "src/hooks/Toast";
import { ModalComponent } from "../../Shared/Modal";
import { RatingSystem } from "../../Shared/Rating/RatingSystem";
import { PerformerSelect, StudioSelect, TagSelect } from "../../Shared/Select";

interface IClipCreateProps {
  sceneId: string;
  start: number;
  end: number;
  defaultStudioId?: string;
  defaultPerformerIds?: string[];
  onClose: (createdId?: string) => void;
}

export const ClipCreate: React.FC<IClipCreateProps> = ({
  sceneId,
  start,
  end,
  defaultStudioId,
  defaultPerformerIds = [],
  onClose,
}) => {
  const intl = useIntl();
  const Toast = useToast();
  const [createClip] = useClipCreate();

  const [startSeconds, setStartSeconds] = useState(start);
  const [endSeconds, setEndSeconds] = useState(end);
  const [title, setTitle] = useState("");
  const [date, setDate] = useState("");
  const [rating100, setRating100] = useState<number | undefined>();
  const [studioId, setStudioId] = useState<string | undefined>(defaultStudioId);
  const [performerIds, setPerformerIds] =
    useState<string[]>(defaultPerformerIds);
  const [tagIds, setTagIds] = useState<string[]>([]);

  const [isCreating, setIsCreating] = useState(false);

  const rangeValid = endSeconds > startSeconds;

  async function onCreate() {
    if (!rangeValid) return;
    setIsCreating(true);
    try {
      const result = await createClip({
        variables: {
          input: {
            scene_id: sceneId,
            start_seconds: startSeconds,
            end_seconds: endSeconds,
            title: title || null,
            date: date || null,
            rating100: rating100 ?? null,
            studio_id: studioId ?? null,
            performer_ids: performerIds,
            tag_ids: tagIds,
          },
        },
      });
      Toast.success(
        intl.formatMessage(
          { id: "toast.created_entity" },
          { entity: intl.formatMessage({ id: "clip" }).toLocaleLowerCase() }
        )
      );
      // close the dialog; the new clip appears in the scene's clips panel
      // (via cache eviction), so the user can keep creating from the player.
      onClose(result.data?.clipCreate?.id);
    } catch (e) {
      Toast.error(e);
      setIsCreating(false);
    }
  }

  return (
    <ModalComponent
      show
      icon={faScissors}
      header={intl.formatMessage({ id: "actions.create_clip" })}
      accept={{
        onClick: onCreate,
        text: intl.formatMessage({ id: "actions.create" }),
      }}
      disabled={isCreating || !rangeValid}
      cancel={{
        onClick: () => onClose(),
        text: intl.formatMessage({ id: "actions.cancel" }),
        variant: "secondary",
      }}
      isRunning={isCreating}
    >
      <Form>
        <Form.Group>
          <Form.Label>
            <FormattedMessage id="start_seconds" /> /{" "}
            <FormattedMessage id="duration" />
          </Form.Label>
          <div className="d-flex">
            <Form.Control
              className="text-input mr-2"
              type="number"
              step="0.1"
              value={startSeconds}
              onChange={(e) =>
                setStartSeconds(parseFloat(e.currentTarget.value) || 0)
              }
            />
            <Form.Control
              className="text-input"
              type="number"
              step="0.1"
              value={endSeconds}
              onChange={(e) =>
                setEndSeconds(parseFloat(e.currentTarget.value) || 0)
              }
            />
          </div>
          {!rangeValid && (
            <Form.Text className="text-danger">
              End must be greater than start.
            </Form.Text>
          )}
        </Form.Group>

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
            <FormattedMessage id="rating" />
          </Form.Label>
          <RatingSystem
            value={rating100}
            onSetRating={(v) => setRating100(v ?? undefined)}
            disabled={isCreating}
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
            isDisabled={isCreating}
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
            isDisabled={isCreating}
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
            isDisabled={isCreating}
            menuPortalTarget={document.body}
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
      </Form>
    </ModalComponent>
  );
};

export default ClipCreate;

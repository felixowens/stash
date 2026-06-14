import React, { useEffect, useMemo, useState } from "react";
import { Form } from "react-bootstrap";
import { useIntl } from "react-intl";
import { faPencilAlt } from "@fortawesome/free-solid-svg-icons";
import * as GQL from "src/core/generated-graphql";
import { useBulkClipUpdate } from "src/core/StashService";
import { StudioSelect } from "../Shared/Select";
import { ModalComponent } from "../Shared/Modal";
import { MultiSet } from "../Shared/MultiSet";
import { useToast } from "src/hooks/Toast";
import { RatingSystem } from "../Shared/Rating/RatingSystem";
import {
  getAggregateInputValue,
  getAggregatePerformerIds,
  getAggregateStateObject,
  getAggregateTagIds,
  getAggregateStudioId,
} from "src/utils/bulkUpdate";
import { IndeterminateCheckbox } from "../Shared/IndeterminateCheckbox";
import { BulkUpdateFormGroup } from "../Shared/BulkUpdate";

interface IListOperationProps {
  selected: GQL.SlimClipDataFragment[];
  onClose: (applied: boolean) => void;
}

const clipFields = ["rating100", "organized"];

export const EditClipsDialog: React.FC<IListOperationProps> = (
  props: IListOperationProps
) => {
  const intl = useIntl();
  const Toast = useToast();

  const [updateInput, setUpdateInput] = useState<GQL.BulkClipUpdateInput>({
    ids: props.selected.map((clip) => clip.id),
  });

  const [performerIds, setPerformerIds] = useState<GQL.BulkUpdateIds>({
    mode: GQL.BulkUpdateIdMode.Add,
  });
  const [tagIds, setTagIds] = useState<GQL.BulkUpdateIds>({
    mode: GQL.BulkUpdateIdMode.Add,
  });

  const [updateClips] = useBulkClipUpdate();

  const [isUpdating, setIsUpdating] = useState(false);

  const aggregateState = useMemo(() => {
    const updateState: Partial<GQL.BulkClipUpdateInput> = {};
    const state = props.selected;
    updateState.studio_id = getAggregateStudioId(props.selected);
    const updateTagIds = getAggregateTagIds(props.selected);
    const updatePerformerIds = getAggregatePerformerIds(props.selected);
    let first = true;

    state.forEach((clip: GQL.SlimClipDataFragment) => {
      getAggregateStateObject(updateState, clip, clipFields, first);
      first = false;
    });

    return {
      state: updateState,
      tagIds: updateTagIds,
      performerIds: updatePerformerIds,
    };
  }, [props.selected]);

  useEffect(() => {
    setUpdateInput((current) => ({ ...current, ...aggregateState.state }));
  }, [aggregateState]);

  function setUpdateField(input: Partial<GQL.BulkClipUpdateInput>) {
    setUpdateInput((current) => ({ ...current, ...input }));
  }

  function getClipInput(): GQL.BulkClipUpdateInput {
    const clipInput: GQL.BulkClipUpdateInput = {
      ...updateInput,
      tag_ids: tagIds,
      performer_ids: performerIds,
    };

    // we don't have unset functionality for the rating star control
    // so need to determine if we are setting a rating or not
    clipInput.rating100 = getAggregateInputValue(
      updateInput.rating100,
      aggregateState.state.rating100
    );

    return clipInput;
  }

  async function onSave() {
    setIsUpdating(true);
    try {
      await updateClips({ variables: { input: getClipInput() } });
      Toast.success(
        intl.formatMessage(
          { id: "toast.updated_entity" },
          {
            entity: intl.formatMessage({ id: "clips" }).toLocaleLowerCase(),
          }
        )
      );
      props.onClose(true);
    } catch (e) {
      Toast.error(e);
    }
    setIsUpdating(false);
  }

  return (
    <ModalComponent
      show
      icon={faPencilAlt}
      header={intl.formatMessage(
        { id: "dialogs.edit_entity_count_title" },
        {
          count: props?.selected?.length ?? 1,
          singularEntity: intl.formatMessage({ id: "clip" }),
          pluralEntity: intl.formatMessage({ id: "clips" }),
        }
      )}
      accept={{
        onClick: onSave,
        text: intl.formatMessage({ id: "actions.apply" }),
      }}
      disabled={isUpdating}
      cancel={{
        onClick: () => props.onClose(false),
        text: intl.formatMessage({ id: "actions.cancel" }),
        variant: "secondary",
      }}
      isRunning={isUpdating}
    >
      <Form>
        <BulkUpdateFormGroup name="rating">
          <RatingSystem
            value={updateInput.rating100}
            onSetRating={(value) =>
              setUpdateField({ rating100: value ?? undefined })
            }
            disabled={isUpdating}
          />
        </BulkUpdateFormGroup>

        <BulkUpdateFormGroup name="studio">
          <StudioSelect
            onSelect={(items) =>
              setUpdateField({
                studio_id: items.length > 0 ? items[0]?.id : undefined,
              })
            }
            ids={updateInput.studio_id ? [updateInput.studio_id] : []}
            isDisabled={isUpdating}
            menuPortalTarget={document.body}
          />
        </BulkUpdateFormGroup>

        <BulkUpdateFormGroup name="performers" inline={false}>
          <MultiSet
            type={"performers"}
            disabled={isUpdating}
            onUpdate={(itemIDs) => {
              setPerformerIds((c) => ({ ...c, ids: itemIDs }));
            }}
            onSetMode={(newMode) => {
              setPerformerIds((c) => ({ ...c, mode: newMode }));
            }}
            ids={performerIds.ids ?? []}
            existingIds={aggregateState.performerIds}
            mode={performerIds.mode}
            menuPortalTarget={document.body}
          />
        </BulkUpdateFormGroup>

        <BulkUpdateFormGroup name="tags" inline={false}>
          <MultiSet
            type={"tags"}
            disabled={isUpdating}
            onUpdate={(itemIDs) => {
              setTagIds((c) => ({ ...c, ids: itemIDs }));
            }}
            onSetMode={(newMode) => {
              setTagIds((c) => ({ ...c, mode: newMode }));
            }}
            ids={tagIds.ids ?? []}
            existingIds={aggregateState.tagIds}
            mode={tagIds.mode}
            menuPortalTarget={document.body}
          />
        </BulkUpdateFormGroup>

        <Form.Group controlId="organized">
          <IndeterminateCheckbox
            label={intl.formatMessage({ id: "organized" })}
            setChecked={(checked) => setUpdateField({ organized: checked })}
            checked={updateInput.organized ?? undefined}
          />
        </Form.Group>
      </Form>
    </ModalComponent>
  );
};

export default EditClipsDialog;

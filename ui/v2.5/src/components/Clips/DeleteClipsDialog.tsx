import React, { useState } from "react";
import { useIntl } from "react-intl";
import { faTrashAlt } from "@fortawesome/free-solid-svg-icons";
import * as GQL from "src/core/generated-graphql";
import { useClipsDestroy } from "src/core/StashService";
import { ModalComponent } from "src/components/Shared/Modal";
import { useToast } from "src/hooks/Toast";

interface IDeleteClipsDialogProps {
  selected: GQL.SlimClipDataFragment[];
  onClose: (confirmed: boolean) => void;
}

export const DeleteClipsDialog: React.FC<IDeleteClipsDialogProps> = (
  props: IDeleteClipsDialogProps
) => {
  const intl = useIntl();
  const singularEntity = intl.formatMessage({ id: "clip" });
  const pluralEntity = intl.formatMessage({ id: "clips" });

  const header = intl.formatMessage(
    { id: "dialogs.delete_object_title" },
    { count: props.selected.length, singularEntity, pluralEntity }
  );
  const toastMessage = intl.formatMessage(
    { id: "toast.delete_past_tense" },
    { count: props.selected.length, singularEntity, pluralEntity }
  );
  const message = intl.formatMessage(
    { id: "dialogs.delete_object_desc" },
    { count: props.selected.length, singularEntity, pluralEntity }
  );

  const Toast = useToast();
  const [deleteClips] = useClipsDestroy({
    ids: props.selected.map((clip) => clip.id),
  });

  const [isDeleting, setIsDeleting] = useState(false);

  async function onDelete() {
    setIsDeleting(true);
    try {
      await deleteClips();
      Toast.success(toastMessage);
      // onClose unmounts this dialog, so don't touch state afterwards;
      // only reset isDeleting on failure, where the dialog stays open to retry.
      props.onClose(true);
    } catch (e) {
      Toast.error(e);
      setIsDeleting(false);
    }
  }

  return (
    <ModalComponent
      show
      icon={faTrashAlt}
      header={header}
      accept={{
        variant: "danger",
        onClick: onDelete,
        text: intl.formatMessage({ id: "actions.delete" }),
      }}
      cancel={{
        onClick: () => props.onClose(false),
        text: intl.formatMessage({ id: "actions.cancel" }),
        variant: "secondary",
      }}
      isRunning={isDeleting}
    >
      <p>{message}</p>
    </ModalComponent>
  );
};

export default DeleteClipsDialog;

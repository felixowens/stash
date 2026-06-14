import React from "react";
import { Link } from "react-router-dom";
import { useIntl } from "react-intl";
import * as GQL from "src/core/generated-graphql";
import NavUtils from "src/utils/navigation";
import TextUtils from "src/utils/text";
import { clipTitle } from "src/core/clips";
import { RatingSystem } from "../Shared/Rating/RatingSystem";
import { useClipUpdate } from "src/core/StashService";
import { IColumn, ListTable } from "../List/ListTable";
import { useTableColumns } from "src/hooks/useTableColumns";

interface IClipListTableProps {
  clips: GQL.SlimClipDataFragment[];
  selectedIds: Set<string>;
  onSelectChange: (id: string, selected: boolean, shiftKey: boolean) => void;
}

const TABLE_NAME = "clips";

export const ClipListTable: React.FC<IClipListTableProps> = (
  props: IClipListTableProps
) => {
  const intl = useIntl();

  const [updateClip] = useClipUpdate();

  function setRating(v: number | null, clipId: string) {
    if (clipId) {
      updateClip({
        variables: {
          input: {
            id: clipId,
            rating100: v,
          },
        },
      });
    }
  }

  const ScreenshotCell = (clip: GQL.SlimClipDataFragment) => (
    <Link to={`/clips/${clip.id}`}>
      <img
        loading="lazy"
        alt={clipTitle(clip)}
        className="image-thumbnail"
        src={clip.paths.screenshot ?? undefined}
      />
    </Link>
  );

  const TitleCell = (clip: GQL.SlimClipDataFragment) => (
    <Link to={`/clips/${clip.id}`}>
      <span className="ellips-data">{clipTitle(clip)}</span>
    </Link>
  );

  const SceneCell = (clip: GQL.SlimClipDataFragment) =>
    clip.scene ? (
      <Link to={`/scenes/${clip.scene.id}`}>
        <span className="ellips-data">
          {clip.scene.title || `Scene ${clip.scene.id}`}
        </span>
      </Link>
    ) : null;

  const DurationCell = (clip: GQL.SlimClipDataFragment) => (
    <>{TextUtils.secondsToTimestamp(clip.end_seconds - clip.start_seconds)}</>
  );

  const RatingCell = (clip: GQL.SlimClipDataFragment) => (
    <RatingSystem
      value={clip.rating100}
      onSetRating={(value) => setRating(value, clip.id)}
      clickToRate
    />
  );

  const OCounterCell = (clip: GQL.SlimClipDataFragment) => (
    <>{clip.o_counter ?? 0}</>
  );

  const PlayCountCell = (clip: GQL.SlimClipDataFragment) => (
    <>{clip.play_count ?? 0}</>
  );

  const DateCell = (clip: GQL.SlimClipDataFragment) => <>{clip.date}</>;

  const TagCell = (clip: GQL.SlimClipDataFragment) => (
    <ul className="comma-list overflowable">
      {clip.tags.map((tag) => (
        <li key={tag.id}>
          <Link to={NavUtils.makeTagScenesUrl(tag)}>
            <span>{tag.name}</span>
          </Link>
        </li>
      ))}
    </ul>
  );

  const PerformersCell = (clip: GQL.SlimClipDataFragment) => (
    <ul className="comma-list overflowable">
      {clip.performers.map((performer) => (
        <li key={performer.id}>
          <Link to={NavUtils.makePerformerScenesUrl(performer)}>
            <span>{performer.name}</span>
          </Link>
        </li>
      ))}
    </ul>
  );

  const StudioCell = (clip: GQL.SlimClipDataFragment) =>
    clip.studio ? (
      <Link
        to={NavUtils.makeStudioScenesUrl(clip.studio)}
        title={clip.studio.name}
      >
        <span className="ellips-data">{clip.studio.name}</span>
      </Link>
    ) : null;

  interface IColumnSpec {
    value: string;
    label: string;
    defaultShow?: boolean;
    mandatory?: boolean;
    render?: (clip: GQL.SlimClipDataFragment, index: number) => React.ReactNode;
  }

  const allColumns: IColumnSpec[] = [
    {
      value: "screenshot",
      label: intl.formatMessage({ id: "cover_image" }),
      defaultShow: true,
      render: ScreenshotCell,
    },
    {
      value: "title",
      label: intl.formatMessage({ id: "title" }),
      defaultShow: true,
      mandatory: true,
      render: TitleCell,
    },
    {
      value: "scene",
      label: intl.formatMessage({ id: "scene" }),
      defaultShow: true,
      render: SceneCell,
    },
    {
      value: "duration",
      label: intl.formatMessage({ id: "duration" }),
      defaultShow: true,
      render: DurationCell,
    },
    {
      value: "rating",
      label: intl.formatMessage({ id: "rating" }),
      defaultShow: true,
      render: RatingCell,
    },
    {
      value: "o_counter",
      label: intl.formatMessage({ id: "o_count" }),
      defaultShow: true,
      render: OCounterCell,
    },
    {
      value: "play_count",
      label: intl.formatMessage({ id: "play_count" }),
      render: PlayCountCell,
    },
    {
      value: "date",
      label: intl.formatMessage({ id: "date" }),
      defaultShow: true,
      render: DateCell,
    },
    {
      value: "tags",
      label: intl.formatMessage({ id: "tags" }),
      render: TagCell,
    },
    {
      value: "performers",
      label: intl.formatMessage({ id: "performers" }),
      defaultShow: true,
      render: PerformersCell,
    },
    {
      value: "studio",
      label: intl.formatMessage({ id: "studio" }),
      render: StudioCell,
    },
  ];

  const defaultColumns = allColumns
    .filter((col) => col.defaultShow)
    .map((col) => col.value);

  const { selectedColumns, saveColumns } = useTableColumns(
    TABLE_NAME,
    defaultColumns
  );

  const columnRenderFuncs: Record<
    string,
    (clip: GQL.SlimClipDataFragment, index: number) => React.ReactNode
  > = {};
  allColumns.forEach((col) => {
    if (col.render) {
      columnRenderFuncs[col.value] = col.render;
    }
  });

  function renderCell(
    column: IColumn,
    clip: GQL.SlimClipDataFragment,
    index: number
  ) {
    const render = columnRenderFuncs[column.value];

    if (render) return render(clip, index);
  }

  return (
    <ListTable
      className="clip-table"
      items={props.clips}
      allColumns={allColumns}
      columns={selectedColumns}
      setColumns={(c) => saveColumns(c)}
      selectedIds={props.selectedIds}
      onSelectChange={props.onSelectChange}
      renderCell={renderCell}
    />
  );
};

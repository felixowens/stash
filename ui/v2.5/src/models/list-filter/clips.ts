import {
  createDateCriterionOption,
  createDurationCriterionOption,
  createMandatoryNumberCriterionOption,
  createMandatoryTimestampCriterionOption,
  createStringCriterionOption,
} from "./criteria/criterion";
import { OrganizedCriterionOption } from "./criteria/organized";
import { PerformersCriterionOption } from "./criteria/performers";
import { RatingCriterionOption } from "./criteria/rating";
import { ScenesCriterionOption } from "./criteria/scenes";
import { StudiosCriterionOption } from "./criteria/studios";
import { TagsCriterionOption } from "./criteria/tags";
import { ListFilterOptions } from "./filter-options";
import { DisplayMode } from "./types";

const defaultSortBy = "date";

const sortByOptions = ["date", "title", "rating", "duration", "start_seconds"]
  .map(ListFilterOptions.createSortBy)
  .concat([
    {
      messageID: "o_count",
      value: "o_counter",
      sfwMessageID: "o_count_sfw",
    },
    {
      messageID: "play_count",
      value: "play_count",
    },
  ]);

const displayModeOptions = [DisplayMode.Grid, DisplayMode.List];

export const DurationCriterionOption =
  createDurationCriterionOption("duration");

const criterionOptions = [
  createStringCriterionOption("title"),
  createStringCriterionOption("details"),
  RatingCriterionOption,
  OrganizedCriterionOption,
  DurationCriterionOption,
  createMandatoryNumberCriterionOption("o_counter", "o_count", {
    sfwMessageID: "o_count_sfw",
  }),
  createMandatoryNumberCriterionOption("play_count"),
  TagsCriterionOption,
  createMandatoryNumberCriterionOption("tag_count"),
  PerformersCriterionOption,
  createMandatoryNumberCriterionOption("performer_count"),
  ScenesCriterionOption,
  StudiosCriterionOption,
  createDateCriterionOption("date"),
  createMandatoryTimestampCriterionOption("created_at"),
  createMandatoryTimestampCriterionOption("updated_at"),
];

export const ClipListFilterOptions = new ListFilterOptions(
  defaultSortBy,
  sortByOptions,
  displayModeOptions,
  criterionOptions
);

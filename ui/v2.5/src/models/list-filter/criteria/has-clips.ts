import {
  StringBooleanCriterion,
  StringBooleanCriterionOption,
} from "./criterion";

export const HasClipsCriterionOption = new StringBooleanCriterionOption(
  "hasClips",
  "has_clips",
  () => new HasClipsCriterion()
);

export class HasClipsCriterion extends StringBooleanCriterion {
  constructor() {
    super(HasClipsCriterionOption);
  }
}

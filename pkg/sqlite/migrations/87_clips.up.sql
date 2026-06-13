PRAGMA foreign_keys=OFF;

-- Clips: first-class, virtual viewable assets carved out of a source scene.
-- A clip is a [start_seconds, end_seconds] range of a scene with its own
-- rating, tags, performers, studio, date and engagement history. Playback is
-- non-destructive: the source scene is streamed on the fly with -ss/-t, so a
-- clip cascade-deletes when its source scene is removed.
CREATE TABLE `clips` (
  `id` integer not null primary key autoincrement,
  `title` varchar(255),
  `details` text,
  `date` date,
  `date_precision` integer,
  `rating` tinyint,
  `organized` boolean not null default '0',
  `studio_id` integer,
  `scene_id` integer not null,
  `start_seconds` float not null,
  `end_seconds` float not null,
  `resume_time` float not null default 0,
  `play_duration` float not null default 0,
  `created_at` datetime not null,
  `updated_at` datetime not null,
  foreign key(`studio_id`) references `studios`(`id`) on delete SET NULL,
  foreign key(`scene_id`) references `scenes`(`id`) on delete CASCADE
);

CREATE TABLE `clips_tags` (
  `clip_id` integer not null,
  `tag_id` integer not null,
  foreign key(`clip_id`) references `clips`(`id`) on delete CASCADE,
  foreign key(`tag_id`) references `tags`(`id`) on delete CASCADE,
  PRIMARY KEY(`clip_id`, `tag_id`)
);

CREATE TABLE `performers_clips` (
  `performer_id` integer not null,
  `clip_id` integer not null,
  foreign key(`performer_id`) references `performers`(`id`) on delete CASCADE,
  foreign key(`clip_id`) references `clips`(`id`) on delete CASCADE,
  PRIMARY KEY(`clip_id`, `performer_id`)
);

CREATE TABLE `clips_view_dates` (
  `clip_id` integer,
  `view_date` datetime not null,
  foreign key(`clip_id`) references `clips`(`id`) on delete CASCADE
);

CREATE TABLE `clips_o_dates` (
  `clip_id` integer,
  `o_date` datetime not null,
  foreign key(`clip_id`) references `clips`(`id`) on delete CASCADE
);

CREATE INDEX `index_clips_on_scene_id` on `clips` (`scene_id`);
CREATE INDEX `index_clips_on_studio_id` on `clips` (`studio_id`);
CREATE INDEX `index_clips_tags_on_tag_id` on `clips_tags` (`tag_id`);
CREATE INDEX `index_clips_tags_on_clip_id` on `clips_tags` (`clip_id`);
CREATE INDEX `index_performers_clips_on_clip_id` on `performers_clips` (`clip_id`);
CREATE INDEX `index_performers_clips_on_performer_id` on `performers_clips` (`performer_id`);
CREATE INDEX `index_clips_view_dates_on_clip_id` on `clips_view_dates` (`clip_id`);
CREATE INDEX `index_clips_o_dates_on_clip_id` on `clips_o_dates` (`clip_id`);

PRAGMA foreign_keys=ON;

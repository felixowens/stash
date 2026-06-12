PRAGMA foreign_keys=OFF;

-- Performers gain an ordered collection of images (multiple headline
-- photos). Mirrors the performer_urls ordered-join pattern
-- (migration 62). position 0 is the primary image; performers.image_blob is
-- kept as a denormalised mirror of position 0 so every existing single-image
-- read path keeps working unchanged.
CREATE TABLE `performer_images` (
  `performer_id` integer NOT NULL,
  `position` integer NOT NULL,
  `image_blob` varchar(255) NOT NULL REFERENCES `blobs`(`checksum`),
  foreign key(`performer_id`) references `performers`(`id`) on delete CASCADE,
  PRIMARY KEY(`performer_id`, `position`, `image_blob`)
);

CREATE INDEX `performers_images_image_blob` on `performer_images` (`image_blob`);

-- Backfill: every performer with an existing image becomes its position-0 image.
INSERT INTO `performer_images`
  (
    `performer_id`,
    `position`,
    `image_blob`
  )
  SELECT
    `id`,
    '0',
    `image_blob`
  FROM `performers`
  WHERE `performers`.`image_blob` IS NOT NULL AND `performers`.`image_blob` != '';

PRAGMA foreign_keys=ON;

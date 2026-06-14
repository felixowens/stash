import React from "react";
import cx from "classnames";

interface IAvatarPerformer {
  id: string;
  name: string;
  image_path?: string | null;
}

interface IPerformerAvatarStackProps {
  performers: IAvatarPerformer[];
  /** Maximum number of avatars to show before collapsing into a "+N" chip. */
  max?: number;
  className?: string;
}

// Overlapping circular performer avatars with a "+N" overflow chip. Display-only.
export const PerformerAvatarStack: React.FC<IPerformerAvatarStackProps> = ({
  performers,
  max = 3,
  className,
}) => {
  if (!performers || performers.length === 0) return null;

  const shown = performers.slice(0, max);
  const overflow = performers.slice(max);

  return (
    <div className={cx("performer-avatar-stack", className)}>
      {shown.map((p) => (
        <img
          key={p.id}
          className="performer-avatar-stack__avatar"
          src={p.image_path ?? undefined}
          alt={p.name}
          title={p.name}
          loading="lazy"
        />
      ))}
      {overflow.length > 0 && (
        <span
          className="performer-avatar-stack__overflow"
          title={overflow.map((p) => p.name).join(", ")}
        >
          +{overflow.length}
        </span>
      )}
    </div>
  );
};

import "@/reference-entry.css";
/** Visual mark adapted from the user's supplied Figma Make source. */
export default function ReferenceBrand({
  compact = false,
}: {
  compact?: boolean;
}) {
  return (
    <span className={`lios-reference-brand${compact ? " is-compact" : ""}`}>
      <span className="lios-reference-mark" aria-hidden="true">
        Li
      </span>
      {!compact && (
        <>
          <span className="font-display">LiOS</span>
          <small className="font-terminal">v1.0</small>
        </>
      )}
    </span>
  );
}

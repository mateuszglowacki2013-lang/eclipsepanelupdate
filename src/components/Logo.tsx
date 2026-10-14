export function Logo({ size = 40 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 48 48" fill="none" aria-label="Eclipse Launcher">
      {/* ring, thicker on the upper-right */}
      <path d="M24 6a18 18 0 1 0 0.01 0" stroke="#F4EFE6" strokeWidth="2.5" fill="none" />
      <path d="M38.6 12.2A18 18 0 0 1 42 24" stroke="#F4EFE6" strokeWidth="4.5" strokeLinecap="round" fill="none" />
      {/* four-point sparkle on the upper-right edge */}
      <g className="sparkle-pulse">
        <path
          d="M40 4l1.8 4.2L46 10l-4.2 1.8L40 16l-1.8-4.2L34 10l4.2-1.8z"
          fill="#A98BFF"
        />
      </g>
    </svg>
  );
}

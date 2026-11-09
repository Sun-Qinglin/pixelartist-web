export function Logo({ size = 28 }: { size?: number }) {
  // 8×8 像素字母 P
  const rows = [
    ".#####..",
    ".#...#..",
    ".#...#..",
    ".#####..",
    ".#......",
    ".#......",
    ".#......",
    "........",
  ];
  const cells: { x: number; y: number }[] = [];
  rows.forEach((row, y) => {
    row.split("").forEach((ch, x) => {
      if (ch === "#") cells.push({ x, y });
    });
  });
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 8 8"
      aria-hidden="true"
      shapeRendering="crispEdges"
    >
      {cells.map((c) => (
        <rect
          key={`${c.x}-${c.y}`}
          x={c.x}
          y={c.y}
          width="1"
          height="1"
          fill={c.x === 1 || c.y === 3 ? "#ffb877" : "#f2913d"}
        />
      ))}
    </svg>
  );
}

const PALETTE: Record<string, string> = {
  s: "#22314b", // 天空
  y: "#f2c14e", // 太阳
  w: "#e9e4da", // 云
  m: "#46587a", // 山
  e: "#2f8f5b", // 树冠
  t: "#8a5a2b", // 树干
  g: "#5ee0a0", // 草地
  d: "#6b4a2f", // 泥土
};

// 16 × 12 像素小风景
const GRID = [
  "ssssssssssssssss",
  "ssssssssssssssss",
  "ssssssssssyyysss",
  "ssssssssssyyysss",
  "ssswwwwwssssssss",
  "ssssssssssssssss",
  "ssssmmssssssssss",
  "sssmmmmmsssseess",
  "ssmmmmmmmssseess",
  "ssssssssssssttss",
  "gggggggggggggggg",
  "dddddddddddddddd",
];

export function PixelSprite() {
  const rects: { x: number; y: number; fill: string }[] = [];
  GRID.forEach((row, y) => {
    row.split("").forEach((ch, x) => {
      const fill = PALETTE[ch];
      if (fill) rects.push({ x, y, fill });
    });
  });
  return (
    <svg
      viewBox="0 0 16 12"
      className="pixel-sprite"
      shapeRendering="crispEdges"
      aria-label="像素画示例:一颗树和太阳"
      role="img"
    >
      {rects.map((r) => (
        <rect key={`${r.x}-${r.y}`} x={r.x} y={r.y} width="1" height="1" fill={r.fill} />
      ))}
    </svg>
  );
}

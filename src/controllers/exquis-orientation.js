// Physical clockwise orientation, measured from encoders at the top.
// Select lattice orientations without rotating the canvas. Quarter turns on a
// hex lattice alternate 60 and 120 degrees; opposite orientations remain opposite.
export function exquisOrientation(value) {
  if (value == null || value === "") return 90;
  const angle = Number(value);
  return [0, 90, 180, 270].includes(angle) ? angle : 90;
}

export function rotateExquisCoords({ x, y }, orientation = 90) {
  const turns = { 0: 5, 90: 0, 180: 2, 270: 3 }[exquisOrientation(orientation)];
  for (let i = 0; i < turns; i++) [x, y] = [-y, x + y];
  return { x: x || 0, y: y || 0 };
}

export function exquisLayoutFlags(orientation = 90) {
  const [flipX, flipY, flipXY] = {
    0: [0, 0, 0],
    90: [1, 0, 1],
    180: [1, 1, 0],
    270: [0, 1, 1],
  }[exquisOrientation(orientation)];
  return [
    [0x53, 1],
    [0x54, 1],
    [0x55, flipX],
    [0x56, flipY],
    [0x57, flipXY],
  ];
}

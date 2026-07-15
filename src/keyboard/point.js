// Point is the small mutable geometry primitive shared across keyboard code.
// Older keyboard utilities still use this prototype-style helper for hex-grid
// math, matrix transforms, and controller coordinate bookkeeping.

export function Point(x, y) {
  this.x = x;
  this.y = y;
}

Point.prototype.equals = function (p) {
  return this.x == p.x && this.y == p.y;
};

Point.prototype.plus = function (p) {
  var x = this.x + p.x;
  var y = this.y + p.y;
  return new Point(x, y);
};

Point.prototype.minus = function (p) {
  var x = this.x - p.x;
  var y = this.y - p.y;
  return new Point(x, y);
};

export default Point;

import Point from './point';
import { calculateRotationMatrix, applyMatrixToPoint } from './matrix';

describe('Calculating rotation matrix at origin', () => {
  it('rotation matrix for 0 degree rotation', () => {
    expect(calculateRotationMatrix(0, new Point(0, 0)))
      .toStrictEqual([1, 0, -0.0, 1, 0, 0]);
  });
  it('rotation matrix for 60 degree rotation', () => {
    expect(calculateRotationMatrix(60 * Math.PI / 180, new Point(0, 0)))
      .toStrictEqual([
        0.5000000000000001,
        0.8660254037844386,
        -0.8660254037844386,
        0.5000000000000001,
        0,
        0
      ]);
  });
  it('rotation matrix for 90 degree rotation', () => {
    expect(calculateRotationMatrix(90 * Math.PI / 180, new Point(0, 0)))
      .toStrictEqual([
        6.123233995736766e-17,
        1,
        -1,
        6.123233995736766e-17,
        0,
        0
      ]);
  });
  it('rotation matrix for 120 degree rotation', () => {
    expect(calculateRotationMatrix(120 * Math.PI / 180, new Point(0, 0)))
      .toStrictEqual([
        -0.4999999999999998,
        0.8660254037844387,
        -0.8660254037844387,
        -0.4999999999999998,
        0,
        0,
      ]);
  });
  it('rotation matrix for 143 degree rotation', () => {
    expect(calculateRotationMatrix(143 * Math.PI / 180, new Point(0, 0)))
      .toStrictEqual([
        -0.7986355100472929,
        0.6018150231520482,
        -0.6018150231520482,
        -0.7986355100472929,
        0,
        0
      ]);
  });
  it('rotation matrix for 180 degree rotation', () => {
    expect(calculateRotationMatrix(Math.PI, new Point(0, 0)))
      .toStrictEqual([
        -1,
        1.2246467991473532e-16,
        -1.2246467991473532e-16,
        -1,
        0,
        0,
      ]);
  });
  it('rotation matrix for 273.5672 degree rotation', () => {
    expect(calculateRotationMatrix(273.5672 * Math.PI / 180, new Point(0, 0)))
      .toStrictEqual([
        0.06221917091184331,
        -0.9980625104526484,
        0.9980625104526484,
        0.06221917091184331,
        0,
        0,
      ]);
  });
  it('rotation matrix for 360 degree rotation', () => {
    expect(calculateRotationMatrix(2 * Math.PI, new Point(0, 0)))
      .toStrictEqual([
        1,
        -2.4492935982947064e-16,
        2.4492935982947064e-16,
        1,
        0,
        0
      ]);
  });
  it('rotation matrix for -273.5672 degree rotation', () => {
    expect(calculateRotationMatrix(-273.5672 * Math.PI / 180, new Point(0, 0)))
      .toStrictEqual([
        0.06221917091184331,
        0.9980625104526484,
        -0.9980625104526484,
        0.06221917091184331,
        0,
        0,
      ]);
  });
  it('rotation matrix for -6 degree rotation', () => {
    expect(calculateRotationMatrix(-6 * Math.PI / 180, new Point(0, 0)))
      .toStrictEqual([
        0.9945218953682733,
        -0.10452846326765346,
        0.10452846326765346,
        0.9945218953682733,
        0,
        0,
      ]);
  });
  it('rotation matrix for -360 degree rotation', () => {
    expect(calculateRotationMatrix(-2 * Math.PI, new Point(0, 0)))
      .toStrictEqual([
        1,
        2.4492935982947064e-16,
        -2.4492935982947064e-16,
        1,
        0,
        0
      ]);
  });
  it('rotation matrix for 720 degree rotation', () => {
    expect(calculateRotationMatrix(4 * Math.PI, new Point(0, 0)))
      .toStrictEqual([
        1,
        -4.898587196589413e-16,
        4.898587196589413e-16,
        1,
        0,
        0
      ]);
  });
});

describe('Calculating rotation matrix around a point', () => {
  it('rotation matrix for 0 degree rotation, point (5, -5)', () => {
    expect(calculateRotationMatrix(0, new Point(5, -5)))
      .toStrictEqual([1, 0, -0.0, 1, 0, 0]);
  });
  it('rotation matrix for 0 degree rotation, point (-5, -5)', () => {
    expect(calculateRotationMatrix(0, new Point(5, -5)))
      .toStrictEqual([1, 0, -0.0, 1, 0, 0]);
  });
  it('rotation matrix for 0 degree rotation, point (-5, 5)', () => {
    expect(calculateRotationMatrix(0, new Point(5, -5)))
      .toStrictEqual([1, 0, -0.0, 1, 0, 0]);
  });
  it('rotation matrix for 0 degree rotation, point (5, 5)', () => {
    expect(calculateRotationMatrix(0, new Point(5, -5)))
      .toStrictEqual([1, 0, -0.0, 1, 0, 0]);
  });

  it('rotation matrix for 273.387672 degree rotation, point (3.87, 8.33)', () => {
    expect(calculateRotationMatrix(273.387672 * Math.PI / 180, new Point(3.87, 8.33)))
      .toStrictEqual([
        0.059091586740619276,
        -0.99825256542444,
        0.99825256542444,
        0.059091586740619276,
        -4.674128310671781,
        11.701004510643225,
      ]);
  });

  it('rotation matrix for 273.387672 degree rotation, point (-3.87, 8.33)', () => {
    expect(calculateRotationMatrix(273.387672 * Math.PI / 180, new Point(-3.87, 8.33)))
      .toStrictEqual([
        0.059091586740619276,
        -0.99825256542444,
        0.99825256542444,
        0.059091586740619276,
        -11.956759429299387,
        3.974529654258058,
      ]);
  });
  it('rotation matrix for 273.387672 degree rotation, point (3.87, -8.33)', () => {
    expect(calculateRotationMatrix(273.387672 * Math.PI / 180, new Point(3.87, -8.33)))
      .toStrictEqual([
        0.059091586740619276,
        -0.99825256542444,
        0.99825256542444,
        0.059091586740619276,
        11.956759429299387,
        -3.974529654258058,
      ]);
  });
  it('rotation matrix for 273.387672 degree rotation, point (-3.87, -8.33)', () => {
    expect(calculateRotationMatrix(273.387672 * Math.PI / 180, new Point(-3.87, -8.33)))
      .toStrictEqual([
        0.059091586740619276,
        -0.99825256542444,
        0.99825256542444,
        0.059091586740619276,
        4.674128310671781,
        -11.701004510643225,
      ]);
  });
  it('rotation matrix for -74 degree rotation, point (5, -5)', () => {
    expect(calculateRotationMatrix(-74 * Math.PI / 180, new Point(5, -5)))
      .toStrictEqual([
        0.27563735581699916,
        -0.9612616959383189,
        0.9612616959383189,
        0.27563735581699916,
        8.4281217006066,
        1.1844952587765902,
      ]);

  });
  it('rotation matrix for -74 degree rotation, point (-5, -5)', () => {
    expect(calculateRotationMatrix(-74 * Math.PI / 180, new Point(5, -5)))
      .toStrictEqual([
        0.27563735581699916,
        -0.9612616959383189,
        0.9612616959383189,
        0.27563735581699916,
        8.4281217006066,
        1.1844952587765902,
      ]);
  });
  it('rotation matrix for -74 degree rotation, point (-5, 5)', () => {
    expect(calculateRotationMatrix(-74 * Math.PI / 180, new Point(5, -5)))
      .toStrictEqual([
        0.27563735581699916,
        -0.9612616959383189,
        0.9612616959383189,
        0.27563735581699916,
        8.4281217006066,
        1.1844952587765902,
      ]);
  });
  it('rotation matrix for -74 degree rotation, point (5, 5)', () => {
    expect(calculateRotationMatrix(-74 * Math.PI / 180, new Point(5, -5)))
      .toStrictEqual([
        0.27563735581699916,
        -0.9612616959383189,
        0.9612616959383189,
        0.27563735581699916,
        8.4281217006066,
        1.1844952587765902,
      ]);
  });
});

describe('Applying matrix to point', () => {
  it('a point with a negative rotation', () => {
    const matrix = calculateRotationMatrix(-74 * Math.PI / 180, new Point(5, -7));
    const result = applyMatrixToPoint(matrix, new Point(6, -7));
    expect(result.x).toStrictEqual(5.275637355817);
    expect(result.y).toStrictEqual(-7.961261695938319);

    const result2 = applyMatrixToPoint(matrix, new Point(4, 66));
    expect(result2.x).toStrictEqual(74.89646644768028);
    expect(result2.y).toStrictEqual(14.082788670579257);
  });
  it('a point with a positive rotation', () => {
    const matrix = calculateRotationMatrix(60 * Math.PI / 180, new Point(5, 10));
    const result = applyMatrixToPoint(matrix, new Point(5, 10));
    expect(result.x).toStrictEqual(5);
    expect(result.y).toStrictEqual(10);

    const result2 = applyMatrixToPoint(matrix, new Point(4, 66));
    expect(result2.x).toStrictEqual(-43.997422611928556);
    expect(result2.y).toStrictEqual(37.13397459621557);
  });
  it('a point with no rotation', () => {
    const matrix = calculateRotationMatrix(0, new Point(0, 0));
    const result = applyMatrixToPoint(matrix, new Point(5, 6));
    expect(result.x).toStrictEqual(5);
    expect(result.y).toStrictEqual(6);
  });
});

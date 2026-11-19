import { cantileverFixture, shortFixture } from "../fixtures";

/** Original simultaneous-load regression, including the secondary spacing defect. */
export function beamHorizontalFixture(stitchDiameter = 6.3) {
  const p = cantileverFixture({
    vertical: 287500,
    height: 500,
    length: 1000,
    loadOffset: 625,
  });
  p.geometry.tipHeight = 250;
  Object.assign(p.design, {
    bearingWidth: 300,
    bearingLength: 200,
    loopInternalDiameter: 125,
    // #64: loops do not physically nest in this 300 mm cantilever (loopNesting).
    frontAnchor: "welded",
    combinations: [
      { name: "H", vertical: 230000, horizontal: 150000, gamma: 1.4 },
    ],
  });
  p.rebar.stirrupDiameter = 16;
  p.rebar.stitchDiameter = stitchDiameter;
  return p;
}
/** Keep the loop anchorage with enough width for both search implementations. */
const withLoopClearance = (p: ReturnType<typeof cantileverFixture>) => {
  p.geometry.width = 350;
  return p;
};
export const autodesignCases = {
  short: shortFixture,
  beam: () => withLoopClearance(cantileverFixture({ length: 700 })),
  beamHorizontalCompatible: () => beamHorizontalFixture(10),
  beamSkin: () =>
    withLoopClearance(
      cantileverFixture({ height: 700, loadOffset: 1000, length: 1200 }),
    ),
  friction: () => {
    const p = shortFixture();
    p.geometry.loadOffset = 180;
    return p;
  },
  materialReview: () => {
    const p = shortFixture();
    Object.assign(p.design, { gammaC: 1.3, gammaS: 1.1 });
    return p;
  },
  strutReview: () => {
    const p = shortFixture();
    p.design.strutLimit = "fcd3";
    return p;
  },
  concreteFailure: () => {
    const p = shortFixture();
    p.loads.vertical = 1e7;
    return p;
  },
  shearFailure: () => cantileverFixture({ vertical: 350000, length: 700 }),
  literatureFailure: () => {
    const p = shortFixture();
    p.design.literatureRecommendations = true;
    return p;
  },
};

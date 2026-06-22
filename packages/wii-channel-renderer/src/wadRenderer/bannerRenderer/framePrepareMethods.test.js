import { describe, expect, it } from "vitest";
import { getFrameMetrics, prepareFrame, resolvePreparedPane } from "./framePrepareMethods.js";

function makeRenderer(overrides = {}) {
  const panes = [
    { name: "root", type: "pan1" },
    { name: "pic", type: "pic1" },
    { name: "txt", type: "txt1" },
  ];
  const states = new Map([
    [panes[0], {
      tx: 10,
      ty: 20,
      rotX: 0,
      rotY: 0,
      alpha: 0.5,
      influencedByParentAlpha: false,
      propagatesVisibility: true,
      visible: true,
      width: 1,
      height: 1,
    }],
    [panes[1], {
      tx: 5,
      ty: 7,
      rotX: 0,
      rotY: 15,
      alpha: 0.5,
      influencedByParentAlpha: true,
      propagatesVisibility: true,
      visible: true,
      width: 64,
      height: 32,
    }],
    [panes[2], {
      tx: 0,
      ty: 0,
      rotX: 0,
      rotY: 0,
      alpha: 1,
      influencedByParentAlpha: true,
      propagatesVisibility: true,
      visible: true,
      width: 100,
      height: 20,
    }],
  ]);

  return {
    layout: { width: 608, height: 456 },
    referenceAspectRatio: 4 / 3,
    displayAspectRatio: 16 / 9,
    maxDevicePixelRatio: 1.5,
    canvas: { width: 1, height: 1 },
    allPanes: panes,
    renderablePanes: [panes[1], panes[2]],
    activeRenderablePanes: null,
    localPaneStates: new Map(),
    textureSrtAnimationCache: new Map([["stale", true]]),
    getLocalPaneState: (pane) => states.get(pane),
    getPaneTransformChain: (pane) => (pane.name === "pic" ? [panes[0], panes[1]] : [pane]),
    getPaneOriginOffset: (pane, width, height) => ({ x: width / 2, y: -height / 2 }),
    getFrameMetrics,
    resolvePreparedPane,
    ...overrides,
  };
}

describe("framePrepareMethods", () => {
  it("computes display metrics with aspect correction and DPR cap", () => {
    const renderer = makeRenderer();
    const previousDpr = globalThis.devicePixelRatio;
    globalThis.devicePixelRatio = 2;

    const metrics = getFrameMetrics.call(renderer, renderer.canvas);

    expect(metrics.layoutWidth).toBe(608);
    expect(metrics.layoutHeight).toBe(456);
    expect(metrics.displayScaleX).toBeCloseTo(4 / 3, 6);
    expect(metrics.dpr).toBe(1.5);
    expect(metrics.pixelWidth).toBe(1216);
    expect(metrics.pixelHeight).toBe(684);
    expect(metrics.baseScaleX).toBeCloseTo(2, 6);
    expect(metrics.baseScaleY).toBe(1.5);

    if (previousDpr == null) {
      delete globalThis.devicePixelRatio;
    } else {
      globalThis.devicePixelRatio = previousDpr;
    }
  });

  it("prepares pane state, inherited alpha, visibility, and origin once per frame", () => {
    const renderer = makeRenderer();

    const prepared = prepareFrame.call(renderer, 12, renderer.canvas);

    expect(renderer.textureSrtAnimationCache.size).toBe(0);
    expect(renderer.preparedFrame).toBe(prepared);
    expect(prepared.localPaneStates.size).toBe(3);
    expect(prepared.preparedPanes).toHaveLength(2);

    const pic = prepared.preparedPanes[0];
    expect(pic.pane.name).toBe("pic");
    expect(pic.alpha).toBeCloseTo(0.25, 6);
    expect(pic.visible).toBe(true);
    expect(pic.drawable).toBe(true);
    expect(pic.has3DRotation).toBe(true);
    expect(pic.chainStates).toHaveLength(2);
    expect(pic.originOffset).toEqual({ x: 32, y: -16 });
  });

  it("marks panes non-drawable when a propagating ancestor is hidden", () => {
    const renderer = makeRenderer({
      getLocalPaneState: (pane) => {
        if (pane.name === "root") {
          return {
            tx: 0,
            ty: 0,
            rotX: 0,
            rotY: 0,
            alpha: 1,
            influencedByParentAlpha: true,
            propagatesVisibility: true,
            visible: false,
            width: 1,
            height: 1,
          };
        }
        return {
          tx: 0,
          ty: 0,
          rotX: 0,
          rotY: 0,
          alpha: 1,
          influencedByParentAlpha: true,
          propagatesVisibility: true,
          visible: true,
          width: 64,
          height: 32,
        };
      },
    });

    const prepared = prepareFrame.call(renderer, 0, renderer.canvas);

    expect(prepared.preparedPanes[0].visible).toBe(false);
    expect(prepared.preparedPanes[0].drawable).toBe(false);
  });
});

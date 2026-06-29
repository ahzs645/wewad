import { describe, expect, it } from "vitest";
import { buildRsoCarousel } from "./renderState";

// Minimal RLPA (translation) tag with keyframes in [from, to].
function rlpa(from, to) {
  return {
    type: "RLPA",
    entries: [
      {
        targetGroup: 0,
        type: 0x00,
        dataType: 2,
        typeName: "RLPA",
        interpolation: "hermite",
        keyframes: [
          { frame: from, value: 0, blend: 0 },
          { frame: to, value: 64, blend: 0 },
        ],
      },
    ],
  };
}

// A pane animation entry with a single degenerate "state marker" keyframe far
// beyond the authored frame range (like Rso0's conductor markers).
function marker(name, frame) {
  return {
    name,
    tags: [
      {
        type: "RLPA",
        entries: [
          {
            targetGroup: 0,
            type: 0x00,
            dataType: 2,
            typeName: "RLPA",
            interpolation: "hermite",
            keyframes: [{ frame, value: 0, blend: 0 }],
          },
        ],
      },
    ],
  };
}

// Build a synthetic 2-slot RSO carousel target (Wii Shop shape, scaled down).
function makeTwoSlotTarget() {
  const groups = [
    { name: "RootGroup", paneNames: [] },
    { name: "Rso0", paneNames: ["P_ShopLogo_00", "bg_wiiplane_00"] },
    { name: "Rso1", paneNames: ["N_RcmdImg_00", "T_Rcmd_00"] },
    { name: "Rso2", paneNames: ["N_RcmdInner_00"] },
    { name: "Rso3", paneNames: ["N_Rcmd_00"] },
    { name: "Rso4", paneNames: ["P_ShopLogo_01", "bg_wiiplane_01"] },
    { name: "Rso5", paneNames: ["N_RcmdImg_01", "T_Rcmd_01"] },
    { name: "Rso6", paneNames: ["N_RcmdInner_01"] },
    { name: "Rso7", paneNames: ["N_Rcmd_01"] },
  ];

  const animEntries = [
    {
      id: "icon_Rso0", state: "RSO0", frameSize: 5000,
      anim: {
        frameSize: 5000,
        panes: [
          { name: "bg_wiiplane_00", tags: [rlpa(0, 200)] },
          { name: "P_ShopLogo_00", tags: [rlpa(0, 180)] },
          // Conductor marker for a different slot's pane — must NOT leak into slot 0.
          marker("bg_wiiplane_01", 20000),
        ],
      },
    },
    { id: "icon_Rso1", state: "RSO1", frameSize: 600, anim: { frameSize: 600, panes: [{ name: "N_RcmdImg_00", tags: [rlpa(0, 100)] }] } },
    { id: "icon_Rso2", state: "RSO2", frameSize: 600, anim: { frameSize: 600, panes: [{ name: "N_RcmdInner_00", tags: [rlpa(0, 80)] }] } },
    { id: "icon_Rso3", state: "RSO3", frameSize: 600, anim: { frameSize: 600, panes: [{ name: "N_Rcmd_00", tags: [rlpa(0, 60)] }] } },
    {
      id: "icon_Rso4", state: "RSO4", frameSize: 5000,
      anim: { frameSize: 5000, panes: [{ name: "bg_wiiplane_01", tags: [rlpa(0, 200)] }, { name: "P_ShopLogo_01", tags: [rlpa(0, 180)] }] },
    },
    { id: "icon_Rso5", state: "RSO5", frameSize: 600, anim: { frameSize: 600, panes: [{ name: "N_RcmdImg_01", tags: [rlpa(0, 100)] }] } },
    { id: "icon_Rso6", state: "RSO6", frameSize: 600, anim: { frameSize: 600, panes: [{ name: "N_RcmdInner_01", tags: [rlpa(0, 80)] }] } },
    { id: "icon_Rso7", state: "RSO7", frameSize: 600, anim: { frameSize: 600, panes: [{ name: "N_Rcmd_01", tags: [rlpa(0, 60)] }] } },
  ];

  return { renderLayout: { groups }, animEntries };
}

const gateOf = (pane) => pane?.tags.find((t) => t.type === "RLVI")?.entries[0].keyframes;
const motionFrames = (pane) =>
  (pane?.tags ?? [])
    .filter((t) => t.type !== "RLVI")
    .flatMap((t) => t.entries.flatMap((e) => e.keyframes.map((k) => k.frame)));

describe("buildRsoCarousel", () => {
  it("returns null for non-carousel layouts", () => {
    expect(buildRsoCarousel(null)).toBeNull();
    expect(buildRsoCarousel({ renderLayout: { groups: [{ name: "RootGroup" }] }, animEntries: [] })).toBeNull();
    // A single start/loop pair (RSO0 + RSO1 only) is not a multi-slot carousel.
    const single = {
      renderLayout: { groups: [{ name: "Rso0", paneNames: ["a"] }, { name: "Rso1", paneNames: ["b"] }] },
      animEntries: [{ state: "RSO0", anim: { frameSize: 100, panes: [] } }],
    };
    expect(buildRsoCarousel(single)).toBeNull();
  });

  it("reconstructs a multi-slot carousel as one looping animation", () => {
    const carousel = buildRsoCarousel(makeTwoSlotTarget());
    expect(carousel).not.toBeNull();
    expect(carousel.slotCount).toBe(2);
    expect(carousel.playbackMode).toBe("loop");
    expect(carousel.stride).toBeGreaterThan(0);
    expect(carousel.frameSize).toBe(carousel.stride * carousel.slotCount);
  });

  it("time-shifts each slot's motion into its own window", () => {
    const carousel = buildRsoCarousel(makeTwoSlotTarget());
    const panes = carousel.anim.panes;
    const stride = carousel.stride;

    const slot0bg = panes.find((p) => p.name === "bg_wiiplane_00");
    const slot1bg = panes.find((p) => p.name === "bg_wiiplane_01");
    const m0 = motionFrames(slot0bg);
    const m1 = motionFrames(slot1bg);

    expect(Math.min(...m0)).toBeGreaterThanOrEqual(0);
    expect(Math.max(...m0)).toBeLessThanOrEqual(stride);
    expect(Math.min(...m1)).toBeGreaterThanOrEqual(stride);
    expect(Math.max(...m1)).toBeLessThanOrEqual(stride * 2);
  });

  it("gates each slot to its window (slot 0 visible at t=0, later slots hidden)", () => {
    const carousel = buildRsoCarousel(makeTwoSlotTarget());
    const panes = carousel.anim.panes;
    const g0 = gateOf(panes.find((p) => p.name === "bg_wiiplane_00"));
    const g1 = gateOf(panes.find((p) => p.name === "bg_wiiplane_01"));

    expect(g0[0]).toMatchObject({ frame: 0, value: 1 }); // slot 0 visible from the start
    expect(g1[0]).toMatchObject({ frame: 0, value: 0 }); // slot 1 hidden before its window
    expect(g1.some((k) => k.frame === carousel.stride && k.value === 1)).toBe(true);
  });

  it("does not leak one slot's conductor markers into another slot", () => {
    const carousel = buildRsoCarousel(makeTwoSlotTarget());
    // bg_wiiplane_01 appears as a degenerate marker (frame 20000) inside Rso0, but
    // it belongs to slot 1 — slot 0 must not carry a stray bg_wiiplane_01 entry,
    // and slot 1's bg motion must come from Rso4 (real frames), not the marker.
    const slot1bg = carousel.anim.panes.find((p) => p.name === "bg_wiiplane_01");
    expect(motionFrames(slot1bg).every((f) => f < carousel.frameSize)).toBe(true);
  });
});

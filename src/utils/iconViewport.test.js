import { describe, expect, it } from "vitest";
import { resolveIconViewport } from "./iconViewport";

describe("resolveIconViewport", () => {
  it("uses the Wii default icon viewport when no pane is available", () => {
    expect(resolveIconViewport(null)).toEqual({ width: 128, height: 96 });
    expect(resolveIconViewport({ panes: [] })).toEqual({ width: 128, height: 96 });
  });

  it("prefers explicit channel panes", () => {
    const layout = {
      panes: [
        { type: "pic1", name: "largeBackground", size: { w: 300, h: 200 } },
        { type: "pic1", name: "Ch1", size: { w: 128.2, h: 95.8 } },
      ],
    };

    expect(resolveIconViewport(layout)).toEqual({ width: 128, height: 96 });
  });

  it("recognizes camelCase icon background names", () => {
    const layout = {
      panes: [
        { type: "pan1", name: "root", size: { w: 500, h: 500 } },
        { type: "pic1", name: "iconBg", size: { w: 176, h: 132 } },
      ],
    };

    expect(resolveIconViewport(layout)).toEqual({ width: 176, height: 132 });
  });

  it("falls back to the largest visible picture pane", () => {
    const layout = {
      panes: [
        { type: "pic1", name: "hidden", visible: false, size: { w: 300, h: 200 } },
        { type: "pic1", name: "small", size: { w: 80, h: 40 } },
        { type: "pic1", name: "large", size: { w: -160, h: -120 } },
      ],
    };

    expect(resolveIconViewport(layout)).toEqual({ width: 160, height: 120 });
  });
});

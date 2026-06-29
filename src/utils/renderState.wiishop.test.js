import { describe, expect, it } from "vitest";
import { buildWiiShopIconOverrides } from "./renderState";

function wiiShopLayout() {
  // Minimal Wii Shop icon signature: 4 carousel slots (_00.._03) of bags + caption.
  const names = [
    "iconBg", "bg_wiiplane_00", "bg_wiiplane_01", "bg_wiiplane_02", "bg_wiiplane_03",
    "P_ShopLogo_00", "P_ShopLogo_01", "P_ShopLogo_02", "P_ShopLogo_03",
    "P_RcmdImg_00", "P_RcmdImg_01", "P_RcmdImg_02", "P_RcmdImg_03",
    "P_txtBg_00", "P_txtBg_01", "T_Rcmd_00", "T_Rcmd_01",
    "P_title_E_00", "P_title_E_01",
  ];
  return { renderLayout: { panes: names.map((name) => ({ name })) } };
}

describe("buildWiiShopIconOverrides", () => {
  it("returns null for non-Wii-Shop layouts", () => {
    expect(buildWiiShopIconOverrides(null)).toBeNull();
    expect(buildWiiShopIconOverrides({ renderLayout: { panes: [] } })).toBeNull();
    // A normal game icon has none of the signature panes.
    expect(buildWiiShopIconOverrides({ renderLayout: { panes: [{ name: "globe" }, { name: "title_GOO" }] } })).toBeNull();
    // Has bags but no recommendation captions -> not the carousel icon.
    expect(buildWiiShopIconOverrides({ renderLayout: { panes: [{ name: "P_ShopLogo_00" }, { name: "bg_wiiplane_00" }] } })).toBeNull();
  });

  it("hides the empty recommendation slots and captions for the Wii Shop icon", () => {
    const o = buildWiiShopIconOverrides(wiiShopLayout());
    expect(o).toBeInstanceOf(Map);
    // Empty caption text + text backgrounds hidden.
    expect(o.get("T_Rcmd_00")).toBe(false);
    expect(o.get("T_Rcmd_01")).toBe(false);
    expect(o.get("P_txtBg_00")).toBe(false);
    // Duplicate slots 1/2/3 hidden.
    for (const n of ["bg_wiiplane_01", "bg_wiiplane_02", "bg_wiiplane_03", "P_ShopLogo_01", "P_RcmdImg_03", "P_title_E_01"]) {
      expect(o.get(n)).toBe(false);
    }
  });

  it("keeps slot 0 (bags placeholder + wordmark + background) visible", () => {
    const o = buildWiiShopIconOverrides(wiiShopLayout());
    // Slot-0 panes must NOT be forced hidden.
    for (const n of ["iconBg", "bg_wiiplane_00", "P_ShopLogo_00", "P_RcmdImg_00", "P_title_E_00"]) {
      expect(o.has(n)).toBe(false);
    }
  });
});

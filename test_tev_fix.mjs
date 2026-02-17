/**
 * Test script: evaluate bg_wiiplane_00's 6 TEV stages with mock pixel data
 * to verify the pipeline produces meaningful non-zero color output.
 *
 * Usage: node test_tev_fix.mjs
 */

import { readFileSync } from "node:fs";
import { webcrypto } from "node:crypto";
import { createServer } from "vite";

// Polyfill globalThis.crypto for Node.js
if (!globalThis.crypto) globalThis.crypto = webcrypto;
if (!globalThis.crypto.subtle && webcrypto.subtle)
  globalThis.crypto.subtle = webcrypto.subtle;

function toArrayBuffer(nodeBuffer) {
  const ab = new ArrayBuffer(nodeBuffer.byteLength);
  const view = new Uint8Array(ab);
  view.set(
    new Uint8Array(
      nodeBuffer.buffer,
      nodeBuffer.byteOffset,
      nodeBuffer.byteLength
    )
  );
  return ab;
}

function hr(title) {
  console.log("\n" + "=".repeat(78));
  console.log("  " + title);
  console.log("=".repeat(78));
}

function colorStr(c) {
  return `(R=${(c.r * 255).toFixed(1)}, G=${(c.g * 255).toFixed(1)}, B=${(c.b * 255).toFixed(1)}, A=${(c.a * 255).toFixed(1)})`;
}

function isNonBlack(c) {
  return c.r > 0.01 || c.g > 0.01 || c.b > 0.01;
}

async function main() {
  const server = await createServer({
    server: { middlewareMode: true },
    appType: "custom",
  });

  try {
    // Import parsers and TEV evaluator via Vite SSR
    const { parseWAD } = await server.ssrLoadModule(
      "/src/lib/wadRenderer/parsers/wad.js"
    );
    const { parseU8 } = await server.ssrLoadModule(
      "/src/lib/wadRenderer/parsers/u8.js"
    );
    const { parseBRLYT } = await server.ssrLoadModule(
      "/src/lib/wadRenderer/parsers/brlyt.js"
    );
    const { decryptWadContents } = await server.ssrLoadModule(
      "/src/lib/wadRenderer/pipeline/decryption.js"
    );
    const { evaluateTevStagesForPixel } = await server.ssrLoadModule(
      "/src/lib/wadRenderer/bannerRenderer/tevEvaluator.js"
    );

    const logger = {
      info: () => {},
      warn: (...args) => console.warn("[WARN]", ...args),
      error: (...args) => console.error("[ERROR]", ...args),
      success: () => {},
    };

    // ---- 1. Parse WAD ----
    hr("1. Parsing Wii Shop Channel WAD");
    const wadPath =
      "/Users/ahmadjalil/github/wewad/New Folder With Items/Wii Shop Channel (World) (v20) (Channel).wad";
    const rawBuffer = readFileSync(wadPath);
    const arrayBuffer = toArrayBuffer(rawBuffer);
    const wad = parseWAD(arrayBuffer, logger);
    console.log(`  Title: ${wad.titleId}, ${wad.numContents} contents`);

    // ---- 2. Decrypt ----
    hr("2. Decrypting WAD contents");
    const decryptedContents = await decryptWadContents(wad, logger);
    if (!decryptedContents) {
      console.error("  Decryption failed.");
      return;
    }

    // ---- 3. Extract icon.bin -> BRLYT ----
    hr("3. Extracting icon.bin and parsing BRLYT");
    const metaAppName = wad.contentRecords.find((r) => r.index === 0)?.name;
    const metaFiles = parseU8(decryptedContents[metaAppName], logger);
    const iconEntry = Object.entries(metaFiles).find(([p]) =>
      p.toLowerCase().includes("icon.bin")
    );
    if (!iconEntry) {
      console.error("  icon.bin not found!");
      return;
    }
    const [, iconData] = iconEntry;
    const iconFiles = parseU8(iconData, logger);
    const brlytEntry = Object.entries(iconFiles).find(([p]) =>
      p.toLowerCase().endsWith(".brlyt")
    );
    if (!brlytEntry) {
      console.error("  No .brlyt found!");
      return;
    }
    const [brlytPath, brlytData] = brlytEntry;
    console.log(`  BRLYT: ${brlytPath}`);
    const layout = parseBRLYT(brlytData, logger);
    console.log(
      `  Materials: ${layout.materials.length}, Textures: ${layout.textures.length}`
    );

    // ---- 4. Get bg_wiiplane_00 material (index 34) ----
    hr("4. Inspecting bg_wiiplane_00 material");
    const mat = layout.materials[34];
    if (!mat) {
      console.error("  Material index 34 not found!");
      return;
    }
    console.log(`  Material name: "${mat.name}"`);
    console.log(`  TEV stages: ${mat.tevStages.length}`);
    console.log(
      `  Texture maps: ${mat.textureMaps.map((tm) => `[${tm.textureIndex}]=${layout.textures[tm.textureIndex] ?? "?"}`).join(", ")}`
    );
    console.log(`  color1 (C0): [${mat.color1.join(", ")}]`);
    console.log(`  color2 (C1): [${mat.color2.join(", ")}]`);
    console.log(`  color3 (C2): [${mat.color3.join(", ")}]`);
    console.log(
      `  kColors: ${mat.tevColors.map((k, i) => `[${i}]=(${k.r},${k.g},${k.b},${k.a})`).join(", ")}`
    );
    if (mat.tevSwapTable) {
      console.log(`  Swap table: ${JSON.stringify(mat.tevSwapTable)}`);
    }

    // Print all 6 TEV stages for reference
    const GX_CC = [
      "CPREV", "APREV", "C0", "A0", "C1", "A1", "C2", "A2",
      "TEXC", "TEXA", "RASC", "RASA", "ONE", "HALF", "KONST", "ZERO",
    ];
    const GX_CA = [
      "APREV", "A0", "A1", "A2", "TEXA", "RASA", "KONST", "ZERO",
    ];
    const GX_OP = ["ADD", "SUB"];
    const GX_BIAS = ["ZERO", "ADDHALF", "SUBHALF", "COMPARE"];
    const GX_SCALE = ["x1", "x2", "x4", "x0.5"];
    const GX_REG = ["CPREV", "C0", "C1", "C2"];

    for (let i = 0; i < mat.tevStages.length; i++) {
      const s = mat.tevStages[i];
      console.log(`\n  Stage ${i}:`);
      console.log(
        `    Color: a=${GX_CC[s.aC]} b=${GX_CC[s.bC]} c=${GX_CC[s.cC]} d=${GX_CC[s.dC]}`
      );
      console.log(
        `           op=${s.tevOpC}(${s.tevOpC < 2 ? GX_OP[s.tevOpC] : `CMP_${s.tevOpC}`}) bias=${GX_BIAS[s.tevBiasC]} scale=${GX_SCALE[s.tevScaleC]} clamp=${s.clampC} -> ${GX_REG[s.tevRegIdC]} kColorSel=${s.kColorSelC}`
      );
      console.log(
        `    Alpha: a=${GX_CA[s.aA]} b=${GX_CA[s.bA]} c=${GX_CA[s.cA]} d=${GX_CA[s.dA]}`
      );
      console.log(
        `           op=${s.tevOpA}(${s.tevOpA < 2 ? GX_OP[s.tevOpA] : `CMP_${s.tevOpA}`}) bias=${GX_BIAS[s.tevBiasA]} scale=${GX_SCALE[s.tevScaleA]} clamp=${s.clampA} -> ${GX_REG[s.tevRegIdA]} kAlphaSel=${s.kAlphaSelA}`
      );
      console.log(
        `    texMap=${s.texMap} texCoord=${s.texCoord} colorChan=${s.colorChan} rasSel=${s.rasSel} texSel=${s.texSel}`
      );
    }

    // ---- 5. TEV Evaluation Tests ----
    hr("5. TEV Evaluation Tests");

    // Test parameters:
    //   texSamples[0] = icon_bg01 texture sample (texMap 0)
    //   texSamples[1] = anim_pattern texture sample (texMap 1)
    //   rasColor = vertex color (white)
    //   kColors[3] = animated via RLMC

    const texColorCombos = [
      {
        name: "Solid blue icon_bg01",
        tex0: { r: 0 / 255, g: 100 / 255, b: 200 / 255, a: 1.0 },
      },
      {
        name: "Solid white icon_bg01",
        tex0: { r: 1.0, g: 1.0, b: 1.0, a: 1.0 },
      },
      {
        name: "Solid red icon_bg01",
        tex0: { r: 1.0, g: 0, b: 0, a: 1.0 },
      },
    ];

    const kColor3Values = [
      { name: "kColors[3]=(0,0,0,255)", val: { r: 0, g: 0, b: 0, a: 255 } },
      {
        name: "kColors[3]=(128,128,128,255)",
        val: { r: 128, g: 128, b: 128, a: 255 },
      },
      {
        name: "kColors[3]=(255,255,255,255)",
        val: { r: 255, g: 255, b: 255, a: 255 },
      },
      {
        name: "kColors[3]=(200,50,50,255)",
        val: { r: 200, g: 50, b: 50, a: 255 },
      },
    ];

    // anim_pattern is typically an alpha mask pattern; simulate a mid-gray value
    const animPatternSample = { r: 0.5, g: 0.5, b: 0.5, a: 0.5 };

    const rasColor = { r: 1.0, g: 1.0, b: 1.0, a: 1.0 }; // white vertex color

    let passCount = 0;
    let totalCount = 0;

    for (const texCombo of texColorCombos) {
      for (const kCombo of kColor3Values) {
        totalCount++;

        // Build kColors array: copy existing and override index 3
        const kColors = mat.tevColors.map((k) => ({ ...k }));
        while (kColors.length < 4) {
          kColors.push({ r: 0, g: 0, b: 0, a: 255 });
        }
        kColors[3] = { ...kCombo.val };

        // Build texSamples: index by texMap slot
        // Material has 2 texture maps. texMap indices from the stages reference these.
        const maxTexMap = Math.max(
          ...mat.tevStages.map((s) => s.texMap).filter((t) => t !== 0xff)
        );
        const texSamples = [];
        for (let t = 0; t <= maxTexMap; t++) {
          texSamples.push({ r: 0, g: 0, b: 0, a: 0 });
        }
        // Slot 0 = icon_bg01 (first texture map)
        if (texSamples.length > 0) {
          texSamples[0] = { ...texCombo.tex0 };
        }
        // Slot 1 = anim_pattern (second texture map)
        if (texSamples.length > 1) {
          texSamples[1] = { ...animPatternSample };
        }

        // Build a modified material with overridden kColors for the evaluator
        const modifiedMat = { ...mat, tevColors: kColors };
        const swapTable = mat.tevSwapTable ?? null;

        const result = evaluateTevStagesForPixel(
          mat.tevStages,
          texSamples,
          rasColor,
          modifiedMat,
          kColors,
          swapTable
        );

        const nonBlack = isNonBlack(result);
        if (nonBlack) passCount++;

        const status = nonBlack ? "NON-BLACK" : "BLACK   ";
        console.log(
          `  [${status}] ${texCombo.name} + ${kCombo.name}`
        );
        console.log(`           -> ${colorStr(result)}`);
      }
    }

    // ---- 6. Edge case: anim_pattern fully opaque vs fully transparent ----
    hr("6. Edge case: anim_pattern alpha variations");

    const animPatternVariations = [
      {
        name: "anim_pattern=transparent",
        sample: { r: 0, g: 0, b: 0, a: 0 },
      },
      {
        name: "anim_pattern=half",
        sample: { r: 0.5, g: 0.5, b: 0.5, a: 0.5 },
      },
      {
        name: "anim_pattern=opaque white",
        sample: { r: 1.0, g: 1.0, b: 1.0, a: 1.0 },
      },
    ];

    const fixedTex0 = { r: 0.0, g: 0.39, b: 0.78, a: 1.0 }; // blue
    const fixedKColor3 = { r: 128, g: 128, b: 128, a: 255 }; // mid-gray

    for (const apVar of animPatternVariations) {
      totalCount++;

      const kColors = mat.tevColors.map((k) => ({ ...k }));
      while (kColors.length < 4) {
        kColors.push({ r: 0, g: 0, b: 0, a: 255 });
      }
      kColors[3] = { ...fixedKColor3 };

      const maxTexMap = Math.max(
        ...mat.tevStages.map((s) => s.texMap).filter((t) => t !== 0xff)
      );
      const texSamples = [];
      for (let t = 0; t <= maxTexMap; t++) {
        texSamples.push({ r: 0, g: 0, b: 0, a: 0 });
      }
      if (texSamples.length > 0) texSamples[0] = { ...fixedTex0 };
      if (texSamples.length > 1) texSamples[1] = { ...apVar.sample };

      const modifiedMat = { ...mat, tevColors: kColors };
      const swapTable = mat.tevSwapTable ?? null;

      const result = evaluateTevStagesForPixel(
        mat.tevStages,
        texSamples,
        rasColor,
        modifiedMat,
        kColors,
        swapTable
      );

      const nonBlack = isNonBlack(result);
      if (nonBlack) passCount++;

      const status = nonBlack ? "NON-BLACK" : "BLACK   ";
      console.log(`  [${status}] ${apVar.name}`);
      console.log(`           -> ${colorStr(result)}`);
    }

    // ---- Summary ----
    hr("SUMMARY");
    console.log(
      `  ${passCount}/${totalCount} test combinations produced non-black output`
    );
    if (passCount > 0) {
      console.log(
        "  PASS: TEV pipeline produces meaningful non-zero color for bg_wiiplane_00"
      );
    } else {
      console.log(
        "  FAIL: All outputs are black - TEV pipeline may still have issues"
      );
    }
  } finally {
    await server.close();
  }
}

main().catch((err) => {
  console.error("Fatal error:", err);
  process.exit(1);
});

import { BinaryReader, withLogger } from "../shared/index";
import { ANIM_TYPES } from "./constants";

export function parseBRLAN(buffer, loggerInput) {
  const logger = withLogger(loggerInput);
  const reader = new BinaryReader(buffer);

  const magic = reader.string(4);
  if (magic !== "RLAN") {
    throw new Error(`Not a BRLAN: ${magic}`);
  }

  reader.u16(); // BOM
  reader.u16(); // version
  reader.u32(); // file size
  const headerSize = reader.u16();
  const numSections = reader.u16();

  const animation = { frameSize: 0, flags: 0, panes: [] };

  reader.seek(headerSize);

  for (let sectionIndex = 0; sectionIndex < numSections; sectionIndex += 1) {
    const sectionStart = reader.offset;
    const sectionMagic = reader.string(4);
    const sectionSize = reader.u32();

    if (sectionMagic === "pai1") {
      animation.frameSize = reader.u16();
      animation.flags = reader.u8();
      reader.skip(1);
      reader.u16(); // num timelines
      const numEntries = reader.u16();
      const paneOffsetTableOffset = reader.u32();

      logger.info(`  Animation: ${animation.frameSize} frames, ${numEntries} pane(s)`);

      const paneEntryOffsets = [];
      reader.seek(sectionStart + paneOffsetTableOffset);
      for (let i = 0; i < numEntries; i += 1) {
        paneEntryOffsets.push(reader.u32());
      }

      for (let paneIndex = 0; paneIndex < numEntries; paneIndex += 1) {
        const paneStart = sectionStart + paneEntryOffsets[paneIndex];
        reader.seek(paneStart);

        const paneName = reader.string(20).replace(/\0+$/, "");
        const numTags = reader.u8();
        reader.skip(3);

        const paneAnimation = { name: paneName, tags: [] };

        const tagOffsets = [];
        const tagOffsetsBase = reader.offset;
        for (let tagIndex = 0; tagIndex < numTags; tagIndex += 1) {
          tagOffsets.push(reader.u32());
        }

        for (let tagIndex = 0; tagIndex < numTags; tagIndex += 1) {
          const tagStart = paneStart + tagOffsets[tagIndex];
          reader.seek(tagStart);

          const tagType = reader.string(4);
          const numTagEntries = reader.u8();
          reader.skip(3);

          const tag = { type: tagType, entries: [] };

          const tagEntryOffsets = [];
          const tagEntryOffsetsBase = reader.offset;
          for (let i = 0; i < numTagEntries; i += 1) {
            tagEntryOffsets.push(reader.u32());
          }

          for (let entryIndex = 0; entryIndex < numTagEntries; entryIndex += 1) {
            const entryStart = tagStart + tagEntryOffsets[entryIndex];
            reader.seek(entryStart);

            const targetGroup = reader.u8();
            const animType = reader.u8();
            const dataType = reader.u8();
            reader.skip(1);
            const numKeyframes = reader.u16();
            reader.skip(2);
            const keyframeOffset = reader.u32();

            const interpolation =
              dataType === 1 ? "step" :
              dataType === 2 ? "hermite" :
              "linear";
            const shouldLoop = (animation.flags & 0x01) !== 0;

            const entry = {
              targetGroup,
              type: animType,
              dataType,
              typeName: ANIM_TYPES[animType] ?? `0x${animType.toString(16)}`,
              interpolation,
              preExtrapolation: shouldLoop ? "loop" : "clamp",
              postExtrapolation: shouldLoop ? "loop" : "clamp",
              keyframes: [],
            };

            reader.seek(entryStart + keyframeOffset);

            for (let keyframeIndex = 0; keyframeIndex < numKeyframes; keyframeIndex += 1) {
              if (dataType === 2) {
                entry.keyframes.push({ frame: reader.f32(), value: reader.f32(), blend: reader.f32() });
              } else if (dataType === 1) {
                // BRLAN integer keyframes (e.g. RLVI visibility / RLTP indices):
                // frame=f32, value=u16, reserved=u16.
                entry.keyframes.push({ frame: reader.f32(), value: reader.u16(), blend: 0 });
                reader.skip(2);
              } else {
                entry.keyframes.push({ frame: reader.f32(), value: reader.f32(), blend: 0 });
              }
            }

            if (entry.keyframes.length > 0) {
              const maxFrame = Math.max(...entry.keyframes.map((keyframe) => keyframe.frame));
              if (maxFrame <= 0 && animation.frameSize > 0) {
                for (const keyframe of entry.keyframes) {
                  keyframe.frame += animation.frameSize;
                }
              }

              entry.keyframes.sort((left, right) => left.frame - right.frame);
            }

            tag.entries.push(entry);
            logger.info(
              `    ${paneName}: ${entry.typeName} [grp=${targetGroup}] (${numKeyframes} keyframes)`,
            );
          }

          paneAnimation.tags.push(tag);
        }

        animation.panes.push(paneAnimation);
      }
    }

    reader.seek(sectionStart + sectionSize);
  }

  return animation;
}

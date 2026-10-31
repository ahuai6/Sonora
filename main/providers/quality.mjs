// Spatial and effect tiers are separate from measured audio fidelity.
export const EXTENDED_QUALITY = {
  master: {
    level: "jymaster",
    qqQuality: "master",
    kgQuality: "viper_tape",
    label: "母带（平台权益）",
    br: 1999000,
    kbps: 1999,
  },
  spatial: {
    level: "vivid",
    qqQuality: "spatial",
    kgQuality: "viper_atmos",
    label: "全景声（平台权益）",
    br: 1999000,
    kbps: 1999,
  },
  surround: {
    level: "sky",
    qqQuality: "surround",
    label: "环绕声（网易云 / QQ）",
    br: 1999000,
    kbps: 1999,
  },
  clear: {
    level: "jyeffect",
    kgQuality: "viper_clear",
    label: "臻音 / 蝰蛇超清（网易云 / 酷狗）",
    br: 1999000,
    kbps: 1999,
  },
  dsd: { kgQuality: "super", label: "DSD（酷狗）", br: 1999000, kbps: 1999 },
};
export function supportsQuality(platform, quality) {
  return (
    !EXTENDED_QUALITY[quality] ||
    Boolean(
      EXTENDED_QUALITY[quality][
        { netease: "level", qq: "qqQuality", kugou: "kgQuality" }[platform]
      ],
    )
  );
}
export const QQ_FILES = {
  hires: "RS01",
  master: "AI00",
  spatial: "Q000",
  surround: "Q001",
};

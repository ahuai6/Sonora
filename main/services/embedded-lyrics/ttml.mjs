import { SaxesParser } from "saxes";

const TT = "http://www.w3.org/ns/ttml";
const TTM = TT + "#metadata";
const TTS = TT + "#styling";
const APPLE = "http://music.apple.com/lyric-ttml-internal";
const XML = "http://www.w3.org/XML/1998/namespace";

function xmlTree(text) {
  const parser = new SaxesParser({ xmlns: true, position: true });
  let root;
  const stack = [];
  parser.on("doctype", () => {
    throw new Error("TTML 包含文档类型声明，无法安全解析。");
  });
  parser.on("opentag", (tag) => {
    if (stack.length > 96) throw new Error("TTML 嵌套层数超出限制。");
    const openEnd = parser.position;
    const parent = stack.at(-1);
    const element = {
      tag,
      start: text.lastIndexOf("<", openEnd - 1),
      openEnd,
      close: openEnd,
      end: openEnd,
      parent,
      children: [],
    };
    if (parent) parent.children.push(element);
    else root = element;
    stack.push(element);
  });
  const append = (value) => stack.at(-1)?.children.push(value);
  parser.on("text", append);
  parser.on("cdata", append);
  parser.on("closetag", (tag) => {
    const element = stack.pop();
    element.end = parser.position;
    element.close = tag.isSelfClosing
      ? element.openEnd - 2
      : text.lastIndexOf("<", element.end - 1);
  });
  parser.write(text).close();
  if (
    !root ||
    root.tag.local !== "tt" ||
    (root.tag.uri && root.tag.uri !== TT)
  ) {
    throw new Error("该字段没有可识别的 TTML 根元素。");
  }
  return root;
}

function attr(element, name, namespace = "") {
  return Object.values(element.tag.attributes).find(
    (value) => value.local === name && value.uri === namespace,
  )?.value;
}

function elements(element) {
  return element.children.filter((child) => typeof child !== "string");
}

function child(element, name, uri) {
  return elements(element).find(
    (item) => item.tag.local === name && item.tag.uri === uri,
  );
}

function role(element) {
  return attr(element, "role", TTM) ?? attr(element, "role");
}

function auxiliary(element) {
  return (
    ["x-translation", "x-roman", "x-romanization", "x-bg"].includes(
      role(element) ?? "",
    ) ||
    ["text", "textContainer", "delimiter"].includes(
      attr(element, "ruby", TTS) ?? "",
    )
  );
}

function lyricText(element) {
  return element.children
    .map((item) =>
      typeof item === "string"
        ? item
        : auxiliary(item)
          ? ""
          : item.tag.local === "br"
            ? "\n"
            : lyricText(item),
    )
    .join("");
}

function milliseconds(value) {
  if (!value) return null;
  const unit = value.match(/^(\d+(?:\.\d+)?)(h|m|s|ms)$/);
  if (unit)
    return Number(unit[1]) * { h: 3600000, m: 60000, s: 1000, ms: 1 }[unit[2]];
  if (!/^(?:\d+:)?\d+:[0-5]\d(?:\.\d+)?$/.test(value)) return null;
  return (
    value.split(":").reduce((seconds, part) => seconds * 60 + Number(part), 0) *
    1000
  );
}

function timedWords(element, lineStart) {
  const words = [];
  function visit(node) {
    for (const item of node.children) {
      if (typeof item === "string")
        words.push({ text: item.replace(/[\r\n]+/g, " ") });
      else if (!auxiliary(item)) {
        const start = milliseconds(attr(item, "begin"));
        if (item.tag.local === "br") words.push({ text: " " });
        else if (item.tag.local === "span" && start !== null) {
          const offset =
            lineStart !== null && start < lineStart ? lineStart : 0;
          const end = milliseconds(attr(item, "end"));
          const plain = lyricText(item).replace(/[\r\n]+/g, " ");
          if (plain)
            words.push({
              text: plain,
              start: start + offset,
              end: end === null ? undefined : end + offset,
            });
        } else visit(item);
      }
    }
  }
  visit(element);
  return words.some((word) => word.start !== undefined) ? words : undefined;
}

function normalizedLanguage(value) {
  const tag = value.toLowerCase();
  if (/^zh-(hans|cn|sg)(-|$)/.test(tag)) return "zh-hans";
  if (/^zh-(hant|tw|hk|mo)(-|$)/.test(tag)) return "zh-hant";
  return tag;
}

export function readTtml(text) {
  const root = xmlTree(text);
  const uri = root.tag.uri;
  const head = child(root, "head", uri);
  const metadata = head && child(head, "metadata", uri);
  const apple = metadata && child(metadata, "iTunesMetadata", APPLE);
  const translations = apple && child(apple, "translations", APPLE);
  const body = child(root, "body", uri);
  if (!body) throw new Error("TTML 中没有 body 歌词区。");
  const entries = [];
  const keyCounts = new Map();
  let index = 0;
  function add(element, id, key, section, voice, start, backgroundIndex) {
    const plain = lyricText(element)
      .replace(/[\r\n]+/g, " ")
      .trim();
    if (!plain) return;
    const startMs = milliseconds(start);
    const entry = {
      element,
      key,
      background: backgroundIndex !== undefined,
      line: {
        id,
        time: start ?? "",
        milliseconds: startMs,
        text: plain,
        words: timedWords(element, startMs),
        section,
        voice,
      },
      existing: new Map(),
    };
    for (const node of elements(element).filter(
      (item) => role(item) === "x-translation",
    )) {
      const language = attr(node, "lang", XML) || "und";
      const value = lyricText(node).trim();
      if (value)
        entry.existing.set(normalizedLanguage(language), {
          node,
          value,
          apple: false,
        });
    }
    if (key && translations) {
      for (const track of elements(translations).filter(
        (item) => item.tag.local === "translation" && item.tag.uri === APPLE,
      )) {
        const linked = elements(track).find(
          (item) =>
            item.tag.local === "text" &&
            item.tag.uri === APPLE &&
            attr(item, "for") === key,
        );
        const node =
          linked &&
          (backgroundIndex === undefined
            ? linked
            : elements(linked).filter((item) => role(item) === "x-bg")[
                backgroundIndex
              ]);
        const value = node && lyricText(node).trim();
        if (value && node)
          entry.existing.set(
            normalizedLanguage(attr(track, "lang", XML) || "und"),
            { node, value, apple: true },
          );
      }
    }
    if (entry.existing.size) {
      entry.line.translations = Object.fromEntries(
        [...entry.existing].map(([language, item]) => [language, item.value]),
      );
      [entry.line.existingLanguage, entry.line.existing] = Object.entries(
        entry.line.translations,
      )[0];
    }
    entries.push(entry);
  }
  function visit(element, part) {
    const section = attr(element, "song-part", APPLE) ?? part;
    if (element.tag.local === "p" && element.tag.uri === uri) {
      const id = "p" + ++index;
      const key = attr(element, "key", APPLE);
      if (key) keyCounts.set(key, (keyCounts.get(key) ?? 0) + 1);
      const voice = attr(element, "agent", TTM);
      const start = attr(element, "begin");
      add(element, id, key, section, voice, start);
      elements(element)
        .filter((item) => role(item) === "x-bg")
        .forEach((item, i) => {
          add(
            item,
            id + "b" + (i + 1),
            key,
            section,
            "背景人声" + (voice ? " · " + voice : ""),
            attr(item, "begin") ?? start,
            i,
          );
        });
      return;
    }
    for (const node of elements(element)) visit(node, section);
  }
  visit(body);
  return {
    root,
    head,
    metadata,
    apple,
    translations,
    body,
    entries,
    keyCounts,
    lines: entries.map((entry) => entry.line),
  };
}

function escape(text) {
  return text
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

function innerTag(node, name) {
  return node.tag.prefix ? node.tag.prefix + ":" + name : name;
}

export function writeTtml(text, request) {
  const {
    root,
    head,
    metadata,
    apple,
    translations,
    body,
    entries,
    keyCounts,
  } = readTtml(text);
  const lang = escape(request.language);
  const language = normalizedLanguage(request.language);
  const useApple = Boolean(apple || entries.some((entry) => entry.key));
  const existingTrack =
    translations &&
    elements(translations).find(
      (item) =>
        item.tag.uri === APPLE &&
        item.tag.local === "translation" &&
        normalizedLanguage(attr(item, "lang", XML) ?? "") === language,
    );
  const patches = new Map();
  function patch(start, end, content) {
    if (start === end && !content) return;
    const previous = patches.get(start);
    if (previous && previous.end === end && start === end)
      previous.content += content;
    else if (previous) throw new Error("TTML 的翻译位置有冲突。");
    else patches.set(start, { end, content });
  }
  function append(parent, content) {
    if (parent.tag.isSelfClosing) {
      patch(
        parent.close,
        parent.end,
        ">" + content + "</" + parent.tag.name + ">",
      );
    } else patch(parent.close, parent.close, content);
  }
  const appleEntries = new Map();
  for (const entry of entries) {
    const translation = request.translations[entry.line.id]?.trim();
    if (!translation) continue;
    const value = escape(translation);
    const existing = entry.existing.get(language);
    if (existing) {
      if (!request.overwrite || translation === existing.value) continue;
      if (existing.apple && (!entry.key || keyCounts.get(entry.key) !== 1)) {
        throw new Error("TTML 中有重复的行键，无法单独替换该译文。");
      }
      const original = existing.node;
      if (original.tag.isSelfClosing) append(original, value);
      else {
        const background = elements(original).filter(
          (item) => role(item) === "x-bg",
        );
        let start = original.openEnd;
        let replacement = value;
        for (const node of background) {
          patch(start, node.start, replacement);
          start = node.end;
          replacement = "";
        }
        patch(start, original.close, replacement);
      }
      continue;
    }
    const singleBackground =
      entry.background &&
      entry.element.parent &&
      elements(entry.element.parent).filter((item) => role(item) === "x-bg")
        .length === 1;
    if (
      useApple &&
      (!entry.background || singleBackground) &&
      entry.key &&
      keyCounts.get(entry.key) === 1
    ) {
      const item = appleEntries.get(entry.key) ?? {};
      if (entry.background) item.background = value;
      else item.main = value;
      appleEntries.set(entry.key, item);
    } else {
      const tag = innerTag(entry.element, "span");
      append(
        entry.element,
        "<" +
          tag +
          ' xmlns:syncc="' +
          TTM +
          '" syncc:role="x-translation" xml:lang="' +
          lang +
          '">' +
          value +
          "</" +
          tag +
          ">",
      );
    }
  }
  const appleLines = [];
  for (const [key, value] of appleEntries) {
    const parent = existingTrack ?? translations ?? apple;
    const tag = parent ? innerTag(parent, "text") : "text";
    const span =
      '<span xmlns="' +
      TT +
      '" xmlns:syncc="' +
      TTM +
      '" syncc:role="x-bg">' +
      value.background +
      "</span>";
    const background = value.background ? span : "";
    const previous =
      existingTrack &&
      elements(existingTrack).find(
        (item) =>
          item.tag.local === "text" &&
          item.tag.uri === APPLE &&
          attr(item, "for") === key,
      );
    if (previous?.tag.isSelfClosing)
      append(previous, (value.main ?? "") + background);
    else if (previous) {
      if (value.main) patch(previous.openEnd, previous.openEnd, value.main);
      if (background) append(previous, background);
    } else
      appleLines.push(
        "<" +
          tag +
          ' for="' +
          escape(key) +
          '">' +
          (value.main ?? "") +
          background +
          "</" +
          tag +
          ">",
      );
  }
  if (appleLines.length) {
    const values = appleLines.join("");
    if (existingTrack) append(existingTrack, values);
    else {
      const node = translations ?? apple;
      const tag = node ? innerTag(node, "translation") : "translation";
      const block =
        "<" +
        tag +
        ' type="subtitle" xml:lang="' +
        lang +
        '">' +
        values +
        "</" +
        tag +
        ">";
      if (translations) append(translations, block);
      else if (apple) {
        const wrapper = innerTag(apple, "translations");
        append(apple, "<" + wrapper + ">" + block + "</" + wrapper + ">");
      } else {
        const appleBlock =
          '<iTunesMetadata xmlns="' +
          APPLE +
          '"><translations>' +
          block +
          "</translations></iTunesMetadata>";
        const metaTag = innerTag(root, "metadata");
        const headTag = innerTag(root, "head");
        if (metadata) append(metadata, appleBlock);
        else if (head)
          append(head, "<" + metaTag + ">" + appleBlock + "</" + metaTag + ">");
        else
          patch(
            body.start,
            body.start,
            "<" +
              headTag +
              "><" +
              metaTag +
              ">" +
              appleBlock +
              "</" +
              metaTag +
              "></" +
              headTag +
              ">",
          );
      }
    }
  }
  let result = text;
  for (const [start, { end, content }] of [...patches].sort(
    ([a], [b]) => b - a,
  )) {
    result = result.slice(0, start) + content + result.slice(end);
  }
  readTtml(result);
  return result;
}

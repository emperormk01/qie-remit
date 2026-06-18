// Telegram MarkdownV2 format converter (ported from AuxloNeo's src/channels/markdown.ts)
// Escapes Telegram MarkdownV2 special characters while preserving code/bold/italic/links.

const MARKDOWN_V2_SPECIALS = new Set([
  "_", "*", "[", "]", "(", ")", "~", "`", ">", "#", "+", "-", "=", "|", "{", "}", ".", "!",
]);

export function markdownToTelegram(text: string): string {
  return convertInner(text);
}

function convertInner(text: string): string {
  let out = "";
  let i = 0;
  while (i < text.length) {
    const rest = text.slice(i);

    if (rest.startsWith("```")) {
      const close = rest.indexOf("```", 3);
      if (close !== -1) {
        out += "`".repeat(3) + escapeCode(rest.slice(3, close)) + "`".repeat(3);
        i += close + 3;
        continue;
      }
    }

    if (rest[0] === "`") {
      const close = rest.indexOf("`", 1);
      if (close !== -1) {
        out += "`" + escapeCode(rest.slice(1, close)) + "`";
        i += close + 1;
        continue;
      }
    }

    if (rest.startsWith("**")) {
      const close = rest.indexOf("**", 2);
      if (close !== -1) {
        out += "*" + convertInner(rest.slice(2, close)) + "*";
        i += close + 2;
        continue;
      }
    }

    if (rest[0] === "*" && !rest.startsWith("**")) {
      const close = rest.indexOf("*", 1);
      if (close !== -1) {
        const inner = rest.slice(1, close);
        if (inner.trim()) {
          out += "_" + convertInner(inner) + "_";
          i += close + 1;
          continue;
        }
      }
    }

    if (rest[0] === "_" && !rest.startsWith("__")) {
      const close = rest.indexOf("_", 1);
      if (close !== -1) {
        const inner = rest.slice(1, close);
        if (inner.trim()) {
          out += "_" + convertInner(inner) + "_";
          i += close + 1;
          continue;
        }
      }
    }

    if (rest[0] === "[") {
      const textEnd = rest.indexOf("]");
      if (textEnd !== -1 && rest[textEnd + 1] === "(") {
        const urlEnd = rest.indexOf(")", textEnd + 2);
        if (urlEnd !== -1) {
          out += "[" + escapeMarkdownV2(rest.slice(1, textEnd)) + "](" + escapeUrl(rest.slice(textEnd + 2, urlEnd)) + ")";
          i += urlEnd + 1;
          continue;
        }
      }
    }

    const ch = text[i];
    if (MARKDOWN_V2_SPECIALS.has(ch)) out += "\\";
    out += ch;
    i++;
  }
  return out;
}

function escapeMarkdownV2(text: string): string {
  let out = "";
  for (const ch of text) {
    if (MARKDOWN_V2_SPECIALS.has(ch)) out += "\\";
    out += ch;
  }
  return out;
}

function escapeCode(text: string): string {
  let out = "";
  for (const ch of text) {
    if (ch === "`") out += "\\`";
    else if (ch === "\\") out += "\\\\";
    else out += ch;
  }
  return out;
}

function escapeUrl(url: string): string {
  let out = "";
  for (const ch of url) {
    if (ch === ")") out += "\\)";
    else if (ch === "\\") out += "\\\\";
    else out += ch;
  }
  return out;
}

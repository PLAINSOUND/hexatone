import manualMarkdown from "../../usermanual.md?raw";

function escapeHtml(text) {
  return text
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;");
}

function parseInline(text) {
  let html = escapeHtml(text);
  html = html.replace(/`([^`]+)`/g, "<code>$1</code>");
  html = html.replace(/\[([^\]]+)\]\(([^)]+)\)/g, '<a href="$2">$1</a>');
  html = html.replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>");
  html = html.replace(/\*([^*]+)\*/g, "<em>$1</em>");
  return html;
}

export function slugify(text) {
  return text
    .toLowerCase()
    .replace(/<[^>]+>/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

function manualId(text) {
  return `manual-${slugify(text)}`;
}

function renderTable(lines) {
  const rows = lines
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) =>
      line
        .replace(/^\|/, "")
        .replace(/\|$/, "")
        .split("|")
        .map((cell) => cell.trim()),
    );

  if (rows.length < 2) return "";
  const [header, , ...body] = rows;
  const thead = `<thead><tr>${header.map((cell) => `<th>${parseInline(cell)}</th>`).join("")}</tr></thead>`;
  const tbody = `<tbody>${body
    .map((row) => `<tr>${row.map((cell) => `<td>${parseInline(cell)}</td>`).join("")}</tr>`)
    .join("")}</tbody>`;
  return `<table>${thead}${tbody}</table>`;
}

export function parseMarkdown(md) {
  const lines = md.replace(/\r\n/g, "\n").split("\n");
  let i = 0;
  let html = "";
  let paragraph = [];

  const flushParagraph = () => {
    if (!paragraph.length) return;
    html += `<p>${parseInline(paragraph.join(" "))}</p>`;
    paragraph = [];
  };

  const parseList = (startIndex, ordered, baseIndent = null) => {
    const tag = ordered ? "ol" : "ul";
    let output = `<${tag}>`;
    let index = startIndex;
    let activeLi = false;
    const itemPattern = ordered ? /^(\s*)(\d+)\.\s+(.*)$/ : /^(\s*)-\s+(.*)$/;

    while (index < lines.length) {
      const line = lines[index];
      if (!line.trim()) break;
      const match = line.match(itemPattern);
      if (!match) break;

      const indent = match[1].length;
      const content = ordered ? match[3] : match[2];
      if (baseIndent === null) baseIndent = indent;
      if (indent < baseIndent) break;

      if (indent > baseIndent) {
        if (!activeLi) break;
        const nestedOrdered = /^\s*\d+\.\s+/.test(line);
        const nested = parseList(index, nestedOrdered, indent);
        output += nested.html;
        index = nested.nextIndex;
        continue;
      }

      if (activeLi) output += "</li>";
      output += `<li>${parseInline(content)}`;
      activeLi = true;
      index += 1;
    }

    if (activeLi) output += "</li>";
    output += `</${tag}>`;
    return { html: output, nextIndex: index };
  };

  while (i < lines.length) {
    const line = lines[i];
    const trimmed = line.trim();

    if (!trimmed) {
      flushParagraph();
      i += 1;
      continue;
    }

    if (trimmed.startsWith("```")) {
      flushParagraph();
      const codeLines = [];
      i += 1;
      while (i < lines.length && !lines[i].trim().startsWith("```")) {
        codeLines.push(lines[i]);
        i += 1;
      }
      html += `<pre><code>${escapeHtml(codeLines.join("\n"))}</code></pre>`;
      i += 1;
      continue;
    }

    if (
      /^\|.*\|$/.test(trimmed) &&
      i + 1 < lines.length &&
      /^\|\s*[-:| ]+\|$/.test(lines[i + 1].trim())
    ) {
      flushParagraph();
      const tableLines = [lines[i], lines[i + 1]];
      i += 2;
      while (i < lines.length && /^\|.*\|$/.test(lines[i].trim())) {
        tableLines.push(lines[i]);
        i += 1;
      }
      html += renderTable(tableLines);
      continue;
    }

    if (/^---+$/.test(trimmed)) {
      flushParagraph();
      html += "<hr />";
      i += 1;
      continue;
    }

    const heading = trimmed.match(/^(#{1,3})\s+(.*)$/);
    if (heading) {
      flushParagraph();
      const level = heading[1].length;
      const content = parseInline(heading[2]);
      const id = manualId(content);
      html += `<h${level} id="${id}">${content}</h${level}>`;
      i += 1;
      continue;
    }

    if (/^\d+\.\s+/.test(trimmed)) {
      flushParagraph();
      const list = parseList(i, true);
      html += list.html;
      i = list.nextIndex;
      continue;
    }

    if (/^-\s+/.test(trimmed)) {
      flushParagraph();
      const list = parseList(i, false);
      html += list.html;
      i = list.nextIndex;
      continue;
    }

    paragraph.push(trimmed);
    i += 1;
  }

  flushParagraph();
  return html;
}

export function getManualSections(md = manualMarkdown) {
  const lines = md.replace(/\r\n/g, "\n").split("\n");
  const sections = [];
  let title = "User Manual";
  let updated = "";
  let current = null;

  for (let i = 0; i < lines.length; i += 1) {
    const line = lines[i];
    if (line.startsWith("# ")) {
      title = line.slice(2).trim();
      continue;
    }
    if (!updated && line.startsWith("Updated:")) {
      updated = line.trim();
      continue;
    }
    if (line.startsWith("## ")) {
      if (current) {
        current.html = parseMarkdown(current.lines.join("\n"));
        sections.push(current);
      }
      const heading = line.slice(3).trim();
      current = { title: heading, id: manualId(heading), lines: [] };
      continue;
    }
    if (current) current.lines.push(line);
  }

  if (current) {
    current.html = parseMarkdown(current.lines.join("\n"));
    sections.push(current);
  }

  return { title, updated, sections };
}

export { manualMarkdown, escapeHtml };

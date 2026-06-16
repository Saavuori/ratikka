const fs = require('fs');
const path = require('path');

const mdPath = path.join(__dirname, '../CHANGELOG.md');
const templatePath = path.join(__dirname, 'changelog-template.html');
const outDir = path.join(__dirname, '../dist-changelog');
const outPath = path.join(outDir, 'index.html');

if (!fs.existsSync(mdPath)) {
  console.error('CHANGELOG.md not found');
  process.exit(1);
}
if (!fs.existsSync(templatePath)) {
  console.error('changelog-template.html not found');
  process.exit(1);
}

const markdown = fs.readFileSync(mdPath, 'utf8');
const template = fs.readFileSync(templatePath, 'utf8');

function parseMarkdown(md) {
  // Convert basic HTML entities to avoid layout rendering issues
  let escaped = md
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');

  const lines = escaped.split('\n');
  const result = [];
  let inList = false;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trim();

    // Horizontal Rule
    if (line === '---') {
      if (inList) { result.push('</ul>'); inList = false; }
      result.push('<hr />');
      continue;
    }

    // Headings
    if (line.startsWith('# ')) {
      // Skip the main H1 header as it is already provided by the template <header>
      continue;
    }
    if (line.startsWith('## ')) {
      if (inList) { result.push('</ul>'); inList = false; }
      const headingText = line.substring(3);
      // Match versions like [v1.0.0] - 2026-06-16 to wrap version in a styled tag
      const versionMatch = headingText.match(/\[(.*?)\]\s*-\s*(.*)/);
      if (versionMatch) {
        result.push(`<div class="version-header"><h2><span class="version-tag">${versionMatch[1]}</span> <span class="version-date">${versionMatch[2]}</span></h2></div>`);
      } else {
        result.push(`<h2>${headingText}</h2>`);
      }
      continue;
    }
    if (line.startsWith('### ')) {
      if (inList) { result.push('</ul>'); inList = false; }
      const subHeadingText = line.substring(4);
      // Give semantic category styling (Added / Fixed / Changed / etc.)
      const catClass = subHeadingText.toLowerCase();
      result.push(`<h3 class="category-${catClass}">${subHeadingText}</h3>`);
      continue;
    }

    // List Items
    if (line.startsWith('- ') || line.startsWith('* ')) {
      if (!inList) {
        result.push('<ul>');
        inList = true;
      }
      const content = parseInline(line.substring(2));
      result.push(`  <li>${content}</li>`);
      continue;
    }

    // Blank line closes lists
    if (line === '') {
      if (inList) {
        result.push('</ul>');
        inList = false;
      }
      continue;
    }

    // Paragraph text fallback
    if (inList) {
      result.push('</ul>');
      inList = false;
    }
    result.push(`<p>${parseInline(line)}</p>`);
  }

  if (inList) {
    result.push('</ul>');
  }

  return result.join('\n');
}

function parseInline(text) {
  return text
    // Bold: **text**
    .replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>')
    // Inline Code: `code`
    .replace(/`(.*?)`/g, '<code>$1</code>')
    // Markdown Links: [label](url)
    .replace(/\[(.*?)\]\((.*?)\)/g, '<a href="$2" target="_blank" rel="noopener noreferrer">$1</a>');
}

const parsedContent = parseMarkdown(markdown);
const buildDate = new Date().toISOString().split('T')[0];
const finalHtml = template
  .replace('{{CONTENT}}', parsedContent)
  .replace('{{BUILD_DATE}}', buildDate);

if (!fs.existsSync(outDir)) {
  fs.mkdirSync(outDir, { recursive: true });
}

fs.writeFileSync(outPath, finalHtml, 'utf8');
console.log('Changelog generated successfully at:', outPath);

// Rebuild clipboard HTML from an allowlist. Never insert source attributes,
// links, images, scripts or layout CSS into the editor or presentation.
export function sanitizeInstructionHtml(html: string): string {
  const source = new DOMParser().parseFromString(html, 'text/html');
  const output = document.createElement('div');
  const allowed = new Set(['P', 'DIV', 'BR', 'SPAN', 'B', 'STRONG', 'I', 'EM', 'U', 'S', 'UL', 'OL', 'LI']);
  const blocked = new Set(['SCRIPT', 'STYLE', 'IFRAME', 'OBJECT', 'EMBED', 'SVG', 'MATH', 'TEMPLATE']);
  function copy(node: Node, parent: HTMLElement) {
    if (node.nodeType === Node.TEXT_NODE) { parent.appendChild(document.createTextNode(node.textContent || '')); return; }
    if (!(node instanceof HTMLElement) || blocked.has(node.tagName)) return;
    // Google wraps clipboard fragments in <b style="font-weight:normal">.
    const tag = allowed.has(node.tagName) ? node.tagName.toLowerCase() : 'span';
    const clean = document.createElement(tag);
    const style = node.style;
    if (style.color) clean.style.color = style.color;
    if (/^(normal|bold|[1-9]00)$/.test(style.fontWeight)) clean.style.fontWeight = style.fontWeight;
    if (/^(normal|italic)$/.test(style.fontStyle)) clean.style.fontStyle = style.fontStyle;
    const decoration = style.textDecorationLine || style.textDecoration;
    if (/^(none|underline|line-through|underline line-through)$/.test(decoration)) clean.style.textDecoration = decoration;
    if (/^(disc|circle|square|decimal|lower-alpha|upper-alpha|lower-roman|upper-roman)$/.test(style.listStyleType)) clean.style.listStyleType = style.listStyleType;
    if (tag === 'ol' && /^\d{1,6}$/.test(node.getAttribute('start') || '')) clean.setAttribute('start', node.getAttribute('start')!);
    if (tag === 'li' && /^\d{1,6}$/.test(node.getAttribute('value') || '')) clean.setAttribute('value', node.getAttribute('value')!);
    // Legacy font colors can also appear in browser clipboard fragments.
    if (node.tagName === 'FONT' && node.getAttribute('color')) clean.style.color = node.getAttribute('color')!;
    for (const child of Array.from(node.childNodes)) copy(child, clean);
    parent.appendChild(clean);
  }
  for (const child of Array.from(source.body.childNodes)) copy(child, output);
  return output.innerHTML;
}

export function plainInstructionHtml(text: string): string {
  const element = document.createElement('div');
  element.textContent = text;
  return element.innerHTML.replace(/\r?\n/g, '<br>');
}

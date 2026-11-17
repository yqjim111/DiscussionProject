'use client';

import { useEffect, useRef } from 'react';
import { plainInstructionHtml, sanitizeInstructionHtml } from '@/lib/instructionRichText';

export function InstructionEditor({ text, html = '', onChange, fontSize }: {
  text: string; html?: string; onChange: (text: string, html: string) => void; fontSize?: number;
}) {
  const editor = useRef<HTMLDivElement>(null);
  // Initialize on mount only: replacing innerHTML while typing loses the caret.
  const initial = useRef({ text, html });
  useEffect(() => {
    if (editor.current) editor.current.innerHTML = initial.current.html
      ? sanitizeInstructionHtml(initial.current.html) : plainInstructionHtml(initial.current.text);
  }, []);
  function changed() {
    if (editor.current) onChange(editor.current.innerText, sanitizeInstructionHtml(editor.current.innerHTML));
  }
  return <div>
    <div ref={editor} role="textbox" aria-label="Discussion Instructions" aria-multiline="true" tabIndex={0}
      contentEditable suppressContentEditableWarning className="instruction-rich-text instruction-editor" style={{ fontSize }}
      onInput={changed} onPaste={event => {
        event.preventDefault();
        const html = event.clipboardData.getData('text/html');
        document.execCommand('insertHTML', false, html ? sanitizeInstructionHtml(html) : plainInstructionHtml(event.clipboardData.getData('text/plain')));
        changed();
      }} onDrop={event => event.preventDefault()} />
    <p className="text-sm font-normal tracking-normal text-gray-500">Paste formatted text from Google Slides. Bold, lists, colors and underline are preserved. {text.length}/5000 characters</p>
    {(text.length > 5000 || html.length > 100000) && <p role="alert" className="text-sm text-red-700">Instructions are too long. Shorten them before saving.</p>}
  </div>;
}

export function InstructionText({ text, html }: { text: string; html?: string }) {
  const target = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (target.current) target.current.innerHTML = html ? sanitizeInstructionHtml(html) : plainInstructionHtml(text);
  }, [text, html]);
  return <div ref={target} className="instruction-body instruction-rich-text">{text}</div>;
}

// Run with PLAYWRIGHT_MODULE pointing to Playwright if it is not installed locally.
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'playwright');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const ts = require('typescript');
const root = path.resolve(__dirname, '../..');
const compile = file => ts.transpileModule(fs.readFileSync(path.join(root, file), 'utf8'), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020, jsx: ts.JsxEmit.React }
}).outputText;

(async () => {
  const browser = await chromium.launch({ channel: 'msedge', headless: true });
  try {
    const page = await browser.newPage();
    await page.setContent('<div id="root"></div>');
    await page.addScriptTag({ path: path.join(path.dirname(require.resolve('react')), 'umd/react.development.js') });
    await page.addScriptTag({ path: path.join(path.dirname(require.resolve('react-dom')), 'umd/react-dom.development.js') });
    await page.addScriptTag({ content: `window.exports = {}; ${compile('lib/instructionRichText.ts')}; window.rich = exports;` });
    await page.addScriptTag({ content: `window.exports = {}; window.require = id => id === 'react' ? React : rich; ${compile('components/InstructionRichText.tsx')}; window.components = exports;` });
    await page.addStyleTag({ content: 'ul,ol {list-style:none;padding:0} b,strong {font-weight:bolder}' });
    await page.addStyleTag({ content: fs.readFileSync(path.join(root, 'app/globals.css'), 'utf8').replace(/@tailwind[^;]+;/g, '') });
    await page.evaluate(() => {
      window.app = ReactDOM.createRoot(document.getElementById('root'));
      window.saved = { text: '', html: '' };
      app.render(React.createElement(components.InstructionEditor, { text: '', onChange: (text, html) => { window.saved = { text, html }; } }));
    });
    const editor = page.getByRole('textbox');
    await editor.focus();
    const fragment = '<b style="font-weight:normal"><ul><li><span style="font-weight:700">Role Assignment</span><ul><li>Facilitator<ul><li>Duty</li></ul></li></ul></li><li><span style="color:rgb(255,78,20);font-weight:700;text-decoration:underline">Prompt</span></li></ul></b>';
    await editor.evaluate((element, html) => {
      const data = new DataTransfer(); data.setData('text/html', html); data.setData('text/plain', 'Role Assignment Facilitator Duty Prompt');
      element.dispatchEvent(new ClipboardEvent('paste', { clipboardData: data, bubbles: true, cancelable: true }));
    }, fragment);
    const saved = await page.evaluate(() => window.saved);
    assert.match(saved.html, /font-weight: 700/);
    assert.match(saved.text, /Facilitator/);
    await page.evaluate(() => app.render(React.createElement(components.InstructionText, saved)));
    await page.waitForSelector('.instruction-body li ul li ul li');
    const presentation = await page.evaluate(() => {
      const target = document.querySelector('.instruction-body');
      const spans = [...target.querySelectorAll('span')];
      const prompt = spans.find(node => node.textContent === 'Prompt');
      const bold = spans.find(node => node.textContent === 'Role Assignment');
      return { color: getComputedStyle(prompt).color, bold: getComputedStyle(bold).fontWeight,
        underline: getComputedStyle(prompt).textDecorationLine,
        markers: [...target.querySelectorAll('ul')].map(node => getComputedStyle(node).listStyleType) };
    });
    assert.equal(presentation.color, 'rgb(255, 78, 20)');
    assert.equal(presentation.bold, '700');
    assert.equal(presentation.underline, 'underline');
    assert.deepEqual(presentation.markers, ['disc', 'circle', 'square']);
    await page.evaluate(() => app.render(React.createElement(components.InstructionEditor, { ...saved, onChange: () => {} })));
    await page.waitForSelector('[contenteditable] li ul li ul li');
    assert.equal(await editor.locator('li').count(), 4);
    const roundTrip = await page.evaluate(() => rich.sanitizeInstructionHtml(rich.sanitizeInstructionHtml(saved.html)));
    assert.equal(roundTrip, saved.html, 'Repeated edits preserve the same formatting');
    const safe = await page.evaluate(() => rich.sanitizeInstructionHtml('<script>alert(1)</script><img src=x onerror="alert(1)"><svg onload="alert(1)"></svg><span onclick="alert(1)" style="position:fixed;color:red;background:url(x)">safe</span>'));
    assert.doesNotMatch(safe, /script|img|svg|onclick|onerror|onload|position|background/);
    assert.match(safe, /color: red/);
    const plain = await page.evaluate(() => rich.plainInstructionHtml('<b>literal</b>\nSecond line'));
    assert.equal(plain, '&lt;b&gt;literal&lt;/b&gt;<br>Second line');
    await editor.focus();
    await page.keyboard.press('ControlOrMeta+A');
    await editor.evaluate(element => {
      const data = new DataTransfer(); data.setData('text/plain', '<b>literal</b>\nSecond line');
      element.dispatchEvent(new ClipboardEvent('paste', { clipboardData: data, bubbles: true, cancelable: true }));
    });
    assert.match(await editor.innerText(), /<b>literal<\/b>/);
    assert.equal(await editor.locator('b').count(), 0);
    console.log('PASS: formatted paste, nested bullets, bold, color, underline, reopen, sanitization and plain text');
  } finally { await browser.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });

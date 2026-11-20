'use strict';
function transcriptionDownload(session) {
  const parts = ['Discussion ' + session.room.code + ' — Original transcriptions'];
  for (const [index, group] of session.groups.entries()) {
    const name = String(group.name || '').replace(/[\r\n]+/g, ' ');
    const members = (group.members || []).map(n => String(n).replace(/[\r\n]+/g, ' ')).join(', ');
    parts.push('G' + (index + 1) + ' · ' + name + (members ? ' · ' + members : '') + '\n\n' + (group.transcript || ''));
  }
  return '\ufeff' + parts.join('\n\n────────────────────────────────────────\n\n');
}
module.exports = { transcriptionDownload };

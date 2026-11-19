"""Recover exact text nodes from the uploaded HTML appendix, not flattened Markdown."""
import json
import re
import sys
import uuid
import zipfile
from html.parser import HTMLParser
from pathlib import Path


class AppendixParser(HTMLParser):
    def __init__(self):
        super().__init__(convert_charrefs=True)
        self.stack = []
        self.groups = []
        self.current = None

    def handle_starttag(self, tag, attrs):
        attrs = dict(attrs)
        classes = attrs.get('class', '').split()
        if 'transcript-group' in classes:
            self.current = {'id': str(uuid.uuid5(uuid.NAMESPACE_URL, 'discussion:520123:group:' + str(len(self.groups) + 1))),
                            'name': '', 'members': [], 'transcript': '', 'manualPoints': []}
            self.groups.append(self.current)
        field = None
        if self.current:
            if tag == 'h3': field = 'name'
            elif 'transcript-text' in classes: field = 'transcript'
            elif tag == 'p': field = 'members'
            elif tag == 'li': field = 'manual'
        self.stack.append((tag, field, []))
        if tag in ('meta', 'link', 'img', 'br', 'input', 'hr'):
            self.stack.pop()

    def handle_data(self, data):
        for _, field, parts in self.stack:
            if field: parts.append(data)

    def handle_endtag(self, tag):
        while self.stack:
            current_tag, field, parts = self.stack.pop()
            value = ''.join(parts)
            if self.current and field:
                if field == 'name': self.current['name'] = re.sub(r'^Group \d+: ', '', value)
                elif field == 'members': self.current['members'] = [x.strip() for x in value.removeprefix('Members:').split(',') if x.strip()]
                elif field == 'transcript': self.current['transcript'] = '' if value == 'No transcription recorded for this group.' else value
                elif field == 'manual': self.current['manualPoints'].append({'id': str(uuid.uuid5(uuid.NAMESPACE_URL, self.current['id'] + ':note:' + str(len(self.current['manualPoints'])))), 'text': value.removeprefix('• ')})
            if current_tag == tag: break


if __name__ == '__main__':
    with zipfile.ZipFile(sys.argv[1]) as archive:
        html = archive.read('report.html').decode('utf-8')
    parser = AppendixParser()
    parser.feed(html[html.index('transcript-appendix'):])
    if len(parser.groups) != 26: raise ValueError('Expected 26 appendix groups')
    session = {'room': {'code': '520123', 'instructor_name': 'QI', 'teacher_topic': '/',
                        'discussion_instructions': '', 'created_at': None, 'session_date': '2026-11-17'},
               'groups': parser.groups,
               'import_metadata': {'source_zip': Path(sys.argv[1]).name, 'source': 'exact HTML appendix text',
                                   'group_ids': 'Stable import identifiers; original database UUIDs were not exported.',
                                   'analysis_context': 'All positive, negative and conditional discussion rounds; no topic/instruction filtering.'}}
    Path(sys.argv[2]).write_text(json.dumps(session, ensure_ascii=False, indent=2), encoding='utf-8')
    print(json.dumps({'groups': len(parser.groups), 'nonempty_transcripts': sum(bool(g['transcript']) for g in parser.groups),
                      'original_characters': sum(len(g['transcript']) for g in parser.groups)}, ensure_ascii=False))

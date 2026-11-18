"""Turn docs/ClinWrite_Master_Manuscript_Template.docx into a Module B PublicationTemplate JSON.

Usage (from the repo root):
  python -I docs/templates/manuscript_to_json.py docs/ClinWrite_Master_Manuscript_Template.docx docs/templates/manuscript-original-research.template.json

Each numbered Heading 1 becomes a manuscript section (stable id, number, title). Its Heading 2s, placeholders and
table shells become the section's starter HTML; "DRAFTING GUIDANCE" paragraphs become the section's guidance.
Document control maps to publication fields; the QC checklist becomes checklist items.
"""
import html, json, re, sys, zipfile
from xml.etree import ElementTree as ET

sys.stdout.reconfigure(encoding='utf-8')
W = '{http://schemas.openxmlformats.org/wordprocessingml/2006/main}'
src, out = sys.argv[1], sys.argv[2]
z = zipfile.ZipFile(src)
body = ET.fromstring(z.read('word/document.xml')).find(W + 'body')


def text_of(el):
    parts = []
    for n in el.iter():
        if n.tag == W + 't' and n.text: parts.append(n.text)
        elif n.tag == W + 'tab': parts.append(' ')
        elif n.tag in (W + 'br', W + 'cr'): parts.append('\n')
    return re.sub(r'[ \t]+', ' ', ''.join(parts)).strip()


def style_of(p):
    ppr = p.find(W + 'pPr')
    s = ppr.find(W + 'pStyle') if ppr is not None else None
    return s.get(W + 'val') if s is not None else 'Normal'


def table_rows(tbl):
    return [[text_of(tc) for tc in tr.findall(W + 'tc')] for tr in tbl.findall(W + 'tr')]


# Heading-1 number → stable section id. Ids match the IMRAD fallback where they overlap (title, abstract, intro,
# methods, results, discussion, conclusion, references) so AI section rules and footprint spans keep lining up.
IDS = {
    '1': ('title', 'Title page'), '2': ('abstract', 'Abstract'), '3': ('intro', 'Introduction'),
    '4': ('methods', 'Methods'), '5': ('results', 'Results'), '6': ('discussion', 'Discussion'),
    '7': ('conclusion', 'Conclusion'), '8': ('declarations', 'Declarations and publication information'),
    '9': ('references', 'References'), '10': ('tables_figures', 'Tables and figures'),
    '12': ('traceability', 'Drafting traceability log'),
}

meta = {'title': None, 'subtitle': None, 'intendedUse': None, 'templateNote': None}
doc_control = []
checklist = []
sections = []
cur = None          # current section dict
cur_h1 = None       # current Heading 1 text
pending_caption = None

def esc(s): return html.escape(s, quote=False)

for el in body:
    if el.tag == W + 'p':
        t, st = text_of(el), style_of(el)
        if not t: continue
        if st == 'Title': meta['title'] = t; continue
        if st == 'Heading1':
            cur_h1 = t
            m = re.match(r'^(\d+)\.\s+(.*)$', t)
            if m and m.group(1) in IDS:
                sid, title = IDS[m.group(1)]
                cur = {'id': sid, 'number': m.group(1), 'title': title, 'guidance': [], 'html': [], 'internal': sid == 'traceability'}
                sections.append(cur)
            else:
                cur = None
            continue
        if cur_h1 is None:                      # front matter before the first heading
            if t.startswith('MASTER STARTING TEMPLATE'): meta['subtitle'] = t
            elif t.startswith('Intended use:'): meta['intendedUse'] = t.split(':', 1)[1].strip()
            continue
        if t.startswith('Template note:'): meta['templateNote'] = t.split(':', 1)[1].strip(); continue
        if cur_h1.startswith('11.'):            # QC checklist → checklist items
            checklist.append(t.lstrip('☐').strip()); continue
        if cur is None: continue
        if t.startswith('DRAFTING GUIDANCE'):
            cur['guidance'].append(t[len('DRAFTING GUIDANCE'):].strip()); continue
        if st == 'Heading2':
            cur['html'].append(f'<h3>{esc(t)}</h3>'); continue
        if re.match(r'^(Table|Figure) \d+\.', t) and cur['id'] == 'tables_figures' and t.startswith('Table'):
            pending_caption = t; continue
        # "Label: [placeholder]" lines keep the label in bold.
        m = re.match(r'^([A-Z][^:\[\]]{1,60}):\s+(.*)$', t)
        if m and '[' in m.group(2):
            cur['html'].append(f'<p><strong>{esc(m.group(1))}:</strong> {esc(m.group(2))}</p>')
        else:
            cur['html'].append(f'<p>{esc(t)}</p>')
    elif el.tag == W + 'tbl':
        rows = table_rows(el)
        if cur_h1 == 'Document control':
            doc_control = [{'field': r[0], 'placeholder': r[1]} for r in rows[1:]]
            continue
        if cur is None: continue
        head, *rest = rows
        # Table title as a bold line above the table (rich-text editors don't keep <caption>).
        if pending_caption: cur['html'].append(f'<p><strong>{esc(pending_caption)}</strong></p>')
        cap = ''
        pending_caption = None
        thead = '<thead><tr>' + ''.join(f'<th>{esc(c)}</th>' for c in head) + '</tr></thead>'
        tbody = '<tbody>' + ''.join('<tr>' + ''.join(f'<td>{esc(c)}</td>' for c in r) + '</tr>' for r in rest) + '</tbody>'
        cur['html'].append(f'<table>{cap}{thead}{tbody}</table>')

# Document-control fields that already live on the publication record (not template content).
FIELD_MAP = {
    'Manuscript working title': 'publication.title', 'Target journal': 'publication.journal',
    'Applicable reporting guideline': 'publication.guideline', 'Draft version / date': 'publication.version',
    'Status': 'publication.status', 'Medical writer / lead author': 'publication.authors (R)',
    'Source documents': 'publication.sourceDocumentId (+ citations)',
}
for f in doc_control: f['mapsTo'] = FIELD_MAP.get(f['field'])

GROUPS = [  # checklist item → SubmissionCheck group vocabulary
    ('placeholder', 'format'), ('reporting guideline', 'equator'), ('match protocol', 'equator'),
    ('reconciled', 'figures'), ('Numerical consistency', 'figures'), ('Randomization', 'equator'),
    ('Safety denominators', 'figures'), ('Ethics, registration', 'statements'), ('References verified', 'refs'),
    ('Author approval', 'statements'),
]
def group_for(label):
    for key, g in GROUPS:
        if key.lower() in label.lower(): return g
    return 'format'

def slug(s): return re.sub(r'[^a-z0-9]+', '_', s.lower()).strip('_')[:48]

template = {
    'schemaVersion': 1,
    'template': {
        'docType': 'manuscript_original_research',
        'label': 'Original Research Manuscript',
        'description': f"{meta['title']} — master starting template (v1.0). Intended use: {meta['intendedUse']}",
        'guidelineKey': 'CONSORT',
    },
    'provenance': {
        'sourceFile': 'docs/ClinWrite_Master_Manuscript_Template.docx',
        'sourceVersion': meta['subtitle'],
        'note': meta['templateNote'],
        'generatedBy': 'manuscript_to_json.py (sections = numbered Heading 1s; sub-headings, placeholders and table shells = starter HTML)',
    },
    'documentControl': doc_control,
    'sections': [
        {
            'id': s['id'], 'number': s['number'], 'title': s['title'],
            'guidance': ' '.join(s['guidance']) or None,
            'internal': s['internal'] or None,
            'starterHtml': ''.join(s['html']),
        } for s in sections
    ],
    'checklist': [
        {'id': slug(c), 'label': c, 'required': True, 'groupId': group_for(c)} for c in checklist
    ],
}
# Drop nulls for a tidy file.
for s in template['sections']:
    for k in [k for k, v in s.items() if v is None]: del s[k]

with open(out, 'w', encoding='utf-8', newline='\n') as f:
    json.dump(template, f, ensure_ascii=False, indent=2)
    f.write('\n')
print('sections:', [(s['number'], s['id'], len(s['starterHtml'])) for s in template['sections']])
print('checklist items:', len(template['checklist']), '| document-control fields:', len(doc_control))

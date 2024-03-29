import io
import json
from tqdm import tqdm
from lxml import html
from lxml.html.clean import Cleaner

cleaner = Cleaner(page_structure=True,
                  meta=True,
                  embedded=True,
                  links=True,
                  style=True,
                  processing_instructions=True,
                  inline_style=True,
                  scripts=True,
                  javascript=True,
                  comments=True)

with open('../data/pages-raw.jsonl', 'r', 1000000000) as fi:
  fi.seek(0, io.SEEK_END)
  tot = fi.tell()
  fi.seek(0, io.SEEK_SET)
  with tqdm(total = tot) as pbar:
    with open('../data/pages.jsonl', 'w') as fo:
      for l in fi:
        jni = json.loads(l)
        body = jni['body']
        #print(body)
        foo = html.fromstring(body)
        title = ''.join(foo.xpath('//title/text()'))
        cbody = cleaner.clean_html(foo).text_content().strip()
        jno = {
          'id': jni['id'],
          'url': jni['url'],
          'title': title,
          'body': cbody,
        }
        fo.write(json.dumps(jno))
        pbar.update(len(l))
      

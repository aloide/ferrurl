// xml2Json compatible con el de Postman (xml2js, explicitArray:false):
// atributos en "$", texto en "_" cuando hay atributos, elementos repetidos como array.
// Parser propio porque en Web Workers no existe DOMParser.

type Json = string | { [k: string]: unknown };

const ENTITIES: Record<string, string> = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'" };

function decodeEntities(s: string): string {
  return s.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (m, e: string) => {
    if (e[0] === '#') {
      const code = e[1] === 'x' || e[1] === 'X' ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10);
      return Number.isFinite(code) ? String.fromCodePoint(code) : m;
    }
    return ENTITIES[e.toLowerCase()] ?? m;
  });
}

interface Node {
  name: string;
  attrs: Record<string, string>;
  children: Node[];
  text: string;
}

export function parseXml(xml: string): Node {
  const root: Node = { name: '#root', attrs: {}, children: [], text: '' };
  const stack: Node[] = [root];
  let i = 0;
  const n = xml.length;
  while (i < n) {
    const lt = xml.indexOf('<', i);
    if (lt === -1) {
      stack[stack.length - 1].text += decodeEntities(xml.slice(i));
      break;
    }
    if (lt > i) stack[stack.length - 1].text += decodeEntities(xml.slice(i, lt));
    if (xml.startsWith('<!--', lt)) {
      const end = xml.indexOf('-->', lt + 4);
      i = end === -1 ? n : end + 3;
    } else if (xml.startsWith('<![CDATA[', lt)) {
      const end = xml.indexOf(']]>', lt + 9);
      stack[stack.length - 1].text += xml.slice(lt + 9, end === -1 ? n : end);
      i = end === -1 ? n : end + 3;
    } else if (xml.startsWith('<?', lt)) {
      const end = xml.indexOf('?>', lt + 2);
      i = end === -1 ? n : end + 2;
    } else if (xml.startsWith('<!', lt)) {
      const end = xml.indexOf('>', lt + 2);
      i = end === -1 ? n : end + 1;
    } else if (xml[lt + 1] === '/') {
      const end = xml.indexOf('>', lt);
      const name = xml.slice(lt + 2, end === -1 ? n : end).trim();
      for (let k = stack.length - 1; k > 0; k--) {
        if (stack[k].name === name) {
          stack.length = k;
          break;
        }
      }
      i = end === -1 ? n : end + 1;
    } else {
      const end = xml.indexOf('>', lt);
      if (end === -1) break;
      let tag = xml.slice(lt + 1, end);
      const selfClosing = tag.endsWith('/');
      if (selfClosing) tag = tag.slice(0, -1);
      const m = /^\s*([^\s/>]+)/.exec(tag);
      const name = m ? m[1] : tag;
      const attrs: Record<string, string> = {};
      const re = /([^\s=]+)\s*=\s*("([^"]*)"|'([^']*)')/g;
      let a: RegExpExecArray | null;
      const rest = tag.slice(m ? m[0].length : 0);
      while ((a = re.exec(rest))) attrs[a[1]] = decodeEntities(a[3] ?? a[4] ?? '');
      const node: Node = { name, attrs, children: [], text: '' };
      stack[stack.length - 1].children.push(node);
      if (!selfClosing) stack.push(node);
      i = end + 1;
    }
  }
  return root;
}

function toJson(node: Node): Json {
  const hasAttrs = Object.keys(node.attrs).length > 0;
  const text = node.text.trim();
  if (!node.children.length && !hasAttrs) return text;
  const obj: Record<string, unknown> = {};
  if (hasAttrs) obj.$ = { ...node.attrs };
  if (text) obj._ = text;
  for (const c of node.children) {
    const v = toJson(c);
    if (c.name in obj) {
      const prev = obj[c.name];
      obj[c.name] = Array.isArray(prev) ? [...prev, v] : [prev, v];
    } else {
      obj[c.name] = v;
    }
  }
  return obj;
}

export function xml2Json(xml: string): Record<string, unknown> {
  const root = parseXml(String(xml ?? ''));
  const out: Record<string, unknown> = {};
  for (const c of root.children) out[c.name] = toJson(c);
  return out;
}

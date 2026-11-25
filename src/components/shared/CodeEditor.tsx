import { useMemo } from 'react';
import CodeMirror from '@uiw/react-codemirror';
import { json } from '@codemirror/lang-json';
import { xml } from '@codemirror/lang-xml';
import { html } from '@codemirror/lang-html';
import { javascript } from '@codemirror/lang-javascript';
import { autocompletion, type CompletionContext } from '@codemirror/autocomplete';
import { githubDark, githubLight } from '@uiw/codemirror-theme-github';
import { PM_COMPLETIONS } from '../../core/snippets';
import { useAppStore } from '../../store/appStore';

interface Props {
  value: string;
  onChange?: (val: string) => void;
  language?: 'json' | 'xml' | 'html' | 'javascript' | 'text';
  readOnly?: boolean;
  height?: string;
  postmanCompletions?: boolean;
}

function pmCompletionSource(ctx: CompletionContext) {
  const word = ctx.matchBefore(/[\w.$]+/);
  if (!word || (word.from === word.to && !ctx.explicit)) return null;
  return {
    from: word.from,
    options: PM_COMPLETIONS.map((c) => ({ label: c.label, detail: c.detail, info: c.info, type: 'function' })),
  };
}

export function CodeEditor({
  value,
  onChange,
  language = 'text',
  readOnly = false,
  height = '240px',
  postmanCompletions = false,
}: Props) {
  const theme = useAppStore((s) => s.settings.theme);

  const extensions = useMemo(() => {
    const list = [];
    if (language === 'json') list.push(json());
    else if (language === 'xml') list.push(xml());
    else if (language === 'html') list.push(html());
    else if (language === 'javascript') list.push(javascript());
    if (postmanCompletions) list.push(autocompletion({ override: [pmCompletionSource] }));
    return list;
  }, [language, postmanCompletions]);

  return (
    <div style={{ border: '1px solid var(--border)', borderRadius: 5, overflow: 'hidden' }}>
      <CodeMirror
        value={value}
        height={height}
        theme={theme === 'dark' ? githubDark : githubLight}
        extensions={extensions}
        editable={!readOnly}
        onChange={(v) => onChange?.(v)}
        basicSetup={{ lineNumbers: true, foldGutter: true, highlightActiveLine: !readOnly }}
      />
    </div>
  );
}

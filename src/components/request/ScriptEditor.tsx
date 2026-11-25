import { SCRIPT_SNIPPETS } from '../../core/snippets';
import { CodeEditor } from '../shared/CodeEditor';

interface Props {
  kind: 'prerequest' | 'test';
  code: string;
  onChange: (next: string) => void;
}

export function ScriptEditor({ kind, code, onChange }: Props) {
  const snippets = SCRIPT_SNIPPETS.filter((s) => s.kind === 'both' || s.kind === kind);

  const insertSnippet = (snippetCode: string) => {
    const sep = code.trim().length > 0 ? '\n\n' : '';
    onChange(code + sep + snippetCode);
  };

  return (
    <div style={{ display: 'flex', gap: 12, alignItems: 'stretch' }}>
      <div style={{ flex: 1, minWidth: 0 }}>
        <CodeEditor
          value={code}
          language="javascript"
          height="240px"
          postmanCompletions
          onChange={onChange}
        />
      </div>
      <div style={{ width: 230, border: '1px solid var(--border)', borderRadius: 5, padding: 8, background: 'var(--bg-elev)', overflowY: 'auto', maxHeight: 242 }}>
        <div style={{ fontSize: 11, fontWeight: 600, color: 'var(--text-muted)', marginBottom: 6 }}>
          SNIPPETS (pm.*)
        </div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
          {snippets.map((s) => (
            <button
              key={s.id}
              className="secondary"
              style={{ justifyContent: 'flex-start', textAlign: 'left', fontSize: 12, padding: '4px 7px' }}
              onClick={() => insertSnippet(s.code)}
            >
              + {s.label}
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}

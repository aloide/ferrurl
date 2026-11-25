import { DYNAMIC_VARIABLES, lookup, referencedVariables, stringifyValue, type ScopeChain } from '../../core/variables';

interface Props {
  value: string;
  onChange: (v: string) => void;
  chain?: ScopeChain;
  placeholder?: string;
  className?: string;
  showPills?: boolean;
  onKeyDown?: React.KeyboardEventHandler<HTMLInputElement>;
}

export function VarText({ value, onChange, chain, placeholder, className = 'mono', showPills = false, onKeyDown }: Props) {
  const refs = chain ? [...new Set(referencedVariables(value))] : [];

  return (
    <div style={{ flex: 1, minWidth: 0 }}>
      <input
        className={className}
        style={{ width: '100%' }}
        value={value}
        placeholder={placeholder}
        onChange={(e) => onChange(e.target.value)}
        onKeyDown={onKeyDown}
      />
      {showPills && refs.length > 0 && chain && (
        <div className="var-pills">
          {refs.map((name) => {
            const l = lookup(chain, name);
            const dyn = name.startsWith('$') && Boolean(DYNAMIC_VARIABLES[name]);
            const ok = l.found || dyn;
            const title = l.found
              ? `${l.scope}: ${stringifyValue(l.value)}`
              : dyn
                ? 'Variable dinámica'
                : 'Variable no definida';
            return (
              <span key={name} className={`var-pill ${ok ? 'ok' : 'missing'}`} title={title}>
                {`{{${name}}}`}: {l.found ? stringifyValue(l.value).slice(0, 40) : dyn ? 'dinámica' : 'sin definir'}
              </span>
            );
          })}
        </div>
      )}
    </div>
  );
}

import { useState } from 'react';
import { types } from '../data/types.js';
import CodeBlock from './CodeBlock.jsx';

const KIND_BADGE = {
  'type alias': 'bg-amber-500/10 text-amber-400 border-amber-500/25',
  'interface':  'bg-cyan-500/10  text-cyan-400  border-cyan-500/25',
};

function TypeCard({ type }) {
  const [showDef, setShowDef] = useState(true);

  return (
    <section
      id={type.id}
      className="method-section mb-12 pb-10 border-b border-slate-800 last:border-0"
    >
      {/* Header */}
      <div className="flex items-baseline gap-3 mb-3 flex-wrap">
        <h3 className="text-2xl font-bold text-white font-mono">
          <a href={`#${type.id}`} className="hover:text-violet-400 transition-colors">
            {type.name}
          </a>
        </h3>
        <span className={`text-xs font-mono px-2 py-0.5 rounded border ${KIND_BADGE[type.kind] ?? 'bg-slate-500/10 text-slate-400 border-slate-500/20'}`}>
          {type.kind}
        </span>
        {type.usedBy?.length > 0 && (
          <div className="flex items-center gap-1.5 ml-auto flex-wrap">
            <span className="text-xs text-slate-600">used by</span>
            {type.usedBy.map((u) => (
              <span key={u} className="text-xs font-mono px-1.5 py-0.5 rounded bg-slate-800 text-slate-400 border border-slate-700/50">
                {u}
              </span>
            ))}
          </div>
        )}
      </div>

      {/* Description */}
      <p className="text-slate-300 leading-relaxed mb-5">{type.description}</p>

      {/* Definition */}
      <div className="mb-5">
        <div className="flex items-center justify-between mb-2">
          <h4 className="text-xs font-semibold uppercase tracking-widest text-slate-500">
            TypeScript Definition
          </h4>
          <button
            onClick={() => setShowDef((v) => !v)}
            className="text-xs text-slate-600 hover:text-slate-400 transition-colors"
          >
            {showDef ? 'hide' : 'show'}
          </button>
        </div>
        {showDef && <CodeBlock code={type.definition} language="typescript" />}
      </div>

      {/* Example */}
      {type.example && (
        <div>
          <h4 className="text-xs font-semibold uppercase tracking-widest text-slate-500 mb-2">Example</h4>
          <CodeBlock code={type.example} language="typescript" />
        </div>
      )}
    </section>
  );
}

export default function TypesSection() {
  return (
    <div>
      <div className="flex items-center gap-3 mb-8">
        <h2 id="types" className="method-section text-xl font-bold text-white">Types</h2>
        <div className="flex-1 h-px bg-slate-800" />
        <div className="flex items-center gap-3">
          <span className="text-xs font-mono px-2 py-0.5 rounded border bg-amber-500/10 text-amber-400 border-amber-500/25">type alias</span>
          <span className="text-xs font-mono px-2 py-0.5 rounded border bg-cyan-500/10 text-cyan-400 border-cyan-500/25">interface</span>
        </div>
      </div>
      {types.map((type) => (
        <TypeCard key={type.id} type={type} />
      ))}
    </div>
  );
}

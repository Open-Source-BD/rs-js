import CodeBlock from './CodeBlock.jsx';
import { TypeText } from '../utils/typeLinks.jsx';

const RETURN_BADGE = {
  intermediate: { label: 'intermediate', cls: 'bg-blue-500/15 text-blue-400 border-blue-500/30' },
  void: { label: 'void', cls: 'bg-slate-500/15 text-slate-400 border-slate-500/30' },
  'terminal → number': { label: 'terminal', cls: 'bg-amber-500/15 text-amber-400 border-amber-500/30' },
  'terminal → item | null': { label: 'terminal', cls: 'bg-amber-500/15 text-amber-400 border-amber-500/30' },
  terminal: { label: 'terminal', cls: 'bg-amber-500/15 text-amber-400 border-amber-500/30' },
};

function Badge({ type }) {
  const b = RETURN_BADGE[type] ?? { label: type, cls: 'bg-violet-500/15 text-violet-400 border-violet-500/30' };
  return (
    <span className={`text-xs font-mono px-2 py-0.5 rounded border ${b.cls}`}>
      {b.label}
    </span>
  );
}

export default function MethodCard({ method }) {
  return (
    <section
      id={method.id}
      className="method-section mb-16 pb-12 border-b border-slate-800 last:border-0"
    >
      {/* Name + badges */}
      <div className="flex items-baseline gap-3 mb-3 flex-wrap">
        <h3 className="text-2xl font-bold text-white font-mono">
          <a href={`#${method.id}`} className="hover:text-violet-400 transition-colors">
            {method.name}
          </a>
        </h3>
        <Badge type={method.returnType} />
        <span className="text-xs text-slate-500 ml-auto">since {method.since}</span>
      </div>

      {/* Signature */}
      <div className="mb-4 bg-slate-900/70 border border-slate-700/50 rounded-lg px-4 py-3 font-mono text-sm text-violet-300 overflow-x-auto">
        {method.signature}
      </div>

      {/* Description */}
      <p className="text-slate-300 leading-relaxed mb-4">{method.description}</p>

      {/* Note */}
      {method.note && (
        <div className="mb-5 flex gap-3 bg-amber-500/5 border border-amber-500/20 rounded-lg px-4 py-3">
          <span className="text-amber-400 mt-0.5 text-sm">⚠</span>
          <p className="text-amber-200/80 text-sm leading-relaxed">{method.note}</p>
        </div>
      )}

      {/* Arguments */}
      {method.params.length > 0 && (
        <div className="mb-5">
          <h4 className="text-xs font-semibold uppercase tracking-widest text-slate-500 mb-3">Arguments</h4>
          <div className="rounded-lg border border-slate-700/50 overflow-hidden">
            <table className="w-full text-sm">
              <thead>
                <tr className="bg-slate-800/60 border-b border-slate-700/50">
                  <th className="text-left px-4 py-2.5 text-slate-400 font-medium w-36">Name</th>
                  <th className="text-left px-4 py-2.5 text-slate-400 font-medium w-56">Type</th>
                  <th className="text-left px-4 py-2.5 text-slate-400 font-medium">Description</th>
                </tr>
              </thead>
              <tbody>
                {method.params.map((p, i) => (
                  <tr key={i} className="border-b border-slate-800/80 last:border-0 hover:bg-slate-800/20">
                    <td className="px-4 py-3 font-mono text-violet-300 text-xs whitespace-nowrap">{p.name}</td>
                    <td className="px-4 py-3 font-mono text-cyan-400 text-xs">
                      <TypeText text={p.type} className="text-cyan-400" />
                    </td>
                    <td className="px-4 py-3 text-slate-400 text-xs leading-relaxed whitespace-pre-line">
                      <TypeText text={p.description} className="text-slate-400" />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Returns */}
      <div className="mb-6">
        <h4 className="text-xs font-semibold uppercase tracking-widest text-slate-500 mb-2">Returns</h4>
        <p className="text-slate-400 text-sm font-mono whitespace-pre-line leading-relaxed">
          <TypeText text={method.returns} className="text-slate-400" />
        </p>
      </div>

      {/* Examples */}
      {method.examples.length > 0 && (
        <div>
          <h4 className="text-xs font-semibold uppercase tracking-widest text-slate-500 mb-3">
            {method.examples.length === 1 ? 'Example' : 'Examples'}
          </h4>
          <div className="space-y-4">
            {method.examples.map((ex, i) => (
              <div key={i}>
                {ex.label && (
                  <p className="text-xs text-slate-500 mb-1.5 font-medium">{ex.label}</p>
                )}
                <CodeBlock code={ex.code} />
              </div>
            ))}
          </div>
        </div>
      )}
    </section>
  );
}

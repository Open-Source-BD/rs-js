import { useEffect, useState } from 'react';
import CodeBlock from './components/CodeBlock.jsx';
import MethodCard from './components/MethodCard.jsx';
import PerformanceBenchmark from './components/PerformanceBenchmark.jsx';
import Sidebar from './components/Sidebar.jsx';
import TypesSection from './components/TypesSection.jsx';
import { categories } from './data/api.js';

function MenuIcon() {
  return (
    <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 6h16M4 12h16M4 18h16" />
    </svg>
  );
}

const INSTALL_CODE = `# Node.js (CommonJS)
const { RsJs } = require('rs-js');

# Browser / ESM
import { createRsJs } from 'rs-js';`;

const QUICK_START_CODE = `const { RsJs } = require('rs-js');

// 1. Load your data once
const engine = new RsJs(data);

// 2. Query many times — no re-serialization
const result = engine.query([
  { op: 'filter', conditions: [{ field: 'active', operator: 'eq', value: true }] },
  { op: 'groupBy', field: 'department',
    aggregate: [{ field: 'salary', reducer: 'avg', alias: 'avg_salary' }] }
]);
// => { type: 'object', value: {
//      engineering: { _count: 420, avg_salary: 91200 },
//      marketing:   { _count: 310, avg_salary: 74500 },
//    }}

// 3. Zero-copy path for analytics (5–18× faster)
engine.filterMapRef(
  [{ op: 'filter', conditions: [{ field: 'age', operator: 'gte', value: 18 }] }],
  [{ op: 'map',    transforms: [{ field: 'bonus',
      expr: { type: 'arithmetic', op: '*',
        left: { type: 'field', name: 'salary' }, right: { type: 'literal', value: 0.1 } } }] }],
  (ref) => {
    // ref.columns.salary → Float64Array  (no row objects ever created)
    // ref.columns.bonus  → Float64Array  (computed in Rust)
    let total = 0;
    for (let i = 0; i < ref.count; i++) total += ref.columns.bonus[i];
    console.log('Total bonus:', total); // => Total bonus: 768004800
  }
);

// 4. Always free when done
engine.free();`;

export default function App() {
  const [search, setSearch] = useState('');
  const [activeId, setActiveId] = useState('');
  const [sidebarOpen, setSidebarOpen] = useState(false);

  useEffect(() => {
    const sections = document.querySelectorAll('.method-section');
    const observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (entry.isIntersecting) {
            setActiveId(entry.target.id);
            break;
          }
        }
      },
      { rootMargin: '-10% 0px -75% 0px', threshold: 0 }
    );
    sections.forEach((s) => observer.observe(s));
    return () => observer.disconnect();
  }, [search]);

  const filteredCategories = search
    ? categories
        .map((cat) => ({
          ...cat,
          methods: cat.methods.filter(
            (m) =>
              m.name.toLowerCase().includes(search.toLowerCase()) ||
              m.description.toLowerCase().includes(search.toLowerCase()) ||
              m.signature.toLowerCase().includes(search.toLowerCase())
          ),
        }))
        .filter((cat) => cat.methods.length > 0)
    : categories;

  return (
    <div className="min-h-screen bg-slate-950 text-slate-200">
      {/* Header */}
      <header className="fixed top-0 left-0 right-0 z-50 h-14 border-b border-slate-800 bg-slate-950/95 backdrop-blur-sm flex items-center px-4 gap-3">
        <button
          className="lg:hidden p-1.5 rounded-md text-slate-400 hover:text-slate-200 hover:bg-slate-800 transition-colors"
          onClick={() => setSidebarOpen(!sidebarOpen)}
        >
          <MenuIcon />
        </button>

        <div className="flex items-center gap-2 lg:ml-72">
          <span className="text-xs text-slate-500 hidden sm:block">High-Performance WASM Data Engine for JavaScript</span>
        </div>

        <div className="flex-1" />

        <div className="flex items-center gap-3">
          <span className="text-xs bg-violet-500/15 text-violet-400 border border-violet-500/30 px-2 py-0.5 rounded font-mono hidden sm:block">
            v0.1.2
          </span>
          <a
            href="https://github.com/shaon07/rs-js"
            target="_blank"
            rel="noreferrer"
            className="flex items-center gap-1.5 text-sm text-slate-400 hover:text-slate-200 transition-colors"
          >
            <svg className="w-4 h-4" fill="currentColor" viewBox="0 0 24 24">
              <path d="M12 0C5.37 0 0 5.37 0 12c0 5.31 3.435 9.795 8.205 11.385.6.105.825-.255.825-.57 0-.285-.015-1.23-.015-2.235-3.015.555-3.795-.735-4.035-1.41-.135-.345-.72-1.41-1.23-1.695-.42-.225-1.02-.78-.015-.795.945-.015 1.62.87 1.845 1.23 1.08 1.815 2.805 1.305 3.495.99.105-.78.42-1.305.765-1.605-2.67-.3-5.46-1.335-5.46-5.925 0-1.305.465-2.385 1.23-3.225-.12-.3-.54-1.53.12-3.18 0 0 1.005-.315 3.3 1.23.96-.27 1.98-.405 3-.405s2.04.135 3 .405c2.295-1.56 3.3-1.23 3.3-1.23.66 1.65.24 2.88.12 3.18.765.84 1.23 1.905 1.23 3.225 0 4.605-2.805 5.625-5.475 5.925.435.375.81 1.095.81 2.22 0 1.605-.015 2.895-.015 3.3 0 .315.225.69.825.57A12.02 12.02 0 0024 12c0-6.63-5.37-12-12-12z" />
            </svg>
            <span className="hidden sm:block">GitHub</span>
          </a>
        </div>
      </header>

      {/* Sidebar */}
      <Sidebar
        categories={filteredCategories}
        activeId={activeId}
        search={search}
        onSearchChange={setSearch}
        isOpen={sidebarOpen}
        onClose={() => setSidebarOpen(false)}
      />

      {/* Main content */}
      <main className="lg:pl-72 pt-14">
        <div className="max-w-4xl mx-auto px-5 sm:px-8 py-14">

          {/* Hero */}
          <div className="mb-16">
            <div className="mb-6">
              <img src="/logo.svg" alt="rs-js — WASM Data Engine" className="h-12" />
            </div>
            <p className="text-lg text-slate-300 mb-3 leading-relaxed max-w-2xl">
              High-performance Rust/WASM data engine for JavaScript.
              Deserialize once, query many times — no re-serialization overhead.
            </p>
            <p className="text-slate-500 mb-8 max-w-2xl">
              Up to <span className="text-violet-400 font-semibold">45× faster</span> than native JS for columnar analytics.
              Zero-copy typed-array APIs bypass V8's object-creation bottleneck entirely.
            </p>

            {/* Performance badges */}
            <div className="flex flex-wrap gap-3 mb-8">
              {[
                { label: 'filterMapRef', value: '5–18×', color: 'violet' },
                { label: 'mapRef projection', value: '29×', color: 'cyan' },
                { label: 'groupBy + agg', value: '6×', color: 'emerald' },
                { label: 'reduce / count', value: '4–8×', color: 'amber' },
              ].map(({ label, value, color }) => (
                <div
                  key={label}
                  className={`flex items-center gap-2 border rounded-lg px-3 py-2
                    ${color === 'violet' ? 'border-violet-500/30 bg-violet-500/5' : ''}
                    ${color === 'cyan'   ? 'border-cyan-500/30   bg-cyan-500/5'   : ''}
                    ${color === 'emerald'? 'border-emerald-500/30 bg-emerald-500/5': ''}
                    ${color === 'amber'  ? 'border-amber-500/30  bg-amber-500/5'  : ''}
                  `}
                >
                  <span className={`text-lg font-bold font-mono
                    ${color === 'violet'  ? 'text-violet-400' : ''}
                    ${color === 'cyan'    ? 'text-cyan-400'   : ''}
                    ${color === 'emerald' ? 'text-emerald-400': ''}
                    ${color === 'amber'   ? 'text-amber-400'  : ''}
                  `}>{value}</span>
                  <span className="text-slate-400 text-xs">{label}</span>
                </div>
              ))}
            </div>

            {/* Install */}
            <div className="mb-6">
              <h2 className="text-xs font-semibold uppercase tracking-widest text-slate-500 mb-2">Install</h2>
              <div className="rounded-lg overflow-hidden border border-slate-700/60">
                <div className="bg-slate-900/80 px-4 py-3 text-sm font-mono text-slate-300 space-y-1">
                  <div><span className="text-slate-500"># Node.js (CommonJS)</span></div>
                  <div><span className="text-violet-400">const</span> {'{'} <span className="text-cyan-300">RsJs</span> {'}'} = <span className="text-amber-300">require</span>(<span className="text-green-400">'rs-js'</span>);</div>
                  <div className="mt-2"><span className="text-slate-500"># Browser / ESM</span></div>
                  <div><span className="text-violet-400">import</span> {'{'} <span className="text-cyan-300">createRsJs</span> {'}'} <span className="text-violet-400">from</span> <span className="text-green-400">'rs-js'</span>;</div>
                </div>
              </div>
            </div>

            {/* Quick start */}
            <div>
              <h2 className="text-xs font-semibold uppercase tracking-widest text-slate-500 mb-2">Quick Start</h2>
              <CodeBlock code={QUICK_START_CODE} />
            </div>
          </div>

          {/* Performance section */}
          {!search && <PerformanceBenchmark />}

          {/* Method sections */}
          {filteredCategories.map((category) => (
            <div key={category.id}>
              <div className="flex items-center gap-3 mb-8">
                <h2
                  id={category.id}
                  className="method-section text-xl font-bold text-white"
                >
                  {category.name}
                </h2>
                <div className="flex-1 h-px bg-slate-800" />
              </div>
              {category.methods.map((method) => (
                <MethodCard key={method.id} method={method} />
              ))}
            </div>
          ))}

          {/* Types section */}
          {!search && <TypesSection />}

          {/* Footer */}
          <footer className="mt-16 pt-8 border-t border-slate-800 text-center">
            <p className="text-slate-600 text-sm">
              rs-js — Rust/WASM data engine ·{' '}
              <a href="https://github.com/shaon07/rs-js" target="_blank" rel="noreferrer" className="hover:text-slate-400 transition-colors">
                GitHub
              </a>
            </p>
          </footer>
        </div>
      </main>
    </div>
  );
}

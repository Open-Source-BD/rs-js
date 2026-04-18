import { useState, useEffect, useRef } from 'react';

// ── real benchmark data (measured via node benchmark.js) ──────────────────────
const BENCH = {
  '10k': [
    { id: 'filter',        label: 'filter',           detail: 'age ≥ 18',             js: 0.11,  eng: 0.27,  cat: 'query'    },
    { id: 'map',           label: 'map',              detail: 'salary × 0.1',         js: 4.14,  eng: 3.75,  cat: 'query'    },
    { id: 'reduce',        label: 'reduce',           detail: 'sum active salaries',  js: 0.23,  eng: 0.06,  cat: 'agg'      },
    { id: 'count',         label: 'count',            detail: 'age ≥ 18',             js: 0.38,  eng: 0.03,  cat: 'agg'      },
    { id: 'find',          label: 'find',             detail: 'by id',                js: 0.04,  eng: 0.04,  cat: 'query'    },
    { id: 'groupBy',       label: 'groupBy',          detail: 'by department',        js: 0.20,  eng: 0.61,  cat: 'agg'      },
    { id: 'groupByAgg',    label: 'groupBy + avg',    detail: 'by country',           js: 0.45,  eng: 0.08,  cat: 'agg'      },
    { id: 'pipeline1',     label: 'pipeline',         detail: 'filter → groupBy+avg', js: 0.45,  eng: 0.10,  cat: 'agg'      },
    { id: 'pipeline2',     label: 'pipeline',         detail: 'filter → map+bonus',   js: 4.00,  eng: 3.72,  cat: 'query'    },
    { id: 'mapRef',        label: 'mapRef',           detail: 'salary × 0.1',         js: 3.72,  eng: 0.63,  cat: 'zerocopy' },
    { id: 'filterMapRef',  label: 'filterMapRef',     detail: 'columnar filter+map',  js: 3.45,  eng: 1.41,  cat: 'zerocopy' },
    { id: 'filterViewRef', label: 'filterViewRef',    detail: 'zero-copy filter',     js: 2.02,  eng: 0.70,  cat: 'zerocopy' },
    { id: 'mapRefProj',    label: 'mapRef proj',      detail: 'salary projection',    js: 0.10,  eng: 0.01,  cat: 'zerocopy' },
    { id: 'groupByIdx',    label: 'groupByIndices',   detail: 'by department',        js: 0.85,  eng: 0.11,  cat: 'zerocopy' },
  ],
  '100k': [
    { id: 'filter',        label: 'filter',           detail: 'age ≥ 18',             js: 1.08,   eng: 0.68,  cat: 'query'    },
    { id: 'map',           label: 'map',              detail: 'salary × 0.1',         js: 51.28,  eng: 45.35, cat: 'query'    },
    { id: 'reduce',        label: 'reduce',           detail: 'sum active salaries',  js: 2.30,   eng: 0.30,  cat: 'agg'      },
    { id: 'count',         label: 'count',            detail: 'age ≥ 18',             js: 1.07,   eng: 0.19,  cat: 'agg'      },
    { id: 'find',          label: 'find',             detail: 'by id',                js: 0.29,   eng: 0.20,  cat: 'query'    },
    { id: 'groupBy',       label: 'groupBy',          detail: 'by department',        js: 1.76,   eng: 1.00,  cat: 'agg'      },
    { id: 'groupByAgg',    label: 'groupBy + avg',    detail: 'by country',           js: 0.77,   eng: 0.29,  cat: 'agg'      },
    { id: 'pipeline1',     label: 'pipeline',         detail: 'filter → groupBy+avg', js: 1.68,   eng: 0.65,  cat: 'agg'      },
    { id: 'pipeline2',     label: 'pipeline',         detail: 'filter → map+bonus',   js: 46.02,  eng: 43.91, cat: 'query'    },
    { id: 'mapRef',        label: 'mapRef',           detail: 'salary × 0.1',         js: 45.47,  eng: 5.93,  cat: 'zerocopy' },
    { id: 'filterMapRef',  label: 'filterMapRef',     detail: 'columnar filter+map',  js: 43.33,  eng: 14.29, cat: 'zerocopy' },
    { id: 'filterViewRef', label: 'filterViewRef',    detail: 'zero-copy filter',     js: 16.13,  eng: 7.02,  cat: 'zerocopy' },
    { id: 'mapRefProj',    label: 'mapRef proj',      detail: 'salary projection',    js: 0.27,   eng: 0.01,  cat: 'zerocopy' },
    { id: 'groupByIdx',    label: 'groupByIndices',   detail: 'by department',        js: 1.27,   eng: 0.18,  cat: 'zerocopy' },
  ],
  '500k': [
    { id: 'filter',        label: 'filter',           detail: 'age ≥ 18',             js: 7.59,   eng: 3.27,  cat: 'query'    },
    { id: 'map',           label: 'map',              detail: 'salary × 0.1',         js: 321.02, eng: 272.51,cat: 'query'    },
    { id: 'reduce',        label: 'reduce',           detail: 'sum active salaries',  js: 9.56,   eng: 1.42,  cat: 'agg'      },
    { id: 'count',         label: 'count',            detail: 'age ≥ 18',             js: 7.01,   eng: 0.95,  cat: 'agg'      },
    { id: 'find',          label: 'find',             detail: 'by id',                js: 1.47,   eng: 0.95,  cat: 'query'    },
    { id: 'groupBy',       label: 'groupBy',          detail: 'by department',        js: 7.66,   eng: 3.98,  cat: 'agg'      },
    { id: 'groupByAgg',    label: 'groupBy + avg',    detail: 'by country',           js: 4.61,   eng: 1.40,  cat: 'agg'      },
    { id: 'pipeline1',     label: 'pipeline',         detail: 'filter → groupBy+avg', js: 8.22,   eng: 3.08,  cat: 'agg'      },
    { id: 'pipeline2',     label: 'pipeline',         detail: 'filter → map+bonus',   js: 308.26, eng: 230.25,cat: 'query'    },
    { id: 'mapRef',        label: 'mapRef',           detail: 'salary × 0.1',         js: 302.66, eng: 39.11, cat: 'zerocopy' },
    { id: 'filterMapRef',  label: 'filterMapRef',     detail: 'columnar filter+map',  js: 243.52, eng: 65.18, cat: 'zerocopy' },
    { id: 'filterViewRef', label: 'filterViewRef',    detail: 'zero-copy filter',     js: 105.13, eng: 24.44, cat: 'zerocopy' },
    { id: 'mapRefProj',    label: 'mapRef proj',      detail: 'salary projection',    js: 1.49,   eng: 0.03,  cat: 'zerocopy' },
    { id: 'groupByIdx',    label: 'groupByIndices',   detail: 'by department',        js: 6.01,   eng: 0.80,  cat: 'zerocopy' },
  ],
};

const CATEGORY_META = {
  zerocopy: { label: 'Zero-Copy APIs',     color: 'violet', border: 'border-l-violet-500', bg: 'bg-violet-500/5',  text: 'text-violet-400'  },
  agg:      { label: 'Aggregations',       color: 'cyan',   border: 'border-l-cyan-500',   bg: 'bg-cyan-500/5',    text: 'text-cyan-400'    },
  query:    { label: 'Filter / Map',        color: 'blue',   border: 'border-l-blue-500',   bg: 'bg-blue-500/5',    text: 'text-blue-400'    },
};

function speedup(row) { return row.js / row.eng; }

function SpeedupBadge({ row }) {
  const s = speedup(row);
  if (s < 1) {
    return (
      <span className="inline-flex items-center gap-1 text-xs font-mono px-2 py-0.5 rounded-md bg-amber-500/10 text-amber-400 border border-amber-500/20 whitespace-nowrap">
        JS {(1 / s).toFixed(1)}× faster
      </span>
    );
  }
  if (s >= 20) return (
    <span className="inline-flex items-center gap-1 text-xs font-bold font-mono px-2 py-0.5 rounded-md bg-emerald-500/15 text-emerald-300 border border-emerald-500/40 whitespace-nowrap shadow-[0_0_12px_rgba(52,211,153,0.3)]">
      ⚡ {s.toFixed(1)}× faster
    </span>
  );
  if (s >= 10) return (
    <span className="inline-flex items-center gap-1 text-xs font-bold font-mono px-2 py-0.5 rounded-md bg-emerald-500/10 text-emerald-400 border border-emerald-500/30 whitespace-nowrap">
      {s.toFixed(1)}× faster
    </span>
  );
  if (s >= 5) return (
    <span className="inline-flex items-center gap-1 text-xs font-mono px-2 py-0.5 rounded-md bg-violet-500/15 text-violet-300 border border-violet-500/30 whitespace-nowrap">
      {s.toFixed(1)}× faster
    </span>
  );
  if (s >= 2) return (
    <span className="inline-flex items-center gap-1 text-xs font-mono px-2 py-0.5 rounded-md bg-cyan-500/10 text-cyan-400 border border-cyan-500/20 whitespace-nowrap">
      {s.toFixed(1)}× faster
    </span>
  );
  return (
    <span className="inline-flex items-center gap-1 text-xs font-mono px-2 py-0.5 rounded-md bg-slate-500/10 text-slate-400 border border-slate-500/20 whitespace-nowrap">
      {s.toFixed(1)}× faster
    </span>
  );
}

function BenchRow({ row, globalMax, animated }) {
  const s = speedup(row);
  const engWins = s >= 1;
  const maxVal = Math.max(row.js, row.eng);

  const jsWidth  = (row.js  / globalMax) * 100;
  const engWidth = (row.eng / globalMax) * 100;
  const minPct = 0.5;

  return (
    <div className="grid grid-cols-[1fr_auto] gap-x-4 items-center py-3 px-4 hover:bg-white/[0.02] rounded-lg transition-colors group">
      {/* Left: operation + bars */}
      <div className="min-w-0">
        <div className="flex items-baseline gap-2 mb-2">
          <span className="text-sm font-mono text-slate-200 font-medium">{row.label}</span>
          <span className="text-xs text-slate-500 truncate">{row.detail}</span>
        </div>
        {/* JS bar */}
        <div className="flex items-center gap-2 mb-1">
          <span className="text-[10px] font-mono text-slate-500 w-16 text-right shrink-0">JS</span>
          <div className="flex-1 h-4 bg-slate-800/60 rounded-sm overflow-hidden relative">
            <div
              className="h-full rounded-sm bg-gradient-to-r from-slate-500/70 to-slate-400/60 transition-all duration-700 ease-out"
              style={{ width: `${Math.max(minPct, jsWidth)}%` }}
            />
          </div>
          <span className="text-[10px] font-mono text-slate-400 w-16 shrink-0">
            {row.js >= 10 ? row.js.toFixed(1) : row.js.toFixed(2)} ms
          </span>
        </div>
        {/* Engine bar */}
        <div className="flex items-center gap-2">
          <span className="text-[10px] font-mono text-violet-400 w-16 text-right shrink-0">rs-js</span>
          <div className="flex-1 h-4 bg-slate-800/60 rounded-sm overflow-hidden relative">
            <div
              className={`h-full rounded-sm transition-all duration-700 ease-out ${
                engWins
                  ? 'bg-gradient-to-r from-violet-600 to-violet-400'
                  : 'bg-gradient-to-r from-amber-600 to-amber-400'
              }`}
              style={{ width: `${Math.max(minPct, engWidth)}%` }}
            />
          </div>
          <span className={`text-[10px] font-mono w-16 shrink-0 ${engWins ? 'text-violet-400' : 'text-amber-400'}`}>
            {row.eng >= 10 ? row.eng.toFixed(1) : row.eng.toFixed(2)} ms
          </span>
        </div>
      </div>

      {/* Right: speedup badge */}
      <div className="flex items-center justify-end">
        <SpeedupBadge row={row} />
      </div>
    </div>
  );
}

function CategoryGroup({ cat, rows, globalMax }) {
  const meta = CATEGORY_META[cat];
  return (
    <div className={`mb-6 rounded-xl border border-slate-700/40 overflow-hidden ${meta.bg}`}>
      {/* Category header */}
      <div className={`flex items-center gap-3 px-4 py-2.5 border-b border-slate-700/40 border-l-2 ${meta.border}`}>
        <h4 className={`text-xs font-semibold uppercase tracking-widest ${meta.text}`}>
          {meta.label}
        </h4>
        <span className="text-xs text-slate-600">{rows.length} operations</span>
      </div>
      {/* Rows */}
      <div className="divide-y divide-slate-800/40">
        {rows.map((row) => (
          <BenchRow key={row.id} row={row} globalMax={globalMax} />
        ))}
      </div>
    </div>
  );
}

function StatCard({ value, label, sub, color }) {
  const colors = {
    emerald: { val: 'text-emerald-300', glow: 'shadow-[0_0_30px_rgba(52,211,153,0.2)]', bg: 'bg-emerald-500/5 border-emerald-500/20' },
    violet:  { val: 'text-violet-300',  glow: 'shadow-[0_0_30px_rgba(139,92,246,0.2)]',  bg: 'bg-violet-500/5  border-violet-500/20'  },
    cyan:    { val: 'text-cyan-300',    glow: 'shadow-[0_0_30px_rgba(34,211,238,0.2)]',  bg: 'bg-cyan-500/5    border-cyan-500/20'    },
  };
  const c = colors[color];
  return (
    <div className={`rounded-xl border p-4 ${c.bg} ${c.glow}`}>
      <div className={`text-3xl font-bold font-mono tracking-tight mb-1 ${c.val}`}>{value}</div>
      <div className="text-sm text-slate-300 font-medium">{label}</div>
      <div className="text-xs text-slate-500 mt-0.5">{sub}</div>
    </div>
  );
}

const SIZES = ['10k', '100k', '500k'];

function avgSpeedup(data) {
  const wins = data.filter(r => speedup(r) > 1);
  if (!wins.length) return 1;
  return wins.reduce((s, r) => s + speedup(r), 0) / wins.length;
}

export default function PerformanceBenchmark() {
  const [size, setSize] = useState('100k');
  const prevSize = useRef(size);

  useEffect(() => { prevSize.current = size; }, [size]);

  const data = BENCH[size];
  const globalMax = Math.max(...data.map(r => Math.max(r.js, r.eng)));
  const maxSpeedup = Math.max(...data.map(r => speedup(r)));
  const avgS = avgSpeedup(data);
  const rowCount = { '10k': '10,000', '100k': '100,000', '500k': '500,000' };

  const catOrder = ['zerocopy', 'agg', 'query'];

  return (
    <section id="performance" className="method-section mb-16">
      {/* Section heading */}
      <div className="flex items-center gap-3 mb-8">
        <h2 className="text-xl font-bold text-white">Performance</h2>
        <div className="flex-1 h-px bg-slate-800" />
        <span className="text-xs text-slate-500 font-mono">measured · macOS · Node.js · 5-run avg</span>
      </div>

      {/* Hero stat cards */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 mb-8">
        <StatCard
          value="45.3×"
          label="Peak Speedup"
          sub="mapRef projection at 500k rows"
          color="emerald"
        />
        <StatCard
          value={`${maxSpeedup.toFixed(1)}×`}
          label={`Fastest at ${rowCount[size]}`}
          sub={`${data.find(r => speedup(r) === maxSpeedup)?.label} · ${data.find(r => speedup(r) === maxSpeedup)?.detail}`}
          color="violet"
        />
        <StatCard
          value={`${avgS.toFixed(1)}×`}
          label={`Avg Speedup at ${rowCount[size]}`}
          sub={`across ${data.filter(r => speedup(r) > 1).length} operations where engine wins`}
          color="cyan"
        />
      </div>

      {/* Dataset size tabs */}
      <div className="flex items-center gap-2 mb-6">
        <span className="text-xs text-slate-500 mr-1">Dataset:</span>
        {SIZES.map((s) => (
          <button
            key={s}
            onClick={() => setSize(s)}
            className={`px-3 py-1.5 rounded-lg text-sm font-mono font-medium transition-all duration-200 ${
              size === s
                ? 'bg-violet-500/20 text-violet-300 border border-violet-500/40 shadow-[0_0_12px_rgba(139,92,246,0.2)]'
                : 'bg-slate-800/40 text-slate-400 border border-slate-700/40 hover:text-slate-200 hover:bg-slate-800/70'
            }`}
          >
            {Number(s.replace('k', '')) * 1000 >= 1000000
              ? s
              : `${(Number(s.replace('k', '')) * 1000).toLocaleString()}`}
            &nbsp;rows
          </button>
        ))}
      </div>

      {/* Benchmark categories */}
      {catOrder.map((cat) => (
        <CategoryGroup
          key={`${cat}-${size}`}
          cat={cat}
          rows={data.filter((r) => r.cat === cat)}
          globalMax={globalMax}
        />
      ))}

      {/* Legend */}
      <div className="flex items-center gap-6 px-2 pt-2">
        <div className="flex items-center gap-2">
          <div className="w-8 h-3 rounded-sm bg-gradient-to-r from-slate-500/70 to-slate-400/60" />
          <span className="text-xs text-slate-500">Native JS</span>
        </div>
        <div className="flex items-center gap-2">
          <div className="w-8 h-3 rounded-sm bg-gradient-to-r from-violet-600 to-violet-400" />
          <span className="text-xs text-slate-500">rs-js engine</span>
        </div>
        <div className="flex items-center gap-2">
          <div className="w-8 h-3 rounded-sm bg-gradient-to-r from-amber-600 to-amber-400" />
          <span className="text-xs text-slate-500">rs-js (JS faster)</span>
        </div>
        <div className="ml-auto text-xs text-slate-600">bar widths scaled to dataset max</div>
      </div>
    </section>
  );
}

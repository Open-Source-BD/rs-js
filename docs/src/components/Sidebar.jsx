import { useState } from 'react';

const CATEGORY_ICONS = {
  core: '⚡',
  query: '🔍',
  'zero-copy': '⚡',
  operations: '🔧',
  utilities: '🛠',
};

function SearchIcon() {
  return (
    <svg className="w-4 h-4 text-slate-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
    </svg>
  );
}

function CategorySection({ category, activeId, isOpen, onToggle }) {
  return (
    <div className="mb-1">
      <button
        onClick={onToggle}
        className="flex items-center justify-between w-full px-3 py-2 text-xs font-semibold uppercase tracking-widest text-slate-400 hover:text-slate-200 transition-colors rounded-md hover:bg-slate-800/50"
      >
        <span>{category.name}</span>
        <svg
          className={`w-3.5 h-3.5 transition-transform ${isOpen ? 'rotate-180' : ''}`}
          fill="none" stroke="currentColor" viewBox="0 0 24 24"
        >
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
        </svg>
      </button>
      {isOpen && (
        <ul className="mt-0.5 ml-2">
          {category.methods.map((method) => (
            <li key={method.id}>
              <a
                href={`#${method.id}`}
                className={`flex items-center gap-2 px-3 py-1.5 rounded-md text-sm font-mono transition-colors ${
                  activeId === method.id
                    ? 'bg-violet-500/15 text-violet-300 border-l-2 border-violet-500 pl-2.5'
                    : 'text-slate-400 hover:text-slate-200 hover:bg-slate-800/40'
                }`}
              >
                {method.name}
              </a>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

export default function Sidebar({ categories, activeId, search, onSearchChange, isOpen, onClose }) {
  const [openCategories, setOpenCategories] = useState(() =>
    Object.fromEntries(categories.map((c) => [c.id, true]))
  );

  const toggleCategory = (id) => {
    setOpenCategories((prev) => ({ ...prev, [id]: !prev[id] }));
  };

  const allOpen = search.length > 0;

  return (
    <>
      {/* Mobile overlay */}
      {isOpen && (
        <div
          className="fixed inset-0 z-40 bg-black/50 lg:hidden"
          onClick={onClose}
        />
      )}

      {/* Sidebar panel */}
      <aside
        className={`fixed top-0 left-0 bottom-0 z-40 w-72 bg-slate-900 border-r border-slate-800 flex flex-col transition-transform duration-200 ${
          isOpen ? 'translate-x-0' : '-translate-x-full lg:translate-x-0'
        }`}
      >
        {/* Logo area */}
        <div className="flex items-center gap-2.5 px-5 h-14 border-b border-slate-800 shrink-0">
          <div className="w-7 h-7 rounded-md bg-violet-600 flex items-center justify-center">
            <span className="text-white text-xs font-bold">R</span>
          </div>
          <div>
            <span className="font-bold text-white font-mono text-sm tracking-tight">rs-js</span>
            <span className="text-slate-500 text-xs ml-2">v1.0</span>
          </div>
        </div>

        {/* Search */}
        <div className="px-4 py-3 border-b border-slate-800 shrink-0">
          <div className="flex items-center gap-2 bg-slate-800/60 border border-slate-700/50 rounded-lg px-3 py-2 focus-within:border-violet-500/50 transition-colors">
            <SearchIcon />
            <input
              type="text"
              placeholder="Search..."
              value={search}
              onChange={(e) => onSearchChange(e.target.value)}
              className="bg-transparent text-sm text-slate-200 placeholder-slate-500 outline-none flex-1 min-w-0"
            />
            {search && (
              <button
                onClick={() => onSearchChange('')}
                className="text-slate-500 hover:text-slate-300 text-xs"
              >
                ✕
              </button>
            )}
          </div>
        </div>

        {/* Nav */}
        <nav className="flex-1 overflow-y-auto px-3 py-3">
          {/* Static section links — always shown when not searching */}
          {!search && (
            <div className="mb-3 space-y-0.5">
              {[
                { id: 'performance', label: 'Performance', icon: '⚡' },
                { id: 'types',       label: 'Types',       icon: '𝕋' },
              ].map(({ id, label, icon }) => (
                <a
                  key={id}
                  href={`#${id}`}
                  className={`flex items-center gap-2 px-3 py-1.5 rounded-md text-sm font-semibold transition-colors ${
                    activeId === id
                      ? 'bg-violet-500/15 text-violet-300 border-l-2 border-violet-500 pl-2.5'
                      : 'text-slate-300 hover:text-slate-100 hover:bg-slate-800/40'
                  }`}
                >
                  <span className="text-xs w-4 text-center">{icon}</span>
                  {label}
                </a>
              ))}
              <div className="h-px bg-slate-800 my-2" />
            </div>
          )}
          {categories.length === 0 ? (
            <p className="text-slate-500 text-sm px-3 py-4 text-center">No results for "{search}"</p>
          ) : (
            categories.map((cat) => (
              <CategorySection
                key={cat.id}
                category={cat}
                activeId={activeId}
                isOpen={allOpen || openCategories[cat.id] !== false}
                onToggle={() => toggleCategory(cat.id)}
              />
            ))
          )}
        </nav>

        {/* Footer */}
        <div className="px-5 py-3 border-t border-slate-800 shrink-0">
          <a
            href="https://github.com/shaon07/rs-js"
            target="_blank"
            rel="noreferrer"
            className="flex items-center gap-2 text-xs text-slate-500 hover:text-slate-300 transition-colors"
          >
            <svg className="w-4 h-4" fill="currentColor" viewBox="0 0 24 24">
              <path d="M12 0C5.37 0 0 5.37 0 12c0 5.31 3.435 9.795 8.205 11.385.6.105.825-.255.825-.57 0-.285-.015-1.23-.015-2.235-3.015.555-3.795-.735-4.035-1.41-.135-.345-.72-1.41-1.23-1.695-.42-.225-1.02-.78-.015-.795.945-.015 1.62.87 1.845 1.23 1.08 1.815 2.805 1.305 3.495.99.105-.78.42-1.305.765-1.605-2.67-.3-5.46-1.335-5.46-5.925 0-1.305.465-2.385 1.23-3.225-.12-.3-.54-1.53.12-3.18 0 0 1.005-.315 3.3 1.23.96-.27 1.98-.405 3-.405s2.04.135 3 .405c2.295-1.56 3.3-1.23 3.3-1.23.66 1.65.24 2.88.12 3.18.765.84 1.23 1.905 1.23 3.225 0 4.605-2.805 5.625-5.475 5.925.435.375.81 1.095.81 2.22 0 1.605-.015 2.895-.015 3.3 0 .315.225.69.825.57A12.02 12.02 0 0024 12c0-6.63-5.37-12-12-12z" />
            </svg>
            GitHub
          </a>
        </div>
      </aside>
    </>
  );
}

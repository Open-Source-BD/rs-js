import { Prism as SyntaxHighlighter } from 'react-syntax-highlighter';
import { vscDarkPlus } from 'react-syntax-highlighter/dist/esm/styles/prism';

const customStyle = {
  ...vscDarkPlus,
  'pre[class*="language-"]': {
    ...vscDarkPlus['pre[class*="language-"]'],
    background: '#0d1117',
    margin: 0,
    padding: '1.1rem 1.25rem',
    borderRadius: '0',
    fontSize: '0.82rem',
  },
  'code[class*="language-"]': {
    ...vscDarkPlus['code[class*="language-"]'],
    background: 'transparent',
    fontSize: '0.82rem',
  },
};

export default function CodeBlock({ code, language = 'javascript' }) {
  return (
    <div className="rounded-lg overflow-hidden border border-slate-700/60">
      <SyntaxHighlighter
        language={language}
        style={customStyle}
        wrapLongLines={false}
      >
        {code}
      </SyntaxHighlighter>
    </div>
  );
}

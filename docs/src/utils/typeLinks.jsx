// Maps "used by" label → anchor id of the method section
export const USED_BY_ANCHORS = {
  'filter op':         'op-filter',
  'find op':           'op-find',
  'map op':            'op-map',
  'groupBy op':        'op-group-by',
  'reduce op':         'op-reduce',
  'count op':          'op-count',
  'query':             'query',
  'filterIndices':     'filter-indices',
  'filterViewRef':     'filter-view-ref',
  'mapRef':            'map-ref',
  'filterMapRef':      'filter-map-ref',
  'groupByIndices':    'group-by-indices',
  'new RsJs':          'constructor',
  'createRsJs':        'create-rs-js',
  // type cross-refs
  'Condition':         'type-condition',
  'FilterSelectionRef':'type-filter-selection-ref',
  'FilterMapRef':      'type-filter-map-ref',
  'MapRefView':        'type-map-ref-view',
  'FilterView':        'type-filter-selection-ref',
};

// Maps type name → anchor id in the Types section
export const TYPE_ANCHORS = {
  Operator:           'type-operator',
  Condition:          'type-condition',
  ConditionLogic:     'type-condition-logic',
  MapExpr:            'type-map-expr',
  ReduceOpInline:     'type-reduce-op-inline',
  Operation:          'type-operation',
  PipelineOptions:    'type-pipeline-options',
  PipelineResult:     'type-pipeline-result',
  StrColumnView:      'type-str-column-view',
  ColumnView:         'type-column-view',
  FilterSelectionRef: 'type-filter-selection-ref',
  FilterMapRef:       'type-filter-map-ref',
  MapRefView:         'type-map-ref-view',
  RsJsOptions:        'type-rs-js-options',
};

const PATTERN = new RegExp(
  `(${Object.keys(TYPE_ANCHORS).join('|')})`,
  'g'
);

/**
 * Parses a type string and returns JSX with known type names as anchor links.
 * Safe for use in table cells and multi-line returns descriptions.
 */
export function TypeText({ text, className = '' }) {
  if (!text) return null;
  const parts = text.split(PATTERN);
  return (
    <>
      {parts.map((part, i) => {
        const anchor = TYPE_ANCHORS[part];
        if (anchor) {
          return (
            <a
              key={i}
              href={`#${anchor}`}
              className="text-violet-400 hover:text-violet-300 underline decoration-violet-500/40 hover:decoration-violet-400 transition-colors"
            >
              {part}
            </a>
          );
        }
        return <span key={i} className={className}>{part}</span>;
      })}
    </>
  );
}

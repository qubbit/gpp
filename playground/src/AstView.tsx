import { useState, memo } from "react";

// fields present on every node; shown in the position column instead of as rows
const POSITION_FIELDS = new Set(["line", "column"]);

interface AstViewProps {
  node: unknown;
  // called with a position when a node is clicked, to reveal it in the editor
  onSelect?: (line: number, column: number) => void;
}

/** renders the parsed program as a collapsible tree. */
export function AstView({ node, onSelect }: AstViewProps) {
  return (
    <div className="ast">
      <AstNode value={node} depth={0} onSelect={onSelect} />
    </div>
  );
}

interface AstNodeProps {
  value: unknown;
  label?: string;
  depth: number;
  onSelect?: (line: number, column: number) => void;
}

const AstNode = memo(function AstNode({
  value,
  label,
  depth,
  onSelect,
}: AstNodeProps) {
  // the top few levels start open, deeper ones collapsed so the tree stays
  // readable on a large program
  const [open, setOpen] = useState(depth < 3);

  if (value === null || value === undefined) {
    return <Leaf label={label} text="null" />;
  }

  if (Array.isArray(value)) {
    if (value.length === 0) return <Leaf label={label} text="[]" />;

    return (
      <div className={depth > 0 ? "ast-node nested" : "ast-node"}>
        <div
          className="ast-row clickable"
          onClick={() => setOpen(!open)}
          role="button"
          tabIndex={0}
          onKeyDown={(event) => {
            if (event.key === "Enter" || event.key === " ") {
              event.preventDefault();
              setOpen(!open);
            }
          }}
        >
          <span className="ast-toggle">{open ? "▼" : "▶"}</span>
          {label && <span className="ast-field">{label}</span>}
          <span className="ast-value">[{value.length}]</span>
        </div>
        {open &&
          value.map((item, index) => (
            <AstNode
              key={index}
              value={item}
              depth={depth + 1}
              onSelect={onSelect}
            />
          ))}
      </div>
    );
  }

  if (typeof value !== "object") {
    return <Leaf label={label} text={JSON.stringify(value)} />;
  }

  const record = value as Record<string, unknown>;
  const kind = typeof record.kind === "string" ? record.kind : null;
  const line = typeof record.line === "number" ? record.line : null;
  const column = typeof record.column === "number" ? record.column : null;

  const fields = Object.entries(record).filter(
    ([key]) => key !== "kind" && !POSITION_FIELDS.has(key),
  );

  // a node whose fields are all empty renders on one line
  const hasChildren = fields.some(([, item]) => !isEmpty(item));

  return (
    <div className={depth > 0 ? "ast-node nested" : "ast-node"}>
      <div
        className="ast-row clickable"
        onClick={() => {
          if (hasChildren) setOpen(!open);
          if (line !== null && column !== null) onSelect?.(line, column);
        }}
        role="button"
        tabIndex={0}
        onKeyDown={(event) => {
          if (event.key === "Enter" || event.key === " ") {
            event.preventDefault();
            if (hasChildren) setOpen(!open);
          }
        }}
      >
        <span className="ast-toggle">
          {hasChildren ? (open ? "▼" : "▶") : ""}
        </span>
        {label && <span className="ast-field">{label}</span>}
        <span className="ast-kind">{kind ?? "node"}</span>
        {summarize(record) && (
          <span className="ast-value">{summarize(record)}</span>
        )}
        {line !== null && (
          <span className="ast-position">
            {line}:{column}
          </span>
        )}
      </div>

      {open &&
        hasChildren &&
        fields
          .filter(([, item]) => !isEmpty(item))
          .map(([key, item]) => (
            <AstNode
              key={key}
              label={key}
              value={item}
              depth={depth + 1}
              onSelect={onSelect}
            />
          ))}
    </div>
  );
});

function Leaf({ label, text }: { label?: string; text: string }) {
  return (
    <div className="ast-node">
      <div className="ast-row">
        <span className="ast-toggle" />
        {label && <span className="ast-field">{label}</span>}
        <span className="ast-value">{text}</span>
      </div>
    </div>
  );
}

/** a short inline summary so a collapsed node still says something useful. */
function summarize(node: Record<string, unknown>): string {
  if (typeof node.name === "string") return node.name;
  if (typeof node.operator === "string") return node.operator;
  if (typeof node.property === "string") return `.${node.property}`;
  if (typeof node.key === "string") return node.key;
  if (typeof node.source === "string") return `"${node.source}"`;
  if ("value" in node) {
    const value = node.value;
    if (typeof value === "string") return JSON.stringify(value);
    if (typeof value === "number" || typeof value === "boolean") {
      return String(value);
    }
  }
  return "";
}

function isEmpty(value: unknown): boolean {
  if (value === null || value === undefined) return true;
  if (Array.isArray(value)) return value.length === 0;
  return false;
}

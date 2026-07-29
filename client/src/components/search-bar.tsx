import { useState, useRef, useEffect } from "react";
import { Search, X } from "lucide-react";

interface SearchBarProps {
  value: string;
  onChange: (value: string) => void;
  /** All candidate strings to suggest from. Pass task titles, project names, etc. */
  suggestions: string[];
  placeholder?: string;
  /** Tailwind class for the wrapper div width, e.g. "w-52" or "w-64" */
  widthClass?: string;
  "data-testid"?: string;
}

/** Highlight the matching fragment inside a suggestion string. */
function Highlight({ text, query }: { text: string; query: string }) {
  if (!query) return <>{text}</>;
  const idx = text.toLowerCase().indexOf(query.toLowerCase());
  if (idx === -1) return <>{text}</>;
  return (
    <>
      {text.slice(0, idx)}
      <span className="font-semibold text-foreground">
        {text.slice(idx, idx + query.length)}
      </span>
      {text.slice(idx + query.length)}
    </>
  );
}

export function SearchBar({
  value,
  onChange,
  suggestions,
  placeholder = "Search…",
  widthClass = "w-52",
  "data-testid": testId,
}: SearchBarProps) {
  const [open, setOpen] = useState(false);
  const [activeIdx, setActiveIdx] = useState(-1);
  const containerRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  const trimmed = value.trim();
  const queryLower = trimmed.toLowerCase();

  // Deduplicated suggestions matching the current query, capped at 8
  const matches = trimmed
    ? Array.from(new Set(suggestions))
        .filter(s => s.toLowerCase().includes(queryLower))
        .sort((a, b) => {
          // Prefix matches first
          const aPrefix = a.toLowerCase().startsWith(queryLower);
          const bPrefix = b.toLowerCase().startsWith(queryLower);
          if (aPrefix && !bPrefix) return -1;
          if (!aPrefix && bPrefix) return 1;
          return a.localeCompare(b);
        })
        .slice(0, 8)
    : [];

  const showDropdown = open && matches.length > 0;

  // Close on outside click
  useEffect(() => {
    function onMouseDown(e: MouseEvent) {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setOpen(false);
        setActiveIdx(-1);
      }
    }
    document.addEventListener("mousedown", onMouseDown);
    return () => document.removeEventListener("mousedown", onMouseDown);
  }, []);

  // Reset active index whenever matches change
  useEffect(() => {
    setActiveIdx(-1);
  }, [matches.length, trimmed]);

  function selectSuggestion(s: string) {
    onChange(s);
    setOpen(false);
    setActiveIdx(-1);
    inputRef.current?.focus();
  }

  function handleKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
    if (e.key === "ArrowDown") {
      if (!showDropdown) { setOpen(true); return; }
      e.preventDefault();
      setActiveIdx(i => (i < matches.length - 1 ? i + 1 : i));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setActiveIdx(i => Math.max(i - 1, -1));
    } else if (e.key === "Enter") {
      if (activeIdx >= 0 && matches[activeIdx]) {
        e.preventDefault();
        selectSuggestion(matches[activeIdx]);
      } else {
        setOpen(false);
      }
    } else if (e.key === "Escape") {
      setOpen(false);
      setActiveIdx(-1);
    }
  }

  return (
    <div ref={containerRef} className={`relative ${widthClass}`}>
      {/* Search icon */}
      <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-muted-foreground pointer-events-none z-10" />

      <input
        ref={inputRef}
        data-testid={testId}
        type="text"
        placeholder={placeholder}
        value={value}
        autoComplete="off"
        spellCheck={false}
        onChange={e => {
          onChange(e.target.value);
          setOpen(true);
        }}
        onFocus={() => setOpen(true)}
        onKeyDown={handleKeyDown}
        className="h-8 w-full pl-8 pr-7 text-sm rounded-md border border-input bg-background text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-ring"
      />

      {/* Clear button */}
      {value && (
        <button
          tabIndex={-1}
          onMouseDown={e => {
            e.preventDefault();
            onChange("");
            setOpen(false);
            inputRef.current?.focus();
          }}
          className="absolute right-2 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground transition-colors z-10"
          aria-label="Clear search"
        >
          <X className="w-3.5 h-3.5" />
        </button>
      )}

      {/* Suggestion dropdown */}
      {showDropdown && (
        <div className="absolute top-full left-0 right-0 mt-1 bg-popover border rounded-lg shadow-lg z-50 overflow-hidden py-1">
          {matches.map((s, i) => (
            <button
              key={s}
              onMouseDown={e => {
                e.preventDefault();
                selectSuggestion(s);
              }}
              className={`w-full text-left px-3 py-1.5 text-sm flex items-center gap-2 transition-colors ${
                i === activeIdx
                  ? "bg-accent text-accent-foreground"
                  : "text-muted-foreground hover:bg-muted hover:text-foreground"
              }`}
            >
              <Search className="w-3 h-3 shrink-0 opacity-50" />
              <span className="truncate">
                <Highlight text={s} query={trimmed} />
              </span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

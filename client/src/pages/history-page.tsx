import { useQuery } from "@tanstack/react-query";
import { Link } from "wouter";
import { ArrowLeft, BookOpen, FileText, Loader2, Sun, Moon } from "lucide-react";
import { useTheme } from "@/components/theme-provider";

type CitationRecord = {
  id: number;
  userId: number;
  documentId: number;
  chunkId: number;
  query: string;
  createdAt: string;
  documentTitle: string;
};

export default function HistoryPage() {
  const { theme, toggleTheme } = useTheme();
  const { data: citations, isLoading } = useQuery<CitationRecord[]>({
    queryKey: ["/api/citations"],
  });

  const grouped = citations?.reduce((acc, cit) => {
    const key = `${cit.query}-${cit.createdAt.slice(0, 16)}`;
    if (!acc[key]) acc[key] = { query: cit.query, createdAt: cit.createdAt, docs: [] };
    acc[key].docs.push(cit.documentTitle);
    return acc;
  }, {} as Record<string, { query: string; createdAt: string; docs: string[] }>);

  const entries = grouped ? Object.values(grouped) : [];

  return (
    <div className="min-h-screen bg-background" data-testid="history-page">
      <header className="border-b px-6 py-3 flex items-center justify-between">
        <div className="flex items-center gap-3">
          <Link href="/">
            <button data-testid="link-back" className="p-2 rounded-lg hover:bg-muted transition-colors">
              <ArrowLeft className="w-4 h-4" />
            </button>
          </Link>
          <BookOpen className="w-5 h-5 text-primary" />
          <h1 className="font-semibold text-lg">Citation History</h1>
        </div>
        <button
          data-testid="button-toggle-theme"
          onClick={toggleTheme}
          className="p-2 rounded-lg hover:bg-muted transition-colors"
          title={theme === "light" ? "Switch to dark mode" : "Switch to light mode"}
        >
          {theme === "light" ? <Moon className="w-4 h-4" /> : <Sun className="w-4 h-4" />}
        </button>
      </header>

      <div className="max-w-3xl mx-auto p-6">
        {isLoading ? (
          <div className="flex items-center justify-center py-12">
            <Loader2 className="w-5 h-5 animate-spin text-muted-foreground" />
          </div>
        ) : entries.length === 0 ? (
          <div className="text-center py-12 text-muted-foreground">
            <BookOpen className="w-8 h-8 mx-auto mb-2 opacity-30" />
            <p>No queries yet. Start asking questions!</p>
          </div>
        ) : (
          <div className="space-y-3">
            {entries.map((entry, i) => (
              <div key={i} className="border rounded-lg bg-card px-4 py-3" data-testid={`card-citation-${i}`}>
                <p className="text-sm font-medium mb-1" data-testid={`text-query-${i}`}>{entry.query}</p>
                <div className="flex flex-wrap gap-1.5 mb-2">
                  {[...new Set(entry.docs)].map((doc, di) => (
                    <span key={di} className="inline-flex items-center gap-1 px-2 py-0.5 rounded text-[11px] bg-muted text-muted-foreground">
                      <FileText className="w-3 h-3" /> {doc}
                    </span>
                  ))}
                </div>
                <p className="text-xs text-muted-foreground">
                  {new Date(entry.createdAt).toLocaleString()}
                </p>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

import { useState } from "react";
import { useAuth } from "@/lib/auth";
import { useQuery, useMutation } from "@tanstack/react-query";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { Link } from "wouter";
import { 
  Upload, FileText, Trash2, RefreshCw, ArrowLeft, Shield, 
  Users, Lock, Globe, ChevronDown, ChevronUp, Loader2,
  CheckCircle, XCircle, X
} from "lucide-react";

type Document = {
  id: number;
  title: string;
  filename: string;
  adminOnly: boolean;
  allowedUsers: string[] | null;
  allowedDomain: string | null;
  chunkCount: number;
  uploadedBy: number;
  uploadedAt: string;
};

export default function AdminPage() {
  const { user } = useAuth();
  const { toast } = useToast();
  const [expandedDoc, setExpandedDoc] = useState<number | null>(null);

  const { data: documents, isLoading } = useQuery<Document[]>({
    queryKey: ["/api/documents"],
  });

  const deleteMutation = useMutation({
    mutationFn: (id: number) => apiRequest("DELETE", `/api/documents/${id}`),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/documents"] });
      toast({ title: "Document deleted" });
    },
    onError: (err: any) => toast({ title: "Error", description: err.message, variant: "destructive" }),
  });

  const reindexMutation = useMutation({
    mutationFn: (id: number) => apiRequest("POST", `/api/documents/${id}/reindex`),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/documents"] });
      toast({ title: "Re-indexing complete" });
    },
    onError: (err: any) => toast({ title: "Error", description: err.message, variant: "destructive" }),
  });

  return (
    <div className="min-h-screen bg-background" data-testid="admin-page">
      <header className="border-b px-6 py-3 flex items-center gap-3">
        <Link href="/">
          <button data-testid="link-back" className="p-2 rounded-lg hover:bg-muted transition-colors">
            <ArrowLeft className="w-4 h-4" />
          </button>
        </Link>
        <Shield className="w-5 h-5 text-primary" />
        <h1 className="font-semibold text-lg">Document Management</h1>
      </header>

      <div className="max-w-4xl mx-auto p-6 space-y-6">
        <UploadSection />

        <div>
          <h2 className="text-sm font-medium text-muted-foreground uppercase tracking-wider mb-3">
            Documents ({documents?.length ?? 0})
          </h2>
          {isLoading ? (
            <div className="flex items-center justify-center py-12">
              <Loader2 className="w-5 h-5 animate-spin text-muted-foreground" />
            </div>
          ) : documents?.length === 0 ? (
            <div className="text-center py-12 text-muted-foreground">
              <FileText className="w-8 h-8 mx-auto mb-2 opacity-30" />
              <p>No documents uploaded yet</p>
            </div>
          ) : (
            <div className="space-y-2">
              {documents?.map(doc => (
                <div key={doc.id} className="border rounded-lg bg-card" data-testid={`card-document-${doc.id}`}>
                  <div
                    className="flex items-center justify-between px-4 py-3 cursor-pointer"
                    onClick={() => setExpandedDoc(expandedDoc === doc.id ? null : doc.id)}
                  >
                    <div className="flex items-center gap-3 min-w-0">
                      <FileText className="w-4 h-4 text-muted-foreground shrink-0" />
                      <div className="min-w-0">
                        <p className="font-medium text-sm truncate" data-testid={`text-doc-title-${doc.id}`}>{doc.title}</p>
                        <p className="text-xs text-muted-foreground">
                          {doc.chunkCount} chunks · {doc.filename}
                        </p>
                      </div>
                    </div>
                    <div className="flex items-center gap-2 shrink-0">
                      {doc.adminOnly && (
                        <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded text-[11px] bg-destructive/10 text-destructive font-medium">
                          <Lock className="w-3 h-3" /> Admin
                        </span>
                      )}
                      {doc.allowedDomain && (
                        <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded text-[11px] bg-primary/10 text-primary font-medium">
                          <Globe className="w-3 h-3" /> {doc.allowedDomain}
                        </span>
                      )}
                      {doc.allowedUsers && doc.allowedUsers.length > 0 && (
                        <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded text-[11px] bg-muted text-muted-foreground font-medium">
                          <Users className="w-3 h-3" /> {doc.allowedUsers.length}
                        </span>
                      )}
                      {expandedDoc === doc.id ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
                    </div>
                  </div>
                  {expandedDoc === doc.id && (
                    <div className="border-t px-4 py-3 space-y-3">
                      <div className="grid grid-cols-2 gap-4 text-sm">
                        <div>
                          <span className="text-muted-foreground">Uploaded:</span>{" "}
                          {new Date(doc.uploadedAt).toLocaleDateString()}
                        </div>
                        <div>
                          <span className="text-muted-foreground">Access:</span>{" "}
                          {doc.adminOnly ? "Admin only" : doc.allowedDomain ? `@${doc.allowedDomain}` : doc.allowedUsers?.length ? `${doc.allowedUsers.length} users` : "All users"}
                        </div>
                      </div>
                      {doc.allowedUsers && doc.allowedUsers.length > 0 && (
                        <div className="text-xs text-muted-foreground">
                          <span className="font-medium">Allowed users:</span> {doc.allowedUsers.join(", ")}
                        </div>
                      )}
                      <div className="flex gap-2">
                        <button
                          data-testid={`button-reindex-${doc.id}`}
                          onClick={() => reindexMutation.mutate(doc.id)}
                          disabled={reindexMutation.isPending}
                          className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs rounded-md border hover:bg-muted transition-colors disabled:opacity-50"
                        >
                          <RefreshCw className={`w-3.5 h-3.5 ${reindexMutation.isPending ? "animate-spin" : ""}`} />
                          Re-index
                        </button>
                        <button
                          data-testid={`button-delete-${doc.id}`}
                          onClick={() => {
                            if (confirm("Delete this document and all its chunks?")) {
                              deleteMutation.mutate(doc.id);
                            }
                          }}
                          disabled={deleteMutation.isPending}
                          className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs rounded-md border border-destructive/30 text-destructive hover:bg-destructive/10 transition-colors disabled:opacity-50"
                        >
                          <Trash2 className="w-3.5 h-3.5" />
                          Delete
                        </button>
                      </div>
                    </div>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

type FileStatus = {
  file: File;
  status: "pending" | "uploading" | "done" | "error";
  error?: string;
};

function UploadSection() {
  const { toast } = useToast();
  const [files, setFiles] = useState<FileStatus[]>([]);
  const [adminOnly, setAdminOnly] = useState(false);
  const [allowedDomain, setAllowedDomain] = useState("");
  const [allowedUsersStr, setAllowedUsersStr] = useState("");
  const [uploading, setUploading] = useState(false);

  function handleFilesSelected(e: React.ChangeEvent<HTMLInputElement>) {
    const selected = e.target.files;
    if (!selected) return;
    const newFiles: FileStatus[] = Array.from(selected).map(f => ({ file: f, status: "pending" as const }));
    setFiles(prev => [...prev, ...newFiles]);
    e.target.value = "";
  }

  function removeFile(index: number) {
    setFiles(prev => prev.filter((_, i) => i !== index));
  }

  async function handleUpload(e: React.FormEvent) {
    e.preventDefault();
    const pendingFiles = files.filter(f => f.status === "pending");
    if (pendingFiles.length === 0) return;

    setUploading(true);
    let successCount = 0;
    let failCount = 0;

    for (let i = 0; i < files.length; i++) {
      if (files[i].status !== "pending") continue;

      setFiles(prev => prev.map((f, idx) => idx === i ? { ...f, status: "uploading" } : f));

      try {
        const formData = new FormData();
        formData.append("file", files[i].file);
        formData.append("title", files[i].file.name);
        formData.append("adminOnly", String(adminOnly));
        if (allowedDomain.trim()) formData.append("allowedDomain", allowedDomain.trim());
        if (allowedUsersStr.trim()) {
          const users = allowedUsersStr.split(",").map(s => s.trim()).filter(Boolean);
          formData.append("allowedUsers", JSON.stringify(users));
        }

        const res = await fetch("/api/documents", {
          method: "POST",
          credentials: "include",
          body: formData,
        });

        if (!res.ok) {
          const err = await res.json();
          throw new Error(err.message);
        }

        setFiles(prev => prev.map((f, idx) => idx === i ? { ...f, status: "done" } : f));
        successCount++;
      } catch (err: any) {
        setFiles(prev => prev.map((f, idx) => idx === i ? { ...f, status: "error", error: err.message } : f));
        failCount++;
      }
    }

    queryClient.invalidateQueries({ queryKey: ["/api/documents"] });
    
    if (successCount > 0 && failCount === 0) {
      toast({ title: `${successCount} document${successCount > 1 ? "s" : ""} uploaded and indexed` });
    } else if (successCount > 0 && failCount > 0) {
      toast({ title: `${successCount} uploaded, ${failCount} failed`, variant: "destructive" });
    } else {
      toast({ title: "All uploads failed", variant: "destructive" });
    }

    setUploading(false);
  }

  function clearCompleted() {
    setFiles(prev => prev.filter(f => f.status !== "done"));
  }

  const pendingCount = files.filter(f => f.status === "pending").length;
  const doneCount = files.filter(f => f.status === "done").length;

  return (
    <div className="border rounded-lg bg-card p-5">
      <h2 className="text-sm font-medium text-muted-foreground uppercase tracking-wider mb-4">Upload Documents</h2>
      <form onSubmit={handleUpload} className="space-y-4">
        <div>
          <label className="text-sm font-medium mb-1.5 block">Files (.txt, .md, .pdf)</label>
          <input
            data-testid="input-doc-files"
            type="file"
            multiple
            accept=".txt,.md,.pdf,text/plain,text/markdown,application/pdf"
            onChange={handleFilesSelected}
            className="w-full px-3 py-2 rounded-lg border border-input bg-background text-sm file:mr-3 file:rounded-md file:border-0 file:bg-muted file:px-3 file:py-1 file:text-xs file:font-medium"
          />
          <p className="text-xs text-muted-foreground mt-1">Select multiple files at once or add more files before uploading</p>
        </div>

        {files.length > 0 && (
          <div className="space-y-1.5 max-h-48 overflow-y-auto">
            {files.map((f, i) => (
              <div key={i} className="flex items-center justify-between px-3 py-2 rounded-md bg-muted/40 text-sm" data-testid={`file-item-${i}`}>
                <div className="flex items-center gap-2 min-w-0">
                  {f.status === "pending" && <FileText className="w-3.5 h-3.5 text-muted-foreground shrink-0" />}
                  {f.status === "uploading" && <Loader2 className="w-3.5 h-3.5 animate-spin text-primary shrink-0" />}
                  {f.status === "done" && <CheckCircle className="w-3.5 h-3.5 text-green-500 shrink-0" />}
                  {f.status === "error" && <XCircle className="w-3.5 h-3.5 text-destructive shrink-0" />}
                  <span className="truncate">{f.file.name}</span>
                  <span className="text-xs text-muted-foreground shrink-0">({(f.file.size / 1024).toFixed(0)} KB)</span>
                </div>
                <div className="flex items-center gap-2 shrink-0">
                  {f.status === "error" && (
                    <span className="text-xs text-destructive max-w-[200px] truncate" title={f.error}>{f.error}</span>
                  )}
                  {f.status === "pending" && (
                    <button type="button" onClick={() => removeFile(i)} className="p-0.5 hover:bg-muted rounded" data-testid={`button-remove-file-${i}`}>
                      <X className="w-3.5 h-3.5 text-muted-foreground" />
                    </button>
                  )}
                </div>
              </div>
            ))}
          </div>
        )}

        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          <div className="flex items-center gap-2">
            <input
              data-testid="input-admin-only"
              type="checkbox"
              id="adminOnly"
              checked={adminOnly}
              onChange={(e) => setAdminOnly(e.target.checked)}
              className="rounded border-input"
            />
            <label htmlFor="adminOnly" className="text-sm">Admin only</label>
          </div>
          <div>
            <label className="text-sm font-medium mb-1.5 block">Allowed domain</label>
            <input
              data-testid="input-allowed-domain"
              type="text"
              value={allowedDomain}
              onChange={(e) => setAllowedDomain(e.target.value)}
              className="w-full px-3 py-2 rounded-lg border border-input bg-background text-sm focus:outline-none focus:ring-2 focus:ring-ring"
              placeholder="e.g. company.com"
            />
          </div>
          <div>
            <label className="text-sm font-medium mb-1.5 block">Allowed users (emails)</label>
            <input
              data-testid="input-allowed-users"
              type="text"
              value={allowedUsersStr}
              onChange={(e) => setAllowedUsersStr(e.target.value)}
              className="w-full px-3 py-2 rounded-lg border border-input bg-background text-sm focus:outline-none focus:ring-2 focus:ring-ring"
              placeholder="user@co.com, user2@co.com"
            />
          </div>
        </div>

        <div className="flex items-center gap-3">
          <button
            data-testid="button-upload"
            type="submit"
            disabled={pendingCount === 0 || uploading}
            className="inline-flex items-center gap-2 px-4 py-2 rounded-lg bg-primary text-primary-foreground text-sm font-medium hover:opacity-90 disabled:opacity-50 transition-opacity"
          >
            {uploading ? <Loader2 className="w-4 h-4 animate-spin" /> : <Upload className="w-4 h-4" />}
            {uploading ? "Uploading..." : `Upload & Index (${pendingCount} file${pendingCount !== 1 ? "s" : ""})`}
          </button>
          {doneCount > 0 && (
            <button
              type="button"
              onClick={clearCompleted}
              className="text-xs text-muted-foreground hover:text-foreground transition-colors"
              data-testid="button-clear-completed"
            >
              Clear completed
            </button>
          )}
        </div>
      </form>
    </div>
  );
}

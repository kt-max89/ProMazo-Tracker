import { useState } from "react";
import { LivePresence } from "@/lib/live";
import { useAuth } from "@/lib/auth";
import { useQuery, useMutation } from "@tanstack/react-query";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { Link } from "wouter";
import { 
  Upload, FileText, Trash2, RefreshCw, ArrowLeft, Shield, 
  Users, Lock, Globe, ChevronDown, ChevronUp, Loader2,
  CheckCircle, XCircle, X, Sun, Moon, Save, Search, Download, HardDrive, FolderOpen
} from "lucide-react";
import { useTheme } from "@/components/theme-provider";
import UserManagement from "@/components/user-management";

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
  const { theme, toggleTheme } = useTheme();
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
      <header className="border-b px-6 py-3 flex items-center justify-between">
        <div className="flex items-center gap-3">
          <Link href="/">
            <button data-testid="link-back" className="p-2 rounded-lg hover:bg-muted transition-colors">
              <ArrowLeft className="w-4 h-4" />
            </button>
          </Link>
          <Shield className="w-5 h-5 text-primary" />
          <h1 className="font-semibold text-lg">Document Management</h1>
        </div>
        <button
          data-testid="button-toggle-theme"
          onClick={toggleTheme}
          className="p-2 rounded-lg hover:bg-muted transition-colors"
          title={theme === "light" ? "Switch to dark mode" : "Switch to light mode"}
        >
          {theme === "light" ? <Moon className="w-4 h-4" /> : <Sun className="w-4 h-4" />}
        </button>
        <LivePresence />
      </header>

      <div className="max-w-4xl mx-auto p-6 space-y-6">
        <UserManagement />
        <UploadSection />
        <DriveImportSection />

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
                    <DocumentAccessEditor
                      doc={doc}
                      onReindex={() => reindexMutation.mutate(doc.id)}
                      onDelete={() => {
                        if (confirm("Delete this document and all its chunks?")) {
                          deleteMutation.mutate(doc.id);
                        }
                      }}
                      reindexPending={reindexMutation.isPending}
                      deletePending={deleteMutation.isPending}
                    />
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

        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div className="flex items-center gap-2">
            <input
              data-testid="input-admin-only"
              type="checkbox"
              id="adminOnly"
              checked={adminOnly}
              onChange={(e) => setAdminOnly(e.target.checked)}
              className="rounded border-input"
            />
            <label htmlFor="adminOnly" className="text-sm">Admin only <span className="text-muted-foreground font-normal">(unchecked = all users)</span></label>
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

type DriveFile = {
  id: string;
  name: string;
  mimeType: string;
  modifiedTime?: string;
  size?: string;
};

type DriveFolder = {
  id: string;
  name: string;
  modifiedTime?: string;
};

type FolderImportResult = {
  name: string;
  status: string;
  error?: string;
};

function DriveImportSection() {
  const { toast } = useToast();
  const [mode, setMode] = useState<"files" | "folders">("files");
  const [searchQuery, setSearchQuery] = useState("");
  const [files, setFiles] = useState<DriveFile[]>([]);
  const [folders, setFolders] = useState<DriveFolder[]>([]);
  const [loading, setLoading] = useState(false);
  const [searched, setSearched] = useState(false);
  const [importingId, setImportingId] = useState<string | null>(null);
  const [nextPageToken, setNextPageToken] = useState<string | undefined>();
  const [adminOnly, setAdminOnly] = useState(false);
  const [allowedDomain, setAllowedDomain] = useState("");
  const [folderImporting, setFolderImporting] = useState(false);
  const [folderResults, setFolderResults] = useState<FolderImportResult[] | null>(null);

  function switchMode(newMode: "files" | "folders") {
    setMode(newMode);
    setSearchQuery("");
    setFiles([]);
    setFolders([]);
    setSearched(false);
    setNextPageToken(undefined);
    setFolderResults(null);
  }

  async function search() {
    setLoading(true);
    setSearched(true);
    setFolderResults(null);
    try {
      const params = new URLSearchParams();
      if (searchQuery.trim()) params.set("q", searchQuery.trim());
      const endpoint = mode === "files" ? "/api/drive/files" : "/api/drive/folders";
      const res = await fetch(`${endpoint}?${params.toString()}`, { credentials: "include" });
      if (!res.ok) {
        const err = await res.json();
        throw new Error(err.message);
      }
      const data = await res.json();
      if (mode === "files") {
        setFiles(data.files || []);
      } else {
        setFolders(data.folders || []);
      }
      setNextPageToken(data.nextPageToken);
    } catch (err: any) {
      toast({ title: `Error loading Drive ${mode}`, description: err.message, variant: "destructive" });
    } finally {
      setLoading(false);
    }
  }

  async function loadMore() {
    if (!nextPageToken) return;
    setLoading(true);
    try {
      const params = new URLSearchParams();
      if (searchQuery.trim()) params.set("q", searchQuery.trim());
      params.set("pageToken", nextPageToken);
      const endpoint = mode === "files" ? "/api/drive/files" : "/api/drive/folders";
      const res = await fetch(`${endpoint}?${params.toString()}`, { credentials: "include" });
      if (!res.ok) {
        const err = await res.json();
        throw new Error(err.message);
      }
      const data = await res.json();
      if (mode === "files") {
        setFiles(prev => [...prev, ...(data.files || [])]);
      } else {
        setFolders(prev => [...prev, ...(data.folders || [])]);
      }
      setNextPageToken(data.nextPageToken);
    } catch (err: any) {
      toast({ title: "Error", description: err.message, variant: "destructive" });
    } finally {
      setLoading(false);
    }
  }

  async function importFile(file: DriveFile) {
    setImportingId(file.id);
    try {
      const res = await fetch("/api/drive/import", {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          fileId: file.id,
          mimeType: file.mimeType,
          adminOnly,
          allowedDomain: allowedDomain.trim() || null,
          allowedUsers: [],
        }),
      });
      if (!res.ok) {
        const err = await res.json();
        throw new Error(err.message);
      }
      queryClient.invalidateQueries({ queryKey: ["/api/documents"] });
      toast({ title: `"${file.name}" imported and indexed` });
    } catch (err: any) {
      toast({ title: "Import failed", description: err.message, variant: "destructive" });
    } finally {
      setImportingId(null);
    }
  }

  async function importFolder(folder: DriveFolder) {
    setFolderImporting(true);
    setImportingId(folder.id);
    setFolderResults(null);
    try {
      const res = await fetch("/api/drive/import-folder", {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ folderId: folder.id }),
      });
      if (!res.ok) {
        const err = await res.json();
        throw new Error(err.message);
      }
      const data = await res.json();
      setFolderResults(data.results || []);
      queryClient.invalidateQueries({ queryKey: ["/api/documents"] });
      const parts = [];
      if (data.imported > 0) parts.push(`${data.imported} imported`);
      if (data.skipped > 0) parts.push(`${data.skipped} skipped`);
      if (data.failed > 0) parts.push(`${data.failed} failed`);
      toast({
        title: `Folder "${folder.name}" processed`,
        description: parts.join(", ") || "No files processed",
        variant: data.failed > 0 ? "destructive" : undefined,
      });
    } catch (err: any) {
      toast({ title: "Folder import failed", description: err.message, variant: "destructive" });
    } finally {
      setFolderImporting(false);
      setImportingId(null);
    }
  }

  function getMimeLabel(mimeType: string) {
    if (mimeType === "application/vnd.google-apps.document") return "Google Doc";
    if (mimeType === "application/pdf") return "PDF";
    if (mimeType === "text/plain") return "Text";
    if (mimeType === "text/markdown") return "Markdown";
    return mimeType;
  }

  return (
    <div className="border rounded-lg bg-card p-5">
      <h2 className="text-sm font-medium text-muted-foreground uppercase tracking-wider mb-4 flex items-center gap-2">
        <HardDrive className="w-4 h-4" />
        Import from Google Drive
      </h2>

      <div className="flex gap-1 mb-4 border-b">
        <button
          data-testid="tab-drive-files"
          onClick={() => switchMode("files")}
          className={`px-4 py-2 text-sm font-medium border-b-2 transition-colors ${
            mode === "files"
              ? "border-primary text-primary"
              : "border-transparent text-muted-foreground hover:text-foreground"
          }`}
        >
          <span className="flex items-center gap-1.5"><FileText className="w-3.5 h-3.5" /> Files</span>
        </button>
        <button
          data-testid="tab-drive-folders"
          onClick={() => switchMode("folders")}
          className={`px-4 py-2 text-sm font-medium border-b-2 transition-colors ${
            mode === "folders"
              ? "border-primary text-primary"
              : "border-transparent text-muted-foreground hover:text-foreground"
          }`}
        >
          <span className="flex items-center gap-1.5"><FolderOpen className="w-3.5 h-3.5" /> Folders</span>
        </button>
      </div>

      <div className="flex gap-2 mb-4">
        <input
          data-testid="input-drive-search"
          type="text"
          value={searchQuery}
          onChange={(e) => setSearchQuery(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && search()}
          placeholder={mode === "files" ? "Search your Drive files..." : "Search your Drive folders..."}
          className="flex-1 px-3 py-2 rounded-lg border border-input bg-background text-sm focus:outline-none focus:ring-2 focus:ring-ring"
        />
        <button
          data-testid="button-drive-search"
          onClick={search}
          disabled={loading && !importingId}
          className="inline-flex items-center gap-2 px-4 py-2 rounded-lg bg-primary text-primary-foreground text-sm font-medium hover:opacity-90 disabled:opacity-50 transition-opacity"
        >
          {loading && !importingId ? <Loader2 className="w-4 h-4 animate-spin" /> : <Search className="w-4 h-4" />}
          Browse
        </button>
      </div>

      {mode === "files" && (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-4">
          <div className="flex items-center gap-2">
            <input
              data-testid="input-drive-admin-only"
              type="checkbox"
              id="driveAdminOnly"
              checked={adminOnly}
              onChange={(e) => setAdminOnly(e.target.checked)}
              className="rounded border-input"
            />
            <label htmlFor="driveAdminOnly" className="text-sm">Admin only <span className="text-muted-foreground font-normal">(unchecked = all users)</span></label>
          </div>
          <div>
            <label className="text-sm font-medium mb-1.5 block">Allowed domain</label>
            <input
              data-testid="input-drive-allowed-domain"
              type="text"
              value={allowedDomain}
              onChange={(e) => setAllowedDomain(e.target.value)}
              className="w-full px-3 py-2 rounded-lg border border-input bg-background text-sm focus:outline-none focus:ring-2 focus:ring-ring"
              placeholder="e.g. company.com"
            />
          </div>
        </div>
      )}

      {mode === "folders" && searched && !folderImporting && (
        <div className="mb-4 px-3 py-2 rounded-lg bg-muted/40 text-xs text-muted-foreground">
          Folder imports automatically sync access controls from Google Drive sharing permissions. Users who have access to a file in Drive will have access in this app.
        </div>
      )}

      {searched && !loading && mode === "files" && files.length === 0 && (
        <p className="text-sm text-muted-foreground text-center py-4">No compatible files found. Supported: PDF, Text, Markdown, Google Docs.</p>
      )}

      {searched && !loading && mode === "folders" && folders.length === 0 && !folderImporting && (
        <p className="text-sm text-muted-foreground text-center py-4">No folders found.</p>
      )}

      {mode === "files" && files.length > 0 && (
        <div className="space-y-1.5 max-h-64 overflow-y-auto">
          {files.map((file) => (
            <div
              key={file.id}
              data-testid={`drive-file-${file.id}`}
              className="flex items-center justify-between px-3 py-2 rounded-md bg-muted/40 text-sm"
            >
              <div className="flex items-center gap-2 min-w-0">
                <FileText className="w-3.5 h-3.5 text-muted-foreground shrink-0" />
                <span className="truncate">{file.name}</span>
                <span className="text-xs text-muted-foreground shrink-0">({getMimeLabel(file.mimeType)})</span>
                {file.modifiedTime && (
                  <span className="text-xs text-muted-foreground shrink-0">
                    {new Date(file.modifiedTime).toLocaleDateString()}
                  </span>
                )}
              </div>
              <button
                data-testid={`button-import-${file.id}`}
                onClick={() => importFile(file)}
                disabled={importingId === file.id}
                className="inline-flex items-center gap-1.5 px-2.5 py-1 text-xs rounded-md bg-primary text-primary-foreground hover:opacity-90 disabled:opacity-50 transition-opacity shrink-0 ml-2"
              >
                {importingId === file.id ? (
                  <Loader2 className="w-3.5 h-3.5 animate-spin" />
                ) : (
                  <Download className="w-3.5 h-3.5" />
                )}
                Import
              </button>
            </div>
          ))}
        </div>
      )}

      {mode === "folders" && folders.length > 0 && (
        <div className="space-y-1.5 max-h-64 overflow-y-auto">
          {folders.map((folder) => (
            <div
              key={folder.id}
              data-testid={`drive-folder-${folder.id}`}
              className="flex items-center justify-between px-3 py-2 rounded-md bg-muted/40 text-sm"
            >
              <div className="flex items-center gap-2 min-w-0">
                <FolderOpen className="w-3.5 h-3.5 text-muted-foreground shrink-0" />
                <span className="truncate">{folder.name}</span>
                {folder.modifiedTime && (
                  <span className="text-xs text-muted-foreground shrink-0">
                    {new Date(folder.modifiedTime).toLocaleDateString()}
                  </span>
                )}
              </div>
              <button
                data-testid={`button-import-folder-${folder.id}`}
                onClick={() => importFolder(folder)}
                disabled={folderImporting}
                className="inline-flex items-center gap-1.5 px-2.5 py-1 text-xs rounded-md bg-primary text-primary-foreground hover:opacity-90 disabled:opacity-50 transition-opacity shrink-0 ml-2"
              >
                {importingId === folder.id && folderImporting ? (
                  <Loader2 className="w-3.5 h-3.5 animate-spin" />
                ) : (
                  <Download className="w-3.5 h-3.5" />
                )}
                Import All Files
              </button>
            </div>
          ))}
        </div>
      )}

      {folderImporting && (
        <div className="mt-3 flex items-center gap-2 text-sm text-muted-foreground">
          <Loader2 className="w-4 h-4 animate-spin" />
          Importing folder contents... This may take a minute for large folders.
        </div>
      )}

      {folderResults && folderResults.length > 0 && (
        <div className="mt-3 space-y-1">
          <h3 className="text-xs font-medium text-muted-foreground uppercase tracking-wider mb-1.5">Import Results</h3>
          <div className="space-y-1 max-h-48 overflow-y-auto">
            {folderResults.map((r, i) => (
              <div key={i} className="flex items-center gap-2 px-3 py-1.5 rounded-md bg-muted/40 text-xs">
                {r.status === "imported" && <CheckCircle className="w-3.5 h-3.5 text-green-500 shrink-0" />}
                {r.status === "skipped" && <XCircle className="w-3.5 h-3.5 text-yellow-500 shrink-0" />}
                {r.status === "failed" && <XCircle className="w-3.5 h-3.5 text-destructive shrink-0" />}
                <span className="truncate">{r.name}</span>
                <span className="text-muted-foreground shrink-0">— {r.status}</span>
                {r.error && <span className="text-muted-foreground truncate" title={r.error}>({r.error})</span>}
              </div>
            ))}
          </div>
        </div>
      )}

      {nextPageToken && !folderImporting && (
        <button
          data-testid="button-drive-load-more"
          onClick={loadMore}
          disabled={loading}
          className="mt-2 text-xs text-primary hover:underline disabled:opacity-50"
        >
          Load more...
        </button>
      )}
    </div>
  );
}

function DocumentAccessEditor({
  doc,
  onReindex,
  onDelete,
  reindexPending,
  deletePending,
}: {
  doc: Document;
  onReindex: () => void;
  onDelete: () => void;
  reindexPending: boolean;
  deletePending: boolean;
}) {
  const { toast } = useToast();
  const [editAdminOnly, setEditAdminOnly] = useState(doc.adminOnly);
  const [editDomain, setEditDomain] = useState(doc.allowedDomain || "");
  const [saving, setSaving] = useState(false);

  const hasChanges =
    editAdminOnly !== doc.adminOnly ||
    editDomain !== (doc.allowedDomain || "");

  async function handleSaveAccess() {
    setSaving(true);
    try {
      await apiRequest("PATCH", `/api/documents/${doc.id}`, {
        adminOnly: editAdminOnly,
        allowedDomain: editDomain.trim() || null,
        allowedUsers: [],
      });
      queryClient.invalidateQueries({ queryKey: ["/api/documents"] });
      toast({ title: "Access settings updated" });
    } catch (err: any) {
      toast({ title: "Error", description: err.message, variant: "destructive" });
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="border-t px-4 py-3 space-y-4">
      <div className="text-sm text-muted-foreground">
        Uploaded: {new Date(doc.uploadedAt).toLocaleDateString()} · {doc.chunkCount} chunks
      </div>

      <div className="space-y-3">
        <h3 className="text-xs font-medium text-muted-foreground uppercase tracking-wider">Access Control</h3>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
          <div className="flex items-center gap-2">
            <input
              data-testid={`input-edit-admin-only-${doc.id}`}
              type="checkbox"
              id={`editAdminOnly-${doc.id}`}
              checked={editAdminOnly}
              onChange={(e) => setEditAdminOnly(e.target.checked)}
              className="rounded border-input"
            />
            <label htmlFor={`editAdminOnly-${doc.id}`} className="text-sm">Admin only <span className="text-muted-foreground font-normal">(unchecked = all users)</span></label>
          </div>
          <div>
            <label className="text-xs font-medium mb-1 block">Allowed domain</label>
            <input
              data-testid={`input-edit-domain-${doc.id}`}
              type="text"
              value={editDomain}
              onChange={(e) => setEditDomain(e.target.value)}
              className="w-full px-3 py-1.5 rounded-lg border border-input bg-background text-sm focus:outline-none focus:ring-2 focus:ring-ring"
              placeholder="e.g. company.com"
            />
          </div>
        </div>
      </div>

      <div className="flex gap-2">
        {hasChanges && (
          <button
            data-testid={`button-save-access-${doc.id}`}
            onClick={handleSaveAccess}
            disabled={saving}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs rounded-md bg-primary text-primary-foreground hover:opacity-90 transition-opacity disabled:opacity-50"
          >
            {saving ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Save className="w-3.5 h-3.5" />}
            Save Access
          </button>
        )}
        <button
          data-testid={`button-reindex-${doc.id}`}
          onClick={onReindex}
          disabled={reindexPending}
          className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs rounded-md border hover:bg-muted transition-colors disabled:opacity-50"
        >
          <RefreshCw className={`w-3.5 h-3.5 ${reindexPending ? "animate-spin" : ""}`} />
          Re-index
        </button>
        <button
          data-testid={`button-delete-${doc.id}`}
          onClick={onDelete}
          disabled={deletePending}
          className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs rounded-md border border-destructive/30 text-destructive hover:bg-destructive/10 transition-colors disabled:opacity-50"
        >
          <Trash2 className="w-3.5 h-3.5" />
          Delete
        </button>
      </div>
    </div>
  );
}

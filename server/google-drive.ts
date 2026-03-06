import { ReplitConnectors } from "@replit/connectors-sdk";

const connectors = new ReplitConnectors();

export type DriveFile = {
  id: string;
  name: string;
  mimeType: string;
  modifiedTime?: string;
  size?: string;
};

export type DriveFolder = {
  id: string;
  name: string;
  modifiedTime?: string;
};

export type DrivePermission = {
  emailAddress?: string;
  domain?: string;
  role: string;
  type: string;
};

const SUPPORTED_TYPES = [
  "application/pdf",
  "text/plain",
  "text/markdown",
  "application/vnd.google-apps.document",
];

export async function listDriveFiles(query?: string, pageToken?: string): Promise<{ files: DriveFile[]; nextPageToken?: string }> {
  let q = "trashed = false";
  q += ` and (${SUPPORTED_TYPES.map(t => `mimeType = '${t}'`).join(" or ")})`;

  if (query) {
    q += ` and name contains '${query.replace(/'/g, "\\'")}'`;
  }

  const params = new URLSearchParams({
    q,
    fields: "nextPageToken,files(id,name,mimeType,modifiedTime,size)",
    pageSize: "20",
    orderBy: "modifiedTime desc",
  });
  if (pageToken) params.set("pageToken", pageToken);

  const response = await connectors.proxy("google-drive", `/drive/v3/files?${params.toString()}`, {
    method: "GET",
  });
  const data = await response.json();
  return {
    files: data.files || [],
    nextPageToken: data.nextPageToken,
  };
}

export async function listDriveFolders(query?: string, pageToken?: string): Promise<{ folders: DriveFolder[]; nextPageToken?: string }> {
  let q = "trashed = false and mimeType = 'application/vnd.google-apps.folder'";

  if (query) {
    q += ` and name contains '${query.replace(/'/g, "\\'")}'`;
  }

  const params = new URLSearchParams({
    q,
    fields: "nextPageToken,files(id,name,modifiedTime)",
    pageSize: "20",
    orderBy: "modifiedTime desc",
  });
  if (pageToken) params.set("pageToken", pageToken);

  const response = await connectors.proxy("google-drive", `/drive/v3/files?${params.toString()}`, {
    method: "GET",
  });
  const data = await response.json();
  return {
    folders: (data.files || []).map((f: any) => ({
      id: f.id,
      name: f.name,
      modifiedTime: f.modifiedTime,
    })),
    nextPageToken: data.nextPageToken,
  };
}

export async function listFilesInFolder(folderId: string): Promise<DriveFile[]> {
  const allFiles: DriveFile[] = [];
  const foldersToProcess = [folderId];

  while (foldersToProcess.length > 0) {
    const currentFolderId = foldersToProcess.shift()!;
    let pageToken: string | undefined;

    do {
      const q = `'${currentFolderId}' in parents and trashed = false`;
      const params = new URLSearchParams({
        q,
        fields: "nextPageToken,files(id,name,mimeType,modifiedTime,size)",
        pageSize: "100",
      });
      if (pageToken) params.set("pageToken", pageToken);

      const response = await connectors.proxy("google-drive", `/drive/v3/files?${params.toString()}`, {
        method: "GET",
      });
      const data = await response.json();
      const items: any[] = data.files || [];

      for (const item of items) {
        if (item.mimeType === "application/vnd.google-apps.folder") {
          foldersToProcess.push(item.id);
        } else if (SUPPORTED_TYPES.includes(item.mimeType)) {
          allFiles.push(item);
        }
      }

      pageToken = data.nextPageToken;
    } while (pageToken);
  }

  return allFiles;
}

export type ParsedPermissions = {
  userEmails: string[];
  domain: string | null;
  isPublic: boolean;
};

export async function getFilePermissions(fileId: string): Promise<ParsedPermissions> {
  try {
    const params = new URLSearchParams({
      fields: "permissions(emailAddress,role,type,domain)",
    });
    const response = await connectors.proxy("google-drive", `/drive/v3/files/${fileId}?${params.toString()}`, {
      method: "GET",
    });
    const data = await response.json();
    const permissions: DrivePermission[] = data.permissions || [];

    const userEmails = permissions
      .filter(p => p.type === "user" && p.emailAddress)
      .map(p => p.emailAddress!.toLowerCase());

    const domainPerm = permissions.find(p => p.type === "domain" && p.domain);
    const domain = domainPerm?.domain || null;

    const isPublic = permissions.some(p => p.type === "anyone");

    return { userEmails, domain, isPublic };
  } catch {
    return { userEmails: [], domain: null, isPublic: false };
  }
}

export async function getDriveFileContent(fileId: string, mimeType: string): Promise<{ text: string; name: string }> {
  let text = "";
  let name = "";

  const metaResponse = await connectors.proxy("google-drive", `/drive/v3/files/${fileId}?fields=name,mimeType`, {
    method: "GET",
  });
  const meta = await metaResponse.json();
  name = meta.name || "Untitled";

  if (mimeType === "application/vnd.google-apps.document") {
    const exportResponse = await connectors.proxy("google-drive", `/drive/v3/files/${fileId}/export?mimeType=text/plain`, {
      method: "GET",
    });
    text = await exportResponse.text();
  } else if (mimeType === "application/pdf") {
    const downloadResponse = await connectors.proxy("google-drive", `/drive/v3/files/${fileId}?alt=media`, {
      method: "GET",
    });
    const arrayBuffer = await downloadResponse.arrayBuffer();
    const buffer = Buffer.from(arrayBuffer);
    const { PDFParse } = await import("pdf-parse");
    const parser = new PDFParse({ data: new Uint8Array(buffer) });
    await parser.load();
    const pdfResult = await parser.getText();
    text = pdfResult.text;
  } else {
    const downloadResponse = await connectors.proxy("google-drive", `/drive/v3/files/${fileId}?alt=media`, {
      method: "GET",
    });
    text = await downloadResponse.text();
  }

  return { text, name };
}

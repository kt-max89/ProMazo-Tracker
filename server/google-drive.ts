import { ReplitConnectors } from "@replit/connectors-sdk";

const connectors = new ReplitConnectors();

export type DriveFile = {
  id: string;
  name: string;
  mimeType: string;
  modifiedTime?: string;
  size?: string;
};

export async function listDriveFiles(query?: string, pageToken?: string): Promise<{ files: DriveFile[]; nextPageToken?: string }> {
  let q = "trashed = false";
  const supportedTypes = [
    "application/pdf",
    "text/plain",
    "text/markdown",
    "application/vnd.google-apps.document",
  ];
  q += ` and (${supportedTypes.map(t => `mimeType = '${t}'`).join(" or ")})`;

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

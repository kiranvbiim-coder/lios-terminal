import multer from "multer";

export const INTERNAL_UPLOAD_LIMIT_BYTES = 25 * 1024 * 1024;
export const CLIENT_UPLOAD_LIMIT_BYTES = 20 * 1024 * 1024;

export function extensionOf(fileName: string): string {
  const dot = fileName.lastIndexOf(".");
  return dot < 0 ? "" : fileName.slice(dot + 1).toLowerCase();
}

function hasPrefix(buffer: Buffer, bytes: number[]): boolean {
  return buffer.length >= bytes.length && bytes.every((byte, index) => buffer[index] === byte);
}

export function safeUploadFileName(name: string): string {
  const base = name.replace(/\\/g, "/").split("/").pop() || "upload";
  const stripped = base.replace(/[\u0000-\u001f\u007f]/g, "_").trim();
  return stripped.slice(0, 180) || "upload";
}

export function validateUploadFileSignature(buffer: Buffer, extension: string): string | null {
  const ext = extension.toLowerCase();
  if (buffer.length === 0) return "Uploaded file is empty.";
  if (["csv", "tsv", "txt", "json"].includes(ext)) {
    return buffer.includes(0) ? "Text upload contains binary/NUL bytes and was rejected." : null;
  }
  if (["xlsx", "ods", "docx", "pptx"].includes(ext)) {
    return hasPrefix(buffer, [0x50, 0x4b, 0x03, 0x04])
      || hasPrefix(buffer, [0x50, 0x4b, 0x05, 0x06])
      || hasPrefix(buffer, [0x50, 0x4b, 0x07, 0x08])
      ? null
      : "Office document content is not a valid ZIP container.";
  }
  if (ext === "xls") {
    return hasPrefix(buffer, [0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1])
      ? null
      : "Spreadsheet content is not a valid legacy XLS container.";
  }
  if (ext === "pdf") {
    return hasPrefix(buffer, [0x25, 0x50, 0x44, 0x46]) ? null : "File content is not a valid PDF.";
  }
  if (ext === "png") {
    return hasPrefix(buffer, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]) ? null : "File content is not a valid PNG.";
  }
  if (ext === "jpg" || ext === "jpeg") {
    return hasPrefix(buffer, [0xff, 0xd8, 0xff]) ? null : "File content is not a valid JPEG.";
  }
  if (ext === "webp") {
    return buffer.length >= 12
      && buffer.toString("ascii", 0, 4) === "RIFF"
      && buffer.toString("ascii", 8, 12) === "WEBP"
      ? null
      : "File content is not a valid WebP image.";
  }
  return null;
}

export interface MemoryUploadLimits {
  fields?: number;
  parts?: number;
}

export function createMemoryUpload(
  allowedExtensions: readonly string[],
  fileSize: number,
  limits: MemoryUploadLimits = {},
) {
  const allowed = new Set(allowedExtensions.map((extension) => extension.toLowerCase()));
  return multer({
    storage: multer.memoryStorage(),
    // Memory storage makes multipart text fields part of the request's RAM
    // footprint too. Keep every caller bounded; endpoints that accept no
    // fields (such as Project attachments) can tighten this further.
    limits: {
      files: 1,
      fileSize,
      fields: limits.fields ?? 20,
      fieldSize: 64 * 1024,
      parts: limits.parts ?? 21,
    },
    fileFilter: (_req, file, callback) => {
      const extension = extensionOf(file.originalname);
      if (!allowed.has(extension)) {
        callback(new multer.MulterError("LIMIT_UNEXPECTED_FILE", file.fieldname));
        return;
      }
      callback(null, true);
    },
  });
}

export function uploadErrorResponse(error: unknown): { status: number; message: string } | null {
  if (!(error instanceof multer.MulterError)) return null;
  if (error.code === "LIMIT_FILE_SIZE") {
    return { status: 413, message: "Uploaded file exceeds the allowed size." };
  }
  if (error.code === "LIMIT_FILE_COUNT") {
    return { status: 400, message: "Only one file may be uploaded at a time." };
  }
  if (error.code === "LIMIT_FIELD_COUNT") {
    return { status: 400, message: "Too many form fields were included with the upload." };
  }
  if (error.code === "LIMIT_PART_COUNT") {
    return { status: 400, message: "The upload contains too many multipart sections." };
  }
  if (error.code === "LIMIT_FIELD_VALUE") {
    return { status: 400, message: "An upload form field exceeds the allowed size." };
  }
  if (error.code === "LIMIT_UNEXPECTED_FILE") {
    return { status: 400, message: "Unsupported file type or unexpected upload field." };
  }
  return { status: 400, message: "Invalid file upload." };
}

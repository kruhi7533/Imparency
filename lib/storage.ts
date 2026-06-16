import { S3Client, PutObjectCommand, DeleteObjectCommand } from "@aws-sdk/client-s3";
import fs from "fs/promises";
import path from "path";
import { v4 as uuidv4 } from "uuid";

// Initialize S3 Client only if config is provided
const s3Client = new S3Client({
  region: process.env.AWS_REGION || "us-east-1",
  credentials: {
    accessKeyId: process.env.AWS_ACCESS_KEY_ID || "",
    secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY || "",
  },
  ...(process.env.AWS_ENDPOINT && { endpoint: process.env.AWS_ENDPOINT }), // Custom endpoint for Cloudflare R2
});

/**
 * Uploads a file buffer to the configured storage provider (local or S3/R2).
 * Returns the public URL of the uploaded file.
 */
export async function uploadFile(
  file: Buffer,
  originalName: string,
  folder: string
): Promise<string> {
  const ext = path.extname(originalName) || ".bin";
  const filename = `${uuidv4()}${ext}`;
  const provider = (process.env.STORAGE_PROVIDER || "local").toLowerCase();

  if (provider === "s3" || provider === "r2") {
    const bucketName = process.env.AWS_BUCKET_NAME || "";
    const key = `${folder}/${filename}`;

    await s3Client.send(
      new PutObjectCommand({
        Bucket: bucketName,
        Key: key,
        Body: file,
        ContentType: getContentType(ext),
      })
    );

    // Return custom CDN URL if defined, otherwise default S3 URL
    const cdnUrl = process.env.AWS_CDN_URL;
    if (cdnUrl) {
      return `${cdnUrl.replace(/\/$/, "")}/${key}`;
    }
    return `https://${bucketName}.s3.amazonaws.com/${key}`;
  } else {
    // Default: Local Storage
    const uploadDir = path.join(process.cwd(), "public", "uploads", folder);
    
    // Ensure upload directory exists
    await fs.mkdir(uploadDir, { recursive: true });
    
    const filePath = path.join(uploadDir, filename);
    await fs.writeFile(filePath, file);

    return `/uploads/${folder}/${filename}`;
  }
}

/**
 * Deletes a file from the configured storage provider using its URL.
 */
export async function deleteFile(fileUrl: string): Promise<void> {
  const provider = (process.env.STORAGE_PROVIDER || "local").toLowerCase();

  if (provider === "s3" || provider === "r2") {
    const bucketName = process.env.AWS_BUCKET_NAME || "";
    
    // Extract key from URL
    // e.g. https://bucket.s3.amazonaws.com/folder/filename.jpg or https://cdn.com/folder/filename.jpg
    let key = "";
    try {
      const parsedUrl = new URL(fileUrl);
      const pathname = parsedUrl.pathname; // starts with "/"
      key = pathname.startsWith("/") ? pathname.substring(1) : pathname;
    } catch {
      // Fallback if URL is malformed or relative
      key = fileUrl.replace(/^\//, "");
    }

    if (!key) return;

    await s3Client.send(
      new DeleteObjectCommand({
        Bucket: bucketName,
        Key: key,
      })
    );
  } else {
    // Default: Local Storage
    // e.g. /uploads/folder/filename.jpg
    // Check if the URL is relative to public uploads
    if (fileUrl.startsWith("/uploads/")) {
      const filePath = path.join(process.cwd(), "public", fileUrl);
      try {
        await fs.unlink(filePath);
      } catch (err: any) {
        // If file already deleted or doesn't exist, ignore
        if (err.code !== "ENOENT") {
          throw err;
        }
      }
    }
  }
}

/**
 * Simple mime-type mapping for standard uploads
 */
function getContentType(ext: string): string {
  const mimeTypes: { [key: string]: string } = {
    ".jpg": "image/jpeg",
    ".jpeg": "image/jpeg",
    ".png": "image/png",
    ".gif": "image/gif",
    ".pdf": "application/pdf",
    ".txt": "text/plain",
    ".csv": "text/csv",
    ".doc": "application/msword",
    ".docx": "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  };
  return mimeTypes[ext.toLowerCase()] || "application/octet-stream";
}

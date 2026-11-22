import { deflateRawSync, inflateRawSync } from "node:zlib";

export interface ZipInputEntry {
  readonly name: string;
  readonly data: Uint8Array;
}

export interface ZipLimits {
  readonly maxEntries?: number;
  readonly maxEntryBytes?: number;
  readonly maxTotalExtractedBytes?: number;
}

export const DEFAULT_ZIP_LIMITS: Required<ZipLimits> = {
  maxEntries: 10_000,
  maxEntryBytes: 256 * 1024 * 1024,
  maxTotalExtractedBytes: 1024 * 1024 * 1024,
};

const CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let i = 0; i < 256; i += 1) {
    let c = i;
    for (let k = 0; k < 8; k += 1) {
      c = (c & 1) !== 0 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    }
    table[i] = c >>> 0;
  }
  return table;
})();

export function crc32(data: Uint8Array): number {
  let crc = 0xffffffff;
  for (let i = 0; i < data.length; i += 1) {
    crc = CRC_TABLE[(crc ^ data[i]!) & 0xff]! ^ (crc >>> 8);
  }
  return (crc ^ 0xffffffff) >>> 0;
}

export function validateArchiveEntryPath(rawName: string): string {
  if (!rawName || rawName.includes("\u0000")) {
    throw new Error(`Unsafe archive entry path: "${rawName}".`);
  }
  const normalized = rawName.replaceAll("\\", "/");
  if (
    normalized.startsWith("/") ||
    normalized.startsWith("//") ||
    /^[a-zA-Z]:/u.test(normalized)
  ) {
    throw new Error(`Absolute or drive-letter archive entry path rejected: "${rawName}".`);
  }
  const parts = normalized.split("/");
  for (let i = 0; i < parts.length; i += 1) {
    const part = parts[i]!;
    if (part === "..") {
      throw new Error(`Path traversal archive entry rejected: "${rawName}".`);
    }
    if (part === ".") {
      throw new Error(`Relative dot segment archive entry rejected: "${rawName}".`);
    }
    if (part === "" && i < parts.length - 1) {
      throw new Error(`Malformed archive entry path: "${rawName}".`);
    }
  }
  return normalized;
}

export function createZipArchive(entries: readonly ZipInputEntry[]): Buffer {
  const localParts: Buffer[] = [];
  const centralParts: Buffer[] = [];
  let offset = 0;

  for (const entry of entries) {
    const cleanName = validateArchiveEntryPath(entry.name);
    if (cleanName.endsWith("/")) {
      throw new Error(`Directory entries are not supported: "${cleanName}".`);
    }
    const nameBytes = Buffer.from(cleanName, "utf8");
    const raw = Buffer.from(entry.data);
    const compressed = deflateRawSync(raw);
    const useDeflate = compressed.length < raw.length;
    const payload = useDeflate ? compressed : raw;
    const method = useDeflate ? 8 : 0;
    const checksum = crc32(raw);

    const localHeader = Buffer.alloc(30);
    localHeader.writeUInt32LE(0x04034b50, 0);
    localHeader.writeUInt16LE(20, 4);
    localHeader.writeUInt16LE(0x0800, 6);
    localHeader.writeUInt16LE(method, 8);
    localHeader.writeUInt16LE(0, 10);
    localHeader.writeUInt16LE(0x5421, 12);
    localHeader.writeUInt32LE(checksum, 14);
    localHeader.writeUInt32LE(payload.length, 18);
    localHeader.writeUInt32LE(raw.length, 22);
    localHeader.writeUInt16LE(nameBytes.length, 26);
    localHeader.writeUInt16LE(0, 28);

    localParts.push(localHeader, nameBytes, payload);

    const centralHeader = Buffer.alloc(46);
    centralHeader.writeUInt32LE(0x02014b50, 0);
    centralHeader.writeUInt16LE(0x031e, 4);
    centralHeader.writeUInt16LE(20, 6);
    centralHeader.writeUInt16LE(0x0800, 8);
    centralHeader.writeUInt16LE(method, 10);
    centralHeader.writeUInt16LE(0, 12);
    centralHeader.writeUInt16LE(0x5421, 14);
    centralHeader.writeUInt32LE(checksum, 16);
    centralHeader.writeUInt32LE(payload.length, 20);
    centralHeader.writeUInt32LE(raw.length, 24);
    centralHeader.writeUInt16LE(nameBytes.length, 28);
    centralHeader.writeUInt16LE(0, 30);
    centralHeader.writeUInt16LE(0, 32);
    centralHeader.writeUInt16LE(0, 34);
    centralHeader.writeUInt16LE(0, 36);
    centralHeader.writeUInt32LE((0o100644 << 16) >>> 0, 38);
    centralHeader.writeUInt32LE(offset, 42);

    centralParts.push(centralHeader, nameBytes);
    offset += localHeader.length + nameBytes.length + payload.length;
  }

  const centralDir = Buffer.concat(centralParts);
  const eocd = Buffer.alloc(22);
  eocd.writeUInt32LE(0x06054b50, 0);
  eocd.writeUInt16LE(0, 4);
  eocd.writeUInt16LE(0, 6);
  eocd.writeUInt16LE(entries.length, 8);
  eocd.writeUInt16LE(entries.length, 10);
  eocd.writeUInt32LE(centralDir.length, 12);
  eocd.writeUInt32LE(offset, 16);
  eocd.writeUInt16LE(0, 20);

  return Buffer.concat([...localParts, centralDir, eocd]);
}

export function readZipArchive(
  archiveBytes: Uint8Array,
  limits: ZipLimits = {},
): ReadonlyMap<string, Buffer> {
  const maxEntries = limits.maxEntries ?? DEFAULT_ZIP_LIMITS.maxEntries;
  const maxEntryBytes = limits.maxEntryBytes ?? DEFAULT_ZIP_LIMITS.maxEntryBytes;
  const maxTotalBytes = limits.maxTotalExtractedBytes ?? DEFAULT_ZIP_LIMITS.maxTotalExtractedBytes;

  const buf = Buffer.from(archiveBytes);
  if (buf.length < 22) {
    throw new Error("Invalid backup archive: file is too small to be a ZIP archive.");
  }

  let eocdOffset = -1;
  const minOffset = Math.max(0, buf.length - 65557);
  for (let i = buf.length - 22; i >= minOffset; i -= 1) {
    if (buf.readUInt32LE(i) === 0x06054b50) {
      const commentLength = buf.readUInt16LE(i + 20);
      if (i + 22 + commentLength === buf.length) {
        eocdOffset = i;
        break;
      }
    }
  }
  if (eocdOffset === -1) {
    throw new Error("Invalid backup archive: missing ZIP end-of-central-directory record.");
  }

  const totalEntries = buf.readUInt16LE(eocdOffset + 10);
  const centralSize = buf.readUInt32LE(eocdOffset + 12);
  const centralOffset = buf.readUInt32LE(eocdOffset + 16);

  if (totalEntries > maxEntries) {
    throw new Error(`Backup archive exceeds maximum entry count (${maxEntries}).`);
  }
  if (centralOffset + centralSize > eocdOffset) {
    throw new Error("Invalid backup archive: corrupt central directory bounds.");
  }

  const files = new Map<string, Buffer>();
  let totalExtracted = 0;
  let cursor = centralOffset;

  for (let index = 0; index < totalEntries; index += 1) {
    if (cursor + 46 > centralOffset + centralSize || buf.readUInt32LE(cursor) !== 0x02014b50) {
      throw new Error("Invalid backup archive: corrupt central directory header.");
    }
    const flags = buf.readUInt16LE(cursor + 8);
    if ((flags & 0x0001) !== 0) {
      throw new Error("Encrypted backup archives are not supported.");
    }
    const method = buf.readUInt16LE(cursor + 10);
    const expectedCrc = buf.readUInt32LE(cursor + 16);
    const compressedSize = buf.readUInt32LE(cursor + 20);
    const uncompressedSize = buf.readUInt32LE(cursor + 24);
    const nameLen = buf.readUInt16LE(cursor + 28);
    const extraLen = buf.readUInt16LE(cursor + 30);
    const commentLen = buf.readUInt16LE(cursor + 32);
    const externalAttrs = buf.readUInt32LE(cursor + 38);
    const localOffset = buf.readUInt32LE(cursor + 42);

    const nameStart = cursor + 46;
    const nameEnd = nameStart + nameLen;
    if (nameEnd + extraLen + commentLen > centralOffset + centralSize) {
      throw new Error("Invalid backup archive: entry metadata out of bounds.");
    }
    const rawName = buf.subarray(nameStart, nameEnd).toString("utf8");
    cursor = nameEnd + extraLen + commentLen;

    const unixMode = (externalAttrs >>> 16) & 0o170000;
    if (unixMode === 0o120000) {
      throw new Error(`Symbolic link archive entry rejected: "${rawName}".`);
    }

    const cleanName = validateArchiveEntryPath(rawName);
    if (cleanName.endsWith("/")) {
      continue;
    }

    if (uncompressedSize > maxEntryBytes) {
      throw new Error(`Archive entry "${cleanName}" exceeds maximum size limit.`);
    }
    totalExtracted += uncompressedSize;
    if (totalExtracted > maxTotalBytes) {
      throw new Error(`Backup archive exceeds maximum total extracted size (${maxTotalBytes} bytes).`);
    }

    if (localOffset + 30 > centralOffset || buf.readUInt32LE(localOffset) !== 0x04034b50) {
      throw new Error(`Invalid local file header for "${cleanName}".`);
    }
    const localNameLen = buf.readUInt16LE(localOffset + 26);
    const localExtraLen = buf.readUInt16LE(localOffset + 28);
    const dataStart = localOffset + 30 + localNameLen + localExtraLen;
    const dataEnd = dataStart + compressedSize;
    if (dataEnd > centralOffset) {
      throw new Error(`Compressed data out of bounds for "${cleanName}".`);
    }
    const compressedPayload = buf.subarray(dataStart, dataEnd);

    let extracted: Buffer;
    if (method === 0) {
      extracted = Buffer.from(compressedPayload);
    } else if (method === 8) {
      extracted = inflateRawSync(compressedPayload, { maxOutputLength: maxEntryBytes });
    } else {
      throw new Error(`Unsupported compression method (${method}) for "${cleanName}".`);
    }

    if (extracted.length !== uncompressedSize) {
      throw new Error(`Size mismatch for "${cleanName}".`);
    }
    if (crc32(extracted) !== expectedCrc) {
      throw new Error(`CRC mismatch for "${cleanName}".`);
    }
    if (files.has(cleanName)) {
      throw new Error(`Duplicate archive entry "${cleanName}".`);
    }
    files.set(cleanName, extracted);
  }

  return files;
}

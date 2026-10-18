import { inflateRawSync } from "node:zlib";
// Read only the document body; never evaluate fields, macros, hyperlinks or external relationships.
export function readWord(bytes) {
  let eocd = -1;
  for (let i = bytes.length - 22; i >= Math.max(0, bytes.length - 65557); i--)
    if (bytes.readUInt32LE(i) === 0x06054b50) {
      eocd = i;
      break;
    }
  if (eocd < 0) throw Error("Invalid Word archive");
  let at = bytes.readUInt32LE(eocd + 16);
  const count = bytes.readUInt16LE(eocd + 10);
  if (count > 2000) throw Error("Too many Word entries");
  for (let n = 0; n < count; n++) {
    if (bytes.readUInt32LE(at) !== 0x02014b50)
      throw Error("Invalid Word directory");
    const flags = bytes.readUInt16LE(at + 8),
      method = bytes.readUInt16LE(at + 10),
      size = bytes.readUInt32LE(at + 20),
      unpacked = bytes.readUInt32LE(at + 24),
      nameLen = bytes.readUInt16LE(at + 28),
      extra = bytes.readUInt16LE(at + 30),
      comment = bytes.readUInt16LE(at + 32),
      offset = bytes.readUInt32LE(at + 42),
      name = bytes.subarray(at + 46, at + 46 + nameLen).toString();
    at += 46 + nameLen + extra + comment;
    if (name !== "word/document.xml") continue;
    if (flags & 1 || unpacked > 5e6 || size > 20e6)
      throw Error("Word body too large or encrypted");
    if (bytes.readUInt32LE(offset) !== 0x04034b50)
      throw Error("Invalid Word body");
    const start =
        offset +
        30 +
        bytes.readUInt16LE(offset + 26) +
        bytes.readUInt16LE(offset + 28),
      data = bytes.subarray(start, start + size);
    const xml = (
      method === 0
        ? data
        : method === 8
          ? inflateRawSync(data, { maxOutputLength: 5e6 })
          : Buffer.alloc(0)
    ).toString("utf8");
    if (/<!DOCTYPE|<!ENTITY/i.test(xml)) throw Error("Unsupported XML");
    return xml
      .replace(/<w:(?:br|tab)\b[^>]*\/?\s*>/g, " ")
      .replace(/<\/w:p>/g, "\n")
      .replace(/<\/w:tc>/g, " | ")
      .replace(/<[^>]*>/g, "")
      .replace(/&(#x[0-9a-f]+|#\d+|amp|lt|gt|quot|apos);/gi, (_, v) =>
        v[0] === "#"
          ? String.fromCodePoint(
              v[1] === "x" ? parseInt(v.slice(2), 16) : Number(v.slice(1)),
            )
          : { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'" }[v],
      )
      .trim();
  }
  throw Error("No Word document body");
}

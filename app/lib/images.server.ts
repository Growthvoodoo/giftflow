/**
 * Image type, sniffed from the file header rather than trusted from the
 * Content-Type or the file name, both of which a client sets freely.
 */
const MAGIC: Array<{ ext: string; mime: string; test: (b: Buffer) => boolean }> = [
  { ext: "jpg", mime: "image/jpeg", test: (b) => b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff },
  {
    ext: "png",
    mime: "image/png",
    test: (b) => b.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])),
  },
  {
    ext: "webp",
    mime: "image/webp",
    test: (b) => b.subarray(0, 4).toString() === "RIFF" && b.subarray(8, 12).toString() === "WEBP",
  },
];

export function sniffImage(buf: Buffer): { ext: string; mime: string } | null {
  const kind = MAGIC.find((m) => m.test(buf));
  return kind ? { ext: kind.ext, mime: kind.mime } : null;
}

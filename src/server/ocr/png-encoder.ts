/**
 * 極簡 PNG 編碼器。
 *
 * PDF 內的掃描頁只提供原始像素資料（沒有編碼過的圖片），
 * OCR 引擎需要標準圖片格式，因此在這裡用 Node 內建的 zlib 產生 PNG，
 * 避免引入原生圖片處理依賴。
 */
import zlib from "node:zlib";

const PNG_SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

const CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let index = 0; index < 256; index += 1) {
    let value = index;
    for (let bit = 0; bit < 8; bit += 1) {
      value = value & 1 ? 0xedb88320 ^ (value >>> 1) : value >>> 1;
    }
    table[index] = value >>> 0;
  }
  return table;
})();

function crc32(buffer: Buffer): number {
  let crc = 0xffffffff;
  for (const byte of buffer) {
    crc = CRC_TABLE[(crc ^ byte) & 0xff] ^ (crc >>> 8);
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function chunk(type: string, data: Buffer): Buffer {
  const length = Buffer.alloc(4);
  length.writeUInt32BE(data.length, 0);
  const typeAndData = Buffer.concat([Buffer.from(type, "ascii"), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(typeAndData), 0);
  return Buffer.concat([length, typeAndData, crc]);
}

export interface RawImage {
  data: Uint8ClampedArray | Uint8Array;
  width: number;
  height: number;
  channels: 1 | 3 | 4;
}

/** 把原始像素資料編碼成 PNG（RGB 或 RGBA，或灰階） */
export function encodeRawImageToPng(image: RawImage): Buffer {
  const { width, height, channels } = image;
  const source = image.data;
  const expected = width * height * channels;
  if (source.length < expected) {
    throw new Error(
      `像素資料長度不足（預期 ${expected}，實際 ${source.length}），無法轉換成 PNG。`,
    );
  }

  const colorType = channels === 4 ? 6 : channels === 3 ? 2 : 0;
  const bytesPerPixel = channels;
  // 每行前面需要一個 filter byte（0 = None）
  const stride = width * bytesPerPixel;
  const raw = Buffer.alloc((stride + 1) * height);

  for (let row = 0; row < height; row += 1) {
    const rawOffset = row * (stride + 1);
    raw[rawOffset] = 0;
    const sourceOffset = row * stride;
    for (let index = 0; index < stride; index += 1) {
      raw[rawOffset + 1 + index] = source[sourceOffset + index];
    }
  }

  const header = Buffer.alloc(13);
  header.writeUInt32BE(width, 0);
  header.writeUInt32BE(height, 4);
  header[8] = 8; // bit depth
  header[9] = colorType;
  header[10] = 0; // compression
  header[11] = 0; // filter
  header[12] = 0; // interlace

  return Buffer.concat([
    PNG_SIGNATURE,
    chunk("IHDR", header),
    chunk("IDAT", zlib.deflateSync(raw, { level: 6 })),
    chunk("IEND", Buffer.alloc(0)),
  ]);
}

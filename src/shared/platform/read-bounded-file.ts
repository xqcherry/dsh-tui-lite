import { constants as fsConstants } from 'node:fs'
import { open } from 'node:fs/promises'
import { basename } from 'node:path'

export async function readBoundedRegularFile(path: string, maxBytes: number): Promise<Uint8Array> {
  // O_NONBLOCK keeps a pasted FIFO/device path from parking the UI before
  // fstat can reject it; regular-file reads are unchanged.
  const file = await open(path, fsConstants.O_RDONLY | fsConstants.O_NONBLOCK)
  try {
    const info = await file.stat()
    if (!info.isFile()) throw new Error(`${basename(path)} is not a regular file`)
    if (info.size > maxBytes) throw new Error(`image exceeds this profile's per-image size limit`)
    const data = Buffer.allocUnsafe(info.size + 1)
    let offset = 0
    while (offset < data.byteLength) {
      const { bytesRead } = await file.read(data, offset, data.byteLength - offset, offset)
      if (bytesRead === 0) break
      offset += bytesRead
    }
    if (offset !== info.size) throw new Error(`${basename(path)} changed while it was being read`)
    return data.subarray(0, offset)
  } finally {
    await file.close()
  }
}

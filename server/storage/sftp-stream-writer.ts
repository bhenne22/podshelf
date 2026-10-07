/**
 * The slice of ssh2's SFTPWrapper this module needs — narrow so tests can
 * drive it with a fake server.
 */
export interface SftpHandleApi {
  open(path: string, flags: 'w', cb: (err: Error | undefined | null, handle: Buffer) => void): unknown
  write(
    handle: Buffer, buf: Buffer, off: number, len: number, position: number,
    cb: (err: Error | undefined | null) => void,
  ): unknown
  close(handle: Buffer, cb: (err: Error | undefined | null) => void): unknown
}

/**
 * 32 KB is the payload every SFTP server is required to accept, so it's safe
 * against any host. Speed comes from the number in flight, not the size.
 */
export const WRITE_CHUNK_SIZE = 32 * 1024
export const WRITE_CONCURRENCY = 64

/**
 * Streams `source` into `remotePath` with up to `concurrency` WRITE requests
 * outstanding at once.
 *
 * Why not ssh2's createWriteStream (what ssh2-sftp-client's `put` uses): it
 * sends one write and waits for the server's ack before sending the next, so
 * throughput is capped at chunk size ÷ round trip — about 1.5 MB/s from the
 * Linode to DreamHost — no matter how fast either end is. `fastPut` pipelines
 * like this but only reads from a local file, and spooling a 500 MB episode
 * to disk first would bring back the wait-after-100% this exists to remove.
 *
 * Memory stays bounded at roughly concurrency × chunk size: `for await` stops
 * pulling from the source while every slot is busy, which pushes backpressure
 * all the way back to the browser.
 */
export async function writeStreamPipelined(
  sftp: SftpHandleApi,
  source: AsyncIterable<Buffer | string>,
  remotePath: string,
  { concurrency = WRITE_CONCURRENCY, chunkSize = WRITE_CHUNK_SIZE } = {},
): Promise<number> {
  const handle = await new Promise<Buffer>((resolve, reject) => {
    sftp.open(remotePath, 'w', (err, h) => (err ? reject(err) : resolve(h)))
  })

  const inFlight = new Set<Promise<void>>()
  let failure: Error | null = null
  let position = 0

  const issue = (buf: Buffer, off: number, len: number, pos: number) => {
    const p = new Promise<void>((resolve) => {
      sftp.write(handle, buf, off, len, pos, (err) => {
        if (err && !failure) failure = err
        resolve()
      })
    }).then(() => { inFlight.delete(p) })
    inFlight.add(p)
  }

  try {
    for await (const raw of source) {
      const chunk = typeof raw === 'string' ? Buffer.from(raw) : raw
      for (let off = 0; off < chunk.length; off += chunkSize) {
        while (inFlight.size >= concurrency && !failure) await Promise.race(inFlight)
        if (failure) throw failure
        const len = Math.min(chunkSize, chunk.length - off)
        issue(chunk, off, len, position)
        position += len
      }
    }
    await Promise.all(inFlight)
    if (failure) throw failure
  } catch (err) {
    // Let outstanding writes settle before closing the handle under them.
    await Promise.all(inFlight)
    await new Promise<void>((resolve) => { sftp.close(handle, () => resolve()) })
    throw err
  }

  await new Promise<void>((resolve, reject) => {
    sftp.close(handle, (err) => (err ? reject(err) : resolve()))
  })
  return position
}

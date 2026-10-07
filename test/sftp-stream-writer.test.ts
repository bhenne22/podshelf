import { test } from 'node:test'
import assert from 'node:assert/strict'
import { Readable } from 'node:stream'
import { randomBytes } from 'node:crypto'
import { writeStreamPipelined, type SftpHandleApi } from '../server/storage/sftp-stream-writer'

// A fake SFTP server that acks writes after a random delay — so they complete
// out of order, as real pipelined writes can — and records the peak number
// outstanding. Assembles the file from (offset, bytes) so a wrong position
// shows up as corrupted output, not just a wrong count.
function fakeServer({ failAtWrite = -1 } = {}) {
  const file = new Map<number, Buffer>()
  let outstanding = 0
  let peak = 0
  let writes = 0
  let closed = 0
  const handle = Buffer.from('h1')
  const api: SftpHandleApi = {
    open(_path, _flags, cb) { setImmediate(() => cb(null, handle)) },
    write(_h, buf, off, len, pos, cb) {
      const n = writes++
      outstanding++
      peak = Math.max(peak, outstanding)
      const data = Buffer.from(buf.subarray(off, off + len))
      setTimeout(() => {
        outstanding--
        if (n === failAtWrite) return cb(new Error('disk full'))
        file.set(pos, data)
        cb(null)
      }, Math.random() * 3)
    },
    close(_h, cb) { closed++; setImmediate(() => cb(null)) },
  }
  const assemble = () =>
    Buffer.concat([...file.entries()].sort((a, b) => a[0] - b[0]).map(([, b]) => b))
  return { api, assemble, stats: () => ({ peak, writes, closed, outstanding }) }
}

// Uneven source chunks so slices straddle chunk boundaries.
function chunked(data: Buffer): Readable {
  const parts: Buffer[] = []
  for (let off = 0, i = 0; off < data.length; i++) {
    const len = [7000, 50_000, 1, 33_000][i % 4]!
    parts.push(data.subarray(off, off + len))
    off += len
  }
  return Readable.from(parts)
}

test('reassembles the source byte-for-byte despite out-of-order acks', async () => {
  const data = randomBytes(1_000_003)
  const srv = fakeServer()
  const written = await writeStreamPipelined(srv.api, chunked(data), '/x.partial', {
    concurrency: 8, chunkSize: 4096,
  })
  assert.equal(written, data.length)
  assert.ok(srv.assemble().equals(data))
  assert.equal(srv.stats().closed, 1)
})

test('keeps many writes in flight but never more than the cap', async () => {
  const srv = fakeServer()
  await writeStreamPipelined(srv.api, chunked(randomBytes(500_000)), '/x', {
    concurrency: 8, chunkSize: 4096,
  })
  assert.equal(srv.stats().peak, 8)
})

test('a failed write rejects, drains outstanding writes, and closes the handle', async () => {
  const srv = fakeServer({ failAtWrite: 20 })
  await assert.rejects(
    writeStreamPipelined(srv.api, chunked(randomBytes(500_000)), '/x', { concurrency: 8, chunkSize: 4096 }),
    /disk full/,
  )
  assert.equal(srv.stats().outstanding, 0)
  assert.equal(srv.stats().closed, 1)
})

test('a source error rejects and closes the handle', async () => {
  const srv = fakeServer()
  const source = new Readable({ read() {} })
  source.push(randomBytes(100_000))
  setTimeout(() => source.destroy(new Error('client went away')), 5)
  await assert.rejects(writeStreamPipelined(srv.api, source, '/x'), /client went away/)
  assert.equal(srv.stats().closed, 1)
})

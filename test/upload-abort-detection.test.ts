import { test } from 'node:test'
import assert from 'node:assert/strict'
import http from 'node:http'
import net from 'node:net'
import { Writable } from 'node:stream'
import type { AddressInfo } from 'node:net'
import type { H3Event } from 'h3'
import { streamFilePart, wasRequestAborted } from '../server/utils/multipart-stream'

// Regression: the upload handler's post-write "did the client vanish?" guard
// was keyed on `req.destroyed || req.aborted`. But IncomingMessage has
// autoDestroy, so it destroys itself as soon as its body has been fully
// consumed — which is exactly what a *successful* upload does. Every finished
// upload therefore took the abort path: the file that had just been written to
// storage was deleted and the client got 400 "Client aborted upload". All
// upload kinds were broken for five days before anyone traced it.
//
// These drive a real http server through the real streamFilePart so the Node
// stream semantics are the thing under test, not a mock of them.

const BOUNDARY = '----podshelftest'

function multipartBody(payload: Buffer): Buffer {
  const head = Buffer.from(
    `--${BOUNDARY}\r\nContent-Disposition: form-data; name="file"; filename="e.mp3"\r\n`
    + 'Content-Type: audio/mpeg\r\n\r\n',
  )
  return Buffer.concat([head, payload, Buffer.from(`\r\n--${BOUNDARY}--\r\n`)])
}

interface Observed {
  bytes: number
  complete: boolean
  destroyed: boolean
  aborted: boolean
}

/**
 * Runs `streamFilePart` against a real request, consuming the file through a
 * deliberately slow sink so the storage write outlives the end of the body —
 * the ordering that exposed the bug. Resolves with what the request looked
 * like at the moment the handler would have run its abort check.
 */
function serveOnce(
  drive: (port: number) => void,
): Promise<{ observed: Observed; aborted: boolean; error?: Error }> {
  return new Promise((resolve) => {
    let settled = false
    const finish = (r: { observed: Observed; aborted: boolean; error?: Error }) => {
      if (settled) return
      settled = true
      // close() alone leaves keep-alive sockets open, which keeps the event
      // loop alive and hangs the test runner after the assertions pass.
      server.closeAllConnections()
      server.close()
      resolve(r)
    }

    const server = http.createServer(async (req, res) => {
      let bytes = 0
      const snapshot = (): Observed => ({
        bytes,
        complete: req.complete,
        destroyed: req.destroyed,
        aborted: (req as unknown as { aborted: boolean }).aborted,
      })

      try {
        await streamFilePart({ node: { req } } as unknown as H3Event, {
          maxSize: 500 * 1024 * 1024,
          onFile: async ({ stream }) => {
            const sink = new Writable({
              write(chunk: Buffer, _enc, cb) {
                bytes += chunk.length
                setTimeout(cb, 1) // stand-in for SFTP/S3 latency
              },
            })
            await new Promise<void>((res2, rej) => {
              stream.pipe(sink)
              sink.on('finish', () => res2())
              sink.on('error', rej)
              stream.on('error', rej)
            })
            return null
          },
        })
        try { res.end('{}') } catch { /* client may be gone */ }
        finish({ observed: snapshot(), aborted: wasRequestAborted(req) })
      } catch (err) {
        finish({ observed: snapshot(), aborted: wasRequestAborted(req), error: err as Error })
      }
    })

    server.listen(0, () => drive((server.address() as AddressInfo).port))
  })
}

test('a fully received upload is NOT reported as an abort', async () => {
  const payload = Buffer.alloc(3 * 1024 * 1024, 0x41)

  const { observed, aborted, error } = await serveOnce((port) => {
    const body = multipartBody(payload)
    const req = http.request({
      host: '127.0.0.1',
      port,
      method: 'POST',
      path: '/',
      headers: {
        'content-type': `multipart/form-data; boundary=${BOUNDARY}`,
        'content-length': body.byteLength,
      },
    }, (res) => res.resume())
    req.on('error', () => { /* server closes the socket once it has answered */ })
    req.end(body)
  })

  assert.equal(error, undefined, 'a clean upload should not throw')
  assert.equal(observed.bytes, payload.length, 'every byte should reach the sink')
  assert.equal(observed.complete, true, 'req.complete marks the body fully received')
  assert.equal(
    aborted, false,
    'a complete upload must not be treated as an abort — this is the regression',
  )

  // Pin the trap itself: `destroyed` is true here even though nothing went
  // wrong, which is precisely why the guard must not be keyed on it.
  assert.equal(
    observed.destroyed, true,
    'IncomingMessage auto-destroys after its body is consumed, so `destroyed` '
    + 'cannot distinguish success from an abort',
  )
  assert.equal(observed.aborted, false, '`aborted` stays false on a clean request')
})

test('a client that disconnects mid-body IS reported as an abort', async () => {
  const declared = 8 * 1024 * 1024

  const { observed, aborted } = await serveOnce((port) => {
    const head = `--${BOUNDARY}\r\nContent-Disposition: form-data; name="file"; `
      + 'filename="e.mp3"\r\nContent-Type: audio/mpeg\r\n\r\n'
    const sock = net.connect(port, '127.0.0.1', () => {
      sock.write(
        'POST / HTTP/1.1\r\nHost: x\r\n'
        + `Content-Type: multipart/form-data; boundary=${BOUNDARY}\r\n`
        + `Content-Length: ${Buffer.byteLength(head) + declared + BOUNDARY.length + 8}\r\n\r\n`
        + head,
      )
      sock.write(Buffer.alloc(512 * 1024, 0x41)) // 512 KB of a declared 8 MB
      setTimeout(() => sock.destroy(), 150)      // then yank the connection
    })
    sock.on('error', () => { /* expected */ })
  })

  assert.ok(observed.bytes < declared, 'the sink should see only a fraction of the body')
  assert.equal(observed.complete, false, 'req.complete stays false on a truncated body')
  assert.equal(aborted, true, 'a real disconnect must still be caught')
})

test('wasRequestAborted keys on completeness, not stream teardown', () => {
  const complete = { complete: true, destroyed: true } as unknown as http.IncomingMessage
  const truncated = { complete: false, destroyed: true } as unknown as http.IncomingMessage

  assert.equal(wasRequestAborted(complete), false)
  assert.equal(wasRequestAborted(truncated), true)
})

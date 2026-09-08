import { test } from 'node:test'
import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { mkdtempSync, writeFileSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { buildZip, crc32, safeEntryName } from '../server/utils/zip'

/**
 * The ZIP writer is hand-rolled (Podshelf has no archive dependency), so these
 * check the output with independent implementations rather than with a reader
 * we also wrote — a container we can read back but nothing else accepts would
 * be worthless.
 *
 * Python's `zipfile` is the reference: it implements the spec strictly,
 * including the UTF-8 filename flag. macOS ships Info-ZIP `unzip`, which is
 * good for CRC verification but mangles non-ASCII names and warns on an empty
 * archive, so it isn't used for those two cases.
 */

function tmp<T>(fn: (dir: string) => T): T {
  const dir = mkdtempSync(join(tmpdir(), 'podshelf-zip-'))
  try {
    return fn(dir)
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
}

/** Run a Python snippet with `path` bound to the archive; returns stdout. */
function py(zipPath: string, snippet: string): string {
  return execFileSync('python3', ['-c', `import zipfile,sys\npath=sys.argv[1]\n${snippet}`, zipPath],
    { encoding: 'utf8' }).trim()
}

test('crc32 matches known vectors', () => {
  assert.equal(crc32(Buffer.from('')), 0)
  assert.equal(crc32(Buffer.from('123456789')), 0xcbf43926)
  assert.equal(crc32(Buffer.from('The quick brown fox jumps over the lazy dog')), 0x414fa339)
})

test('archive passes unzip -t and round-trips every entry', () => {
  const entries = [
    { name: 'transcripts/ep0641-knives-out.srt', data: Buffer.from('1\n00:00:01,000 --> 00:00:04,000\n[Erica] Hello there.\n') },
    { name: 'chapters/ep0641.chapters.json', data: Buffer.from(JSON.stringify({ version: '1.2.0', chapters: [{ startTime: 0, title: 'Cold Open' }] })) },
    { name: 'big.txt', data: Buffer.from('x'.repeat(200_000)) },              // deflate path
    { name: 'random.bin', data: Buffer.from(Array.from({ length: 4096 }, (_, i) => (i * 7919) % 251)) }, // store path
    { name: 'empty.txt', data: Buffer.alloc(0) },
  ]
  const buf = buildZip(entries)

  tmp((dir) => {
    const zipPath = join(dir, 'a.zip')
    writeFileSync(zipPath, buf)

    // Info-ZIP verifies every CRC in the archive.
    assert.match(execFileSync('unzip', ['-t', zipPath], { encoding: 'utf8' }), /No errors detected/)

    execFileSync('unzip', ['-qq', '-o', zipPath, '-d', join(dir, 'out')])
    for (const e of entries) {
      assert.deepEqual(readFileSync(join(dir, 'out', e.name)), e.data, `content mismatch: ${e.name}`)
    }
  })
})

test('deflate is used when it helps and skipped when it would inflate', () => {
  const compressible = buildZip([{ name: 'a.txt', data: Buffer.from('y'.repeat(100_000)) }])
  assert.ok(compressible.length < 5_000,
    `expected compression; archive was ${compressible.length} bytes`)

  const random = Buffer.from(Array.from({ length: 20_000 }, (_, i) => (i * 31 + 17) % 256))
  const stored = buildZip([{ name: 'r.bin', data: random }])
  assert.ok(stored.length < random.length + 500,
    `store fallback should avoid inflation; got ${stored.length} for ${random.length} bytes`)
})

test('unicode filenames survive, with the UTF-8 flag set', () => {
  const name = 'transcripts/Entry 010 – Julia DiFerdinando.srt'
  const body = 'café — naïve\n'
  tmp((dir) => {
    const zipPath = join(dir, 'u.zip')
    writeFileSync(zipPath, buildZip([{ name, data: Buffer.from(body) }]))
    assert.equal(py(zipPath, 'print(zipfile.ZipFile(path).namelist()[0])'), name)
    // Bit 11 tells readers the name is UTF-8; without it the en-dash is
    // interpreted as CP437 and the filename is corrupted on extraction.
    assert.equal(py(zipPath, 'print(zipfile.ZipFile(path).infolist()[0].flag_bits & 0x800)'), '2048')
    assert.equal(py(zipPath, 'z=zipfile.ZipFile(path);print(z.read(z.namelist()[0]).decode(),end="")'), body.trim())
    assert.equal(py(zipPath, 'print(zipfile.ZipFile(path).testzip())'), 'None')
  })
})

test('an empty archive is a valid zip with zero entries', () => {
  const buf = buildZip([])
  assert.equal(buf.length, 22, 'empty archive should be just the end-of-central-directory record')
  tmp((dir) => {
    const zipPath = join(dir, 'e.zip')
    writeFileSync(zipPath, buf)
    // Info-ZIP exits non-zero with "zipfile is empty" here, which is a warning
    // rather than corruption, so verify with the stricter reader instead.
    assert.equal(py(zipPath, 'print(len(zipfile.ZipFile(path).namelist()))'), '0')
  })
})

test('many entries keep their offsets straight', () => {
  // Central-directory offsets are the easiest thing to get wrong; a large
  // archive catches an off-by-one that two entries would hide.
  const entries = Array.from({ length: 200 }, (_, i) => ({
    name: `t/ep${String(i).padStart(4, '0')}.srt`,
    data: Buffer.from(`episode ${i}\n`.repeat(i + 1)),
  }))
  tmp((dir) => {
    const zipPath = join(dir, 'm.zip')
    writeFileSync(zipPath, buildZip(entries))
    assert.match(execFileSync('unzip', ['-t', zipPath], { encoding: 'utf8' }), /No errors detected/)
    assert.equal(py(zipPath, 'print(len(zipfile.ZipFile(path).namelist()))'), '200')
    assert.equal(
      py(zipPath, 'z=zipfile.ZipFile(path);print(z.read("t/ep0199.srt").decode().count("episode 199"))'),
      '200')
  })
})

test('safeEntryName removes anything that could escape the archive', () => {
  for (const input of ['a/b\\c.srt', '../../etc/passwd', '..\\..\\windows\\system32']) {
    const out = safeEntryName(input)
    assert.ok(!out.includes('/') && !out.includes('\\'),
      `separators must not survive: ${input} -> ${out}`)
  }
  assert.equal(safeEntryName('a/b\\c.srt'), 'a-b-c.srt')
  assert.equal(safeEntryName('...hidden'), 'hidden')
  assert.equal(safeEntryName('   '), 'file')
  assert.equal(safeEntryName('', 'fallback.srt'), 'fallback.srt')
  assert.equal(safeEntryName('ep0641-knives-out.srt'), 'ep0641-knives-out.srt')
  assert.equal(safeEntryName('Entry 010 – Julia.srt'), 'Entry 010 – Julia.srt')
})

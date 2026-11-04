import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFile, writeFile, mkdtemp } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

test('media routes images through GPT/Gemini and retains speech and saved media', async (t) => {
  let source = await readFile(new URL('../index.js', import.meta.url), 'utf8')
  source = source.replace("import { defineTool } from '@deepseek-ai/dsh-tools'", 'const defineTool = value => value')
    .replace("import z from '@deepseek-ai/schemastery'", 'const z={object:()=>({}),string:()=>({required:()=>({})})}')
  const plugin = await import('data:text/javascript;base64,' + Buffer.from(source).toString('base64'))
  const dir = await mkdtemp(join(tmpdir(), 'dsh-media-test-'))
  const png = Buffer.from('89504e470d0a1a0a', 'hex')
  await writeFile(join(dir, '1111111111111111.png'), png)
  const tools = new Map(), routes = []
  plugin.apply({ tools: { register: value => tools.set(value.name, value) }, webServer: { register: value => routes.push(value) } },
    { mediaDir: dir, publicOrigin: 'https://panel.test' })
  const previousFetch = globalThis.fetch
  const previousKeys = [process.env.XAI_API_KEY, process.env.TLPRO_API_KEY]
  process.env.XAI_API_KEY = 'test-only'
  process.env.TLPRO_API_KEY = 'test-only'
  t.after(() => {
    globalThis.fetch = previousFetch
    for (const [index, key] of ['XAI_API_KEY', 'TLPRO_API_KEY'].entries()) {
      if (previousKeys[index] === undefined) delete process.env[key]
      else process.env[key] = previousKeys[index]
    }
  })
  let calls = []
  globalThis.fetch = async (url, options = {}) => {
    calls.push({ url: String(url), body: options.body ? JSON.parse(options.body) : undefined })
    if (String(url) === 'https://external.test/media/2222222222222222.png') return new Response(png)
    if (String(url).endsWith('/tts')) return new Response('audio')
    assert.match(String(url), /^https:\/\/hoantienmuasam.net\/llmtlpro\/v1\/images\/(generations|edits)$/)
    return Response.json({ data: [{ b64_json: png.toString('base64') }] })
  }
  async function execute(id, args) {
    calls = []
    return tools.get(id).execute(args, { signal: new AbortController().signal })
  }
  await t.test('registers only speech and two image tools', () => {
    assert.deepEqual([...tools.keys()], ['speak', 'create_image', 'edit_image'])
    assert.ok(routes.some(route => route.path === '/media'))
    assert.ok(routes.some(route => route.path === '/media/watch'))
  })
  await t.test('defaults creation to GPT with requested size and quality', async () => {
    const result = await execute('create_image', { prompt: 'test', aspect_ratio: '9:16', quality: 'high' })
    assert.equal(calls[0].body.model, 'cx/gpt-image-2.5')
    assert.equal(calls[0].body.size, '1024x1536')
    assert.equal(calls[0].body.quality, 'high')
    assert.match(result.url, /^https:\/\/panel.test\/media\/[a-f0-9]{16}\.png$/)
  })
  await t.test('defaults edits to GPT and reads protected local media from disk', async () => {
    await execute('edit_image', { prompt: 'test', image_url: 'https://panel.test/media/1111111111111111.png' })
    assert.equal(calls.length, 1)
    assert.equal(calls[0].body.model, 'cx/gpt-image-2.5')
    assert.equal(calls[0].body.image, png.toString('base64'))
  })
  for (const resolution of ['512', '1K', '2K', '4K']) {
    for (const editing of [false, true]) {
      await t.test(`Gemini ${editing ? 'edit' : 'create'} ${resolution}`, async () => {
        await execute(editing ? 'edit_image' : 'create_image', { prompt: 'test', model: 'gemini-3.1-flash-image', resolution,
          ...(editing ? { image_url: 'https://panel.test/media/1111111111111111.png' } : {}) })
        assert.equal(calls[0].body.resolution, resolution)
        assert.equal(calls[0].body.generationConfig.imageConfig.imageSize, resolution)
        if (editing) assert.match(calls[0].body.image.url, /^data:image\/png;base64,/)
      })
    }
  }
  await t.test('rejects removed xAI image models before making a request', async () => {
    await assert.rejects(execute('create_image', { prompt: 'test', model: 'grok-imagine-image-2.0' }), /must be one of/)
    assert.equal(calls.length, 0)
  })
  await t.test('rejects unsupported Gemini resolutions', async () => {
    await assert.rejects(execute('create_image', { prompt: 'test', model: 'gemini-3.1-flash-image', resolution: '8K' }), /must be one of/)
  })
  await t.test('preserves Vietnamese TTS', async () => {
    await execute('speak', { text: 'Xin chào', language: 'vi' })
    assert.equal(calls[0].url, 'https://api.x.ai/v1/tts')
    assert.equal(calls[0].body.language, 'vi')
  })
  await t.test('external media paths are fetched from their actual host', async () => {
    await execute('edit_image', { prompt: 'test', image_url: 'https://external.test/media/2222222222222222.png' })
    assert.equal(calls[0].url, 'https://external.test/media/2222222222222222.png')
  })
})

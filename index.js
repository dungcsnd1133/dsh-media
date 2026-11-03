/**
 * Session tools that speak text, create or edit an image, and make a video
 * from text or from a still. Files are saved locally and served at /media.
 */
import { randomBytes } from 'node:crypto'
import { mkdirSync, createReadStream } from 'node:fs'
import { writeFile } from 'node:fs/promises'
import { basename, join } from 'node:path'
import { defineTool } from '@deepseek-ai/dsh-tools'
import z from '@deepseek-ai/schemastery'

export const name = 'dsh-media'
export const inject = ['tools', 'webServer']
export const Config = z.object({
  publicOrigin: z.string().required(),
  mediaDir: z.string().required(),
})

const VOICES = ['eve', 'ara', 'rex', 'sal', 'leo']
const IMAGE_MODEL = 'grok-imagine-image-2.0'
const VIDEO_MODEL = 'grok-imagine-video-1.5'
const FILE_NAME = /^[a-f0-9]{16}\.(mp3|jpg|jpeg|png|webp|mp4)$/

function apiKey() {
  const key = process.env.XAI_API_KEY
  if (!key) throw new Error('XAI_API_KEY is not set')
  return key
}

async function xai(path, { method = 'GET', body, signal } = {}) {
  const response = await fetch(`https://api.x.ai${path}`, {
    method,
    signal,
    headers: {
      authorization: `Bearer ${apiKey()}`,
      ...(body === undefined ? {} : { 'content-type': 'application/json' }),
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  })
  if (!response.ok) {
    const detail = (await response.text()).slice(0, 400)
    throw new Error(`xAI ${path} failed (${response.status}): ${detail}`)
  }
  return response
}

async function save(store, bytes, extension) {
  const file = `${randomBytes(8).toString('hex')}.${extension}`
  await writeFile(join(store.dir, file), bytes)
  return store.url(file)
}

async function download(store, url, fallbackExtension, signal) {
  const response = await fetch(url, { signal })
  if (!response.ok) throw new Error(`Could not download the result (${response.status})`)
  const type = response.headers.get('content-type') ?? ''
  const extension = type.includes('png') ? 'png'
    : type.includes('webp') ? 'webp'
    : type.includes('mp4') ? 'mp4'
    : type.includes('mpeg') || type.includes('mp3') ? 'mp3'
    : fallbackExtension
  return save(store, Buffer.from(await response.arrayBuffer()), extension)
}

function imageUrl(payload) {
  return payload?.data?.[0]?.url ?? payload?.url ?? payload?.image?.url
}

function result(kind, url, detail) {
  return { kind, url, note: detail }
}

const resultSchema = {
  type: 'object',
  additionalProperties: false,
  properties: {
    kind: { type: 'string', required: true },
    url: { type: 'string', required: true },
    note: { type: 'string', required: true },
  },
}

function render(_args, value) {
  return [{ type: 'text', text: value.note }]
}

export function apply(ctx, config) {
  const store = {
    dir: config.mediaDir,
    url(file) { return `${config.publicOrigin.replace(/\/$/, '')}/media/${file}` },
  }
  mkdirSync(store.dir, { recursive: true })

  ctx.webServer.register({
    kind: 'prefix',
    path: '/media',
    handler(req, res) {
      const file = basename(new URL(req.url ?? '/', 'http://localhost').pathname)
      if (!FILE_NAME.test(file)) {
        res.writeHead(404)
        res.end()
        return
      }
      res.writeHead(200, {
        'content-type': file.endsWith('.mp3') ? 'audio/mpeg'
          : file.endsWith('.mp4') ? 'video/mp4'
          : file.endsWith('.png') ? 'image/png'
          : file.endsWith('.webp') ? 'image/webp'
          : 'image/jpeg',
        'cache-control': 'public, max-age=31536000, immutable',
      })
      createReadStream(join(store.dir, file)).pipe(res)
    },
  })

  ctx.tools.register(defineTool({
    name: 'speak',
    description: 'Turn text into a spoken audio file. Voices: eve (female, upbeat), ara (female, warm), rex (male, clear), sal (neutral), leo (male, strong). Use language "vi" for Vietnamese and "en" for English.',
    timeoutMs: 60000,
    parameters: {
      text: { type: 'string', required: true, description: 'The words to speak. Keep it under 2000 characters.' },
      voice: { type: 'string', description: 'eve, ara, rex, sal, or leo. Defaults to eve.' },
      language: { type: 'string', description: 'Language code such as en or vi. Defaults to en.' },
    },
    output: { schema: resultSchema, render },
    async execute(args, exec) {
      const text = args.text.trim()
      if (!text) throw new Error('text is empty')
      if (text.length > 2000) throw new Error('text must be at most 2000 characters')
      const voice = VOICES.includes(args.voice) ? args.voice : 'eve'
      const language = typeof args.language === 'string' && /^[a-z]{2}$/.test(args.language) ? args.language : 'en'
      const response = await xai('/v1/tts', {
        method: 'POST',
        signal: exec.signal,
        body: { text, voice_id: voice, language },
      })
      const url = await save(store, Buffer.from(await response.arrayBuffer()), 'mp3')
      return result('audio', url, `Spoken audio (${voice}, ${language}): ${url}`)
    },
  }))

  ctx.tools.register(defineTool({
    name: 'create_image',
    description: 'Create a new image from a text description. Show the returned URL to the user as a markdown image.',
    timeoutMs: 90000,
    parameters: {
      prompt: { type: 'string', required: true, description: 'What the image should show.' },
    },
    output: { schema: resultSchema, render },
    async execute(args, exec) {
      const prompt = args.prompt.trim()
      if (!prompt) throw new Error('prompt is empty')
      const response = await xai('/v1/images/generations', {
        method: 'POST',
        signal: exec.signal,
        body: { model: IMAGE_MODEL, prompt, n: 1 },
      })
      const remote = imageUrl(await response.json())
      if (!remote) throw new Error('The image API returned no URL')
      const url = await download(store, remote, 'jpg', exec.signal)
      return result('image', url, `Image: ![image](${url})`)
    },
  }))

  ctx.tools.register(defineTool({
    name: 'edit_image',
    description: 'Edit an existing image from a public URL using a text instruction. Show the returned URL as a markdown image.',
    timeoutMs: 90000,
    parameters: {
      prompt: { type: 'string', required: true, description: 'How to change the image.' },
      image_url: { type: 'string', required: true, description: 'Public URL of the image to edit.' },
    },
    output: { schema: resultSchema, render },
    async execute(args, exec) {
      const prompt = args.prompt.trim()
      const imageUrlInput = args.image_url.trim()
      if (!prompt) throw new Error('prompt is empty')
      if (!/^https:\/\//.test(imageUrlInput)) throw new Error('image_url must be an https URL')
      const response = await xai('/v1/images/edits', {
        method: 'POST',
        signal: exec.signal,
        body: {
          model: IMAGE_MODEL,
          prompt,
          image: { url: imageUrlInput, type: 'image_url' },
        },
      })
      const remote = imageUrl(await response.json())
      if (!remote) throw new Error('The image edit API returned no URL')
      const url = await download(store, remote, 'jpg', exec.signal)
      return result('image', url, `Edited image: ![image](${url})`)
    },
  }))

  ctx.tools.register(defineTool({
    name: 'create_video',
    description: 'Create a short video from a text prompt. Pass image_url to animate that still; omit it to create the video from text alone. Duration is 6, 10, or 15 seconds. Show the returned URL to the user.',
    timeoutMs: 240000,
    parameters: {
      prompt: { type: 'string', required: true, description: 'What the video should show and how the camera moves.' },
      image_url: { type: 'string', description: 'Optional public https URL of a still image to animate.' },
      duration: { type: 'number', description: 'Length in seconds: 6, 10, or 15. Defaults to 6.' },
    },
    output: { schema: resultSchema, render },
    async execute(args, exec) {
      const prompt = args.prompt.trim()
      if (!prompt) throw new Error('prompt is empty')
      const duration = [6, 10, 15].includes(args.duration) ? args.duration : 6
      const image = typeof args.image_url === 'string' && args.image_url.trim() ? args.image_url.trim() : undefined
      if (image !== undefined && !/^https:\/\//.test(image)) throw new Error('image_url must be an https URL')
      const started = await xai('/v1/videos/generations', {
        method: 'POST',
        signal: exec.signal,
        body: {
          model: VIDEO_MODEL,
          prompt,
          duration,
          ...(image === undefined ? {} : { image: { url: image } }),
        },
      })
      const requestId = (await started.json()).request_id
      if (typeof requestId !== 'string' || !requestId) throw new Error('The video API returned no request id')
      const deadline = Date.now() + 210000
      let remote
      while (Date.now() < deadline) {
        await new Promise((resolve, reject) => {
          const timer = setTimeout(resolve, 5000)
          exec.signal?.addEventListener('abort', () => {
            clearTimeout(timer)
            reject(new Error('Cancelled'))
          }, { once: true })
        })
        const polled = await xai(`/v1/videos/${requestId}`, { signal: exec.signal })
        const payload = await polled.json()
        if (payload.status === 'done') {
          remote = payload.video?.url ?? payload.url
          break
        }
        if (payload.status === 'failed' || payload.status === 'expired') {
          throw new Error(`Video ${payload.status}`)
        }
      }
      if (!remote) throw new Error('The video was not ready in time')
      const url = await download(store, remote, 'mp4', exec.signal)
      return result('video', url, `Video (${duration}s): ${url}`)
    },
  }))
}

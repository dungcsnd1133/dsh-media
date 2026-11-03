/**
 * Session tools that speak text, create or edit an image, and make a video
 * from text or from a still. Files are saved locally and served at /media.
 */
import { randomBytes } from 'node:crypto'
import { mkdirSync, createReadStream, statSync } from 'node:fs'
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

const VOICES = [
  'eve', 'ara', 'rex', 'sal', 'leo',
  'carina', 'zagan', 'helix', 'orion', 'luna', 'iris', 'altair', 'zenith',
  'perseus', 'helios', 'lux', 'kepler', 'rigel', 'cosmo', 'celeste', 'ursa',
  'sirius', 'lumen', 'castor', 'naksh', 'atlas', 'aurora', 'liora',
]
const LANGUAGES = [
  'auto', 'en', 'vi', 'ar-EG', 'ar-SA', 'ar-AE', 'bn', 'zh', 'fr', 'de',
  'hi', 'id', 'it', 'ja', 'ko', 'pt-BR', 'pt-PT', 'ru', 'es-MX', 'es-ES', 'tr',
]
const IMAGE_MODEL = 'grok-imagine-image-2.0'
const VIDEO_MODEL = 'grok-imagine-video-1.5'
const IMAGE_ASPECT_RATIOS = [
  '1:1', '3:4', '4:3', '9:16', '16:9', '2:3', '3:2',
  '9:19.5', '19.5:9', '9:20', '20:9', '1:2', '2:1', '21:9', '5:2', 'auto',
]
const IMAGE_RESOLUTIONS = ['1k', '1.5k', '2k']
const VIDEO_ASPECT_RATIOS = ['1:1', '16:9', '9:16', '4:3', '3:4', '3:2', '2:3', '21:9', '5:2']
const VIDEO_RESOLUTIONS = ['480p', '720p', '1080p']
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

function pick(value, allowed, fallback) {
  if (value === undefined || value === '') return fallback
  const found = allowed.find((item) => item.toLowerCase() === String(value).toLowerCase())
  if (!found) throw new Error(`must be one of: ${allowed.join(', ')}`)
  return found
}

function imageUrls(payload) {
  const rows = Array.isArray(payload?.data) ? payload.data : []
  const urls = rows.map((row) => row?.url).filter((url) => typeof url === 'string' && url)
  if (urls.length === 0 && typeof payload?.url === 'string') urls.push(payload.url)
  return urls
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

function contentType(file) {
  if (file.endsWith('.mp3')) return 'audio/mpeg'
  if (file.endsWith('.mp4')) return 'video/mp4'
  if (file.endsWith('.png')) return 'image/png'
  if (file.endsWith('.webp')) return 'image/webp'
  return 'image/jpeg'
}

function byteRange(header, size) {
  const match = /^bytes=(\d*)-(\d*)$/.exec(String(header).split(',')[0].trim())
  if (!match) return null
  const startText = match[1]
  const endText = match[2]
  if (startText === '' && endText === '') return null
  let start
  let end
  if (startText === '') {
    const suffix = Number(endText)
    if (!Number.isInteger(suffix) || suffix <= 0) return null
    start = Math.max(0, size - suffix)
    end = size - 1
  } else {
    start = Number(startText)
    end = endText === '' ? size - 1 : Number(endText)
  }
  if (!Number.isInteger(start) || !Number.isInteger(end) || start < 0 || end >= size || start > end) return null
  return { start, end }
}

function serveFile(req, res, filePath, type, file) {
  let size
  try {
    size = statSync(filePath).size
  } catch {
    res.writeHead(404)
    res.end()
    return
  }
  const url = new URL(req.url ?? '/', 'http://localhost')
  const download = url.searchParams.get('download') === '1' && !req.headers.range
  const headers = {
    'content-type': type,
    'accept-ranges': 'bytes',
    'cache-control': 'public, max-age=3600',
  }
  if (download) headers['content-disposition'] = `attachment; filename="${file}"`
  const range = download ? undefined : req.headers.range
  if (range) {
    const span = byteRange(range, size)
    if (!span) {
      res.writeHead(416, { 'content-range': `bytes */${size}` })
      res.end()
      return
    }
    res.writeHead(206, {
      ...headers,
      'content-range': `bytes ${span.start}-${span.end}/${size}`,
      'content-length': span.end - span.start + 1,
    })
    if (req.method === 'HEAD') {
      res.end()
      return
    }
    createReadStream(filePath, { start: span.start, end: span.end }).pipe(res)
    return
  }
  res.writeHead(req.method === 'HEAD' ? 200 : 200, { ...headers, 'content-length': size })
  if (req.method === 'HEAD') {
    res.end()
    return
  }
  createReadStream(filePath).pipe(res)
}

function watchPage(file) {
  const src = `/media/${file}?play=1`
  const save = `/media/${file}?download=1`
  return `<!doctype html>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Video</title>
<style>
  html,body{margin:0;height:100%;background:#111}
  body{display:grid;place-items:center}
  .stage{position:relative;width:min(100%,480px)}
  video{width:100%;max-height:100vh;background:#000;display:block}
  a{position:absolute;top:10px;right:10px;width:32px;height:32px;display:flex;align-items:center;justify-content:center;border-radius:999px;background:#fff;text-decoration:none;box-shadow:0 1px 3px rgba(0,0,0,.28)}
</style>
<div class="stage"><video controls autoplay playsinline src="${src}"></video><a href="${save}" download="${file}" aria-label="Tải về"><svg viewBox="0 0 16 16" width="15" height="15" aria-hidden="true"><path d="M8 1.8v7.6M5 7.2 8 10.2l3-3" fill="none" stroke="#1c1c1e" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/><path d="M3 13.2h10" fill="none" stroke="#1c1c1e" stroke-width="1.6" stroke-linecap="round"/></svg></a></div>
`
}

export function apply(ctx, config) {
  const store = {
    dir: config.mediaDir,
    url(file) { return `${config.publicOrigin.replace(/\/$/, '')}/media/${file}` },
  }
  mkdirSync(store.dir, { recursive: true })

  const registerRoute = (route) => {
    try {
      ctx.webServer.register(route)
    } catch (error) {
      if (!String(error?.message ?? error).includes('duplicate')) throw error
    }
  }

  registerRoute({
    kind: 'prefix',
    path: '/media/watch',
    handler(req, res) {
      const file = basename(new URL(req.url ?? '/', 'http://localhost').pathname)
      if (!FILE_NAME.test(file)) {
        res.writeHead(404)
        res.end()
        return
      }
      const html = watchPage(file)
      res.writeHead(200, {
        'content-type': 'text/html; charset=utf-8',
        'cache-control': 'no-cache',
        'content-length': Buffer.byteLength(html),
      })
      res.end(req.method === 'HEAD' ? undefined : html)
    },
  })

  registerRoute({
    kind: 'prefix',
    path: '/media',
    handler(req, res) {
      const file = basename(new URL(req.url ?? '/', 'http://localhost').pathname)
      if (!FILE_NAME.test(file)) {
        res.writeHead(404)
        res.end()
        return
      }
      serveFile(req, res, join(store.dir, file), contentType(file), file)
    },
  })

  ctx.tools.register(defineTool({
    name: 'speak',
    description: 'Turn text into speech with POST /v1/tts. voice_id defaults to eve. language is a BCP-47 code and defaults to en; use vi for Vietnamese. text may be at most 60000 characters. Returns an mp3 URL.',
    timeoutMs: 120000,
    parameters: {
      text: { type: 'string', required: true, description: 'Words to speak. At most 60000 characters.' },
      voice: { type: 'string', description: 'voice_id. Built-in: eve (default), ara, rex, sal, leo, and the other Grok voices. Custom voice ids are also accepted.' },
      language: { type: 'string', description: 'BCP-47 code: auto, en, vi, zh, ja, ko, fr, de, hi, id, it, ru, tr, bn, pt-BR, pt-PT, es-MX, es-ES, ar-EG, ar-SA, ar-AE. Defaults to en.' },
    },
    output: { schema: resultSchema, render },
    async execute(args, exec) {
      const text = args.text.trim()
      if (!text) throw new Error('text is empty')
      if (text.length > 60000) throw new Error('text must be at most 60000 characters')
      const voice = args.voice === undefined || args.voice === ''
        ? 'eve'
        : VOICES.includes(String(args.voice).toLowerCase())
          ? String(args.voice).toLowerCase()
          : /^[a-z0-9]{8}$/.test(String(args.voice))
            ? String(args.voice)
            : (() => { throw new Error(`voice must be a built-in voice or an 8-character custom voice_id`) })()
      const language = pick(args.language, LANGUAGES, 'en')
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
    description: 'Create images with POST /v1/images/generations. model is grok-imagine-image-2.0. n is 1 to 10 and defaults to 1. aspect_ratio defaults to auto. resolution is 1k, 1.5k, or 2k and defaults to 1k. Show every returned URL as a markdown image.',
    timeoutMs: 180000,
    parameters: {
      prompt: { type: 'string', required: true, description: 'What the image should show.' },
      n: { type: 'number', description: 'How many images to create, from 1 to 10. Defaults to 1.' },
      aspect_ratio: { type: 'string', description: '1:1, 3:4, 4:3, 9:16, 16:9, 2:3, 3:2, 9:19.5, 19.5:9, 9:20, 20:9, 1:2, 2:1, 21:9, 5:2, or auto. Defaults to auto.' },
      resolution: { type: 'string', description: '1k, 1.5k, or 2k. Defaults to 1k.' },
    },
    output: { schema: resultSchema, render },
    async execute(args, exec) {
      const prompt = args.prompt.trim()
      if (!prompt) throw new Error('prompt is empty')
      const n = args.n === undefined ? 1 : args.n
      if (!Number.isInteger(n) || n < 1 || n > 10) throw new Error('n must be an integer from 1 to 10')
      const aspectRatio = pick(args.aspect_ratio, IMAGE_ASPECT_RATIOS, undefined)
      const resolution = pick(args.resolution, IMAGE_RESOLUTIONS, undefined)
      const response = await xai('/v1/images/generations', {
        method: 'POST',
        signal: exec.signal,
        body: {
          model: IMAGE_MODEL,
          prompt,
          n,
          response_format: 'url',
          ...(aspectRatio === undefined ? {} : { aspect_ratio: aspectRatio }),
          ...(resolution === undefined ? {} : { resolution }),
        },
      })
      const remote = imageUrls(await response.json())
      if (remote.length === 0) throw new Error('The image API returned no URL')
      const urls = []
      for (const item of remote) urls.push(await download(store, item, 'jpg', exec.signal))
      return result('image', urls[0], urls.map((url) => `![image](${url})`).join('\n'))
    },
  }))

  ctx.tools.register(defineTool({
    name: 'edit_image',
    description: 'Edit one image with POST /v1/images/edits. model is grok-imagine-image-2.0. The image field is { url, type: "image_url" }. aspect_ratio includes 9:16. resolution is 1k, 1.5k, or 2k. Show the returned URL as a markdown image.',
    timeoutMs: 180000,
    parameters: {
      prompt: { type: 'string', required: true, description: 'How to change the image.' },
      image_url: { type: 'string', required: true, description: 'Public URL of the image to edit.' },
      aspect_ratio: { type: 'string', description: 'Same ratios as create_image, including 9:16. Omit to keep the source ratio.' },
      resolution: { type: 'string', description: '1k, 1.5k, or 2k. Defaults to 1k.' },
    },
    output: { schema: resultSchema, render },
    async execute(args, exec) {
      const prompt = args.prompt.trim()
      const imageUrlInput = args.image_url.trim()
      if (!prompt) throw new Error('prompt is empty')
      if (!/^https:\/\//.test(imageUrlInput)) throw new Error('image_url must be an https URL')
      const resolution = pick(args.resolution, IMAGE_RESOLUTIONS, undefined)
      const aspectRatio = pick(args.aspect_ratio, IMAGE_ASPECT_RATIOS, undefined)
      const response = await xai('/v1/images/edits', {
        method: 'POST',
        signal: exec.signal,
        body: {
          model: IMAGE_MODEL,
          prompt,
          image: { url: imageUrlInput, type: 'image_url' },
          ...(aspectRatio === undefined ? {} : { aspect_ratio: aspectRatio }),
          ...(resolution === undefined ? {} : { resolution }),
        },
      })
      const remote = imageUrls(await response.json())
      if (remote.length === 0) throw new Error('The image edit API returned no URL')
      const url = await download(store, remote[0], 'jpg', exec.signal)
      return result('image', url, `Edited image: ![image](${url})`)
    },
  }))

  ctx.tools.register(defineTool({
    name: 'create_video',
    description: 'Create a video with POST /v1/videos/generations, then poll GET /v1/videos/{request_id} until status is done. model is grok-imagine-video-1.5. duration is an integer from 1 to 15 seconds and defaults to 6. resolution is 480p, 720p, or 1080p. aspect_ratio includes 9:16 and is sent only for text-to-video. Omit image_url for text-to-video. Show the returned URL to the user.',
    timeoutMs: 240000,
    parameters: {
      prompt: { type: 'string', required: true, description: 'What the video should show and how the camera moves.' },
      image_url: { type: 'string', description: 'Optional public https URL of a still image to animate. Image-to-video keeps that image ratio.' },
      duration: { type: 'number', description: 'Length in seconds, an integer from 1 to 15. Defaults to 6.' },
      aspect_ratio: { type: 'string', description: 'Text-to-video only: 1:1, 16:9, 9:16, 4:3, 3:4, 3:2, 2:3, 21:9, or 5:2.' },
      resolution: { type: 'string', description: '480p, 720p, or 1080p. Defaults to 480p when omitted.' },
    },
    output: { schema: resultSchema, render },
    async execute(args, exec) {
      const prompt = args.prompt.trim()
      if (!prompt) throw new Error('prompt is empty')
      const duration = args.duration === undefined ? 6 : args.duration
      if (!Number.isInteger(duration) || duration < 1 || duration > 15) throw new Error('duration must be an integer from 1 to 15')
      const image = typeof args.image_url === 'string' && args.image_url.trim() ? args.image_url.trim() : undefined
      if (image !== undefined && !/^https:\/\//.test(image)) throw new Error('image_url must be an https URL')
      const aspectRatio = image === undefined ? pick(args.aspect_ratio, VIDEO_ASPECT_RATIOS, undefined) : undefined
      const resolution = pick(args.resolution, VIDEO_RESOLUTIONS, undefined)
      const started = await xai('/v1/videos/generations', {
        method: 'POST',
        signal: exec.signal,
        body: {
          model: VIDEO_MODEL,
          prompt,
          duration,
          ...(image === undefined ? {} : { image: { url: image } }),
          ...(aspectRatio === undefined ? {} : { aspect_ratio: aspectRatio }),
          ...(resolution === undefined ? {} : { resolution }),
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
      const watch = url.replace(/\/media\//, '/media/watch/')
      return result('video', url, `Video (${duration}s): ${watch}`)
    },
  }))
}

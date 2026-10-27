import { describe, expect, it } from 'vitest'
import { PostprocessError, muxStyleAudio, styleAudioKey } from '#/server/postprocess'

// 成片配乐：只验证 Worker 侧的读写和错误分类；ffmpeg 合成本身在容器里（containers/postprocess 的 /mux）
type Stored = { body: ArrayBuffer | Uint8Array; contentType?: string }

function fakeEnv(response: Response | Error, objects: Record<string, string> = { 'outputs/u/g.mp4': 'video', 'templates/song.mp3': 'audio' }) {
  const store = new Map<string, Stored>(Object.entries(objects).map(([key, text]) => [key, { body: new TextEncoder().encode(text) }]))
  const requests: Array<{ url: string; form: FormData; instance: string }> = []
  const env = {
    MEDIA: {
      async get(key: string) {
        const item = store.get(key)
        return item ? { arrayBuffer: async () => item.body, httpMetadata: { contentType: 'audio/mpeg' } } : null
      },
      async put(key: string, body: ArrayBuffer, options?: { httpMetadata?: { contentType?: string } }) {
        store.set(key, { body, contentType: options?.httpMetadata?.contentType })
      },
    },
    POSTPROCESS: {
      idFromName: (name: string) => name,
      get: (instance: string) => ({
        async fetch(url: string, init: RequestInit) {
          requests.push({ url, form: init.body as FormData, instance })
          if (response instanceof Error) throw response
          return response
        },
      }),
    },
  }
  return { env: env as unknown as Env, store, requests }
}

async function rejection(promise: Promise<unknown>) {
  try {
    await promise
  } catch (error) {
    return error as PostprocessError
  }
  throw new Error('expected rejection')
}

describe('muxStyleAudio', () => {
  it('把成片和原曲发给容器的 /mux，合成结果写回同一个 key', async () => {
    const { env, store, requests } = fakeEnv(new Response('muxed', { status: 200, headers: { 'Content-Type': 'video/mp4' } }))
    await muxStyleAudio(env, 'outputs/u/g.mp4', 'templates/song.mp3')
    expect(requests).toHaveLength(1)
    expect(requests[0]!.url).toBe('http://postprocess/mux')
    expect(requests[0]!.instance).toMatch(/^postprocess-[0-2]$/)
    expect(await (requests[0]!.form.get('video') as File).text()).toBe('video')
    expect(await (requests[0]!.form.get('audio') as File).text()).toBe('audio')
    const saved = store.get('outputs/u/g.mp4')!
    expect(new TextDecoder().decode(saved.body)).toBe('muxed')
    expect(saved.contentType).toBe('video/mp4')
  })

  it('没有容器绑定、缺成片或原曲：不可重试', async () => {
    const { env } = fakeEnv(new Response('x'))
    const unbound = { ...env, POSTPROCESS: undefined } as unknown as Env
    expect(await rejection(muxStyleAudio(unbound, 'outputs/u/g.mp4', 'templates/song.mp3'))).toMatchObject({ code: 'postprocess_not_configured', retryable: false })
    expect(await rejection(muxStyleAudio(env, 'outputs/u/missing.mp4', 'templates/song.mp3'))).toMatchObject({ code: 'output_missing', retryable: false })
    expect(await rejection(muxStyleAudio(env, 'outputs/u/g.mp4', 'templates/missing.mp3'))).toMatchObject({ code: 'audio_missing', retryable: false })
  })

  it('容器忙（503）或连不上可重试；4xx 合成失败不可重试，成片保持原样', async () => {
    const busy = fakeEnv(Response.json({ error: 'busy' }, { status: 503 }))
    expect(await rejection(muxStyleAudio(busy.env, 'outputs/u/g.mp4', 'templates/song.mp3'))).toMatchObject({ code: 'postprocess_busy', retryable: true })
    const down = fakeEnv(new Error('container failed to start'))
    expect(await rejection(muxStyleAudio(down.env, 'outputs/u/g.mp4', 'templates/song.mp3'))).toMatchObject({ code: 'postprocess_unavailable', retryable: true })
    const bad = fakeEnv(Response.json({ error: 'mux_failed', detail: 'no audio stream' }, { status: 422 }))
    expect(await rejection(muxStyleAudio(bad.env, 'outputs/u/g.mp4', 'templates/song.mp3'))).toMatchObject({ code: 'postprocess_mux_failed', retryable: false })
    expect(new TextDecoder().decode(bad.store.get('outputs/u/g.mp4')!.body as Uint8Array)).toBe('video')
  })
})

describe('styleAudioKey', () => {
  it('不存在的风格或时长没有原曲', () => {
    expect(styleAudioKey('no-such-style', 'full')).toBeUndefined()
  })
})

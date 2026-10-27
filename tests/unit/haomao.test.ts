import { afterEach, describe, expect, it, vi } from 'vitest'
import { defaultStyle, site, type Style } from '#/config/site'
import { createHaomaoProvider, haomaoCostCents } from '#/server/video/haomao'
import { VideoProviderError } from '#/server/video/types'

// haomaotoken 契约：火山引擎方舟内容生成接口（/api/v3/contents/generations/tasks）+ /files/uploads 文件上传，
// 和兄弟项目里跑通的调用方式一致。provider 只把任务映射成 VideoStatus，退积分、下载成片在 jobs.ts
const r2 = new Set(['uploads/u_1/up_1.jpg', 'templates/neon-12s.mp4', 'templates/neon-12s.mp3'])
const media = {
  async get(key: string) {
    if (!r2.has(key)) return null
    return { arrayBuffer: async () => new TextEncoder().encode(key).buffer, httpMetadata: { contentType: 'application/octet-stream' } }
  },
}
const env = (vars: Record<string, unknown> = {}) => ({ APP_ENV: 'production', HAOMAO_API_KEY: 'hm_test', MEDIA: media, ...vars }) as unknown as Env

// 站点会给默认风格配自己的 prompt：用例默认按风格不带 prompt、不带配乐跑
const plainStyle: Style = { ...defaultStyle, prompt: null, scene: null, audio: null }

const input = (extra: Record<string, unknown> = {}) => ({
  generationId: 'gen_1',
  style: plainStyle,
  durationSeconds: 12,
  imageUrl: 'https://moonhop.ai/media/uploads/upl_1?exp=1&sig=s',
  imageKey: 'uploads/u_1/up_1.jpg',
  sourceVideoUrl: 'https://moonhop.ai/media/templates/neon-12s.mp4',
  sourceVideoKey: 'templates/neon-12s.mp4',
  webhookUrl: 'https://moonhop.ai/api/webhooks/haomao?gen=gen_1&token=t',
  meta: {},
  ...extra,
})

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } })

type Route = () => Response
// 按“方法 路径”匹配；上传按调用顺序给出不同的地址
function stubFetch(routes: Record<string, Route>) {
  const calls: Array<{ method: string; path: string; body: unknown; headers: Record<string, string> }> = []
  vi.stubGlobal('fetch', async (raw: string, init?: RequestInit) => {
    const url = new URL(raw)
    const method = init?.method ?? 'GET'
    const body = typeof init?.body === 'string' ? JSON.parse(init.body) : init?.body
    calls.push({ method, path: url.pathname, body, headers: init?.headers as Record<string, string> })
    const route = routes[`${method} ${url.pathname}`]
    if (!route) throw new Error(`unexpected fetch ${method} ${url.pathname}`)
    return route()
  })
  return calls
}

function uploads() {
  let n = 0
  return () => json({ url: `https://files.haomao/${++n}` })
}

afterEach(() => vi.unstubAllGlobals())

async function rejection(promise: Promise<unknown>) {
  try {
    await promise
  } catch (error) {
    return error as VideoProviderError
  }
  throw new Error('expected rejection')
}

describe('haomao provider：提交', () => {
  it('先上传照片和源视频，再用上传地址建 Seedance 任务，请求体留在 meta 里', async () => {
    const calls = stubFetch({ 'POST /api/v3/files/uploads': uploads(), 'POST /api/v3/contents/generations/tasks': () => json({ id: 'cgt_1' }) })
    const result = await createHaomaoProvider(env()).submit(input())
    expect(calls.map((c) => c.path)).toEqual(['/api/v3/files/uploads', '/api/v3/files/uploads', '/api/v3/contents/generations/tasks'])
    expect(calls[0]!.headers.Authorization).toBe('Bearer hm_test')
    expect(calls[0]!.body).toBeInstanceOf(FormData)
    const request = calls[2]!.body as Record<string, unknown>
    expect(request).toEqual({
      model: site.video.haomao.model,
      content: [
        { type: 'text', text: site.video.haomao.prompt },
        { type: 'image_url', image_url: { url: 'https://files.haomao/1' }, role: 'reference_image' },
        { type: 'video_url', video_url: { url: 'https://files.haomao/2' }, role: 'reference_video' },
      ],
      generate_audio: site.video.haomao.generateAudio,
      resolution: site.video.haomao.resolution,
      ratio: site.template.aspectRatio,
      duration: 12,
      watermark: false,
    })
    expect(result).toEqual({ requestId: 'cgt_1', meta: { request } })
  })

  it('有参考配乐：多传一段音频、prompt 说明用它做音轨、开启音轨；风格 prompt 优先', async () => {
    const calls = stubFetch({ 'POST /api/v3/files/uploads': uploads(), 'POST /api/v3/contents/generations/tasks': () => json({ id: 'cgt_1' }) })
    await createHaomaoProvider(env()).submit(input({ audioKey: 'templates/neon-12s.mp3', style: { ...plainStyle, prompt: 'Style prompt.' } }))
    const request = calls[3]!.body as { content: unknown[]; generate_audio: boolean }
    expect(request.content[0]).toEqual({ type: 'text', text: 'Style prompt. Use audio 1 as the background music.' })
    expect(request.content[3]).toEqual({ type: 'audio_url', audio_url: { url: 'https://files.haomao/3' }, role: 'reference_audio' })
    expect(request.generate_audio).toBe(true)
  })

  it('R2 里没有素材：不可重试，不调用接口', async () => {
    const calls = stubFetch({})
    const error = await rejection(createHaomaoProvider(env()).submit(input({ imageKey: 'uploads/missing.jpg' })))
    expect(error).toMatchObject({ code: 'haomao_media_missing', retryable: false })
    expect(calls).toHaveLength(0)
  })

  it('没配 Key：provider_not_configured，不可重试', async () => {
    stubFetch({})
    const error = await rejection(createHaomaoProvider(env({ HAOMAO_API_KEY: '' })).submit(input()))
    expect(error).toMatchObject({ code: 'provider_not_configured', retryable: false })
  })

  it.each([
    [401, 'haomao_unauthorized', false],
    [402, 'haomao_insufficient_balance', false],
    [403, 'haomao_forbidden', false],
    [400, 'haomao_submit_400', false],
    [429, 'haomao_submit_429', true],
    [502, 'haomao_submit_502', true],
  ])('建任务返回 HTTP %i → %s（retryable=%s）', async (status, code, retryable) => {
    stubFetch({ 'POST /api/v3/files/uploads': uploads(), 'POST /api/v3/contents/generations/tasks': () => json({ error: { message: 'nope' } }, status) })
    expect(await rejection(createHaomaoProvider(env()).submit(input()))).toMatchObject({ code, retryable })
  })

  it('网络错误可重试', async () => {
    vi.stubGlobal('fetch', async () => {
      throw new TypeError('fetch failed')
    })
    expect(await rejection(createHaomaoProvider(env()).submit(input()))).toMatchObject({ code: 'haomao_upload_network', retryable: true })
  })
})

describe('haomao provider：查询', () => {
  const meta = { request: { model: 'seedance-2.0-fast' } }
  const statusOf = (task: unknown, taskMeta: Record<string, unknown> = meta) => {
    stubFetch({ 'GET /api/v3/contents/generations/tasks/cgt_1': () => json(task), 'POST /api/v3/contents/generations/tasks': () => json({ id: 'cgt_2' }) })
    return createHaomaoProvider(env()).status('cgt_1', taskMeta)
  }

  it('queued、running 继续轮询；succeeded 返回成片地址', async () => {
    expect(await statusOf({ id: 'cgt_1', status: 'queued' })).toEqual({ state: 'pending' })
    expect(await statusOf({ id: 'cgt_1', status: 'running' })).toEqual({ state: 'pending' })
    expect(await statusOf({ id: 'cgt_1', status: 'succeeded', content: { video_url: 'https://cdn/a.mp4' } })).toEqual({
      state: 'completed',
      output: { url: 'https://cdn/a.mp4' },
    })
    expect(await statusOf({ id: 'cgt_1', status: 'succeeded', content: {} })).toMatchObject({ state: 'failed', code: 'haomao_no_video' })
    // 余额不足：succeeded 但没有地址、payment_required，按账户错误处理
    expect(await statusOf({ id: 'cgt_1', status: 'succeeded', content: { video_url: '' }, payment_required: true })).toMatchObject({ state: 'failed', code: 'haomao_insufficient_balance' })
  })

  it('第一次失败用原请求体重提，换成新任务继续轮询', async () => {
    const result = await statusOf({ id: 'cgt_1', status: 'failed', error: { code: 'InternalError', message: 'boom' } })
    expect(result).toEqual({ state: 'pending', next: { requestId: 'cgt_2', meta: { ...meta, retried: true } } })
  })

  it('重提过还失败：判失败，错误码带上游 code', async () => {
    const result = await statusOf({ id: 'cgt_1', status: 'failed', error: { code: 'InputImageSensitiveContentDetected', message: 'blocked' } }, { ...meta, retried: true })
    expect(result).toMatchObject({ state: 'failed', code: 'haomao_InputImageSensitiveContentDetected' })
  })
})

describe('haomaoCostCents', () => {
  it('按秒数乘单价', () => {
    expect(haomaoCostCents(12)).toBe(Math.round(12 * site.video.haomao.costCentsPerSecond))
  })
})

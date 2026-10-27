// haomaotoken（可选的第四个视频服务商，VIDEO_PROVIDER=haomao）：火山引擎方舟内容生成接口的中转，路径与方舟一致。
// 用 Seedance 2.0 做参考生视频：照片（image 1）+ 模板源视频（video 1）+ 可选参考配乐（audio 1）+ prompt。
// 方舟只读 haomaotoken 文件存储里的素材，所以提交前先把三样从 R2 读出来上传到 /files/uploads，再用返回的地址建任务。
// 没有回调，靠 jobs.ts 轮询。创建任务没有幂等键：Worker 在建完任务、写库之前中断，重投时会再建一个（重复扣费），概率很低，不做去重。
// 任务失败时用同一请求体重提一次（haomaotoken 偶发临时失败，重提通常就能成功），第二次再失败才判失败退积分。
import { site } from '#/config/site'
import { cleanSecret } from '../util'
import type { VideoProvider, VideoStatus } from './types'
import { VideoProviderError } from './types'

const API = 'https://haomaotoken.com/api/v3'

// 方舟任务详情（只取用到的字段）
interface HaomaoTask {
  id?: string
  status?: string
  content?: { video_url?: string }
  // 余额不足时任务照样 succeeded，但成片地址为空、payment_required 为 true（充值后才能取结果）
  payment_required?: boolean
  error?: { code?: string; message?: string } | null
}

export function createHaomaoProvider(env: Env): VideoProvider {
  const key = cleanSecret(env.HAOMAO_API_KEY)
  const auth = () => {
    if (!key) throw new VideoProviderError('provider_not_configured', 'HAOMAO_API_KEY missing', false)
    return { Authorization: `Bearer ${key}` }
  }

  // 发请求；网络错误可重试，HTTP 错误按状态码映射
  async function call<T>(stage: string, path: string, init: RequestInit = {}) {
    let response: Response
    try {
      response = await fetch(`${API}${path}`, { ...init, headers: { ...auth(), ...init.headers } })
    } catch (error) {
      if (error instanceof VideoProviderError) throw error
      const reason = error instanceof Error ? error.message : 'unknown'
      throw new VideoProviderError(`haomao_${stage}_network`, `haomao ${stage} network error: ${reason}`.slice(0, 500), true)
    }
    const body = (await response.json().catch(() => null)) as (T & { error?: { message?: string } }) | null
    if (!response.ok || !body) throw requestError(stage, response.status, body?.error?.message)
    return body
  }

  // 把 R2 里的素材上传到 haomaotoken 文件存储，返回方舟能读的地址
  async function upload(r2Key: string) {
    const object = await env.MEDIA.get(r2Key)
    if (!object) throw new VideoProviderError('haomao_media_missing', `R2 object ${r2Key} not found`, false)
    const name = r2Key.split('/').pop() || 'file'
    const form = new FormData()
    form.set('file', new File([await object.arrayBuffer()], name, { type: object.httpMetadata?.contentType ?? 'application/octet-stream' }))
    const { url } = await call<{ url?: string }>('upload', '/files/uploads', { method: 'POST', body: form })
    if (!url) throw new VideoProviderError('haomao_upload_no_url', 'haomao upload returned no url', true)
    return url
  }

  async function createTask(request: unknown) {
    const task = await call<HaomaoTask>('submit', '/contents/generations/tasks', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(request),
    })
    if (!task.id) throw new VideoProviderError('haomao_submit_no_id', 'haomao submit returned no task id', true)
    return task.id
  }

  return {
    id: 'haomao',
    async submit(input) {
      const { model, resolution, generateAudio } = site.video.haomao
      const imageUrl = await upload(input.imageKey)
      const videoUrl = await upload(input.sourceVideoKey)
      const audioUrl = input.audioKey ? await upload(input.audioKey) : null
      const prompt = input.style.prompt ?? site.video.haomao.prompt
      const content: unknown[] = [
        // 有参考配乐时在 prompt 末尾说明用它做音轨
        { type: 'text', text: audioUrl ? `${prompt} Use audio 1 as the background music.` : prompt },
        { type: 'image_url', image_url: { url: imageUrl }, role: 'reference_image' },
        { type: 'video_url', video_url: { url: videoUrl }, role: 'reference_video' },
      ]
      if (audioUrl) content.push({ type: 'audio_url', audio_url: { url: audioUrl }, role: 'reference_audio' })
      const request = {
        model,
        content,
        generate_audio: Boolean(audioUrl) || generateAudio,
        resolution,
        ratio: site.template.aspectRatio,
        duration: Math.round(input.durationSeconds),
        watermark: false,
      }
      const requestId = await createTask(request)
      // 请求体留在 meta 里，任务失败时原样重提一次
      return { requestId, meta: { request } }
    },

    async status(requestId, meta): Promise<VideoStatus> {
      const task = await call<HaomaoTask>('status', `/contents/generations/tasks/${encodeURIComponent(requestId)}`)
      if (task.status === 'succeeded') {
        // 余额不足：按账户错误判失败（立即告警、退积分），不当作普通的“没有成片”
        if (task.payment_required) return { state: 'failed', code: 'haomao_insufficient_balance', message: 'haomao balance too low to fetch the result' }
        const url = task.content?.video_url
        if (!url) return { state: 'failed', code: 'haomao_no_video', message: 'haomao task succeeded without a video url' }
        return { state: 'completed', output: { url } }
      }
      if (task.status === 'failed' || task.status === 'cancelled' || task.status === 'expired') {
        // 第一次失败：用原请求体重提，任务换成新的 id 继续轮询
        if (!meta.retried && meta.request) {
          const retryId = await createTask(meta.request)
          return { state: 'pending', next: { requestId: retryId, meta: { ...meta, retried: true } } }
        }
        const code = task.error?.code ?? task.status
        return { state: 'failed', code: `haomao_${code}`, message: `${code}: ${task.error?.message ?? 'haomao task failed'}`.slice(0, 500) }
      }
      // queued、running 和未知状态都继续轮询
      return { state: 'pending' }
    },

    costCents: haomaoCostCents,
  }
}

// 估算：按成片秒数乘单价，单价在 site.video.haomao.costCentsPerSecond
export function haomaoCostCents(durationSeconds: number) {
  return Math.round(durationSeconds * site.video.haomao.costCentsPerSecond)
}

// 401 密钥无效、402 余额不足、403 账户受限都是账户问题（触发告警，重试没用）；408、429、5xx 可重试
function requestError(stage: string, status: number, message?: string) {
  const account: Record<number, string> = { 401: 'haomao_unauthorized', 402: 'haomao_insufficient_balance', 403: 'haomao_forbidden' }
  return new VideoProviderError(
    account[status] ?? `haomao_${stage}_${status}`,
    [`haomao ${stage} failed (HTTP ${status})`, message].filter(Boolean).join(': ').slice(0, 500),
    status === 408 || status === 429 || status >= 500,
  )
}

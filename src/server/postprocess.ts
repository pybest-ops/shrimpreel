// 成片配乐：风格配了原曲（styles[].audio）时，成片转存 R2 之后交给后处理容器（containers/postprocess 的 /mux），
// 画面原样复制、音轨换成原曲，再写回同一个 R2 key。视频模型（如 Seedance）给不出原曲，只能事后合成。
// 容器是 Cloudflare Containers（Durable Object 绑定 POSTPROCESS，类在 postprocess-container.ts），站点按需在 wrangler.jsonc 里开启。
// 本文件不 import @cloudflare/containers：它依赖 cloudflare:workers，单元测试（Node）加载不了。
import { findDuration, findStyle } from '#/config/site'

// 同时开几个容器实例：每个实例一次只处理一个任务，忙时返回 503，由队列重试
const INSTANCES = 3

// retryable：容器忙、冷启动失败、网络错误，队列重投后再合成；否则任务失败退积分
export class PostprocessError extends Error {
  constructor(
    readonly code: string,
    message: string,
    readonly retryable: boolean,
  ) {
    super(message)
  }
}

// 这个任务（风格 + 时长档位）的原曲在 R2 的 key；风格没配原曲时为 undefined
export function styleAudioKey(styleId: string, durationId: string) {
  const file = findStyle(styleId)?.audio?.[durationId]
  return file && findDuration(durationId) ? `templates/${file}` : undefined
}

// 读出成片和原曲，交给容器合成，结果覆盖原来的成片
export async function muxStyleAudio(env: Env, outputKey: string, audioKey: string) {
  if (!env.POSTPROCESS) throw new PostprocessError('postprocess_not_configured', 'POSTPROCESS container binding missing', false)
  const [video, audio] = await Promise.all([env.MEDIA.get(outputKey), env.MEDIA.get(audioKey)])
  if (!video) throw new PostprocessError('output_missing', `R2 object ${outputKey} not found`, false)
  if (!audio) throw new PostprocessError('audio_missing', `R2 object ${audioKey} not found`, false)

  const form = new FormData()
  form.set('video', new File([await video.arrayBuffer()], 'video.mp4', { type: 'video/mp4' }))
  form.set('audio', new File([await audio.arrayBuffer()], audioKey.split('/').pop() || 'audio', { type: audio.httpMetadata?.contentType ?? 'application/octet-stream' }))
  const stub = env.POSTPROCESS.get(env.POSTPROCESS.idFromName(`postprocess-${Math.floor(Math.random() * INSTANCES)}`))
  let response: Response
  try {
    response = await stub.fetch('http://postprocess/mux', { method: 'POST', body: form })
  } catch (error) {
    const reason = error instanceof Error ? error.message : 'unknown'
    throw new PostprocessError('postprocess_unavailable', `postprocess container error: ${reason}`.slice(0, 500), true)
  }
  if (!response.ok) {
    const body = (await response.json().catch(() => null)) as { error?: string; detail?: string } | null
    // 4xx 是输入有问题（坏视频、合成失败），重试也一样；5xx（含 503 忙）可重试
    throw new PostprocessError(
      `postprocess_${body?.error ?? response.status}`,
      `postprocess mux failed (HTTP ${response.status}): ${body?.detail ?? body?.error ?? ''}`.slice(0, 500),
      response.status >= 500,
    )
  }
  await env.MEDIA.put(outputKey, await response.arrayBuffer(), { httpMetadata: { contentType: 'video/mp4' } })
}

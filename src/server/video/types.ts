import type { Style } from '#/config/site'

export interface VideoSubmitInput {
  generationId: string
  // 任务所属风格：prompt、两步走的首帧都跟着风格走
  style: Style
  durationSeconds: number
  imageUrl: string
  // 照片在 R2 的 key：要先把素材转存到服务商存储的 provider（haomao）直接从 R2 读，不经过签名地址
  imageKey: string
  sourceVideoUrl: string
  sourceVideoKey: string
  // 多人风格可选位置的照片（R2 key），按 style.seats 的顺序；只有支持多张参考图的服务商（haomao）使用
  seatImages?: Array<{ seatId: string; key: string }>
  // 这个风格、这个时长档位的参考配乐在 R2 的 key（styles[].audio），没有则不带
  audioKey?: string
  webhookUrl: string
  meta: Record<string, unknown>
}

export interface VideoSubmitResult {
  requestId: string
  meta: Record<string, unknown>
}

export type VideoStatus =
  // next：多步任务进入下一步，jobs.ts 把它写回 provider_request_id / provider_meta，之后轮询新的服务商任务
  | { state: 'pending'; next?: VideoSubmitResult }
  // costCents：服务商返回了已结算的实际费用时带上，否则用 costCents() 估算
  | { state: 'completed'; output: { url: string } | { r2Key: string }; costCents?: number }
  | { state: 'failed'; code: string; message: string; retryable?: boolean }

export interface VideoProvider {
  id: 'fal' | 'yir' | 'nanoapi' | 'haomao' | 'mock'
  submit(input: VideoSubmitInput): Promise<VideoSubmitResult>
  status(requestId: string, meta: Record<string, unknown>): Promise<VideoStatus>
  // 出一条成片的估算成本（美分），出片后写入 generations.provider_cost_cents
  // styleId：yir 两步走按风格决定要不要加合成图的费用
  costCents(durationSeconds: number, styleId: string): number
}

// 可重试错误（网络/限流/5xx）：队列会重投；不可重试错误直接失败并退积分
export class VideoProviderError extends Error {
  constructor(
    readonly code: string,
    message: string,
    readonly retryable: boolean,
  ) {
    super(message)
  }
}

import { useRouterState } from '@tanstack/react-router'
import { CircleAlert, CircleCheck, Download, Upload, X } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import { STYLES, cheapestPackageCovering, defaultStyle, formatPrice, site, type StyleSeat } from '#/config/site'
import { api, errorCode, isActiveGeneration, type Generation } from '#/lib/api'
import { track } from '#/lib/attribution'
import { useCheckout } from '#/lib/checkout'
import { useContent, useLocale, useLocalePath } from '#/lib/i18n'
import { signInHref, useSession } from '#/lib/session'
import { AiBadge, ErrorText, GoogleIcon, LocalLink, Spinner, formatDate } from './ui'

type Photo = { file: File; previewUrl: string; uploadId: string | null }
// 主角照片的键；多人风格的可选位置用各自的 seat id
const MAIN = 'main'

const POLL_MS = 3000

// styleId / onStyleChange：首页把风格状态提到外面，让 hero 标签和生成器同步；不传时生成器自己管
export function Generator({ styleId: controlledStyleId, onStyleChange }: { styleId?: string; onStyleChange?: (id: string) => void } = {}) {
  const c = useContent()
  const g = c.generator
  const lp = useLocalePath()
  const locale = useLocale()
  const pathname = useRouterState({ select: (s) => s.location.pathname })
  const { user, config, loading, refresh } = useSession()
  const inputRef = useRef<HTMLInputElement>(null)
  // 文件选择框是共用的，点哪个格子就记下哪个位置
  const pickSeat = useRef<string>(MAIN)
  const [photos, setPhotos] = useState<Record<string, Photo>>({})
  const photosRef = useRef(photos)
  photosRef.current = photos
  // 正在上传的照片数：多人风格可以同时传好几张
  const [uploads, setUploads] = useState(0)
  const uploading = uploads > 0
  const [dragging, setDragging] = useState(false)
  const [ownStyleId, setOwnStyleId] = useState<string>(defaultStyle.id)
  const styleId = controlledStyleId ?? ownStyleId
  const selectStyle = onStyleChange ?? setOwnStyleId
  const style = STYLES.find((s) => s.id === styleId) ?? defaultStyle
  // 多人风格：第一个位置是主角（照片存在 MAIN），其余可选
  const seats = style.seats?.length ? style.seats : null
  const photo = photos[MAIN] ?? null
  const [durationId, setDurationId] = useState<string>(site.durations[site.durations.length - 1]!.id)
  const [consent, setConsent] = useState(false)
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [generation, setGeneration] = useState<Generation | null>(null)

  const checkout = useCheckout()
  const duration = site.durations.find((d) => d.id === durationId) ?? site.durations[0]!
  const shortfall = user ? Math.max(0, duration.credits - user.credits) : 0
  // 余额不足时直接在这里下单够用的最便宜积分包；没有够用的包就退回去价格页
  const coverPack = shortfall > 0 ? cheapestPackageCovering(shortfall) : undefined

  // 卸载时释放所有预览图；单个位置换照片或移除时在 setSeatPhoto 里释放
  useEffect(() => () => {
    for (const item of Object.values(photosRef.current)) URL.revokeObjectURL(item.previewUrl)
  }, [])

  // 轮询当前任务直到结束；结束后刷新余额（失败时积分已退回）
  useEffect(() => {
    if (!generation || !isActiveGeneration(generation)) return
    const timer = setTimeout(async () => {
      try {
        const data = await api<{ generation: Generation }>(`/api/generations/${generation.id}`)
        setGeneration(data.generation)
        if (!isActiveGeneration(data.generation)) await refresh()
      } catch (err) {
        setError(errorCode(err))
        setGeneration({ ...generation })
      }
    }, POLL_MS)
    return () => clearTimeout(timer)
  }, [generation, refresh])

  async function upload(file: File) {
    setUploads((n) => n + 1)
    try {
      const form = new FormData()
      form.append('file', file)
      const data = await api<{ upload: { id: string } }>('/api/uploads', { form })
      return data.upload.id
    } finally {
      setUploads((n) => n - 1)
    }
  }

  // 换掉或移除一个位置的照片，同时释放旧的预览图
  function setSeatPhoto(seat: string, next: Photo | null) {
    setPhotos((current) => {
      const old = current[seat]
      if (old && old !== next) URL.revokeObjectURL(old.previewUrl)
      const { [seat]: _, ...rest } = current
      return next ? { ...rest, [seat]: next } : rest
    })
  }

  // 上传完成后只在这个位置还是同一个文件时写回 uploadId（期间可能已经换了照片）
  function rememberUpload(seat: string, file: File, uploadId: string) {
    setPhotos((current) => (current[seat]?.file === file ? { ...current, [seat]: { ...current[seat]!, uploadId } } : current))
  }

  async function selectFile(file: File | undefined, seat = MAIN) {
    if (!file) return
    setError(null)
    if (!(site.upload.contentTypes as readonly string[]).includes(file.type)) return setError('unsupported_file_type')
    if (file.size > site.upload.maxBytes) return setError('file_too_large')
    setSeatPhoto(seat, { file, previewUrl: URL.createObjectURL(file), uploadId: null })
    setGeneration(null)
    if (!user) return
    try {
      rememberUpload(seat, file, await upload(file))
    } catch (err) {
      setError(errorCode(err))
    }
  }

  // 拿到一个位置的 uploadId：没登录时选的照片在这里补传
  async function ensureUpload(seat: string) {
    const item = photos[seat]!
    if (item.uploadId) return item.uploadId
    const uploadId = await upload(item.file)
    rememberUpload(seat, item.file, uploadId)
    return uploadId
  }

  async function generate() {
    if (!photo) return setError('invalid_upload')
    setError(null)
    setSubmitting(true)
    try {
      const uploadId = await ensureUpload(MAIN)
      // 只提交当前风格里填了照片的可选位置
      const filled = (seats ?? []).slice(1).filter((seat) => photos[seat.id])
      const seatUploads = Object.fromEntries(await Promise.all(filled.map(async (seat) => [seat.id, await ensureUpload(seat.id)] as const)))
      const data = await api<{ generation: Generation }>('/api/generations', { json: { uploadId, seats: seatUploads, durationId, styleId, locale } })
      track('generate_video', { style_id: styleId, duration_id: durationId, credits: data.generation.creditsCost, seats: filled.length + 1 })
      setGeneration(data.generation)
      await refresh()
    } catch (err) {
      setError(errorCode(err))
      await refresh()
    } finally {
      setSubmitting(false)
    }
  }

  function reset() {
    setGeneration(null)
    setError(null)
  }

  const busy = uploading || submitting || (generation !== null && isActiveGeneration(generation))

  return (
    <section
      className="card space-y-5 p-5 shadow-[0_1px_0_var(--line),0_20px_40px_-24px_rgba(0,0,0,0.25)] sm:p-6"
      aria-labelledby="generator-title"
      data-testid="generator"
    >
      {/* 标题只给读屏和大纲用：页面 H1 之后接 H2，步骤标题是 H3 */}
      <h2 id="generator-title" className="sr-only">
        {g.title}
      </h2>
      {/* 1. 照片 */}
      <section className="space-y-3">
        <StepTitle n={1}>{g.stepPhoto}</StepTitle>
        {/* 键盘与读屏从下面的按钮进入，隐藏的 input 不占 Tab 位 */}
        <input
          ref={inputRef}
          type="file"
          accept={site.upload.contentTypes.join(',')}
          className="sr-only"
          tabIndex={-1}
          aria-label={g.dropTitle}
          data-testid="photo-input"
          onChange={(event) => {
            void selectFile(event.target.files?.[0], pickSeat.current)
            event.target.value = ''
          }}
        />
        {seats ? (
          <SeatGrid
            seats={seats}
            photos={photos}
            copy={c.styles[style.id as keyof typeof c.styles]}
            busy={busy}
            onPick={(seat) => {
              pickSeat.current = seat
              inputRef.current?.click()
            }}
            onDrop={(seat, file) => void selectFile(file, seat)}
            onRemove={(seat) => setSeatPhoto(seat, null)}
          />
        ) : (
        <button
          type="button"
          disabled={busy}
          onClick={() => {
            pickSeat.current = MAIN
            inputRef.current?.click()
          }}
          onDragOver={(event) => {
            event.preventDefault()
            setDragging(true)
          }}
          onDragLeave={() => setDragging(false)}
          onDrop={(event) => {
            event.preventDefault()
            setDragging(false)
            void selectFile(event.dataTransfer.files?.[0], MAIN)
          }}
          className={`flex w-full items-center justify-center rounded-xl border-2 border-dashed px-4 py-6 text-center transition ${
            dragging ? 'border-accent bg-accent/5' : 'border-line hover:border-fg/40'
          }`}
        >
          {photo ? (
            <span className="flex items-center gap-4 text-left">
              <img src={photo.previewUrl} alt="" className="size-20 rounded-lg object-cover" />
              <span className="space-y-1">
                <span className="flex items-center gap-1.5 text-sm font-semibold">
                  {uploading ? <Spinner /> : <CircleCheck className="size-4 text-emerald-600" />}
                  {uploading ? g.uploading : g.uploaded}
                </span>
                <span className="block text-xs text-muted underline">{g.change}</span>
              </span>
            </span>
          ) : (
            <span className="flex flex-col items-center gap-2.5">
              <span className="grid size-11 place-items-center rounded-full bg-ink text-ink-fg">
                <Upload className="size-5" />
              </span>
              <span className="text-sm font-semibold">{g.dropTitle}</span>
              <span className="text-xs text-muted">{g.dropHint}</span>
            </span>
          )}
        </button>
        )}
        <p className="text-xs leading-5 text-muted">{g.guidance}</p>
      </section>

      {/* 2. 风格：只有一种风格时不显示 */}
      {STYLES.length > 1 ? (
        <section className="space-y-3">
          <StepTitle n={2}>{g.stepStyle}</StepTitle>
          <div className="grid gap-2 sm:grid-cols-2" role="radiogroup" aria-label={g.stepStyle}>
            {STYLES.map((style) => {
              const active = style.id === styleId
              const copy = c.styles[style.id as keyof typeof c.styles]
              const thumb = style.examples.aiVersions[0]
              return (
                <button
                  key={style.id}
                  type="button"
                  role="radio"
                  aria-checked={active}
                  disabled={busy}
                  data-testid={`style-${style.id}`}
                  onClick={() => selectStyle(style.id)}
                  className={`flex items-center gap-3 rounded-xl p-2 text-left transition ${active ? 'bg-card shadow-sm ring-2 ring-ink' : 'bg-bg-soft text-muted ring-1 ring-line hover:text-fg'}`}
                >
                  {thumb ? <img src={thumb.poster} alt="" loading="lazy" className="aspect-[3/4] w-10 shrink-0 rounded-md object-cover" /> : null}
                  <span className="min-w-0">
                    <span className="block text-sm font-semibold text-fg">{copy.name}</span>
                    <span className="block text-xs text-muted">{copy.tagline}</span>
                  </span>
                </button>
              )
            })}
          </div>
        </section>
      ) : null}

      {/* 时长 */}
      <section className="space-y-3">
        <StepTitle n={STYLES.length > 1 ? 3 : 2}>{g.stepLength}</StepTitle>
        <div className="grid grid-cols-3 gap-1 rounded-xl bg-bg-soft p-1" role="radiogroup" aria-label={g.stepLength}>
          {site.durations.map((d) => {
            const active = d.id === durationId
            return (
              <button
                key={d.id}
                type="button"
                role="radio"
                aria-checked={active}
                disabled={busy}
                data-testid={`duration-${d.id}`}
                onClick={() => setDurationId(d.id)}
                className={`rounded-lg px-2 py-2 text-center transition ${active ? 'bg-card shadow-sm ring-1 ring-line' : 'text-muted hover:text-fg'}`}
              >
                <span className="block text-sm font-semibold">
                  {g.seconds(d.seconds)}
                  {'isFull' in d && d.isFull ? ` · ${g.full}` : ''}
                </span>
                <span className="block text-xs text-muted">{g.creditsLabel(d.credits)}</span>
              </button>
            )
          })}
        </div>
      </section>

      <label className="flex items-start gap-3 text-xs leading-5 text-muted">
        <input
          type="checkbox"
          checked={consent}
          onChange={(event) => setConsent(event.target.checked)}
          className="mt-0.5 size-4 shrink-0 accent-[var(--ink)]"
          data-testid="consent"
        />
        <span>{seats ? g.consentSeats : g.consent}</span>
      </label>

      {/* CTA */}
      <div className="space-y-2">
        {loading ? (
          <div className="btn-primary w-full py-3.5 opacity-60">
            <Spinner />
          </div>
        ) : !user ? (
          <a href={signInHref(config, pathname, lp('/sign-in'))} className="btn-primary w-full py-3.5" data-testid="generator-sign-up">
            <GoogleIcon /> {g.ctaSignUp}
          </a>
        ) : shortfall > 0 && coverPack ? (
          <>
            <button
              type="button"
              className="btn-primary w-full py-3.5"
              disabled={checkout.pending !== null || checkout.paused}
              onClick={() => checkout.buy(coverPack.id)}
              data-testid="generator-buy"
            >
              {checkout.paused ? (
                c.pricing.paused
              ) : checkout.pending === coverPack.id ? (
                <>
                  <Spinner /> {c.pricing.buying}
                </>
              ) : (
                g.ctaBuyPack(coverPack.credits, formatPrice(coverPack.priceCents, coverPack.currency))
              )}
            </button>
            <p className="text-center text-xs">
              <LocalLink to="/pricing" className="text-muted underline" data-testid="generator-see-packs">
                {g.seePacks}
              </LocalLink>
            </p>
            <ErrorText code={checkout.error} />
          </>
        ) : shortfall > 0 ? (
          <LocalLink to="/pricing" className="btn-primary w-full py-3.5" data-testid="generator-buy">
            {g.ctaBuy}
          </LocalLink>
        ) : (
          <button
            type="button"
            className="btn-primary w-full py-3.5"
            disabled={busy || !photo || !consent}
            onClick={generate}
            data-testid="generate"
          >
            {submitting ? <Spinner /> : null}
            {g.ctaGenerate(duration.credits)}
          </button>
        )}
        {user ? (
          <p className="text-center text-xs text-muted" data-testid="generator-balance">
            {g.balance(user.credits)}
            {shortfall > 0 ? ` · ${g.needMore(shortfall)}` : ''}
          </p>
        ) : null}
        {user && photo && !consent && !generation ? <p className="text-center text-xs text-muted">{g.needConsent}</p> : null}
        <ErrorText code={error} />
      </div>

      {generation ? <GenerationResult generation={generation} onReset={reset} /> : null}
    </section>
  )
}

// 多人风格的照片格子：第一个是必填的主角（大格），其余可选；填了的可选格可以移除
function SeatGrid({
  seats,
  photos,
  copy,
  busy,
  onPick,
  onDrop,
  onRemove,
}: {
  seats: readonly StyleSeat[]
  photos: Record<string, Photo>
  copy: { seats?: Record<string, { name: string; hint: string }>; seatsNote?: string }
  busy: boolean
  onPick: (seat: string) => void
  onDrop: (seat: string, file: File | undefined) => void
  onRemove: (seat: string) => void
}) {
  const g = useContent().generator
  return (
    <div className="space-y-2">
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-3" data-testid="seat-grid">
        {seats.map((seat, index) => {
          const key = index === 0 ? MAIN : seat.id
          const item = photos[key]
          const label = copy.seats?.[seat.id]
          return (
            <div key={seat.id} className={`relative ${index === 0 ? 'col-span-2 row-span-2 sm:col-span-1' : ''}`}>
              <button
                type="button"
                disabled={busy}
                onClick={() => onPick(key)}
                onDragOver={(event) => event.preventDefault()}
                onDrop={(event) => {
                  event.preventDefault()
                  onDrop(key, event.dataTransfer.files?.[0])
                }}
                data-testid={`seat-${seat.id}`}
                className={`flex h-full min-h-28 w-full flex-col justify-end gap-0.5 overflow-hidden rounded-xl border-2 p-2.5 text-left transition ${
                  index === 0 ? 'border-solid border-ink/60' : 'border-dashed border-line hover:border-fg/40'
                }`}
              >
                {item ? <img src={item.previewUrl} alt="" className="absolute inset-0 size-full rounded-[10px] object-cover" /> : null}
                <span className={`relative rounded-md px-1.5 py-0.5 ${item ? 'bg-bg/85' : ''}`}>
                  <span className="block text-sm font-semibold">{label?.name ?? seat.id}</span>
                  <span className="block text-xs text-muted">{item ? g.change : index === 0 ? (label?.hint ?? g.addPhoto) : `${g.optional} · ${label?.hint ?? g.addPhoto}`}</span>
                </span>
              </button>
              {item && index > 0 ? (
                <button
                  type="button"
                  disabled={busy}
                  onClick={() => onRemove(key)}
                  aria-label={g.removePhoto}
                  className="absolute top-1.5 right-1.5 grid size-6 place-items-center rounded-full bg-bg/90 text-fg shadow"
                >
                  <X className="size-3.5" />
                </button>
              ) : null}
            </div>
          )
        })}
      </div>
      {copy.seatsNote ? <p className="text-xs leading-5 text-muted">{copy.seatsNote}</p> : null}
    </div>
  )
}

function StepTitle({ n, children }: { n: number; children: string }) {
  return (
    <h3 className="flex items-center gap-2 text-sm font-semibold">
      <span className="grid size-5 place-items-center rounded-full bg-ink text-[11px] text-ink-fg">{n}</span>
      {children}
    </h3>
  )
}

function GenerationResult({ generation, onReset }: { generation: Generation; onReset: () => void }) {
  const g = useContent().generator
  const locale = useLocale()
  return (
    <div className="space-y-3 rounded-xl border border-line bg-bg-soft p-4" data-testid="generation-status" data-status={generation.status}>
      {isActiveGeneration(generation) ? (
        <p className="flex items-start gap-2 text-sm">
          <Spinner className="mt-0.5 size-4 shrink-0" />
          {generation.status === 'queued' ? g.queued : g.processing}
        </p>
      ) : generation.status === 'succeeded' && generation.videoUrl ? (
        <>
          <p className="flex items-center gap-2 text-sm font-semibold">
            <CircleCheck className="size-4 text-emerald-600" /> {g.succeeded}
          </p>
          <div className="relative mx-auto w-fit">
            <AiBadge />
            <video src={generation.videoUrl} controls playsInline className="max-h-[420px] rounded-lg bg-black" data-testid="generation-video" />
          </div>
          <p className="text-xs text-muted" data-testid="ai-notice">
            {g.aiNotice}
            {generation.expiresAt ? ` ${g.expiresOn(formatDate(generation.expiresAt, locale))}` : null}
          </p>
          <div className="flex flex-wrap gap-2">
            <a href={`${generation.videoUrl}?download=1`} className="btn-primary px-4 py-2" download>
              <Download className="size-4" /> {g.download}
            </a>
            <LocalLink to="/dashboard" className="btn-ghost px-4 py-2">
              {g.viewAll}
            </LocalLink>
            <button type="button" className="btn-ghost px-4 py-2" onClick={onReset}>
              {g.makeAnother}
            </button>
          </div>
        </>
      ) : (
        <div className="space-y-2 text-sm">
          <p className="flex items-center gap-2 font-semibold text-red-600 dark:text-red-400">
            <CircleAlert className="size-4" /> {g.failed}
          </p>
          {generation.refunded ? <p className="text-muted">{g.refunded}</p> : null}
          <button type="button" className="btn-ghost px-4 py-2" onClick={onReset}>
            {g.makeAnother}
          </button>
        </div>
      )}
    </div>
  )
}

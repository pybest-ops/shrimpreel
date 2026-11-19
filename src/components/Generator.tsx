import { useRouterState } from '@tanstack/react-router'
import { CircleAlert, CircleCheck, Download, Smartphone, Upload, X } from 'lucide-react'
import { useCallback, useEffect, useRef, useState } from 'react'
import { DISPLAY_STYLES, STYLES, cheapestPackageCovering, featuredStyle, findStyle, formatPrice, site, styleDurations, stylePhotoCount, type StyleSeat } from '#/config/site'
import { api, errorCode, isActiveGeneration, type Generation } from '#/lib/api'
import { track } from '#/lib/attribution'
import { useCheckout } from '#/lib/checkout'
import { useContent, useLocale } from '#/lib/i18n'
import { clearDraft, loadDraft, saveDraft } from '#/lib/photo-draft'
import { useSession } from '#/lib/session'
import { PhoneUploadPanel } from './PhoneUploadPanel'
import { SignInModal } from './SignInModal'
import { toast } from './Toast'
import { AiBadge, ErrorText, LocalLink, Spinner, formatDate } from './ui'
import { preparePhoto } from '#/lib/prepare-photo'

type Photo = { file: File; previewUrl: string; uploadId: string | null }
type Slot = 0 | 1
type Photos = [Photo | null, Photo | null]
// 多人风格可选位置的照片：seat id → 照片；主角照片在 photos[0]
type SeatPhotos = Record<string, Photo>
// 多人风格共享的文件选择框这次要点开的格子：'main' 或座位 id
type PickTarget = 'main' | string

const POLL_MS = 3000

// styleId / onStyleChange：首页把风格状态提到外面，让 hero 标签和生成器同步；不传时生成器自己管
export function Generator({ styleId: controlledStyleId, onStyleChange }: { styleId?: string; onStyleChange?: (id: string) => void } = {}) {
  const c = useContent()
  const g = c.generator
  const locale = useLocale()
  const pathname = useRouterState({ select: (s) => s.location.pathname })
  const { user, loading, refresh } = useSession()
  // 两个照片槽：第 1 槽 = 源视频左边的人（单人风格只用它），第 2 槽 = 右边的人；切回单人风格时第 2 槽保留在状态里但被忽略
  const [photos, setPhotos] = useState<Photos>([null, null])
  // 多人风格（styles[].seats）可选位置的照片；主角占第 1 个位置，存在 photos[0]
  const [seatPhotos, setSeatPhotos] = useState<SeatPhotos>({})
  const [uploading, setUploading] = useState(0)
  const [ownStyleId, setOwnStyleId] = useState<string>(featuredStyle.id)
  const styleId = controlledStyleId ?? ownStyleId
  const selectStyle = onStyleChange ?? setOwnStyleId
  const currentStyle = findStyle(styleId) ?? featuredStyle
  const need = stylePhotoCount(currentStyle)
  // 多人风格：第一个位置是主角，其余可选
  const seatList = currentStyle.seats?.length ? currentStyle.seats : null
  const styleDurationList = styleDurations(currentStyle)
  const [durationId, setDurationId] = useState<string>(styleDurationList[styleDurationList.length - 1]!.id)
  const [consent, setConsent] = useState(false)
  // 点按钮时没勾选协议：把协议那一行滚到可见并短暂高亮
  const consentRef = useRef<HTMLLabelElement>(null)
  const [consentFlash, setConsentFlash] = useState(false)
  // 没登录时点主按钮打开登录弹窗，不离开页面
  const [signInOpen, setSignInOpen] = useState(false)
  const closeSignIn = useCallback(() => setSignInOpen(false), [])
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [generation, setGeneration] = useState<Generation | null>(null)
  const [phoneOpen, setPhoneOpen] = useState(false)
  const rootRef = useRef<HTMLElement>(null)
  const photosRef = useRef<Photos>([null, null])
  photosRef.current = photos
  const seatPhotosRef = useRef(seatPhotos)
  seatPhotosRef.current = seatPhotos
  // 多人格式的共享文件选择框：记下这次要点开的格子
  const seatInputRef = useRef<HTMLInputElement>(null)
  const pickTarget = useRef<PickTarget>('main')
  // 每张照片只上传一次：登录后自动上传和点生成时补传共用同一个请求
  const inflight = useRef(new Map<File, Promise<string>>())
  const photo = photos[0]
  // 当前风格需要的照片都已选好
  const photosReady = photos.slice(0, need).every((p) => p !== null)
  // 最近一次写进草稿的内容：恢复草稿后不重复写（否则每次访问都会把 24 小时重新计时），生成成功后不再写
  const draftRef = useRef<{ file: File; file2: File | null; seats: Readonly<Record<string, File>>; styleId: string; durationId: string; consent: boolean } | null>(null)
  const draftClearedRef = useRef<File | null>(null)

  const checkout = useCheckout()
  const duration = styleDurationList.find((d) => d.id === durationId) ?? styleDurationList[styleDurationList.length - 1]!
  const shortfall = user ? Math.max(0, duration.credits - user.credits) : 0
  // 余额不足时直接在这里下单够用的最便宜积分包；没有够用的包就退回去价格页
  const coverPack = shortfall > 0 ? cheapestPackageCovering(shortfall) : undefined
  // 访客也先看到这个视频要多少积分、最便宜的够用的包多少钱
  const guestPack = !user ? cheapestPackageCovering(duration.credits) : undefined

  useEffect(() => () => {
    if (photos[0]) URL.revokeObjectURL(photos[0].previewUrl)
  }, [photos[0]])
  useEffect(() => () => {
    if (photos[1]) URL.revokeObjectURL(photos[1].previewUrl)
  }, [photos[1]])
  // 卸载时释放多人风格可选位置的预览图；换照片或移除时在 setSeatPhoto 里释放
  useEffect(() => () => {
    for (const item of Object.values(seatPhotosRef.current)) URL.revokeObjectURL(item.previewUrl)
  }, [])

  // 切换风格后，当前时长不在新风格的档位里就选它最长的档位
  useEffect(() => {
    if (!styleDurationList.some((d) => d.id === durationId)) setDurationId(styleDurationList[styleDurationList.length - 1]!.id)
  }, [styleId])

  // 挂载时（只在客户端）恢复登录或付款跳转前保存的草稿：照片、风格、时长、授权勾选
  useEffect(() => {
    let cancelled = false
    void loadDraft().then((draft) => {
      if (cancelled || !draft || photosRef.current[0]) return
      const file = new File([draft.file], draft.name, { type: draft.type })
      const file2 = draft.file2 ? new File([draft.file2], draft.name2 ?? 'photo-2', { type: draft.type2 ?? draft.file2.type }) : null
      const nextStyle = STYLES.some((s) => s.id === draft.styleId) ? draft.styleId : styleId
      // 时长按恢复出的风格自己的档位校验
      const nextStyleDurations = styleDurations(findStyle(nextStyle) ?? featuredStyle)
      const nextDuration = nextStyleDurations.some((d) => d.id === draft.durationId)
        ? draft.durationId
        : nextStyleDurations.some((d) => d.id === durationId)
          ? durationId
          : nextStyleDurations[nextStyleDurations.length - 1]!.id
      const seatEntries = Object.entries(draft.seats ?? {}).filter((entry): entry is [string, { file: Blob; name: string; type: string }] => Boolean(entry[1]?.file))
      const seatFiles = Object.fromEntries(seatEntries.map(([id, s]) => [id, new File([s.file], s.name, { type: s.type })]))
      draftRef.current = { file, file2, seats: seatFiles, styleId: nextStyle, durationId: nextDuration, consent: draft.consent === true }
      setPhotos([
        { file, previewUrl: URL.createObjectURL(file), uploadId: null },
        file2 ? { file: file2, previewUrl: URL.createObjectURL(file2), uploadId: null } : null,
      ])
      if (Object.keys(seatFiles).length) {
        setSeatPhotos(Object.fromEntries(Object.entries(seatFiles).map(([id, seatFile]) => [id, { file: seatFile, previewUrl: URL.createObjectURL(seatFile), uploadId: null }])))
      }
      if (nextStyle !== styleId) selectStyle(nextStyle)
      setDurationId(nextDuration)
      setConsent(draft.consent === true)
      rootRef.current?.scrollIntoView({ block: 'start' })
    })
    return () => {
      cancelled = true
    }
    // 只在挂载时恢复一次
  }, [])

  // 有主角照片时，照片、风格、时长、授权勾选的变化都写进草稿（多人风格的可选位置一起存）
  const photoFile = photos[0]?.file
  const photoFile2 = photos[1]?.file ?? null
  const seatFiles = Object.fromEntries(Object.entries(seatPhotos).map(([id, item]) => [id, item.file]))
  useEffect(() => {
    if (!photoFile || draftClearedRef.current === photoFile) return
    const last = draftRef.current
    const seatsSame =
      last && Object.keys(last.seats).length === Object.keys(seatFiles).length && Object.entries(seatFiles).every(([id, f]) => last.seats[id] === f)
    if (last && last.file === photoFile && last.file2 === photoFile2 && seatsSame && last.styleId === styleId && last.durationId === durationId && last.consent === consent) return
    draftRef.current = { file: photoFile, file2: photoFile2, seats: seatFiles, styleId, durationId, consent }
    void saveDraft({
      file: photoFile,
      name: photoFile.name,
      type: photoFile.type,
      ...(photoFile2 ? { file2: photoFile2, name2: photoFile2.name, type2: photoFile2.type } : {}),
      ...(Object.keys(seatFiles).length ? { seats: Object.fromEntries(Object.entries(seatFiles).map(([id, f]) => [id, { file: f, name: f.name, type: f.type }])) } : {}),
      styleId,
      durationId,
      consent,
    })
    // seatFiles 的内容随 seatPhotos 变化，这里只比较引用
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [photoFile, photoFile2, seatPhotos, styleId, durationId, consent])

  // 已登录时，把还没上传的照片传上去：登录前选的、登录弹窗里登录后的、暂存恢复的都走这里
  useEffect(() => {
    if (!user) return
    for (const item of [...photos, ...Object.values(seatPhotos)]) {
      if (item && !item.uploadId) uploadOnce(item.file).catch((err) => setError(errorCode(err)))
    }
    // uploadOnce 内部按文件去重，这里只关心登录状态和照片变化
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user, photos, seatPhotos])

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
    setUploading((n) => n + 1)
    try {
      const form = new FormData()
      form.append('file', file)
      const data = await api<{ upload: { id: string } }>('/api/uploads', { form })
      return data.upload.id
    } finally {
      setUploading((n) => n - 1)
    }
  }

  // 同一个文件只发一次上传请求，并发调用拿到同一个结果
  function uploadOnce(file: File) {
    let pending = inflight.current.get(file)
    if (!pending) {
      pending = upload(file)
        .then((uploadId) => {
          rememberUpload(file, uploadId)
          return uploadId
        })
        .finally(() => inflight.current.delete(file))
      inflight.current.set(file, pending)
    }
    return pending
  }

  // 上传完成后只有照片还是同一个文件时才写回 uploadId（期间可能已经换了照片）
  function rememberUpload(file: File, uploadId: string) {
    setPhotos((current) => {
      const updated: Photos = [current[0], current[1]]
      for (const slot of [0, 1] as const) {
        if (updated[slot]?.file === file) updated[slot] = { ...updated[slot]!, uploadId }
      }
      return updated
    })
    setSeatPhotos((current) => {
      const hit = Object.entries(current).find(([, item]) => item.file === file)
      return hit ? { ...current, [hit[0]]: { ...hit[1], uploadId } } : current
    })
  }

  // 换掉或移除多人风格一个可选位置的照片，同时释放旧的预览图
  function setSeatPhoto(seat: string, next: Photo | null) {
    setSeatPhotos((current) => {
      const old = current[seat]
      if (old && old !== next) URL.revokeObjectURL(old.previewUrl)
      const { [seat]: _, ...rest } = current
      return next ? { ...rest, [seat]: next } : rest
    })
  }

  // 先查尺寸（太小 / 太窄太扁直接让用户换一张），再把大照片缩小（手机原图会让上传接口 CPU 超限），见 lib/prepare-photo.ts。
  // 放在格式检查前面：浏览器能解开的 HEIC 等格式缩完就是 JPEG
  async function prepare(file: File): Promise<Photo | null> {
    const prepared = await preparePhoto(file)
    if (prepared.problem) {
      setError(prepared.problem)
      return null
    }
    const next = prepared.file
    if (!(site.upload.contentTypes as readonly string[]).includes(next.type)) {
      setError('unsupported_file_type')
      return null
    }
    if (next.size > site.upload.maxBytes) {
      setError('file_too_large')
      return null
    }
    setError(null)
    return { file: next, previewUrl: URL.createObjectURL(next), uploadId: null }
  }

  // 没登录时先只在本地预览，登录后由上面的 effect 自动上传
  async function selectFile(file: File | undefined, slot: Slot = 0) {
    if (!file) return
    const next = await prepare(file)
    if (!next) return
    setPhotos((current) => (slot === 0 ? [next, current[1]] : [current[0], next]))
    setGeneration(null)
  }

  async function selectSeatFile(file: File | undefined, seat: string) {
    if (!file) return
    const next = await prepare(file)
    if (!next) return
    setSeatPhoto(seat, next)
    setGeneration(null)
  }

  // 拿到一张照片的 uploadId：还没传完的等它传完
  async function ensureUpload(item: Photo) {
    return item.uploadId ?? (await uploadOnce(item.file))
  }

  // 主按钮前的检查：先要有照片（双人风格两张都要），再要勾选协议；不满足时顶部提示，协议那一行滚到可见并高亮
  function checkReady() {
    if (!photosReady || !photo) {
      toast.warning(g.needPhoto)
      return false
    }
    if (!consent) {
      toast.warning(g.needConsent)
      consentRef.current?.scrollIntoView({ behavior: 'smooth', block: 'center' })
      setConsentFlash(true)
      setTimeout(() => setConsentFlash(false), 1600)
      return false
    }
    return true
  }

  async function generate() {
    const required = photos.slice(0, need)
    if (!photo || required.some((p) => p === null)) return setError('invalid_upload')
    setError(null)
    setSubmitting(true)
    try {
      // 还没上传的槽先传；uploadIds 的顺序 = 左、右
      const uploadIds: string[] = []
      for (const item of required) {
        uploadIds.push(await ensureUpload(item!))
      }
      // 多人风格：只提交当前风格里填了照片的可选位置
      const filled = (seatList ?? []).slice(1).filter((seat) => seatPhotos[seat.id])
      const seatUploads = Object.fromEntries(await Promise.all(filled.map(async (seat) => [seat.id, await ensureUpload(seatPhotos[seat.id]!)] as const)))
      const data = await api<{ generation: Generation }>('/api/generations', {
        json: { uploadIds, seats: seatUploads, durationId: duration.id, styleId, locale, consent },
      })
      track('generate_video', { style_id: styleId, duration_id: duration.id, credits: data.generation.creditsCost, seats: filled.length + 1 })
      draftClearedRef.current = photo.file
      await clearDraft()
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

  const busy = uploading > 0 || submitting || (generation !== null && isActiveGeneration(generation))

  return (
    <section
      ref={rootRef}
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
        {/* 多人风格的共享文件选择框：键盘与读屏从格子按钮进入，隐藏的 input 不占 Tab 位 */}
        {seatList ? (
          <input
            ref={seatInputRef}
            type="file"
            accept={site.upload.contentTypes.join(',')}
            className="sr-only"
            tabIndex={-1}
            aria-label={g.dropTitle}
            data-testid="seat-file-input"
            onChange={(event) => {
              const file = event.target.files?.[0]
              const target = pickTarget.current
              if (target === 'main') void selectFile(file, 0)
              else void selectSeatFile(file, target)
              event.target.value = ''
            }}
          />
        ) : null}
        {seatList ? (
          <SeatGrid
            seats={seatList}
            mainPhoto={photo}
            seatPhotos={seatPhotos}
            copy={c.styles[currentStyle.id as keyof typeof c.styles]}
            busy={busy}
            onPick={(target) => {
              pickTarget.current = target
              seatInputRef.current?.click()
            }}
            onDrop={(target, file) => {
              if (target === 'main') void selectFile(file, 0)
              else void selectSeatFile(file, target)
            }}
            onRemove={(seat) => setSeatPhoto(seat, null)}
          />
        ) : need === 2 ? (
          <div className="grid grid-cols-2 gap-3">
            <PhotoDrop photo={photos[0]} uploading={uploading > 0 && photos[0]?.uploadId === null} busy={busy} testId="photo-input" label={g.photoLeft} onFile={(file) => void selectFile(file, 0)} />
            <PhotoDrop photo={photos[1]} uploading={uploading > 0 && photos[1]?.uploadId === null} busy={busy} testId="photo-input-2" label={g.photoRight} onFile={(file) => void selectFile(file, 1)} />
          </div>
        ) : (
          <PhotoDrop photo={photo} uploading={uploading > 0} busy={busy} testId="photo-input" onFile={(file) => void selectFile(file, 0)} />
        )}
        <p className="text-xs leading-5 text-muted">{!seatList && need === 2 ? g.duoGuidance : g.guidance}</p>
        {/* 桌面访客的照片多半在手机上：扫码传到这里；手机本身不需要 */}
        {phoneOpen ? (
          <PhoneUploadPanel
            onPhoto={(file) => void selectFile(file, need === 2 && photos[0] && !photos[1] ? 1 : 0)}
            onClose={() => setPhoneOpen(false)}
          />
        ) : (
          <button
            type="button"
            disabled={busy}
            onClick={() => setPhoneOpen(true)}
            className="btn-ghost hidden px-3 py-1.5 text-xs md:inline-flex"
            data-testid="phone-upload-open"
          >
            <Smartphone className="size-4" /> <span>{g.phoneOpen}</span>
          </button>
        )}
      </section>

      {/* 2. 风格：只有一种风格时不显示 */}
      {STYLES.length > 1 ? (
        <section className="space-y-3">
          <StepTitle n={2}>{g.stepStyle}</StepTitle>
          <div className="grid gap-2 sm:grid-cols-2" role="radiogroup" aria-label={g.stepStyle}>
            {DISPLAY_STYLES.map((style) => {
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
        <div
          className={`grid gap-1 rounded-xl bg-bg-soft p-1 ${styleDurationList.length === 1 ? 'grid-cols-1' : styleDurationList.length === 2 ? 'grid-cols-2' : 'grid-cols-3'}`}
          role="radiogroup"
          aria-label={g.stepLength}
        >
          {styleDurationList.map((d) => {
            const active = d.id === duration.id
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
                  {`${g.seconds(d.seconds)}${'isFull' in d && d.isFull ? ` · ${g.full}` : ''}`}
                </span>
                <span className="block text-xs text-muted">{g.creditsLabel(d.credits)}</span>
              </button>
            )
          })}
        </div>
      </section>

      <label
        ref={consentRef}
        className={`flex items-start gap-3 rounded-lg text-xs leading-5 text-muted transition ${consentFlash ? 'bg-amber-50 ring-2 ring-amber-400 dark:bg-amber-950' : ''}`}
      >
        <input
          type="checkbox"
          checked={consent}
          onChange={(event) => setConsent(event.target.checked)}
          className="mt-0.5 size-4 shrink-0 accent-[var(--ink)]"
          data-testid="consent"
        />
        <span>{seatList ? g.consentSeats : g.consent}</span>
      </label>

      {/* CTA */}
      <div className="space-y-2">
        {loading ? (
          <div className="btn-primary w-full py-3.5 opacity-60">
            <Spinner />
          </div>
        ) : !user ? (
          <button
            type="button"
            className="btn-primary w-full py-3.5"
            onClick={() => {
              if (checkReady()) setSignInOpen(true)
            }}
            data-testid="generator-sign-up"
          >
            {g.ctaSignUp}
          </button>
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
                <span>{c.pricing.paused}</span>
              ) : checkout.pending === coverPack.id ? (
                <>
                  <Spinner /> <span>{c.pricing.buying}</span>
                </>
              ) : (
                <span>{g.ctaBuyPack(coverPack.credits, formatPrice(coverPack.priceCents, coverPack.currency))}</span>
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
            disabled={busy}
            onClick={() => {
              if (checkReady()) void generate()
            }}
            data-testid="generate"
          >
            {submitting ? <Spinner /> : null}
            <span>{g.ctaGenerate(duration.credits)}</span>
          </button>
        )}
        {!loading && !user && photo ? (
          <p className="text-center text-xs text-muted" data-testid="generator-draft-kept">
            {g.draftKept}
          </p>
        ) : null}
        {guestPack && !loading ? (
          <p className="text-center text-xs text-muted" data-testid="generator-guest-price">
            {g.guestPrice(duration.credits, formatPrice(guestPack.priceCents, guestPack.currency))}
          </p>
        ) : null}
        {user ? (
          <p className="text-center text-xs text-muted" data-testid="generator-balance">
            {`${g.balance(user.credits)}${shortfall > 0 ? ` · ${g.needMore(shortfall)}` : ''}`}
          </p>
        ) : null}
        <ErrorText code={error} />
      </div>

      {generation ? <GenerationResult generation={generation} onReset={reset} /> : null}
      {signInOpen && !user ? <SignInModal redirect={pathname} onClose={closeSignIn} /> : null}
    </section>
  )
}

// 多人风格的照片格子：第一个是必填的主角（大格），其余可选；填了的可选格可以移除
function SeatGrid({
  seats,
  mainPhoto,
  seatPhotos,
  copy,
  busy,
  onPick,
  onDrop,
  onRemove,
}: {
  seats: readonly StyleSeat[]
  mainPhoto: Photo | null
  seatPhotos: Record<string, Photo>
  copy: { seats?: Record<string, { name: string; hint: string }>; seatsNote?: string }
  busy: boolean
  onPick: (target: 'main' | string) => void
  onDrop: (target: 'main' | string, file: File | undefined) => void
  onRemove: (seat: string) => void
}) {
  const g = useContent().generator
  return (
    <div className="space-y-2">
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-3" data-testid="seat-grid">
        {seats.map((seat, index) => {
          const target = index === 0 ? ('main' as const) : seat.id
          const item = index === 0 ? mainPhoto : seatPhotos[seat.id]
          const label = copy.seats?.[seat.id]
          return (
            <div key={seat.id} className={`relative ${index === 0 ? 'col-span-2 row-span-2 sm:col-span-1' : ''}`}>
              <button
                type="button"
                disabled={busy}
                onClick={() => onPick(target)}
                onDragOver={(event) => event.preventDefault()}
                onDrop={(event) => {
                  event.preventDefault()
                  onDrop(target, event.dataTransfer.files?.[0])
                }}
                data-testid={`seat-${seat.id}`}
                className={`relative flex h-full min-h-32 w-full flex-col gap-1.5 overflow-hidden rounded-xl border-2 p-2.5 pt-9 text-left transition ${
                  index === 0 ? 'border-solid border-ink/60' : 'border-dashed border-line hover:border-fg/40'
                }`}
              >
                {item ? <img src={item.previewUrl} alt="" className="absolute inset-0 size-full rounded-[10px] object-cover" /> : null}
                {/* 空格子：和单张上传框同样的上传图标，占据文字上方的剩余空间；有照片时只留占位 */}
                <span className="grid flex-1 place-items-center">
                  {item ? null : (
                    <span className={`grid place-items-center rounded-full bg-ink text-ink-fg ${index === 0 ? 'size-11' : 'size-8'}`}>
                      <Upload className={index === 0 ? 'size-5' : 'size-4'} />
                    </span>
                  )}
                </span>
                {/* 左上角序号：主角是 1，可选位置按顺序往后排。用标题字体、强调色，不加底色；有照片时垫一层浅底保证看得清 */}
                <span
                  className={`absolute top-1.5 left-2.5 font-display font-semibold leading-none text-accent-text ${index === 0 ? 'text-3xl' : 'text-xl'} ${item ? 'rounded-md bg-bg/85 px-1.5 py-1' : ''}`}
                >
                  {index + 1}
                </span>
                <span className={`relative rounded-md px-1.5 py-0.5 ${item ? 'bg-bg/85' : ''}`}>
                  <span className="block text-sm font-semibold">{label?.name ?? seat.id}</span>
                  <span className="block text-xs text-muted">{item ? g.change : index === 0 ? (label?.hint ?? g.addPhoto) : `${g.optional} · ${label?.hint ?? g.addPhoto}`}</span>
                </span>
              </button>
              {item && index > 0 ? (
                <button
                  type="button"
                  disabled={busy}
                  onClick={() => onRemove(seat.id)}
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

// 一个照片槽：隐藏的 input + 拖放/点击区。单人风格用完整版；双人风格并排两个，带左右标签（compact）
function PhotoDrop({
  photo,
  uploading,
  busy,
  testId,
  label,
  onFile,
}: {
  photo: Photo | null
  uploading: boolean
  busy: boolean
  testId: string
  label?: string
  onFile: (file: File | undefined) => void
}) {
  const g = useContent().generator
  const inputRef = useRef<HTMLInputElement>(null)
  const [dragging, setDragging] = useState(false)
  const compact = label !== undefined
  return (
    <div className={compact ? 'space-y-1.5' : undefined}>
      {label ? <p className="text-xs font-semibold">{label}</p> : null}
      {/* 键盘与读屏从下面的按钮进入，隐藏的 input 不占 Tab 位 */}
      <input
        ref={inputRef}
        type="file"
        accept={site.upload.contentTypes.join(',')}
        className="sr-only"
        tabIndex={-1}
        aria-label={label ?? g.dropTitle}
        data-testid={testId}
        onChange={(event) => {
          onFile(event.target.files?.[0])
          event.target.value = ''
        }}
      />
      <button
        type="button"
        disabled={busy}
        onClick={() => inputRef.current?.click()}
        onDragOver={(event) => {
          event.preventDefault()
          setDragging(true)
        }}
        onDragLeave={() => setDragging(false)}
        onDrop={(event) => {
          event.preventDefault()
          setDragging(false)
          onFile(event.dataTransfer.files?.[0])
        }}
        className={`flex w-full items-center justify-center rounded-xl border-2 border-dashed text-center transition ${compact ? 'px-2 py-4' : 'px-4 py-6'} ${
          dragging ? 'border-accent bg-accent/5' : 'border-line hover:border-fg/40'
        }`}
      >
        {photo ? (
          <span className={`flex items-center gap-4 text-left ${compact ? 'flex-col gap-2 text-center' : ''}`}>
            <img src={photo.previewUrl} alt="" className={`rounded-lg object-cover ${compact ? 'size-16' : 'size-20'}`} />
            <span className="space-y-1">
              <span className="flex items-center gap-1.5 text-sm font-semibold">
                {uploading ? <Spinner /> : <CircleCheck className="size-4 text-emerald-600" />}
                <span>{uploading ? g.uploading : g.uploaded}</span>
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
            {compact ? null : <span className="text-xs text-muted">{g.dropHint}</span>}
          </span>
        )}
      </button>
    </div>
  )
}

function StepTitle({ n, children }: { n: number; children: string }) {
  return (
    <h3 className="flex items-center gap-2 text-sm font-semibold">
      <span className="grid size-5 place-items-center rounded-full bg-ink text-[11px] text-ink-fg">{n}</span>
      <span>{children}</span>
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
          <span>{generation.status === 'queued' ? g.queued : g.processing}</span>
        </p>
      ) : generation.status === 'succeeded' && generation.videoUrl ? (
        <>
          <p className="flex items-center gap-2 text-sm font-semibold">
            <CircleCheck className="size-4 text-emerald-600" /> <span>{g.succeeded}</span>
          </p>
          <div className="relative mx-auto w-fit">
            <AiBadge />
            <video src={generation.videoUrl} controls playsInline className="max-h-[420px] rounded-lg bg-black" data-testid="generation-video" />
          </div>
          <p className="text-xs text-muted" data-testid="ai-notice">
            {`${g.aiNotice}${generation.expiresAt ? ` ${g.expiresOn(formatDate(generation.expiresAt, locale))}` : ''}`}
          </p>
          <div className="flex flex-wrap gap-2">
            <a href={`${generation.videoUrl}?download=1`} className="btn-primary px-4 py-2" download>
              <Download className="size-4" /> <span>{g.download}</span>
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
            <CircleAlert className="size-4" /> <span>{g.failed}</span>
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

import { useHydrated, useRouterState } from '@tanstack/react-router'
import { CircleCheck, MessageCircle, X } from 'lucide-react'
import { useEffect, useRef, useState, type FormEvent } from 'react'
import { createPortal } from 'react-dom'
import { api, errorCode } from '#/lib/api'
import { useContent } from '#/lib/i18n'
import { useSession } from '#/lib/session'
import { Turnstile } from './Turnstile'
import { ErrorText, LocalLink, Spinner } from './ui'

const TYPES = ['idea', 'bug', 'praise', 'other'] as const
const MAX_MESSAGE = 2000

// 右下角“反馈”浮窗，挂在语言布局里，每个公开页面都有；提交到 POST /api/feedback（服务端和联系表单共用 contact_messages）。
// 不记住上一次的内容：每次打开都是空表单。配了 Turnstile 时和联系表单一样要过人机校验。
// 只在水合后渲染，避免点了没反应的按钮
export function FeedbackWidget() {
  const t = useContent().feedback
  const hydrated = useHydrated()
  const [open, setOpen] = useState(false)
  if (!hydrated) return null
  return (
    <>
      <button
        type="button"
        data-testid="feedback-button"
        onClick={() => setOpen(true)}
        className="fixed right-5 bottom-5 z-30 inline-flex items-center gap-2 rounded-full bg-ink px-5 py-3 text-sm font-semibold text-ink-fg shadow-lg transition hover:scale-105 max-sm:right-4 max-sm:bottom-4 max-sm:px-4 max-sm:py-2.5"
      >
        <MessageCircle className="size-5" aria-hidden />
        {t.button}
      </button>
      {open ? <FeedbackDialog onClose={() => setOpen(false)} /> : null}
    </>
  )
}

function FeedbackDialog({ onClose }: { onClose: () => void }) {
  const t = useContent().feedback
  const { user, config } = useSession()
  const pathname = useRouterState({ select: (s) => s.location.pathname })
  const search = useRouterState({ select: (s) => s.location.searchStr })
  const [type, setType] = useState<(typeof TYPES)[number]>('idea')
  const [message, setMessage] = useState('')
  const [email, setEmail] = useState(user?.email ?? '')
  const [state, setState] = useState<'idle' | 'sending' | 'sent'>('idle')
  const [error, setError] = useState<string | null>(null)
  const [token, setToken] = useState<string | null>(null)
  const [resetKey, setResetKey] = useState(0)
  const siteKey = config?.turnstileSiteKey ?? null
  const dialogRef = useRef<HTMLDivElement>(null)

  // Esc 关闭、打开期间禁止背景滚动，关闭时恢复
  useEffect(() => {
    const overflow = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', onKey)
    dialogRef.current?.focus()
    return () => {
      document.body.style.overflow = overflow
      window.removeEventListener('keydown', onKey)
    }
  }, [onClose])

  async function submit(event: FormEvent) {
    event.preventDefault()
    if (state === 'sending') return
    setError(null)
    setState('sending')
    try {
      await api('/api/feedback', { json: { type, message, email, page: `${pathname}${search}`, turnstileToken: token } })
      setState('sent')
    } catch (err) {
      setError(errorCode(err))
      setState('idle')
      setResetKey((n) => n + 1)
    }
  }

  return createPortal(
    <div className="fixed inset-0 z-50 grid place-items-end overflow-y-auto bg-black/60 p-4 sm:place-items-center" onClick={onClose} data-testid="feedback-dialog">
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby="feedback-title"
        tabIndex={-1}
        className="card relative w-full max-w-xl p-6 outline-none max-sm:p-5"
        onClick={(event) => event.stopPropagation()}
      >
        <button type="button" onClick={onClose} aria-label={t.close} className="absolute top-3 right-3 grid size-8 place-items-center rounded-full text-muted hover:bg-bg-soft hover:text-fg">
          <X className="size-4" />
        </button>
        {state === 'sent' ? (
          <div className="py-6 text-center" data-testid="feedback-sent">
            <CircleCheck className="mx-auto size-10 text-emerald-600" />
            <h2 id="feedback-title" className="mt-4 font-display text-2xl">
              {t.sentTitle}
            </h2>
            <p className="mt-2 text-sm text-muted">{t.sentBody}</p>
            <button type="button" className="btn-primary mt-6 w-full" onClick={onClose}>
              {t.done}
            </button>
          </div>
        ) : (
          <form onSubmit={submit} className="space-y-5">
            <div className="pr-8">
              <p className="eyebrow text-muted">{t.eyebrow}</p>
              <h2 id="feedback-title" className="mt-1 font-display text-2xl">
                {t.title}
              </h2>
              <p className="mt-2 text-sm text-muted">{t.body}</p>
            </div>
            <fieldset>
              <legend className="sr-only">{t.typeLegend}</legend>
              <div className="grid grid-cols-4 gap-2 max-sm:grid-cols-2">
                {TYPES.map((value) => (
                  <button
                    key={value}
                    type="button"
                    aria-pressed={type === value}
                    data-testid={`feedback-type-${value}`}
                    onClick={() => setType(value)}
                    className={`rounded-(--field-radius) border px-2 py-3 text-sm font-semibold transition ${type === value ? 'border-fg bg-bg-soft text-fg' : 'border-line bg-card text-muted hover:border-fg'}`}
                  >
                    {t.types[value]}
                  </button>
                ))}
              </div>
            </fieldset>
            <label className="block space-y-1.5 text-sm font-medium">
              <span>{t.message}</span>
              <textarea
                className="input min-h-32"
                data-testid="feedback-message"
                required
                minLength={3}
                maxLength={MAX_MESSAGE}
                value={message}
                placeholder={t.placeholder}
                onChange={(e) => setMessage(e.target.value)}
              />
              <span className="block text-right text-xs font-normal text-muted tabular-nums">
                {message.length}/{MAX_MESSAGE}
              </span>
            </label>
            <label className="block space-y-1.5 text-sm font-medium">
              <span>
                {t.email} <span className="font-normal text-muted">{t.optional}</span>
              </span>
              <input className="input" type="text" maxLength={200} autoComplete="email" value={email} placeholder={t.emailPlaceholder} onChange={(e) => setEmail(e.target.value)} />
            </label>
            {siteKey ? <Turnstile siteKey={siteKey} onToken={setToken} resetKey={resetKey} /> : null}
            <ErrorText code={error} />
            <button type="submit" className="btn-primary w-full" data-testid="feedback-send" disabled={state === 'sending' || message.trim().length < 3 || Boolean(siteKey && !token)}>
              {state === 'sending' ? <Spinner /> : null} {t.send}
            </button>
            <p className="text-center text-xs text-muted">
              {t.needReply}{' '}
              <LocalLink to="/contact" className="underline hover:text-fg" onClick={onClose}>
                {t.contactLink}
              </LocalLink>
            </p>
          </form>
        )}
      </div>
    </div>,
    document.body,
  )
}

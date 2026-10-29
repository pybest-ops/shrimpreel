import { useState, type FormEvent } from 'react'
import { api, errorCode } from '#/lib/api'
import { useContent } from '#/lib/i18n'
import { useSession } from '#/lib/session'
import { EmailSignIn } from './EmailSignIn'
import { ErrorText, GoogleIcon, LocalLink, Spinner } from './ui'

// 登录方式的通用面板：登录页和生成器的登录弹窗共用，改一处两边都生效。
// Google 登录整页跳转，跳之前先调 onBeforeGoogle（生成器用它把已选照片暂存到本地）；
// 邮箱验证码和本地开发登录不离开页面，登录成功后会话里出现用户，外层据此跳转或关闭弹窗
export function SignInPanel({
  redirect,
  initialError = null,
  onBeforeGoogle,
}: {
  redirect: string
  initialError?: string | null
  onBeforeGoogle?: () => Promise<void> | void
}) {
  const t = useContent().signIn
  const { config, loading, refresh } = useSession()
  const [devEmail, setDevEmail] = useState('demo@example.com')
  const [pending, setPending] = useState(false)
  const [leaving, setLeaving] = useState(false)
  const [error, setError] = useState<string | null>(initialError)
  const googleHref = `/api/auth/google/start?redirect=${encodeURIComponent(redirect)}`

  async function continueWithGoogle() {
    setLeaving(true)
    try {
      await onBeforeGoogle?.()
    } finally {
      location.href = googleHref
    }
  }

  async function devLogin(event: FormEvent) {
    event.preventDefault()
    setPending(true)
    setError(null)
    try {
      await api('/api/auth/dev-login', { json: { email: devEmail } })
      await refresh()
    } catch (err) {
      setError(errorCode(err))
    } finally {
      setPending(false)
    }
  }

  if (loading) return <Spinner className="mx-auto size-5" />
  return (
    <div className="space-y-6">
      {config?.googleClientId ? (
        <button type="button" className="btn-primary w-full py-3.5" disabled={leaving} onClick={() => void continueWithGoogle()} data-testid="google-sign-in">
          {leaving ? <Spinner /> : <GoogleIcon />} {t.google}
        </button>
      ) : config?.emailSignIn ? null : (
        <p className="text-sm text-muted">{t.notConfigured}</p>
      )}
      {/* 邮箱验证码登录：在 Google 按钮下面，用“或”分隔；没配 Google 时单独出现 */}
      {config?.emailSignIn ? (
        <>
          {config.googleClientId ? (
            <div className="flex items-center gap-3 text-xs text-muted">
              <span className="h-px flex-1 bg-line" />
              {t.or}
              <span className="h-px flex-1 bg-line" />
            </div>
          ) : null}
          <EmailSignIn />
        </>
      ) : null}
      {config?.devLogin ? (
        <form onSubmit={devLogin} className="space-y-3 border-t border-line pt-6 text-left">
          <p className="text-xs font-semibold tracking-wide text-muted uppercase">{t.devTitle}</p>
          <label className="block space-y-1.5 text-sm">
            <span>{t.devEmail}</span>
            <input className="input" type="email" required value={devEmail} onChange={(e) => setDevEmail(e.target.value)} data-testid="dev-email" />
          </label>
          <button type="submit" className="btn-ghost w-full" disabled={pending} data-testid="dev-login">
            {pending ? <Spinner /> : null} {t.devSubmit}
          </button>
        </form>
      ) : null}
      <ErrorText code={error} />
      <p className="text-center text-xs text-muted">
        <LocalLink to="/terms-of-service" className="underline">
          {t.legal}
        </LocalLink>
      </p>
    </div>
  )
}

import { useEffect, useState, type FormEvent } from 'react'
import { api, errorCode } from '#/lib/api'
import { useContent, useLocale } from '#/lib/i18n'
import { useSession } from '#/lib/session'
import { Turnstile } from './Turnstile'
import { ErrorText, Spinner } from './ui'

// 登录页的邮箱验证码登录，两步：填邮箱发码 → 输入 6 位验证码登录。
// 登录成功后刷新会话，登录页会按 redirect 跳走；sign_up 统计按 sessionStorage 里记下的方式上报
export function EmailSignIn() {
  const t = useContent().signIn
  const locale = useLocale()
  const { config, refresh } = useSession()
  const [step, setStep] = useState<'email' | 'code'>('email')
  const [email, setEmail] = useState('')
  const [code, setCode] = useState('')
  const [pending, setPending] = useState(false)
  const [error, setError] = useState<string | null>(null)
  // 重发倒计时（秒），发码成功后从冷却时间开始倒数
  const [cooldown, setCooldown] = useState(0)
  // 配了 Turnstile 时发码要带人机校验 token；每次发码后重置组件
  const [token, setToken] = useState<string | null>(null)
  const [resetKey, setResetKey] = useState(0)
  const siteKey = config?.turnstileSiteKey ?? null

  useEffect(() => {
    if (cooldown <= 0) return
    const timer = setTimeout(() => setCooldown((s) => s - 1), 1000)
    return () => clearTimeout(timer)
  }, [cooldown])

  async function sendCode(event?: FormEvent) {
    event?.preventDefault()
    setPending(true)
    setError(null)
    try {
      const data = await api<{ cooldownSeconds: number; devCode?: string }>('/api/auth/email/start', {
        json: { email, locale, turnstileToken: token },
      })
      setStep('code')
      setCooldown(data.cooldownSeconds)
      // 本地开发和 e2e：接口直接返回验证码，自动填上
      setCode(data.devCode ?? '')
    } catch (err) {
      setError(errorCode(err))
    } finally {
      setPending(false)
      if (siteKey) {
        setToken(null)
        setResetKey((k) => k + 1)
      }
    }
  }

  async function verify(event: FormEvent) {
    event.preventDefault()
    if (code.length !== 6) return
    setPending(true)
    setError(null)
    try {
      await api('/api/auth/email/verify', { json: { email, code, locale } })
      try {
        sessionStorage.setItem('sign_in_method', 'email')
      } catch {
        // 隐私模式下拿不到存储，统计退回默认方式
      }
      await refresh()
    } catch (err) {
      setError(errorCode(err))
    } finally {
      setPending(false)
    }
  }

  return (
    <div className="space-y-3 text-left" data-testid="email-sign-in">
      {step === 'email' ? (
        <form onSubmit={sendCode} className="space-y-3">
          <label className="block space-y-1.5 text-sm">
            <span>{t.emailLabel}</span>
            <input
              className="input"
              type="email"
              required
              autoComplete="email"
              placeholder="you@example.com"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              data-testid="email-input"
            />
          </label>
          {siteKey ? <Turnstile siteKey={siteKey} onToken={setToken} resetKey={resetKey} /> : null}
          <button type="submit" className="btn-ghost w-full py-3" disabled={pending || !email || Boolean(siteKey && !token)} data-testid="email-send-code">
            {pending ? <Spinner /> : null} {t.sendCode}
          </button>
        </form>
      ) : (
        <form onSubmit={verify} className="space-y-3">
          <p className="text-sm leading-6 text-muted">{t.codeSent(email)}</p>
          <label className="block space-y-1.5 text-sm">
            <span>{t.codeLabel}</span>
            <input
              className="input font-mono text-lg tracking-[0.4em]"
              type="text"
              inputMode="numeric"
              autoComplete="one-time-code"
              maxLength={6}
              autoFocus
              placeholder="123456"
              value={code}
              onChange={(e) => setCode(e.target.value.replace(/\D/g, '').slice(0, 6))}
              data-testid="email-code"
            />
          </label>
          <button type="submit" className="btn-primary w-full py-3" disabled={pending || code.length !== 6} data-testid="email-verify">
            {pending ? <Spinner /> : null} {t.verify}
          </button>
          <div className="flex items-center justify-between text-xs">
            <button
              type="button"
              className="text-muted underline underline-offset-4 hover:text-fg"
              onClick={() => {
                setStep('email')
                setCode('')
                setError(null)
              }}
            >
              {t.useOther}
            </button>
            <button
              type="button"
              className="text-muted underline underline-offset-4 hover:text-fg disabled:no-underline disabled:opacity-60"
              disabled={pending || cooldown > 0 || Boolean(siteKey && !token)}
              onClick={() => void sendCode()}
              data-testid="email-resend"
            >
              {cooldown > 0 ? t.resendIn(cooldown) : t.resend}
            </button>
          </div>
          {siteKey ? <Turnstile siteKey={siteKey} onToken={setToken} resetKey={resetKey} /> : null}
        </form>
      )}
      <ErrorText code={error} />
    </div>
  )
}

import { createFileRoute, useNavigate } from '@tanstack/react-router'
import { useEffect } from 'react'
import { SignInPanel } from '#/components/SignInPanel'
import { LogoMark } from '#/components/ui'
import { getContent, localeFromParam, pageHead, useContent, useLocalePath } from '#/lib/i18n'
import { safeRedirectPath } from '#/lib/redirect'
import { useSession } from '#/lib/session'

type Search = { redirect?: string; error?: string }

export const Route = createFileRoute('/{-$locale}/sign-in')({
  validateSearch: (search: Record<string, unknown>): Search => ({
    redirect: typeof search.redirect === 'string' ? search.redirect : undefined,
    error: typeof search.error === 'string' ? search.error : undefined,
  }),
  head: ({ params }) => {
    const locale = localeFromParam(params.locale)
    const c = getContent(locale)
    const head = pageHead(locale, '/sign-in', c.meta.signInTitle, c.signIn.body)
    return { ...head, meta: [...head.meta, { name: 'robots', content: 'noindex' }] }
  },
  component: SignInPage,
})

function SignInPage() {
  const c = useContent()
  const t = c.signIn
  const lp = useLocalePath()
  const search = Route.useSearch()
  const navigate = useNavigate()
  const { user } = useSession()
  const redirect = safeRedirectPath(search.redirect, lp('/dashboard'))

  useEffect(() => {
    if (user) void navigate({ href: redirect })
  }, [user, redirect, navigate])

  // 登录方式在 SignInPanel 里，和生成器的登录弹窗共用
  return (
    <div className="container-page grid max-w-md place-items-center py-20">
      <div className="card w-full space-y-6 p-8 text-center">
        <LogoMark className="mx-auto size-12 text-base" />
        <div className="space-y-2">
          <h1 className="font-display text-3xl">{t.title}</h1>
          <p className="text-sm text-muted">{t.body}</p>
        </div>
        <SignInPanel redirect={redirect} initialError={search.error ?? null} />
      </div>
    </div>
  )
}

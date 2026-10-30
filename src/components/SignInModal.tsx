import { X } from 'lucide-react'
import { useEffect, useRef } from 'react'
import { createPortal } from 'react-dom'
import { useContent } from '#/lib/i18n'
import { useSession } from '#/lib/session'
import { SignInPanel } from './SignInPanel'
import { LogoMark } from './ui'

// 生成器的登录弹窗：不离开页面，已选的照片留在内存里。登录方式和登录页共用 SignInPanel；
// 登录成功（会话里出现用户）后自动关闭。Esc、点遮罩或右上角关闭；打开期间禁止背景滚动
// title、body：弹窗标题和说明，不传用生成器的文案（导航栏登录传登录页的文案）
export function SignInModal({
  redirect,
  onClose,
  onBeforeGoogle,
  title,
  body,
}: {
  redirect: string
  onClose: () => void
  onBeforeGoogle?: () => Promise<void> | void
  title?: string
  body?: string
}) {
  const g = useContent().generator
  const { user } = useSession()
  const dialogRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (user) onClose()
  }, [user, onClose])

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose()
    }
    const overflow = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    window.addEventListener('keydown', onKey)
    dialogRef.current?.focus()
    return () => {
      document.body.style.overflow = overflow
      window.removeEventListener('keydown', onKey)
    }
  }, [onClose])

  return createPortal(
    <div className="fixed inset-0 z-50 grid place-items-center overflow-y-auto bg-black/60 p-4" onClick={onClose} data-testid="sign-in-modal">
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby="sign-in-modal-title"
        tabIndex={-1}
        className="card relative w-full max-w-md space-y-6 p-8 text-center outline-none"
        onClick={(event) => event.stopPropagation()}
      >
        <button type="button" onClick={onClose} aria-label={g.close} className="absolute top-3 right-3 grid size-8 place-items-center rounded-full text-muted hover:bg-bg-soft hover:text-fg">
          <X className="size-4" />
        </button>
        <LogoMark className="mx-auto size-12 text-base" />
        <div className="space-y-2">
          <h2 id="sign-in-modal-title" className="font-display text-2xl">
            {title ?? g.signInTitle}
          </h2>
          <p className="text-sm text-muted">{body ?? g.signInBody}</p>
        </div>
        <SignInPanel redirect={redirect} onBeforeGoogle={onBeforeGoogle} />
      </div>
    </div>,
    document.body,
  )
}

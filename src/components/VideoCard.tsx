import { Volume2, VolumeX } from 'lucide-react'
import { useEffect, useId, useRef, useState, type ReactNode } from 'react'
import { useContent } from '#/lib/i18n'

// 页面上同一时间只有一个示例视频出声：打开声音时广播自己的 id，其它卡片收到后静音
const SOUND_EVENT = 'video-card-sound'

// 竖屏示例视频：进入视口自动静音播放，离开暂停；尊重“减少动态效果”设置。
// 右上角的喇叭按钮打开或关闭这个视频的声音（打开时若没在播放就开始播放）
export function VideoCard({
  video,
  poster,
  label,
  credit,
  className = '',
}: {
  video: string
  poster: string
  label?: ReactNode
  credit?: string
  className?: string
}) {
  const common = useContent().common
  const ref = useRef<HTMLVideoElement>(null)
  const id = useId()
  const [muted, setMuted] = useState(true)

  useEffect(() => {
    const element = ref.current
    if (!element || matchMedia('(prefers-reduced-motion: reduce)').matches) return
    const observer = new IntersectionObserver(
      ([entry]) => {
        if (entry?.isIntersecting) element.play().catch(() => {})
        else element.pause()
      },
      { threshold: 0.35 },
    )
    observer.observe(element)
    return () => observer.disconnect()
  }, [])

  // 别的卡片打开了声音：这里静音
  useEffect(() => {
    const onSound = (event: Event) => {
      if ((event as CustomEvent<string>).detail === id) return
      if (ref.current) ref.current.muted = true
      setMuted(true)
    }
    window.addEventListener(SOUND_EVENT, onSound)
    return () => window.removeEventListener(SOUND_EVENT, onSound)
  }, [id])

  function toggleSound() {
    const element = ref.current
    if (!element) return
    const next = !muted
    element.muted = next
    setMuted(next)
    if (!next) {
      window.dispatchEvent(new CustomEvent(SOUND_EVENT, { detail: id }))
      if (element.paused) element.play().catch(() => {})
    }
  }

  return (
    <figure className={className}>
      <div className="relative aspect-[9/16] overflow-hidden rounded-2xl bg-bg-soft shadow-sm ring-1 ring-line">
        <video
          ref={ref}
          src={video}
          poster={poster}
          muted
          loop
          playsInline
          preload="metadata"
          className="size-full object-cover"
        />
        {label ? (
          <span className="absolute top-2.5 left-2.5 inline-flex items-center gap-1 rounded-full bg-black/70 px-2.5 py-1 text-xs font-semibold text-white backdrop-blur">
            {label}
          </span>
        ) : null}
        <button
          type="button"
          onClick={toggleSound}
          aria-label={muted ? common.unmute : common.mute}
          aria-pressed={!muted}
          data-testid="video-sound"
          className="absolute top-2.5 right-2.5 grid size-8 place-items-center rounded-full bg-black/70 text-white backdrop-blur transition hover:bg-black/85"
        >
          {muted ? <VolumeX className="size-4" /> : <Volume2 className="size-4" />}
        </button>
      </div>
      {credit ? <figcaption className="mt-2 truncate text-xs text-muted">{credit}</figcaption> : null}
    </figure>
  )
}

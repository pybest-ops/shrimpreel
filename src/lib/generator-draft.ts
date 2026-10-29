// 生成器的照片暂存：没登录时点 Google 登录会整页跳走，跳之前把已选照片存进 localStorage，
// 回来后恢复到原来的位置。只存 1 小时；恢复后立即删除，退出登录时也删除。
// localStorage 一般只有约 5MB 且只能存字符串，所以先把照片等比缩到最长边 1280px、JPEG 0.85 再转 base64
// （每张约 150–300KB，5 张不到 2MB），恢复后上传的就是这张缩小图。写不进去（容量不够、无痕模式）就放弃暂存

const KEY = 'generator-draft'
const TTL_MS = 60 * 60 * 1000
const MAX_SIDE = 1280
const QUALITY = 0.85

// 暂存内容：各位置（主角是 main）的照片和当时选的风格
export interface GeneratorDraft {
  savedAt: number
  styleId: string
  photos: Record<string, { name: string; dataUrl: string }>
}

// 把照片缩小成 JPEG data URL；解码失败时返回 null（这张不暂存）
async function shrink(file: File) {
  try {
    const bitmap = await createImageBitmap(file)
    const scale = Math.min(1, MAX_SIDE / Math.max(bitmap.width, bitmap.height))
    const canvas = document.createElement('canvas')
    canvas.width = Math.round(bitmap.width * scale)
    canvas.height = Math.round(bitmap.height * scale)
    canvas.getContext('2d')!.drawImage(bitmap, 0, 0, canvas.width, canvas.height)
    bitmap.close()
    return canvas.toDataURL('image/jpeg', QUALITY)
  } catch {
    return null
  }
}

// 写入暂存；返回是否成功（失败不影响登录，只是回来后要重新选照片）
export async function saveDraft(styleId: string, files: Record<string, File>, now = Date.now()) {
  const photos: GeneratorDraft['photos'] = {}
  for (const [seat, file] of Object.entries(files)) {
    const dataUrl = await shrink(file)
    if (dataUrl) photos[seat] = { name: file.name.replace(/\.[^.]+$/, '') + '.jpg', dataUrl }
  }
  if (!Object.keys(photos).length) return false
  try {
    localStorage.setItem(KEY, JSON.stringify({ savedAt: now, styleId, photos } satisfies GeneratorDraft))
    return true
  } catch {
    clearDraft()
    return false
  }
}

// 读出暂存并还原成 File；没有、格式不对或超过 1 小时都返回 null（过期的顺手删掉）
export function loadDraft(now = Date.now()): { styleId: string; files: Record<string, File> } | null {
  let draft: GeneratorDraft | null = null
  try {
    const raw = localStorage.getItem(KEY)
    draft = raw ? (JSON.parse(raw) as GeneratorDraft) : null
  } catch {
    draft = null
  }
  if (!draft || typeof draft.savedAt !== 'number' || now - draft.savedAt > TTL_MS || !draft.photos) {
    if (draft) clearDraft()
    return null
  }
  const files: Record<string, File> = {}
  for (const [seat, photo] of Object.entries(draft.photos)) {
    const file = dataUrlToFile(photo.dataUrl, photo.name)
    if (file) files[seat] = file
  }
  return Object.keys(files).length ? { styleId: draft.styleId, files } : null
}

export function clearDraft() {
  try {
    localStorage.removeItem(KEY)
  } catch {
    // 拿不到存储时本来也没有暂存
  }
}

function dataUrlToFile(dataUrl: string, name: string) {
  const match = /^data:([^;]+);base64,(.+)$/.exec(dataUrl)
  if (!match) return null
  const bytes = Uint8Array.from(atob(match[2]!), (ch) => ch.charCodeAt(0))
  return new File([bytes], name, { type: match[1] })
}

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { clearDraft, loadDraft } from '#/lib/generator-draft'

// 照片暂存的读取规则（写入要用到浏览器的 canvas，在 e2e 里覆盖不了，这里只测读取和过期）
const PNG = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII='

describe('generator-draft', () => {
  let store: Record<string, string>
  beforeEach(() => {
    store = {}
    vi.stubGlobal('localStorage', {
      getItem: (key: string) => store[key] ?? null,
      setItem: (key: string, value: string) => void (store[key] = value),
      removeItem: (key: string) => void delete store[key],
    })
  })
  afterEach(() => vi.unstubAllGlobals())

  const put = (savedAt: number) =>
    (store['generator-draft'] = JSON.stringify({ savedAt, styleId: 'tiny-desk-v1', photos: { main: { name: 'a.jpg', dataUrl: PNG }, keys: { name: 'b.jpg', dataUrl: PNG } } }))

  it('1 小时内能恢复成同样数量的照片和风格', () => {
    put(1_000)
    const draft = loadDraft(1_000 + 59 * 60_000)
    expect(draft?.styleId).toBe('tiny-desk-v1')
    expect(Object.keys(draft!.files)).toEqual(['main', 'keys'])
    expect(draft!.files.main!.type).toBe('image/png')
    expect(draft!.files.main!.size).toBeGreaterThan(0)
  })

  it('超过 1 小时读不到，并且顺手删除', () => {
    put(1_000)
    expect(loadDraft(1_000 + 61 * 60_000)).toBeNull()
    expect(store['generator-draft']).toBeUndefined()
  })

  it('格式不对或没有暂存返回 null；clearDraft 删除暂存', () => {
    expect(loadDraft()).toBeNull()
    store['generator-draft'] = 'not json'
    expect(loadDraft()).toBeNull()
    put(Date.now())
    clearDraft()
    expect(store['generator-draft']).toBeUndefined()
  })
})

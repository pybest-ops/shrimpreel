import { expect, test } from '@playwright/test'
import { content, devLogin, json, post, uniqueEmail } from './helpers'

const ADMIN_EMAIL = 'admin@example.com'

type Message = { id: string; email: string; topic: string; message: string; status: string }

test('反馈浮窗：公开页面右下角打开，匿名提交（邮箱留空）后管理员在留言页看到类型和所在页面，并收到提醒', async ({ page, browser }) => {
  const t = content.en.feedback
  const text = `Feedback e2e ${uniqueEmail('fb')}: the preview slider is too small`
  await page.goto('/pricing')
  await page.getByTestId('feedback-button').click()
  await expect(page.getByRole('dialog')).toBeVisible()
  // 内容太短时不能提交
  await expect(page.getByTestId('feedback-send')).toBeDisabled()
  await page.getByTestId('feedback-type-bug').click()
  await page.getByTestId('feedback-message').fill(text)
  await page.getByTestId('feedback-send').click()
  await expect(page.getByTestId('feedback-sent')).toContainText(t.sentTitle)
  await page.getByRole('button', { name: t.done }).click()
  await expect(page.getByRole('dialog')).toHaveCount(0)

  const admin = await browser.newContext()
  try {
    await devLogin(admin.request, ADMIN_EMAIL)
    const { messages } = await json<{ messages: Message[] }>(admin.request.get('/api/admin/messages?status=open'))
    const row = messages.find((m) => m.message.startsWith(text))
    expect(row).toMatchObject({ topic: 'feedback_bug', email: '', message: `${text}\n\n[page] /pricing` })
    const { emails } = await json<{ emails: Array<{ subject: string | null; params: { email: string } }> }>(
      admin.request.get(`/api/dev/emails?${new URLSearchParams({ to: ADMIN_EMAIL, ref: `admin_contact:${row!.id}` })}`),
    )
    expect(emails[0]!.subject).toContain('新留言：反馈·Bug')
  } finally {
    await admin.close()
  }
})

test('反馈接口：太短或太长返回 400，未知类型记为 other，只收站内路径', async ({ request, browser }) => {
  const send = (body: Record<string, unknown>) => post(request, '/api/feedback', body)
  expect((await json<{ error: string }>(send({ type: 'idea', message: 'hi' }), 400)).error).toBe('invalid_message')
  expect((await json<{ error: string }>(send({ type: 'idea', message: 'x'.repeat(2001) }), 400)).error).toBe('invalid_message')

  const text = `Odd type ${uniqueEmail('fb-odd')}`
  await json(send({ type: 'nope', message: text, page: 'https://evil.example/x' }), 201)
  const admin = await browser.newContext()
  try {
    await devLogin(admin.request, ADMIN_EMAIL)
    const { messages } = await json<{ messages: Message[] }>(admin.request.get('/api/admin/messages?status=open'))
    expect(messages.find((m) => m.message.startsWith(text))).toMatchObject({ topic: 'feedback_other', message: text })
  } finally {
    await admin.close()
  }
})

test('反馈浮窗：中文页面显示中文文案', async ({ page }) => {
  await page.goto('/zh')
  await expect(page.getByTestId('feedback-button')).toHaveText(content.zh.feedback.button)
})

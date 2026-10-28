-- 邮箱验证码登录：每个邮箱同一时间只有一个有效验证码，重发会覆盖旧码、输错次数清零。
-- 库里只存 HMAC（SESSION_SECRET 作密钥），不存明文验证码；过期一天以上的记录由 Cron 清理，注销账号时一并删除
CREATE TABLE email_login_codes (
  email TEXT PRIMARY KEY,                       -- 归一化后的邮箱（去空格、小写）
  code_hash TEXT NOT NULL,                      -- HMAC-SHA256(SESSION_SECRET, email:code)
  expires_at TEXT NOT NULL,                     -- 发码后 10 分钟
  attempts INTEGER NOT NULL DEFAULT 0,          -- 输错次数，达到上限后作废
  window_started_at TEXT NOT NULL,              -- 每小时发送上限的计数窗口起点
  sends_in_window INTEGER NOT NULL DEFAULT 1,   -- 窗口内已发送次数
  created_at TEXT NOT NULL                      -- 最近一次发码时间（重发冷却）
);
CREATE INDEX idx_email_login_codes_expires ON email_login_codes(expires_at);

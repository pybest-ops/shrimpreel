-- 按来源和落地页累加访问，回答“ChatGPT 带来的人落在哪一页”。visit_stats 不加列：改主键要重建表
CREATE TABLE visit_landing_stats (
  day TEXT NOT NULL, -- YYYY-MM-DD（UTC）
  source TEXT NOT NULL,
  medium TEXT NOT NULL,
  landing TEXT NOT NULL, -- 公开页路径，其余为 other（见 src/server/seo.ts 的 landingKey）
  visits INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (day, source, medium, landing)
) WITHOUT ROWID;

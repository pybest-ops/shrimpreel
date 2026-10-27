-- 多人风格（styles[].seats）：主唱照片仍在 generations.upload_id，其余可选位置的照片一行一个。
-- 删除成片或注销账号时随 generations / uploads 级联删除
CREATE TABLE generation_seats (
  generation_id TEXT NOT NULL REFERENCES generations(id) ON DELETE CASCADE,
  seat_id TEXT NOT NULL,
  upload_id TEXT NOT NULL REFERENCES uploads(id) ON DELETE CASCADE,
  PRIMARY KEY (generation_id, seat_id)
);
CREATE INDEX idx_generation_seats_upload ON generation_seats(upload_id);

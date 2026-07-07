-- ============================================================
-- Migration 004: Kho vật tư, Đối tác, Báo giá, Chat, Chữ ký (GĐ D)
-- ============================================================

-- CHỮ KÝ NỘI BỘ: ảnh chữ ký vẽ tay của từng user, hiện trên phê duyệt
ALTER TABLE users ADD COLUMN IF NOT EXISTS signature_url VARCHAR(255);

-- KHO VẬT TƯ
CREATE TABLE IF NOT EXISTS warehouse_categories (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  name VARCHAR(100) UNIQUE NOT NULL,
  description TEXT,
  created_at TIMESTAMP DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS warehouse_items (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  code VARCHAR(50) UNIQUE NOT NULL,
  name VARCHAR(200) NOT NULL,
  description TEXT,
  category_id UUID REFERENCES warehouse_categories(id) ON DELETE SET NULL,
  unit VARCHAR(50) NOT NULL,
  quantity DECIMAL(15,3) NOT NULL DEFAULT 0,
  min_quantity DECIMAL(15,3) DEFAULT 0,
  unit_price DECIMAL(15,2),
  location VARCHAR(100),
  supplier VARCHAR(200),
  notes TEXT,
  is_active BOOLEAN DEFAULT true,
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_warehouse_items_category ON warehouse_items(category_id);

CREATE TABLE IF NOT EXISTS warehouse_transactions (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  item_id UUID NOT NULL REFERENCES warehouse_items(id) ON DELETE CASCADE,
  transaction_type VARCHAR(10) NOT NULL CHECK (transaction_type IN ('import','export','adjust')),
  quantity DECIMAL(15,3) NOT NULL CHECK (quantity > 0),
  unit_price DECIMAL(15,2),
  project_id UUID REFERENCES projects(id) ON DELETE SET NULL,
  reference_code VARCHAR(100),
  performed_by UUID REFERENCES users(id) ON DELETE SET NULL,
  notes TEXT,
  transaction_date TIMESTAMP DEFAULT NOW(),
  created_at TIMESTAMP DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_warehouse_tx_item ON warehouse_transactions(item_id, created_at DESC);

-- ĐỐI TÁC
CREATE TABLE IF NOT EXISTS partners (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  type VARCHAR(20) NOT NULL DEFAULT 'supplier' CHECK (type IN ('supplier','contractor','client')),
  name VARCHAR(200) NOT NULL,
  phone VARCHAR(50),
  email VARCHAR(100),
  address TEXT,
  tax_code VARCHAR(50),
  contact_person VARCHAR(100),
  notes TEXT,
  is_active BOOLEAN DEFAULT true,
  created_by UUID REFERENCES users(id) ON DELETE SET NULL,
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW()
);

-- BÁO GIÁ
CREATE TABLE IF NOT EXISTS quotes (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  code VARCHAR(50) UNIQUE NOT NULL,
  title VARCHAR(300) NOT NULL,
  project_id UUID REFERENCES projects(id) ON DELETE SET NULL,
  client_name VARCHAR(200),
  client_contact VARCHAR(200),
  status VARCHAR(30) NOT NULL DEFAULT 'draft'
    CHECK (status IN ('draft','sent','approved','rejected')),
  valid_until DATE,
  notes TEXT,
  total_amount DECIMAL(15,2) DEFAULT 0,
  created_by UUID REFERENCES users(id) ON DELETE SET NULL,
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS quote_items (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  quote_id UUID NOT NULL REFERENCES quotes(id) ON DELETE CASCADE,
  item_order INTEGER DEFAULT 0,
  description VARCHAR(300) NOT NULL,
  unit VARCHAR(50),
  quantity DECIMAL(15,3) NOT NULL DEFAULT 1,
  unit_price DECIMAL(15,2) NOT NULL DEFAULT 0,
  discount_percent DECIMAL(5,2) NOT NULL DEFAULT 0,
  amount DECIMAL(15,2) GENERATED ALWAYS AS (quantity * unit_price * (1 - discount_percent/100)) STORED,
  notes TEXT,
  created_at TIMESTAMP DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_quote_items_quote ON quote_items(quote_id);

-- CHAT NỘI BỘ
CREATE TABLE IF NOT EXISTS chat_rooms (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  name VARCHAR(100),
  type VARCHAR(20) NOT NULL DEFAULT 'group' CHECK (type IN ('group','direct')),
  created_by UUID REFERENCES users(id) ON DELETE SET NULL,
  created_at TIMESTAMP DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS chat_room_members (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  room_id UUID NOT NULL REFERENCES chat_rooms(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  last_read_at TIMESTAMP DEFAULT NOW(),
  UNIQUE(room_id, user_id)
);
CREATE INDEX IF NOT EXISTS idx_chat_members_user ON chat_room_members(user_id);

CREATE TABLE IF NOT EXISTS chat_messages (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  room_id UUID NOT NULL REFERENCES chat_rooms(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  content TEXT NOT NULL,
  created_at TIMESTAMP DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_chat_messages_room ON chat_messages(room_id, created_at DESC);

-- Phòng chat chung mặc định + tự thêm mọi user hiện có
INSERT INTO chat_rooms (name, type) SELECT 'Chung — Toàn công ty', 'group'
WHERE NOT EXISTS (SELECT 1 FROM chat_rooms WHERE name = 'Chung — Toàn công ty');
INSERT INTO chat_room_members (room_id, user_id)
SELECT r.id, u.id FROM chat_rooms r CROSS JOIN users u
WHERE r.name = 'Chung — Toàn công ty'
ON CONFLICT (room_id, user_id) DO NOTHING;

-- Seed quyền
INSERT INTO role_permissions (role, module, perm_level) VALUES
  ('admin','warehouse','full'), ('admin','partners','full'), ('admin','quotes','full'), ('admin','chat','edit'),
  ('director','warehouse','full'), ('director','partners','full'), ('director','quotes','full'), ('director','chat','edit'),
  ('pm','warehouse','view'), ('pm','partners','edit'), ('pm','quotes','edit'), ('pm','chat','edit'),
  ('head_tech','warehouse','edit'), ('head_tech','chat','edit'),
  ('head_hr','chat','edit'),
  ('head_sales','partners','edit'), ('head_sales','quotes','edit'), ('head_sales','chat','edit'),
  ('engineer','warehouse','view'), ('engineer','chat','edit'),
  ('field_supervisor','warehouse','view'), ('field_supervisor','chat','edit'),
  ('tech_deploy','warehouse','view'), ('tech_deploy','chat','edit'),
  ('hr','chat','edit'),
  ('warehouse','warehouse','edit'), ('warehouse','chat','edit'),
  ('warehouse_keeper','warehouse','full'), ('warehouse_keeper','chat','edit'),
  ('accountant','quotes','view'), ('accountant','partners','view'), ('accountant','chat','edit')
ON CONFLICT (role, module) DO NOTHING;

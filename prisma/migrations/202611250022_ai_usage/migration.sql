BEGIN;

CREATE EXTENSION IF NOT EXISTS btree_gist;

CREATE TABLE "ai_providers" (
    "id" UUID NOT NULL,
    "slug" VARCHAR(64) NOT NULL,
    "name" VARCHAR(120) NOT NULL,

    CONSTRAINT "ai_providers_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "ai_models" (
    "id" UUID NOT NULL,
    "provider_id" UUID NOT NULL,
    "model_key" VARCHAR(160) NOT NULL,
    "name" VARCHAR(160) NOT NULL,
    "active" BOOLEAN NOT NULL DEFAULT true,

    CONSTRAINT "ai_models_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "ai_tools" (
    "id" UUID NOT NULL,
    "slug" VARCHAR(64) NOT NULL,
    "name" VARCHAR(120) NOT NULL,

    CONSTRAINT "ai_tools_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "ai_model_prices" (
    "id" UUID NOT NULL,
    "model_id" UUID NOT NULL,
    "currency" VARCHAR(3) NOT NULL,
    "effective_from" TIMESTAMPTZ(3) NOT NULL,
    "effective_to" TIMESTAMPTZ(3),
    "input_price" DECIMAL(20,8) NOT NULL,
    "output_price" DECIMAL(20,8) NOT NULL,
    "cache_read_price" DECIMAL(20,8),
    "cache_write_price" DECIMAL(20,8),
    "source_url" VARCHAR(2000) NOT NULL,
    "observed_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "ai_model_prices_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "ai_usage_sources" (
    "id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "tool_id" UUID NOT NULL,
    "label" VARCHAR(120) NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "revoked_at" TIMESTAMPTZ(3),

    CONSTRAINT "ai_usage_sources_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "ai_usage_events" (
    "id" UUID NOT NULL,
    "source_id" UUID NOT NULL,
    "source_event_key" VARCHAR(160) NOT NULL,
    "model_id" UUID NOT NULL,
    "occurred_at" TIMESTAMPTZ(3) NOT NULL,
    "input_tokens" BIGINT NOT NULL,
    "unclassified_input_tokens" BIGINT NOT NULL,
    "output_tokens" BIGINT NOT NULL,
    "cache_read_tokens" BIGINT NOT NULL,
    "cache_write_tokens" BIGINT NOT NULL,
    "price_id" UUID,
    "estimated_cost_usd" DECIMAL(24,10),

    CONSTRAINT "ai_usage_events_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "ai_usage_preferences" (
    "user_id" UUID NOT NULL,
    "public_leaderboard" BOOLEAN NOT NULL DEFAULT false,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "ai_usage_preferences_pkey" PRIMARY KEY ("user_id")
);

CREATE UNIQUE INDEX "ai_providers_slug_key" ON "ai_providers"("slug");

CREATE UNIQUE INDEX "ai_models_provider_id_model_key_key" ON "ai_models"("provider_id", "model_key");

CREATE UNIQUE INDEX "ai_tools_slug_key" ON "ai_tools"("slug");

CREATE INDEX "ai_model_prices_model_id_currency_effective_from_idx" ON "ai_model_prices"("model_id", "currency", "effective_from");

CREATE INDEX "ai_usage_sources_user_id_created_at_id_idx" ON "ai_usage_sources"("user_id", "created_at", "id");

CREATE INDEX "ai_usage_sources_tool_id_idx" ON "ai_usage_sources"("tool_id");

CREATE INDEX "ai_usage_events_source_id_occurred_at_id_idx" ON "ai_usage_events"("source_id", "occurred_at", "id");

CREATE INDEX "ai_usage_events_model_id_occurred_at_idx" ON "ai_usage_events"("model_id", "occurred_at");

CREATE INDEX "ai_usage_events_price_id_idx" ON "ai_usage_events"("price_id");

CREATE UNIQUE INDEX "ai_usage_events_source_id_source_event_key_key" ON "ai_usage_events"("source_id", "source_event_key");

ALTER TABLE "ai_models" ADD CONSTRAINT "ai_models_provider_id_fkey" FOREIGN KEY ("provider_id") REFERENCES "ai_providers"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "ai_model_prices" ADD CONSTRAINT "ai_model_prices_model_id_fkey" FOREIGN KEY ("model_id") REFERENCES "ai_models"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "ai_usage_sources" ADD CONSTRAINT "ai_usage_sources_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "ai_usage_sources" ADD CONSTRAINT "ai_usage_sources_tool_id_fkey" FOREIGN KEY ("tool_id") REFERENCES "ai_tools"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "ai_usage_events" ADD CONSTRAINT "ai_usage_events_source_id_fkey" FOREIGN KEY ("source_id") REFERENCES "ai_usage_sources"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "ai_usage_events" ADD CONSTRAINT "ai_usage_events_model_id_fkey" FOREIGN KEY ("model_id") REFERENCES "ai_models"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "ai_usage_events" ADD CONSTRAINT "ai_usage_events_price_id_fkey" FOREIGN KEY ("price_id") REFERENCES "ai_model_prices"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "ai_usage_preferences" ADD CONSTRAINT "ai_usage_preferences_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "ai_providers" ADD CONSTRAINT "ai_providers_slug_not_blank" CHECK ("slug" ~ '[^[:space:]]'),
  ADD CONSTRAINT "ai_providers_name_not_blank" CHECK ("name" ~ '[^[:space:]]');
ALTER TABLE "ai_models" ADD CONSTRAINT "ai_models_key_not_blank" CHECK ("model_key" ~ '[^[:space:]]'),
  ADD CONSTRAINT "ai_models_name_not_blank" CHECK ("name" ~ '[^[:space:]]');
ALTER TABLE "ai_tools" ADD CONSTRAINT "ai_tools_slug_not_blank" CHECK ("slug" ~ '[^[:space:]]'),
  ADD CONSTRAINT "ai_tools_name_not_blank" CHECK ("name" ~ '[^[:space:]]');
ALTER TABLE "ai_model_prices"
  ADD CONSTRAINT "ai_model_prices_currency_code" CHECK ("currency" ~ '^[A-Z]{3}$'),
  ADD CONSTRAINT "ai_model_prices_valid_interval" CHECK ("effective_to" IS NULL OR "effective_to" > "effective_from"),
  ADD CONSTRAINT "ai_model_prices_nonnegative_prices" CHECK (
    "input_price" >= 0 AND "input_price" <> 'NaN'::numeric AND
    "output_price" >= 0 AND "output_price" <> 'NaN'::numeric AND
    ("cache_read_price" IS NULL OR ("cache_read_price" >= 0 AND "cache_read_price" <> 'NaN'::numeric)) AND
    ("cache_write_price" IS NULL OR ("cache_write_price" >= 0 AND "cache_write_price" <> 'NaN'::numeric))
  ),
  ADD CONSTRAINT "ai_model_prices_source_not_blank" CHECK ("source_url" ~ '[^[:space:]]'),
  ADD CONSTRAINT "ai_model_prices_no_overlap" EXCLUDE USING gist (
    "model_id" WITH =,
    "currency" WITH =,
    tstzrange("effective_from", "effective_to", '[)') WITH &&
  );
ALTER TABLE "ai_usage_sources" ADD CONSTRAINT "ai_usage_sources_label_not_blank" CHECK ("label" ~ '[^[:space:]]'),
  ADD CONSTRAINT "ai_usage_sources_revocation_order" CHECK ("revoked_at" IS NULL OR "revoked_at" >= "created_at");
ALTER TABLE "ai_usage_events"
  ADD CONSTRAINT "ai_usage_events_key_not_blank" CHECK ("source_event_key" ~ '[^[:space:]]'),
  ADD CONSTRAINT "ai_usage_events_nonnegative_tokens" CHECK (
    "input_tokens" >= 0 AND "unclassified_input_tokens" >= 0 AND "output_tokens" >= 0 AND
    "cache_read_tokens" >= 0 AND "cache_write_tokens" >= 0
  ),
  ADD CONSTRAINT "ai_usage_events_nonnegative_cost" CHECK (
    "estimated_cost_usd" IS NULL OR ("estimated_cost_usd" >= 0 AND "estimated_cost_usd" <> 'NaN'::numeric)
  ),
  ADD CONSTRAINT "ai_usage_events_estimate_requires_price" CHECK ("estimated_cost_usd" IS NULL OR "price_id" IS NOT NULL);

COMMENT ON TABLE "ai_providers" IS 'AI 模型供应商目录。';
COMMENT ON COLUMN "ai_providers"."id" IS '供应商唯一标识。';
COMMENT ON COLUMN "ai_providers"."slug" IS '供应商稳定短标识，全局唯一。';
COMMENT ON COLUMN "ai_providers"."name" IS '供应商显示名称。';

COMMENT ON TABLE "ai_models" IS '各供应商提供的模型目录及启用状态。';
COMMENT ON COLUMN "ai_models"."id" IS '模型唯一标识。';
COMMENT ON COLUMN "ai_models"."provider_id" IS '所属供应商标识。';
COMMENT ON COLUMN "ai_models"."model_key" IS '供应商内的稳定模型标识，与供应商联合唯一。';
COMMENT ON COLUMN "ai_models"."name" IS '模型显示名称。';
COMMENT ON COLUMN "ai_models"."active" IS '是否允许该模型用于新增用量导入。';

COMMENT ON TABLE "ai_tools" IS '产生 AI 用量的客户端和开发工具目录。';
COMMENT ON COLUMN "ai_tools"."id" IS '工具唯一标识。';
COMMENT ON COLUMN "ai_tools"."slug" IS '工具稳定短标识，全局唯一。';
COMMENT ON COLUMN "ai_tools"."name" IS '工具显示名称。';

COMMENT ON TABLE "ai_model_prices" IS '按模型、币种和生效区间维护的历史计价记录。';
COMMENT ON COLUMN "ai_model_prices"."id" IS '历史计价记录唯一标识。';
COMMENT ON COLUMN "ai_model_prices"."model_id" IS '使用此计价记录的模型标识。';
COMMENT ON COLUMN "ai_model_prices"."currency" IS '计价币种的三位大写代码。';
COMMENT ON COLUMN "ai_model_prices"."effective_from" IS '计价生效时间，包含该时刻。';
COMMENT ON COLUMN "ai_model_prices"."effective_to" IS '计价结束时间，不含该时刻；空值表示暂未设定结束时间。';
COMMENT ON COLUMN "ai_model_prices"."input_price" IS '每百万普通输入 Token 的单价。';
COMMENT ON COLUMN "ai_model_prices"."output_price" IS '每百万输出 Token 的单价。';
COMMENT ON COLUMN "ai_model_prices"."cache_read_price" IS '每百万缓存读取 Token 的单价；空值表示未提供。';
COMMENT ON COLUMN "ai_model_prices"."cache_write_price" IS '每百万缓存写入 Token 的单价；空值表示未提供。';
COMMENT ON COLUMN "ai_model_prices"."source_url" IS '计价信息来源页面地址。';
COMMENT ON COLUMN "ai_model_prices"."observed_at" IS '核对或采集该价格的时间。';

COMMENT ON TABLE "ai_usage_sources" IS '用户授权的用量导入来源及其撤销状态。';
COMMENT ON COLUMN "ai_usage_sources"."id" IS '用户用量来源唯一标识。';
COMMENT ON COLUMN "ai_usage_sources"."user_id" IS '拥有此来源的用户标识。';
COMMENT ON COLUMN "ai_usage_sources"."tool_id" IS '产生用量的开发工具标识。';
COMMENT ON COLUMN "ai_usage_sources"."label" IS '用户为导入来源设置的显示名称。';
COMMENT ON COLUMN "ai_usage_sources"."created_at" IS '来源创建时间。';
COMMENT ON COLUMN "ai_usage_sources"."revoked_at" IS '来源撤销时间；为空时可继续导入。';

COMMENT ON TABLE "ai_usage_events" IS '按来源幂等登记的 Token 用量与费用估算记录。';
COMMENT ON COLUMN "ai_usage_events"."id" IS '用量事件唯一标识。';
COMMENT ON COLUMN "ai_usage_events"."source_id" IS '用量所属的用户导入来源。';
COMMENT ON COLUMN "ai_usage_events"."source_event_key" IS '导入来源内唯一的事件标识，用于去重。';
COMMENT ON COLUMN "ai_usage_events"."model_id" IS '实际产生用量的模型标识。';
COMMENT ON COLUMN "ai_usage_events"."occurred_at" IS '用量实际发生的时间，按北京时间划分统计周期。';
COMMENT ON COLUMN "ai_usage_events"."input_tokens" IS '与缓存输入互斥的普通输入 Token 数。';
COMMENT ON COLUMN "ai_usage_events"."unclassified_input_tokens" IS '已知总量但无法拆分为普通或缓存类别的输入 Token 数。';
COMMENT ON COLUMN "ai_usage_events"."output_tokens" IS '输出 Token 数。';
COMMENT ON COLUMN "ai_usage_events"."cache_read_tokens" IS '与其他输入类别互斥的缓存读取 Token 数。';
COMMENT ON COLUMN "ai_usage_events"."cache_write_tokens" IS '与其他输入类别互斥的缓存写入 Token 数。';
COMMENT ON COLUMN "ai_usage_events"."price_id" IS '用量发生时匹配到的计价记录；缺价时为空。';
COMMENT ON COLUMN "ai_usage_events"."estimated_cost_usd" IS '入库时估算的美元费用；无法估算时为空。';

COMMENT ON TABLE "ai_usage_preferences" IS '用户的 AI 用量公开偏好，默认不公开排行。';
COMMENT ON COLUMN "ai_usage_preferences"."user_id" IS '用户标识，每位用户最多一条偏好记录。';
COMMENT ON COLUMN "ai_usage_preferences"."public_leaderboard" IS '用户是否同意公开显示在 AI 用量排行榜，默认关闭。';
COMMENT ON COLUMN "ai_usage_preferences"."updated_at" IS '偏好最近更新时间。';

COMMIT;

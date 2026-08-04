-- CreateSchema
CREATE SCHEMA IF NOT EXISTS "public";

-- CreateEnum
CREATE TYPE "LocationStatus" AS ENUM ('COMING_SOON', 'ACTIVE', 'CLOSED');

-- CreateEnum
CREATE TYPE "BookingProvider" AS ENUM ('INTERNAL', 'MOMENCE');

-- CreateEnum
CREATE TYPE "StudioKind" AS ENUM ('CONTRAST_SUITE', 'MOBILE_SAUNA');

-- CreateEnum
CREATE TYPE "OfferingType" AS ENUM ('COMMUNAL', 'PRIVATE_ONLY', 'BOTH');

-- CreateEnum
CREATE TYPE "SessionStatus" AS ENUM ('OPEN', 'CLOSED', 'CANCELLED', 'EXCLUSIVE');

-- CreateEnum
CREATE TYPE "CustomerKind" AS ENUM ('GUEST', 'ACCOUNT');

-- CreateEnum
CREATE TYPE "WaiverKind" AS ENUM ('LIABILITY', 'MINOR_CONSENT', 'PRIVACY');

-- CreateEnum
CREATE TYPE "SignatureKind" AS ENUM ('TYPED', 'DRAWN');

-- CreateEnum
CREATE TYPE "BookingType" AS ENUM ('DROP_IN', 'BUYOUT', 'MEMBER_VISIT', 'PACK_VISIT', 'COMP');

-- CreateEnum
CREATE TYPE "BookingStatus" AS ENUM ('HOLD', 'CONFIRMED', 'CHECKED_IN', 'CANCELLED', 'NO_SHOW', 'EXPIRED');

-- CreateEnum
CREATE TYPE "OrderChannel" AS ENUM ('WEB', 'POS', 'ADMIN');

-- CreateEnum
CREATE TYPE "OrderStatus" AS ENUM ('PENDING', 'PAID', 'PARTIALLY_REFUNDED', 'REFUNDED', 'VOID');

-- CreateEnum
CREATE TYPE "OrderLineKind" AS ENUM ('DROP_IN', 'BUYOUT', 'MEMBERSHIP_CYCLE', 'PACK', 'GIFT_CARD', 'RETAIL', 'FEE');

-- CreateEnum
CREATE TYPE "PaymentProviderKind" AS ENUM ('STRIPE', 'INTERNAL');

-- CreateEnum
CREATE TYPE "PaymentTender" AS ENUM ('CARD', 'APPLE_PAY', 'GOOGLE_PAY', 'TERMINAL', 'GIFT_CARD', 'PACK_CREDIT', 'ACCOUNT_CREDIT', 'COMP', 'CASH_RECORDED');

-- CreateEnum
CREATE TYPE "PaymentStatus" AS ENUM ('REQUIRES_ACTION', 'SUCCEEDED', 'FAILED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "RefundStatus" AS ENUM ('PENDING', 'SUCCEEDED', 'FAILED');

-- CreateEnum
CREATE TYPE "DiscountType" AS ENUM ('PERCENT', 'FIXED_CENTS');

-- CreateEnum
CREATE TYPE "DiscountAppliesTo" AS ENUM ('ALL', 'DROP_IN', 'BUYOUT', 'MEMBERSHIP_FIRST_CYCLE', 'PACK');

-- CreateEnum
CREATE TYPE "BillingInterval" AS ENUM ('MONTH');

-- CreateEnum
CREATE TYPE "VisitPolicy" AS ENUM ('UNLIMITED', 'N_PER_PERIOD');

-- CreateEnum
CREATE TYPE "SubscriptionStatus" AS ENUM ('ACTIVE', 'PAST_DUE', 'PAUSED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "InvoiceStatus" AS ENUM ('PENDING', 'PAID', 'FAILED', 'ABANDONED');

-- CreateEnum
CREATE TYPE "GiftCardStatus" AS ENUM ('ACTIVE', 'DISABLED');

-- CreateEnum
CREATE TYPE "LedgerReason" AS ENUM ('PURCHASE', 'REDEMPTION', 'REFUND', 'IMPORT', 'ADJUSTMENT', 'CANCELLATION_CREDIT');

-- CreateEnum
CREATE TYPE "StaffRoleKind" AS ENUM ('CORPORATE_ADMIN', 'LOCATION_OWNER', 'LOCATION_ADMIN', 'FRONT_DESK');

-- CreateEnum
CREATE TYPE "ActorType" AS ENUM ('STAFF', 'CUSTOMER', 'SYSTEM', 'WEBHOOK');

-- CreateEnum
CREATE TYPE "WebhookStatus" AS ENUM ('RECEIVED', 'PROCESSED', 'FAILED');

-- CreateEnum
CREATE TYPE "OutboxKind" AS ENUM ('SMS', 'EMAIL');

-- CreateEnum
CREATE TYPE "OutboxStatus" AS ENUM ('PENDING', 'SENT', 'FAILED');

-- CreateTable
CREATE TABLE "organizations" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "organizations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "locations" (
    "id" TEXT NOT NULL,
    "org_id" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "timezone" TEXT NOT NULL,
    "address1" TEXT NOT NULL,
    "address2" TEXT,
    "city" TEXT NOT NULL,
    "state" TEXT NOT NULL,
    "postal_code" TEXT NOT NULL,
    "phone" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "status" "LocationStatus" NOT NULL DEFAULT 'COMING_SOON',
    "tax_rate_bps" INTEGER NOT NULL,
    "booking_window_days" INTEGER NOT NULL DEFAULT 35,
    "booking_provider" "BookingProvider" NOT NULL DEFAULT 'MOMENCE',
    "momence_url" TEXT,
    "settings" JSONB NOT NULL DEFAULT '{}',
    "stripe_account_id" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "locations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "studios" (
    "id" TEXT NOT NULL,
    "location_id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "kind" "StudioKind" NOT NULL,
    "default_capacity" INTEGER NOT NULL,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "studios_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "session_templates" (
    "id" TEXT NOT NULL,
    "studio_id" TEXT NOT NULL,
    "location_id" TEXT NOT NULL,
    "day_of_week" INTEGER NOT NULL,
    "start_time_local" TEXT NOT NULL,
    "duration_min" INTEGER NOT NULL DEFAULT 60,
    "capacity" INTEGER,
    "offering_type" "OfferingType" NOT NULL,
    "price_cents" INTEGER NOT NULL,
    "effective_from" DATE NOT NULL,
    "effective_until" DATE,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "session_templates_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "sessions" (
    "id" TEXT NOT NULL,
    "studio_id" TEXT NOT NULL,
    "location_id" TEXT NOT NULL,
    "template_id" TEXT,
    "starts_at" TIMESTAMP(3) NOT NULL,
    "ends_at" TIMESTAMP(3) NOT NULL,
    "capacity" INTEGER NOT NULL,
    "booked_seats" INTEGER NOT NULL DEFAULT 0,
    "status" "SessionStatus" NOT NULL DEFAULT 'OPEN',
    "exclusive_booking_id" TEXT,
    "price_cents" INTEGER NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "sessions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "buyout_options" (
    "id" TEXT NOT NULL,
    "location_id" TEXT NOT NULL,
    "studio_id" TEXT,
    "duration_hours" INTEGER NOT NULL,
    "price_cents" INTEGER NOT NULL,
    "max_guests" INTEGER NOT NULL,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "buyout_options_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "customers" (
    "id" TEXT NOT NULL,
    "kind" "CustomerKind" NOT NULL,
    "first_name" TEXT NOT NULL,
    "last_name" TEXT,
    "phone" TEXT NOT NULL,
    "email" TEXT,
    "date_of_birth" DATE,
    "auth_user_id" TEXT,
    "stripe_customer_id" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "customers_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "customer_location_profiles" (
    "id" TEXT NOT NULL,
    "customer_id" TEXT NOT NULL,
    "location_id" TEXT NOT NULL,
    "first_visit_at" TIMESTAMP(3),
    "notes" TEXT,
    "flags" JSONB NOT NULL DEFAULT '{}',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "customer_location_profiles_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "waiver_documents" (
    "id" TEXT NOT NULL,
    "location_id" TEXT NOT NULL,
    "kind" "WaiverKind" NOT NULL,
    "version" INTEGER NOT NULL,
    "title" TEXT NOT NULL,
    "body_markdown" TEXT NOT NULL,
    "content_sha256" TEXT NOT NULL,
    "published_at" TIMESTAMP(3),
    "active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "waiver_documents_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "waiver_signatures" (
    "id" TEXT NOT NULL,
    "customer_id" TEXT NOT NULL,
    "location_id" TEXT NOT NULL,
    "waiver_document_id" TEXT NOT NULL,
    "signed_at" TIMESTAMP(3) NOT NULL,
    "signature_kind" "SignatureKind" NOT NULL,
    "typed_name" TEXT,
    "signature_image_url" TEXT,
    "ip_address" TEXT,
    "user_agent" TEXT,
    "minor_customer_id" TEXT,
    "guardian_name" TEXT,
    "guardian_relationship" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "waiver_signatures_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "bookings" (
    "id" TEXT NOT NULL,
    "session_id" TEXT,
    "location_id" TEXT NOT NULL,
    "studio_id" TEXT NOT NULL,
    "customer_id" TEXT NOT NULL,
    "order_id" TEXT,
    "type" "BookingType" NOT NULL,
    "seats" INTEGER NOT NULL DEFAULT 1,
    "status" "BookingStatus" NOT NULL,
    "hold_expires_at" TIMESTAMP(3),
    "starts_at" TIMESTAMP(3) NOT NULL,
    "ends_at" TIMESTAMP(3) NOT NULL,
    "attendees" JSONB NOT NULL DEFAULT '[]',
    "cancelled_at" TIMESTAMP(3),
    "cancellation_reason" TEXT,
    "checked_in_at" TIMESTAMP(3),
    "manage_token" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "bookings_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "orders" (
    "id" TEXT NOT NULL,
    "location_id" TEXT NOT NULL,
    "customer_id" TEXT,
    "channel" "OrderChannel" NOT NULL,
    "status" "OrderStatus" NOT NULL DEFAULT 'PENDING',
    "currency" TEXT NOT NULL DEFAULT 'usd',
    "subtotal_cents" INTEGER NOT NULL,
    "discount_cents" INTEGER NOT NULL,
    "tax_cents" INTEGER NOT NULL,
    "tip_cents" INTEGER NOT NULL,
    "total_cents" INTEGER NOT NULL,
    "discount_code_id" TEXT,
    "pricing_version" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "orders_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "order_lines" (
    "id" TEXT NOT NULL,
    "order_id" TEXT NOT NULL,
    "location_id" TEXT NOT NULL,
    "kind" "OrderLineKind" NOT NULL,
    "ref_id" TEXT,
    "description" TEXT NOT NULL,
    "qty" INTEGER NOT NULL,
    "unit_price_cents" INTEGER NOT NULL,
    "line_subtotal_cents" INTEGER NOT NULL,
    "discount_allocated_cents" INTEGER NOT NULL,
    "tax_cents" INTEGER NOT NULL,
    "line_total_cents" INTEGER NOT NULL,
    "taxable" BOOLEAN NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "order_lines_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "payments" (
    "id" TEXT NOT NULL,
    "order_id" TEXT NOT NULL,
    "location_id" TEXT NOT NULL,
    "provider" "PaymentProviderKind" NOT NULL,
    "provider_account_ref" TEXT,
    "provider_payment_ref" TEXT,
    "tender" "PaymentTender" NOT NULL,
    "amount_cents" INTEGER NOT NULL,
    "status" "PaymentStatus" NOT NULL,
    "failure_code" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "payments_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "refunds" (
    "id" TEXT NOT NULL,
    "payment_id" TEXT NOT NULL,
    "order_id" TEXT NOT NULL,
    "location_id" TEXT NOT NULL,
    "amount_cents" INTEGER NOT NULL,
    "reason" TEXT NOT NULL,
    "initiated_by_staff_id" TEXT,
    "provider_refund_ref" TEXT,
    "status" "RefundStatus" NOT NULL DEFAULT 'PENDING',
    "line_allocations" JSONB NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "refunds_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "discount_codes" (
    "id" TEXT NOT NULL,
    "location_id" TEXT,
    "code" TEXT NOT NULL,
    "type" "DiscountType" NOT NULL,
    "value_bps" INTEGER,
    "value_cents" INTEGER,
    "applies_to" "DiscountAppliesTo" NOT NULL,
    "max_redemptions" INTEGER,
    "max_per_customer" INTEGER,
    "min_subtotal_cents" INTEGER,
    "starts_at" TIMESTAMP(3),
    "ends_at" TIMESTAMP(3),
    "active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "discount_codes_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "discount_redemptions" (
    "id" TEXT NOT NULL,
    "discount_code_id" TEXT NOT NULL,
    "order_id" TEXT NOT NULL,
    "customer_id" TEXT,
    "location_id" TEXT NOT NULL,
    "amount_cents" INTEGER NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "discount_redemptions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "membership_plans" (
    "id" TEXT NOT NULL,
    "location_id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "price_cents" INTEGER NOT NULL,
    "interval" "BillingInterval" NOT NULL DEFAULT 'MONTH',
    "visit_policy" "VisitPolicy" NOT NULL,
    "visits_per_period" INTEGER,
    "guest_passes_per_period" INTEGER NOT NULL DEFAULT 0,
    "giftable" BOOLEAN NOT NULL DEFAULT false,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "membership_plans_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "membership_subscriptions" (
    "id" TEXT NOT NULL,
    "plan_id" TEXT NOT NULL,
    "customer_id" TEXT NOT NULL,
    "location_id" TEXT NOT NULL,
    "status" "SubscriptionStatus" NOT NULL,
    "current_period_start" TIMESTAMP(3) NOT NULL,
    "current_period_end" TIMESTAMP(3) NOT NULL,
    "anchor_day" INTEGER NOT NULL,
    "price_cents_override" INTEGER,
    "stripe_payment_method_ref" TEXT,
    "cancel_at_period_end" BOOLEAN NOT NULL DEFAULT false,
    "paused_until" TIMESTAMP(3),
    "gifted_by_customer_id" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "membership_subscriptions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "subscription_invoices" (
    "id" TEXT NOT NULL,
    "subscription_id" TEXT NOT NULL,
    "location_id" TEXT NOT NULL,
    "period_start" TIMESTAMP(3) NOT NULL,
    "period_end" TIMESTAMP(3) NOT NULL,
    "order_id" TEXT,
    "attempt_count" INTEGER NOT NULL DEFAULT 0,
    "next_retry_at" TIMESTAMP(3),
    "status" "InvoiceStatus" NOT NULL DEFAULT 'PENDING',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "subscription_invoices_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "gift_cards" (
    "id" TEXT NOT NULL,
    "location_id" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "initial_cents" INTEGER NOT NULL,
    "purchaser_customer_id" TEXT,
    "recipient_name" TEXT,
    "recipient_contact" TEXT,
    "status" "GiftCardStatus" NOT NULL DEFAULT 'ACTIVE',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "gift_cards_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "packs" (
    "id" TEXT NOT NULL,
    "location_id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "credits" INTEGER NOT NULL,
    "price_cents" INTEGER NOT NULL,
    "expires_after_days" INTEGER,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "packs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "pack_balances" (
    "id" TEXT NOT NULL,
    "pack_id" TEXT NOT NULL,
    "customer_id" TEXT NOT NULL,
    "location_id" TEXT NOT NULL,
    "expires_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "pack_balances_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "stored_value_ledger" (
    "id" TEXT NOT NULL,
    "location_id" TEXT NOT NULL,
    "gift_card_id" TEXT,
    "pack_balance_id" TEXT,
    "customer_id" TEXT,
    "delta_cents" INTEGER,
    "delta_credits" INTEGER,
    "reason" "LedgerReason" NOT NULL,
    "order_id" TEXT,
    "refund_id" TEXT,
    "note" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "stored_value_ledger_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "staff_users" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "phone" TEXT,
    "auth_user_id" TEXT,
    "pin" TEXT,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "staff_users_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "staff_roles" (
    "id" TEXT NOT NULL,
    "staff_user_id" TEXT NOT NULL,
    "role" "StaffRoleKind" NOT NULL,
    "location_id" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "staff_roles_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "audit_logs" (
    "id" TEXT NOT NULL,
    "actor_type" "ActorType" NOT NULL,
    "actor_id" TEXT,
    "location_id" TEXT,
    "action" TEXT NOT NULL,
    "entity_type" TEXT NOT NULL,
    "entity_id" TEXT NOT NULL,
    "before" JSONB,
    "after" JSONB,
    "ip" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "audit_logs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "webhook_events" (
    "id" TEXT NOT NULL,
    "provider" TEXT NOT NULL,
    "provider_event_id" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "payload" JSONB NOT NULL,
    "status" "WebhookStatus" NOT NULL DEFAULT 'RECEIVED',
    "processed_at" TIMESTAMP(3),
    "error" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "webhook_events_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "outbox_messages" (
    "id" TEXT NOT NULL,
    "location_id" TEXT,
    "kind" "OutboxKind" NOT NULL,
    "recipient" TEXT NOT NULL,
    "template" TEXT NOT NULL,
    "payload" JSONB NOT NULL,
    "scheduled_for" TIMESTAMP(3) NOT NULL,
    "sent_at" TIMESTAMP(3),
    "status" "OutboxStatus" NOT NULL DEFAULT 'PENDING',
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "last_error" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "outbox_messages_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "auth_users" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "email_verified" BOOLEAN NOT NULL DEFAULT false,
    "image" TEXT,
    "phone_number" TEXT,
    "phone_number_verified" BOOLEAN,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "auth_users_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "auth_sessions" (
    "id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "token" TEXT NOT NULL,
    "expires_at" TIMESTAMP(3) NOT NULL,
    "ip_address" TEXT,
    "user_agent" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "auth_sessions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "auth_accounts" (
    "id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "account_id" TEXT NOT NULL,
    "provider_id" TEXT NOT NULL,
    "access_token" TEXT,
    "refresh_token" TEXT,
    "id_token" TEXT,
    "scope" TEXT,
    "password" TEXT,
    "expires_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "auth_accounts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "auth_verifications" (
    "id" TEXT NOT NULL,
    "identifier" TEXT NOT NULL,
    "value" TEXT NOT NULL,
    "expires_at" TIMESTAMP(3) NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "auth_verifications_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "locations_slug_key" ON "locations"("slug");

-- CreateIndex
CREATE INDEX "locations_org_id_idx" ON "locations"("org_id");

-- CreateIndex
CREATE INDEX "studios_location_id_idx" ON "studios"("location_id");

-- CreateIndex
CREATE INDEX "session_templates_location_id_idx" ON "session_templates"("location_id");

-- CreateIndex
CREATE UNIQUE INDEX "session_templates_studio_id_day_of_week_start_time_local_ef_key" ON "session_templates"("studio_id", "day_of_week", "start_time_local", "effective_from");

-- CreateIndex
CREATE INDEX "sessions_location_id_starts_at_idx" ON "sessions"("location_id", "starts_at");

-- CreateIndex
CREATE INDEX "sessions_template_id_idx" ON "sessions"("template_id");

-- CreateIndex
CREATE UNIQUE INDEX "sessions_studio_id_starts_at_key" ON "sessions"("studio_id", "starts_at");

-- CreateIndex
CREATE INDEX "buyout_options_location_id_idx" ON "buyout_options"("location_id");

-- CreateIndex
CREATE UNIQUE INDEX "customers_auth_user_id_key" ON "customers"("auth_user_id");

-- CreateIndex
CREATE INDEX "customers_phone_idx" ON "customers"("phone");

-- CreateIndex
CREATE INDEX "customer_location_profiles_location_id_idx" ON "customer_location_profiles"("location_id");

-- CreateIndex
CREATE UNIQUE INDEX "customer_location_profiles_customer_id_location_id_key" ON "customer_location_profiles"("customer_id", "location_id");

-- CreateIndex
CREATE INDEX "waiver_documents_location_id_idx" ON "waiver_documents"("location_id");

-- CreateIndex
CREATE UNIQUE INDEX "waiver_documents_location_id_kind_version_key" ON "waiver_documents"("location_id", "kind", "version");

-- CreateIndex
CREATE INDEX "waiver_signatures_customer_id_idx" ON "waiver_signatures"("customer_id");

-- CreateIndex
CREATE INDEX "waiver_signatures_location_id_idx" ON "waiver_signatures"("location_id");

-- CreateIndex
CREATE INDEX "waiver_signatures_waiver_document_id_idx" ON "waiver_signatures"("waiver_document_id");

-- CreateIndex
CREATE UNIQUE INDEX "bookings_manage_token_key" ON "bookings"("manage_token");

-- CreateIndex
CREATE INDEX "bookings_location_id_starts_at_idx" ON "bookings"("location_id", "starts_at");

-- CreateIndex
CREATE INDEX "bookings_session_id_idx" ON "bookings"("session_id");

-- CreateIndex
CREATE INDEX "bookings_studio_id_idx" ON "bookings"("studio_id");

-- CreateIndex
CREATE INDEX "bookings_customer_id_idx" ON "bookings"("customer_id");

-- CreateIndex
CREATE INDEX "bookings_order_id_idx" ON "bookings"("order_id");

-- CreateIndex
CREATE INDEX "bookings_status_hold_expires_at_idx" ON "bookings"("status", "hold_expires_at");

-- CreateIndex
CREATE INDEX "orders_location_id_idx" ON "orders"("location_id");

-- CreateIndex
CREATE INDEX "orders_customer_id_idx" ON "orders"("customer_id");

-- CreateIndex
CREATE INDEX "orders_discount_code_id_idx" ON "orders"("discount_code_id");

-- CreateIndex
CREATE INDEX "order_lines_order_id_idx" ON "order_lines"("order_id");

-- CreateIndex
CREATE INDEX "order_lines_location_id_idx" ON "order_lines"("location_id");

-- CreateIndex
CREATE INDEX "payments_order_id_idx" ON "payments"("order_id");

-- CreateIndex
CREATE INDEX "payments_location_id_idx" ON "payments"("location_id");

-- CreateIndex
CREATE INDEX "payments_provider_payment_ref_idx" ON "payments"("provider_payment_ref");

-- CreateIndex
CREATE INDEX "refunds_payment_id_idx" ON "refunds"("payment_id");

-- CreateIndex
CREATE INDEX "refunds_order_id_idx" ON "refunds"("order_id");

-- CreateIndex
CREATE INDEX "refunds_location_id_idx" ON "refunds"("location_id");

-- CreateIndex
CREATE INDEX "discount_codes_location_id_idx" ON "discount_codes"("location_id");

-- CreateIndex
CREATE UNIQUE INDEX "discount_codes_location_id_code_key" ON "discount_codes"("location_id", "code");

-- CreateIndex
CREATE INDEX "discount_redemptions_discount_code_id_idx" ON "discount_redemptions"("discount_code_id");

-- CreateIndex
CREATE INDEX "discount_redemptions_order_id_idx" ON "discount_redemptions"("order_id");

-- CreateIndex
CREATE INDEX "discount_redemptions_customer_id_idx" ON "discount_redemptions"("customer_id");

-- CreateIndex
CREATE INDEX "discount_redemptions_location_id_idx" ON "discount_redemptions"("location_id");

-- CreateIndex
CREATE INDEX "membership_plans_location_id_idx" ON "membership_plans"("location_id");

-- CreateIndex
CREATE INDEX "membership_subscriptions_plan_id_idx" ON "membership_subscriptions"("plan_id");

-- CreateIndex
CREATE INDEX "membership_subscriptions_customer_id_idx" ON "membership_subscriptions"("customer_id");

-- CreateIndex
CREATE INDEX "membership_subscriptions_location_id_idx" ON "membership_subscriptions"("location_id");

-- CreateIndex
CREATE INDEX "membership_subscriptions_status_current_period_end_idx" ON "membership_subscriptions"("status", "current_period_end");

-- CreateIndex
CREATE INDEX "subscription_invoices_subscription_id_idx" ON "subscription_invoices"("subscription_id");

-- CreateIndex
CREATE INDEX "subscription_invoices_location_id_idx" ON "subscription_invoices"("location_id");

-- CreateIndex
CREATE INDEX "subscription_invoices_status_next_retry_at_idx" ON "subscription_invoices"("status", "next_retry_at");

-- CreateIndex
CREATE UNIQUE INDEX "gift_cards_code_key" ON "gift_cards"("code");

-- CreateIndex
CREATE INDEX "gift_cards_location_id_idx" ON "gift_cards"("location_id");

-- CreateIndex
CREATE INDEX "packs_location_id_idx" ON "packs"("location_id");

-- CreateIndex
CREATE INDEX "pack_balances_pack_id_idx" ON "pack_balances"("pack_id");

-- CreateIndex
CREATE INDEX "pack_balances_customer_id_idx" ON "pack_balances"("customer_id");

-- CreateIndex
CREATE INDEX "pack_balances_location_id_idx" ON "pack_balances"("location_id");

-- CreateIndex
CREATE INDEX "stored_value_ledger_location_id_idx" ON "stored_value_ledger"("location_id");

-- CreateIndex
CREATE INDEX "stored_value_ledger_gift_card_id_idx" ON "stored_value_ledger"("gift_card_id");

-- CreateIndex
CREATE INDEX "stored_value_ledger_pack_balance_id_idx" ON "stored_value_ledger"("pack_balance_id");

-- CreateIndex
CREATE INDEX "stored_value_ledger_customer_id_idx" ON "stored_value_ledger"("customer_id");

-- CreateIndex
CREATE INDEX "stored_value_ledger_order_id_idx" ON "stored_value_ledger"("order_id");

-- CreateIndex
CREATE UNIQUE INDEX "staff_users_email_key" ON "staff_users"("email");

-- CreateIndex
CREATE UNIQUE INDEX "staff_users_auth_user_id_key" ON "staff_users"("auth_user_id");

-- CreateIndex
CREATE INDEX "staff_roles_staff_user_id_idx" ON "staff_roles"("staff_user_id");

-- CreateIndex
CREATE INDEX "staff_roles_location_id_idx" ON "staff_roles"("location_id");

-- CreateIndex
CREATE UNIQUE INDEX "staff_roles_staff_user_id_role_location_id_key" ON "staff_roles"("staff_user_id", "role", "location_id");

-- CreateIndex
CREATE INDEX "audit_logs_location_id_idx" ON "audit_logs"("location_id");

-- CreateIndex
CREATE INDEX "audit_logs_entity_type_entity_id_idx" ON "audit_logs"("entity_type", "entity_id");

-- CreateIndex
CREATE INDEX "audit_logs_created_at_idx" ON "audit_logs"("created_at");

-- CreateIndex
CREATE INDEX "webhook_events_status_idx" ON "webhook_events"("status");

-- CreateIndex
CREATE UNIQUE INDEX "webhook_events_provider_provider_event_id_key" ON "webhook_events"("provider", "provider_event_id");

-- CreateIndex
CREATE INDEX "outbox_messages_location_id_idx" ON "outbox_messages"("location_id");

-- CreateIndex
CREATE INDEX "outbox_messages_status_scheduled_for_idx" ON "outbox_messages"("status", "scheduled_for");

-- CreateIndex
CREATE UNIQUE INDEX "auth_users_email_key" ON "auth_users"("email");

-- CreateIndex
CREATE UNIQUE INDEX "auth_users_phone_number_key" ON "auth_users"("phone_number");

-- CreateIndex
CREATE UNIQUE INDEX "auth_sessions_token_key" ON "auth_sessions"("token");

-- CreateIndex
CREATE INDEX "auth_sessions_user_id_idx" ON "auth_sessions"("user_id");

-- CreateIndex
CREATE INDEX "auth_accounts_user_id_idx" ON "auth_accounts"("user_id");

-- CreateIndex
CREATE INDEX "auth_verifications_identifier_idx" ON "auth_verifications"("identifier");

-- AddForeignKey
ALTER TABLE "locations" ADD CONSTRAINT "locations_org_id_fkey" FOREIGN KEY ("org_id") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "studios" ADD CONSTRAINT "studios_location_id_fkey" FOREIGN KEY ("location_id") REFERENCES "locations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "session_templates" ADD CONSTRAINT "session_templates_studio_id_fkey" FOREIGN KEY ("studio_id") REFERENCES "studios"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "session_templates" ADD CONSTRAINT "session_templates_location_id_fkey" FOREIGN KEY ("location_id") REFERENCES "locations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sessions" ADD CONSTRAINT "sessions_studio_id_fkey" FOREIGN KEY ("studio_id") REFERENCES "studios"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sessions" ADD CONSTRAINT "sessions_location_id_fkey" FOREIGN KEY ("location_id") REFERENCES "locations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sessions" ADD CONSTRAINT "sessions_template_id_fkey" FOREIGN KEY ("template_id") REFERENCES "session_templates"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "buyout_options" ADD CONSTRAINT "buyout_options_location_id_fkey" FOREIGN KEY ("location_id") REFERENCES "locations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "buyout_options" ADD CONSTRAINT "buyout_options_studio_id_fkey" FOREIGN KEY ("studio_id") REFERENCES "studios"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "customer_location_profiles" ADD CONSTRAINT "customer_location_profiles_customer_id_fkey" FOREIGN KEY ("customer_id") REFERENCES "customers"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "customer_location_profiles" ADD CONSTRAINT "customer_location_profiles_location_id_fkey" FOREIGN KEY ("location_id") REFERENCES "locations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "waiver_documents" ADD CONSTRAINT "waiver_documents_location_id_fkey" FOREIGN KEY ("location_id") REFERENCES "locations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "waiver_signatures" ADD CONSTRAINT "waiver_signatures_customer_id_fkey" FOREIGN KEY ("customer_id") REFERENCES "customers"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "waiver_signatures" ADD CONSTRAINT "waiver_signatures_location_id_fkey" FOREIGN KEY ("location_id") REFERENCES "locations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "waiver_signatures" ADD CONSTRAINT "waiver_signatures_waiver_document_id_fkey" FOREIGN KEY ("waiver_document_id") REFERENCES "waiver_documents"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "waiver_signatures" ADD CONSTRAINT "waiver_signatures_minor_customer_id_fkey" FOREIGN KEY ("minor_customer_id") REFERENCES "customers"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "bookings" ADD CONSTRAINT "bookings_session_id_fkey" FOREIGN KEY ("session_id") REFERENCES "sessions"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "bookings" ADD CONSTRAINT "bookings_location_id_fkey" FOREIGN KEY ("location_id") REFERENCES "locations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "bookings" ADD CONSTRAINT "bookings_studio_id_fkey" FOREIGN KEY ("studio_id") REFERENCES "studios"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "bookings" ADD CONSTRAINT "bookings_customer_id_fkey" FOREIGN KEY ("customer_id") REFERENCES "customers"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "bookings" ADD CONSTRAINT "bookings_order_id_fkey" FOREIGN KEY ("order_id") REFERENCES "orders"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "orders" ADD CONSTRAINT "orders_location_id_fkey" FOREIGN KEY ("location_id") REFERENCES "locations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "orders" ADD CONSTRAINT "orders_customer_id_fkey" FOREIGN KEY ("customer_id") REFERENCES "customers"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "orders" ADD CONSTRAINT "orders_discount_code_id_fkey" FOREIGN KEY ("discount_code_id") REFERENCES "discount_codes"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "order_lines" ADD CONSTRAINT "order_lines_order_id_fkey" FOREIGN KEY ("order_id") REFERENCES "orders"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "order_lines" ADD CONSTRAINT "order_lines_location_id_fkey" FOREIGN KEY ("location_id") REFERENCES "locations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "payments" ADD CONSTRAINT "payments_order_id_fkey" FOREIGN KEY ("order_id") REFERENCES "orders"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "payments" ADD CONSTRAINT "payments_location_id_fkey" FOREIGN KEY ("location_id") REFERENCES "locations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "refunds" ADD CONSTRAINT "refunds_payment_id_fkey" FOREIGN KEY ("payment_id") REFERENCES "payments"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "refunds" ADD CONSTRAINT "refunds_order_id_fkey" FOREIGN KEY ("order_id") REFERENCES "orders"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "refunds" ADD CONSTRAINT "refunds_location_id_fkey" FOREIGN KEY ("location_id") REFERENCES "locations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "refunds" ADD CONSTRAINT "refunds_initiated_by_staff_id_fkey" FOREIGN KEY ("initiated_by_staff_id") REFERENCES "staff_users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "discount_codes" ADD CONSTRAINT "discount_codes_location_id_fkey" FOREIGN KEY ("location_id") REFERENCES "locations"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "discount_redemptions" ADD CONSTRAINT "discount_redemptions_discount_code_id_fkey" FOREIGN KEY ("discount_code_id") REFERENCES "discount_codes"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "discount_redemptions" ADD CONSTRAINT "discount_redemptions_order_id_fkey" FOREIGN KEY ("order_id") REFERENCES "orders"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "discount_redemptions" ADD CONSTRAINT "discount_redemptions_customer_id_fkey" FOREIGN KEY ("customer_id") REFERENCES "customers"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "discount_redemptions" ADD CONSTRAINT "discount_redemptions_location_id_fkey" FOREIGN KEY ("location_id") REFERENCES "locations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "membership_plans" ADD CONSTRAINT "membership_plans_location_id_fkey" FOREIGN KEY ("location_id") REFERENCES "locations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "membership_subscriptions" ADD CONSTRAINT "membership_subscriptions_plan_id_fkey" FOREIGN KEY ("plan_id") REFERENCES "membership_plans"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "membership_subscriptions" ADD CONSTRAINT "membership_subscriptions_customer_id_fkey" FOREIGN KEY ("customer_id") REFERENCES "customers"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "membership_subscriptions" ADD CONSTRAINT "membership_subscriptions_location_id_fkey" FOREIGN KEY ("location_id") REFERENCES "locations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "membership_subscriptions" ADD CONSTRAINT "membership_subscriptions_gifted_by_customer_id_fkey" FOREIGN KEY ("gifted_by_customer_id") REFERENCES "customers"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "subscription_invoices" ADD CONSTRAINT "subscription_invoices_subscription_id_fkey" FOREIGN KEY ("subscription_id") REFERENCES "membership_subscriptions"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "subscription_invoices" ADD CONSTRAINT "subscription_invoices_location_id_fkey" FOREIGN KEY ("location_id") REFERENCES "locations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "subscription_invoices" ADD CONSTRAINT "subscription_invoices_order_id_fkey" FOREIGN KEY ("order_id") REFERENCES "orders"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "gift_cards" ADD CONSTRAINT "gift_cards_location_id_fkey" FOREIGN KEY ("location_id") REFERENCES "locations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "gift_cards" ADD CONSTRAINT "gift_cards_purchaser_customer_id_fkey" FOREIGN KEY ("purchaser_customer_id") REFERENCES "customers"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "packs" ADD CONSTRAINT "packs_location_id_fkey" FOREIGN KEY ("location_id") REFERENCES "locations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "pack_balances" ADD CONSTRAINT "pack_balances_pack_id_fkey" FOREIGN KEY ("pack_id") REFERENCES "packs"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "pack_balances" ADD CONSTRAINT "pack_balances_customer_id_fkey" FOREIGN KEY ("customer_id") REFERENCES "customers"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "pack_balances" ADD CONSTRAINT "pack_balances_location_id_fkey" FOREIGN KEY ("location_id") REFERENCES "locations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "stored_value_ledger" ADD CONSTRAINT "stored_value_ledger_location_id_fkey" FOREIGN KEY ("location_id") REFERENCES "locations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "stored_value_ledger" ADD CONSTRAINT "stored_value_ledger_gift_card_id_fkey" FOREIGN KEY ("gift_card_id") REFERENCES "gift_cards"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "stored_value_ledger" ADD CONSTRAINT "stored_value_ledger_pack_balance_id_fkey" FOREIGN KEY ("pack_balance_id") REFERENCES "pack_balances"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "stored_value_ledger" ADD CONSTRAINT "stored_value_ledger_customer_id_fkey" FOREIGN KEY ("customer_id") REFERENCES "customers"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "stored_value_ledger" ADD CONSTRAINT "stored_value_ledger_order_id_fkey" FOREIGN KEY ("order_id") REFERENCES "orders"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "stored_value_ledger" ADD CONSTRAINT "stored_value_ledger_refund_id_fkey" FOREIGN KEY ("refund_id") REFERENCES "refunds"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "staff_roles" ADD CONSTRAINT "staff_roles_staff_user_id_fkey" FOREIGN KEY ("staff_user_id") REFERENCES "staff_users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "staff_roles" ADD CONSTRAINT "staff_roles_location_id_fkey" FOREIGN KEY ("location_id") REFERENCES "locations"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "auth_sessions" ADD CONSTRAINT "auth_sessions_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "auth_users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "auth_accounts" ADD CONSTRAINT "auth_accounts_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "auth_users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
-- Raw SQL constraints Prisma cannot express in schema.prisma.
--
-- These statements MUST be appended to the migration.sql of the FIRST
-- migration generated by `prisma migrate dev` (see packages/db/README.md).
-- They are written to be idempotent so re-application is harmless.

-- ---------------------------------------------------------------------------
-- Overbooking is impossible at the DB level (invariant #3 in CLAUDE.md).
-- App code books via conditional UPDATE ... WHERE booked_seats + n <= capacity;
-- this CHECK is the backstop.
-- ---------------------------------------------------------------------------
ALTER TABLE "sessions"
  DROP CONSTRAINT IF EXISTS "sessions_booked_seats_within_capacity";
ALTER TABLE "sessions"
  ADD CONSTRAINT "sessions_booked_seats_within_capacity"
  CHECK ("booked_seats" >= 0 AND "booked_seats" <= "capacity");

-- ---------------------------------------------------------------------------
-- Brand-wide discount codes (location_id IS NULL) must be unique. Postgres
-- treats NULLs as distinct in the @@unique([locationId, code]) constraint, so
-- brand-wide uniqueness needs a partial unique index (case-insensitive).
-- ---------------------------------------------------------------------------
CREATE UNIQUE INDEX IF NOT EXISTS "discount_codes_brand_wide_code_key"
  ON "discount_codes" (lower("code"))
  WHERE "location_id" IS NULL;

-- ---------------------------------------------------------------------------
-- Same NULL-distinctness caveat for org-wide staff roles (location_id IS NULL,
-- e.g. CORPORATE_ADMIN): prevent duplicate global role rows per staff user.
-- ---------------------------------------------------------------------------
CREATE UNIQUE INDEX IF NOT EXISTS "staff_roles_global_role_key"
  ON "staff_roles" ("staff_user_id", "role")
  WHERE "location_id" IS NULL;

-- ---------------------------------------------------------------------------
-- Discount codes must carry the value field matching their type.
-- ---------------------------------------------------------------------------
ALTER TABLE "discount_codes"
  DROP CONSTRAINT IF EXISTS "discount_codes_value_matches_type";
ALTER TABLE "discount_codes"
  ADD CONSTRAINT "discount_codes_value_matches_type"
  CHECK (
    ("type" = 'PERCENT' AND "value_bps" IS NOT NULL)
    OR ("type" = 'FIXED_CENTS' AND "value_cents" IS NOT NULL)
  );

-- ---------------------------------------------------------------------------
-- Stored-value ledger rows must move something and point at something.
-- ---------------------------------------------------------------------------
ALTER TABLE "stored_value_ledger"
  DROP CONSTRAINT IF EXISTS "stored_value_ledger_has_delta";
ALTER TABLE "stored_value_ledger"
  ADD CONSTRAINT "stored_value_ledger_has_delta"
  CHECK ("delta_cents" IS NOT NULL OR "delta_credits" IS NOT NULL);

ALTER TABLE "stored_value_ledger"
  DROP CONSTRAINT IF EXISTS "stored_value_ledger_has_target";
ALTER TABLE "stored_value_ledger"
  ADD CONSTRAINT "stored_value_ledger_has_target"
  CHECK (
    "gift_card_id" IS NOT NULL
    OR "pack_balance_id" IS NOT NULL
    OR "customer_id" IS NOT NULL
  );

-- ---------------------------------------------------------------------------
-- EXCLUSIVE sessions must reference the buyout booking that claimed them.
-- ---------------------------------------------------------------------------
ALTER TABLE "sessions"
  DROP CONSTRAINT IF EXISTS "sessions_exclusive_requires_booking";
ALTER TABLE "sessions"
  ADD CONSTRAINT "sessions_exclusive_requires_booking"
  CHECK ("status" <> 'EXCLUSIVE' OR "exclusive_booking_id" IS NOT NULL);

-- ---------------------------------------------------------------------------
-- Bookings always hold at least one seat.
-- ---------------------------------------------------------------------------
ALTER TABLE "bookings"
  DROP CONSTRAINT IF EXISTS "bookings_seats_positive";
ALTER TABLE "bookings"
  ADD CONSTRAINT "bookings_seats_positive"
  CHECK ("seats" >= 1);

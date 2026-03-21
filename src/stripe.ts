import Stripe from "stripe";

const stripeSecretKey = String(process.env.STRIPE_SECRET_KEY || "").trim();

if (!stripeSecretKey) {
  console.warn("ENV WARNING: STRIPE_SECRET_KEY is missing.");
}

export const stripe = new Stripe(stripeSecretKey, {
  apiVersion: "2024-06-20",
});

export const STRIPE_PRICE_ID = String(process.env.STRIPE_PRICE_ID || "").trim();
export const FRONTEND_URL = String(
  process.env.FRONTEND_URL || "http://localhost:3000"
).trim();
export const STRIPE_WEBHOOK_SECRET = String(
  process.env.STRIPE_WEBHOOK_SECRET || ""
).trim();